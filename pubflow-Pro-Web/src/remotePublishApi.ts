import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';

export type RemotePublishMode = 'fill_only' | 'auto_submit';

export interface RemoteSession {
  licenseExpiresAt?: string;
  accessExpiresAt: string;
  refreshExpiresAt?: string;
  tier?: 'plus' | 'pro';
  features?: string[];
}

export interface RemoteQuota {
  date: string;
  unlimited?: boolean;
  jobLimit: number;
  jobsUsed: number;
  jobsRemaining: number;
  byteLimit: number;
  bytesUsed: number;
  bytesRemaining: number;
}

export interface RemoteChannelTest {
  connected: boolean;
  latencyMs: number;
  testedAt: string;
  extensionVersion?: string;
}

export interface RemoteAssetDescriptor {
  role: 'video' | 'cover' | 'music' | 'image';
  fileName: string;
  contentType?: string;
  size: number;
  sha256: string;
}

export interface RemoteAssetView extends RemoteAssetDescriptor {
  assetId: string;
  status: string;
}

export interface RemoteJob {
  jobId: string;
  projectId: string;
  requestId: string;
  contentType: 'video' | 'image' | 'article';
  title: string;
  platforms: string[];
  publishMode: RemotePublishMode;
  status: string;
  statusSequence: number;
  declaredBytes: number;
  assets: RemoteAssetView[];
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRemoteJob {
  requestId: string;
  contentType: 'video' | 'image' | 'article';
  title: string;
  description: string;
  articleContent?: string;
  topics: string[];
  campaignIds: string[];
  platforms: string[];
  scheduledAt?: number;
  visibility: 'public' | 'friends' | 'private';
  originalDeclare: boolean;
  platformSettings: Record<string, unknown>;
  fillOptions?: { topicIntervalMs?: number };
  assets: RemoteAssetDescriptor[];
  publishMode: RemotePublishMode;
}

export interface PublishTransport {
  readonly kind: 'cloud' | 'local';
  login(activationCode: string): Promise<RemoteSession>;
  session(): Promise<RemoteSession>;
  logout(): Promise<{ loggedOut: boolean }>;
  quota(): Promise<RemoteQuota>;
  testChannel(): Promise<RemoteChannelTest>;
  jobs(): Promise<RemoteJob[]>;
  createJob(payload: CreateRemoteJob): Promise<RemoteJob>;
  completeJob(jobId: string): Promise<RemoteJob>;
  uploadAsset(
    jobId: string,
    assetId: string,
    file: File,
    onProgress: (loaded: number) => void,
  ): Promise<void>;
}

const API_BASE_URL = (import.meta.env.VITE_PUBFLOW_API_BASE_URL || '').trim().replace(/\/+$/, '');
let refreshPromise: Promise<RemoteSession> | null = null;

export class RemoteSessionExpiredError extends Error {
  constructor() {
    super('登录已过期，请重新输入激活码。');
    this.name = 'RemoteSessionExpiredError';
  }
}

export function isRemoteSessionExpiredError(error: unknown): error is RemoteSessionExpiredError {
  return error instanceof RemoteSessionExpiredError;
}

export const remotePublishApi: PublishTransport & { refresh(): Promise<RemoteSession> } = {
  kind: 'cloud',
  login: (activationCode: string) => request<RemoteSession>('/v1/remote/session/login', {
    method: 'POST', body: JSON.stringify({ activationCode }), headers: jsonHeaders(),
  }, false),
  session: () => request<RemoteSession>('/v1/remote/session'),
  refresh: refreshSession,
  logout: () => request<{ loggedOut: boolean }>('/v1/remote/session/logout', { method: 'POST' }, false),
  quota: () => request<RemoteQuota>('/v1/remote/quota'),
  testChannel: () => request<RemoteChannelTest>('/v1/remote/channel/test', { method: 'POST' }),
  jobs: async () => (await request<{ items: RemoteJob[] }>('/v1/remote/jobs')).items,
  createJob: (payload: CreateRemoteJob) => request<RemoteJob>('/v1/remote/jobs', {
    method: 'POST', body: JSON.stringify(payload), headers: jsonHeaders(),
  }),
  completeJob: (jobId: string) => request<RemoteJob>(`/v1/remote/jobs/${jobId}/complete`, { method: 'POST' }),
  uploadAsset,
};

async function request<T>(path: string, init: RequestInit = {}, refreshOnUnauthorized = true): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, credentials: 'include' });
  if (response.status === 401 && refreshOnUnauthorized) {
    try {
      await remotePublishApi.refresh();
    } catch {
      throw new RemoteSessionExpiredError();
    }
    return request<T>(path, init, false);
  }
  const payload = await response.json().catch(() => null) as { data?: T; error?: { message?: string; errors?: Array<{ message?: string }> } } | null;
  if (!response.ok) throw new Error(payload?.error?.errors?.[0]?.message || payload?.error?.message || `请求失败：${response.status}`);
  if (!payload?.data) throw new Error('服务端返回格式无效。');
  return payload.data;
}

function refreshSession(): Promise<RemoteSession> {
  if (!refreshPromise) {
    refreshPromise = request<RemoteSession>('/v1/remote/session/refresh', { method: 'POST' }, false)
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function uploadAsset(jobId: string, assetId: string, file: File, onProgress: (loaded: number) => void) {
  try {
    await uploadAssetOnce(jobId, assetId, file, onProgress);
  } catch (error) {
    if (!(error instanceof UploadHttpError) || error.status !== 401) throw error;
    try {
      await remotePublishApi.refresh();
    } catch {
      throw new RemoteSessionExpiredError();
    }
    await uploadAssetOnce(jobId, assetId, file, onProgress);
  }
}

function uploadAssetOnce(jobId: string, assetId: string, file: File, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${API_BASE_URL}/v1/remote/jobs/${jobId}/assets/${assetId}`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (event) => onProgress(event.loaded);
    xhr.onerror = () => reject(new Error(`素材 ${file.name} 上传失败。`));
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300
      ? resolve()
      : reject(new UploadHttpError(readXhrError(xhr) || `素材 ${file.name} 上传失败：${xhr.status}`, xhr.status));
    xhr.send(file);
  });
}

class UploadHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function readXhrError(xhr: XMLHttpRequest) {
  try {
    const payload = JSON.parse(xhr.responseText) as { error?: { message?: string; errors?: Array<{ message?: string }> } };
    return payload.error?.errors?.[0]?.message || payload.error?.message || '';
  } catch { return ''; }
}

function jsonHeaders() { return { 'Content-Type': 'application/json' }; }

export async function sha256(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    : nobleSha256(bytes);
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function createRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}
