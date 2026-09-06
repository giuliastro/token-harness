import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  harnessId,
  type FileSystemPort,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';
import type { CommandContext } from '../src/commands/context.js';
import {
  readOptimizationHistory,
  OPTIMIZATION_HISTORY_MAX_BENCHMARKS,
  OPTIMIZATION_HISTORY_MAX_FILE_BYTES,
} from '../src/commands/optimization-history.js';

function world() {
  const root = '/state/benchmarks';
  const dirs = new Set([root]);
  const files = new Map<string, Uint8Array>();
  let reads = 0;
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const fail = async (): Promise<never> => {
    throw new Error('read-only');
  };
  const fs: FileSystemPort = {
    join: (...parts) => parts.join('/'),
    dirname: (path) => path.slice(0, path.lastIndexOf('/')),
    basename: (path) => path.split('/').at(-1)!,
    isInside: (path, parent) => path.startsWith(parent + '/'),
    stat: async (path) =>
      dirs.has(path)
        ? { kind: 'directory', byteLength: 0, mode: null }
        : files.has(path)
          ? { kind: 'file', byteLength: files.get(path)!.length, mode: null }
          : null,
    readFile: async (path) => {
      reads++;
      return files.get(path)!;
    },
    readDirectory: async () =>
      [...dirs].filter((path) => path !== root).map((path) => path.split('/').at(-1)!),
    writeFile: fail,
    appendFile: fail,
    remove: fail,
    createDirectory: fail,
  };
  const context: CommandContext = {
    platform: {
      os: 'linux',
      arch: 'x64',
      osDisplayName: 'test',
      isWsl: false,
      nodeVersion: '22.13.0',
    },
    projectRoot: '/project',
    home: '/home',
    stateRoot: '/state',
    harness: harnessId('codex'),
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-06T12:00:00.000Z',
    adapters: {
      fs,
      localDatabase: null,
      runner: { run: fail },
      projectIdFor: () => 'project-a',
      paths: { home: '/home', config: '/config', data: '/data', state: '/state', cache: '/cache' },
    },
  };
  const add = (id = 'trial-1', project = 'project-a') => {
    const capture: TaskBenchmarkCapture = {
      schemaVersion: 1,
      benchmarkId: id,
      variant: 'baseline',
      projectId: project,
      taskClass: 'hard',
      harnessId: harnessId('codex'),
      model: 'fixture-model',
      reasoningEffort: 'high',
      verbosity: 'low',
      startedAt: '2026-09-06T10:00:00.000Z',
      usageBefore: [],
      localSessionsBefore: null,
    };
    const receipt: TaskBenchmarkReceipt = {
      schemaVersion: 1,
      benchmarkId: id,
      variant: 'baseline',
      taskClass: capture.taskClass,
      harnessId: capture.harnessId,
      model: capture.model,
      reasoningEffort: capture.reasoningEffort,
      verbosity: capture.verbosity,
      startedAt: capture.startedAt,
      completedAt: '2026-09-06T10:10:00.000Z',
      usageBefore: [],
      usageAfter: [],
      localUsage: null,
      outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
      policyAtFinish: {
        model: capture.model,
        reasoningEffort: capture.reasoningEffort,
        verbosity: capture.verbosity,
        verification: 'config-only',
      },
    };
    const directory = root + '/' + id;
    dirs.add(directory);
    const start = directory + '/baseline.capture.json';
    const end = directory + '/baseline.json';
    files.set(start, encode(capture));
    files.set(end, encode(receipt));
    return { capture, receipt, start, end };
  };
  return { context, files, dirs, fs, add, encode, reads: () => reads };
}

describe('bounded project optimization history', () => {
  it('admits only complete current-project lineage and remains read-only', async () => {
    const w = world();
    const local = w.add();
    w.add('foreign', 'project-b');
    const result = await readOptimizationHistory(w.context);
    assert.equal(result.state, 'available');
    assert.deepEqual(result.receipts, [local.receipt]);
  });
  it('does not read another project receipt payload', async () => {
    const w = world();
    const foreign = w.add('foreign', 'project-b');
    w.files.set(foreign.end, new Uint8Array(600_000));
    assert.deepEqual((await readOptimizationHistory(w.context)).receipts, []);
    assert.equal(w.reads(), 1);
  });
  it('treats absent history and in-progress captures as empty, not failed', async () => {
    const w = world();
    w.dirs.clear();
    assert.deepEqual((await readOptimizationHistory(w.context)).receipts, []);
    w.dirs.add('/state/benchmarks');
    const row = w.add();
    w.files.delete(row.end);
    assert.deepEqual((await readOptimizationHistory(w.context)).receipts, []);
  });
  it('does not discard an orphan completed receipt and keep favorable rows', async () => {
    const w = world();
    w.add();
    const orphan = w.add('orphan');
    w.files.delete(orphan.start);
    assert.equal((await readOptimizationHistory(w.context)).receipts, null);
  });
  for (const key of [
    'benchmarkId',
    'variant',
    'taskClass',
    'harnessId',
    'model',
    'reasoningEffort',
    'verbosity',
    'startedAt',
  ] as const) {
    it('rejects mismatched ' + key + ' instead of trusting the receipt alone', async () => {
      const w = world();
      const row = w.add();
      const replacements = {
        benchmarkId: 'another',
        variant: 'optimized',
        taskClass: 'standard',
        harnessId: 'claude',
        model: 'other-model',
        reasoningEffort: 'medium',
        verbosity: 'high',
        startedAt: '2026-09-06T09:59:00.000Z',
      };
      w.files.set(row.end, w.encode({ ...row.receipt, [key]: replacements[key] }));
      assert.equal((await readOptimizationHistory(w.context)).receipts, null);
    });
  }
  it('keeps legacy receipts readable without fabricating boundary evidence', async () => {
    const w = world();
    const row = w.add();
    delete row.receipt.policyAtFinish;
    w.files.set(row.end, w.encode(row.receipt));
    const result = await readOptimizationHistory(w.context);
    assert.equal(result.state, 'available');
    assert.equal(Object.hasOwn(result.receipts![0]!, 'policyAtFinish'), false);
  });
  for (const kind of ['json', 'utf8', 'future-schema', 'changing-size'] as const) {
    it('fails closed for ' + kind + ' without leaking private exception content', async () => {
      const w = world();
      const row = w.add();
      if (kind === 'json') w.files.set(row.end, new TextEncoder().encode('{private-file'));
      if (kind === 'utf8') w.files.set(row.end, new Uint8Array([255]));
      if (kind === 'future-schema')
        w.files.set(row.end, w.encode({ ...row.receipt, schemaVersion: 900 }));
      if (kind === 'changing-size') w.fs.readFile = async () => new Uint8Array();
      const result = await readOptimizationHistory(w.context);
      assert.equal(result.state, 'unavailable');
      assert.equal(result.receipts, null);
      assert.doesNotMatch(JSON.stringify(result), /private-file|\/state/);
    });
  }
  it('bounds individual files before reading them', async () => {
    const w = world();
    const row = w.add();
    w.files.set(row.start, new Uint8Array(OPTIMIZATION_HISTORY_MAX_FILE_BYTES + 1));
    assert.equal((await readOptimizationHistory(w.context)).state, 'limited');
    assert.equal(w.reads(), 0);
  });
  it('bounds directory scans before reading any evidence', async () => {
    const w = world();
    for (let i = 0; i <= OPTIMIZATION_HISTORY_MAX_BENCHMARKS; i++)
      w.dirs.add('/state/benchmarks/trial-' + String(i));
    assert.equal((await readOptimizationHistory(w.context)).state, 'limited');
    assert.equal(w.reads(), 0);
  });
  it('bounds total bytes instead of accepting a favorable truncated sample', async () => {
    const w = world();
    for (let i = 0; i < 20; i++) {
      const row = w.add('trial-' + String(i));
      w.files.set(row.start, w.encode({ ...row.capture, padding: 'x'.repeat(480_000) }));
    }
    const result = await readOptimizationHistory(w.context);
    assert.equal(result.state, 'limited');
    assert.equal(result.receipts, null);
  });
  it('refuses a growing read that crosses the bound', async () => {
    const w = world();
    w.add();
    w.fs.readFile = async () => new Uint8Array(600_000);
    assert.equal((await readOptimizationHistory(w.context)).state, 'limited');
  });
  it('refuses unavailable attribution and IO errors without invoking a provider', async () => {
    const w = world();
    w.context.adapters!.projectIdFor = () => '';
    assert.equal((await readOptimizationHistory(w.context)).state, 'unavailable');
    w.context.adapters!.projectIdFor = () => 'project-a';
    w.fs.readDirectory = async () => {
      throw new Error('secret path');
    };
    assert.doesNotMatch(JSON.stringify(await readOptimizationHistory(w.context)), /secret path/);
    assert.equal((await readOptimizationHistory({ ...w.context, adapters: null })).receipts, null);
  });
  it('ignores unsafe path names without traversing them', async () => {
    const w = world();
    w.fs.readDirectory = async () => ['../outside', '/absolute', '..', ''];
    assert.deepEqual((await readOptimizationHistory(w.context)).receipts, []);
    assert.equal(w.reads(), 0);
  });
});
