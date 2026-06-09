import type { PlatformId } from '../types';
import { bilibiliSelectorConfig } from './bilibili/selectors';
import { douyinSelectorConfig } from './douyin/selectors';
import { kuaishouSelectorConfig } from './kuaishou/selectors';
import { commonBlockers, buildPlatformConfig } from './shared';
import { weiboSelectorConfig } from './weibo/selectors';
import { weixinChannelsSelectorConfig } from './weixinChannels/selectors';
import { xiaohongshuSelectorConfig } from './xiaohongshu/selectors';
import { xiguaSelectorConfig } from './xigua/selectors';
import { zhihuSelectorConfig } from './zhihu/selectors';
import type { CategorySelectorConfig, DeclarationSelectorConfig, PlatformConfig, PlatformSelectorConfig } from './types';

// 所有平台入口统一在这里聚合，新增平台时只需要补一组 selectors/campaigns。
export const PLATFORM_SELECTOR_CONFIGS = {
  抖音: douyinSelectorConfig,
  小红书: xiaohongshuSelectorConfig,
  视频号: weixinChannelsSelectorConfig,
  B站: bilibiliSelectorConfig,
  快手: kuaishouSelectorConfig,
  微博: weiboSelectorConfig,
  知乎: zhihuSelectorConfig,
  西瓜视频: xiguaSelectorConfig,
} satisfies Record<string, PlatformSelectorConfig>;

export const PLATFORM_SELECTOR_CONFIGS_BY_ID: Record<PlatformId, PlatformSelectorConfig> =
  Object.fromEntries(
    Object.values(PLATFORM_SELECTOR_CONFIGS).map((config) => [config.平台标识, config]),
  ) as Record<PlatformId, PlatformSelectorConfig>;

export const PLATFORM_CONFIGS: Record<PlatformId, PlatformConfig> = Object.fromEntries(
  Object.entries(PLATFORM_SELECTOR_CONFIGS_BY_ID).map(([id, config]) => [id, buildPlatformConfig(config)]),
) as Record<PlatformId, PlatformConfig>;

// active=false 的平台不会进入 UI、权限和内容脚本匹配范围。
const activeSelectorConfigs = Object.values(PLATFORM_SELECTOR_CONFIGS_BY_ID).filter(
  (config) => config.启用 !== false,
);

export const PLATFORM_ORDER: PlatformId[] = activeSelectorConfigs.map((config) => config.平台标识);

export const PLATFORM_MATCH_PATTERNS = activeSelectorConfigs.flatMap((config) =>
  config.匹配域名.map((host) => `https://${host}/*`),
);

export function getPlatformByUrl(url: string): PlatformConfig | undefined {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return undefined;
  }

  return Object.values(PLATFORM_CONFIGS).find((platform) =>
    platform.matchHosts.some((matchHost) => host === matchHost || host.endsWith(`.${matchHost}`)),
  );
}

function isPlatformPageUrl(url: string, getTargetUrl: (platform: PlatformConfig) => string | undefined): boolean {
  try {
    const current = new URL(url);
    return Object.values(PLATFORM_CONFIGS).some((platform) => {
      const targetUrl = getTargetUrl(platform);
      if (!targetUrl) return false;
      if (
        !platform.matchHosts.some((matchHost) => current.host === matchHost || current.host.endsWith(`.${matchHost}`))
      ) {
        return false;
      }

      const target = new URL(targetUrl);
      if (current.pathname !== target.pathname) return false;
      for (const [key, value] of target.searchParams.entries()) {
        if (current.searchParams.get(key) !== value) return false;
      }
      return true;
    });
  } catch {
    return false;
  }
}

export function isArticlePage(url: string): boolean {
  return isPlatformPageUrl(url, (platform) => platform.articleEditorUrl);
}

export function isLongArticlePage(url: string): boolean {
  return isPlatformPageUrl(url, (platform) => platform.articlePageUrl);
}

export function supportsContentType(platform: PlatformConfig, contentType: 'video' | 'image' | 'article'): boolean {
  if (platform.supportedContentTypes) {
    return platform.supportedContentTypes.includes(contentType);
  }
  if (contentType === 'video') return Boolean(platform.upload);
  if (contentType === 'image') return Boolean(platform.articleEditorUrl && platform.articleUpload && platform.imageFields);
  return Boolean((platform.articlePageUrl || platform.articleEditorUrl) && platform.articleFields);
}

export { commonBlockers };
export type {
  BlockerConfig,
  CategorySelectorConfig,
  DeclarationSelectorConfig,
  FieldConfig,
  FillMethod,
  PlatformCampaign,
  PlatformConfig,
  PlatformFieldSelectorConfig,
  PlatformSelectorConfig,
  PlatformSelectorKey,
  PlatformUploadSelectorConfig,
  CampaignRecommendation,
  VisibilitySelectorConfig,
  ScheduledSelectorConfig,
} from './types';
