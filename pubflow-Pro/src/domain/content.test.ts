import { describe, expect, it } from 'vitest';
import { normalizeScheduledAt, splitDescriptionAndTopics } from './content';

describe('splitDescriptionAndTopics', () => {
  it('将描述末尾的话题拆出并保持原顺序', () => {
    expect(splitDescriptionAndTopics(
      'AI技术资讯 #AI  #OPC #技术资讯',
      [],
    )).toEqual({
      description: 'AI技术资讯',
      topics: ['AI', 'OPC', '技术资讯'],
    });
  });

  it('合并独立话题并去重', () => {
    expect(splitDescriptionAndTopics(
      '作品描述 #AI #技术资讯',
      ['#AI', 'OPC', '技术资讯'],
    )).toEqual({
      description: '作品描述',
      topics: ['AI', '技术资讯', 'OPC'],
    });
  });

  it('保留没有尾随话题的描述格式', () => {
    expect(splitDescriptionAndTopics('第一行\n第二行', ['AI'])).toEqual({
      description: '第一行\n第二行',
      topics: ['AI'],
    });
  });
});

describe('normalizeScheduledAt', () => {
  it('将工作区恢复出的过期定时时间视为未开启', () => {
    expect(normalizeScheduledAt(1_000, 2_000)).toBe(0);
    expect(normalizeScheduledAt(undefined, 2_000)).toBe(0);
  });

  it('保留未来的定时时间', () => {
    expect(normalizeScheduledAt(3_000, 2_000)).toBe(3_000);
  });
});
