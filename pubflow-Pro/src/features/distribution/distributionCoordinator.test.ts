import { describe, expect, it, vi } from 'vitest';
import type { ContentData, DistributionTask, PlatformId } from '../../types';
import { startDistribution, stopDistributionTask } from './distributionCoordinator';

function content(overrides: Partial<ContentData> = {}): ContentData {
  return {
    contentType: 'video',
    title: '直接发布测试',
    description: '测试描述',
    topics: [],
    campaignIds: [],
    videoCacheId: 'video-cache-1',
    videoFileName: 'video.mp4',
    ...overrides,
  };
}

describe('distributionCoordinator direct publish', () => {
  it('把 Dashboard 的直接发布选择固化到运行任务', async () => {
    let currentTask: DistributionTask | null = null;
    const opened: PlatformId[] = [];
    const persist = vi.fn(async () => undefined);

    const task = await startDistribution({
      content: content(),
      platforms: ['douyin'],
      videoId: 'video-1',
      autoSubmit: true,
    }, {
      getCurrentTask: () => currentTask,
      authorize: async () => ({ permitId: 'permit-1' }),
      setCurrentTask: (next) => {
        currentTask = next;
      },
      persist,
      openPlatform: async (platformId) => {
        opened.push(platformId);
      },
      clearTimers: vi.fn(),
    });

    expect(task.autoSubmit).toBe(true);
    expect(currentTask).toBe(task);
    expect(opened).toEqual(['douyin']);
    expect(persist).toHaveBeenCalledOnce();
  });

  it('未选择时明确保持人工确认模式', async () => {
    let currentTask: DistributionTask | null = null;
    const task = await startDistribution({
      content: content(),
      platforms: ['weibo'],
    }, {
      getCurrentTask: () => currentTask,
      authorize: async () => ({ permitId: 'permit-2' }),
      setCurrentTask: (next) => {
        currentTask = next;
      },
      persist: async () => undefined,
      openPlatform: async () => undefined,
      clearTimers: vi.fn(),
    });

    expect(task.autoSubmit).toBe(false);
  });

  it('视频缓存为空时在打开任何平台前拒绝启动', async () => {
    const openPlatform = vi.fn(async () => undefined);
    const authorize = vi.fn(async () => ({ permitId: 'permit-3' }));

    await expect(startDistribution({
      content: content({ videoCacheId: '', videoFileName: '' }),
      platforms: ['x', 'youtube'],
    }, {
      getCurrentTask: () => null,
      authorize,
      setCurrentTask: vi.fn(),
      persist: vi.fn(async () => undefined),
      openPlatform,
      clearTimers: vi.fn(),
    })).rejects.toThrow('视频任务缺少已缓存的视频素材');

    expect(authorize).not.toHaveBeenCalled();
    expect(openPlatform).not.toHaveBeenCalled();
  });

  it('在授权和打开页面前过滤当前内容类型不支持的平台', async () => {
    let currentTask: DistributionTask | null = null;
    const authorize = vi.fn(async () => ({ permitId: 'permit-article' }));
    const openPlatform = vi.fn(async () => undefined);

    const task = await startDistribution({
      content: content({
        contentType: 'article',
        videoCacheId: undefined,
        videoFileName: undefined,
        articleContent: '文章正文',
      }),
      platforms: ['x', 'bilibili', 'youtube', 'bilibili'],
    }, {
      getCurrentTask: () => currentTask,
      authorize,
      setCurrentTask: (next) => {
        currentTask = next;
      },
      persist: vi.fn(async () => undefined),
      openPlatform,
      clearTimers: vi.fn(),
    });

    expect(task.platforms.map((platform) => platform.platformId)).toEqual(['bilibili']);
    expect(authorize).toHaveBeenCalledWith(task.content, ['bilibili'], undefined);
    expect(openPlatform).toHaveBeenCalledWith('bilibili');
  });

  it('结束全部会终止未完成平台并返回任务创建的标签页', () => {
    const task: DistributionTask = {
      id: 'task-stop',
      content: content(),
      currentIndex: 1,
      status: 'paused',
      createdAt: Date.now(),
      platforms: [
        { platformId: 'x', status: 'filled', tabId: 10 },
        { platformId: 'youtube', status: 'filling', tabId: 11 },
        { platformId: 'kuaishou', status: 'pending' },
      ],
    };

    expect(stopDistributionTask(task)).toEqual([10, 11]);
    expect(task.status).toBe('completed');
    expect(task.platforms.map((platform) => platform.status)).toEqual(['filled', 'skipped', 'skipped']);
    expect(task.platforms[1].message).toBe('用户已结束当前任务');
  });
});
