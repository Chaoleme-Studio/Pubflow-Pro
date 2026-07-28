import { describe, expect, it } from 'vitest';
import type { PlatformId } from '../types';
import { resolveXiaohongshuSubmitOffset, supportsDirectPublish } from './finalPublisher';

describe('finalPublisher', () => {
  it('只对已核对最终按钮的九个平台启用直接发布', () => {
    const supported: PlatformId[] = [
      'douyin',
      'xiaohongshu',
      'weixinChannels',
      'bilibili',
      'kuaishou',
      'weibo',
      'zhihu',
      'x',
      'youtube',
    ];
    const unsupported: PlatformId[] = ['xigua'];

    expect(supported.every(supportsDirectPublish)).toBe(true);
    expect(unsupported.some(supportsDirectPublish)).toBe(false);
  });

  it('计算小红书 closed Shadow DOM 内第二个按钮的中心', () => {
    expect(resolveXiaohongshuSubmitOffset(680, 90, true)).toEqual({ x: 412, y: 45 });
    expect(resolveXiaohongshuSubmitOffset(680, 90, false)).toEqual({ x: 340, y: 45 });
  });
});
