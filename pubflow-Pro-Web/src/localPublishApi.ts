import { gcm } from '@noble/ciphers/aes.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { p256 } from '@noble/curves/nist.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type {
  CreateRemoteJob,
  PublishTransport,
  RemoteChannelTest,
  RemoteJob,
  RemoteQuota,
  RemoteSession,
} from './remotePublishApi';

interface LocalChallenge {
  challengeId: string;
  serverPublicKey: string;
  expiresAt: string;
}

const encoder = new TextEncoder();
const HKDF_INFO = encoder.encode('pubflow-native-local-session-v1');

export const localPublishApi: PublishTransport = {
  kind: 'local',

  async login(password: string) {
    const challenge = await request<LocalChallenge>('/v1/local/session/challenge');
    const { secretKey, publicKey } = p256.keygen();
    const serverPublicKey = decodeBase64Url(challenge.serverPublicKey);
    const sharedPoint = p256.getSharedSecret(secretKey, serverPublicKey, false);
    const sharedX = sharedPoint.slice(1, 33);
    const key = hkdf(
      sha256,
      sharedX,
      encoder.encode(challenge.challengeId),
      HKDF_INFO,
      32,
    );
    const nonce = randomBytes(12);
    const plaintext = encoder.encode(JSON.stringify({ password }));
    const ciphertext = gcm(key, nonce).encrypt(plaintext);
    return request<RemoteSession>('/v1/local/session/login', {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        challengeId: challenge.challengeId,
        clientPublicKey: encodeBase64Url(publicKey),
        nonce: encodeBase64Url(nonce),
        ciphertext: encodeBase64Url(ciphertext),
      }),
    });
  },

  session: () => request<RemoteSession>('/v1/local/session'),
  logout: () => request<{ loggedOut: boolean }>('/v1/local/session/logout', { method: 'POST' }),
  quota: () => request<RemoteQuota>('/v1/local/quota'),
  testChannel: () => request<RemoteChannelTest>('/v1/local/channel/test', { method: 'POST' }),
  jobs: async () => (await request<{ items: RemoteJob[] }>('/v1/local/jobs')).items,
  createJob: (payload: CreateRemoteJob) => request<RemoteJob>('/v1/local/jobs', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(payload),
  }),
  completeJob: (jobId: string) => request<RemoteJob>(
    `/v1/local/jobs/${jobId}/complete`,
    { method: 'POST' },
  ),
  uploadAsset,
};

export interface LocalWorkspaceSelection {
  selected: boolean;
  directoryName?: string;
  restartRequired: boolean;
}

export function selectLocalWorkspace() {
  return request<LocalWorkspaceSelection>('/v1/local/workspace/select', { method: 'POST' });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'include' });
  const payload = await response.json().catch(() => null) as (T & {
    error?: string | { message?: string; errors?: Array<{ message?: string }> };
  }) | null;
  if (!response.ok) {
    const structured = typeof payload?.error === 'object' ? payload.error : null;
    const message = structured?.errors?.[0]?.message
      || structured?.message
      || (typeof payload?.error === 'string' ? payload.error : '')
      || `请求失败：${response.status}`;
    throw new Error(message);
  }
  if (!payload) throw new Error('Native 返回格式无效。');
  return payload;
}

function uploadAsset(
  jobId: string,
  assetId: string,
  file: File,
  onProgress: (loaded: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/v1/local/jobs/${jobId}/assets/${assetId}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onerror = () => reject(new Error(`素材 ${file.name} 上传失败。`));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }
      reject(new Error(readXhrError(xhr) || `素材 ${file.name} 上传失败：${xhr.status}`));
    };
    xhr.send(file);
  });
}

function readXhrError(xhr: XMLHttpRequest) {
  try {
    const payload = JSON.parse(xhr.responseText) as {
      error?: string | { message?: string; errors?: Array<{ message?: string }> };
    };
    if (typeof payload.error === 'string') return payload.error;
    return payload.error?.errors?.[0]?.message || payload.error?.message || '';
  } catch {
    return '';
  }
}

function encodeBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeBase64Url(value: string) {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function jsonHeaders() {
  return { 'Content-Type': 'application/json' };
}
