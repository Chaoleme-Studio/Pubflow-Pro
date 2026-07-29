import { describe, expect, it } from 'vitest';
import type { PlatformId } from '../types';
import {
  getFinalPublishButtonSpec,
  getVerifiedFinalPublishButtonSpec,
  resolveXiaohongshuSubmitOffset,
  supportsDirectPublish,
} from './finalPublisher';

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

  it('五个严格校验平台只匹配真实最终按钮，不包含易误选的通用候选', () => {
    expect(getVerifiedFinalPublishButtonSpec('xiaohongshu')).toEqual({
      selector: 'xhs-publish-btn[is-publish="true"]',
      texts: [],
    });
    expect(getFinalPublishButtonSpec('weixinChannels')).toEqual({
      selector: 'button.weui-desktop-btn_primary',
      texts: ['发表'],
    });
    expect(getFinalPublishButtonSpec('bilibili')).toEqual({
      selector: '.submit-add',
      texts: ['立即投稿'],
    });
    expect(getFinalPublishButtonSpec('x')).toEqual({
      selector: '[data-testid="tweetButton"]',
      texts: ['发帖', '预排期', '安排', 'Post', 'Schedule'],
    });
    expect(getFinalPublishButtonSpec('youtube')).toEqual({
      selector: 'ytcp-button#done-button button, #done-button > button, button#done-button',
      texts: ['发布', '保存', '预定', 'Publish', 'Save', 'Schedule'],
    });
    expect(getVerifiedFinalPublishButtonSpec('douyin')).toBeUndefined();
  });
});
