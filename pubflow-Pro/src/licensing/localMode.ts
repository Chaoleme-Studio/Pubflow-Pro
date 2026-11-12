import type { LicenseFeature, LicenseTier, LicensingSettings } from '../types';

/**
 * 纯本地模式：构建时通过 PUBFLOW_LOCAL_MODE=1 注入。
 *
 * 开启后跳过授权激活、lease 联网验证、发布 permit 签发、远程 selector 和更新检查，
 * 直接以 plus 授权身份运行。仅用于开发/自用离线构建，不要带到生产发布包里。
 */
export const LOCAL_MODE = Boolean(__PUBFLOW_LOCAL_MODE__);

/**
 * Native 端 validate_extension_grant 只接受 plus / pro，且 features 必须与套餐完全一致，
 * 所以这里固定使用 plus：满足本地 Agent 发布，又不会启动依赖服务端的 remote-publish。
 */
export const LOCAL_MODE_TIER: LicenseTier = 'plus';

export const LOCAL_MODE_FEATURES: LicenseFeature[] = [
  'publish',
  'batch',
  'selector-updates',
  'native-publish',
];

/** 2100-01-01T00:00:00Z，仅供本地模式占位，Native 要求 valid_until 必须是未来时间。 */
export const LOCAL_MODE_VALID_UNTIL = 4102444800;

export const LOCAL_MODE_STATUS_MESSAGE = '本地模式：已跳过授权验证。';

/** 用本地模式身份覆盖任意授权配置，但不伪造真实激活码/lease。 */
export function createLocalLicensingSettings(base: LicensingSettings): LicensingSettings {
  return {
    ...base,
    status: 'active',
    statusMessage: LOCAL_MODE_STATUS_MESSAGE,
    tier: LOCAL_MODE_TIER,
    features: [...LOCAL_MODE_FEATURES],
    validUntil: LOCAL_MODE_VALID_UNTIL,
    serverTime: undefined,
    serverTimeCheckedAt: undefined,
  };
}
