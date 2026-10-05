import { describe, expect, it } from 'vitest';
import { shouldUseDefaultLicensingApiBaseUrl } from './settingsStorage';

describe('licensing API base URL migration', () => {
  const productionApiBaseUrl = 'http://www.pubflow.chaoleme.cn';
  const developmentApiBaseUrl = 'http://127.0.0.1:5189';

  it('replaces a stored endpoint with the current build endpoint', () => {
    expect(shouldUseDefaultLicensingApiBaseUrl(developmentApiBaseUrl, productionApiBaseUrl)).toBe(true);
  });

  it('keeps the current endpoint', () => {
    expect(shouldUseDefaultLicensingApiBaseUrl(productionApiBaseUrl, productionApiBaseUrl)).toBe(false);
  });

  it('keeps stored configuration when the build has no endpoint', () => {
    expect(shouldUseDefaultLicensingApiBaseUrl(developmentApiBaseUrl, '')).toBe(false);
  });
});
