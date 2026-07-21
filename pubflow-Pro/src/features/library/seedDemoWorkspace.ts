import { createProjectFolderName, createProjectManifest, loadAllWorkspaceProjects, loadWorkspaceDirectory, queryWorkspacePermission, requestWorkspacePermission } from '../../storage/workspaceStorage';
import type { PublishRecord, VideoRecord } from '../../types';
import { createDemoRecords, createDemoVideos } from './demoLibraryData';

const PACKAGED_DEMO_COVER_FILE_NAMES = new Set([
  'demo-ai.svg',
  'demo-book.svg',
  'demo-code.svg',
  'demo-cook.svg',
  'demo-excel.svg',
  'demo-fitness.svg',
  'demo-photo.svg',
  'demo-travel.svg',
]);

export interface SeedDemoWorkspaceResult {
  videos: VideoRecord[];
  records: PublishRecord[];
  projectCount: number;
  createdProjects: number;
  skippedProjects: number;
  copiedCovers: number;
}

/** 获取或创建子目录，返回目录句柄及是否已存在 */
async function getOrCreateDirectory(
  parent: FileSystemDirectoryHandle,
  name: string,
): Promise<{ handle: FileSystemDirectoryHandle; existed: boolean }> {
  try {
    return { handle: await parent.getDirectoryHandle(name), existed: true };
  } catch {
    return { handle: await parent.getDirectoryHandle(name, { create: true }), existed: false };
  }
}

/** 检查目录中指定文件是否存在 */
async function fileExists(directory: FileSystemDirectoryHandle, fileName: string) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

/** 若文件不存在则写入数据，返回是否写入成功 */
async function writeFileIfMissing(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: Blob | string,
) {
  if (await fileExists(directory, fileName)) return false;
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
  return true;
}

/** 向目录中写入文件（覆盖已有文件） */
async function writeFile(
  directory: FileSystemDirectoryHandle,
  fileName: string,
  data: Blob | string,
) {
  const fileHandle = await directory.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** 从打包资源中读取样例封面图片 */
async function fetchPackagedCover(fileName: string) {
  const response = await fetch(`/covers/${fileName}`);
  if (!response.ok) throw new Error(`读取样例封面失败：${fileName}`);
  return response.blob();
}

/** 创建种子视频数据，将视频 ID 同时设为项目 ID */
function createSeedVideos() {
  return createDemoVideos().map((video) => ({
    ...video,
    projectId: video.id,
  }));
}

/** 判断视频是否为演示工作区视频（使用打包封面） */
function isDemoWorkspaceVideo(video: VideoRecord) {
  return !!video.coverFileName && PACKAGED_DEMO_COVER_FILE_NAMES.has(video.coverFileName);
}

/** 将演示视频身份统一到 projectId。 */
function normalizeProjectVideo(video: VideoRecord): VideoRecord {
  const projectId = video.projectId;
  return {
    ...video,
    id: projectId,
    projectId,
  };
}

/** 按 ID 合并已有数据与种子数据，种子数据优先覆盖 */
function upsertById<T extends { id: string }>(existing: T[], seeded: T[]) {
  const seededIds = new Set(seeded.map((item) => item.id));
  return [
    ...existing.filter((item) => !seededIds.has(item.id)),
    ...seeded,
  ];
}

/** 将演示数据种子写入工作区，自动复制打包封面并生成项目目录。 */
export async function seedDemoWorkspace(): Promise<SeedDemoWorkspaceResult> {
  const storedWorkspace = await loadWorkspaceDirectory();
  if (!storedWorkspace?.handle) throw new Error('请先选择工作区文件夹。');

  const currentPermission = await queryWorkspacePermission(storedWorkspace.handle);
  const permission = currentPermission === 'granted' || currentPermission === 'unsupported'
    ? currentPermission
    : await requestWorkspacePermission(storedWorkspace.handle);
  if (permission === 'denied') throw new Error('工作区没有写入权限，请重新选择或授权文件夹。');

  const projectsDir = (await getOrCreateDirectory(storedWorkspace.handle, 'projects')).handle;
  const existingProjects = await loadAllWorkspaceProjects();
  const existingVideos = existingProjects.map((project) => project.video).map(normalizeProjectVideo);
  const existingRecords = existingProjects.flatMap((project) => project.records || []);
  const baseSeedVideos = createSeedVideos();
  const baseSeedRecords = createDemoRecords(baseSeedVideos);
  const videos = upsertById(existingVideos, baseSeedVideos)
    .map(normalizeProjectVideo)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const records = upsertById(existingRecords, baseSeedRecords)
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0));
  const demoProjectVideos = videos.filter(isDemoWorkspaceVideo);
  let createdProjects = 0;
  let skippedProjects = 0;
  let copiedCovers = 0;

  for (const video of demoProjectVideos) {
    const projectId = video.projectId;
    if (!projectId) continue;
    const projectName = createProjectFolderName(projectId, video.title, video.contentType);
    const projectResult = await getOrCreateDirectory(projectsDir, projectName);
    if (projectResult.existed) skippedProjects += 1;
    else createdProjects += 1;

    const assetsDir = (await getOrCreateDirectory(projectResult.handle, 'assets')).handle;
    const coverDir = (await getOrCreateDirectory(assetsDir, 'cover')).handle;
    await getOrCreateDirectory(assetsDir, 'video');
    await getOrCreateDirectory(assetsDir, 'music');
    await getOrCreateDirectory(assetsDir, 'images');

    if (video.coverFileName) {
      const cover = await fetchPackagedCover(video.coverFileName);
      if (await writeFileIfMissing(coverDir, video.coverFileName, cover)) copiedCovers += 1;
    }

    await writeFile(
      projectResult.handle,
      'project.json',
      JSON.stringify(
        createProjectManifest({
          video,
          records: records.filter((record) => record.videoId === video.id),
        }),
        null,
        2,
      ),
    );
  }

  return {
    videos,
    records,
    projectCount: demoProjectVideos.length,
    createdProjects,
    skippedProjects,
    copiedCovers,
  };
}
