<script setup lang="ts">
import { Check, Chrome, Download, FileArchive } from 'lucide-vue-next';
import { ref } from 'vue';

interface DownloadItem {
  id: string;
  name: string;
  desc: string;
  icon: typeof Chrome;
  href: string;
  fileName: string;
  badge: string;
}

const downloads: DownloadItem[] = [
  {
    id: 'crx',
    name: 'Chrome 扩展 (CRX)',
    desc: '直接拖入 Chrome 浏览器安装，适合日常使用。',
    icon: Chrome,
    href: '/downloads/pubflow-pro.crx',
    fileName: 'pubflow-pro.crx',
    badge: '推荐',
  },
  {
    id: 'zip',
    name: '离线包 (ZIP)',
    desc: '解压后通过开发者模式加载，适合企业内网部署。',
    icon: FileArchive,
    href: '/downloads/pubflow-pro.zip',
    fileName: 'pubflow-pro.zip',
    badge: '离线',
  },
];

const selectedId = ref('crx');
const activeItem = () => downloads.find((d) => d.id === selectedId.value) || downloads[0];

function doDownload(item: DownloadItem) {
  if (!item.href) return;
  const a = document.createElement('a');
  a.href = item.href;
  a.download = item.fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
</script>

<template>
  <main class="download-page">
    <section class="download-hero">
      <p class="eyebrow">Download Center</p>
      <h1>下载 PubFlow 浏览器插件。</h1>
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
  </main>
</template>
