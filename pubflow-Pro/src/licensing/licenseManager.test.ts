import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LicensingSettings } from '../types';

const mocks = vi.hoisted(() => ({
  activateLease: vi.fn(),
  buildDeviceProof: vi.fn(),
}));

vi.mock('./activation', () => ({ activateLease: mocks.activateLease }));
vi.mock('./deviceProof', () => ({ buildDeviceProof: mocks.buildDeviceProof }));

import { isInvalidLeaseTokenError, verifyLicense } from './licenseManager';
import { hasLicenseCredentials, mergeStoredLicenseWithRuntimeLease } from './licenseStorage';

function settings(overrides: Partial<LicensingSettings> = {}): LicensingSettings {
  return {
    apiBaseUrl: 'https://license.example.test',
    activationCode: 'PF-REAL-CODE',
    clientInstallId: 'install-1',
    leaseToken: 'lease-1',
    tier: 'pro',
    features: ['publish', 'batch', 'selector-updates', 'native-publish', 'remote-publish'],
    status: 'active',
    ...overrides,
  };
}

function verifyResponse() {
  return new Response(JSON.stringify({
    data: {
      valid: true,
      status: 'active',
      valid_until: '2030-01-01T00:00:00Z',
      server_time: '2026-07-12T12:00:00Z',
      tier: 'pro',
      features: ['publish', 'batch', 'selector-updates', 'native-publish', 'remote-publish'],
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('license reload recovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.activateLease.mockReset();
    mocks.buildDeviceProof.mockReset().mockResolvedValue({ signature: 'proof' });
  });

  it('verifies a restored lease even when the activation code is temporarily unavailable', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(verifyResponse());

    const result = await verifyLicense(settings({ activationCode: '' }));

    expect(result.ok).toBe(true);
    expect(mocks.activateLease).not.toHaveBeenCalled();
    expect(hasLicenseCredentials(result.settings)).toBe(true);
  });

  it('automatically reactivates when the persisted lease token is rejected', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: { message: 'INVALID_TOKEN' } }),
        { status: 401, headers: { 'content-type': 'application/json' } },
      ))
      .mockResolvedValueOnce(verifyResponse());
    mocks.activateLease.mockResolvedValue(settings({ leaseToken: 'lease-2' }));

    const result = await verifyLicense(settings());

    expect(result.ok).toBe(true);
    expect(result.settings.leaseToken).toBe('lease-2');
    expect(mocks.activateLease).toHaveBeenCalledWith(expect.objectContaining({ leaseToken: '' }));
  });

  it('recognizes server invalid-token errors without matching unrelated failures', () => {
    expect(isInvalidLeaseTokenError(new Error('Invalid token'))).toBe(true);
    expect(isInvalidLeaseTokenError(new Error('该激活码已被吊销'))).toBe(false);
  });

  it('keeps a renewed runtime lease only for the same persisted license identity', () => {
    const renewed = settings({ leaseToken: 'lease-renewed', validUntil: 2000 });
    const staleStored = settings({ leaseToken: 'lease-stale', validUntil: 1000 });

    expect(mergeStoredLicenseWithRuntimeLease(staleStored, renewed)).toMatchObject({
      leaseToken: 'lease-renewed',
      validUntil: 2000,
      tier: 'pro',
    });
  });

  it('does not restore a runtime lease after persisted credentials are reset or changed', () => {
    const runtime = settings({ leaseToken: 'lease-runtime' });
    const reset = settings({ activationCode: '', clientInstallId: '', leaseToken: '', status: 'unconfigured' });
    const changed = settings({ activationCode: 'PF-OTHER-CODE', clientInstallId: '', leaseToken: '' });

    expect(mergeStoredLicenseWithRuntimeLease(reset, runtime).leaseToken).toBe('');
    expect(mergeStoredLicenseWithRuntimeLease(changed, runtime).leaseToken).toBe('');
  });
});
