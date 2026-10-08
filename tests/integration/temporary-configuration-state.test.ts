/** Filesystem and mutation invariants, exercised on each native CI platform. */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, it } from 'node:test';
import {
  previewFilePlan,
  fileFingerprint,
  fingerprintMatches,
  FileJournalStore,
  TransactionSnapshotStore,
  executeTransaction,
  rollbackTransaction,
  readMutationLease,
  type PlatformFacts,
  type WriteOwnedFileAction,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

const ROOT = mkdtempSync(join(tmpdir(), 'th-temporary-state-'));
after(() => rmSync(ROOT, { recursive: true, force: true }));
const facts: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
const fs = new NodeFileSystem(facts);
const text = new TextEncoder();
let serial = 0;
function scope() {
  const path = join(ROOT, String(++serial));
  mkdirSync(path);
  return path;
}
function action(path: string): WriteOwnedFileAction {
  return {
    kind: 'write-owned-file',
    id: 'create',
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [path],
    affectedProcesses: [],
    preconditions: [],
    postconditions: [],
    rollbackData: 'file-snapshot',
    explanation: 'Fixture file',
    path,
    content: 'complete config',
    mode: null,
    expectedDigest: null,
  };
}

it('exclusive creation admits exactly one concurrent writer and never overwrites the winner', async () => {
  const root = scope(),
    path = join(root, 'lease.json');
  const writes = await Promise.all(
    Array.from({ length: 20 }, (_, i) => fs.writeFileExclusive(path, text.encode('writer-' + i))),
  );
  assert.equal(writes.filter(Boolean).length, 1);
  const winner = readFileSync(path, 'utf8');
  assert.equal(winner, 'writer-' + writes.findIndex(Boolean));
  assert.equal(await fs.writeFileExclusive(path, text.encode('overwrite')), false);
  assert.equal(readFileSync(path, 'utf8'), winner);
});

it('atomic checkpoints expose only whole old or new documents and retain the target when replacement fails', async () => {
  const root = scope(),
    path = join(root, 'checkpoint');
  const first = 'A'.repeat(32768),
    second = 'B'.repeat(65536);
  await fs.atomicWriteFile(path, text.encode(first));
  let done = false;
  const reads = (async () => {
    while (!done) {
      const value = new TextDecoder().decode(await fs.readFile(path));
      assert.ok(value === first || value === second);
    }
  })();
  try {
    for (let i = 0; i < 20; i++)
      await fs.atomicWriteFile(path, text.encode(i % 2 === 0 ? second : first));
  } finally {
    done = true;
    await reads;
  }
  const directory = join(root, 'directory');
  mkdirSync(directory);
  writeFileSync(join(directory, 'user-data'), 'preserved');
  await assert.rejects(() => fs.atomicWriteFile(directory, text.encode('replacement')));
  assert.equal(readFileSync(join(directory, 'user-data'), 'utf8'), 'preserved');
  assert.deepEqual(readdirSync(root).sort(), ['checkpoint', 'directory']);
});

it('previews exact file and implicit-directory images without host writes and rejects process/network actions', async () => {
  const root = scope(),
    path = join(root, 'new-parent', 'nested', 'config.json');
  const before = readdirSync(root);
  const preview = await previewFilePlan(fs, [action(path)]);
  assert.deepEqual(readdirSync(root), before);
  assert.equal(preview.before.length, 3);
  assert.ok(preview.before.every((f) => f.kind === 'absent'));
  assert.equal(preview.prefixes[1]!.find((f) => f.path === path)!.kind, 'file');
  assert.equal(new TextDecoder().decode(await preview.fs.readFile(path)), 'complete config');
  await assert.rejects(() => previewFilePlan(fs, [{ ...action(path), requiresNetwork: true }]));
  await assert.rejects(() =>
    previewFilePlan(fs, [
      { ...action(path), kind: 'run-installer-command', executable: 'fixture', args: [] } as never,
    ]),
  );
});

it('directory fingerprints detect an added child and platform modes remain explicit', async () => {
  const root = scope();
  const before = await fileFingerprint(fs, root);
  writeFileSync(join(root, 'user-data'), 'keep');
  assert.equal(fingerprintMatches(before, await fileFingerprint(fs, root)), false);
  assert.equal((await fileFingerprint(fs, join(root, 'absent'))).mode, null);
  if (facts.os === 'windows')
    assert.equal((await fileFingerprint(fs, join(root, 'user-data'))).mode, null);
});

it('a machine-local lease blocks the transaction engine and rollback before journal or target writes', async () => {
  const root = scope(),
    state = join(root, 'state');
  mkdirSync(state);
  const lease = {
    schemaVersion: 1,
    transactionId: 'factorial-' + 'a'.repeat(24),
    benchmarkId: 'active',
    variant: 'combined',
    projectId: 'p_test',
    acquiredAt: '2026-10-05T10:00:00Z',
  };
  writeFileSync(join(state, 'mutation-lease.json'), JSON.stringify(lease));
  assert.equal((await readMutationLease(fs, state))!.transactionId, lease.transactionId);
  const journal = new FileJournalStore({
    fs,
    journalRoot: join(state, 'journals'),
    backupRoot: join(state, 'backups'),
  });
  const snapshots = TransactionSnapshotStore.create({
    fs,
    backupRoot: join(state, 'backups'),
    transactionId: 'other',
    projectRoot: null,
    now: () => lease.acquiredAt,
  });
  assert.ok(snapshots.ok);
  const path = join(root, 'config');
  const result = await executeTransaction({
    transactionId: 'other',
    planId: 'fixture',
    projectId: 'p_test',
    projectRoot: root,
    actions: [action(path)],
    fs,
    journal,
    snapshots: snapshots.store,
    now: () => lease.acquiredAt,
  });
  assert.equal(result.exitCode, 5);
  assert.equal(await fs.stat(path), null);
  assert.equal(await journal.read('other'), null);
  assert.equal(snapshots.store.captured.length, 0);
  const rollback = await rollbackTransaction({
    transactionId: 'other',
    fs,
    journal,
    snapshots: snapshots.store,
    now: () => lease.acquiredAt,
  });
  assert.equal(rollback.exitCode, 5);
  const ownRollback = await rollbackTransaction({
    transactionId: lease.transactionId,
    fs,
    journal,
    snapshots: snapshots.store,
    now: () => lease.acquiredAt,
  });
  assert.equal(ownRollback.exitCode, 5);
  assert.equal((await journal.checkMutationAllowed(lease.transactionId)).length, 0);
  for (const bad of [
    null,
    { ...lease, variant: '../../bad' },
    { ...lease, transactionId: '../bad' },
  ]) {
    writeFileSync(join(state, 'mutation-lease.json'), JSON.stringify(bad));
    assert.equal(
      (await journal.checkMutationAllowed(lease.transactionId))[0]!.code,
      'mutation-lease-unreadable',
    );
  }
});
