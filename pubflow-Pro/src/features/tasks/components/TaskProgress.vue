<script setup lang="ts">
import { PLATFORM_CONFIGS } from '../../../platforms';
import { sendRuntimeMessage } from '../../../messaging';
import type { DistributionTask, PlatformId, RuntimeResponse } from '../../../types';

defineProps<{
  task: DistributionTask | null;
  compact?: boolean;
}>();

const emit = defineEmits<{
  updated: [DistributionTask | null];
  notice: [string];
}>();

function statusText(status: string) {
  const map: Record<string, string> = {
    pending: '未开始',
    opening: '打开中',
    waitingUser: '等待处理/确认',
    ready: '可填充',
    filling: '填充中',
    filled: '已填充',
    published: '已发布',
    skipped: '已跳过',
    error: '失败',
  };
  return map[status] || status;
}

function canOpenPlatform(status: string) {
  return ['pending', 'opening', 'waitingUser', 'ready', 'error'].includes(status);
}

function canContinueFill(status: string) {
  return ['opening', 'waitingUser', 'ready', 'error'].includes(status);
}

async function applyAction(action: 'OPEN_PLATFORM' | 'CONTINUE_FILL' | 'SKIP_PLATFORM', platformId: PlatformId) {
  const response = await sendRuntimeMessage<DistributionTask>({
    type: action,
    payload: { platformId },
  });
  handleResponse(response, action);
}

async function applyTaskAction(action: 'PAUSE_TASK' | 'RESUME_TASK') {
  const response = await sendRuntimeMessage<DistributionTask>({
    type: action,
  });
  handleResponse(response, action);
}

function handleResponse(response: RuntimeResponse<DistributionTask>, action: string) {
  if (response.ok) {
    emit('updated', response.data || null);
    if (action === 'CONTINUE_FILL') {
      emit('notice', '已发送填充指令。插件会按拟人节奏填入，不会点击发布。');
    }
    if (action === 'PAUSE_TASK') {
      emit('notice', '任务已暂停。');
    }
    if (action === 'RESUME_TASK') {
      emit('notice', '任务已继续。');
    }
    return;
  }
  emit('notice', response.error || '操作失败');
}
</script>

<template>
  <div v-if="!task" class="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
    暂无任务
  </div>
  <div v-else class="grid gap-3">
    <div class="rounded-lg border border-slate-200 bg-white p-3">
      <div class="text-xs font-bold text-slate-500">当前任务</div>
      <div class="mt-1 truncate text-sm font-black text-slate-950">
        {{ task.content.title || '未命名内容' }}
      </div>
      <div class="mt-2 text-xs text-slate-500">
        #{{ task.id.slice(0, 8) }} · {{ task.status === 'paused' ? '已暂停' : task.status === 'completed' ? '已完成' : '运行中' }}
      </div>
    </div>

    <div
      v-for="item in task.platforms"
      :key="item.platformId"
      class="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      :class="{
        'border-l-4 border-l-amber-500': item.status === 'ready' || item.status === 'waitingUser',
        'border-l-4 border-l-blue-600': item.status === 'filling',
        'border-l-4 border-l-green-600': item.status === 'filled',
        'border-l-4 border-l-red-600': item.status === 'error',
        'border-l-4 border-l-slate-400': item.status === 'pending' || item.status === 'opening' || item.status === 'skipped',
      }"
    >
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <span class="grid h-6 min-w-9 place-items-center rounded-md bg-slate-100 px-2 text-[10px] font-black text-slate-700">
              {{ PLATFORM_CONFIGS[item.platformId].icon }}
            </span>
            <strong class="text-sm text-slate-900">{{ PLATFORM_CONFIGS[item.platformId].name }}</strong>
          </div>
          <div class="mt-1 text-xs font-medium text-slate-500">{{ statusText(item.status) }}</div>
          <div v-if="item.message" class="mt-1 text-xs leading-5 text-slate-500">{{ item.message }}</div>
          <div v-if="item.error" class="mt-1 text-xs leading-5 text-red-600">{{ item.error }}</div>
        </div>
      </div>
      <div class="mt-3 grid gap-2" :class="compact ? 'grid-cols-1' : 'grid-cols-3'">
        <button
          class="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700"
          type="button"
          :disabled="!canOpenPlatform(item.status)"
          @click="applyAction('OPEN_PLATFORM', item.platformId)"
        >
          打开
        </button>
        <button
          class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:border-blue-500"
          type="button"
          :disabled="!canContinueFill(item.status)"
          @click="applyAction('CONTINUE_FILL', item.platformId)"
        >
          继续填充
        </button>
        <button
          class="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-red-400 hover:text-red-600"
          type="button"
          @click="applyAction('SKIP_PLATFORM', item.platformId)"
        >
          跳过
        </button>
      </div>
    </div>

    <div class="grid gap-2 rounded-lg border border-slate-200 bg-white p-3" :class="compact ? 'grid-cols-1' : 'grid-cols-2'">
      <button
        v-if="task.status !== 'paused'"
        class="rounded-md border border-slate-300 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-blue-500 hover:text-blue-700"
        type="button"
        @click="applyTaskAction('PAUSE_TASK')"
      >
        暂停
      </button>
      <button
        v-else
        class="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 hover:border-blue-500"
        type="button"
        @click="applyTaskAction('RESUME_TASK')"
      >
        继续
      </button>
      <button
        class="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-red-400 hover:text-red-600"
        type="button"
        :disabled="!task.platforms[task.currentIndex]"
        @click="task.platforms[task.currentIndex] && applyAction('SKIP_PLATFORM', task.platforms[task.currentIndex].platformId)"
      >
        跳过当前
      </button>
    </div>
  </div>
</template>
