/**
 * `rtkAdapter.collectMetrics` — RFC 0005 §Importers §RTK, as amended.
 *
 * The database is faked here, not the *shape* of it: every column name, and the row values
 * in `HISTORY`, are copied from `%LOCALAPPDATA%\rtk\history.db` on an installed RTK 0.42.0,
 * including the `\\?\` prefix RTK writes into `project_path` and the nanosecond-precision
 * offset timestamp it stamps. A double that agreed with my expectations rather than with the
 * tool would test nothing.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type {
  ImportCursor,
  LocalDatabasePort,
  LocalDatabaseQuery,
  LocalDatabaseResult,
  LocalDatabaseRow,
  MetricsStore,
  OptimizationEvent,
  PlatformFacts,
  ProcessRequest,
  VerificationReceipt,
} from '@token-harness/core';

import { rtkAdapter, rtkDatabasePath, type ProviderContext } from '../src/index.js';

const FACTS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11 Pro',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const PATHS = {
  home: 'C:\\Users\\dev',
  config: 'C:\\Users\\dev\\AppData\\Roaming\\TokenHarness',
  data: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
  state: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
  cache: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness\\Cache',
};

const DB = 'C:\\Users\\dev\\AppData\\Local\\rtk\\history.db';

/** Verbatim column names and value shapes from the installed tool. */
const HISTORY: LocalDatabaseRow[] = [
  {
    id: 2827,
    timestamp: '2026-07-31T07:49:09.000000000+00:00',
    input_tokens: 88,
    output_tokens: 17,
    saved_tokens: 71,
    exec_time_ms: 25,
    project_path: '\\\\?\\C:\\Software\\TokenHarness',
  },
  {
    // The majority case on a real machine: RTK proxied the command and moved nothing.
    id: 2829,
    timestamp: '2026-07-31T07:49:10.162463300+00:00',
    input_tokens: 40,
    output_tokens: 40,
    saved_tokens: 0,
    exec_time_ms: 25,
    project_path: '\\\\?\\C:\\Software\\TokenHarness',
  },
];

interface FakeDatabaseOptions {
  rows?: LocalDatabaseRow[];
  generation?: LocalDatabaseRow;
  failure?: LocalDatabaseResult['failure'];
}

interface FakeDatabase extends LocalDatabasePort {
  readonly queries: LocalDatabaseQuery[];
}

function database(options: FakeDatabaseOptions = {}): FakeDatabase {
  const queries: LocalDatabaseQuery[] = [];
  const rows = options.rows ?? HISTORY;
  return {
    queries,
    query: (query) => {
      queries.push(query);
      if (options.failure !== undefined) {
        return Promise.resolve({ rows: [], failure: options.failure, detail: 'fake' });
      }
      if (query.sql.includes('MIN(id)')) {
        const ids = rows.map((row) => row['id'] as number);
        return Promise.resolve({
          rows: [
            options.generation ?? {
              low: ids.length === 0 ? null : Math.min(...ids),
              high: ids.length === 0 ? null : Math.max(...ids),
              total: rows.length,
            },
          ],
          failure: null,
          detail: null,
        });
      }
      const after = query.parameters[0] as number;
      const limit = query.parameters[1] as number;
      return Promise.resolve({
        rows: rows.filter((row) => (row['id'] as number) > after).slice(0, limit),
        failure: null,
        detail: null,
      });
    },
  };
}

interface FakeStore extends MetricsStore {
  readonly events: OptimizationEvent[];
  readonly cursors: ImportCursor[];
}

function store(existing: ImportCursor | null = null): FakeStore {
  const events: OptimizationEvent[] = [];
  const cursors: ImportCursor[] = [];
  return {
    events,
    cursors,
    appendEvents: (batch) => {
      events.push(...batch);
      return Promise.resolve();
    },
    readCursor: () => Promise.resolve(cursors.at(-1) ?? existing),
    writeCursor: (cursor) => {
      cursors.push(cursor);
      return Promise.resolve();
    },
    query: async function* () {
      // Nothing yields: `collectMetrics` never reads events back, and a double that
      // returned some would let a test pass on data the importer did not produce.
    },
    upsertReceipt: (_receipt: VerificationReceipt) => Promise.resolve(),
  };
}

function context(options: { localDatabase?: LocalDatabasePort | null } = {}): ProviderContext {
  // `??` would be wrong here: it treats an explicit `null` as absent, and `null` is exactly
  // the case one of these tests is about.
  const localDatabase = 'localDatabase' in options ? options.localDatabase : database();
  return {
    fs: {
      join: (...segments) => segments.join('\\'),
      dirname: (path) => path.slice(0, path.lastIndexOf('\\')),
      basename: (path) => path.slice(path.lastIndexOf('\\') + 1),
      isInside: () => false,
      stat: () => Promise.resolve(null),
      readFile: () => Promise.reject(new Error('the importer must not read files directly')),
      writeFile: () => Promise.reject(new Error('the importer must not write')),
      appendFile: () => Promise.reject(new Error('the importer must not write')),
      createDirectory: () => Promise.reject(new Error('the importer must not write')),
      remove: () => Promise.reject(new Error('the importer must not write')),
      readDirectory: () => Promise.resolve([]),
    },
    runner: {
      run: (request: ProcessRequest) =>
        Promise.reject(new Error(`the importer must not spawn: ${request.executable}`)),
    },
    facts: FACTS,
    paths: PATHS,
    projectRoot: 'C:\\Software\\TokenHarness',
    harnessConfigs: [],
    now: () => '2026-07-31T09:00:00.000Z',
    localDatabase: localDatabase ?? null,
    projectIdFor: (path) => `p_${String(path.length)}`,
  };
}

describe('rtkDatabasePath', () => {
  it('is a sibling of the Token Harness data directory', () => {
    // Both tools follow the same platform convention, so the parent of ours is the per-user
    // data root and RTK's directory sits beside ours inside it.
    assert.equal(rtkDatabasePath(context()), DB);
  });
});

describe('a native import', () => {
  it('reports the mode, the source, and what it appended', async () => {
    const target = store();
    const result = await rtkAdapter.collectMetrics(context(), target);

    assert.equal(result.mode, 'native');
    assert.equal(result.source, 'rtk history.db (commands)');
    assert.equal(result.imported, 2);
    assert.equal(result.skipped, 0);
  });

  it('never selects the columns holding raw command text', async () => {
    const db = database();
    await rtkAdapter.collectMetrics(context({ localDatabase: db }), store());

    // RFC 0005 §Privacy: "Raw command text … are not part of the normalized event." A
    // `SELECT *` would satisfy every other assertion in this file and leak both columns.
    for (const query of db.queries) {
      assert.doesNotMatch(query.sql, /original_cmd|rtk_cmd|SELECT \*/i);
    }
  });

  it('maps a reducing row to a realized exact-local saving', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    const event = target.events.find((entry) => entry.eventId === 'rtk-history-2827');

    assert.ok(event);
    // RFC 0005 §Exact local names this case directly: "RTK command output before and after
    // filtering".
    assert.equal(event.measurement.class, 'exact-local');
    assert.equal(event.measurement.beforeTokens, 88);
    assert.equal(event.measurement.afterTokens, 17);
    // Recorded so a reader can judge the figure: the counts are RTK's, not the model
    // provider's.
    assert.equal(event.measurement.tokenizer, 'rtk');
    // Characters are null rather than copied from the token counts, which would be a
    // silently derived figure.
    assert.equal(event.measurement.beforeChars, null);
    assert.equal(event.outcome.changed, true);
    assert.equal(event.outcome.bypassReason, null);
    assert.equal(event.outcome.latencyMs, 25);
  });

  it('records a non-reducing row as an unchanged bypass, not a saving', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    const event = target.events.find((entry) => entry.eventId === 'rtk-history-2829');

    assert.ok(event);
    // The figure the daily aggregate cannot express. On the machine this was written
    // against, 2,132 of 2,828 rows look like this one, and the aggregate reports 9.5%
    // average savings without being able to say so.
    assert.equal(event.outcome.changed, false);
    assert.equal(event.outcome.bypassReason, 'no-reduction-applied');
  });

  it('uses the native row identifier rather than synthesizing one', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    assert.deepEqual(
      target.events.map((entry) => entry.source.nativeEventId),
      ['2827', '2829'],
    );
  });

  it('normalizes the timestamp to ISO 8601', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    // RTK stamps a nanosecond-precision offset timestamp; the event schema is ISO 8601, and
    // `JsonlStore` partitions on the first seven characters of it.
    assert.equal(target.events[0]?.timestamp, '2026-07-31T07:49:09.000Z');
  });

  it('attributes the project through the injected identifier', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    // The raw `\\?\` path never reaches the event; what does is the salted identifier, and
    // deriving it here rather than in the adapter is what keeps one project from hashing two
    // ways across providers.
    assert.equal(
      target.events[0]?.context.projectId,
      `p_${String('\\\\?\\C:\\Software\\TokenHarness'.length)}`,
    );
  });

  it('leaves the harness unknown rather than guessing from current wiring', async () => {
    const target = store();
    await rtkAdapter.collectMetrics(context(), target);
    // A row carries no harness. Reading one off today's configuration would attribute
    // months of history to whichever harness happens to be wired now.
    assert.equal(target.events[0]?.context.harnessId, 'unknown');
  });
});

describe('the cursor', () => {
  it('advances to the highest imported identifier', async () => {
    const target = store();
    const result = await rtkAdapter.collectMetrics(context(), target);

    assert.equal(result.cursor?.highWaterMark, '2829');
    // The file-shaped members are not filled with plausible-looking values; the RFC 0005
    // amendment says which member is authoritative for which kind of source.
    assert.equal(result.cursor?.byteOffset, 0);
    assert.equal(result.cursor?.lastLineDigest, null);
  });

  it('imports only what is new on a second run', async () => {
    const existing: ImportCursor = {
      providerId: 'rtk',
      sourceId: DB,
      absolutePath: DB,
      fileIdentity: 'rtk-history:low=2827:count=2',
      byteOffset: 0,
      lastLineDigest: null,
      highWaterMark: '2827',
      updatedAt: '2026-07-31T08:00:00.000Z',
    };
    const target = store(existing);
    const result = await rtkAdapter.collectMetrics(context(), target);

    assert.equal(result.imported, 1);
    assert.equal(target.events[0]?.eventId, 'rtk-history-2829');
  });

  it('imports nothing, natively, when the source has not moved', async () => {
    const existing: ImportCursor = {
      providerId: 'rtk',
      sourceId: DB,
      absolutePath: DB,
      fileIdentity: 'rtk-history:low=2827:count=2',
      byteOffset: 0,
      lastLineDigest: null,
      highWaterMark: '2829',
      updatedAt: '2026-07-31T08:00:00.000Z',
    };
    const result = await rtkAdapter.collectMetrics(context(), store(existing));

    // Healthy, and reported as such. Showing the source as unavailable because there was
    // nothing new would make a working importer look broken.
    assert.equal(result.mode, 'native');
    assert.equal(result.imported, 0);
    assert.deepEqual(result.diagnostics, []);
  });

  it('restarts and says so when the history was reset', async () => {
    const existing: ImportCursor = {
      providerId: 'rtk',
      sourceId: DB,
      absolutePath: DB,
      // `rtk gain --reset` empties the table; a repopulated one starts again from a low id.
      fileIdentity: 'rtk-history:low=2:count=2828',
      byteOffset: 0,
      lastLineDigest: null,
      highWaterMark: '9999',
      updatedAt: '2026-07-31T08:00:00.000Z',
    };
    const target = store(existing);
    const result = await rtkAdapter.collectMetrics(context(), target);

    // Without the generation check the stored mark of 9999 would suppress every row
    // forever, and the importer would report a healthy no-op each time.
    assert.equal(result.imported, 2);
    assert.equal(result.diagnostics[0]?.code, 'provider-metrics-source-reset');
  });

  it('appends before it advances', async () => {
    const order: string[] = [];
    const target = store();
    const observed: MetricsStore = {
      ...target,
      appendEvents: async (batch) => {
        order.push('append');
        await target.appendEvents(batch);
      },
      writeCursor: async (cursor) => {
        order.push('cursor');
        await target.writeCursor(cursor);
      },
    };
    await rtkAdapter.collectMetrics(context(), observed);

    // The other order would move the cursor past records that were never stored, and
    // nothing afterwards could tell that they were missing.
    assert.deepEqual(order, ['append', 'cursor']);
  });
});

describe('degradation', () => {
  const cases: ReadonlyArray<
    readonly [string, NonNullable<FakeDatabaseOptions['failure']>, string | null]
  > = [
    ['a provider that has never run', 'not-found', null],
    [
      'a runtime with no driver',
      'driver-unavailable',
      'Run Token Harness on a Node build that provides node:sqlite',
    ],
    ['a database it cannot open', 'unreadable', null],
    ['a schema that moved', 'query-failed', null],
    ['a read that hung', 'timed-out', null],
  ];

  for (const [name, failure, remediation] of cases) {
    it(`reports ${name} as unavailable rather than failing`, async () => {
      const result = await rtkAdapter.collectMetrics(
        context({ localDatabase: database({ failure }) }),
        store(),
      );

      assert.equal(result.mode, 'unavailable');
      assert.equal(result.imported, 0);
      assert.equal(result.cursor, null);
      // RFC 0005: a degraded mode "is a supported steady state, not a warning". What would
      // be a defect is presenting a degraded figure as an exact one.
      assert.equal(result.diagnostics[0]?.severity, 'info');
      assert.equal(result.diagnostics[0]?.remediation, remediation);
    });
  }

  it('reports unavailable when the host supplied no reader', async () => {
    const result = await rtkAdapter.collectMetrics(context({ localDatabase: null }), store());
    assert.equal(result.mode, 'unavailable');
    assert.equal(result.diagnostics[0]?.code, 'provider-metrics-unavailable');
  });

  it('warns, rather than informs, when rows are unreadable', async () => {
    const rows: LocalDatabaseRow[] = [
      HISTORY[0] as LocalDatabaseRow,
      // A row from a schema this build does not understand.
      { id: 2830, timestamp: 'not a date', input_tokens: 1, output_tokens: 1 },
      { id: 2831, timestamp: '2026-07-31T08:00:00.000000000+00:00', input_tokens: null },
    ];
    const result = await rtkAdapter.collectMetrics(
      context({ localDatabase: database({ rows }) }),
      store(),
    );

    assert.equal(result.imported, 1);
    assert.equal(result.skipped, 2);
    // A savings total quietly missing rows is the failure RFC 0005 exists to prevent, so
    // this one is a warning where a degraded mode is not.
    const skipped = result.diagnostics.find(
      (entry) => entry.code === 'provider-metrics-rows-skipped',
    );
    assert.equal(skipped?.severity, 'warning');
    // The cursor still advances past them: a row this build cannot read will not become
    // readable on the next run, and stopping would wedge the import permanently.
    assert.equal(result.cursor?.highWaterMark, '2831');
  });

  it('imports nothing from an empty table without reporting a problem', async () => {
    const result = await rtkAdapter.collectMetrics(
      context({ localDatabase: database({ rows: [] }) }),
      store(),
    );
    assert.equal(result.mode, 'native');
    assert.equal(result.imported, 0);
  });
});
