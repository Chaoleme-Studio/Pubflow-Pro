import type { LicensingSettings } from '../types';
import { defaultLicensingSettings } from '../storage/settingsStorage';
import { activateLease } from './activation';

export interface LicenseVerificationResult {
  ok: boolean;
  settings: LicensingSettings;
  error?: string;
}

interface VerifyLeasePayload {
  valid?: boolean;
  status?: string;
  valid_until?: string;
  validUntil?: string;
  server_time?: string;
  serverTime?: string;
}

export async function verifyLicense(input: LicensingSettings): Promise<LicenseVerificationResult> {
  const settings: LicensingSettings = {
    ...defaultLicensingSettings,
    ...input,
  };

  if (!settings.apiBaseUrl || !settings.activationCode) {
    return {
      ok: false,
      settings: {
        ...settings,
        status: 'unconfigured',
        statusMessage: '请先输入激活码。',
      },
      error: '授权信息未配置完整',
    };
  }

  try {
    const activeSettings = settings.leaseToken && settings.clientInstallId
      ? settings
      : await activateLease(settings);
    const verifiedSettings = activeSettings.leaseToken && activeSettings.clientInstallId
      ? await verifyLease(activeSettings)
      : activeSettings;

    if (isLicenseExpired(verifiedSettings)) {
      throw new Error('该激活码已过期。');
    }

    return {
      ok: true,
      settings: {
        ...verifiedSettings,
        status: 'active',
        statusMessage: '授权有效。',
      },
    };
  } catch (error) {
    return {
      ok: false,
      settings: {
        ...settings,
        status: classifyLicenseError(error),
        statusMessage: error instanceof Error ? error.message : '授权验证失败',
      },
      error: error instanceof Error ? error.message : '授权验证失败',
    };
  }
}

export function isLicenseExpired(settings: LicensingSettings) {
  return typeof settings.validUntil === 'number' && settings.validUntil > 0 && settings.validUntil * 1000 <= Date.now();
}

async function verifyLease(settings: LicensingSettings): Promise<LicensingSettings> {
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const response = await fetch(`${apiBaseUrl}/v1/lease/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lease_token: settings.leaseToken,
      client_install_id: settings.clientInstallId,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, `授权验证失败：${response.status}`));
  }

  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as VerifyLeasePayload;
  if (data.valid === false) {
    throw new Error(mapLeaseStatus(data.status) || '授权无效。');
  }

  return {
    ...settings,
    validUntil: parseServerTimestamp(data.valid_until || data.validUntil) || settings.validUntil,
    serverTime: parseServerTimestamp(data.server_time || data.serverTime) || settings.serverTime,
  };
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: { message?: string } } | null;
    return payload?.error?.message || payload?.message || fallbackMessage;
  }
  const text = await response.text().catch(() => '');
  return text.trim() || fallbackMessage;
}

function parseServerTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : undefined;
}

function mapLeaseStatus(status: string | undefined) {
  if (!status) return '';
  if (/expired/i.test(status)) return '该激活码已过期。';
  if (/device_mismatch/i.test(status)) return '该激活码已绑定其他设备。';
  if (/revoked/i.test(status)) return '该激活码已被吊销。';
  return `授权无效：${status}`;
}

function classifyLicenseError(error: unknown): LicensingSettings['status'] {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/expired|LICENSE_EXPIRED|lease_expired|过期/i.test(message)) return 'expired';
  if (/DEVICE_MISMATCH|device_mismatch|设备/i.test(message)) return 'device_mismatch';
  if (/unconfigured|未配置/i.test(message)) return 'unconfigured';
  return 'invalid';
}
