import { describe, expect, it } from 'vitest';
import type { VideoRecord } from '../types';
import { deduplicateVideos, mergeRecordsFromVideos } from './libraryStorage';

function video(overrides: Partial<VideoRecord>): VideoRecord {
  return {
    id: 'video-1',
    title: '测试视频',
    description: '',
    topics: [],
    campaignIds: [],
    videoFileName: 'same-video.mp4',
    projectId: 'project-1',
    platforms: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

describe('deduplicateVideos', () => {
  it('keeps separate publication records even when file and project metadata match', () => {
    const result = deduplicateVideos([
      video({ id: 'project-1', projectId: 'project-1', updatedAt: 10 }),
      video({ id: 'project-2', projectId: 'project-2', updatedAt: 20 }),
    ]);

    expect(result.map((item) => item.id)).toEqual(['project-2', 'project-1']);
  });

  it('still merges duplicated snapshots of the same record id', () => {
    const result = deduplicateVideos([
      video({
        id: 'project-1',
        updatedAt: 10,
        platforms: [{ platformId: 'douyin', status: 'published', publishedUrl: 'https://example.test/1' }],
      }),
      video({
        id: 'project-1',
        title: '较新的标题',
        updatedAt: 20,
        platforms: [{ platformId: 'douyin', status: 'pending' }],
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('较新的标题');
    expect(result[0].platforms[0]).toMatchObject({
      status: 'published',
      publishedUrl: 'https://example.test/1',
    });
  });

  it('merges snapshots when project id matches', () => {
    const result = deduplicateVideos([
      video({ id: 'shared-video', projectId: 'same-project', updatedAt: 10 }),
      video({ id: 'shared-video', projectId: 'same-project', title: '最新快照', updatedAt: 20 }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('最新快照');
  });

  it('keeps a published status even when the platform did not return a URL', () => {
    const result = deduplicateVideos([
      video({
        updatedAt: 10,
        platforms: [{ platformId: 'douyin', status: 'published' }],
      }),
      video({
        updatedAt: 20,
        platforms: [{ platformId: 'douyin', status: 'pending' }],
      }),
    ]);

    expect(result[0].platforms[0].status).toBe('published');
  });
});

describe('mergeRecordsFromVideos', () => {
  it('records filled platforms as waiting for confirmation with a status timestamp', () => {
    const result = mergeRecordsFromVideos([
      video({
        id: 'publication-1',
        updatedAt: 1234,
        platforms: [{ platformId: 'douyin', status: 'filled' }],
      }),
    ], []);

    expect(result).toEqual([
      expect.objectContaining({
        videoId: 'publication-1',
        platformId: 'douyin',
        status: 'filled',
        updatedAt: 1234,
      }),
    ]);
  });

  it('migrates legacy pending records generated from a filled platform', () => {
    const source = video({
      id: 'publication-1',
      updatedAt: 2000,
      platforms: [{ platformId: 'douyin', status: 'filled' }],
    });
    const result = mergeRecordsFromVideos([source], [{
      id: 'publication-1:douyin',
      videoId: 'publication-1',
      platformId: 'douyin',
      title: source.title,
      status: 'pending',
    }]);

    expect(result[0]).toMatchObject({ status: 'filled', updatedAt: 2000 });
  });
});
