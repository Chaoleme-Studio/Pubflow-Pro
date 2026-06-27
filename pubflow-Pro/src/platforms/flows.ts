import type { ContentData } from '../types';
import type { PlatformId } from '../types';
import type { PlatformConfig } from './types';
import { fillBilibiliContent } from './bilibili/content';
import { fillDouyinContent } from './douyin/content';
import { fillKuaishouContent } from './kuaishou/content';
import { fillWeiboContent } from './weibo/content';
import { fillWeixinChannelsContent } from './weixinChannels/content';
import { fillXiaohongshuContent } from './xiaohongshu/content';
import { fillXiguaContent } from './xigua/content';
import { fillZhihuContent } from './zhihu/content';

export type PlatformContentHandler = (
  config: PlatformConfig,
  content: ContentData,
  isArticle?: boolean,
) => Promise<string>;

export const PLATFORM_CONTENT_HANDLERS: Record<PlatformId, PlatformContentHandler> = {
  douyin: fillDouyinContent,
  xiaohongshu: fillXiaohongshuContent,
  weixinChannels: fillWeixinChannelsContent,
  bilibili: fillBilibiliContent,
  kuaishou: fillKuaishouContent,
  weibo: fillWeiboContent,
  zhihu: fillZhihuContent,
  xigua: fillXiguaContent,
};

/** 根据平台 ID 获取对应的内容填充处理函数。 */
export function getPlatformContentHandler(platformId: PlatformId) {
  return PLATFORM_CONTENT_HANDLERS[platformId];
}
