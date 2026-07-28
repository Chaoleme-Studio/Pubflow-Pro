import { storeFileForTransfer, storeVideoForTransfer } from '../../storage/videoTransferStorage';
import {
  loadProjectAssetFiles,
  loadProjectManifest,
  loadWorkspaceDirectory,
  queryWorkspacePermission,
} from '../../storage/workspaceStorage';
import type { ContentData, PlatformId } from '../../types';

export class ProjectTaskAssemblyError extends Error {
  constructor(
    readonly code: 'NEEDS_WORKSPACE_PERMISSION' | 'PROJECT_NOT_FOUND' | 'ASSET_NOT_FOUND',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectTaskAssemblyError';
  }
}

/** 无 UI 地从标准 Project 恢复发布内容，并把本地媒体装入现有 transfer cache。 */
export async function assembleProjectTask(
  projectId: string,
  requestedPlatforms: PlatformId[],
): Promise<{ content: ContentData; platforms: PlatformId[]; videoId: string }> {
  const workspace = await loadWorkspaceDirectory();
  if (!workspace?.handle) {
    throw new ProjectTaskAssemblyError(
      'NEEDS_WORKSPACE_PERMISSION',
      '插件尚未选择本地工作区，请先在 Dashboard 中选择 Agent 使用的同一个工作区。',
    );
  }
  const permission = await queryWorkspacePermission(workspace.handle);
  if (permission !== 'granted' && permission !== 'unsupported') {
    throw new ProjectTaskAssemblyError(
      'NEEDS_WORKSPACE_PERMISSION',
      '插件的工作区权限已失效，请打开 Dashboard 重新授权。',
    );
  }

  const manifest = await loadProjectManifest(projectId);
  if (!manifest) {
    throw new ProjectTaskAssemblyError(
      'PROJECT_NOT_FOUND',
      `在插件工作区中找不到 Agent 创建的 Project：${projectId}`,
    );
  }
  const video = manifest.video;
  const contentType = video.contentType || (video.imageFileNames?.length ? 'image' : 'video');
  const assets = await loadProjectAssetFiles({
    projectId,
    videoFileName: video.videoFileName,
    coverFileName: video.coverFileName,
    musicFileName: video.musicFileName,
    imageFileNames: video.imageFileNames,
  });

  if (contentType === 'video' && !assets.videoFile) {
    throw new ProjectTaskAssemblyError('ASSET_NOT_FOUND', `Project ${projectId} 缺少视频素材。`);
  }
  if (contentType === 'image' && !assets.imageFiles.length) {
    throw new ProjectTaskAssemblyError('ASSET_NOT_FOUND', `Project ${projectId} 缺少图文图片素材。`);
  }

  const videoCacheId = assets.videoFile
    ? (await storeVideoForTransfer(assets.videoFile)).id
    : '';
  const coverCacheId = assets.coverFile
    ? (await storeFileForTransfer(assets.coverFile)).id
    : '';
  const imageCacheIds: string[] = [];
  for (const image of assets.imageFiles) {
    imageCacheIds.push((await storeFileForTransfer(image)).id);
  }

  return {
    videoId: projectId,
    platforms: [...new Set(requestedPlatforms)],
    content: {
      contentType,
      title: video.title,
      description: video.description,
      articleContent: manifest.articleContent ?? video.articleContent,
      topics: [...(video.topics || [])],
      campaignIds: [...(video.campaignIds || [])],
      projectId,
      videoCacheId,
      coverCacheId,
      imageCacheIds,
      videoFileName: assets.videoFile?.name || video.videoFileName || '',
      coverFileName: assets.coverFile?.name || video.coverFileName || '',
      musicFileName: assets.musicFile?.name || video.musicFileName || '',
      musicName: video.musicName || assets.musicFile?.name || '',
      imageFileNames: assets.imageFiles.map((file) => file.name),
      videoSize: assets.videoFile?.size || 0,
      coverSize: assets.coverFile?.size || 0,
      musicSize: assets.musicFile?.size || 0,
      scheduledAt: video.scheduledAt,
      visibility: video.visibility || 'public',
      originalDeclare: video.originalDeclare ?? false,
      platformSettings: video.platformSettings || {},
      fillOptions: video.fillOptions,
    },
  };
}
