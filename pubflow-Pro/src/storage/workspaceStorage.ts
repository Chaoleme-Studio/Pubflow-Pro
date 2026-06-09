import { PLATFORM_ORDER } from '../platforms';
import { parseTopics } from '../domain/content';
import { STORAGE_KEYS } from '../types';
import { sleep } from '../utils/time';
import type { ContentDraft, PlatformStatus, PublishRecord, VideoRecord, WorkspaceSettings } from '../types';

const DB_NAME = 'pubflow-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const WORKSPACE_HANDLE_KEY = 'workspace-directory';

type PermissionMode = { mode: 'read' | 'readwrite' };
type PermissionAwareDirectoryHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor?: PermissionMode) => Promise<PermissionState>;
};

interface StoredWorkspaceHandle {
  key: string;
  handle: FileSystemDirectoryHandle;
  directoryName: string;
  updatedAt: number;
}

// 浏览器不会直接让扩展长期持有目录句柄，这里用 IndexedDB 保存授权过的 handle。
function openWorkspaceDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withHandleStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openWorkspaceDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = callback(store);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export const defaultWorkspaceSettings: WorkspaceSettings = {
  directoryName: '',
  permission: 'unknown',
};

export async function loadWorkspaceSettings(): Promise<WorkspaceSettings> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.workspaceSettings);
  return {
    ...defaultWorkspaceSettings,
    ...(stored[STORAGE_KEYS.workspaceSettings] || {}),
  } as WorkspaceSettings;
}

export async function saveWorkspaceSettings(settings: WorkspaceSettings) {
  await browser.storage.local.set({
    [STORAGE_KEYS.workspaceSettings]: settings,
  });
}

export async function saveWorkspaceDirectory(handle: FileSystemDirectoryHandle) {
  const updatedAt = Date.now();
  await withHandleStore('readwrite', (store) =>
    store.put({
      key: WORKSPACE_HANDLE_KEY,
      handle,
      directoryName: handle.name,
      updatedAt,
    } satisfies StoredWorkspaceHandle),
  );
  await saveWorkspaceSettings({
    directoryName: handle.name,
    permission: await queryWorkspacePermission(handle),
    updatedAt,
  });
}

export async function loadWorkspaceDirectory(): Promise<StoredWorkspaceHandle | null> {
  try {
    return (await withHandleStore('readonly', (store) =>
      store.get(WORKSPACE_HANDLE_KEY),
    )) as StoredWorkspaceHandle | undefined || null;
  } catch {
    return null;
  }
}

export async function clearWorkspaceDirectory() {
  await withHandleStore('readwrite', (store) => store.delete(WORKSPACE_HANDLE_KEY));
  await saveWorkspaceSettings(defaultWorkspaceSettings);
}

export async function queryWorkspacePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const permissionHandle = handle as PermissionAwareDirectoryHandle;
  if (!permissionHandle.queryPermission) return 'unsupported';
  return permissionHandle.queryPermission({ mode: 'readwrite' });
}

export async function requestWorkspacePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const permissionHandle = handle as PermissionAwareDirectoryHandle;
  if (!permissionHandle.requestPermission) return 'unsupported';
  return permissionHandle.requestPermission({ mode: 'readwrite' });
}

export function createProjectId() {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

export function createProjectFolderName(projectId: string, title?: string, contentType?: string) {
  const safeTitle = (title || 'untitled')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .slice(0, 36);
  // projectId 格式: YYYY-MM-DD-{random}，插入 type 到日期和随机串之间
  // 结果: YYYY-MM-DD-{type}-{random}-{title}
  const typeSegment = contentType ? `-${contentType}` : '';
  const match = projectId.match(/^(\d{4}-\d{2}-\d{2})-(.+)$/);
  if (match) {
    return `${match[1]}${typeSegment}-${match[2]}-${safeTitle || 'untitled'}`;
  }
  return `${projectId}${typeSegment}-${safeTitle || 'untitled'}`;
}

async function ensureReadwritePermission(handle: FileSystemDirectoryHandle) {
  const current = await queryWorkspacePermission(handle);
  if (current === 'granted' || current === 'unsupported') return current;
  return requestWorkspacePermission(handle);
}

async function getOrCreateDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

async function writeFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: File | Blob | string,
) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

function uniqueAssetName(file: File, prefix: string) {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) || prefix;
  return `${prefix}-${Date.now()}-${base}${ext}`;
}

// 这里负责把“当前草稿”映射到工作区里的项目目录，不存在就创建。
export async function ensureWorkspaceProject(draft: ContentDraft) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return null;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') throw new Error('工作区没有写入权限，请在设置里重新选择文件夹。');

  const projectsDir = await getOrCreateDirectory(storedWorkspace.handle, 'projects');
  const projectId = draft.projectId || createProjectId();
  const existingProjectDir = await getProjectDirectoryById(projectId, draft.title);
  const projectName = existingProjectDir
    ? await getProjectDirectoryName(projectsDir, existingProjectDir, projectId, draft.title)
    : createProjectFolderName(projectId, draft.title, draft.contentType);
  const projectDir = existingProjectDir || await getOrCreateDirectory(projectsDir, projectName);
  await getOrCreateDirectory(projectDir, 'assets');

  const settings: WorkspaceSettings = {
    directoryName: storedWorkspace.directoryName,
    permission,
    currentProjectId: projectId,
    currentProjectName: projectName,
    updatedAt: Date.now(),
  };
  await saveWorkspaceSettings(settings);

  return { projectId, projectName, projectDir, settings };
}

async function getProjectDirectoryName(
  projectsDir: FileSystemDirectoryHandle,
  projectDir: FileSystemDirectoryHandle,
  projectId: string,
  title?: string,
) {
  for await (const [name, entry] of (projectsDir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind === 'directory' && entry === projectDir) return name;
    if (entry.kind === 'directory' && name.startsWith(`${projectId}-`)) return name;
  }
  return createProjectFolderName(projectId, title);
}

export async function importProjectAsset(
  draft: ContentDraft,
  file: File,
  kind: 'video' | 'cover' | 'music' | 'image',
) {
  // 素材统一落到项目目录下的 assets 子目录，避免混到根目录。
  const project = await ensureWorkspaceProject(draft);
  if (!project) return null;

  const assetsDir = await getOrCreateDirectory(project.projectDir, 'assets');
  const subdirName = kind === 'image' ? 'images' : kind;
  const targetDir = await getOrCreateDirectory(assetsDir, subdirName);
  const fileName = uniqueAssetName(file, kind);
  await writeFile(targetDir, fileName, file);

  return {
    projectId: project.projectId,
    projectName: project.projectName,
    fileName,
    relativePath: `projects/${project.projectName}/assets/${subdirName}/${fileName}`,
  };
}

function draftToPlatformStatuses(draft: ContentDraft, existing?: PlatformStatus[]): PlatformStatus[] {
  return PLATFORM_ORDER.map((platformId) => {
    const prev = existing?.find((item) => item.platformId === platformId);
    if (prev?.status === 'published') return prev;
    return {
      ...prev,
      platformId,
      status: draft.selectedPlatforms.includes(platformId) ? 'pending' : 'skipped',
    };
  });
}

function draftToVideoRecord(draft: ContentDraft, existing?: VideoRecord): VideoRecord {
  const now = Date.now();
  const projectId = draft.projectId || existing?.projectId || existing?.id || createProjectId();
  return {
    contentType: draft.contentType || existing?.contentType || (draft.imageCacheIds?.length ? 'image' : 'video'),
    id: draft.sourceVideoId || existing?.id || projectId,
    title: draft.title.trim() || '未命名内容',
    description: draft.description.trim(),
    topics: parseTopics(draft.topicsText),
    campaignIds: [...(draft.selectedCampaignIds || [])],
    projectId,
    videoCacheId: draft.videoCacheId || '',
    coverCacheId: draft.coverCacheId || '',
    videoFileName: draft.videoFileName || '',
    coverFileName: draft.coverFileName || '',
    musicFileName: draft.musicFileName || '',
    imageFileNames: [...(draft.imageFileNames || [])],
    videoSize: draft.videoSize || 0,
    coverSize: draft.coverSize || 0,
    musicSize: draft.musicSize || 0,
    articleContent: draft.articleContent || existing?.articleContent || undefined,
    platformSettings: draft.platformSettings || existing?.platformSettings || {},
    platforms: draftToPlatformStatuses(draft, existing?.platforms),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

/** 按 projectId 加载项目 manifest（含 articleContent） */
export async function loadProjectManifestByVideo(projectId: string, title?: string): Promise<WorkspaceProjectManifest | null> {
  const projectDir = await getProjectDirectoryById(projectId, title);
  if (!projectDir) return null;
  return readProjectManifest(projectDir);
}

export async function writeProjectManifest(draft: ContentDraft, persistArticleContent?: string) {
  const project = await ensureWorkspaceProject(draft);
  if (!project) return null;

  const existing = await readProjectManifest(project.projectDir);
  const video = draftToVideoRecord(draft, existing?.video);
  const articleContent =
    typeof persistArticleContent === 'string'
      ? persistArticleContent
      : draft.articleContent || existing?.articleContent;
  const manifest = createProjectManifest({
    video,
    records: existing?.records || [],
    articleContent,
  });

  await writeFile(project.projectDir, 'project.json', JSON.stringify(manifest, null, 2));
  await mergeDataFile({
    projectIndex: [{
      projectId: project.projectId,
      path: `projects/${project.projectName}`,
      title: video.title,
      updatedAt: video.updatedAt,
    }],
  });
  return project;
}

// ==================== 从工作区恢复 ====================

export interface WorkspaceProjectManifest {
  version: 2;
  id: string;
  updatedAt: string;
  deletedAt?: number | null;
  video: VideoRecord;
  records: PublishRecord[];
  /** 文章正文（Markdown，图片用文件路径引用如 [img-1]: assets/images/img-1.png） */
  articleContent?: string;
}

async function readJsonFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
): Promise<unknown | null> {
  try {
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    const text = await file.text();
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export async function loadAllWorkspaceProjects(): Promise<WorkspaceProjectManifest[]> {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return [];

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return [];

  try {
    const projectsDir = await storedWorkspace.handle.getDirectoryHandle('projects');
    const projects: WorkspaceProjectManifest[] = [];
    const deletedDirs: Array<{ name: string; handle: FileSystemDirectoryHandle }> = [];

    for await (const [name, entry] of (projectsDir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'directory') continue;
      const projectDir = entry as FileSystemDirectoryHandle;
      const manifest = await readProjectManifest(projectDir);
      if (manifest && !manifest.deletedAt) {
        projects.push(manifest);
      } else if (manifest?.deletedAt) {
        // 软删除但物理目录残留的项目，收集起来稍后清理
        deletedDirs.push({ name, handle: projectDir });
      }
    }

    // 异步清理软删除的残留目录，不阻塞返回
    if (deletedDirs.length > 0) {
      void cleanupDeletedProjectDirs(projectsDir, deletedDirs).catch(() => undefined);
    }

    return projects.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  } catch {
    return [];
  }
}

async function cleanupDeletedProjectDirs(
  projectsDir: FileSystemDirectoryHandle,
  dirs: Array<{ name: string; handle: FileSystemDirectoryHandle }>,
) {
  for (const { name } of dirs) {
    // 文件系统句柄释放需要时间，首次 removeEntry 经常失败，重试一次
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await projectsDir.removeEntry(name, { recursive: true });
        break;
      } catch {
        if (attempt === 0) await sleep(500);
      }
    }
  }
}

// 优先按 manifest 里的 projectId 找目录；目录名可能因为标题或迁移历史保留旧前缀。
async function getProjectDirectoryById(projectId: string, title?: string) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle || !projectId) return null;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return null;

  try {
    const projectsDir = await storedWorkspace.handle.getDirectoryHandle('projects');
    const expectedName = title ? createProjectFolderName(projectId, title) : '';

    if (expectedName) {
      try {
        return await projectsDir.getDirectoryHandle(expectedName);
      } catch {
        // Fall through to prefix search.
      }
    }

    for await (const [name, entry] of (projectsDir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'directory') continue;
      const manifest = await readProjectManifest(entry as FileSystemDirectoryHandle);
      if (manifest && !manifest.deletedAt && (manifest.id === projectId || manifest.video.projectId === projectId)) {
        return entry as FileSystemDirectoryHandle;
      }
      if (entry.kind === 'directory' && name.startsWith(`${projectId}-`)) {
        return entry as FileSystemDirectoryHandle;
      }
    }
  } catch {
    return null;
  }

  return null;
}

export async function readProjectManifest(
  projectDir: FileSystemDirectoryHandle,
): Promise<WorkspaceProjectManifest | null> {
  const raw = await readJsonFile(projectDir, 'project.json');
  if (!raw || typeof raw !== 'object') return null;
  const manifest = raw as Partial<WorkspaceProjectManifest>;
  if (manifest.version !== 2 || !manifest.video?.id) return null;
  const articleContent =
    typeof manifest.articleContent === 'string'
      ? manifest.articleContent
      : typeof manifest.video.articleContent === 'string'
        ? manifest.video.articleContent
        : undefined;
  return {
    version: 2,
    id: manifest.id || manifest.video.projectId || manifest.video.id,
    updatedAt: manifest.updatedAt || new Date(manifest.video.updatedAt || Date.now()).toISOString(),
    deletedAt: typeof manifest.deletedAt === 'number' ? manifest.deletedAt : null,
    video: {
      ...manifest.video,
      projectId: manifest.video.projectId || manifest.id || manifest.video.id,
      topics: Array.isArray(manifest.video.topics) ? manifest.video.topics : [],
      campaignIds: Array.isArray(manifest.video.campaignIds) ? manifest.video.campaignIds : [],
      imageFileNames: Array.isArray(manifest.video.imageFileNames) ? manifest.video.imageFileNames : [],
      platforms: Array.isArray(manifest.video.platforms) ? manifest.video.platforms : [],
      articleContent,
    },
    records: Array.isArray(manifest.records) ? manifest.records : [],
    articleContent,
  };
}

export function createProjectManifest(input: {
  video: VideoRecord;
  records?: PublishRecord[];
  articleContent?: string;
}): WorkspaceProjectManifest {
  const projectId = input.video.projectId || input.video.id;
  const manifest: WorkspaceProjectManifest = {
    version: 2,
    id: projectId,
    updatedAt: new Date(input.video.updatedAt || Date.now()).toISOString(),
    deletedAt: null,
    video: {
      ...input.video,
      projectId,
    },
    records: input.records || [],
  };
  if (typeof input.articleContent === 'string') {
    manifest.articleContent = input.articleContent;
  }
  return manifest;
}

export async function writeProjectData(video: VideoRecord, records: PublishRecord[] = []) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return false;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return false;

  const projectId = video.projectId || video.id;
  const projectsDir = await getOrCreateDirectory(storedWorkspace.handle, 'projects');
  const existingProjectDir = await getProjectDirectoryById(projectId, video.title);
  const projectName = existingProjectDir
    ? await getProjectDirectoryName(projectsDir, existingProjectDir, projectId, video.title)
    : createProjectFolderName(projectId, video.title, video.contentType);
  const projectDir = existingProjectDir || await getOrCreateDirectory(projectsDir, projectName);
  await getOrCreateDirectory(projectDir, 'assets');
  await writeFile(projectDir, 'project.json', JSON.stringify(createProjectManifest({ video, records }), null, 2));
  await mergeDataFile({
    projectIndex: [{
      projectId,
      path: `projects/${projectName}`,
      title: video.title,
      updatedAt: video.updatedAt,
    }],
  });
  return true;
}

async function copyDirectory(
  source: FileSystemDirectoryHandle,
  target: FileSystemDirectoryHandle,
) {
  for await (const [name, entry] of (source as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind === 'file') {
      const file = await (entry as FileSystemFileHandle).getFile();
      await writeFile(target, name, file);
      continue;
    }

    const targetChild = await getOrCreateDirectory(target, name);
    await copyDirectory(entry as FileSystemDirectoryHandle, targetChild);
  }
}

async function markProjectDeletedInIndex(params: {
  projectId: string;
  projectName?: string;
  title?: string;
  deletedAt: number;
}) {
  await mergeDataFile({
    projectIndex: [{
      projectId: params.projectId,
      path: params.projectName ? `projects/${params.projectName}` : `projects/${params.projectId}`,
      title: params.title || '已删除项目',
      updatedAt: params.deletedAt,
      deletedAt: params.deletedAt,
    }],
  });
}

async function markProjectManifestDeleted(
  projectDir: FileSystemDirectoryHandle,
  deletedAt: number,
) {
  const manifest = await readProjectManifest(projectDir);
  if (!manifest) return false;
  await writeFile(
    projectDir,
    'project.json',
    JSON.stringify({ ...manifest, deletedAt, updatedAt: new Date(deletedAt).toISOString() }, null, 2),
  );
  return true;
}

export async function deleteProjectData(video: Pick<VideoRecord, 'id' | 'projectId' | 'title'>) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return { ok: false, reason: 'no-workspace' as const };

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return { ok: false, reason: 'permission-denied' as const };

  const projectId = video.projectId || video.id;
  const deletedAt = Date.now();

  try {
    const projectsDir = await storedWorkspace.handle.getDirectoryHandle('projects');
    const projectDir = await getProjectDirectoryById(projectId, video.title);
    if (!projectDir) {
      await markProjectDeletedInIndex({ projectId, title: video.title, deletedAt });
      return { ok: true, reason: 'missing-project' as const };
    }

    const projectName = await getProjectDirectoryName(projectsDir, projectDir, projectId, video.title);
    const trashDir = await getOrCreateDirectory(storedWorkspace.handle, 'Trash');
    const trashProjectName = `${deletedAt}-${projectName}`;
    const trashProjectDir = await getOrCreateDirectory(trashDir, trashProjectName);

    // 1. 先复制到 Trash
    await copyDirectory(projectDir, trashProjectDir);

    // 2. 标记原始 manifest 为已删除（确保软删除始终生效）
    await markProjectManifestDeleted(projectDir, deletedAt);

    // 3. 尝试从 projects 目录移除原始文件夹
    // 刚写入 manifest，文件系统句柄需要释放，等一下再删
    let removed = false;
    await sleep(300);
    try {
      await (projectsDir as FileSystemDirectoryHandle).removeEntry(projectName, { recursive: true });
      removed = true;
    } catch {
      // removeEntry 可能因权限或浏览器限制失败，
      // 此时原始目录保留但 manifest 已标记 deletedAt，
      // loadAllWorkspaceProjects 会再次尝试清理。
    }

    await markProjectDeletedInIndex({ projectId, projectName, title: video.title, deletedAt });
    return { ok: true, reason: removed ? 'trashed' as const : 'soft-deleted' as const, trashPath: `Trash/${trashProjectName}` };
  } catch {
    await markProjectDeletedInIndex({ projectId, title: video.title, deletedAt });
    return { ok: false, reason: 'delete-failed' as const };
  }
}

async function tryReadProjectAssetFile(
  projectDir: FileSystemDirectoryHandle,
  subdirName: string,
  fileName?: string,
) {
  if (!fileName) return null;

  try {
    const assetsDir = await projectDir.getDirectoryHandle('assets');
    const targetDir = await assetsDir.getDirectoryHandle(subdirName);
    const fileHandle = await targetDir.getFileHandle(fileName);
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}

export async function loadProjectAssetFiles(params: {
  projectId?: string;
  title?: string;
  videoFileName?: string;
  coverFileName?: string;
  musicFileName?: string;
  imageFileNames?: string[];
}) {
  // “继续/编辑” 会走这里，把工作区里的素材重新恢复成 File 对象。
  const projectDir = await getProjectDirectoryById(params.projectId || '', params.title);
  if (!projectDir) {
    return {
      videoFile: null,
      coverFile: null,
      musicFile: null,
      imageFiles: [] as File[],
    };
  }

  const imageFiles = (
    await Promise.all(
      (params.imageFileNames || []).map((fileName) => tryReadProjectAssetFile(projectDir, 'images', fileName)),
    )
  ).filter((file): file is File => !!file);

  return {
    videoFile: await tryReadProjectAssetFile(projectDir, 'video', params.videoFileName),
    coverFile: await tryReadProjectAssetFile(projectDir, 'cover', params.coverFileName),
    musicFile: await tryReadProjectAssetFile(projectDir, 'music', params.musicFileName),
    imageFiles,
  };
}

// ==================== 全量导出 / 导入 ====================

// ==================== 工作区根配置文件 ====================
//
// pubflow-data.json 只保存全局配置、当前草稿和项目索引。
// 项目的业务数据以 projects/<project>/project.json 为准，便于单项目迁移。
// chrome.storage.local 只作为无工作区时的 fallback 和快速恢复缓存。

export interface PubFlowDataFile {
  version: 2;
  updatedAt: string;
  draft: Record<string, unknown>;
  settings: {
    platformSettings: Record<string, unknown>;
    globalSettings: Record<string, unknown>;
    serverConfig: Record<string, unknown>;
    aiSettings: Record<string, unknown>;
  };
  projectIndex: Array<{
    projectId: string;
    path: string;
    title: string;
    updatedAt: number;
    deletedAt?: number | null;
  }>;
}

const DATA_FILE_NAME = 'pubflow-data.json';
const REDACTED_SECRET = '';

function redactSettingsSecrets(settings: PubFlowDataFile['settings']): PubFlowDataFile['settings'] {
  const serverConfig = { ...settings.serverConfig };
  if ('apiKey' in serverConfig) {
    serverConfig.apiKey = REDACTED_SECRET;
  }

  const aiSettings = { ...settings.aiSettings };
  if (Array.isArray(aiSettings.providers)) {
    aiSettings.providers = aiSettings.providers.map((provider) => {
      if (!provider || typeof provider !== 'object') return provider;
      return {
        ...(provider as Record<string, unknown>),
        apiKey: REDACTED_SECRET,
      };
    });
  }
  if ('apiKey' in aiSettings) {
    aiSettings.apiKey = REDACTED_SECRET;
  }

  return {
    ...settings,
    serverConfig,
    aiSettings,
  };
}

let cachedHandle: FileSystemDirectoryHandle | null = null;

async function getWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (cachedHandle) return cachedHandle;
  const stored = await loadWorkspaceDirectory();
  if (!stored?.handle) return null;
  const permission = await ensureReadwritePermission(stored.handle);
  if (permission === 'denied') return null;
  cachedHandle = stored.handle;
  return stored.handle;
}

/** 失效句柄缓存（切换工作区时调用） */
export function invalidateWorkspaceCache() {
  cachedHandle = null;
}

/** 从工作区读取完整数据文件，没有则返回 null */
export async function readDataFile(): Promise<PubFlowDataFile | null> {
  const handle = await getWorkspaceHandle();
  if (!handle) return null;
  const raw = await readJsonFile(handle, DATA_FILE_NAME);
  if (!raw || typeof raw !== 'object' || (raw as Record<string, unknown>).version !== 2) return null;
  return raw as PubFlowDataFile;
}

/** 写入完整数据文件到工作区 */
export async function writeDataFile(data: Omit<PubFlowDataFile, 'version' | 'updatedAt'>) {
  const handle = await getWorkspaceHandle();
  if (!handle) return;
  const permission = await ensureReadwritePermission(handle);
  if (permission === 'denied') return;

  // draft 里不存大字段（articleContent、imageCacheIds），这些只存在各项目的 project.json 中
  const { articleContent, imageCacheIds, ...lightDraft } = data.draft as Record<string, unknown>;

  const fileData: PubFlowDataFile = {
    ...data,
    draft: lightDraft,
    settings: redactSettingsSecrets(data.settings),
    version: 2,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(handle, DATA_FILE_NAME, JSON.stringify(fileData, null, 2));
}

/** 部分更新：读 → 合并 → 写 */
export async function mergeDataFile(partial: Partial<Omit<PubFlowDataFile, 'version' | 'updatedAt'>>) {
  const existing = (await readDataFile()) || {
    version: 2,
    updatedAt: '',
    draft: {},
    settings: { platformSettings: {}, globalSettings: {}, serverConfig: {}, aiSettings: {} },
    projectIndex: [],
  } satisfies PubFlowDataFile;

  const projectIndex = [...existing.projectIndex];
  for (const incoming of partial.projectIndex || []) {
    const index = projectIndex.findIndex((item) => item.projectId === incoming.projectId);
    if (index >= 0) projectIndex[index] = { ...projectIndex[index], ...incoming };
    else projectIndex.push(incoming);
  }

  await writeDataFile({
    draft: partial.draft ?? existing.draft,
    settings: partial.settings ?? existing.settings,
    projectIndex: projectIndex.sort((a, b) => b.updatedAt - a.updatedAt),
  });
}

export async function isWorkspaceAvailable(): Promise<boolean> {
  return getWorkspaceHandle().then((h) => h !== null);
}
