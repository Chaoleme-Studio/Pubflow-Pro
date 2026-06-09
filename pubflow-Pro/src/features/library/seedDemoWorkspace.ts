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

async function fileExists(directory: FileSystemDirectoryHandle, fileName: string) {
  try {
    await directory.getFileHandle(fileName);
    return true;
  } catch {
    return false;
  }
}

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

async function fetchPackagedCover(fileName: string) {
  const response = await fetch(`/covers/${fileName}`);
  if (!response.ok) throw new Error(`读取样例封面失败：${fileName}`);
  return response.blob();
}

function createSeedVideos() {
  return createDemoVideos().map((video) => ({
    ...video,
    projectId: video.id,
  }));
}

function isDemoWorkspaceVideo(video: VideoRecord) {
  return !!video.coverFileName && PACKAGED_DEMO_COVER_FILE_NAMES.has(video.coverFileName);
}

function normalizeProjectVideo(video: VideoRecord): VideoRecord {
  return {
    ...video,
    projectId: video.projectId || video.id,
  };
}

function upsertById<T extends { id: string }>(existing: T[], seeded: T[]) {
  const seededIds = new Set(seeded.map((item) => item.id));
  return [
    ...existing.filter((item) => !seededIds.has(item.id)),
    ...seeded,
  ];
}

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
    const projectId = video.projectId || video.id;
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
