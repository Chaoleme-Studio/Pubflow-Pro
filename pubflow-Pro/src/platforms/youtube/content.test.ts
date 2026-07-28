import { describe, expect, it } from 'vitest';
import { resolveYouTubeVisibilityPlan } from './content';

describe('resolveYouTubeVisibilityPlan', () => {
  it('定时发布只选择安排时间容器，不再同时点击公开范围', () => {
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
