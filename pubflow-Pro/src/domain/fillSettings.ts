export const DEFAULT_TOPIC_INTERVAL_MS = __PUBFLOW_DEFAULT_TOPIC_INTERVAL_MS__;
export const MIN_TOPIC_INTERVAL_MS = 100;
export const MAX_TOPIC_INTERVAL_MS = 3000;

/** 规范化用户配置的话题步骤间隔。 */
export function normalizeTopicIntervalMs(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TOPIC_INTERVAL_MS;
  return Math.min(MAX_TOPIC_INTERVAL_MS, Math.max(MIN_TOPIC_INTERVAL_MS, Math.round(parsed)));
}
