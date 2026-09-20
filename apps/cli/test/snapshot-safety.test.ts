import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

import type { CommandContext } from '../src/commands/context.js';
import { repositoryRootForBackupSafety } from '../src/commands/snapshot-safety.js';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

let sandbox = '';

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-repository-safety-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function context(projectRoot: string, home: string): CommandContext {
  const fs = new NodeFileSystem(FACTS);
  return {
    platform: FACTS,
    projectRoot,
    home,
    stateRoot: join(home, '.state', 'token-harness'),
    harness: null,
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: true,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-20T08:00:00.000Z',
    adapters: {
      fs,
      runner: {
        run: () => Promise.reject(new Error('not used')),
      },
      paths: {
        home,
        config: join(home, '.config'),
        data: join(home, '.data'),
        state: join(home, '.state', 'token-harness'),
        cache: join(home, '.cache'),
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  };
}

describe('repositoryRootForBackupSafety', () => {
  it('does not mistake a home-scoped working directory for a repository', async () => {
    const home = join(sandbox, 'plain-home');
    mkdirSync(home, { recursive: true });

    assert.equal(await repositoryRootForBackupSafety(context(home, home)), null);
  });

  it('protects the repository root when the working directory is nested inside it', async () => {
    const home = join(sandbox, 'repo-home');
    const repository = join(home, 'work', 'project');
    const nested = join(repository, 'src', 'feature');
    mkdirSync(join(repository, '.git'), { recursive: true });
    mkdirSync(nested, { recursive: true });

    assert.equal(await repositoryRootForBackupSafety(context(nested, home)), repository);
  });

  it('still protects a home directory when the home itself really is a repository', async () => {
    const home = join(sandbox, 'git-home');
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, '.git'), 'gitdir: elsewhere\n');

    assert.equal(await repositoryRootForBackupSafety(context(home, home)), home);
  });

  it('does not climb above the declared home while looking for repository metadata', async () => {
    const parent = join(sandbox, 'parent-repo');
    const home = join(parent, 'home');
    mkdirSync(join(parent, '.git'), { recursive: true });
    mkdirSync(home, { recursive: true });

    assert.equal(await repositoryRootForBackupSafety(context(home, home)), null);
    assert.notEqual(dirname(home), home);
  });
});
