<script setup lang="ts">
import TaskProgress from '../../../src/features/tasks/components/TaskProgress.vue';
import { PLATFORM_CONFIGS } from '../../../src/platforms';
import type { DistributionTask, PlatformId, PublishRecord, VideoRecord } from '../../../src/types';
import DashboardCharts from '../components/DashboardCharts.vue';

defineProps<{
  todayPublished: number;
  waitingConfirm: number;
  monthPublished: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  topVideos: VideoRecord[];
  platformSummaries: Array<{
    platformId: PlatformId;
    published: number;
    pending: number;
    error: number;
    views: number;
  }>;
  records: PublishRecord[];
  activeTasks: Array<{
    id: string;
    title: string;
    detail: string;
    status: string;
  }>;
  recentRecords: PublishRecord[];
  task: DistributionTask | null;
  formatDate: (timestamp?: number) => string;
  formatBytes: (size?: number) => string;
  formatViews: (views?: number) => string;
  getCoverUrlForVideo: (video: Pick<VideoRecord, 'projectId' | 'coverFileName'>) => string;
  videoViews: (videoId: string) => number;
  videoLikes: (videoId: string) => number;
  videoComments: (videoId: string) => number;
  statusText: (status: string) => string;
}>();

const emit = defineEmits<{
  openVideos: [];
  startFromVideo: [video: VideoRecord];
  toggleSidePanel: [];
  taskUpdated: [task: DistributionTask | null];
  notice: [message: string];
}>();
</script>

<template>
  <div class="grid gap-5">
    <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <div v-for="card in [
        { label: '今日发布', value: todayPublished, color: 'text-rose-600' },
        { label: '待确认', value: waitingConfirm, color: 'text-amber-600' },
        { label: '本月累计', value: monthPublished, color: 'text-blue-600' },
        { label: '总播放', value: totalViews, color: 'text-slate-900', format: true },
        { label: '总点赞', value: totalLikes, color: 'text-emerald-600', format: true },
        { label: '总评论', value: totalComments, color: 'text-violet-600', format: true },
      ]" :key="card.label" class="pf-card px-4 py-3">
        <div class="text-xs font-bold text-slate-500">{{ card.label }}</div>
        <div class="mt-1 text-xl font-black" :class="card.color">
          {{ card.format ? (card.value >= 10000 ? `${(card.value / 10000).toFixed(1)}w` : card.value) : card.value }}
        </div>
      </div>
    </div>

    <div class="grid min-w-0 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <div class="grid min-w-0 gap-5">
        <DashboardCharts
          :records="records"
          :platform-summaries="platformSummaries"
          :format-views="formatViews"
        />

        <section class="pf-card min-w-0 overflow-hidden">
          <div class="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <h2 class="pf-section-title">近期视频</h2>
            <button class="text-xs font-bold text-blue-600 hover:text-blue-700" type="button" @click="emit('openVideos')">查看全部</button>
          </div>
          <div class="divide-y divide-slate-100">
            <div v-for="video in topVideos" :key="video.id" class="grid grid-cols-[64px_minmax(0,1fr)_auto_64px] items-center gap-3 px-4 py-3 hover:bg-slate-50 sm:grid-cols-[92px_minmax(0,1fr)_240px_72px] sm:gap-4 sm:px-5">
              <div class="relative h-14 w-20 shrink-0 overflow-hidden rounded bg-slate-100">
                <img v-if="video.coverFileName" :src="getCoverUrlForVideo(video)" class="h-full w-full object-cover" loading="lazy" />
                <div v-else class="grid h-full w-full place-items-center text-[10px] font-black text-slate-400">NO FILE</div>
              </div>
              <div class="min-w-0">
                <div class="truncate text-sm font-bold text-slate-900">{{ video.title }}</div>
                <div class="mt-1 flex items-center gap-3 text-xs text-slate-500">
                  <span :title="`创建于 ${formatDate(video.createdAt)}`">更新 {{ formatDate(video.updatedAt) }}</span>
                  <span>{{ video.videoFileName || '未选择文件' }}</span>
                  <span>{{ formatBytes(video.videoSize) }}</span>
                </div>
              </div>
              <div class="hidden grid-cols-3 gap-2 text-center text-xs sm:grid">
                <div><strong class="block text-slate-900">{{ formatViews(videoViews(video.id)) }}</strong><span class="text-slate-400">播放</span></div>
                <div><strong class="block text-slate-900">{{ videoLikes(video.id) }}</strong><span class="text-slate-400">点赞</span></div>
                <div><strong class="block text-slate-900">{{ videoComments(video.id) }}</strong><span class="text-slate-400">评论</span></div>
              </div>
              <button class="shrink-0 text-xs font-bold text-blue-600 hover:text-blue-700" type="button" @click="emit('startFromVideo', video)">
                {{ video.platforms.some(p => p.status === 'pending') ? '继续' : '重发' }}
              </button>
            </div>
            <div v-if="!topVideos.length" class="px-5 py-8 text-center text-sm text-slate-400">暂无视频，去发布页创建第一个吧。</div>
          </div>
        </section>

        <section class="pf-card">
          <div class="border-b border-slate-100 px-5 py-3">
            <h2 class="pf-section-title">平台分布</h2>
          </div>
          <div class="grid grid-cols-4 gap-0 divide-x divide-y divide-slate-100">
            <div v-for="summary in platformSummaries" :key="summary.platformId" class="p-4">
              <div class="flex items-center justify-between">
                <span class="text-xs font-black text-slate-800">{{ PLATFORM_CONFIGS[summary.platformId].name }}</span>
                <span class="text-[10px] text-slate-400">{{ PLATFORM_CONFIGS[summary.platformId].icon }}</span>
              </div>
              <div class="mt-2 text-lg font-black text-slate-950">{{ formatViews(summary.views) }}</div>
              <div class="mt-2 flex gap-2 text-[11px] text-slate-500">
                <span>已发 {{ summary.published }}</span>
                <span>待发 {{ summary.pending }}</span>
                <span>失败 {{ summary.error }}</span>
              </div>
            </div>
          </div>
        </section>
      </div>

      <aside class="grid h-fit gap-4 xl:grid-cols-3 2xl:grid-cols-1">
        <div class="pf-card-padded-sm">
          <h2 class="pf-section-title">进行中的任务</h2>
          <div v-if="activeTasks.length" class="mt-3 grid gap-2">
            <div v-for="item in activeTasks" :key="item.id" class="rounded-md border border-slate-100 bg-slate-50 p-3">
              <div class="text-xs font-bold text-slate-500">#{{ item.id }}</div>
              <div class="mt-1 truncate text-sm font-black text-slate-900">{{ item.title }}</div>
              <div class="mt-1 text-xs text-slate-500">{{ item.detail }} · {{ statusText(item.status) }}</div>
            </div>
          </div>
          <p v-else class="mt-3 text-xs text-slate-400">暂无运行任务。</p>
        </div>
        <div class="pf-card-padded-sm">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="pf-section-title">Side Panel 进度</h2>
            <button class="text-xs font-bold text-blue-600 hover:text-blue-700" type="button" @click="emit('toggleSidePanel')">打开</button>
          </div>
          <TaskProgress compact :task="task" @updated="emit('taskUpdated', $event)" @notice="emit('notice', $event)" />
        </div>
        <div class="pf-card">
          <div class="border-b border-slate-100 px-4 py-3">
            <h2 class="pf-section-title">最新发布</h2>
          </div>
          <div class="divide-y divide-slate-100">
            <div v-for="record in recentRecords" :key="record.id" class="px-4 py-2.5">
              <div class="flex items-center justify-between gap-3">
                <div class="min-w-0 truncate text-xs font-bold text-slate-800">{{ record.title }}</div>
                <span class="shrink-0 text-[11px] text-slate-400">{{ PLATFORM_CONFIGS[record.platformId].name }}</span>
              </div>
              <div class="mt-1 flex items-center justify-between text-[11px] text-slate-500">
                <span>{{ record.publishedAt ? '发布' : '更新' }} {{ formatDate(record.publishedAt || record.updatedAt) }}</span>
                <span>{{ record.stats?.views == null ? '互动数据未同步' : `${formatViews(record.stats.views)} 阅读` }}</span>
              </div>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>
</template>
