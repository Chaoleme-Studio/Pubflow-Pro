import { onMounted, onUnmounted, ref } from 'vue';
import { sendRuntimeMessage } from '../../messaging';
import type { DistributionTask, RuntimeMessage } from '../../types';

/** 组合式函数：订阅后台分发任务状态。 */
export function useRuntimeTask() {
  const task = ref<DistributionTask | null>(null);

  /** 向后台请求当前任务状态。 */
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
