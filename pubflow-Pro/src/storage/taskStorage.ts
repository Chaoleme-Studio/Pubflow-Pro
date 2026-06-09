import { STORAGE_KEYS } from '../types';
import type { DistributionTask } from '../types';

export async function loadCurrentTask(): Promise<DistributionTask | null> {
  const stored = await browser.storage.local.get(STORAGE_KEYS.currentTask);
  return (stored[STORAGE_KEYS.currentTask] as DistributionTask | undefined) || null;
}

export async function saveCurrentTask(task: DistributionTask | null) {
  await browser.storage.local.set({ [STORAGE_KEYS.currentTask]: task });
}
