import type { LicensingSettings, PlatformId } from '../types';
import { bilibiliSelectorConfig } from './bilibili/selectors';
import { douyinSelectorConfig } from './douyin/selectors';
import { kuaishouSelectorConfig } from './kuaishou/selectors';
import { commonBlockers, buildPlatformConfig } from './shared';
import { weiboSelectorConfig } from './weibo/selectors';
import { weixinChannelsSelectorConfig } from './weixinChannels/selectors';
import { xiaohongshuSelectorConfig } from './xiaohongshu/selectors';
import { xiguaSelectorConfig } from './xigua/selectors';
import { xSelectorConfig } from './x/selectors';
import { youtubeSelectorConfig } from './youtube/selectors';
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
  X: xSelectorConfig,
  YouTube: youtubeSelectorConfig,
} satisfies Record<string, PlatformSelectorConfig>;

type BrowserPlatformId = PlatformId;

export const PLATFORM_SELECTOR_CONFIGS_BY_ID: Record<BrowserPlatformId, PlatformSelectorConfig> =
  Object.fromEntries(
    Object.values(PLATFORM_SELECTOR_CONFIGS).map((config) => [config.平台标识, config]),
  ) as Record<BrowserPlatformId, PlatformSelectorConfig>;

const browserPlatformConfigs = Object.fromEntries(
  Object.entries(PLATFORM_SELECTOR_CONFIGS_BY_ID).map(([id, config]) => [id, buildPlatformConfig(config)]),
) as Record<BrowserPlatformId, PlatformConfig>;

export const PLATFORM_CONFIGS: Record<PlatformId, PlatformConfig> = {
  ...browserPlatformConfigs,
};

let runtimeSelectorConfigsById: Record<BrowserPlatformId, PlatformSelectorConfig> = { ...PLATFORM_SELECTOR_CONFIGS_BY_ID };
let runtimePlatformConfigs: Record<PlatformId, PlatformConfig> = { ...PLATFORM_CONFIGS };

// active=false 的平台不会进入 UI、权限和内容脚本匹配范围。
const activeSelectorConfigs = Object.values(PLATFORM_SELECTOR_CONFIGS_BY_ID).filter(
  (config) => config.启用 !== false,
);

export const PLATFORM_ORDER: PlatformId[] = activeSelectorConfigs.map((config) => config.平台标识);

export const PLATFORM_MATCH_PATTERNS = activeSelectorConfigs.flatMap((config) =>
  config.匹配域名.map((host) => `https://${host}/*`),
);

export function getPlatformConfig(platformId: PlatformId): PlatformConfig {
  return runtimePlatformConfigs[platformId] || PLATFORM_CONFIGS[platformId];
}

export function getPlatformConfigs(): Record<PlatformId, PlatformConfig> {
  return runtimePlatformConfigs;
}

export function getPlatformOrder(): PlatformId[] {
  return Object.values(runtimeSelectorConfigsById)
    .filter((config) => config.启用 !== false)
    .map((config) => config.平台标识);
}

/**
 * @deprecated 远程 selector 策略暂时废弃，后续大概率删除。
 *
 * 当前所有平台 selector 都以内置 src/platforms 下各平台 selectors.ts 为准。保留这个函数只是为了给
 * 旧代码/测试留一个明确的过渡点，避免发布主链路重新引入云端策略造成延迟和失败点。
 */
export function applyRemoteSelectorConfigs(selectors: Record<string, PlatformSelectorConfig>): boolean {
  void selectors;
  // TODO(remote-selector): 暂时不再应用云端 selector。后续如果恢复，必须确保它只作为后台异步更新，
  // 并且本地 selector 可以无感兜底，不能影响发布主链路。
  // const nextSelectorConfigs = { ...PLATFORM_SELECTOR_CONFIGS_BY_ID };
  // let changed = false;
  // for (const value of Object.values(selectors)) {
  //   const platformId = value?.平台标识;
  //   if (!platformId || !(platformId in PLATFORM_SELECTOR_CONFIGS_BY_ID)) continue;
  //   nextSelectorConfigs[platformId] = value;
  //   changed = true;
  // }
  // if (!changed) return false;
  // runtimeSelectorConfigsById = nextSelectorConfigs;
  // runtimePlatformConfigs = Object.fromEntries(
  //   Object.entries(runtimeSelectorConfigsById).map(([id, config]) => [id, buildPlatformConfig(config)]),
  // ) as Record<PlatformId, PlatformConfig>;
  // return true;
  return false;
}

/** @deprecated 远程 selector 缓存暂时废弃；当前固定使用本地内置 selector。 */
export async function loadCachedRemotePlatformConfigs(): Promise<boolean> {
  // TODO(remote-selector): 后续确认不再使用后，删除 remoteSelectorManager 及相关协议代码。
  // const { getCachedRemoteSelectorPolicy } = await import('../licensing/remoteSelectorManager');
  // const policy = await getCachedRemoteSelectorPolicy();
  // return policy ? applyRemoteSelectorConfigs(policy.selectors) : false;
  return false;
}

/** @deprecated 远程 selector 刷新暂时废弃；当前固定使用本地内置 selector。 */
export async function refreshRemotePlatformConfigs(settings: LicensingSettings): Promise<boolean> {
  void settings;
  // TODO(remote-selector): 后续确认不再使用后，删除 remoteSelectorManager 及相关协议代码。
  // const { refreshRemoteSelectorPolicy } = await import('../licensing/remoteSelectorManager');
  // const policy = await refreshRemoteSelectorPolicy(settings);
  // return applyRemoteSelectorConfigs(policy.selectors);
  return false;
}

/** 根据 URL 主机名匹配对应的平台配置。 */
export function getPlatformByUrl(url: string): PlatformConfig | undefined {
  let host = '';
  try {
    host = new URL(url).host;
  } catch {
    return undefined;
  }

  return Object.values(runtimePlatformConfigs).find((platform) =>
    platform.matchHosts.some((matchHost) => host === matchHost || host.endsWith(`.${matchHost}`)),
  );
}

/** 判断当前 URL 是否匹配某个平台的指定页面地址（用于检测图文/文章发布页）。 */
function isPlatformPageUrl(url: string, getTargetUrl: (platform: PlatformConfig) => string | undefined): boolean {
  try {
    const current = new URL(url);
    return Object.values(runtimePlatformConfigs).some((platform) => {
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

/** 判断当前 URL 是否是平台图文发布页。 */
export function isArticlePage(url: string): boolean {
  return isPlatformPageUrl(url, (platform) => platform.articleEditorUrl);
}

/** 判断当前 URL 是否是平台长文章/专栏发布页。 */
export function isLongArticlePage(url: string): boolean {
  return isPlatformPageUrl(url, (platform) => platform.articlePageUrl);
}

/** 判断平台是否支持指定的内容类型（视频/图文/文章）。 */
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
