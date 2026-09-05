/**
 * Snapshots against a real filesystem — RFC 0004 §Backup policy.
 *
 * These run against `NodeFileSystem` in a temporary directory rather than against an
 * in-memory double. Every guarantee in the RFC is byte-for-byte, and an in-memory
 * filesystem is exactly where a byte-for-byte bug hides: it has no encoding, no
 * permission bits, and no line endings of its own.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import { TransactionSnapshotStore, digestBytes, type PlatformFacts } from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

const NATIVE_WINDOWS = process.platform === 'win32';

const FACTS: PlatformFacts = {
  os: NATIVE_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const CLOCK = '2026-07-29T10:12:04.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-snap-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Harness {
  store: TransactionSnapshotStore;
  fs: NodeFileSystem;
  project: string;
  state: string;
}

function harness(): Harness {
  counter += 1;
  const root = join(sandbox, `case-${String(counter)}`);
  const project = join(root, 'project');
  const state = join(root, 'state');
  mkdirSync(project, { recursive: true });
  mkdirSync(state, { recursive: true });
  const fs = new NodeFileSystem(FACTS);
  const created = TransactionSnapshotStore.create({
    fs,
    backupRoot: join(state, 'backups'),
    transactionId: 't-0001',
    projectRoot: project,
    now: () => CLOCK,
  });
  assert.ok(created.ok, created.ok ? '' : JSON.stringify(created.diagnostics));
  return { store: created.store, fs, project, state };
}

describe('capturing', () => {
  it('records path, digest, permissions, and content', async () => {
    const { store, project } = harness();
    const target = join(project, 'settings.json');
    const content = Buffer.from('{ "hooks": [] }\n', 'utf8');
    writeFileSync(target, content);

    const snapshot = await store.capture(target);
    assert.equal(snapshot.path, target);
    assert.equal(snapshot.existed, true);
    assert.equal(snapshot.wasDirectory, false);
    assert.equal(snapshot.digest, digestBytes(new Uint8Array(content)));
    assert.equal(snapshot.byteLength, content.byteLength);
    assert.equal(snapshot.capturedAt, CLOCK);
    assert.notEqual(snapshot.contentRef, null);
    assert.equal(snapshot.mode === null, NATIVE_WINDOWS);
  });

  it('records the absence of a file that does not exist yet', async () => {
    const { store, project } = harness();
    const snapshot = await store.capture(join(project, 'not-yet.md'));
    // RFC 0004: "absence is the state rollback must restore".
    assert.equal(snapshot.existed, false);
    assert.equal(snapshot.digest, null);
    assert.equal(snapshot.contentRef, null);
  });

  it('writes the bytes beside a record a human can read', async () => {
    const { store, project, fs } = harness();
    const target = join(project, 'AGENTS.md');
    writeFileSync(target, 'user content\n');
    const snapshot = await store.capture(target);

    assert.notEqual(snapshot.contentRef, null);
    const stored = readFileSync(join(store.directory, snapshot.contentRef ?? ''), 'utf8');
    assert.equal(stored, 'user content\n');

    const records = (await fs.readDirectory(store.directory)).filter((name) =>
      name.endsWith('.json'),
    );
    assert.equal(records.length, 1);
    const parsed = JSON.parse(readFileSync(join(store.directory, records[0] ?? ''), 'utf8')) as {
      path: string;
    };
    assert.equal(parsed.path, target);
  });

  it('keeps two captures of different files apart', async () => {
    const { store, project } = harness();
    writeFileSync(join(project, 'a.md'), 'a\n');
    writeFileSync(join(project, 'b.md'), 'b\n');
    const first = await store.capture(join(project, 'a.md'));
    const second = await store.capture(join(project, 'b.md'));
    assert.notEqual(first.contentRef, second.contentRef);
  });

  it('reuses the initial snapshot when two actions mutate the same path', async () => {
    const { store, project } = harness();
    const target = join(project, 'settings.json');
    writeFileSync(target, 'original\n');

    const first = await store.capture(target);
    writeFileSync(target, 'after first action\n');
    const second = await store.capture(target);
    writeFileSync(target, 'after second action\n');

    assert.deepEqual(second, first);
    assert.equal(store.captured.length, 1);
    await store.restoreAll(store.captured);
    assert.equal(readFileSync(target, 'utf8'), 'original\n');
  });

  it('captures a directory as a directory', async () => {
    const { store, project } = harness();
    const dir = join(project, 'nested');
    mkdirSync(dir);
    const snapshot = await store.capture(dir);
    assert.equal(snapshot.existed, true);
    assert.equal(snapshot.wasDirectory, true);
    assert.equal(snapshot.contentRef, null);
  });
});

describe('restoring', () => {
  it('puts content back byte-for-byte, including bytes that are not text', async () => {
    const { store, project } = harness();
    const target = join(project, 'binary.dat');
    const original = Buffer.from([0x00, 0xff, 0xfe, 0x0d, 0x0a, 0x80, 0x41]);
    writeFileSync(target, original);

    const snapshot = await store.capture(target);
    writeFileSync(target, Buffer.from('destroyed'));
    await store.restore(snapshot);

    assert.deepEqual(readFileSync(target), original);
  });

  it('preserves CRLF and a byte-order mark', async () => {
    const { store, project } = harness();
    const target = join(project, 'crlf.md');
    const original = Buffer.from('﻿line one\r\nline two\r\n', 'utf8');
    writeFileSync(target, original);

    const snapshot = await store.capture(target);
    writeFileSync(target, Buffer.from('line one\nline two\n', 'utf8'));
    await store.restore(snapshot);

    assert.deepEqual(readFileSync(target), original);
  });

  it('restores an absence by deleting what was created', async () => {
    const { store, project } = harness();
    const target = join(project, 'created.md');
    const snapshot = await store.capture(target);
    writeFileSync(target, 'created by an action\n');

    await store.restore(snapshot);
    assert.equal(statSync(target, { throwIfNoEntry: false }), undefined);
  });

  it('restores an absence even when a whole directory tree was created', async () => {
    const { store, project } = harness();
    const target = join(project, 'tree');
    const snapshot = await store.capture(target);
    mkdirSync(join(target, 'deep', 'deeper'), { recursive: true });
    writeFileSync(join(target, 'deep', 'deeper', 'file.txt'), 'x');

    await store.restore(snapshot);
    assert.equal(statSync(target, { throwIfNoEntry: false }), undefined);
  });

  it('is idempotent, so a second rollback attempt is not a new failure', async () => {
    const { store, project } = harness();
    const target = join(project, 'gone.md');
    const snapshot = await store.capture(target);
    await store.restore(snapshot);
    await store.restore(snapshot);
    assert.equal(statSync(target, { throwIfNoEntry: false }), undefined);
  });

  it('restores in reverse order, so a directory goes after its contents', async () => {
    const { store, project } = harness();
    const dir = join(project, 'made');
    const file = join(dir, 'inside.txt');

    const dirSnapshot = await store.capture(dir);
    mkdirSync(dir);
    const fileSnapshot = await store.capture(file);
    writeFileSync(file, 'x');

    await store.restoreAll([dirSnapshot, fileSnapshot]);
    assert.equal(statSync(dir, { throwIfNoEntry: false }), undefined);
  });

  it(
    'restores the POSIX mode along with the content',
    {
      skip: NATIVE_WINDOWS ? 'POSIX only' : false,
    },
    async () => {
      const { store, project } = harness();
      const target = join(project, 'secret.env');
      writeFileSync(target, 'TOKEN=x\n', { mode: 0o600 });

      const snapshot = await store.capture(target);
      assert.equal(snapshot.mode, '0600');
      rmSync(target);
      await store.restore(snapshot);

      assert.equal(statSync(target).mode & 0o777, 0o600);
    },
  );

  it('refuses to restore a backup that no longer matches its own digest', async () => {
    const { store, project } = harness();
    const target = join(project, 'settings.json');
    writeFileSync(target, 'original\n');
    const snapshot = await store.capture(target);

    // Something corrupted the backup. Writing it anyway would put bytes nobody
    // captured into the user's file, which is worse than reporting a failed rollback.
    writeFileSync(join(store.directory, snapshot.contentRef ?? ''), 'tampered\n');
    await assert.rejects(() => store.restore(snapshot), /no longer matches its recorded digest/);
    assert.equal(readFileSync(target, 'utf8'), 'original\n');
  });
});

describe('where backups may live', () => {
  it('refuses a backup root inside the project', () => {
    // RFC 0004 §Backup policy: "never place backups in the project repository." A
    // configuration backup there is a configuration backup on the next `git add -A`.
    const project = join(sandbox, 'guarded-project');
    mkdirSync(project, { recursive: true });
    const created = TransactionSnapshotStore.create({
      fs: new NodeFileSystem(FACTS),
      backupRoot: join(project, '.token-harness', 'backups'),
      transactionId: 't-0002',
      projectRoot: project,
      now: () => CLOCK,
    });
    assert.equal(created.ok, false);
    if (created.ok) return;
    assert.equal(created.diagnostics[0]?.code, 'backup-root-inside-project');
    assert.notEqual(created.diagnostics[0]?.remediation, null);
  });

  it('stores backups under the transaction id', async () => {
    const { store, project } = harness();
    writeFileSync(join(project, 'a.md'), 'a\n');
    await store.capture(join(project, 'a.md'));
    assert.ok(store.directory.endsWith('t-0001'), store.directory);
  });
});
