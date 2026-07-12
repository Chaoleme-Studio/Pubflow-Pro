import type { LicensingSettings } from '../types';
import { loadPubFlowWasmBridge } from './wasmBridge';

interface ActivateLeasePayload {
  lease_token?: string;
  leaseToken?: string;
  valid_until?: number;
  validUntil?: number;
  license_expires_at?: number | null;
  licenseExpiresAt?: number | null;
  server_time?: number;
  serverTime?: number;
}

interface ProtocolVersionPayload {
  version?: number;
  min_app_version?: string;
  minAppVersion?: string;
  created_at?: string;
  createdAt?: string;
  protocol_version?: number;
  protocolVersion?: number;
  protocol_key_version?: number;
  protocolKeyVersion?: number;
  protocol_public_key?: string;
  protocolPublicKey?: string;
  protocol_public_key_expires_at?: string;
  protocolPublicKeyExpiresAt?: string;
  protocol_signature_algorithm?: string;
  protocolSignatureAlgorithm?: string;
  protocol_signing_key_id?: string;
  protocolSigningKeyId?: string;
  protocol_signed_payload?: string;
  protocolSignedPayload?: string;
  protocol_signature?: string;
  protocolSignature?: string;
  server_time_ms?: number;
  serverTimeMs?: number;
}

export interface ProtocolInfo {
  publicKey: string;
  serverTimeMs: number;
  selectorVersion: number;
  protocolKeyVersion: number;
  minAppVersion: string;
  protocolPublicKeyExpiresAt?: string;
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
const BUILT_IN_PROTOCOL_PUBLIC_KEY = normalizeProtocolPublicKey(__PUBFLOW_PROTOCOL_PUBLIC_KEY__);
const BUILT_IN_PROTOCOL_TRUST_ROOT_P256_SPKI = normalizeBase64Url(__PUBFLOW_PROTOCOL_TRUST_ROOT_P256_SPKI__);

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
    validUntil: data.license_expires_at || data.licenseExpiresAt || data.valid_until || data.validUntil,
    serverTime: data.server_time || data.serverTime,
    serverTimeCheckedAt: Math.floor(Date.now() / 1000),
  };
}

export async function fetchProtocolInfo(apiBaseUrl: string): Promise<ProtocolInfo> {
  const normalizedApiBaseUrl = apiBaseUrl.replace(/\/+$/, '');
  const response = await fetchWithReadableNetworkError(
    `${normalizedApiBaseUrl}/v1/selector/version`,
    undefined,
    '授权协议版本查询无法连接到服务器',
  );
  if (!response.ok) {
    throw new Error(await readApiError(response, `授权协议版本查询失败：${response.status}`));
  }
  const payload = await response.json().catch(() => ({}));
  const data = (payload?.data ?? payload) as ProtocolVersionPayload;
  const serverKey = normalizeProtocolPublicKey(data.protocol_public_key || data.protocolPublicKey);
  if (!serverKey && !BUILT_IN_PROTOCOL_PUBLIC_KEY) {
    throw new Error('服务端未返回授权协议公钥');
  }
  const hasPinnedKey = !!BUILT_IN_PROTOCOL_PUBLIC_KEY;
  const matchesPinnedKey = hasPinnedKey && (!serverKey || serverKey === BUILT_IN_PROTOCOL_PUBLIC_KEY);
  const trustedSignedServerKey = !matchesPinnedKey && await verifySignedProtocolKey(data, serverKey);
  const allowUnsignedLocalServerKey = !hasPinnedKey && isLoopbackLicenseApiBaseUrl(normalizedApiBaseUrl);
  if (
    hasPinnedKey
    && serverKey
    && serverKey !== BUILT_IN_PROTOCOL_PUBLIC_KEY
    && !trustedSignedServerKey
  ) {
    throw new Error('授权协议配置不匹配，请安装最新版本或联系支持。');
  }
  if (!matchesPinnedKey && !hasPinnedKey && !trustedSignedServerKey && !allowUnsignedLocalServerKey) {
    throw new Error('授权协议配置未受信任，请安装最新版本或联系支持。');
  }
  return {
    publicKey: matchesPinnedKey ? BUILT_IN_PROTOCOL_PUBLIC_KEY : serverKey,
    serverTimeMs: Number(data.server_time_ms || data.serverTimeMs || 0),
    selectorVersion: Number(data.version || 0),
    protocolKeyVersion: Number(data.protocol_key_version || data.protocolKeyVersion || 0),
    minAppVersion: data.min_app_version || data.minAppVersion || '',
    protocolPublicKeyExpiresAt: data.protocol_public_key_expires_at || data.protocolPublicKeyExpiresAt,
  };
}

function normalizeProtocolPublicKey(value: string | undefined) {
  return (value || '').trim().toLowerCase();
}

function isLoopbackLicenseApiBaseUrl(value: string) {
  try {
    const { hostname } = new URL(value);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

async function verifySignedProtocolKey(data: ProtocolVersionPayload, serverKey: string): Promise<boolean> {
  if (!BUILT_IN_PROTOCOL_TRUST_ROOT_P256_SPKI || !serverKey) return false;
  const signatureAlgorithm = data.protocol_signature_algorithm || data.protocolSignatureAlgorithm;
  const signature = data.protocol_signature || data.protocolSignature;
  const signedPayload = data.protocol_signed_payload || data.protocolSignedPayload;
  if (signatureAlgorithm !== 'ECDSA_P256_SHA256' || !signature) return false;
  if (!signedPayload || !signedPayloadMatchesVersion(data, signedPayload, serverKey)) return false;

  const rootSpki = base64UrlToBytes(BUILT_IN_PROTOCOL_TRUST_ROOT_P256_SPKI);
  const expectedKeyId = await protocolSigningKeyId(rootSpki);
  const signingKeyId = data.protocol_signing_key_id || data.protocolSigningKeyId;
  if (signingKeyId && signingKeyId !== expectedKeyId) return false;

  const key = await crypto.subtle.importKey(
    'spki',
    bytesToArrayBuffer(rootSpki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    bytesToArrayBuffer(base64UrlToBytes(signature)),
    new TextEncoder().encode(signedPayload),
  );
}

function signedPayloadMatchesVersion(data: ProtocolVersionPayload, signedPayload: string, serverKey: string) {
  const keyVersion = Number(data.protocol_key_version || data.protocolKeyVersion || 0);
  const protocolVersion = Number(data.protocol_version || data.protocolVersion || 0);
  const minAppVersion = data.min_app_version || data.minAppVersion || '';
  const lines = new Set(signedPayload.split('\n'));
  return lines.has('pubflow-protocol-key-v1')
    && lines.has(`key_version:${keyVersion}`)
    && lines.has(`protocol_version:${protocolVersion}`)
    && lines.has(`protocol_public_key:${serverKey}`)
    && lines.has(`min_app_version:${minAppVersion.trim()}`);
}

async function protocolSigningKeyId(publicKeySpki: Uint8Array) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytesToArrayBuffer(publicKeySpki)));
  return `p256:${bytesToBase64Url(digest)}`;
}

function normalizeBase64Url(value: string | undefined) {
  return (value || '').trim();
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

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
  return base64ToBytes(padded);
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  return bytesToArrayBuffer(base64ToBytes(value));
}

function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
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

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}
