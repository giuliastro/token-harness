import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { NodeFileSystem } from '@token-harness/platform';
import { lastDesktopProject, rememberDesktopProject } from '../src/project.js';
const facts: ConstructorParameters<typeof NodeFileSystem>[0] = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'fixture',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

it('reopens the native selected project and falls back safely when it disappears', async () => {
  const root = await mkdtemp(join(tmpdir(), 'th-project-'));
  const fs = new NodeFileSystem(facts);
  const profile = join(root, 'profile'),
    home = join(root, 'home'),
    project = join(root, 'project');
  try {
    await mkdir(home);
    await mkdir(project);
    assert.equal(await lastDesktopProject(fs, profile, home), home);
    await rememberDesktopProject(fs, profile, project);
    assert.equal(await lastDesktopProject(fs, profile, home), await fs.canonicalPath(project));
    await rm(project, { recursive: true });
    assert.equal(await lastDesktopProject(fs, profile, home), home);
    await assert.rejects(rememberDesktopProject(fs, profile, project), /no longer available/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('ignores unreadable, malformed, future and oversized project preferences without rewriting them', async () => {
  const root = await mkdtemp(join(tmpdir(), 'th-project-'));
  const fs = new NodeFileSystem(facts);
  try {
    const preference = join(root, 'project.json');
    for (const content of [
      'broken',
      'null',
      JSON.stringify({ schemaVersion: 2, project: root }),
      ' '.repeat(9000),
    ]) {
      await writeFile(preference, content);
      assert.equal(await lastDesktopProject(fs, root, '/fallback'), '/fallback');
      assert.equal(new TextDecoder().decode(await fs.readFile(preference)), content);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
