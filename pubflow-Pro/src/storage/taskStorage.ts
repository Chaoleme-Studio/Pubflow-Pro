import { STORAGE_KEYS } from '../types';
import type { DistributionTask } from '../types';

/** 从 chrome.storage.local 加载当前分发任务。 */
export async function loadCurrentTask(): Promise<DistributionTask | null> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.currentTask);
  return (stored[STORAGE_KEYS.currentTask] as DistributionTask | undefined) || null;
}

/** 将当前分发任务保存到 chrome.storage.local。 */
export async function saveCurrentTask(task: DistributionTask | null) {
  await browser.storage.local.set({ [STORAGE_KEYS.currentTask]: task });
}
