import type { LicensingSettings } from '../types';
import { defaultLicensingSettings } from '../storage/settingsStorage';
import { loadSettings, saveSettings } from '../storage/settingsStorage';

export async function loadLicensingSettings(): Promise<LicensingSettings> {
  const stored = await loadSettings();
  return {
    ...defaultLicensingSettings,
    ...stored.licensingSettings,
  };
}

export async function saveLicensingSettings(settings: LicensingSettings) {
  const stored = await loadSettings();
  await saveSettings({
    ...stored,
    licensingSettings: settings,
  });
}

export function hasLicenseCredentials(settings: LicensingSettings) {
  return Boolean(settings.apiBaseUrl && settings.activationCode);
}
