import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  TransactionSnapshotStore,
  applyAction,
  type CodexConfigBatchWriteAction,
  type PlatformFacts,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

const FACTS: PlatformFacts = {
  os:
    process.platform === 'win32'
      ? 'windows'
      : process.platform === 'darwin'
        ? 'macos'
        : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

let sandbox = '';

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-codex-model-guard-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

describe('managed Codex model guard', () => {
  it('refuses a subscription-safe batch that mixes model with effort before invoking Codex', async () => {
    const project = join(sandbox, 'project');
    const state = join(sandbox, 'state');
    mkdirSync(project, { recursive: true });
    mkdirSync(state, { recursive: true });
    const path = join(project, 'config.toml');
    const original =
      'model = "gpt-5.6-codex"\nmodel_reasoning_effort = "medium"\n# user comment\n';
    writeFileSync(path, original);

    const fs = new NodeFileSystem(FACTS);
    const snapshots = TransactionSnapshotStore.create({
      fs,
      backupRoot: join(state, 'backups'),
      transactionId: 'model-guard',
      projectRoot: project,
      now: () => '2026-09-07T18:00:00.000Z',
    });
    assert.ok(snapshots.ok, snapshots.ok ? '' : JSON.stringify(snapshots.diagnostics));

    let invoked = false;
    const runner: ProcessRunner = {
      async run() {
        invoked = true;
        throw new Error('Codex must not run for a mixed single-control policy');
      },
    };
    const action: CodexConfigBatchWriteAction = {
      id: 'codex-model-mixed',
      kind: 'codex-config-batch-write',
      riskClass: 'reversible',
      requiresNetwork: false,
      requiresElevation: false,
      affectedPaths: [path],
      affectedProcesses: ['codex'],
      preconditions: [],
      postconditions: [],
      rollbackData: 'file-snapshot',
      explanation: 'test model-only guard',
      path,
      edits: [
        { keyPath: 'model', value: 'gpt-5.6-codex-mini', mergeStrategy: 'replace' },
        { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' },
      ],
      policyGuard: 'subscription-safe',
      modelReference: { requested: 'gpt-5.6-codex-mini', resolution: 'native-catalog' },
      expectedVersion: 'user-v1',
      reloadUserConfig: true,
    };

    const result = await applyAction(action, {
      fs,
      snapshots: snapshots.store,
      runner,
      cwd: project,
    });

    assert.equal(result.status, 'refused');
    assert.equal(result.diagnostics[0]?.code, 'codex-native-policy-mixed-model-edit');
    assert.equal(invoked, false);
    assert.deepEqual(result.snapshots, []);
    assert.equal(readFileSync(path, 'utf8'), original);
  });
});
