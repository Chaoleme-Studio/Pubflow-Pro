import { describe, expect, it } from 'vitest';
import type { ContentData } from '../../types';
import { buildXPostText } from './content';

function content(overrides: Partial<ContentData> = {}): ContentData {
  return {
    title: '',
    description: '',
    topics: [],
    contentType: 'video',
    videoCacheId: '',
    coverCacheId: '',
    imageCacheIds: [],
    visibility: 'public',
    originalDeclare: false,
    scheduledAt: 0,
    campaignIds: [],
    ...overrides,
  };
}

describe('buildXPostText', () => {
  it('组合标题、描述和话题', () => {
    expect(buildXPostText(content({
      title: '标题',
      description: '正文',
      topics: ['科技', '#AI'],
    }))).toBe('标题\n\n正文\n\n#科技 #AI');
  });

  it('按 Unicode 字符截断到 280 字并保留省略号', () => {
    const result = buildXPostText(content({ description: '视'.repeat(281) }));
    expect(Array.from(result)).toHaveLength(280);
    expect(result).toBe(`${'视'.repeat(279)}…`);
  });

  it('不会拆开 emoji 的代理对', () => {
    const result = buildXPostText(content({ description: '🎬'.repeat(281) }));
    expect(Array.from(result)).toHaveLength(280);
    expect(result.endsWith('…')).toBe(true);
  });
});
