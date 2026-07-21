import { describe, expect, it } from 'vitest';
import {
  createProjectManifest,
  inspectWorkspaceRoot,
  normalizeProjectManifest,
  videoRecordFromDraft,
} from './workspaceStorage';
import type { ContentDraft, VideoRecord } from '../types';

function projectVideo(): VideoRecord {
  return {
    id: 'temporary-video-id',
    projectId: 'project-1',
    title: '项目标题',
    description: '',
    topics: [],
    campaignIds: [],
    platforms: [],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('workspace project identity', () => {
  it('requires the standard version 2 manifest id', () => {
    expect(normalizeProjectManifest({ version: 2, video: projectVideo(), records: [] })).toBeNull();
  });

  it('uses manifest id for the video and all publish records', () => {
    const manifest = normalizeProjectManifest({
      version: 2,
      id: 'project-1',
      updatedAt: '2026-07-19T00:00:00.000Z',
      video: projectVideo(),
      records: [{
        id: 'old-video-id:douyin',
        videoId: 'old-video-id',
        platformId: 'douyin',
        title: '项目标题',
        status: 'published',
      }],
    });

    expect(manifest?.video).toMatchObject({ id: 'project-1', projectId: 'project-1' });
    expect(manifest?.records[0]).toMatchObject({
      id: 'project-1:douyin',
      videoId: 'project-1',
      status: 'published',
    });
  });

  it('writes only canonical project identities', () => {
    const manifest = createProjectManifest({ video: projectVideo() });
    expect(manifest.id).toBe('project-1');
    expect(manifest.video.id).toBe('project-1');
  });
});

function fakeFile(name: string, data: unknown): FileSystemFileHandle {
  return {
    kind: 'file',
    name,
    getFile: async () => ({ text: async () => JSON.stringify(data) }) as File,
  } as FileSystemFileHandle;
}

function fakeDirectory(
  name: string,
  children: Record<string, FileSystemHandle>,
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    async *entries() {
      for (const entry of Object.entries(children)) yield entry;
    },
    async getFileHandle(fileName: string) {
      const entry = children[fileName];
      if (entry?.kind !== 'file') throw new DOMException('Not found', 'NotFoundError');
      return entry as FileSystemFileHandle;
    },
  } as unknown as FileSystemDirectoryHandle;
}

describe('workspace root inspection', () => {
  it('rejects non-empty build directories before saving them as a workspace', async () => {
    const buildDirectory = fakeDirectory('chrome-mv3', {
      'manifest.json': fakeFile('manifest.json', { manifest_version: 3 }),
    });

    await expect(inspectWorkspaceRoot(buildDirectory)).resolves.toMatchObject({
      kind: 'invalid',
    });
  });

  it('accepts a strict v2 workspace root and counts valid project snapshots', async () => {
    const project = createProjectManifest({ video: projectVideo() });
    const workspace = fakeDirectory('workspace', {
      'pubflow-data.json': fakeFile('pubflow-data.json', { version: 2 }),
      projects: fakeDirectory('projects', {
        'project-1': fakeDirectory('project-1', {
          'project.json': fakeFile('project.json', project),
        }),
      }),
    });

    await expect(inspectWorkspaceRoot(workspace)).resolves.toEqual({
      kind: 'existing',
      projectSnapshotCount: 1,
    });
  });
});

describe('videoRecordFromDraft', () => {
  it('resets all platform states for a replica draft', () => {
    const draft = {
      contentType: 'video',
      title: '复刻项目',
      description: '复刻描述',
      topicsText: '#复刻',
      selectedPlatforms: ['douyin'],
      selectedCampaignIds: [],
      projectId: 'replica-project',
      imageCacheIds: ['image-cache'],
      musicName: '复刻音乐',
      visibility: 'private',
      originalDeclare: true,
    } satisfies ContentDraft;
    const existing = projectVideo();
    existing.projectId = 'replica-project';
    existing.platforms = [
      { platformId: 'douyin', status: 'published' },
      { platformId: 'zhihu', status: 'error' },
    ];

    const result = videoRecordFromDraft(draft, existing, { resetPlatformStatuses: true });

    expect(result.platforms.find((item) => item.platformId === 'douyin')?.status).toBe('pending');
    expect(result.platforms.find((item) => item.platformId === 'zhihu')?.status).toBe('skipped');
    expect(result).toMatchObject({
      imageCacheIds: ['image-cache'],
      musicName: '复刻音乐',
      visibility: 'private',
      originalDeclare: true,
    });
  });
});
