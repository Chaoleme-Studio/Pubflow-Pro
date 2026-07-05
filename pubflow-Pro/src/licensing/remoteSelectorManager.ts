import type { LicensingSettings } from '../types';
import type { PlatformSelectorConfig } from '../platforms/types';
import { fetchProtocolInfo } from './activation';
import { loadPubFlowWasmBridge } from './wasmBridge';

const REMOTE_SELECTOR_CACHE_KEY = 'pubflow:remote-selector-policy:v1';

interface BuildSelectorRequestResult {
  ok: boolean;
  request_base64?: string;
  response_key_hex?: string;
  error?: string;
}

interface DecodeSelectorResponseResult {
  ok: boolean;
  version?: number;
  encrypted_selector_blob?: string;
  checksum?: string;
  min_app_version?: string;
  expires_at?: number;
  server_time?: number;
  error?: string;
}

export interface RemoteSelectorPolicy {
  version: number;
  keyVersion: number;
  minExtensionVersion: string;
  expiresAt: number;
  checksum: string;
  selectors: Record<string, PlatformSelectorConfig>;
  updatedAt: number;
  serverTime: number;
}

export async function getCachedRemoteSelectorPolicy(): Promise<RemoteSelectorPolicy | null> {
  const stored = await browser.storage.local.get(REMOTE_SELECTOR_CACHE_KEY);
  const policy = stored[REMOTE_SELECTOR_CACHE_KEY] as RemoteSelectorPolicy | undefined;
  if (!isRemoteSelectorPolicyUsable(policy)) {
    return null;
  }
  return policy;
}

export async function refreshRemoteSelectorPolicy(settings: LicensingSettings): Promise<RemoteSelectorPolicy> {
  const apiBaseUrl = settings.apiBaseUrl.replace(/\/+$/, '');
  if (!apiBaseUrl || !settings.activationCode || !settings.leaseToken || !settings.clientInstallId) {
    throw new Error('远程策略刷新需要有效授权，请先重新验证授权。');
  }

  const protocolInfo = await fetchProtocolInfo(apiBaseUrl);
  const wasm = await loadPubFlowWasmBridge();
  const activationCode = settings.activationCode.trim();
  const activationCodeHash = wasm.pfsp_activation_code_hash(activationCode);
  const cached = await getCachedRemoteSelectorPolicy();
  const buildResult = parseProtocolJson<BuildSelectorRequestResult>(
    wasm.pfsp_build_selector_request(
      protocolInfo.publicKey,
      settings.leaseToken,
      settings.clientInstallId,
      activationCodeHash,
      cached?.version || 0,
      browser.runtime.getManifest().version,
      BigInt(protocolInfo.serverTimeMs),
    ),
  );
  if (!buildResult.ok || !buildResult.request_base64 || !buildResult.response_key_hex) {
    throw new Error(buildResult.error || '远程策略请求构造失败');
  }

  const response = await fetch(`${apiBaseUrl}/v1/selector/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: base64ToArrayBuffer(buildResult.request_base64),
  });
  if (!response.ok) {
    throw new Error(await readRemoteSelectorError(response, `远程策略拉取失败：${response.status}`));
  }

  const responseBase64 = bytesToBase64(new Uint8Array(await response.arrayBuffer()));
  const decoded = parseProtocolJson<DecodeSelectorResponseResult>(
    wasm.pfsp_decode_selector_response(responseBase64, buildResult.response_key_hex),
  );
  if (!decoded.ok || !decoded.encrypted_selector_blob || !decoded.version || !decoded.checksum) {
    throw new Error(decoded.error || '远程策略响应解码失败');
  }

  const selectorJson = wasm.pfsp_decrypt_selector_json(decoded.encrypted_selector_blob, activationCode);
  const selectors = parseProtocolJson<Record<string, PlatformSelectorConfig>>(selectorJson);
  const expiresAt = Number(decoded.expires_at || 0);
  const policy: RemoteSelectorPolicy = {
    version: decoded.version,
    keyVersion: protocolInfo.protocolKeyVersion,
    minExtensionVersion: decoded.min_app_version || protocolInfo.minAppVersion || '0.1.0',
    expiresAt,
    checksum: decoded.checksum,
    selectors,
    updatedAt: Math.floor(Date.now() / 1000),
    serverTime: Number(decoded.server_time || Math.floor(Date.now() / 1000)),
  };
  if (!isRemoteSelectorPolicyUsable(policy)) {
    throw new Error('远程策略已过期，请重新验证授权后再试。');
  }
  await browser.storage.local.set({ [REMOTE_SELECTOR_CACHE_KEY]: policy });
  return policy;
}

export async function clearRemoteSelectorPolicyCache(): Promise<void> {
  await browser.storage.local.remove(REMOTE_SELECTOR_CACHE_KEY);
}

export function isRemoteSelectorPolicyUsable(policy: RemoteSelectorPolicy | undefined): policy is RemoteSelectorPolicy {
  return Boolean(
    policy
      && Number.isFinite(policy.version)
      && policy.version > 0
      && Number.isFinite(policy.keyVersion)
      && policy.keyVersion > 0
      && Number.isFinite(policy.expiresAt)
      && policy.expiresAt > Math.floor(Date.now() / 1000)
      && policy.selectors
      && typeof policy.selectors === 'object'
      && Object.values(policy.selectors).some(looksLikeRemotePlatformSelector),
  );
}

function looksLikeRemotePlatformSelector(value: PlatformSelectorConfig) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.平台标识 === 'string'
      && typeof value.名称 === 'string'
      && typeof value.发布页地址 === 'string'
      && Array.isArray(value.匹配域名)
      && typeof value.就绪选择器 === 'string'
      && value.上传
      && Array.isArray(value.上传.文件输入框)
      && value.字段
      && typeof value.字段.标题 === 'string'
      && typeof value.字段.简介 === 'string',
  );
}

function parseProtocolJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error('远程策略协议模块返回了无效 JSON');
  }
}

async function readRemoteSelectorError(response: Response, fallbackMessage: string) {
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json().catch(() => null) as { message?: string; error?: { message?: string } } | null;
    return mapRemoteSelectorError(payload?.error?.message || payload?.message || fallbackMessage);
  }
  const text = await response.text().catch(() => '');
  return mapRemoteSelectorError(text.trim() || fallbackMessage);
}

function mapRemoteSelectorError(message: string) {
  if (/PFSP_|protocol|decrypt|bad/i.test(message)) {
    return '远程策略验证失败，请重新验证授权或升级插件。';
  }
  if (/expired|LICENSE_EXPIRED|lease_expired|过期/i.test(message)) {
    return '授权已过期，请联网验证后刷新远程策略。';
  }
  if (/revoked|LICENSE_REVOKED|吊销/i.test(message)) {
    return '授权已失效，请联系支持处理。';
  }
  return message || '远程策略拉取失败，请稍后重试。';
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = atob(value);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
