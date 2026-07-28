<script setup lang="ts">
import { Check, ChevronDown, Chrome, Download, FileArchive, MonitorDown } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { getProductCatalog, getRecentAppVersions, type AppVersionItem, type DownloadOption } from '../api';

interface DownloadItem {
  id: string;
  name: string;
  desc: string;
  icon: typeof Chrome;
  href: string;
  fileName: string;
  badge: string;
  kind: 'extension' | 'native';
}

interface NativeDownloadOption {
  id: string;
  label: string;
  href: string;
  fileName: string;
}

const fallbackExtensionDownloads: DownloadItem[] = [
  {
    id: 'zip',
    name: '离线包 (ZIP)',
    desc: '解压后通过开发者模式加载，适合企业内网部署。',
    icon: FileArchive,
    href: '/v1/downloads/pubflow-extension.zip',
    fileName: 'pubflow-extension.zip',
    badge: '推荐',
    kind: 'extension',
  },
  {
    id: 'crx',
    name: 'Chrome 扩展 (CRX)',
    desc: '部分浏览器会限制 CRX 安装，打不开时请使用 ZIP。',
    icon: Chrome,
    href: '/v1/downloads/pubflow-extension.crx',
    fileName: 'pubflow-extension.crx',
    badge: '备用',
    kind: 'extension',
  },
];

const fallbackNativeDownloads: NativeDownloadOption[] = [
  { id: 'mac-arm64', label: 'macOS Apple Silicon', href: '/v1/downloads/pubflow-pro-native-mac-arm64.zip', fileName: 'pubflow-pro-native-mac-arm64.zip' },
  { id: 'mac-x64', label: 'macOS Intel', href: '/v1/downloads/pubflow-pro-native-mac-x64.zip', fileName: 'pubflow-pro-native-mac-x64.zip' },
  { id: 'win-x64', label: 'Windows x64', href: '/v1/downloads/pubflow-pro-native-win-x64.zip', fileName: 'pubflow-pro-native-win-x64.zip' },
  { id: 'linux-x64', label: 'Linux x64', href: '/v1/downloads/pubflow-pro-native-linux-x64.zip', fileName: 'pubflow-pro-native-linux-x64.zip' },
];

const selectedId = ref('zip');
const extensionDownloads = ref<DownloadItem[]>(fallbackExtensionDownloads);
const nativeDownloads = ref<NativeDownloadOption[]>(fallbackNativeDownloads);
const selectedNativeId = ref('mac-arm64');
const recentVersions = ref<AppVersionItem[]>([]);
const expandedVersionIds = ref<Set<string>>(new Set());
const selectedNative = computed(() => nativeDownloads.value.find((item) => item.id === selectedNativeId.value) || nativeDownloads.value[0]);
const nativeCard = computed<DownloadItem>(() => ({
  id: 'native',
  name: 'PubFlow Native',
  desc: '用于脚本、局域网页面和本地工作区自动化发布。',
  icon: MonitorDown,
  href: selectedNative.value?.href || '',
  fileName: selectedNative.value?.fileName || '',
  badge: 'Plus / Pro',
  kind: 'native',
}));
const downloads = computed(() => [...extensionDownloads.value, nativeCard.value]);

onMounted(async () => {
  selectedNativeId.value = detectNativePlatform();
  let hasVersionDownloads = false;
  try {
    recentVersions.value = await getRecentAppVersions(3);
    const latest = recentVersions.value[0];
    if (latest) {
      expandedVersionIds.value = new Set([latest.id]);
      extensionDownloads.value = versionDownloads(latest);
      hasVersionDownloads = true;
      selectedId.value = 'pubflow-extension.zip';
    }
  } catch (error) {
    console.warn('[PubFlow Web] 版本日志加载失败，继续读取商品下载配置', error);
  }

  try {
    const catalog = await getProductCatalog();
    const remoteNative = catalog.downloads
      .filter((item) => item.href && item.fileName.startsWith('pubflow-pro-native-'))
      .map(toNativeDownload)
      .filter((item): item is NativeDownloadOption => Boolean(item))
      .sort((a, b) => nativePlatformOrder(a.id) - nativePlatformOrder(b.id));
    if (remoteNative.length) {
      nativeDownloads.value = fallbackNativeDownloads.map((fallback) => (
        remoteNative.find((item) => item.id === fallback.id) || fallback
      ));
    }
    if (!nativeDownloads.value.some((item) => item.id === selectedNativeId.value)) {
      selectedNativeId.value = nativeDownloads.value[0]?.id || 'mac-arm64';
    }

    if (!hasVersionDownloads) {
      const remoteExtensions = catalog.downloads
        .filter((item) => item.href && item.platform === 'extension')
        .map((item, index): DownloadItem => {
          const isZip = /\.zip($|\?)/i.test(item.fileName || item.href);
          return {
            id: item.fileName || `extension-${index}`,
            name: item.name || item.fileName || 'PubFlow Pro',
            desc: item.chip || (isZip ? '解压后通过开发者模式加载，适合企业内网部署。' : '直接下载安装包，适合日常使用。'),
            icon: isZip ? FileArchive : Chrome,
            href: item.href,
            fileName: item.fileName || '',
            badge: isZip ? '推荐' : '备用',
            kind: 'extension',
          };
        });
      if (remoteExtensions.length) extensionDownloads.value = remoteExtensions;
    }
    selectedId.value = downloads.value[0]?.id || 'zip';
  } catch (error) {
    console.warn('[PubFlow Web] 下载配置加载失败，已使用本地备用链接', error);
  }
});

function versionDownloads(version: AppVersionItem): DownloadItem[] {
  return [
    {
      id: 'pubflow-extension.zip',
      name: '离线包 (ZIP)',
      desc: version.downloadUrlMirror ? '默认走服务器下载；GitHub 镜像可在更新日志中打开。' : '解压后通过开发者模式加载，适合企业内网部署。',
      icon: FileArchive,
      href: expandDownloadUrl(version.downloadUrl, 'pubflow-extension.zip'),
      fileName: 'pubflow-extension.zip',
      badge: '推荐',
      kind: 'extension',
    },
    {
      id: 'pubflow-extension.crx',
      name: 'Chrome 扩展 (CRX)',
      desc: '部分浏览器会限制 CRX 安装，打不开时请使用 ZIP。',
      icon: Chrome,
      href: expandDownloadUrl(version.downloadUrl, 'pubflow-extension.crx'),
      fileName: 'pubflow-extension.crx',
      badge: '备用',
      kind: 'extension',
    },
  ];
}

function detectNativePlatform(): string {
  if (typeof navigator === 'undefined') return 'mac-arm64';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('windows')) return 'win-x64';
  if (ua.includes('linux') && !ua.includes('android')) return 'linux-x64';
  return 'mac-arm64';
}

function toNativeDownload(item: DownloadOption): NativeDownloadOption | undefined {
  const id = ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64']
    .find((candidate) => item.fileName.includes(candidate));
  if (!id) return undefined;
  const fallback = fallbackNativeDownloads.find((option) => option.id === id);
  return {
    id,
    label: item.chip || fallback?.label || id,
    href: item.href,
    fileName: item.fileName,
  };
}

function nativePlatformOrder(id: string): number {
  return ['mac-arm64', 'mac-x64', 'win-x64', 'linux-x64'].indexOf(id);
}

function expandDownloadUrl(base: string, file: string): string {
  const trimmed = base.trim();
  if (!trimmed) return '';
  if (trimmed.endsWith(file)) return trimmed;
  const baseWithoutSlash = trimmed.replace(/\/+$/, '');
  if (/^https?:\/\//i.test(baseWithoutSlash)) return `${baseWithoutSlash}/${file}`;
  return `${baseWithoutSlash}/${file}`.replace(/\/+/g, '/');
}

function doDownload(item: DownloadItem) {
  if (!item.href) return;
  const a = document.createElement('a');
  a.href = item.href;
  if (item.fileName && !/^https?:\/\//i.test(item.href)) {
    a.download = item.fileName;
  }
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function toggleVersion(id: string) {
  const next = new Set(expandedVersionIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedVersionIds.value = next;
}
</script>

<template>
  <main class="download-page">
    <section class="download-hero">
      <p class="eyebrow">Download Center</p>
      <h1>下载 PubFlow</h1>
      <p>安装浏览器插件；需要脚本或局域网自动化时，再安装对应系统的 Native。</p>
    </section>

    <section class="download-cards">
      <div v-for="item in downloads" :key="item.id" class="download-card" :class="{ active: selectedId === item.id }" @click="selectedId = item.id">
        <div class="download-card-head">
          <component :is="item.icon" :size="28" />
          <span class="download-badge">{{ item.badge }}</span>
        </div>
        <strong>{{ item.name }}</strong>
        <p>{{ item.desc }}</p>
        <span class="download-file">{{ item.fileName }}</span>
        <div class="download-actions">
          <span v-if="item.kind === 'native'" class="download-platform-control" @click.stop>
            <select
              v-model="selectedNativeId"
              class="download-platform-select"
              aria-label="选择 Native 操作系统"
            >
              <option v-for="option in nativeDownloads" :key="option.id" :value="option.id">{{ option.label }}</option>
            </select>
            <ChevronDown class="download-platform-chevron" :size="15" aria-hidden="true" />
          </span>
          <button class="secondary-button compact" type="button" @click.stop="doDownload(item)">
            <Download :size="14" />
            下载
          </button>
        </div>
      </div>
    </section>
    <p class="download-mv3-hint">ZIP 和 CRX 均为 Chrome Manifest V3 扩展；Native 安装包已按操作系统分开。</p>
    <section class="download-notes-row">
      <div><Check :size="16" /> 支持抖音、视频号、小红书、B站、快手等平台</div>
      <div><Check :size="16" /> 通过激活码授权，无需登录账号</div>
      <div><Check :size="16" /> 本地运行，不上传用户数据</div>
    </section>

    <section v-if="recentVersions.length" class="download-changelog">
      <div class="download-changelog-head">
        <span>更新日志</span>
        <strong>版本更新</strong>
      </div>
      <article v-for="item in recentVersions" :key="item.id" class="download-version-item">
        <button type="button" class="download-version-head" @click="toggleVersion(item.id)">
          <span>v{{ item.version }}</span>
          <small>{{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}</small>
          <mark v-if="item.forceUpdate">强提醒</mark>
          <ChevronDown :size="16" :class="{ open: expandedVersionIds.has(item.id) }" />
        </button>
        <pre v-if="expandedVersionIds.has(item.id)" class="download-version-notes">{{ item.releaseNotes || '暂无更新日志。' }}</pre>
      </article>
    </section>
  </main>
</template>
