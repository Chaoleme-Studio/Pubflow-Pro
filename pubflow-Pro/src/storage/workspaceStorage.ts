import { PLATFORM_ORDER } from '../platforms';
import { normalizeScheduledAt, parseTopics } from '../domain/content';
import { STORAGE_KEYS } from '../types';
import { sleep } from '../utils/time';
import type { ContentDraft, PlatformStatus, PublishRecord, VideoRecord, WorkspaceSettings } from '../types';

const DB_NAME = 'pubflow-workspace';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const WORKSPACE_HANDLE_KEY = 'workspace-directory';
const DATA_FILE_NAME = 'pubflow-data.json';
const WORKSPACE_IDENTITY_FILE_NAME = '.pubflow-workspace.json';

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
/** 打开保存工作区目录句柄的 IndexedDB。 */
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

/** 在工作区 IndexedDB 上执行一次对象存储操作。 */
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

/** 加载工作区设置（目录名、权限状态等）。 */
export async function loadWorkspaceSettings(): Promise<WorkspaceSettings> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.workspaceSettings);
  return {
    ...defaultWorkspaceSettings,
    ...(stored[STORAGE_KEYS.workspaceSettings] || {}),
  } as WorkspaceSettings;
}

/** 保存工作区设置。 */
export async function saveWorkspaceSettings(settings: WorkspaceSettings) {
  await browser.storage.local.set({
    [STORAGE_KEYS.workspaceSettings]: settings,
  });
}

/** 保存用户授权的工作区目录句柄，并更新设置中的目录名和权限状态。 */
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

/** 从 IndexedDB 读取已保存的工作区目录句柄。 */
export async function loadWorkspaceDirectory(): Promise<StoredWorkspaceHandle | null> {
  try {
    return (await withHandleStore('readonly', (store) =>
      store.get(WORKSPACE_HANDLE_KEY),
    )) as StoredWorkspaceHandle | undefined || null;
  } catch {
    return null;
  }
}

/** 读取 Native 写入的工作区身份，用于证明插件和 Native 使用同一个目录。 */
export async function readWorkspaceIdentity(): Promise<string | null> {
  const workspace = await loadWorkspaceDirectory();
  if (!workspace?.handle) return null;
  const permission = await queryWorkspacePermission(workspace.handle);
  if (permission !== 'granted' && permission !== 'unsupported') return null;
  const raw = await readJsonFile(workspace.handle, WORKSPACE_IDENTITY_FILE_NAME);
  if (!raw || typeof raw !== 'object') return null;
  const identity = raw as Record<string, unknown>;
  return identity.version === 1 && typeof identity.workspaceId === 'string' && identity.workspaceId
    ? identity.workspaceId
    : null;
}

/** 清除已保存的工作区目录句柄和设置。 */
export async function clearWorkspaceDirectory() {
  await withHandleStore('readwrite', (store) => store.delete(WORKSPACE_HANDLE_KEY));
  await saveWorkspaceSettings(defaultWorkspaceSettings);
}

/** 查询工作区目录的写入权限状态。 */
export async function queryWorkspacePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const permissionHandle = handle as PermissionAwareDirectoryHandle;
  if (!permissionHandle.queryPermission) return 'unsupported';
  return permissionHandle.queryPermission({ mode: 'readwrite' });
}

/** 向用户请求工作区目录的写入权限。 */
export async function requestWorkspacePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const permissionHandle = handle as PermissionAwareDirectoryHandle;
  if (!permissionHandle.requestPermission) return 'unsupported';
  return permissionHandle.requestPermission({ mode: 'readwrite' });
}

export type WorkspaceRootInspection =
  | { kind: 'empty' }
  | { kind: 'existing'; projectSnapshotCount: number }
  | { kind: 'invalid'; reason: string };

/**
 * 在保存目录句柄前校验工作区根目录，防止把 dist/.output 等构建目录写成新工作区。
 * 新工作区只允许空目录；已有工作区必须完整符合 v2 根文件和项目清单结构。
 */
export async function inspectWorkspaceRoot(
  handle: FileSystemDirectoryHandle,
): Promise<WorkspaceRootInspection> {
  const entries = await listDirectoryEntries(handle);
  const meaningfulEntries = entries.filter(([name]) => name !== '.DS_Store');
  if (meaningfulEntries.length === 0) return { kind: 'empty' };

  const dataEntry = meaningfulEntries.find(([name]) => name === DATA_FILE_NAME)?.[1];
  const projectsEntry = meaningfulEntries.find(([name]) => name === 'projects')?.[1];
  if (dataEntry?.kind !== 'file' || projectsEntry?.kind !== 'directory') {
    return {
      kind: 'invalid',
      reason: `所选目录不是 PubFlow 工作区根目录：必须同时包含 ${DATA_FILE_NAME} 和 projects/。`,
    };
  }

  const rootData = await readJsonFile(handle, DATA_FILE_NAME);
  if (!rootData || typeof rootData !== 'object' || (rootData as Record<string, unknown>).version !== 2) {
    return { kind: 'invalid', reason: `${DATA_FILE_NAME} 不是有效的 v2 工作区数据。` };
  }

  const projectsDirectory = projectsEntry as FileSystemDirectoryHandle;
  let projectSnapshotCount = 0;
  const invalidDirectories: string[] = [];
  for (const [name, entry] of await listDirectoryEntries(projectsDirectory)) {
    if (entry.kind !== 'directory') continue;
    const manifest = await readProjectManifest(entry as FileSystemDirectoryHandle);
    if (!manifest) {
      invalidDirectories.push(name);
      continue;
    }
    if (!manifest.deletedAt) projectSnapshotCount += 1;
  }

  if (invalidDirectories.length > 0) {
    return {
      kind: 'invalid',
      reason: `工作区包含 ${invalidDirectories.length} 个无效项目目录，请先修复 project.json。`,
    };
  }

  return { kind: 'existing', projectSnapshotCount };
}

/** 读取目录的直接子项，统一封装 File System Access API 的异步迭代类型。 */
async function listDirectoryEntries(handle: FileSystemDirectoryHandle) {
  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const entry of (handle as unknown as {
    entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
  }).entries()) {
    entries.push(entry);
  }
  return entries;
}

/** 生成一个新的项目 ID，格式为 日期-随机串。 */
export function createProjectId() {
  return `${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`;
}

/** 根据项目 ID、标题和类型生成安全的项目文件夹名称。 */
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

/** 检查并请求工作区目录的读写权限。 */
async function ensureReadwritePermission(handle: FileSystemDirectoryHandle) {
  const current = await queryWorkspacePermission(handle);
  if (current === 'granted' || current === 'unsupported') return current;
  return requestWorkspacePermission(handle);
}

/** 在指定父目录下获取或创建子目录。 */
async function getOrCreateDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<FileSystemDirectoryHandle> {
  return parent.getDirectoryHandle(name, { create: true });
}

/** 在工作区目录下写入或覆盖一个文件。 */
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

export interface RemoteWorkspaceAsset {
  assetId: string;
  role: 'video' | 'cover' | 'music' | 'image';
  fileName: string;
  contentType?: string;
  size: number;
  sha256: string;
  downloadUrl: string;
}

/** 将云端 Project 流式物化到已授权工作区；project.json 最后写入作为提交标志。 */
export async function materializeRemoteProject(
  projectManifest: WorkspaceProjectManifest,
  assets: RemoteWorkspaceAsset[],
  apiBaseUrl: string,
) {
  if (projectManifest.version !== 2 || !projectManifest.id || projectManifest.id !== projectManifest.video?.projectId) {
    throw new Error('云端 Project 清单无效。');
  }
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) throw new Error('请先在 Dashboard 中选择本地工作区。');
  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') throw new Error('工作区没有写入权限，请重新授权。');
  const existing = await getProjectDirectoryById(projectManifest.id);
  if (existing && await readProjectManifest(existing)) return;

  const projectsDir = await getOrCreateDirectory(storedWorkspace.handle, 'projects');
  const projectName = createProjectFolderName(
    projectManifest.id,
    projectManifest.video.title,
    projectManifest.video.contentType,
  );
  const projectDir = existing || await getOrCreateDirectory(projectsDir, projectName);
  try {
    const assetsDir = await getOrCreateDirectory(projectDir, 'assets');
    const directories = {
      video: await getOrCreateDirectory(assetsDir, 'video'),
      cover: await getOrCreateDirectory(assetsDir, 'cover'),
      music: await getOrCreateDirectory(assetsDir, 'music'),
      image: await getOrCreateDirectory(assetsDir, 'images'),
    };
    for (const asset of assets) {
      await downloadRemoteAsset(directories[asset.role], asset, apiBaseUrl);
    }
    await writeFile(projectDir, 'project.json', JSON.stringify(projectManifest, null, 2));
    await mergeDataFile({
      projectIndex: [{
        projectId: projectManifest.id,
        path: `projects/${projectName}`,
        title: projectManifest.video.title,
        updatedAt: projectManifest.video.updatedAt || Date.now(),
      }],
    });
  } catch (error) {
    if (!existing) await projectsDir.removeEntry(projectName, { recursive: true }).catch(() => undefined);
    throw error;
  }
}

async function downloadRemoteAsset(
  directory: FileSystemDirectoryHandle,
  asset: RemoteWorkspaceAsset,
  apiBaseUrl: string,
) {
  const safeName = asset.fileName.replace(/[\\/:*?"<>|]+/g, '-').trim();
  if (!safeName || safeName !== asset.fileName || asset.size <= 0) throw new Error('云端素材描述无效。');
  const url = new URL(asset.downloadUrl, `${apiBaseUrl.replace(/\/+$/, '')}/`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`素材下载失败：${response.status}`);
  const digestPromise = response.clone().arrayBuffer().then((buffer) => crypto.subtle.digest('SHA-256', buffer));
  const fileHandle = await directory.getFileHandle(safeName, { create: true });
  const writable = await fileHandle.createWritable();
  const reader = response.body.getReader();
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > asset.size) throw new Error(`素材 ${safeName} 长度超过声明值。`);
      await writable.write(value);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
  const actualHash = [...new Uint8Array(await digestPromise)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (received !== asset.size || actualHash !== asset.sha256.toLowerCase()) {
    await directory.removeEntry(safeName).catch(() => undefined);
    throw new Error(`素材 ${safeName} 长度或 SHA-256 校验失败。`);
  }
}

/** 生成唯一的素材文件名，保留原始扩展名并清理非法字符。 */
function uniqueAssetName(file: File, prefix: string) {
  const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : '';
  const base = file.name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) || prefix;
  return `${prefix}-${Date.now()}-${base}${ext}`;
}

// 这里负责把“当前草稿”映射到工作区里的项目目录，不存在就创建。
/** 确保草稿对应的项目目录存在，返回项目相关的句柄和设置。 */
export async function ensureWorkspaceProject(draft: ContentDraft) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return null;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') throw new Error('工作区没有写入权限，请在设置里重新选择文件夹。');

  const projectsDir = await getOrCreateDirectory(storedWorkspace.handle, 'projects');
  const projectId = draft.projectId || createProjectId();
  const existingProjectDir = await getProjectDirectoryById(projectId);
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

/** 根据项目目录句柄反查目录名；找不到时按标题生成一个新名称。 */
async function getProjectDirectoryName(
  projectsDir: FileSystemDirectoryHandle,
  projectDir: FileSystemDirectoryHandle,
  projectId: string,
  title?: string,
) {
  for await (const [name, entry] of (projectsDir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
    if (entry.kind === 'directory' && entry === projectDir) return name;
    if (entry.kind !== 'directory') continue;
    const comparable = entry as FileSystemDirectoryHandle & {
      isSameEntry?: (other: FileSystemHandle) => Promise<boolean>;
    };
    if (comparable.isSameEntry && await comparable.isSameEntry(projectDir)) return name;
  }
  return createProjectFolderName(projectId, title);
}

/** 将素材文件导入到项目目录的 assets 子目录中。 */
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

/** 根据草稿的平台选择生成平台状态数组。 */
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

/** 将草稿转换为项目记录，projectId 是项目和作品的唯一身份。 */
export function videoRecordFromDraft(
  draft: ContentDraft,
  existing?: VideoRecord,
  options: { resetPlatformStatuses?: boolean } = {},
): VideoRecord {
  const now = Date.now();
  const projectId = draft.projectId || existing?.projectId || createProjectId();
  return {
    contentType: draft.contentType || existing?.contentType || (draft.imageCacheIds?.length ? 'image' : 'video'),
    id: projectId,
    title: draft.title.trim() || '未命名内容',
    description: draft.description.trim(),
    topics: parseTopics(draft.topicsText),
    campaignIds: [...(draft.selectedCampaignIds || [])],
    projectId,
    videoCacheId: draft.videoCacheId || '',
    coverCacheId: draft.coverCacheId || '',
    imageCacheIds: [...(draft.imageCacheIds || [])],
    videoFileName: draft.videoFileName || '',
    coverFileName: draft.coverFileName || '',
    musicFileName: draft.musicFileName || '',
    musicName: draft.musicName || '',
    imageFileNames: [...(draft.imageFileNames || [])],
    videoSize: draft.videoSize || 0,
    coverSize: draft.coverSize || 0,
    musicSize: draft.musicSize || 0,
    articleContent: draft.articleContent || existing?.articleContent || undefined,
    scheduledAt: normalizeScheduledAt(draft.scheduledAt),
    visibility: draft.visibility || 'public',
    originalDeclare: draft.originalDeclare ?? false,
    platformSettings: draft.platformSettings || existing?.platformSettings || {},
    platforms: draftToPlatformStatuses(
      draft,
      options.resetPlatformStatuses ? undefined : existing?.platforms,
    ),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

/** 按唯一 projectId 加载项目 manifest（含 articleContent）。 */
export async function loadProjectManifest(projectId: string): Promise<WorkspaceProjectManifest | null> {
  const projectDir = await getProjectDirectoryById(projectId);
  if (!projectDir) return null;
  return readProjectManifest(projectDir);
}

/** 将草稿的 manifest 写入项目目录，并更新全局项目索引。 */
export async function writeProjectManifest(draft: ContentDraft, persistArticleContent?: string) {
  const project = await ensureWorkspaceProject(draft);
  if (!project) return null;

  const existing = await readProjectManifest(project.projectDir);
  const video = videoRecordFromDraft(draft, existing?.video, {
    resetPlatformStatuses: Boolean(draft.replicaSourceProjectId),
  });
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

/** 读取目录下指定 JSON 文件的内容，失败返回 null。 */
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

/** 加载工作区中所有有效项目 manifest，并异步清理已软删除的残留目录。 */
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

    return projects.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  } catch {
    return [];
  }
}

/** 清理已软删除但物理目录仍存在的项目文件夹。 */
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

/** 严格根据 project.json 的 id 查找项目目录。 */
async function getProjectDirectoryById(projectId: string) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle || !projectId) return null;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return null;

  try {
    const projectsDir = await storedWorkspace.handle.getDirectoryHandle('projects');
    let match: { directory: FileSystemDirectoryHandle; updatedAt: number } | null = null;
    for await (const [, entry] of (projectsDir as unknown as { entries: () => AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      if (entry.kind !== 'directory') continue;
      const directory = entry as FileSystemDirectoryHandle;
      const manifest = await readProjectManifest(directory);
      if (!manifest || manifest.deletedAt || manifest.id !== projectId) continue;
      const updatedAt = Date.parse(manifest.updatedAt) || 0;
      if (!match || updatedAt > match.updatedAt) match = { directory, updatedAt };
    }
    return match?.directory || null;
  } catch {
    return null;
  }

  return null;
}

/** 校验标准 project.json，并统一使用 manifest.id 作为项目全链路身份。 */
export function normalizeProjectManifest(raw: unknown): WorkspaceProjectManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const manifest = raw as Partial<WorkspaceProjectManifest>;
  const projectId = typeof manifest.id === 'string' ? manifest.id.trim() : '';
  if (manifest.version !== 2 || !projectId || !manifest.video) return null;
  const articleContent =
    typeof manifest.articleContent === 'string'
      ? manifest.articleContent
      : typeof manifest.video.articleContent === 'string'
        ? manifest.video.articleContent
        : undefined;
  return {
    version: 2,
    id: projectId,
    updatedAt: manifest.updatedAt || new Date(manifest.video.updatedAt || Date.now()).toISOString(),
    deletedAt: typeof manifest.deletedAt === 'number' ? manifest.deletedAt : null,
    video: {
      ...manifest.video,
      id: projectId,
      projectId,
      topics: Array.isArray(manifest.video.topics) ? manifest.video.topics : [],
      campaignIds: Array.isArray(manifest.video.campaignIds) ? manifest.video.campaignIds : [],
      imageFileNames: Array.isArray(manifest.video.imageFileNames) ? manifest.video.imageFileNames : [],
      platforms: Array.isArray(manifest.video.platforms) ? manifest.video.platforms : [],
      articleContent,
    },
    records: Array.isArray(manifest.records)
      ? manifest.records.map((record) => ({
        ...record,
        id: `${projectId}:${record.platformId}`,
        videoId: projectId,
      }))
      : [],
    articleContent,
  };
}

/** 读取项目目录中的标准 project.json。 */
export async function readProjectManifest(
  projectDir: FileSystemDirectoryHandle,
): Promise<WorkspaceProjectManifest | null> {
  return normalizeProjectManifest(await readJsonFile(projectDir, 'project.json'));
}

/** 用视频和发布记录构造标准化的项目 manifest 对象。 */
export function createProjectManifest(input: {
  video: VideoRecord;
  records?: PublishRecord[];
  articleContent?: string;
}): WorkspaceProjectManifest {
  const projectId = input.video.projectId?.trim();
  if (!projectId) throw new Error('项目缺少 projectId，无法写入工作区。');
  const manifest: WorkspaceProjectManifest = {
    version: 2,
    id: projectId,
    updatedAt: new Date(input.video.updatedAt || Date.now()).toISOString(),
    deletedAt: null,
    video: {
      ...input.video,
      id: projectId,
      projectId,
    },
    records: (input.records || []).map((record) => ({
      ...record,
      id: `${projectId}:${record.platformId}`,
      videoId: projectId,
    })),
  };
  if (typeof input.articleContent === 'string') {
    manifest.articleContent = input.articleContent;
  }
  return manifest;
}

/** 将视频记录和发布记录写入对应的项目目录，不存在项目则创建。 */
export async function writeProjectData(video: VideoRecord, records: PublishRecord[] = []) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return false;

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return false;

  const projectId = video.projectId?.trim();
  if (!projectId) return false;
  const projectsDir = await getOrCreateDirectory(storedWorkspace.handle, 'projects');
  const existingProjectDir = await getProjectDirectoryById(projectId);
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

/** 递归复制目录内容。 */
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

/** 在项目索引中标记项目已删除。 */
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

/** 在项目 manifest 中写入 deletedAt 时间戳，实现软删除标记。 */
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

/** 删除项目数据：先移动到 Trash，再标记软删除，并尝试移除原目录。 */
export async function deleteProjectData(video: Pick<VideoRecord, 'projectId' | 'title'>) {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) return { ok: false, reason: 'no-workspace' as const };

  const permission = await ensureReadwritePermission(storedWorkspace.handle);
  if (permission === 'denied') return { ok: false, reason: 'permission-denied' as const };

  const projectId = video.projectId?.trim();
  if (!projectId) return { ok: false, reason: 'missing-project-id' as const };
  const deletedAt = Date.now();

  try {
    const projectsDir = await storedWorkspace.handle.getDirectoryHandle('projects');
    const projectDir = await getProjectDirectoryById(projectId);
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

/** 尝试读取项目 assets 子目录下的单个素材文件。 */
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

/** 从工作区加载项目相关的视频、封面、音乐和图文素材文件。 */
export async function loadProjectAssetFiles(params: {
  projectId?: string;
  videoFileName?: string;
  coverFileName?: string;
  musicFileName?: string;
  imageFileNames?: string[];
}) {
  // “继续/编辑” 会走这里，把工作区里的素材重新恢复成 File 对象。
  const projectDir = await getProjectDirectoryById(params.projectId || '');
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
    licensingSettings?: Record<string, unknown>;
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

const REDACTED_SECRET = '';

/** 从设置中移除 API 密钥等敏感信息，避免写入工作区数据文件时泄露。 */
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
    licensingSettings: redactLicensingSettings(settings.licensingSettings),
    aiSettings,
  };
}

function redactLicensingSettings(settings: Record<string, unknown> | undefined) {
  if (!settings) return settings;
  return {
    ...settings,
    activationCode: REDACTED_SECRET,
    clientInstallId: REDACTED_SECRET,
    machineHash: REDACTED_SECRET,
    leaseToken: REDACTED_SECRET,
  };
}

let cachedHandle: FileSystemDirectoryHandle | null = null;

/** 获取当前可用的工作区目录句柄，会检查并缓存权限状态。 */
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
    settings: { platformSettings: {}, globalSettings: {}, serverConfig: {}, licensingSettings: {}, aiSettings: {} },
    projectIndex: [],
  } satisfies PubFlowDataFile;

  const projectIndex = [...existing.projectIndex];
  for (const incoming of partial.projectIndex || []) {
    const index = projectIndex.findIndex((item) => item.path === incoming.path);
    if (index >= 0) projectIndex[index] = { ...projectIndex[index], ...incoming };
    else projectIndex.push(incoming);
  }

  await writeDataFile({
    draft: partial.draft ?? existing.draft,
    settings: partial.settings ?? existing.settings,
    projectIndex: projectIndex.sort((a, b) => b.updatedAt - a.updatedAt),
  });
}
