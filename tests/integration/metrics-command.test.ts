/**
 * `token-harness metrics` end to end — RFC 0006 §Golden path and §Streams.
 *
 * Driven through `run`, so the argument parsing, the exit code, the envelope, and the stream
 * discipline are all the real ones. The store is a real `JsonlStore` over a real filesystem
 * in a temporary directory; the *provider* is faked, because the point here is the command
 * rather than RTK's database, and `packages/adapters/test/rtk-metrics.test.ts` covers that.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  JsonlStore,
  UNATTRIBUTED_PROJECT_ID,
  type CliEnvelope,
  type MetricsReport,
  type OptimizationEvent,
  type PlatformFacts,
} from '@token-harness/core';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { run, createGuideCall, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const NOW = '2026-07-31T12:00:00.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-metrics-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function event(overrides: {
  id: string;
  timestamp: string;
  beforeTokens?: number;
  afterTokens?: number;
  changed?: boolean;
  projectId?: string;
  harness?: string;
}): OptimizationEvent {
  const beforeTokens = overrides.beforeTokens ?? 100;
  const afterTokens = overrides.afterTokens ?? 40;
  return {
    schemaVersion: 1,
    eventId: overrides.id,
    timestamp: overrides.timestamp,
    provider: { id: 'rtk', version: '0.42.0' },
    context: {
      projectId: overrides.projectId ?? 'p_1',
      harnessId: overrides.harness ?? 'claude',
      sessionId: null,
      operationId: overrides.id,
      pipelineId: null,
      pipelineOrder: null,
      toolFamily: null,
      capability: 'shell.output.reduce',
    },
    measurement: {
      class: 'exact-local',
      beforeChars: null,
      afterChars: null,
      beforeTokens,
      afterTokens,
      tokenizer: 'rtk',
      confidenceLow: null,
      confidenceHigh: null,
    },
    outcome: {
      changed: overrides.changed ?? afterTokens !== beforeTokens,
      bypassReason: null,
      originalReference: null,
      latencyMs: null,
      errorCode: null,
    },
    source: { nativeEventId: null, importedAt: NOW },
  };
}

interface Captured {
  exitCode: number;
  stdout: string;
  stderr: string;
}

async function runMetrics(
  argv: readonly string[],
  seed: readonly OptimizationEvent[],
): Promise<Captured> {
  counter += 1;
  const stateRoot = join(sandbox, `state-${String(counter)}`);
  const fs = new NodeFileSystem(FACTS);
  const store = new JsonlStore({ fs, stateRoot, now: () => NOW });
  if (seed.length > 0) await store.appendEvents([...seed]);

  let stdout = '';
  let stderr = '';
  const options: RunOptions = {
    argv,
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
    platform: FACTS,
    cwd: sandbox,
    home: sandbox,
    stateRoot,
    // No adapters, so no importer runs and the report covers exactly the seeded events.
    // That separation is deliberate: an importer that also ran would make every assertion
    // here depend on a provider being installed.
    adapters: null,
    metrics: store,
    now: () => NOW,
  };
  const exitCode = await run(options);
  return { exitCode, stdout, stderr };
}

/**
 * The same run, but with adapters present, which is what makes the report project-scoped.
 *
 * `adapters` carries `projectIdFor`, and without it there is no project identity to filter on.
 * Nothing resolves on `PATH` here, so every importer reads as not installed and imports nothing:
 * the report still covers exactly the seeded events, and the only difference from `runMetrics` is
 * that a scope exists.
 */
async function runScopedMetrics(
  argv: readonly string[],
  seed: readonly OptimizationEvent[],
  projectId: string,
): Promise<{ report: MetricsReport; codes: string[] }> {
  counter += 1;
  const stateRoot = join(sandbox, `state-${String(counter)}`);
  const fs = new NodeFileSystem(FACTS);
  const store = new JsonlStore({ fs, stateRoot, now: () => NOW });
  if (seed.length > 0) await store.appendEvents([...seed]);

  let stdout = '';
  const options: RunOptions = {
    argv,
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: () => {},
    },
    platform: FACTS,
    cwd: sandbox,
    home: sandbox,
    stateRoot,
    adapters: {
      fs,
      runner: new NodeProcessRunner({ facts: FACTS, env: process.env, resolve: () => null }),
      paths: {
        home: sandbox,
        config: join(sandbox, 'config'),
        data: join(sandbox, 'data'),
        state: stateRoot,
        cache: join(sandbox, 'cache'),
      },
      localDatabase: null,
      projectIdFor: () => projectId,
    },
    metrics: store,
    now: () => NOW,
  };
  const envelope =
    argv[0] === 'savings'
      ? await createGuideCall(options)<MetricsReport>(argv)
      : (await run(options), JSON.parse(stdout) as CliEnvelope<MetricsReport>);
  assert.ok(envelope.data);
  return { report: envelope.data, codes: envelope.diagnostics.map((entry) => entry.code) };
}

describe('the project scope', () => {
  const timestamp = '2026-07-30T10:00:00.000Z';

  it('reports only the events belonging to the project asked about', async () => {
    // The regression: the store filters on `projectId` and the filter was never passed, so every
    // report was the sum of every project the store had seen. On the development machine a
    // freshly created empty directory reported 621,206 characters saved across 50 other projects,
    // and each of those projects reported that same figure.
    const { report } = await runScopedMetrics(
      ['metrics', '--json', '--since', '7d'],
      [
        event({ id: 'mine', timestamp, projectId: 'p_mine' }),
        event({ id: 'theirs-1', timestamp, projectId: 'p_theirs' }),
        event({ id: 'theirs-2', timestamp, projectId: 'p_theirs' }),
      ],
      'p_mine',
    );

    const provider = report.providers.find((row) => row.providerId === 'rtk');
    assert.ok(provider);
    assert.equal(provider.operations, 1);
  });

  it('reports nothing for a project the store has never seen', async () => {
    const { report } = await runScopedMetrics(
      ['metrics', '--json', '--since', '7d'],
      [event({ id: 'theirs', timestamp, projectId: 'p_theirs' })],
      'p_fresh',
    );

    assert.deepEqual(report.providers, []);
    for (const row of report.classes) {
      assert.equal(row.saved, null);
    }
  });

  it('excludes an operation that names no project, and says how many', async () => {
    // RTK records a `project_path` that can be empty. Such an operation belongs to no project,
    // and it used to be added to whichever project was asked about. Counted, not dropped silently.
    const { report, codes } = await runScopedMetrics(
      ['metrics', '--json', '--since', '7d'],
      [
        event({ id: 'mine', timestamp, projectId: 'p_mine' }),
        event({ id: 'nowhere', timestamp, projectId: UNATTRIBUTED_PROJECT_ID }),
      ],
      'p_mine',
    );

    const provider = report.providers.find((row) => row.providerId === 'rtk');
    assert.ok(provider);
    assert.equal(provider.operations, 1);
    assert.ok(codes.includes('metrics-unattributed-excluded'));
  });

  it('says so when there is no project identity to scope by', async () => {
    // `runMetrics` passes no adapters, which is the host with a store and no machine behind it.
    // The unscoped read is still the only thing available there, so it is stated rather than
    // presented as a project's figures.
    const { stdout } = await runMetrics(
      ['metrics', '--json', '--since', '7d'],
      [event({ id: 'any', timestamp, projectId: 'p_theirs' })],
    );
    const envelope = JSON.parse(stdout) as CliEnvelope<MetricsReport>;
    assert.ok(envelope.diagnostics.some((entry) => entry.code === 'metrics-not-project-scoped'));
  });
});

describe('the harness scope', () => {
  const timestamp = '2026-07-30T10:00:00.000Z';

  it('passes --harness through to the metrics store query', async () => {
    const { report } = await runScopedMetrics(
      ['metrics', '--json', '--since', '7d', '--harness', 'claude'],
      [
        event({ id: 'claude-event', timestamp, projectId: 'p_mine', harness: 'claude' }),
        event({ id: 'codex-event', timestamp, projectId: 'p_mine', harness: 'codex' }),
      ],
      'p_mine',
    );

    const provider = report.providers.find((row) => row.providerId === 'rtk');
    assert.ok(provider);
    assert.equal(provider.operations, 1);
    assert.deepEqual(provider.harnesses, ['claude']);
  });
});

describe('the window', () => {
  const events = [
    event({ id: 'old', timestamp: '2026-07-01T10:00:00.000Z' }),
    event({ id: 'recent', timestamp: '2026-07-30T10:00:00.000Z' }),
  ];

  it('defaults to seven days', async () => {
    const result = await runMetrics(['metrics', '--json'], events);
    const report = (JSON.parse(result.stdout) as CliEnvelope<MetricsReport>).data;
    assert.ok(report);

    assert.equal(report.windowStart, '2026-07-24');
    assert.equal(report.windowEnd, '2026-07-31');
    // Only the recent one: 60 saved, not 120.
    assert.equal(report.classes[0]?.saved, 60);
  });

  it('widens with --since', async () => {
    const result = await runMetrics(['metrics', '--since', '60d', '--json'], events);
    const report = (JSON.parse(result.stdout) as CliEnvelope<MetricsReport>).data;
    assert.ok(report);
    assert.equal(report.classes[0]?.saved, 120);
  });

  it('accepts an absolute range', async () => {
    const result = await runMetrics(
      ['metrics', '--since', '2026-06-30', '--until', '2026-07-02', '--json'],
      events,
    );
    const report = (JSON.parse(result.stdout) as CliEnvelope<MetricsReport>).data;
    assert.ok(report);
    assert.equal(report.classes[0]?.saved, 60);
    assert.equal(report.windowEnd, '2026-07-02');
  });

  const badWindows = ['banana', '7', '7y', '2026-02-31'];
  for (const value of badWindows) {
    it(`rejects --since ${value} as a usage error`, async () => {
      const result = await runMetrics(['metrics', '--since', value, '--json'], events);
      // RFC 0006 §Exit codes 2: a bad flag value is a usage error, not a failed report.
      assert.equal(result.exitCode, 2);
      const envelope = JSON.parse(result.stdout) as CliEnvelope<null>;
      assert.equal(envelope.data, null);
      assert.equal(envelope.diagnostics[0]?.code, 'invalid-argument');
    });
  }
});

describe('the envelope', () => {
  it('is one JSON document on stdout with nothing on stderr', async () => {
    const result = await runMetrics(
      ['metrics', '--json'],
      [event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })],
    );

    assert.equal(result.stderr, '');
    assert.doesNotThrow(() => JSON.parse(result.stdout));
    assert.equal(result.exitCode, 0);
  });

  it('exits 0 on an empty window, because an empty report is a fact', async () => {
    const result = await runMetrics(['metrics', '--json'], []);
    const report = (JSON.parse(result.stdout) as CliEnvelope<MetricsReport>).data;
    assert.ok(report);

    assert.equal(result.exitCode, 0);
    assert.deepEqual(report.providers, []);
    // Not 0%: nothing happened, which is a different statement from nothing being optimized.
    assert.equal(report.coveragePercent, null);
  });
});

describe('the human rendering', () => {
  it('keeps each class on its own line and never prints a combined total', async () => {
    const result = await runMetrics(
      ['metrics', '--verbose'],
      [event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })],
    );

    assert.match(result.stdout, /^Savings — 2026-07-24 to 2026-07-31$/m);
    assert.match(result.stdout, /^Exact local .* saved 60$/m);
    assert.match(result.stdout, /^Estimated local .* none recorded$/m);
    assert.match(result.stdout, /^End-to-end billed .* no A\/B run$/m);
  });

  it('reports an unmeasured latency as unmeasured', async () => {
    const result = await runMetrics(
      ['metrics', '--verbose'],
      [event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })],
    );
    // `0ms` would claim the overhead was measured and found negligible.
    assert.match(result.stdout, /Added median latency not measured\./);
  });

  it('names inflated operations instead of leaving them inside a net figure', async () => {
    const result = await runMetrics(
      ['metrics', '--verbose'],
      [
        event({ id: 'shrank', timestamp: '2026-07-30T10:00:00.000Z' }),
        event({
          id: 'grew',
          timestamp: '2026-07-30T11:00:00.000Z',
          beforeTokens: 100,
          afterTokens: 150,
        }),
      ],
    );

    assert.match(result.stdout, /1 operations made the payload larger/);
    // Net of the inflation, and the provider row agrees with the class line.
    assert.match(result.stdout, /^Exact local .* saved 10$/m);
    // Columns are separated by a visible ` - ` now, not by padding alone.
    assert.match(result.stdout, /rtk\s+-\s+saved 10 tokens/);
  });

  it('says nothing about inflation when there was none', async () => {
    const result = await runMetrics(
      ['metrics', '--verbose'],
      [event({ id: 'a', timestamp: '2026-07-30T10:00:00.000Z' })],
    );
    assert.doesNotMatch(result.stdout, /made the payload larger/);
  });

  it('reports a store-less host as covering no events rather than failing', async () => {
    let stdout = '';
    const exitCode = await run({
      argv: ['metrics', '--verbose'],
      streams: { out: (text) => (stdout += text), err: () => undefined },
      platform: FACTS,
      cwd: sandbox,
      home: sandbox,
      adapters: null,
      metrics: null,
      now: () => NOW,
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /Savings — 2026-07-24 to 2026-07-31/);
  });
});

describe('help', () => {
  it('lists metrics as a command rather than as not in this build', async () => {
    let stdout = '';
    await run({
      argv: ['--help'],
      streams: { out: (text) => (stdout += text), err: () => undefined },
      platform: FACTS,
      cwd: sandbox,
      home: sandbox,
      now: () => NOW,
    });

    /**
     * The intent, not the wording.
     *
     * This pinned the exact sentence "Import provider records…", and broke when the help text was
     * rewritten to lead with what a reader wants first. RFC 0006 rule 4 is explicit that "messages
     * may be reworded; codes may not" — so what is asserted is that `metrics` appears as a listed
     * command with a description, and not as one this build does not carry.
     */
    assert.match(stdout, /^ {2}metrics {4,}\S/m, 'metrics is not listed as a command');
    assert.doesNotMatch(stdout, /metrics {2,}Not in this build/);
  });
});

describe('guided all-project savings', () => {
  it('includes retained history from other projects without changing metrics default scope', async () => {
    const seed = [
      event({ id: 'one', timestamp: '2026-07-30T10:00:00Z', projectId: 'p_1' }),
      event({ id: 'two', timestamp: '2026-07-30T10:01:00Z', projectId: 'p_2' }),
      event({ id: 'old', timestamp: '2025-01-01T10:00:00Z', projectId: 'p_2' }),
      event({
        id: 'unknown',
        timestamp: '2026-07-30T10:02:00Z',
        projectId: UNATTRIBUTED_PROJECT_ID,
      }),
    ];
    const ordinary = await runScopedMetrics(['metrics', '--json'], seed, 'p_1');
    assert.equal(ordinary.report.providers[0]?.operations, 1);
    assert.equal(ordinary.report.scope, undefined);
    const all = await runScopedMetrics(['savings'], seed, 'p_1');
    assert.equal(all.report.scope, 'all-projects');
    assert.equal(all.report.providers[0]?.operations, 4);
    assert.equal(all.report.providers[0]?.saved, 240);
    assert.equal(all.report.providers[0]?.before, 400);
    assert.equal(all.report.providers[0]?.after, 160);
    assert.equal(all.report.firstRecordedAt, '2025-01-01T10:00:00Z');
    assert.equal(all.report.pipelineTotal, undefined);
  });
  it('honors the selected savings period and keeps output growth negative', async () => {
    const all = await runScopedMetrics(
      ['savings', '--since', '7d'],
      [
        event({ id: 'old', timestamp: '2025-01-01T00:00:00Z' }),
        event({
          id: 'growth',
          timestamp: '2026-07-30T10:00:00Z',
          beforeTokens: 10,
          afterTokens: 15,
        }),
      ],
      'p_1',
    );
    assert.equal(all.report.providers[0]?.saved, -5);
    assert.equal(all.report.providers[0]?.before, 10);
    assert.equal(all.report.providers[0]?.after, 15);
    assert.equal(all.report.providers[0]?.operations, 1);
    assert.equal(all.report.inflatedOperations, 1);
  });
});
