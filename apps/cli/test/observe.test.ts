import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type CliEnvelope,
  type ObserveReport,
  type PlatformFacts,
  type MetricsStore,
} from '@token-harness/core';
import { parseArgv } from '../src/argv.js';
import { run } from '../src/run.js';

const facts: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '24.0.0',
  isWsl: false,
};

function evidenceStore(): { store: MetricsStore; mutations: string[] } {
  const mutations: string[] = [];
  const store: MetricsStore = {
    appendEvents: async () => {
      mutations.push('appendEvents');
    },
    writeCursor: async () => {
      mutations.push('writeCursor');
    },
    readCursor: async () => {
      mutations.push('readCursor');
      return null;
    },
    upsertReceipt: async () => {
      mutations.push('upsertReceipt');
    },
    query: async function* () {
      /* no previously imported events */
    },
  };
  return { store, mutations };
}

async function capture(argv: string[]) {
  const { store, mutations } = evidenceStore();
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    argv,
    platform: facts,
    cwd: '/tmp/token-harness-observe-test',
    home: '/tmp',
    stateRoot: '/tmp/token-harness-observe-test/state',
    adapters: null,
    metrics: store,
    now: () => '2026-10-17T12:00:00.000Z',
    streams: {
      out: (value) => {
        stdout += value;
      },
      err: (value) => {
        stderr += value;
      },
    },
  });
  return { exitCode, stdout, stderr, mutations };
}

describe('observe integration contract', () => {
  it('accepts observe and the stored-only metrics flag', () => {
    const m = parseArgv(['metrics', '--json', '--read-only']);
    assert.equal(m.kind, 'command');
    if (m.kind === 'command') assert.equal(m.options.readOnly, true);
    const o = parseArgv(['observe', '--json']);
    assert.equal(o.kind, 'command');
    if (o.kind === 'command') assert.equal(o.command, 'observe');
    assert.equal(parseArgv(['status', '--read-only']).kind, 'usage-error');
  });

  it('returns one versioned envelope with quotas, agents and metrics but no evidence writes', async () => {
    const res = await capture(['observe', '--json']);
    assert.equal(res.exitCode, 0);
    assert.equal(res.stderr, '');
    assert.deepEqual(res.mutations, []);
    const env = JSON.parse(res.stdout) as CliEnvelope<ObserveReport>;
    assert.equal(env.schemaVersion, 1);
    assert.equal(env.command, 'observe');
    assert.equal(env.data?.contractVersion, 1);
    assert.equal(env.data?.readOnly, true);
    assert.equal(env.data?.metricsFreshness, 'stored-only');
    assert.deepEqual(env.data?.agents, []);
    assert.deepEqual(env.data?.quotas.harnesses, []);
    assert.deepEqual(env.data?.metrics.providers, []);
    assert.ok(env.diagnostics.some((d) => d.code === 'metrics-not-imported'));
  });

  it('allows metrics --read-only without changing the evidence store', async () => {
    const res = await capture(['metrics', '--json', '--read-only']);
    assert.equal(res.exitCode, 0);
    assert.deepEqual(res.mutations, []);
    assert.equal(res.stderr, '');
    assert.equal((JSON.parse(res.stdout) as CliEnvelope<unknown>).command, 'metrics');
  });

  it('reports an invalid window as a normal usage error', async () => {
    const res = await capture(['observe', '--json', '--since', 'banana']);
    assert.equal(res.exitCode, 2);
    const env = JSON.parse(res.stdout) as CliEnvelope<ObserveReport>;
    assert.equal(env.data, null);
    assert.equal(env.command, 'observe');
  });
});
