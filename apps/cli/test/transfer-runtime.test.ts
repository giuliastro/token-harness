import assert from 'node:assert/strict';
import test from 'node:test';

import {
  digestText,
  harnessId,
  parseCrossHarnessTransferReceipt,
  type FileSystemPort,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import {
  readProjectTransferExperiment,
  recordProjectTransferEvidence,
} from '../src/transfer-runtime.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const STATE = '/state';
const PROJECT = 'p_current';
const ID = 'transfer-hard-a';
const DIR = `${STATE}/benchmarks/${ID}`;

type TestFs = Pick<FileSystemPort, 'join' | 'stat' | 'readFile' | 'writeFile'>;

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
      attempts: variant === 'baseline' ? 2 : 1,
      failedAttempts: variant === 'baseline' ? 1 : 0,
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
  const writes: string[] = [];
  const putJson = (path: string, value: unknown) => {
    files.set(path, encoder.encode(JSON.stringify(value)));
  };

  putJson(`${DIR}/baseline.json`, receipt('baseline'));
  putJson(`${DIR}/optimized.json`, receipt('optimized'));
  putJson(`${DIR}/baseline.capture.json`, capture('baseline'));
  putJson(`${DIR}/optimized.capture.json`, capture('optimized'));
  files.set('handoff.md', encoder.encode('# Compact handoff\nnext action\n'));

  const fs: TestFs = {
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
    writeFile: async (path, content) => {
      writes.push(path);
      files.set(path, content);
    },
  };

  return { fs, files, writes, putJson };
}

function input(fs: TestFs) {
  return {
    fs,
    stateRoot: STATE,
    projectId: PROJECT,
    benchmarkId: ID,
    handoffFile: 'handoff.md',
  };
}

test('admits a complete cross-harness pair and fingerprints the exact handoff', async () => {
  const f = fixture();
  const result = await readProjectTransferExperiment(input(f.fs));

  assert.equal(result.status, 'observed');
  assert.equal(result.experiment?.projectId, PROJECT);
  assert.equal(result.experiment?.stay.harnessId, CLAUDE);
  assert.equal(result.experiment?.switched.harnessId, CODEX);
  assert.equal(
    result.experiment?.handoffBytes,
    new TextEncoder().encode('# Compact handoff\nnext action\n').byteLength,
  );
  assert.equal(result.experiment?.handoffDigest, digestText('# Compact handoff\nnext action\n'));
});

test('records one parseable immutable transfer receipt beside the benchmark pair', async () => {
  const f = fixture();
  const result = await recordProjectTransferEvidence({
    ...input(f.fs),
    maxHandoffBytes: 2048,
    recordedAt: '2026-09-04T21:50:00.000Z',
  });

  assert.equal(result.status, 'recorded');
  assert.equal(result.receiptPath, `${DIR}/transfer.json`);
  assert.equal(result.receipt?.benefit, 'proven-positive');
  assert.equal(result.receipt?.basis, 'failed-attempts');
  assert.deepEqual(f.writes, [`${DIR}/transfer.json`]);

  const stored = JSON.parse(
    new TextDecoder().decode(f.files.get(`${DIR}/transfer.json`)),
  ) as unknown;
  const parsed = parseCrossHarnessTransferReceipt(stored);
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.receipt.projectId, PROJECT);
    assert.equal(parsed.receipt.handoffDigest, digestText('# Compact handoff\nnext action\n'));
  }
});

test('never overwrites an existing transfer evidence receipt', async () => {
  const f = fixture();
  const first = await recordProjectTransferEvidence({
    ...input(f.fs),
    maxHandoffBytes: 2048,
    recordedAt: '2026-09-04T21:50:00.000Z',
  });
  assert.equal(first.status, 'recorded');
  const original = new Uint8Array(f.files.get(`${DIR}/transfer.json`) ?? []);

  const second = await recordProjectTransferEvidence({
    ...input(f.fs),
    maxHandoffBytes: 512,
    recordedAt: '2026-09-04T22:00:00.000Z',
  });
  assert.equal(second.status, 'exists');
  assert.deepEqual(f.writes, [`${DIR}/transfer.json`]);
  assert.deepEqual(f.files.get(`${DIR}/transfer.json`), original);
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
