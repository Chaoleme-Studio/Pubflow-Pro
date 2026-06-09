import { onMounted, onUnmounted, ref } from 'vue';
import { sendRuntimeMessage } from '../../messaging';
import type { DistributionTask, RuntimeMessage } from '../../types';

export function useRuntimeTask() {
  const task = ref<DistributionTask | null>(null);

  async function refreshTask() {
    const response = await sendRuntimeMessage<DistributionTask | null>({ type: 'GET_TASK' });
    if (response.ok) {
      task.value = response.data || null;
    }
  }

  const messageListener = (message: RuntimeMessage) => {
    if (message.type === 'TASK_UPDATED') {
      task.value = message.payload.task;
    }
  };

  onMounted(() => {
    browser.runtime.onMessage.addListener(messageListener);
  });

  onUnmounted(() => {
    browser.runtime.onMessage.removeListener(messageListener);
  });

  return {
    task,
    refreshTask,
  };
}
