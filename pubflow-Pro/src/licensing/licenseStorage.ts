import type { LicenseFeature, LicenseTier, LicensingSettings } from '../types';
import { defaultLicensingSettings } from '../storage/settingsStorage';
import { loadSettings, saveSettings } from '../storage/settingsStorage';
import { createLocalLicensingSettings, LOCAL_MODE, LOCAL_MODE_FEATURES } from './localMode';

export async function loadLicensingSettings(): Promise<LicensingSettings> {
  const stored = await loadSettings();
  const merged = {
    ...defaultLicensingSettings,
    ...stored.licensingSettings,
  };
  return LOCAL_MODE ? createLocalLicensingSettings(merged) : merged;
}

export async function saveLicensingSettings(settings: LicensingSettings) {
  const stored = await loadSettings();
  await saveSettings({
    ...stored,
    licensingSettings: settings,
  });
}

export function hasLicenseCredentials(settings: LicensingSettings) {
  if (LOCAL_MODE) return true;
  return Boolean(
    settings.apiBaseUrl &&
    (settings.activationCode || (settings.leaseToken && settings.clientInstallId)),
  );
}

const FEATURES_BY_TIER: Record<LicenseTier, LicenseFeature[]> = {
  basic: ['publish', 'batch', 'selector-updates'],
  plus: ['publish', 'batch', 'selector-updates', 'native-publish'],
  pro: ['publish', 'batch', 'selector-updates', 'native-publish', 'remote-publish'],
};

export function parseLicenseGrant(tier: unknown, features: unknown): {
  tier: LicenseTier;
  features: LicenseFeature[];
} {
  if (tier !== 'basic' && tier !== 'plus' && tier !== 'pro') {
    throw new Error('服务端返回了无效的授权层级，请更新插件或联系支持。');
  }
  if (!Array.isArray(features) || features.some((feature) => typeof feature !== 'string')) {
    throw new Error('服务端返回了无效的授权能力，请更新插件或联系支持。');
  }
  const expected = FEATURES_BY_TIER[tier];
  const actual = [...new Set(features)].sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length || actual.some((feature, index) => feature !== sortedExpected[index])) {
    throw new Error('服务端返回的授权层级与能力不一致，请重新验证授权。');
  }
  return { tier, features: [...expected] };
}

export function hasLicenseFeature(
  settings: LicensingSettings | null | undefined,
  feature: LicenseFeature,
) {
  if (LOCAL_MODE) return LOCAL_MODE_FEATURES.includes(feature);
  return settings?.status === 'active' && settings.features.includes(feature);
}

/**
 * 仅当持久化配置与后台内存属于同一授权身份时，保留启动阶段刚验证或续租的 lease。
 * 激活码、授权服务地址或安装实例发生变化时，以持久化配置为准。
 */
export function mergeStoredLicenseWithRuntimeLease(
  stored: LicensingSettings,
  runtime: LicensingSettings | null,
): LicensingSettings {
  if (!runtime?.leaseToken || !sameLicenseIdentity(stored, runtime)) {
    return stored;
  }

  return {
    ...stored,
    clientInstallId: runtime.clientInstallId || stored.clientInstallId,
    leaseToken: runtime.leaseToken,
    tier: runtime.tier,
    features: [...runtime.features],
    status: runtime.status,
    statusMessage: runtime.statusMessage,
    validUntil: runtime.validUntil,
    serverTime: runtime.serverTime,
    serverTimeCheckedAt: runtime.serverTimeCheckedAt,
  };
}

function sameLicenseIdentity(left: LicensingSettings, right: LicensingSettings) {
  if (normalizeApiBaseUrl(left.apiBaseUrl) !== normalizeApiBaseUrl(right.apiBaseUrl)) return false;

  const leftCode = left.activationCode.trim().toUpperCase();
  const rightCode = right.activationCode.trim().toUpperCase();
  if (leftCode && rightCode) return leftCode === rightCode;

  return Boolean(left.clientInstallId) && left.clientInstallId === right.clientInstallId;
}

function normalizeApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}
