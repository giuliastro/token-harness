/**
 * The transaction engine — RFC 0004 §Transaction lifecycle, PLAN §2.3 acceptance.
 *
 * The load-bearing test is "a simulated mid-plan failure restores the initial fixture
 * byte-for-byte". It runs against a committed fixture tree — CRLF, four-space
 * indentation, a JSONC file — copied into a temporary directory, and compares the
 * bytes back against the fixture afterwards. `.gitattributes` marks
 * `tests/fixtures/**` as `-text`, so those line endings survive a clone on any
 * platform and the comparison means the same thing in all three CI jobs.
 */

import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  FileJournalStore,
  JOURNAL_RETENTION_COUNT,
  JOURNAL_SCHEMA_VERSION,
  TRANSACTION_EXIT_CODES,
  TransactionSnapshotStore,
  diagnostic,
  digestText,
  executeTransaction,
  jsonValueDigest,
  verifyRestoration,
  type CodexConfigBatchWriteAction,
  type Diagnostic,
  type JsonValue,
  type JournalStore,
  type MergeJsonAction,
  type PatchMarkerBlockAction,
  type PlannedAction,
  type PlannedActionBase,
  type PlatformFacts,
  type ProcessRunner,
  type TransactionJournal,
  type TransactionOutcomeKind,
  type WriteOwnedFileAction,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

import { FIXTURES_ROOT } from '../src/index.js';

const NATIVE_WINDOWS = process.platform === 'win32';

const FACTS: PlatformFacts = {
  os: NATIVE_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const FIXTURE = join(FIXTURES_ROOT, 'transactions', 'mid-plan-failure');
const CLOCK = '2026-07-29T10:12:04.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-txn-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** Records the outcome of every journal write, so the write ordering is assertable. */
class RecordingJournalStore implements JournalStore {
  readonly writes: TransactionOutcomeKind[] = [];
  private readonly inner: JournalStore;

  constructor(inner: JournalStore) {
    this.inner = inner;
  }

  async write(journal: TransactionJournal): Promise<void> {
    this.writes.push(journal.outcome);
    // Deep-copied on the way through, so a later mutation of the live object cannot
    // retroactively change what this store was asked to persist.
    await this.inner.write(JSON.parse(JSON.stringify(journal)) as TransactionJournal);
  }

  read(transactionId: string): Promise<TransactionJournal | null> {
    return this.inner.read(transactionId);
  }

  list(): Promise<TransactionJournal[]> {
    return this.inner.list();
  }

  evict(now: Date): Promise<string[]> {
    return this.inner.evict(now);
  }
}

interface Harness {
  fs: NodeFileSystem;
  snapshots: TransactionSnapshotStore;
  journal: RecordingJournalStore;
  files: FileJournalStore;
  project: string;
  state: string;
  transactionId: string;
}

function harness(options: { copyFixture?: boolean } = {}): Harness {
  counter += 1;
  const root = join(sandbox, `case-${String(counter)}`);
  const project = join(root, 'project');
  const state = join(root, 'state');
  mkdirSync(project, { recursive: true });
  mkdirSync(state, { recursive: true });
  if (options.copyFixture === true) cpSync(FIXTURE, project, { recursive: true });

  const fs = new NodeFileSystem(FACTS);
  const transactionId = `t-${String(counter).padStart(4, '0')}`;
  const created = TransactionSnapshotStore.create({
    fs,
    backupRoot: join(state, 'backups'),
    transactionId,
    projectRoot: project,
    now: () => CLOCK,
  });
  assert.ok(created.ok, created.ok ? '' : JSON.stringify(created.diagnostics));
  const files = new FileJournalStore({
    fs,
    journalRoot: join(state, 'journals'),
    backupRoot: join(state, 'backups'),
  });
  return {
    fs,
    snapshots: created.store,
    journal: new RecordingJournalStore(files),
    files,
    project,
    state,
    transactionId,
  };
}

function run(
  h: Harness,
  actions: readonly PlannedAction[],
  verifyPostconditions?: () => Promise<readonly Diagnostic[]>,
  runner: ProcessRunner | null = null,
) {
  return executeTransaction({
    transactionId: h.transactionId,
    planId: 'p-0001',
    projectId: 'proj-0001',
    projectRoot: h.project,
    actions,
    fs: h.fs,
    snapshots: h.snapshots,
    journal: h.journal,
    runner,
    now: () => CLOCK,
    ...(verifyPostconditions === undefined ? {} : { verifyPostconditions }),
  });
}

const BASE: Omit<PlannedActionBase, 'id'> = {
  riskClass: 'reversible',
  requiresNetwork: false,
  requiresElevation: false,
  affectedPaths: [],
  affectedProcesses: [],
  preconditions: [],
  postconditions: [],
  rollbackData: 'file-snapshot',
  explanation: 'test action',
};

function patch(path: string, body: string, expected: string | null = null): PatchMarkerBlockAction {
  return {
    ...BASE,
    id: 'a1',
    kind: 'patch-marker-block',
    affectedPaths: [path],
    path,
    markerBegin: 'token-harness:begin',
    markerEnd: 'token-harness:end',
    commentPrefix: '<!--',
    commentSuffix: '-->',
    body,
    expectedBodyDigest: expected,
    createIfMissing: false,
  };
}

const HOOK_ENTRY = { matcher: 'Bash', command: 'rtk hook pre' } as JsonValue;

function mergeHook(path: string, expected: string | null = null): MergeJsonAction {
  return {
    ...BASE,
    id: 'a2',
    kind: 'merge-json',
    affectedPaths: [path],
    path,
    ownedPointers: ['hooks.PreToolUse'],
    operations: [
      {
        kind: 'append',
        pointer: 'hooks.PreToolUse',
        value: HOOK_ENTRY,
        expectedValueDigest: expected,
      },
    ],
    createIfMissing: false,
  };
}

function writeReceipt(path: string, content = 'receipt\n'): WriteOwnedFileAction {
  return {
    ...BASE,
    id: 'a3',
    kind: 'write-owned-file',
    affectedPaths: [path],
    path,
    content,
    mode: null,
    expectedDigest: null,
  };
}

function codexBatch(path: string, expectedVersion = 'v1'): CodexConfigBatchWriteAction {
  return {
    ...BASE,
    id: 'codex-native-1',
    kind: 'codex-config-batch-write',
    affectedPaths: [path],
    affectedProcesses: ['codex'],
    path,
    edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' }],
    expectedVersion,
    reloadUserConfig: true,
  };
}

function fakeCodexConfigRunner(
  path: string,
  response: 'success' | 'conflict' = 'success',
): ProcessRunner {
  return {
    run: async (request) => {
      assert.equal(request.executable, 'codex');
      assert.deepEqual(request.args, ['app-server', '--stdio']);
      assert.match(request.stdin ?? '', /config\/batchWrite/);
      assert.ok((request.stdin ?? '').includes(path));

      if (response === 'success') {
        writeFileSync(path, 'model_reasoning_effort = "low"\n# preserved by rollback\n');
      }

      return {
        displayCommand: 'codex app-server --stdio',
        interpreter: 'direct',
        executablePath: '/usr/bin/codex',
        exitCode: 0,
        signal: null,
        stdout:
          response === 'success'
            ? [
                JSON.stringify({ id: 1, result: {} }),
                JSON.stringify({ id: 2, result: { version: 'v2' } }),
              ].join('\n')
            : [
                JSON.stringify({ id: 1, result: {} }),
                JSON.stringify({
                  id: 2,
                  error: {
                    code: -32600,
                    message: 'configVersionConflict: Configuration was modified since last read',
                  },
                }),
              ].join('\n'),
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 1,
        timedOut: false,
        failure: null,
      };
    },
  };
}

describe('Codex native config transaction', () => {
  it('executes one atomic batch through app-server and snapshots config.toml first', async () => {
    const h = harness();
    const config = join(h.project, 'config.toml');
    writeFileSync(config, 'model_reasoning_effort = "high"\n# user comment\n');

    const result = await run(h, [codexBatch(config)], undefined, fakeCodexConfigRunner(config));

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.ok);
    assert.equal(result.journal.entries[0]?.status, 'applied');
    assert.equal(h.snapshots.captured[0]?.path, config);
    assert.equal(
      readFileSync(config, 'utf8'),
      'model_reasoning_effort = "low"\n# preserved by rollback\n',
    );
  });

  it('treats expectedVersion conflict as drift and leaves the original bytes intact', async () => {
    const h = harness();
    const config = join(h.project, 'config.toml');
    const original = 'model_reasoning_effort = "high"\n# user comment\n';
    writeFileSync(config, original);

    const result = await run(
      h,
      [codexBatch(config, 'stale-v1')],
      undefined,
      fakeCodexConfigRunner(config, 'conflict'),
    );

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.preconditionDrift);
    assert.equal(result.journal.entries[0]?.status, 'precondition-drift');
    assert.equal(readFileSync(config, 'utf8'), original);
  });

  it('restores config.toml byte-for-byte when a later action fails', async () => {
    const h = harness({ copyFixture: true });
    const config = join(h.project, 'config.toml');
    const original = 'model_reasoning_effort = "high"\n# keep me exactly\n';
    writeFileSync(config, original);

    const result = await run(
      h,
      [codexBatch(config), mergeHook(join(h.project, 'commented.json'))],
      undefined,
      fakeCodexConfigRunner(config),
    );

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assert.equal(result.journal.outcome, 'rolled-back');
    assert.equal(readFileSync(config, 'utf8'), original);
  });
});

describe('committing', () => {
  it('applies every action, verifies postconditions, and records what it owns', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'rtk is configured\n'),
      mergeHook(join(h.project, 'settings.json')),
      writeReceipt(join(h.state, 'receipts', 'r1.json')),
    ]);

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.ok);
    assert.equal(result.journal.outcome, 'committed');
    assert.equal(result.journal.entries.length, 3);
    assert.deepEqual(
      result.journal.entries.map((entry) => entry.status),
      ['applied', 'applied', 'applied'],
    );
    assert.deepEqual(result.journal.ownership.map((record) => record.kind).sort(), [
      'owned-file',
      'owned-json-entry',
      'owned-marker-block',
    ]);
    assert.equal(result.journal.planId, 'p-0001');
    assert.equal(result.journal.finishedAt, CLOCK);
  });

  it('carries an action warning into the journal without failing the transaction', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [mergeHook(join(h.project, 'settings.json'))]);
    // The fixture writes its hook entry on one line, which `JSON.stringify` cannot
    // reproduce. A warning, so a supported configuration still exits 0.
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.ok);
    assert.deepEqual(
      result.journal.entries[0]?.diagnostics.map((entry) => entry.code),
      ['json-formatting-not-preserved'],
    );
  });

  it('writes the journal before the first action and after each one', async () => {
    const h = harness({ copyFixture: true });
    await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'a\n'),
      writeReceipt(join(h.state, 'receipts', 'r1.json')),
    ]);
    // RFC 0004: "Token Harness never hides a partial installation." A journal written
    // only on success cannot honour that after a process is killed mid-apply.
    assert.deepEqual(h.journal.writes, ['in-progress', 'in-progress', 'in-progress', 'committed']);
  });

  it('leaves a readable journal on disk', async () => {
    const h = harness({ copyFixture: true });
    await run(h, [writeReceipt(join(h.state, 'receipts', 'r1.json'))]);

    const stored = await h.files.read(h.transactionId);
    assert.notEqual(stored, null);
    assert.equal(stored?.schemaVersion, JOURNAL_SCHEMA_VERSION);
    assert.equal(stored?.outcome, 'committed');
  });

  it('is idempotent: a second run of the same plan changes nothing', async () => {
    const h = harness({ copyFixture: true });
    const actions = [mergeHook(join(h.project, 'settings.json'))];
    await run(h, actions);
    const after = readFileSync(join(h.project, 'settings.json'));

    const second = harness();
    cpSync(h.project, second.project, { recursive: true });
    const result = await run(second, [mergeHook(join(second.project, 'settings.json'))]);
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.ok);
    assert.equal(result.journal.entries[0]?.status, 'already-satisfied');
    assert.deepEqual(readFileSync(join(second.project, 'settings.json')), after);
  });
});

/**
 * PLAN §2.3 acceptance: "a simulated mid-plan failure restores the initial fixture
 * byte-for-byte."
 */
describe('a mid-plan failure', () => {
  function fixtureBytes(): Map<string, Buffer> {
    const bytes = new Map<string, Buffer>();
    for (const name of readdirSync(FIXTURE)) {
      bytes.set(name, readFileSync(join(FIXTURE, name)));
    }
    return bytes;
  }

  function assertFixtureRestored(project: string): void {
    for (const [name, expected] of fixtureBytes()) {
      assert.deepEqual(
        readFileSync(join(project, name)),
        expected,
        `${name} was not restored byte-for-byte`,
      );
    }
  }

  it('restores the initial fixture byte-for-byte', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'rtk is configured\n'),
      mergeHook(join(h.project, 'settings.json')),
      // The third action refuses: the document carries comments, and RFC 0004 forbids
      // editing it in a way that would delete them.
      mergeHook(join(h.project, 'commented.json')),
    ]);

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assert.equal(result.journal.outcome, 'rolled-back');
    assert.deepEqual(
      result.journal.entries.map((entry) => entry.status),
      ['applied', 'applied', 'refused'],
    );
    assertFixtureRestored(h.project);
  });

  it('names the reason it stopped', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'a\n'),
      mergeHook(join(h.project, 'commented.json')),
    ]);
    const codes = result.diagnostics.map((entry) => entry.code);
    assert.ok(codes.includes('json-comments-unsupported'), codes.join(', '));
    assert.ok(codes.includes('transaction-rolled-back'), codes.join(', '));
  });

  it('owns nothing after a rollback', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'a\n'),
      mergeHook(join(h.project, 'commented.json')),
    ]);
    assert.deepEqual(result.journal.ownership, []);
  });

  it('removes a file it created before failing', async () => {
    const h = harness({ copyFixture: true });
    const receipt = join(h.state, 'receipts', 'r1.json');
    await run(h, [writeReceipt(receipt), mergeHook(join(h.project, 'commented.json'))]);
    assert.equal(statSync(receipt, { throwIfNoEntry: false }), undefined);
  });

  it('rolls back after an I/O failure that would otherwise escape the engine', async () => {
    const h = harness({ copyFixture: true });
    // `patch-marker-block` on a directory refuses cleanly; a write into a path whose
    // parent is a *file* throws from the filesystem instead.
    writeFileSync(join(h.project, 'blocked'), 'a file, not a directory\n');
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'a\n'),
      writeReceipt(join(h.project, 'blocked', 'nested', 'receipt.json')),
    ]);

    assert.equal(result.journal.entries[1]?.status, 'failed');
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assertFixtureRestored(h.project);
  });

  it('rolls back when a postcondition fails', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(
      h,
      [patch(join(h.project, 'AGENTS.md'), 'a\n')],
      // RFC 0004 §Transaction lifecycle: "verify postconditions" sits before "commit
      // journal", so a failure there is a failure of the transaction.
      () =>
        Promise.resolve([
          diagnostic({
            severity: 'error',
            code: 'canary-not-intercepted',
            message: 'the sentinel command was not rewritten',
          }),
        ]),
    );

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assert.equal(result.journal.outcome, 'rolled-back');
    assertFixtureRestored(h.project);
  });

  it('commits when postconditions return only warnings', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [patch(join(h.project, 'AGENTS.md'), 'a\n')], () =>
      Promise.resolve([
        diagnostic({ severity: 'warning', code: 'tier-limit', message: 'config-only' }),
      ]),
    );
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.ok);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'tier-limit'));
  });
});

describe('drift', () => {
  it('reports the cause when nothing was mutated', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      // The plan expects a block that is not there.
      patch(join(h.project, 'AGENTS.md'), 'a\n', digestText('previous\n')),
    ]);
    // Nothing was written, so the honest report is the cause rather than a mutation
    // outcome.
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.preconditionDrift);
    assert.equal(result.journal.outcome, 'rolled-back');
  });

  it('reports the mutation outcome once something has been written', async () => {
    const h = harness({ copyFixture: true });
    const result = await run(h, [
      patch(join(h.project, 'AGENTS.md'), 'a\n'),
      mergeHook(
        join(h.project, 'settings.json'),
        jsonValueDigest({ never: 'written' } as JsonValue),
      ),
    ]);
    // The operationally important fact is that the machine was changed and put back.
    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assert.ok(result.diagnostics.some((entry) => entry.code === 'action-precondition-drift'));
  });
});

describe('a rollback that does not take', () => {
  it('reports exit 7, names the path and the transaction, and leaves the receipt', async () => {
    const h = harness({ copyFixture: true });
    const target = join(h.project, 'AGENTS.md');

    const result = await run(h, [patch(target, 'a\n')], () => {
      // Corrupt the backup between the write and the rollback: a truncated or tampered
      // backup is exactly the case exit 7 exists for.
      const backups = readdirSync(h.snapshots.directory).filter((name) =>
        name.endsWith('.content'),
      );
      writeFileSync(join(h.snapshots.directory, backups[0] ?? ''), 'not what was captured\n');
      return Promise.resolve([
        diagnostic({ severity: 'error', code: 'verification-failed', message: 'forced' }),
      ]);
    });

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.applyFailedDirty);
    assert.equal(result.journal.outcome, 'dirty');

    const critical = result.diagnostics.find((entry) => entry.code === 'rollback-incomplete');
    assert.notEqual(critical, undefined);
    assert.match(critical?.message ?? '', new RegExp(h.transactionId));
    assert.equal(critical?.severity, 'error');
    assert.notEqual(critical?.remediation, null);

    // "It always leaves a failure receipt in the state directory."
    const stored = await h.files.read(h.transactionId);
    assert.equal(stored?.outcome, 'dirty');
  });

  it('detects an unrestored absence as well as unrestored content', async () => {
    const h = harness();
    const present = join(h.project, 'present.txt');
    const absent = join(h.project, 'absent.txt');
    writeFileSync(present, 'original\n');

    const kept = await h.snapshots.capture(present);
    const never = await h.snapshots.capture(absent);

    assert.deepEqual(await verifyRestoration(h.fs, [kept, never]), []);

    writeFileSync(present, 'changed\n');
    writeFileSync(absent, 'appeared\n');
    assert.deepEqual(await verifyRestoration(h.fs, [kept, never]), [present, absent]);

    rmSync(present);
    assert.deepEqual(await verifyRestoration(h.fs, [kept]), [present]);
  });
});

describe('journal retention', () => {
  function journal(
    id: string,
    startedAt: string,
    outcome: TransactionOutcomeKind,
    pinned = false,
  ): TransactionJournal {
    return {
      schemaVersion: JOURNAL_SCHEMA_VERSION,
      transactionId: id,
      planId: null,
      projectId: null,
      projectRoot: '/project',
      startedAt,
      finishedAt: startedAt,
      outcome,
      entries: [],
      ownership: [],
      pinned,
      diagnostics: [],
    };
  }

  function day(offset: number): string {
    return new Date(Date.parse('2026-07-29T00:00:00.000Z') - offset * 86_400_000).toISOString();
  }

  it('keeps the most recent and evicts the rest', async () => {
    const h = harness();
    for (let index = 0; index < JOURNAL_RETENTION_COUNT + 5; index += 1) {
      await h.files.write(journal(`t-${String(index).padStart(3, '0')}`, day(index), 'committed'));
    }
    const removed = await h.files.evict(new Date(Date.parse(day(0))));
    assert.equal(removed.length, 5);
    assert.equal((await h.files.list()).length, JOURNAL_RETENTION_COUNT);
  });

  it('evicts by age', async () => {
    const h = harness();
    await h.files.write(journal('t-old', day(120), 'committed'));
    await h.files.write(journal('t-new', day(1), 'committed'));
    const removed = await h.files.evict(new Date(Date.parse(day(0))));
    assert.deepEqual(removed, ['t-old']);
  });

  it('exempts a pinned transaction from both limits', async () => {
    const h = harness();
    await h.files.write(journal('t-pinned', day(400), 'committed', true));
    assert.deepEqual(await h.files.evict(new Date(Date.parse(day(0)))), []);
  });

  it('never evicts an unfinished or dirty transaction', async () => {
    const h = harness();
    await h.files.write(journal('t-partial', day(400), 'in-progress'));
    await h.files.write(journal('t-dirty', day(400), 'dirty'));
    // Their journals are the only record that something needs putting right.
    assert.deepEqual(await h.files.evict(new Date(Date.parse(day(0)))), []);
  });

  it('removes a journal backups with it, so nobody is left holding the users settings', async () => {
    const h = harness({ copyFixture: true });
    await run(h, [patch(join(h.project, 'AGENTS.md'), 'a\n')]);
    const backups = join(h.state, 'backups', h.transactionId);
    assert.equal(statSync(backups).isDirectory(), true);

    const stored = await h.files.read(h.transactionId);
    assert.notEqual(stored, null);
    if (stored === null) return;
    await h.files.write({ ...stored, startedAt: day(400) });

    // RFC 0006 §Expiry: "Configuration backups | 90 days | tied to their journal".
    assert.deepEqual(await h.files.evict(new Date(Date.parse(day(0)))), [h.transactionId]);
    assert.equal(statSync(backups, { throwIfNoEntry: false }), undefined);
  });

  it('ignores a journal from a build that understands more than this one', async () => {
    const h = harness();
    await h.files.write({ ...journal('t-future', day(1), 'committed'), schemaVersion: 99 });
    // RFC 0006 rule 1: a consumer that sees an unknown schemaVersion must stop rather
    // than guess. It is skipped, not evicted: this build cannot judge it.
    assert.equal(await h.files.read('t-future'), null);
    assert.deepEqual(await h.files.list(), []);
    assert.deepEqual(await h.files.evict(new Date(Date.parse(day(0)))), []);
  });
});
