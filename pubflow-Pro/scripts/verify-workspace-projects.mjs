import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const args = process.argv.slice(2);
const workspaceArg = args.find((argument) => argument !== '--' && !argument.startsWith('--'));
const writeIndex = args.includes('--write-index');
if (!workspaceArg) {
  throw new Error('Usage: node scripts/verify-workspace-projects.mjs <workspace-root>');
}

const workspaceRoot = resolve(workspaceArg);
if (basename(workspaceRoot) === 'projects') {
  throw new Error('Expected the workspace root, not the projects directory.');
}

const projectsDir = join(workspaceRoot, 'projects');
if (!existsSync(projectsDir)) {
  throw new Error(`Workspace projects directory does not exist: ${projectsDir}`);
}

const snapshots = [];
const invalid = [];
for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;

  const manifestPath = join(projectsDir, entry.name, 'project.json');
  if (!existsSync(manifestPath)) {
    invalid.push(`${entry.name}: missing project.json`);
    continue;
  }

  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    if (
      manifest?.version !== 2 ||
      typeof manifest.id !== 'string' ||
      !manifest.id.trim() ||
      !manifest.video ||
      !Array.isArray(manifest.video.platforms) ||
      !Array.isArray(manifest.records)
    ) {
      invalid.push(`${entry.name}: invalid version 2 manifest`);
      continue;
    }
    if (manifest.deletedAt) continue;

    snapshots.push({
      directory: entry.name,
      projectId: manifest.id.trim(),
      title: String(manifest.video.title || ''),
      contentType: String(manifest.video.contentType || 'video'),
      updatedAt: Date.parse(manifest.updatedAt) || Number(manifest.video.updatedAt) || 0,
      statuses: manifest.video.platforms.map((platform) => platform.status),
    });
  } catch (error) {
    invalid.push(`${entry.name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const projects = new Map();
for (const snapshot of snapshots.sort((a, b) => b.updatedAt - a.updatedAt)) {
  const existing = projects.get(snapshot.projectId);
  if (!existing) {
    projects.set(snapshot.projectId, snapshot);
    continue;
  }
  const published = new Set([
    ...existing.statuses.filter((status) => status === 'published'),
    ...snapshot.statuses.filter((status) => status === 'published'),
  ]);
  if (published.size) existing.hasPublishedSnapshot = true;
}

const ordered = [...projects.values()].sort((a, b) => b.updatedAt - a.updatedAt);
for (const project of ordered) {
  if (project.projectId.startsWith('demo-') || project.projectId.startsWith('v-demo-')) continue;
  console.log([
    project.projectId,
    project.contentType,
    project.title,
    project.directory,
    project.statuses.join(','),
  ].join('\t'));
}

console.log(`snapshots=${snapshots.length}`);
console.log(`logicalProjects=${projects.size}`);
console.log(`invalidDirectories=${invalid.length}`);

if (invalid.length) {
  invalid.forEach((message) => console.error(message));
  process.exitCode = 1;
} else if (writeIndex) {
  const dataFilePath = join(workspaceRoot, 'pubflow-data.json');
  if (!existsSync(dataFilePath)) {
    throw new Error(`Workspace data file does not exist: ${dataFilePath}`);
  }
  const data = JSON.parse(readFileSync(dataFilePath, 'utf8'));
  data.projectIndex = ordered.map((project) => ({
    projectId: project.projectId,
    path: `projects/${project.directory}`,
    title: project.title,
    updatedAt: project.updatedAt,
  }));
  data.updatedAt = new Date().toISOString();
  const temporaryPath = `${dataFilePath}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(data, null, 2)}\n`);
  renameSync(temporaryPath, dataFilePath);
  console.log(`projectIndexWritten=${data.projectIndex.length}`);
}
