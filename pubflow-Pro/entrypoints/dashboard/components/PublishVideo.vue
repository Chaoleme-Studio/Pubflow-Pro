<script setup lang="ts">
import { ref } from 'vue';
import type { ContentDraft } from '../../../src/types';

const props = defineProps<{
  draft: ContentDraft;
  videoUrl: string;
  videoFile: File | null;
}>();

const emit = defineEmits<{
  'update:video': [file: File | null];
}>();

const dragging = ref(false);
const dropError = ref('');

function isVideoFile(file: File) {
  return file.type.startsWith('video/') || /\.(?:mp4|webm|mov|m4v)$/i.test(file.name);
}

function applyVideoFile(file: File | null) {
  if (file && !isVideoFile(file)) {
    dropError.value = '请拖入 mp4、webm 或 mov 视频文件。';
    return;
  }
  dropError.value = '';
  emit('update:video', file);
}

function onVideoChange(e: Event) {
  const input = e.target as HTMLInputElement;
  applyVideoFile(input.files?.[0] || null);
  // 允许连续选择同一个视频文件进行替换。
  input.value = '';
}

function formatBytes(size?: number) {
  if (!size) return '';
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(size / 1024))} KB`;
}

function dragOver(e: DragEvent) {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragging.value = true;
  e.dataTransfer.dropEffect = 'copy';
}

function dragLeave(e: DragEvent) {
  const target = e.currentTarget as HTMLElement;
  const next = e.relatedTarget as Node | null;
  if (next && target.contains(next)) return;
  dragging.value = false;
}

function drop(e: DragEvent) {
  dragging.value = false;
  const file = e.dataTransfer?.files?.[0];
  if (!file) {
    dropError.value = '没有读取到视频文件，请重新拖入。';
    return;
  }
  applyVideoFile(file);
}
</script>

<template>
  <div
    class="relative"
    @dragenter.prevent="dragOver"
    @dragover.prevent="dragOver"
    @dragleave="dragLeave"
    @drop.prevent.stop="drop"
  >
    <div
      v-if="dragging"
      class="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-lg bg-rose-50/95 text-sm font-black text-rose-700 ring-2 ring-inset ring-rose-400"
    >
      松开以加载视频
    </div>
    <!-- 上传区 -->
    <div class="p-4">
      <label
        v-if="!props.videoUrl"
        class="flex cursor-pointer justify-center rounded-lg border-2 border-dashed border-slate-300 bg-[#f7f8fa] px-5 py-6 text-center transition-[border-color,background-color] duration-150 hover:border-rose-400 hover:bg-rose-50/20"
      >
        <input class="hidden" type="file" accept="video/mp4,video/webm,video/quicktime" @change="onVideoChange" />
        <div class="w-full max-w-sm">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-full bg-gradient-to-br from-rose-100 to-rose-200 text-3xl text-rose-500 shadow-sm">
            <svg class="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </div>
          <div class="mt-3 text-base font-black text-slate-950">点击上传 或将视频拖入此区域</div>
          <div class="mt-1.5 text-sm text-slate-500">支持 mp4 / webm / mov，时长 60 分钟内，推荐 9:16 竖屏</div>
          <div class="mx-auto mt-4 w-44 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-rose-600">
            选择视频文件
          </div>
        </div>
      </label>

      <!-- 已上传：视频占满容器 -->
      <div v-else>
        <div class="relative overflow-hidden rounded-lg bg-black">
          <video
            class="block max-h-[480px] w-full object-contain"
            :src="props.videoUrl"
            controls
            preload="metadata"
          />
        </div>
      </div>
      <div v-if="dropError" class="mt-2 text-xs font-semibold text-red-600">{{ dropError }}</div>
    </div>

    <!-- 文件信息 + 替换按钮（在视频框外面） -->
    <div v-if="props.videoUrl" class="flex items-center justify-between border-t border-slate-100 px-4 py-3">
      <div class="flex items-center gap-3 text-sm">
        <span class="font-bold text-slate-800">{{ props.videoFile?.name || props.draft.videoFileName }}</span>
        <span class="text-slate-300">·</span>
        <span class="text-slate-500">{{ formatBytes(props.videoFile?.size || props.draft.videoSize) }}</span>
      </div>
      <label class="cursor-pointer text-xs font-bold text-rose-500 hover:text-rose-600">
        替换视频
        <input class="hidden" type="file" accept="video/mp4,video/webm,video/quicktime" @change="onVideoChange" />
      </label>
    </div>
  </div>
</template>
