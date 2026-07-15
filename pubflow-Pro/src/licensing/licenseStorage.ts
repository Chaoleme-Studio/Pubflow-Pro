import type { LicensingSettings } from '../types';
import { defaultLicensingSettings } from '../storage/settingsStorage';
import { loadSettings, saveSettings } from '../storage/settingsStorage';

export async function loadLicensingSettings(): Promise<LicensingSettings> {
  const stored = await loadSettings();
  return {
    ...defaultLicensingSettings,
    ...stored.licensingSettings,
  };
}

export async function saveLicensingSettings(settings: LicensingSettings) {
  const stored = await loadSettings();
  await saveSettings({
    ...stored,
    licensingSettings: settings,
  });
}

export function hasLicenseCredentials(settings: LicensingSettings) {
  return Boolean(
    settings.apiBaseUrl &&
    (settings.activationCode || (settings.leaseToken && settings.clientInstallId)),
  );
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
