<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { VideoRecord } from '../../../src/types';
import PaginationBar from '../components/PaginationBar.vue';

const platformShort: Record<string, string> = { douyin: '抖', xiaohongshu: '红', weixinChannels: '微', bilibili: 'B站', kuaishou: '快', weibo: '博', zhihu: '知' };

const props = defineProps<{
  videoSearch: string;
  filteredVideos: VideoRecord[];
  formatDate: (timestamp?: number) => string;
  formatBytes: (size?: number) => string;
  formatViews: (views?: number) => string;
  getCoverUrlForVideo: (video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) => string;
  getCampaignLabel: (campaignId: string) => string;
  videoViews: (videoId: string) => number;
  videoLikes: (videoId: string) => number;
  videoComments: (videoId: string) => number;
  statusText: (status: string) => string;
  statusClass: (status: string) => string;
}>();

const emit = defineEmits<{
  'update:videoSearch': [value: string];
  openPublish: [];
  openRecords: [];
  syncData: [];
    editVideo: [video: VideoRecord];
    replicateVideo: [video: VideoRecord];
  deleteVideo: [video: VideoRecord];
}>();

const currentPage = ref(1);
const pageSize = ref(20);

watch(() => props.filteredVideos.length, () => { currentPage.value = 1; });

const pagedVideos = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return props.filteredVideos.slice(start, start + pageSize.value);
});
</script>

<template>
  <div class="videos-page">
    <!-- 工具栏 -->
    <div class="toolbar">
      <input
        :value="videoSearch"
        class="search-input"
        placeholder="搜索标题、描述或话题"
        @input="emit('update:videoSearch', ($event.target as HTMLInputElement).value)"
      />
      <div class="toolbar-right">
        <span class="count-label">共 {{ filteredVideos.length }} 条</span>
        <button class="btn-secondary" type="button" @click="emit('syncData')">同步数据</button>
        <button class="btn-primary" type="button" @click="emit('openPublish')">+ 发布视频</button>
      </div>
    </div>

    <!-- 表格 -->
    <div class="table-wrap">
      <table class="v-table">
        <colgroup>
          <col class="col-video">
          <col class="col-content">
          <col class="col-data">
          <col class="col-platforms">
          <col class="col-file">
          <col class="col-actions">
        </colgroup>
        <thead>
          <tr>
            <th>视频</th>
            <th>标题/话题</th>
            <th>数据</th>
            <th>平台状态</th>
            <th>文件</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="video in pagedVideos" :key="video.id" class="table-row">
            <!-- 视频 -->
            <td>
              <div class="video-info">
                <div class="cover-wrap">
                  <img v-if="video.coverFileName" :src="getCoverUrlForVideo(video)" class="cover-img" loading="lazy" />
                  <div v-else class="cover-placeholder">NO</div>
                </div>
                <div class="video-meta">
                  <div class="video-date" :title="`创建于 ${formatDate(video.createdAt)}`">
                    更新 {{ formatDate(video.updatedAt) }}
                  </div>
                  <div class="video-filename">{{ video.videoFileName || '未选择文件' }}</div>
                </div>
              </div>
            </td>
            <!-- 标题/话题 -->
            <td>
              <div class="video-title">{{ video.title }}</div>
              <div class="topic-list">
                <span v-for="t in video.topics.slice(0, 4)" :key="t" class="topic-tag">#{{ t }}</span>
              </div>
              <div v-if="video.campaignIds?.length" class="campaign-list">
                <span v-for="campaignId in video.campaignIds.slice(0, 3)" :key="campaignId" class="campaign-tag">
                  {{ getCampaignLabel(campaignId) }}
                </span>
              </div>
            </td>
            <!-- 数据：三行纵向 -->
            <td>
              <div class="data-rows">
                <div class="data-line"><span class="data-label">播放</span><span class="data-value">{{ formatViews(videoViews(video.id)) || 0 }}</span></div>
                <div class="data-line"><span class="data-label">赞</span><span class="data-value">{{ videoLikes(video.id) || 0 }}</span></div>
                <div class="data-line"><span class="data-label">评</span><span class="data-value">{{ videoComments(video.id) || 0 }}</span></div>
              </div>
            </td>
            <!-- 平台状态 -->
            <td>
              <div class="platforms-grid">
                <span
                  v-for="platform in video.platforms"
                  :key="platform.platformId"
                  class="platform-badge"
                  :class="platform.status === 'published' || platform.status === 'filled' ? 'badge-published' : platform.status === 'error' ? 'badge-error' : platform.status === 'filling' ? 'badge-filling' : platform.status === 'skipped' ? 'badge-skipped' : 'badge-pending'"
                >
                  <span class="status-dot" :class="platform.status === 'published' || platform.status === 'filled' ? 'dot-published' : platform.status === 'error' ? 'dot-error' : platform.status === 'filling' ? 'dot-filling' : platform.status === 'skipped' ? 'dot-skipped' : 'dot-pending'"></span>
                  {{ platformShort[platform.platformId] || platform.platformId }}
                </span>
              </div>
            </td>
            <!-- 文件 -->
            <td>
              <div class="file-name">{{ video.videoFileName || '-' }}</div>
              <div class="file-size">{{ formatBytes(video.videoSize) }}</div>
            </td>
            <!-- 操作 -->
            <td>
              <div class="action-row">
                <button class="act-btn" type="button" @click="emit('editVideo', video)">编辑</button>
                <button class="act-btn act-btn-go" type="button" @click="emit('replicateVideo', video)">复刻</button>
                <button class="act-btn" type="button" @click="emit('openRecords')">记录</button>
                <button class="act-btn act-btn-danger" type="button" @click="emit('deleteVideo', video)">删除</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!filteredVideos.length" class="empty-state">暂无视频记录。</div>
      <PaginationBar
        :total="filteredVideos.length"
        :page="currentPage"
        :page-size="pageSize"
        @update:page="currentPage = $event"
        @update:page-size="pageSize = $event"
      />
    </div>
  </div>
</template>

<style scoped>
/* ===== 页面容器 ===== */
.videos-page {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

/* ===== 工具栏 ===== */
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
}

.search-input {
  width: 288px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  font-size: 14px;
  color: #1e293b;
  background: #fff;
  outline: none;
  transition: border-color 0.15s;
}
.search-input::placeholder {
  color: #94a3b8;
}
.search-input:focus {
  border-color: #6366f1;
  box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
}

.toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.count-label {
  font-size: 12px;
  color: #64748b;
}

.btn-secondary {
  height: 32px;
  padding: 0 14px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  background: #fff;
  font-size: 13px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-secondary:hover {
  background: #f1f5f9;
}

.btn-primary {
  height: 32px;
  padding: 0 14px;
  border: none;
  border-radius: 6px;
  background: #6366f1;
  font-size: 13px;
  font-weight: 600;
  color: #fff;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-primary:hover {
  background: #4f46e5;
}

/* ===== 表格容器 ===== */
.table-wrap {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  overflow-x: auto;
}

.v-table {
  width: 100%;
  min-width: 960px;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 13px;
}

/* ===== 列宽：百分比，随窗口等比缩放 ===== */
.col-video     { width: 17%; }
.col-content   { width: 27%; }
.col-data      { width: 11%; }
.col-platforms { width: 22%; }
.col-file      { width: 10%; }
.col-actions   { width: 13%; }

/* ===== 表头 ===== */
.v-table thead tr {
  background: #f8fafc;
}

.v-table th {
  padding: 10px 12px;
  text-align: left;
  font-size: 11px;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  border-bottom: 1px solid #e2e8f0;
}

/* ===== 行 ===== */
.table-row {
  transition: background 0.1s;
}
.table-row:hover {
  background: #f8fafc;
}

.v-table td {
  padding: 12px;
  vertical-align: middle;
  border-bottom: 1px solid #f1f5f9;
}

/* ===== 视频列 ===== */
.video-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.cover-wrap {
  flex-shrink: 0;
  width: 56px;
  height: 42px;
  overflow: hidden;
  border-radius: 6px;
  background: #f1f5f9;
}

.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.cover-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  font-size: 16px;
  color: #94a3b8;
}

.video-meta {
  min-width: 0;
}

.video-date {
  font-size: 12px;
  color: #64748b;
}

.video-filename {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ===== 标题/话题列 ===== */
.video-title {
  font-weight: 700;
  color: #1e293b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topic-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}

.topic-tag {
  font-size: 10px;
  color: #6366f1;
}

.campaign-list {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.campaign-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: #fffbeb;
  font-size: 10px;
  font-weight: 700;
  color: #b45309;
  border: 1px solid #fde68a;
}

/* ===== 数据列：三行纵向 ===== */
.data-rows {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.data-line {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-size: 12px;
  line-height: 1.3;
}

.data-label {
  width: 28px;
  color: #94a3b8;
  flex-shrink: 0;
  text-align: left;
}

.data-value {
  font-weight: 700;
  color: #0f172a;
}

/* ===== 平台状态列 ===== */
.platforms-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.platform-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
  border: 1px solid transparent;
}

.status-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* 平台状态颜色 */
.badge-published { background: #ecfdf5; color: #047857; border-color: #a7f3d0; }
.badge-error     { background: #fef2f2; color: #b91c1c; border-color: #fecaca; }
.badge-filling   { background: #eff6ff; color: #1d4ed8; border-color: #bfdbfe; }
.badge-skipped   { background: #f1f5f9; color: #94a3b8; border-color: #e2e8f0; }
.badge-pending   { background: #f8fafc; color: #64748b; border-color: #e2e8f0; }

.dot-published { background: #10b981; }
.dot-error     { background: #ef4444; }
.dot-filling   { background: #3b82f6; }
.dot-skipped   { background: #cbd5e1; }
.dot-pending   { background: #94a3b8; }

/* ===== 文件列 ===== */
.file-name {
  font-size: 12px;
  color: #64748b;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  margin-top: 2px;
  font-size: 11px;
  color: #94a3b8;
}

/* ===== 操作列 ===== */
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.act-btn {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  padding: 5px 0;
  text-align: center;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  color: #475569;
  background: #fff;
  border: 1px solid #d1d5db;
  border-radius: 5px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.act-btn:hover {
  border-color: #6366f1;
  color: #4f46e5;
}

.act-btn-go {
  border-color: #bfdbfe;
  background: #eff6ff;
  color: #2563eb;
}
.act-btn-go:hover {
  border-color: #6366f1;
  color: #4f46e5;
}

.act-btn-danger {
  border-color: #fecaca;
  color: #dc2626;
}
.act-btn-danger:hover {
  border-color: #ef4444;
  color: #b91c1c;
}

/* ===== 空状态 ===== */
.empty-state {
  padding: 40px 20px;
  text-align: center;
  font-size: 14px;
  color: #94a3b8;
}
</style>
