const UPDATE_CHECK_KEY = 'pubflow:update-check:last';
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;

interface ExtensionUpdatePayload {
  version?: string;
  latest_version?: string;
  min_version?: string;
  download_url?: string;
  release_notes?: string;
  force_update?: boolean;
}

export async function checkExtensionUpdate(apiBaseUrl: string, officialSiteUrl: string) {
  const baseUrl = apiBaseUrl.trim().replace(/\/+$/, '');
  if (!baseUrl) return;
  if (!(await shouldCheckNow())) return;

  try {
    const response = await fetch(`${baseUrl}/v1/product/version`, {
      cache: 'no-store',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return;
    const data = (payload?.data ?? payload) as ExtensionUpdatePayload;
    const latestVersion = String(data.version ?? data.latest_version ?? '').trim();
    if (!latestVersion) return;

    const currentVersion = browser.runtime.getManifest().version || '0.0.0';
    if (compareVersion(latestVersion, currentVersion) <= 0) return;

    const downloadUrl = String(data.download_url ?? '').trim()
      || `${officialSiteUrl.replace(/\/+$/, '')}/download`;
    await notifyUpdate(latestVersion, downloadUrl, Boolean(data.force_update));
  } catch (error) {
    console.warn('[PubFlow] 插件更新检测失败', error);
  }
}

async function shouldCheckNow() {
  const stored = await browser.storage.local.get(UPDATE_CHECK_KEY);
  const last = Number(stored[UPDATE_CHECK_KEY] ?? 0);
  if (Date.now() - last < UPDATE_CHECK_INTERVAL_MS) return false;
  await browser.storage.local.set({ [UPDATE_CHECK_KEY]: Date.now() });
  return true;
}

async function notifyUpdate(latestVersion: string, downloadUrl: string, forceUpdate: boolean) {
  if (!browser.notifications?.create) {
    return;
  }
  const notificationId = `pubflow-update-${latestVersion}`;
  await browser.notifications.create(notificationId, {
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png' as never),
    title: forceUpdate ? 'PubFlow 建议立即更新' : 'PubFlow 有新版本',
    message: `发现 v${latestVersion}，点击打开下载页。`,
  });

  const listener = (clickedId: string) => {
    if (clickedId !== notificationId) return;
    browser.notifications.onClicked.removeListener(listener);
    void browser.tabs.create({ url: downloadUrl, active: true });
  };
  browser.notifications.onClicked.addListener(listener);
}

function compareVersion(a: string, b: string) {
  const left = versionParts(a);
  const right = versionParts(b);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function versionParts(version: string) {
  return version
    .split(/[.-]/)
    .map((item) => Number.parseInt(item, 10))
    .map((item) => (Number.isFinite(item) ? item : 0));
}
