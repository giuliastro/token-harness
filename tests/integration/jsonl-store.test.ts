/**
 * `JsonlStore` — PLAN §2.4 acceptance.
 *
 * Four criteria, and two of them cannot be asserted against a double:
 *
 * - append, cursor read/write, and filtered query round trip;
 * - **concurrent append from two processes does not corrupt a record** — so this spawns two;
 * - **a truncated or partially written final line is skipped, not fatal** — so this tears a
 *   real file;
 * - nothing outside the store knows the backend.
 *
 * It runs against `NodeFileSystem` in a temporary directory. The store itself is
 * platform-agnostic, but the guarantees are about bytes on a disk, and an in-memory double
 * has no O_APPEND to be atomic with.
 */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  JsonlStore,
  collectEvents,
  cursorKey,
  eventPartition,
  type ImportCursor,
  type OptimizationEvent,
  type PlatformFacts,
  type SkippedLine,
  type VerificationReceipt,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const CLOCK = '2026-07-30T12:00:00.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-jsonl-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Harness {
  store: JsonlStore;
  stateRoot: string;
  skipped: SkippedLine[];
}

function harness(): Harness {
  counter += 1;
  const stateRoot = join(sandbox, `state-${String(counter)}`);
  mkdirSync(stateRoot, { recursive: true });
  const skipped: SkippedLine[] = [];
  const store = new JsonlStore({
    fs: new NodeFileSystem(FACTS),
    stateRoot,
    now: () => CLOCK,
    onSkippedLine: (entry) => skipped.push(entry),
  });
  return { store, stateRoot, skipped };
}

function event(overrides: {
  id: string;
  timestamp: string;
  provider?: string;
  harness?: string;
  projectId?: string;
  pipelineId?: string | null;
  measurementClass?: OptimizationEvent['measurement']['class'];
}): OptimizationEvent {
  return {
    schemaVersion: 1,
    eventId: overrides.id,
    timestamp: overrides.timestamp,
    provider: { id: overrides.provider ?? 'rtk', version: '0.42.0' },
    context: {
      projectId: overrides.projectId ?? 'p_4d2f8a',
      harnessId: overrides.harness ?? 'claude',
      sessionId: null,
      operationId: `op-${overrides.id}`,
      pipelineId: overrides.pipelineId ?? null,
      pipelineOrder: null,
      toolFamily: 'bash',
      capability: 'shell.command.rewrite',
    },
    measurement: {
      class: overrides.measurementClass ?? 'exact-local',
      beforeChars: 1000,
      afterChars: 300,
      beforeTokens: 250,
      afterTokens: 75,
      tokenizer: 'rtk',
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: true,
      bypassReason: null,
      originalReference: null,
      latencyMs: 11,
      errorCode: null,
    },
    source: { nativeEventId: null, importedAt: CLOCK },
  };
}

describe('round trip', () => {
  it('appends and reads back every event', async () => {
    const h = harness();
    const events = [
      event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' }),
      event({ id: 'b', timestamp: '2026-07-30T11:00:00.000Z' }),
    ];
    await h.store.appendEvents(events);

    const read = await collectEvents(h.store, {});
    assert.deepEqual(
      read.map((entry) => entry.eventId),
      ['a', 'b'],
    );
    // Byte-for-byte on the fields that carry a claim: RFC 0005 forbids deriving a token
    // count silently, so a round trip that lost `beforeTokens` would let a report invent one.
    assert.deepEqual(read[0]?.measurement, events[0]?.measurement);
    assert.deepEqual(h.skipped, []);
  });

  it('appends nothing for an empty batch', async () => {
    const h = harness();
    await h.store.appendEvents([]);
    assert.deepEqual(await collectEvents(h.store, {}), []);
  });

  it('returns nothing rather than failing when no events have ever been written', async () => {
    const h = harness();
    assert.deepEqual(await collectEvents(h.store, {}), []);
  });

  it('partitions by month, so a bounded window is a bounded scan', async () => {
    const h = harness();
    await h.store.appendEvents([
      event({ id: 'june', timestamp: '2026-06-15T10:00:00.000Z' }),
      event({ id: 'july', timestamp: '2026-07-15T10:00:00.000Z' }),
    ]);

    const files = readFileSync(join(h.stateRoot, 'metrics', 'events-2026-06.jsonl'), 'utf8');
    assert.match(files, /"eventId":"june"/);
    assert.equal(eventPartition('2026-07-15T10:00:00.000Z'), 'events-2026-07.jsonl');

    const july = await collectEvents(h.store, { since: '2026-07-01T00:00:00.000Z' });
    assert.deepEqual(
      july.map((entry) => entry.eventId),
      ['july'],
    );
  });

  it('refuses an event with no ISO 8601 timestamp rather than filing it somewhere arbitrary', async () => {
    const h = harness();
    // A record nobody can find by date is a record missing from a report, and a missing
    // record understates savings silently.
    await assert.rejects(
      () => h.store.appendEvents([event({ id: 'x', timestamp: 'yesterday' })]),
      /cannot be filed by date/,
    );
  });
});

describe('filtering', () => {
  async function populated(): Promise<Harness> {
    const h = harness();
    await h.store.appendEvents([
      event({ id: 'a', timestamp: '2026-07-01T10:00:00.000Z', provider: 'rtk' }),
      event({ id: 'b', timestamp: '2026-07-15T10:00:00.000Z', provider: 'harnesstrim' }),
      event({
        id: 'c',
        timestamp: '2026-07-20T10:00:00.000Z',
        harness: 'codex',
        measurementClass: 'counterfactual',
      }),
      event({ id: 'd', timestamp: '2026-07-25T10:00:00.000Z', pipelineId: 'b41e' }),
    ]);
    return h;
  }

  const cases: ReadonlyArray<readonly [string, Parameters<JsonlStore['query']>[0], string[]]> = [
    ['no filter returns everything', {}, ['a', 'b', 'c', 'd']],
    ['since is inclusive', { since: '2026-07-15T10:00:00.000Z' }, ['b', 'c', 'd']],
    ['until is exclusive', { until: '2026-07-15T10:00:00.000Z' }, ['a']],
    ['a window', { since: '2026-07-02T00:00:00Z', until: '2026-07-21T00:00:00Z' }, ['b', 'c']],
    ['by provider', { providerIds: ['harnesstrim'] }, ['b']],
    ['by harness', { harnessIds: ['codex'] }, ['c']],
    ['by pipeline', { pipelineId: 'b41e' }, ['d']],
    ['by measurement class', { classes: ['counterfactual'] }, ['c']],
    ['by project', { projectId: 'p_4d2f8a' }, ['a', 'b', 'c', 'd']],
    ['a filter matching nothing', { providerIds: ['nobody'] }, []],
  ];

  for (const [name, filter, expected] of cases) {
    it(name, async () => {
      const h = await populated();
      const read = await collectEvents(h.store, filter);
      assert.deepEqual(
        read.map((entry) => entry.eventId),
        expected,
      );
    });
  }
});

describe('cursors', () => {
  const cursor: ImportCursor = {
    providerId: 'harnesstrim',
    sourceId: 'C:\\work\\demo\\.harnesstrim\\metrics.jsonl',
    absolutePath: 'C:\\work\\demo\\.harnesstrim\\metrics.jsonl',
    fileIdentity: 'volume-1:file-42',
    byteOffset: 4096,
    lastLineDigest: 'sha256:deadbeef',
    highWaterMark: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('round trips, stamping the write time', async () => {
    const h = harness();
    await h.store.writeCursor(cursor);
    const read = await h.store.readCursor(cursor.providerId, cursor.sourceId);
    assert.equal(read?.byteOffset, 4096);
    assert.equal(read?.lastLineDigest, 'sha256:deadbeef');
    // The caller's `updatedAt` is replaced by the store's clock: the field records when the
    // cursor was persisted, and a caller could pass anything.
    assert.equal(read?.updatedAt, CLOCK);
  });

  it('returns null for a source it has never seen', async () => {
    const h = harness();
    assert.equal(await h.store.readCursor('rtk', 'nowhere'), null);
  });

  it('turns an absolute Windows path into a filename without losing the identity', async () => {
    const h = harness();
    await h.store.writeCursor(cursor);
    const key = cursorKey(cursor.providerId, cursor.sourceId);
    assert.match(key, /^harnesstrim-[0-9a-f]{8}\.json$/);
    // The full identity is inside the file, so the directory stays readable by a human.
    const stored = readFileSync(join(h.stateRoot, 'metrics', 'cursors', key), 'utf8');
    assert.match(stored, /metrics\.jsonl/);
  });

  it('refuses a cursor whose stored identity does not match the request', async () => {
    const h = harness();
    await h.store.writeCursor(cursor);
    const key = cursorKey(cursor.providerId, cursor.sourceId);
    // Simulating a digest collision. Returning the wrong cursor would resume at another
    // source's byte offset and skip real records.
    writeFileSync(
      join(h.stateRoot, 'metrics', 'cursors', key),
      JSON.stringify({ ...cursor, sourceId: 'a different file' }),
    );
    assert.equal(await h.store.readCursor(cursor.providerId, cursor.sourceId), null);
  });

  it('treats a corrupt cursor as no cursor rather than failing the command', async () => {
    const h = harness();
    await h.store.writeCursor(cursor);
    writeFileSync(
      join(h.stateRoot, 'metrics', 'cursors', cursorKey(cursor.providerId, cursor.sourceId)),
      '{ not json',
    );
    // Re-importing from zero is safe: RFC 0005's synthesized identity discards duplicates.
    assert.equal(await h.store.readCursor(cursor.providerId, cursor.sourceId), null);
  });
});

/** PLAN §2.4: "a truncated or partially written final line is skipped, not fatal". */
describe('a torn file', () => {
  it('skips a truncated final line and returns everything before it', async () => {
    const h = harness();
    await h.store.appendEvents([
      event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' }),
      event({ id: 'b', timestamp: '2026-07-30T11:00:00.000Z' }),
    ]);
    const path = join(h.stateRoot, 'metrics', 'events-2026-07.jsonl');
    const text = readFileSync(path, 'utf8');
    // A torn append: the last record stops mid-way, with no terminating newline.
    writeFileSync(path, `${text}{"schemaVersion":1,"eventId":"c","timesta`);

    const read = await collectEvents(h.store, {});
    assert.deepEqual(
      read.map((entry) => entry.eventId),
      ['a', 'b'],
    );
    assert.deepEqual(h.skipped, [{ path, lineNumber: 3, reason: 'truncated-final-line' }]);
  });

  it('distinguishes corruption in the middle from a torn append at the end', async () => {
    const h = harness();
    await h.store.appendEvents([event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })]);
    const path = join(h.stateRoot, 'metrics', 'events-2026-07.jsonl');
    const good = readFileSync(path, 'utf8').trimEnd();
    writeFileSync(path, `${good}\n{ mangled\n${good}\n`);

    const read = await collectEvents(h.store, {});
    assert.equal(read.length, 2);
    // The distinction is the point: a torn tail is what JSONL tolerates by design, and a
    // bad line in the middle is corruption. Reporting both the same way would hide the
    // second.
    assert.deepEqual(h.skipped, [{ path, lineNumber: 2, reason: 'unparseable-line' }]);
  });

  it('skips a record from a schema version this build does not understand', async () => {
    const h = harness();
    await h.store.appendEvents([event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })]);
    const path = join(h.stateRoot, 'metrics', 'events-2026-07.jsonl');
    const future = {
      ...event({ id: 'future', timestamp: '2026-07-30T12:00:00.000Z' }),
      schemaVersion: 99,
    };
    writeFileSync(path, `${readFileSync(path, 'utf8')}${JSON.stringify(future)}\n`);

    const read = await collectEvents(h.store, {});
    assert.deepEqual(
      read.map((entry) => entry.eventId),
      ['a'],
    );
    // RFC 0006 rule 1 on the read side: stop rather than guess, and say that you did.
    assert.deepEqual(h.skipped, [{ path, lineNumber: 2, reason: 'unsupported-schema-version' }]);
  });

  it('tolerates blank lines without reporting them', async () => {
    const h = harness();
    await h.store.appendEvents([event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })]);
    const path = join(h.stateRoot, 'metrics', 'events-2026-07.jsonl');
    writeFileSync(path, `\n${readFileSync(path, 'utf8')}\n\n`);
    assert.equal((await collectEvents(h.store, {})).length, 1);
    assert.deepEqual(h.skipped, []);
  });
});

/** PLAN §2.4: "concurrent append from two processes does not corrupt a record". */
describe('two processes appending at once', () => {
  it('produces a file in which every record still parses', { timeout: 120_000 }, async () => {
    const h = harness();
    const partition = join(h.stateRoot, 'metrics', 'events-2026-07.jsonl');
    mkdirSync(join(h.stateRoot, 'metrics'), { recursive: true });

    // Two real processes, not two promises: the guarantee is about O_APPEND, and a single
    // process cannot exercise it. Each writes 400 records through the same store code.
    // Resolved through the package names rather than a relative path: the compiled test
    // does not sit where its source does, and a `../..` that happened to work would be
    // counting directories in the build layout.
    const script = join(sandbox, 'append.mjs');
    writeFileSync(
      script,
      [
        `import { JsonlStore } from ${JSON.stringify(import.meta.resolve('@token-harness/core'))};`,
        `import { NodeFileSystem } from ${JSON.stringify(import.meta.resolve('@token-harness/platform'))};`,
        `const [stateRoot, tag] = process.argv.slice(2);`,
        `const store = new JsonlStore({ fs: new NodeFileSystem(${JSON.stringify(FACTS)}), stateRoot, now: () => ${JSON.stringify(CLOCK)} });`,
        `const template = ${JSON.stringify(event({ id: 'template', timestamp: '2026-07-30T10:00:00.000Z' }))};`,
        `for (let i = 0; i < 400; i += 1) {`,
        `  await store.appendEvents([{ ...template, eventId: tag + '-' + i }]);`,
        `}`,
      ].join('\n'),
    );

    // Both are spawned before either is awaited. `spawnSync` would run them one after the
    // other, and a test in which the writers never overlap cannot observe interleaving —
    // it would pass against a store that had no atomicity at all.
    const running = ['alpha', 'beta'].map(async (tag) => {
      const child = spawn(process.execPath, [script, h.stateRoot, tag], { stdio: 'pipe' });
      let stderr = '';
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk;
      });
      const status = await once(child, 'exit');
      return { code: status[0] as number | null, stderr };
    });

    for (const child of await Promise.all(running)) {
      assert.equal(child.code, 0, child.stderr);
    }

    const lines = readFileSync(partition, 'utf8')
      .split('\n')
      .filter((line) => line !== '');
    // This count, and not the parse loop below, is the assertion with power here.
    //
    // I checked by running the same two children against the read-modify-write a caller
    // would have written if `appendFile` did not exist: it kept 27 of 800 records and
    // produced *zero* unparseable lines. Last-writer-wins truncation loses whole records
    // and leaves a perfectly well-formed file behind, so PLAN §2.4's "does not corrupt a
    // record" is satisfied trivially by a writer that simply drops them. Counting is what
    // catches that.
    assert.equal(lines.length, 800);
    for (const [index, line] of lines.entries()) {
      // The parse loop covers the other failure: a write torn *within* a record, which is
      // what O_APPEND rules out.
      assert.doesNotThrow(() => JSON.parse(line), `line ${String(index + 1)} was corrupted`);
    }

    const read = await collectEvents(h.store, {});
    assert.equal(read.length, 800);
    assert.equal(new Set(read.map((entry) => entry.eventId)).size, 800);
    assert.deepEqual(h.skipped, []);
  });
});

describe('receipts', () => {
  const receipt: VerificationReceipt = {
    schemaVersion: 1,
    receiptId: '7f3a91c2',
    appliedAt: '2026-07-29T10:12:04.000Z',
    harnessVersions: { claude: '2.1.212' },
    providerVersions: { rtk: '0.42.0' },
    pipelineId: 'b41e',
    results: [],
  };

  it('round trips', async () => {
    const h = harness();
    await h.store.upsertReceipt(receipt);
    const listed = await h.store.listReceipts();
    assert.equal(listed.length, 1);
    // RFC 0002 §Harness versioning is symmetric: the harness version is in every receipt.
    assert.equal(listed[0]?.harnessVersions['claude'], '2.1.212');
  });

  it('upserts rather than duplicating', async () => {
    const h = harness();
    await h.store.upsertReceipt(receipt);
    await h.store.upsertReceipt({ ...receipt, pipelineId: 'changed' });
    const listed = await h.store.listReceipts();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.pipelineId, 'changed');
  });

  it('lists newest first', async () => {
    const h = harness();
    await h.store.upsertReceipt(receipt);
    await h.store.upsertReceipt({
      ...receipt,
      receiptId: 'later',
      appliedAt: '2026-07-30T10:00:00.000Z',
    });
    assert.deepEqual(
      (await h.store.listReceipts()).map((entry) => entry.receiptId),
      ['later', '7f3a91c2'],
    );
  });

  it('reports a corrupt receipt instead of failing the listing', async () => {
    const h = harness();
    await h.store.upsertReceipt(receipt);
    writeFileSync(join(h.stateRoot, 'receipts', 'broken.json'), '{ not json');
    assert.equal((await h.store.listReceipts()).length, 1);
    assert.equal(h.skipped.length, 1);
    assert.equal(h.skipped[0]?.reason, 'unparseable-line');
  });
});
