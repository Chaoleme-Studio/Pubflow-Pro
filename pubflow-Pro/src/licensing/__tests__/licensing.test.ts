import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeviceProof, mapDeviceProofError } from '../deviceProof';
import { getOrCreateBrowserDeviceKey, signDeviceChallenge } from '../deviceKeyManager';
import { isLicenseExpired, mapLicenseApiError } from '../licenseManager';
import { issueDistributionPermit, mapPermitError } from '../permitManager';
import { isRemoteSelectorPolicyUsable } from '../remoteSelectorManager';
import type { LicensingSettings } from '../../types';
import { applyRemoteSelectorConfigs, getPlatformConfig } from '../../platforms';
import type { PlatformSelectorConfig } from '../../platforms';

const DEVICE_KEY_DB_NAME = 'pubflow-device-keys';

describe('browser device key', () => {
  beforeEach(async () => {
    await deleteDatabase(DEVICE_KEY_DB_NAME);
  });

  it('creates a stable P-256 browser-profile key and signs challenges', async () => {
    const first = await getOrCreateBrowserDeviceKey();
    const second = await getOrCreateBrowserDeviceKey();

    expect(first.algorithm).toBe('ECDSA_P256_SHA256');
    expect(first.deviceKeyId).toMatch(/^p256:/);
    expect(first.publicKeySpkiBase64Url.length).toBeGreaterThan(80);
    expect(second.deviceKeyId).toBe(first.deviceKeyId);

    const signature = await signDeviceChallenge('challenge-1');
    expect(signature.algorithm).toBe('ECDSA_P256_SHA256');
    expect(signature.signatureFormat).toBe('webcrypto-p1363');
    expect(signature.deviceKeyId).toBe(first.deviceKeyId);

    const publicKey = await crypto.subtle.importKey(
      'spki',
      base64UrlToBytes(first.publicKeySpkiBase64Url),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const verified = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      base64UrlToBytes(signature.signatureBase64Url),
      new TextEncoder().encode('challenge-1'),
    );
    expect(verified).toBe(true);
  });
});

describe('device proof payload', () => {
  beforeEach(async () => {
    await deleteDatabase(DEVICE_KEY_DB_NAME);
    vi.restoreAllMocks();
  });

  it('fetches a challenge and returns signed proof fields expected by the server', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      jsonResponse({
        data: {
          challenge_id: 'challenge-id-1',
          challenge: 'pubflow-device-v1:challenge-id-1:new-device:nonce',
        },
      }),
    );

    const proof = await buildDeviceProof('https://api.example.test', 'lease-token', 'install-id', 'permit');

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/v1/lease/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lease_token: 'lease-token',
        client_install_id: 'install-id',
        device_key_id: proof.device_key_id,
        purpose: 'permit',
      }),
    });
    expect(proof).toMatchObject({
      challenge_id: 'challenge-id-1',
      challenge: 'pubflow-device-v1:challenge-id-1:new-device:nonce',
      algorithm: 'ECDSA_P256_SHA256',
      signature_format: 'webcrypto-p1363',
    });
    expect(proof.device_key_id).toMatch(/^p256:/);
    expect(proof.public_key_spki_base64_url.length).toBeGreaterThan(80);
    expect(proof.signature_base64_url.length).toBeGreaterThan(80);
  });
});

describe('distribution permit payload', () => {
  beforeEach(async () => {
    await deleteDatabase(DEVICE_KEY_DB_NAME);
    vi.restoreAllMocks();
  });

  it('requests start_distribution permit with device proof and stable task hash', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({
        data: {
          challenge_id: 'challenge-id-1',
          challenge: 'pubflow-device-v1:challenge-id-1:new-device:nonce-a',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          permit_token: 'permit-token-1',
          permit_id: 'permit-id-1',
          expires_at: '2026-07-04T03:10:00Z',
          server_time: '2026-07-04T03:05:00Z',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          challenge_id: 'challenge-id-2',
          challenge: 'pubflow-device-v1:challenge-id-2:new-device:nonce-b',
        },
      }))
      .mockResolvedValueOnce(jsonResponse({
        data: {
          permit_token: 'permit-token-2',
          permit_id: 'permit-id-2',
          expires_at: '2026-07-04T03:10:00Z',
          server_time: '2026-07-04T03:05:00Z',
        },
      }));
    const settings = {
      apiBaseUrl: 'https://api.example.test',
      leaseToken: 'lease-token',
      clientInstallId: 'install-id',
    } as LicensingSettings;

    const first = await issueDistributionPermit(settings, {
      content: { title: 'Title', description: 'Desc' } as never,
      platforms: ['douyin'],
      videoId: 'video-1',
    });
    const second = await issueDistributionPermit(settings, {
      content: { description: 'Desc', title: 'Title' } as never,
      platforms: ['douyin'],
      videoId: 'video-1',
    });

    const firstPermitBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body || '{}'));
    const secondPermitBody = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body || '{}'));
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.example.test/v1/lease/permit');
    expect(firstPermitBody).toMatchObject({
      lease_token: 'lease-token',
      client_install_id: 'install-id',
      operation: 'start_distribution',
    });
    expect(firstPermitBody.task_hash).toMatch(/^sha256:/);
    expect(firstPermitBody.task_hash).toBe(secondPermitBody.task_hash);
    expect(firstPermitBody.device_proof).toMatchObject({
      algorithm: 'ECDSA_P256_SHA256',
      signature_format: 'webcrypto-p1363',
    });
    expect(first.permitId).toBe('permit-id-1');
    expect(second.permitId).toBe('permit-id-2');
  });
});

describe('license expiry and redacted errors', () => {
  it('uses server time calibration before falling back to local time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T10:00:00Z'));
    const localNow = Math.floor(Date.now() / 1000);
    const settings = {
      validUntil: localNow + 600,
      serverTime: localNow - 900,
      serverTimeCheckedAt: localNow - 60,
    } as LicensingSettings;

    expect(isLicenseExpired(settings)).toBe(false);
    expect(isLicenseExpired({ ...settings, validUntil: localNow - 1000 })).toBe(true);
    vi.useRealTimers();
  });

  it('does not let local clock rollback revive an expired server-calibrated lease', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-04T10:00:00Z'));
    const checkedAt = Math.floor(Date.now() / 1000);
    const settings = {
      validUntil: checkedAt + 100,
      serverTime: checkedAt + 200,
      serverTimeCheckedAt: checkedAt,
    } as LicensingSettings;

    expect(isLicenseExpired(settings)).toBe(true);

    vi.setSystemTime(new Date('2026-07-01T10:00:00Z'));
    expect(isLicenseExpired(settings)).toBe(true);
    vi.useRealTimers();
  });

  it('maps internal auth errors to user-safe messages', () => {
    expect(mapDeviceProofError('DEVICE_PROOF_INVALID: signature mismatch')).toBe('授权设备验证失败，请重新验证。');
    expect(mapLicenseApiError('DEVICE_PUBLIC_KEY_REQUIRED')).toBe('授权设备验证失败，请重新验证。');
    expect(mapPermitError('LICENSE_EXPIRED')).toBe('授权已过期，请联网验证后再开始发布。');
  });
});

describe('remote selector policy cache', () => {
  it('accepts only versioned and unexpired signed-protocol policy envelopes', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    expect(isRemoteSelectorPolicyUsable({
      version: 3,
      keyVersion: 2,
      minExtensionVersion: '0.1.0',
      expiresAt: future,
      checksum: 'abc',
      selectors: { douyin: remoteDouyinSelector() },
      updatedAt: future - 10,
      serverTime: future - 10,
    })).toBe(true);
    expect(isRemoteSelectorPolicyUsable({
      version: 3,
      keyVersion: 2,
      minExtensionVersion: '0.1.0',
      expiresAt: future - 7200,
      checksum: 'abc',
      selectors: { douyin: remoteDouyinSelector() },
      updatedAt: future - 8000,
      serverTime: future - 8000,
    })).toBe(false);
    expect(isRemoteSelectorPolicyUsable({
      version: 3,
      keyVersion: 2,
      minExtensionVersion: '0.1.0',
      expiresAt: future,
      checksum: 'abc',
      selectors: {},
      updatedAt: future - 10,
      serverTime: future - 10,
    })).toBe(false);
  });

  it('keeps built-in selectors when deprecated remote selector policy is supplied', () => {
    const original = getPlatformConfig('douyin');
    const remoteReadySelector = '[data-pubflow-test-ready="douyin"]';

    const applied = applyRemoteSelectorConfigs({
      douyin: {
        平台标识: 'douyin',
        名称: original.name,
        图标: original.icon,
        发布页地址: original.editorUrl,
        匹配域名: original.matchHosts,
        就绪选择器: remoteReadySelector,
        上传: {
          上传容器: '.upload',
          文件输入框: ['input[type=file]'],
          上传完成标记: '.done',
          编辑器就绪标记: '.editor',
        },
        字段: {
          标题: '.title',
          简介: '.description',
        },
      },
    });

    expect(applied).toBe(false);
    expect(getPlatformConfig('douyin').readySelector).toBe(original.readySelector);
    expect(getPlatformConfig('douyin').readySelector).not.toBe(remoteReadySelector);
  });
});

function remoteDouyinSelector(): PlatformSelectorConfig {
  return {
    平台标识: 'douyin',
    名称: '抖音创作者',
    图标: 'DY',
    发布页地址: 'https://creator.douyin.com/creator-micro/content/upload',
    匹配域名: ['creator.douyin.com'],
    就绪选择器: '.editor',
    上传: {
      上传容器: '.upload',
      文件输入框: ['input[type=file]'],
      上传完成标记: '.done',
      编辑器就绪标记: '.editor',
    },
    字段: {
      标题: '.title',
      简介: '.description',
    },
  };
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error(`IndexedDB ${name} delete blocked`));
  });
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(normalized.length + (4 - normalized.length % 4) % 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
