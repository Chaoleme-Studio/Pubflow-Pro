import type { ContentData, LicensingSettings, PlatformId } from '../types';
import { buildDeviceProof } from './deviceProof';

const START_DISTRIBUTION_OPERATION = 'start_distribution';

interface PermitResponsePayload {
  permit_token?: string;
  permitToken?: string;
  permit_id?: string;
  permitId?: string;
  expires_at?: string;
  expiresAt?: string;
  server_time?: string;
  serverTime?: string;
}

export interface DistributionPermit {
  permitToken: string;
  permitId: string;
  expiresAt: number;
  serverTime?: number;
  taskHash: string;
}

export interface DistributionPermitInput {
  content: ContentData;
  platforms: PlatformId[];
  videoId?: string;
}

export async function issueDistributionPermit(
  settings: LicensingSettings,
  input: DistributionPermitInput,
): Promise<DistributionPermit> {
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  if (!apiBaseUrl || !settings.leaseToken || !settings.clientInstallId) {
    throw new Error('授权信息未完成验证，请先重新激活。');
  }

  const taskHash = await buildDistributionTaskHash(input);
  const deviceProof = await buildDeviceProof(
    apiBaseUrl,
    settings.leaseToken,
    settings.clientInstallId,
    'permit',
  );
  const response = await fetch(`${apiBaseUrl}/v1/lease/permit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      lease_token: settings.leaseToken,
      client_install_id: settings.clientInstallId,
      operation: START_DISTRIBUTION_OPERATION,
      task_hash: taskHash,
      device_proof: deviceProof,
    }),
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, `发布授权票据签发失败：${response.status}`));
  }

  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as PermitResponsePayload;
  const permitToken = data.permit_token || data.permitToken;
  const permitId = data.permit_id || data.permitId;
  const expiresAt = parseServerTimestamp(data.expires_at || data.expiresAt);
  if (!permitToken || !permitId || !expiresAt) {
    throw new Error('服务端未返回有效的发布授权票据。');
  }

  return {
    permitToken,
    permitId,
    expiresAt,
    serverTime: parseServerTimestamp(data.server_time || data.serverTime),
    taskHash,
  };
}

async function buildDistributionTaskHash(input: DistributionPermitInput) {
  const canonical = canonicalStringify({
    content: input.content,
    platforms: input.platforms,
    videoId: input.videoId || '',
  });
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical)));
  return `sha256:${bytesToBase64Url(digest)}`;
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    const item = (value as Record<string, unknown>)[key];
    if (typeof item !== 'undefined') {
      result[key] = canonicalize(item);
    }
  }
  return result;
}

function parseServerTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : undefined;
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: { message?: string } } | null;
    return mapPermitError(payload?.error?.message || payload?.message || fallbackMessage);
  }
  const text = await response.text().catch(() => '');
  return mapPermitError(text.trim() || fallbackMessage);
}

export function mapPermitError(message: string) {
  if (/DEVICE_AUTH_FAILED|DEVICE_|device|设备|signature|public key/i.test(message)) {
    return '授权设备验证失败，请重新验证后再开始发布。';
  }
  if (/expired|LICENSE_EXPIRED|lease_expired|过期/i.test(message)) {
    return '授权已过期，请联网验证后再开始发布。';
  }
  if (/revoked|LICENSE_REVOKED|吊销/i.test(message)) {
    return '授权已失效，请联系支持处理。';
  }
  return message || '发布授权票据签发失败，请稍后重试。';
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
