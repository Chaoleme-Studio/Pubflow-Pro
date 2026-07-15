<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { PLATFORM_CONFIGS } from '../../../src/platforms';
import type { PlatformConfig } from '../../../src/platforms';
import type { PlatformId, PublishRecord } from '../../../src/types';
import PaginationBar from '../components/PaginationBar.vue';

const props = defineProps<{
  recordSearch: string;
  recordPlatform: 'all' | PlatformId;
  recordStatus: 'all' | PublishRecord['status'];
  platforms: PlatformConfig[];
  filteredRecords: PublishRecord[];
  getCoverUrlForRecord: (record: Pick<PublishRecord, 'videoId' | 'coverFileName'>) => string;
  formatDate: (timestamp?: number) => string;
  formatViews: (views?: number) => string;
  statusText: (status: string) => string;
  statusClass: (status: string) => string;
}>();

const emit = defineEmits<{
  'update:recordSearch': [value: string];
  'update:recordPlatform': [value: 'all' | PlatformId];
  'update:recordStatus': [value: 'all' | PublishRecord['status']];
  exportRecords: [];
  syncData: [];
  startFromRecord: [record: PublishRecord];
}>();

const currentPage = ref(1);
const pageSize = ref(20);

watch(() => props.filteredRecords.length, () => { currentPage.value = 1; });

const pagedRecords = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value;
  return props.filteredRecords.slice(start, start + pageSize.value);
});

function recordStat(value: number | undefined) {
  return value == null ? '暂无' : props.formatViews(value);
}
</script>

<template>
  <div class="grid gap-5">
    <div class="flex flex-wrap items-center gap-3">
      <input
        :value="recordSearch"
        class="pf-input w-80"
        placeholder="搜索标题或平台"
        @input="emit('update:recordSearch', ($event.target as HTMLInputElement).value)"
      />
      <div class="relative w-36">
        <select
          :value="recordPlatform"
          class="pf-select"
          @change="emit('update:recordPlatform', ($event.target as HTMLSelectElement).value as 'all' | PlatformId)"
        >
          <option value="all">全部平台</option>
          <option v-for="platform in platforms" :key="platform.id" :value="platform.id">{{ platform.name }}</option>
        </select>
        <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <div class="relative w-28">
        <select
          :value="recordStatus"
          class="pf-select"
          @change="emit('update:recordStatus', ($event.target as HTMLSelectElement).value as 'all' | PublishRecord['status'])"
        >
          <option value="all">全部状态</option>
          <option value="published">已发布</option>
          <option value="pending">待发布</option>
          <option value="filled">待确认</option>
          <option value="error">失败</option>
        </select>
        <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-slate-400">
          <svg class="h-4 w-4" viewBox="0 0 20 20" fill="none">
            <path d="M5 7.5l5 5 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
      </div>
      <button class="pf-btn-secondary ml-auto" type="button" @click="emit('exportRecords')">
        导出
      </button>
      <button class="pf-btn-secondary" type="button" @click="emit('syncData')">
        刷新记录
      </button>
    </div>

    <p class="-mt-2 text-xs leading-5 text-slate-500">
      状态和时间来自本地分发任务；播放、赞、评需要平台数据接口或后续采集，尚未同步时显示“暂无”。
    </p>

    <div class="pf-card overflow-x-auto">
      <table class="records-table w-full border-collapse text-left text-sm">
        <colgroup>
          <col class="col-cover">
          <col class="col-platform">
          <col class="col-title">
          <col class="col-link">
          <col class="col-time">
          <col class="col-stat">
          <col class="col-stat">
          <col class="col-stat">
          <col class="col-status">
          <col class="col-action">
        </colgroup>
        <thead class="bg-slate-50 text-xs font-black uppercase text-slate-500">
          <tr>
            <th class="px-4 py-3">封面</th>
            <th class="px-4 py-3">平台</th>
            <th class="px-4 py-3">文章标题</th>
            <th class="px-4 py-3">文章链接</th>
            <th class="px-4 py-3">状态时间</th>
            <th class="px-4 py-3">播放</th>
            <th class="px-4 py-3">赞</th>
            <th class="px-4 py-3">评</th>
            <th class="px-4 py-3">状态</th>
            <th class="px-4 py-3">操作</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="record in pagedRecords" :key="record.id" class="hover:bg-slate-50">
            <td class="px-4 py-3">
              <div class="relative h-10 w-14 shrink-0 overflow-hidden rounded bg-slate-100">
                <img v-if="record.coverFileName" :src="getCoverUrlForRecord(record)" class="h-full w-full object-cover" loading="lazy" />
                <div v-else class="grid h-full w-full place-items-center text-xs text-slate-300">-</div>
              </div>
            </td>
            <td class="px-4 py-3 font-bold text-slate-800 whitespace-nowrap">{{ PLATFORM_CONFIGS[record.platformId].name }}</td>
            <td class="truncate px-4 py-3 text-slate-700">{{ record.title }}</td>
            <td class="px-4 py-3 whitespace-nowrap">
              <a v-if="record.publishedUrl" class="font-bold text-blue-700 hover:underline" :href="record.publishedUrl" target="_blank">链接</a>
              <span v-else class="text-slate-400">-</span>
            </td>
            <td class="px-4 py-3 text-slate-500 whitespace-nowrap">
              <div>{{ formatDate(record.publishedAt || record.updatedAt) }}</div>
              <div class="mt-0.5 text-[10px] text-slate-400">{{ record.publishedAt ? '已发布时间' : '最近状态更新' }}</div>
            </td>
            <td class="px-4 py-3 font-bold text-slate-700 text-right whitespace-nowrap" title="平台互动数据需要后续同步">{{ recordStat(record.stats?.views) }}</td>
            <td class="px-4 py-3 font-bold text-slate-700 text-right whitespace-nowrap" title="平台互动数据需要后续同步">{{ recordStat(record.stats?.likes) }}</td>
            <td class="px-4 py-3 font-bold text-slate-700 text-right whitespace-nowrap" title="平台互动数据需要后续同步">{{ recordStat(record.stats?.comments) }}</td>
            <td class="px-4 py-3 whitespace-nowrap">
              <span class="inline-block rounded px-2.5 py-1 text-xs font-bold ring-1 whitespace-nowrap" :class="statusClass(record.status)">
                {{ statusText(record.status) }}
              </span>
            </td>
            <td class="px-4 py-3 whitespace-nowrap">
              <button class="pf-btn-secondary-sm" type="button" @click="emit('startFromRecord', record)">
                {{ record.status === 'error' ? '重试' : record.status === 'published' ? '查看' : '继续' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <PaginationBar
        :total="filteredRecords.length"
        :page="currentPage"
        :page-size="pageSize"
        @update:page="currentPage = $event"
        @update:page-size="pageSize = $event"
      />
    </div>
  </div>
</template>

<style scoped>
.records-table {
  table-layout: fixed;
  min-width: 960px;
}

.col-cover   { width: 6%; }
.col-platform { width: 8%; }
.col-title   { width: 22%; }
.col-link    { width: 8%; }
.col-time    { width: 13%; }
.col-stat    { width: 7%; }
.col-status  { width: 10%; }
.col-action  { width: 8%; }
</style>
