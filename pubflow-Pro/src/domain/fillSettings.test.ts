import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TOPIC_INTERVAL_MS,
  MAX_TOPIC_INTERVAL_MS,
  MIN_TOPIC_INTERVAL_MS,
  normalizeTopicIntervalMs,
} from './fillSettings';

describe('normalizeTopicIntervalMs', () => {
  it('使用构建环境注入的 800ms 默认值', () => {
    expect(DEFAULT_TOPIC_INTERVAL_MS).toBe(800);
    expect(normalizeTopicIntervalMs(undefined)).toBe(DEFAULT_TOPIC_INTERVAL_MS);
    expect(normalizeTopicIntervalMs('invalid')).toBe(DEFAULT_TOPIC_INTERVAL_MS);
  });

  it('将可调间隔限制在安全范围内', () => {
    expect(normalizeTopicIntervalMs(20)).toBe(MIN_TOPIC_INTERVAL_MS);
    expect(normalizeTopicIntervalMs('650')).toBe(650);
    expect(normalizeTopicIntervalMs(9000)).toBe(MAX_TOPIC_INTERVAL_MS);
  });
});
