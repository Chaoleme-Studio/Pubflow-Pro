<script setup lang="ts">
import { Check, ChevronDown, Chrome, Download, FileArchive } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { getProductCatalog, getRecentAppVersions, type AppVersionItem } from '../api';

interface DownloadItem {
  id: string;
  name: string;
  desc: string;
  icon: typeof Chrome;
  href: string;
  fileName: string;
  badge: string;
}

const fallbackDownloads: DownloadItem[] = [
  {
    id: 'zip',
    name: '离线包 (ZIP)',
    desc: '解压后通过开发者模式加载，适合企业内网部署。',
    icon: FileArchive,
    href: '/downloads/pubflow-pro.zip',
    fileName: 'pubflow-pro.zip',
    badge: '推荐',
  },
  {
    id: 'crx',
    name: 'Chrome 扩展 (CRX)',
    desc: '部分浏览器会限制 CRX 安装，打不开时请使用 ZIP。',
    icon: Chrome,
    href: '/downloads/pubflow-pro.crx',
    fileName: 'pubflow-pro.crx',
    badge: '备用',
  },
];

const selectedId = ref('zip');
const remoteDownloads = ref<DownloadItem[]>([]);
const recentVersions = ref<AppVersionItem[]>([]);
const expandedVersionIds = ref<Set<string>>(new Set());
const downloads = computed(() => remoteDownloads.value.length ? remoteDownloads.value : fallbackDownloads);
const activeItem = () => downloads.value.find((d) => d.id === selectedId.value) || downloads.value[0];

onMounted(async () => {
  try {
    const catalog = await getProductCatalog();
    remoteDownloads.value = catalog.downloads
      .filter((item) => item.href)
      .map((item, index) => {
        const isZip = /\.zip($|\?)/i.test(item.fileName || item.href);
        return {
          id: item.fileName || item.platform || `download-${index}`,
          name: item.name || item.fileName || 'PubFlow Pro',
          desc: item.chip || (isZip ? '解压后通过开发者模式加载，适合企业内网部署。' : '直接下载安装包，适合日常使用。'),
          icon: isZip ? FileArchive : Chrome,
          href: item.href,
          fileName: item.fileName || '',
          badge: isZip ? '推荐' : index === 0 ? '推荐' : '备用',
        };
      })
      .sort((a, b) => Number(!/\.zip($|\?)/i.test(a.fileName || a.href)) - Number(!/\.zip($|\?)/i.test(b.fileName || b.href)));
    selectedId.value = downloads.value[0]?.id || 'zip';
  } catch (error) {
    console.warn('[PubFlow Web] 下载配置加载失败，已使用本地备用链接', error);
  }

  try {
    recentVersions.value = await getRecentAppVersions(3);
    const latest = recentVersions.value[0];
    if (latest) expandedVersionIds.value = new Set([latest.id]);
  } catch (error) {
    console.warn('[PubFlow Web] 版本日志加载失败，已隐藏更新日志', error);
  }
});

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
      <h1>下载 PubFlow 浏览器插件</h1>
      <p>选择适合你浏览器的安装方式，CRX 一键安装，ZIP 离线部署。</p>
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
        <button class="secondary-button compact" type="button" @click.stop="doDownload(item)">
          <Download :size="14" />
          下载
        </button>
      </div>
    </section>
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
