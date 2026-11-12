import { getPlatformConfig, supportsContentType } from '../../platforms';
import type { DistributionPermit } from '../../licensing/permitManager';
import type { ContentData, DistributionTask, PlatformId } from '../../types';

export interface DistributionStartRequest {
  content: ContentData;
  platforms: PlatformId[];
  videoId?: string;
  source?: 'dashboard' | 'agent';
  externalTaskSource?: 'native' | 'cloud';
  externalJobId?: string;
  projectId?: string;
  statusSequence?: number;
  autoSubmit?: boolean;
}

interface DistributionCoordinatorDependencies {
  getCurrentTask: () => DistributionTask | null;
  authorize: (
    content: ContentData,
    platforms: PlatformId[],
    videoId?: string,
  ) => Promise<Pick<DistributionPermit, 'permitId'>>;
  setCurrentTask: (task: DistributionTask) => void;
  persist: () => Promise<void>;
  openPlatform: (platformId: PlatformId) => Promise<void>;
  clearTimers: () => void;
}

/** Dashboard 和本地 Agent 共用的唯一发布启动协调器。 */
export async function startDistribution(
  request: DistributionStartRequest,
  dependencies: DistributionCoordinatorDependencies,
): Promise<DistributionTask> {
  const active = dependencies.getCurrentTask();
  if (
    active
    && (active.status === 'running' || active.status === 'paused')
    && active.platforms.some((item) => !isTerminalStatus(item.status))
  ) {
    throw new Error('已有分发任务正在进行，请等待完成或跳过当前任务后再开始下一条。');
  }

  dependencies.clearTimers();
  const contentType = request.content.contentType || 'video';
  validateDistributionContent(request.content);
  const supportedPlatforms = [...new Set(request.platforms)].filter((platformId) =>
    supportsContentType(getPlatformConfig(platformId), contentType),
  );
  if (!supportedPlatforms.length) {
    throw new Error('当前内容类型没有可发布的平台，请检查目标平台选择。');
  }

  const permit = await dependencies.authorize(request.content, supportedPlatforms, request.videoId);
  const task: DistributionTask = {
    id: crypto.randomUUID(),
    videoId: request.videoId,
    content: request.content,
    platforms: supportedPlatforms.map((platformId) => ({ platformId, status: 'pending' })),
    currentIndex: 0,
    status: 'running',
    createdAt: Date.now(),
    permitId: permit.permitId,
    autoSubmit: request.autoSubmit === true,
    source: request.source || 'dashboard',
    externalTaskSource: request.externalTaskSource,
    externalJobId: request.externalJobId,
    projectId: request.projectId || request.content.projectId,
    statusSequence: request.externalJobId ? (request.statusSequence || 1) : undefined,
  };
  dependencies.setCurrentTask(task);
  await dependencies.persist();
  if (task.platforms[0]) await dependencies.openPlatform(task.platforms[0].platformId);
  return task;
}

/** 阻止缺少实际媒体缓存的任务进入平台页，避免只填文案/排期却没有上传素材。 */
export function validateDistributionContent(content: ContentData) {
  const contentType = content.contentType || 'video';
  if (contentType === 'video' && !content.videoCacheId) {
    throw new Error('视频任务缺少已缓存的视频素材，请重新选择视频并等待缓存完成后再开始分发。');
  }
  if (contentType === 'image' && !content.imageCacheIds?.length) {
    throw new Error('图文任务缺少已缓存的图片素材，请重新选择图片后再开始分发。');
  }
}

/** 结束当前任务并返回由任务创建、可以安全关闭的平台标签页。 */
export function stopDistributionTask(task: DistributionTask) {
  const tabIds = [...new Set(task.platforms.flatMap((platform) => platform.tabId ? [platform.tabId] : []))];
  for (const platform of task.platforms) {
    if (!['filled', 'published', 'skipped', 'error'].includes(platform.status)) {
      platform.status = 'skipped';
      platform.message = '用户已结束当前任务';
      platform.error = undefined;
    }
  }
  task.status = 'completed';
  task.error = undefined;
  return tabIds;
}

function isTerminalStatus(status: DistributionTask['platforms'][number]['status']) {
  return status === 'published' || status === 'skipped' || status === 'error';
}
