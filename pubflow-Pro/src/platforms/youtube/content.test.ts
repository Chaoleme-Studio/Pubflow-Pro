import { describe, expect, it } from 'vitest';
import { isYouTubeShortsThumbnailFlow, resolveYouTubeVisibilityPlan } from './content';

describe('resolveYouTubeVisibilityPlan', () => {
  it('定时发布计划使用安排时间容器', () => {
    const scheduledAt = new Date(2026, 6, 27, 22, 17).getTime();
    expect(resolveYouTubeVisibilityPlan({ scheduledAt, visibility: 'private' })).toEqual({
      container: 'second',
      scheduledAt,
    });
  });

  it('非定时发布继续使用保存或发布容器的公开范围', () => {
    expect(resolveYouTubeVisibilityPlan({ scheduledAt: 0, visibility: 'public' })).toEqual({
      container: 'first',
      visibilityName: 'PUBLIC',
    });
    expect(resolveYouTubeVisibilityPlan({ scheduledAt: 0, visibility: 'friends' })).toEqual({
      container: 'first',
      visibilityName: 'UNLISTED',
    });
    expect(resolveYouTubeVisibilityPlan({ scheduledAt: 0, visibility: 'private' })).toEqual({
      container: 'first',
      visibilityName: 'PRIVATE',
    });
  });
});

describe('isYouTubeShortsThumbnailFlow', () => {
  it('识别 Shorts 只能在移动端从视频选取缩略图的页面', () => {
    expect(isYouTubeShortsThumbnailFlow('你可以在移动版 YouTube 应用中更改缩略图')).toBe(true);
    expect(isYouTubeShortsThumbnailFlow('Select a frame for the thumbnail in the YouTube mobile app')).toBe(true);
  });

  it('不把长视频的自定义缩略图上传区域判定为 Shorts', () => {
    expect(isYouTubeShortsThumbnailFlow('缩略图 上传缩略图')).toBe(false);
  });
});
