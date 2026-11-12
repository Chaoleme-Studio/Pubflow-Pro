import type { LicensingSettings } from '../types';
import { defaultLicensingSettings } from '../storage/settingsStorage';
import { activateLease } from './activation';
import { buildDeviceProof } from './deviceProof';
import { parseLicenseGrant } from './licenseStorage';
import { createLocalLicensingSettings, LOCAL_MODE } from './localMode';

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
  license_expires_at?: string | null;
  licenseExpiresAt?: string | null;
  server_time?: string;
  serverTime?: string;
  tier?: string;
  features?: string[];
}

interface ApiErrorPayload {
  error?: {
    message?: string;
    errors?: Array<{
      reason?: string;
      message?: string;
    }>;
  };
  message?: string;
}

class LicenseApiError extends Error {
  constructor(message: string, readonly code = '') {
    super(message);
    this.name = 'LicenseApiError';
  }
}

export async function verifyLicense(input: LicensingSettings): Promise<LicenseVerificationResult> {
  const settings: LicensingSettings = {
    ...defaultLicensingSettings,
    ...input,
  };

  // 本地模式不激活、不联网、不校验证书，直接返回可用的 plus 身份。
  if (LOCAL_MODE) {
    return {
      ok: true,
      settings: createLocalLicensingSettings(settings),
    };
  }

  const hasExistingLease = Boolean(settings.leaseToken && settings.clientInstallId);
  if (!settings.apiBaseUrl || (!settings.activationCode && !hasExistingLease)) {
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
    let verifiedSettings = activeSettings;
    if (activeSettings.leaseToken && activeSettings.clientInstallId) {
      try {
        verifiedSettings = await verifyLease(activeSettings);
      } catch (error) {
        if (isDeviceProofRecoveryError(error)) {
          verifiedSettings = await recoverBrowserDeviceKeyLoss(activeSettings);
        } else if (settings.activationCode && isInvalidLeaseTokenError(error)) {
          verifiedSettings = await reactivateInvalidLease(activeSettings);
        } else {
          throw error;
        }
      }
    }

    if (isLicenseExpired(verifiedSettings)) {
      throw new Error('授权验证已到期，请联网重新验证后继续发布。');
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
  return typeof settings.validUntil === 'number'
    && settings.validUntil > 0
    && settings.validUntil <= currentLicenseTime(settings);
}

async function verifyLease(settings: LicensingSettings): Promise<LicensingSettings> {
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  const deviceProof = await buildDeviceProof(apiBaseUrl, settings.leaseToken, settings.clientInstallId);
  const response = await fetch(`${apiBaseUrl}/v1/lease/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lease_token: settings.leaseToken,
      client_install_id: settings.clientInstallId,
      device_proof: deviceProof,
    }),
  });
  if (!response.ok) {
    throw await readApiError(response, `授权验证失败：${response.status}`);
  }

  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as VerifyLeasePayload;
  if (data.valid === false) {
    throw new Error(mapLeaseStatus(data.status) || '授权无效。');
  }

  const serverTime = parseServerTimestamp(data.server_time || data.serverTime);
  const grant = parseLicenseGrant(data.tier, data.features);
  return {
    ...settings,
    ...grant,
    validUntil: parseServerTimestamp(
      data.license_expires_at || data.licenseExpiresAt || data.valid_until || data.validUntil,
    ) || settings.validUntil,
    serverTime: serverTime || settings.serverTime,
    serverTimeCheckedAt: serverTime ? Math.floor(Date.now() / 1000) : settings.serverTimeCheckedAt,
  };
}

async function recoverBrowserDeviceKeyLoss(settings: LicensingSettings): Promise<LicensingSettings> {
  const reactivated = await activateLease({
    ...settings,
    leaseToken: '',
    statusMessage: '',
  });
  return verifyLease(reactivated);
}

/** 本地 lease token 失效但激活码仍可用时，自动重新激活并验证，避免要求用户重复输入。 */
async function reactivateInvalidLease(settings: LicensingSettings): Promise<LicensingSettings> {
  const reactivated = await activateLease({
    ...settings,
    leaseToken: '',
    statusMessage: '',
  });
  return verifyLease(reactivated);
}

function isDeviceProofRecoveryError(error: unknown) {
  if (error instanceof LicenseApiError) {
    return /DEVICE_AUTH_FAILED|DEVICE_PROOF_INVALID|DEVICE_CHALLENGE_REQUIRED|DEVICE_CHALLENGE_EXPIRED|DEVICE_PUBLIC_KEY_REQUIRED/i.test(error.code);
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return /DEVICE_AUTH_FAILED|DEVICE_PROOF_INVALID|DEVICE_CHALLENGE_REQUIRED|DEVICE_CHALLENGE_EXPIRED|DEVICE_PUBLIC_KEY_REQUIRED/i.test(message);
}

export function isInvalidLeaseTokenError(error: unknown) {
  const code = error instanceof LicenseApiError ? error.code : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return /INVALID_TOKEN|TOKEN_INVALID|LEASE_NOT_FOUND|LEASE_TOKEN_INVALID|Invalid token/i.test(`${code} ${message}`);
}

async function readApiError(response: Response, fallbackMessage: string): Promise<LicenseApiError> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
    const code = extractApiErrorCode(payload);
    return new LicenseApiError(mapLicenseApiError(code || payload?.error?.message || payload?.message || fallbackMessage), code);
  }
  const text = await response.text().catch(() => '');
  const message = text.trim() || fallbackMessage;
  return new LicenseApiError(mapLicenseApiError(message), message);
}

function parseServerTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : undefined;
}

function currentLicenseTime(settings: LicensingSettings) {
  const localNow = Math.floor(Date.now() / 1000);
  if (
    typeof settings.serverTime === 'number'
    && settings.serverTime > 0
    && typeof settings.serverTimeCheckedAt === 'number'
    && settings.serverTimeCheckedAt > 0
  ) {
    return settings.serverTime + Math.max(0, localNow - settings.serverTimeCheckedAt);
  }
  return localNow;
}

function mapLeaseStatus(status: string | undefined) {
  if (!status) return '';
  if (/expired/i.test(status)) return '授权验证已到期，请联网重新验证后继续发布。';
  if (/device_mismatch/i.test(status)) return '该激活码已绑定其他设备。';
  if (/revoked/i.test(status)) return '该激活码已被吊销。';
  return `授权无效：${status}`;
}

export function mapLicenseApiError(message: string) {
  if (/DEVICE_AUTH_FAILED|DEVICE_PROOF_INVALID|DEVICE_CHALLENGE_REQUIRED|DEVICE_CHALLENGE_EXPIRED|DEVICE_PUBLIC_KEY_REQUIRED/i.test(message)) {
    return '授权设备验证失败，请重新验证。';
  }
  return message || '授权验证失败';
}

function extractApiErrorCode(payload: ApiErrorPayload | null) {
  const detail = payload?.error?.errors?.[0];
  return detail?.message || detail?.reason || payload?.error?.message || payload?.message || '';
}

function classifyLicenseError(error: unknown): LicensingSettings['status'] {
  const message = error instanceof Error ? error.message : String(error || '');
  if (/授权验证已到期|lease_expired/i.test(message)) return 'restricted';
  if (/LICENSE_EXPIRED|该激活码已过期/i.test(message)) return 'expired';
  if (/DEVICE_MISMATCH|device_mismatch|设备/i.test(message)) return 'device_mismatch';
  if (/unconfigured|未配置/i.test(message)) return 'unconfigured';
  return 'invalid';
}
