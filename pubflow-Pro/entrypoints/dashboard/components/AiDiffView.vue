<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import MarkdownRender from 'markstream-vue';
import 'markstream-vue/index.css';

const props = defineProps<{
  /** 原始 Markdown 文本 */
  original: string;
  /** AI 生成的文本（流式更新） */
  aiResult: string;
  /** 是否正在流式输出 */
  streaming: boolean;
  /** 当前 AI 模式标签 */
  modeLabel: string;
  /** 错误信息 */
  error?: string;
}>();

const emit = defineEmits<{
  apply: [];
  cancel: [];
}>();

const resultRef = ref<HTMLElement | null>(null);
const autoScroll = ref(true);

// 流式输出时自动滚动到底部
watch(() => props.aiResult, () => {
  if (autoScroll.value && resultRef.value) {
    nextTick(() => {
      resultRef.value!.scrollTop = resultRef.value!.scrollHeight;
    });
  }
});

function onResultScroll() {
  if (!resultRef.value) return;
  const { scrollTop, scrollHeight, clientHeight } = resultRef.value;
  autoScroll.value = scrollHeight - scrollTop - clientHeight < 50;
}

const displayResult = computed(() => props.aiResult || (props.streaming ? '' : '等待生成...'));
</script>

<template>
  <div class="flex flex-col rounded-lg border border-indigo-200 bg-indigo-50/50">
    <!-- 标题栏 -->
    <div class="flex items-center justify-between border-b border-indigo-200 px-4 py-2">
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-xs font-medium text-indigo-700">
          AI {{ modeLabel }}
        </span>
        <span v-if="streaming" class="flex items-center gap-1 text-xs text-indigo-500">
          <span class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-400"></span>
          生成中...
        </span>
        <span v-else-if="aiResult" class="text-xs text-green-600">生成完成</span>
      </div>
      <div class="flex items-center gap-2">
        <button
          v-if="streaming"
          class="rounded px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
          type="button"
          @click="emit('cancel')"
        >
          停止
        </button>
        <template v-else-if="aiResult && !error">
          <button
            class="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700"
            type="button"
            @click="emit('apply')"
          >
            应用结果
          </button>
          <button
            class="rounded px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
            type="button"
            @click="emit('cancel')"
          >
            放弃
          </button>
        </template>
        <button
          v-else
          class="rounded px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100"
          type="button"
          @click="emit('cancel')"
        >
          关闭
        </button>
      </div>
    </div>

    <!-- 错误提示 -->
    <div v-if="error" class="mx-4 mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600">
      {{ error }}
    </div>

    <!-- 双栏对比 -->
    <div class="grid min-h-[300px] grid-cols-2 divide-x divide-indigo-200">
      <!-- 左：原文 -->
      <div class="flex flex-col">
        <div class="border-b border-indigo-100 px-4 py-1.5 text-xs font-medium text-slate-500">
          原文
        </div>
        <div class="overflow-y-auto bg-white p-4">
          <MarkdownRender
            :content="original"
            custom-id="ai-diff-original"
            :typewriter="false"
            :max-live-nodes="500"
            :batch-rendering="true"
          />
        </div>
      </div>

      <!-- 右：AI 结果 -->
      <div class="flex flex-col">
        <div class="border-b border-indigo-100 px-4 py-1.5 text-xs font-medium text-indigo-600">
          AI {{ modeLabel }}结果
        </div>
        <div
          ref="resultRef"
          class="overflow-y-auto bg-indigo-50/30 p-4"
          @scroll="onResultScroll"
        >
          <MarkdownRender
            v-if="displayResult"
            :content="displayResult"
            custom-id="ai-diff-result"
            :typewriter="streaming"
            :max-live-nodes="500"
            :batch-rendering="true"
          />
          <div v-else-if="streaming" class="flex items-center gap-2 text-sm text-indigo-400">
            <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-400"></span>
            等待 AI 响应...
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
