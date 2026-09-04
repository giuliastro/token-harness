import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessId,
  type FileSystemPort,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import { readProjectTransferExperiment } from '../src/transfer-runtime.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const STATE = '/state';
const PROJECT = 'p_current';
const ID = 'transfer-hard-a';
const DIR = `${STATE}/benchmarks/${ID}`;

type ReaderFs = Pick<FileSystemPort, 'join' | 'stat' | 'readFile'>;

function receipt(
  variant: 'baseline' | 'optimized',
  harness = variant === 'baseline' ? CLAUDE : CODEX,
): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: ID,
    variant,
    taskClass: 'hard',
    harnessId: harness,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T18:00:00.000Z',
    completedAt: '2026-09-04T18:10:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: {
      qualityGate: 'passed',
      attempts: 1,
      failedAttempts: 0,
      errorCodes: [],
    },
  };
}

function capture(
  variant: 'baseline' | 'optimized',
  projectId = PROJECT,
  harness = variant === 'baseline' ? CLAUDE : CODEX,
): TaskBenchmarkCapture {
  return {
    schemaVersion: 1,
    benchmarkId: ID,
    variant,
    taskClass: 'hard',
    harnessId: harness,
    projectId,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T18:00:00.000Z',
    usageBefore: [],
    localSessionsBefore: null,
  };
}

function fixture() {
  const encoder = new TextEncoder();
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>([DIR]);
  const putJson = (path: string, value: unknown) => {
    files.set(path, encoder.encode(JSON.stringify(value)));
  };

  putJson(`${DIR}/baseline.json`, receipt('baseline'));
  putJson(`${DIR}/optimized.json`, receipt('optimized'));
  putJson(`${DIR}/baseline.capture.json`, capture('baseline'));
  putJson(`${DIR}/optimized.capture.json`, capture('optimized'));
  files.set('handoff.md', encoder.encode('# Compact handoff\nnext action\n'));

  const fs: ReaderFs = {
    join: (...parts) => parts.join('/').replaceAll('//', '/'),
    stat: async (path) => {
      if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
      const bytes = files.get(path);
      return bytes === undefined
        ? null
        : { kind: 'file', byteLength: bytes.byteLength, mode: null };
    },
    readFile: async (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error('missing');
      return bytes;
    },
  };

  return { fs, files, putJson };
}

function input(fs: ReaderFs) {
  return {
    fs,
    stateRoot: STATE,
    projectId: PROJECT,
    benchmarkId: ID,
    handoffFile: 'handoff.md',
  };
}

test('admits a complete cross-harness pair from the current project and measures handoff bytes', async () => {
  const f = fixture();
  const result = await readProjectTransferExperiment(input(f.fs));

  assert.equal(result.status, 'observed');
  assert.equal(result.experiment?.stay.harnessId, CLAUDE);
  assert.equal(result.experiment?.switched.harnessId, CODEX);
  assert.equal(result.experiment?.handoffBytes, new TextEncoder().encode('# Compact handoff\nnext action\n').byteLength);
});

test('rejects a pair attributed to another project', async () => {
  const f = fixture();
  f.putJson(`${DIR}/optimized.capture.json`, capture('optimized', 'p_other'));

  const result = await readProjectTransferExperiment(input(f.fs));
  assert.equal(result.status, 'other-project');
  assert.equal(result.experiment, null);
});

test('rejects same-harness pairs instead of treating them as transfer evidence', async () => {
  const f = fixture();
  f.putJson(`${DIR}/optimized.json`, receipt('optimized', CLAUDE));
  f.putJson(`${DIR}/optimized.capture.json`, capture('optimized', PROJECT, CLAUDE));

  const result = await readProjectTransferExperiment(input(f.fs));
  assert.equal(result.status, 'invalid');
  assert.match(result.reason ?? '', /different baseline and optimized harnesses/);
});

test('rejects receipt/capture lineage mismatch', async () => {
  const f = fixture();
  f.putJson(`${DIR}/optimized.capture.json`, {
    ...capture('optimized'),
    taskClass: 'standard',
  });

  const result = await readProjectTransferExperiment(input(f.fs));
  assert.equal(result.status, 'invalid');
  assert.match(result.reason ?? '', /lineage/);
});

test('requires a complete pair and does not infer missing variants', async () => {
  const f = fixture();
  f.files.delete(`${DIR}/optimized.json`);

  const result = await readProjectTransferExperiment(input(f.fs));
  assert.equal(result.status, 'not-found');
  assert.equal(result.experiment, null);
});

test('requires the exact handoff artifact to be readable', async () => {
  const f = fixture();
  f.files.delete('handoff.md');

  const result = await readProjectTransferExperiment(input(f.fs));
  assert.equal(result.status, 'handoff-missing');
  assert.equal(result.experiment, null);
});
