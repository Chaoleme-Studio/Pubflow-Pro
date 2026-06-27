import type { LicensingSettings } from '../types';
import { loadPubFlowWasmBridge } from './wasmBridge';

interface ActivateLeasePayload {
  lease_token?: string;
  leaseToken?: string;
  valid_until?: number;
  validUntil?: number;
  server_time?: number;
  serverTime?: number;
}

interface ProtocolVersionPayload {
  protocol_public_key?: string;
  protocolPublicKey?: string;
  server_time_ms?: number;
  serverTimeMs?: number;
}

interface BuildRequestResult {
  ok: boolean;
  request_base64?: string;
  response_key_hex?: string;
  error?: string;
}

interface DecodeActivationResult extends ActivateLeasePayload {
  ok: boolean;
  error?: string;
}

interface ApiErrorPayload {
  error?: {
    code?: number;
    message?: string;
    errors?: Array<{
      domain?: string;
      reason?: string;
      message?: string;
    }>;
  };
  message?: string;
}

const INSTALL_ID_KEY = 'pubflow:install-id';

export async function ensureInstallId() {
  const stored = await browser.storage.local.get(INSTALL_ID_KEY);
  const existing = stored[INSTALL_ID_KEY];
  if (typeof existing === 'string' && existing) {
    return existing;
  }
  const id = `install:${crypto.randomUUID()}`;
  await browser.storage.local.set({ [INSTALL_ID_KEY]: id });
  return id;
}

export async function activateLease(settings: LicensingSettings): Promise<LicensingSettings> {
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  if (!apiBaseUrl) {
    throw new Error('授权服务地址未配置，请检查插件构建配置。');
  }
  if (!settings.activationCode.trim()) {
    throw new Error('请输入激活码。');
  }

  const clientInstallId = settings.clientInstallId || settings.machineHash || await ensureInstallId();
  const wasm = await loadPubFlowWasmBridge();
  const protocolInfo = await fetchProtocolInfo(apiBaseUrl);
  const buildResult = parseJson<BuildRequestResult>(
    wasm.pfap_build_activation_request(
      protocolInfo.publicKey,
      settings.activationCode.trim(),
      clientInstallId,
      detectPlatform(),
      browser.runtime.getManifest().version,
      BigInt(protocolInfo.serverTimeMs),
    ),
  );
  if (!buildResult.ok || !buildResult.request_base64 || !buildResult.response_key_hex) {
    throw new Error(buildResult.error || '授权激活请求构造失败');
  }

  const response = await fetchWithReadableNetworkError(`${apiBaseUrl}/v1/lease/activate-protocol`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: base64ToArrayBuffer(buildResult.request_base64),
  }, '授权激活请求无法连接到服务器');
  if (!response.ok) {
    throw new Error(await readApiError(response, `激活失败：${response.status}`));
  }

  const responseBase64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  const data = parseJson<DecodeActivationResult>(
    wasm.pfap_decode_activation_response(responseBase64, buildResult.response_key_hex),
  );
  if (!data.ok) {
    throw new Error(data.error || '授权激活响应解码失败');
  }
  const leaseToken = data.lease_token || data.leaseToken;
  if (!leaseToken) {
    throw new Error('服务端未返回授权凭证。');
  }

  return {
    ...settings,
    apiBaseUrl,
    activationCode: settings.activationCode.trim(),
    clientInstallId,
    machineHash: '',
    leaseToken,
    validUntil: data.valid_until || data.validUntil,
    serverTime: data.server_time || data.serverTime,
  };
}

async function fetchProtocolInfo(apiBaseUrl: string): Promise<{ publicKey: string; serverTimeMs: number }> {
  const response = await fetchWithReadableNetworkError(
    `${apiBaseUrl}/v1/selector/version`,
    undefined,
    '授权协议版本查询无法连接到服务器',
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, `授权协议版本查询失败：${response.status}`));
  }
  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as ProtocolVersionPayload;
  const key = data.protocol_public_key || data.protocolPublicKey;
  if (!key) {
    throw new Error('服务端未返回授权协议公钥');
  }
  return {
    publicKey: key,
    serverTimeMs: Number(data.server_time_ms || data.serverTimeMs || 0),
  };
}

function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'macos';
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('授权协议模块返回了无效 JSON');
  }
}

async function fetchWithReadableNetworkError(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  fallbackMessage: string,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const detail = error instanceof Error && error.message ? `（${error.message}）` : '';
    throw new Error(`${fallbackMessage}${detail}`);
  }
}

async function readApiError(response: Response, fallbackMessage: string): Promise<string> {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as ApiErrorPayload | null;
    const message = mapApiError(payload);
    if (message) return message;
  } else {
    const text = await response.text().catch(() => '');
    const trimmed = text.trim();
    if (trimmed) return trimmed;
  }
  if (response.status === 502) {
    return '授权服务网关暂时不可用，请稍后重试。';
  }
  return fallbackMessage;
}

function mapApiError(payload: ApiErrorPayload | null): string {
  const detail = payload?.error?.errors?.[0];
  const code = detail?.message || detail?.reason || payload?.error?.message || payload?.message || '';
  if (/DEVICE_LIMIT_REACHED|USAGE_LIMIT_REACHED|device_limit_reached/i.test(code)) {
    return '该激活码已绑定其他设备，请在后台解绑旧设备后再激活。';
  }
  if (/LICENSE_EXPIRED|license_expired/i.test(code)) {
    return '该激活码已过期。';
  }
  if (/LICENSE_REVOKED|license_revoked/i.test(code)) {
    return '该激活码已被吊销。';
  }
  if (/PFAP_BAD_TIMESTAMP|PFSP_BAD_TIMESTAMP/i.test(code)) {
    return '授权协议时间校验失败，请同步系统时间后重试。';
  }
  return payload?.error?.message || payload?.message || '';
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const bytes = base64ToBytes(value);
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
