<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import TaskProgress from '../../src/features/tasks/components/TaskProgress.vue';
import { useRuntimeTask } from '../../src/features/tasks/useRuntimeTask';

const { task, refreshTask } = useRuntimeTask();
const notice = ref('');
let sidePanelPort: Browser.runtime.Port | null = null;

async function openDashboard() {
  const url = browser.runtime.getURL('dashboard.html' as never);
  const tabs = await browser.tabs.query({ url });
  if (tabs[0]?.id) {
    await browser.tabs.update(tabs[0].id, { active: true });
    if (tabs[0].windowId) {
      await browser.windows.update(tabs[0].windowId, { focused: true });
    }
    return;
  }
  await browser.tabs.create({ url, active: true });
}

onMounted(async () => {
  sidePanelPort = browser.runtime.connect({ name: 'pubflow-sidepanel' });
  await refreshTask();
});

onUnmounted(() => {
  sidePanelPort?.disconnect();
  sidePanelPort = null;
});
</script>

<template>
  <main class="min-h-screen bg-slate-100 p-3">
    <header class="mb-3 rounded-lg border border-slate-200 bg-white p-3">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h1 class="text-lg font-bold text-slate-950">PubFlow 分发进度</h1>
          <p class="mt-1 text-xs leading-5 text-slate-500">查看当前任务、处理平台状态，并快速回到 Dashboard。</p>
        </div>
      </div>
      <button
        class="mt-3 w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        type="button"
        @click="openDashboard"
      >
        打开 Dashboard
      </button>
    </header>

    <section class="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div class="mb-3">
        <h2 class="text-sm font-bold text-slate-900">平台队列</h2>
        <p class="mt-1 text-xs leading-5 text-slate-500">平台页不会自动发布。填充完成后仍由用户确认。</p>
      </div>
      <TaskProgress compact :task="task" @updated="task = $event" @notice="notice = $event" />
      <p v-if="notice" class="mt-3 rounded-md bg-blue-50 p-3 text-xs leading-5 text-blue-800">{{ notice }}</p>
    </section>
  </main>
</template>
