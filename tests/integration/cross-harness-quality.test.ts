import assert from 'node:assert/strict';
import test from 'node:test';

import {
  harnessId,
  hydrateCandidateQualityFromBenchmarkReceipts,
  type CrossHarnessSchedulerInput,
  type TaskBenchmarkReceipt,
  type TaskQualityGate,
} from '@token-harness/core';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function schedulerInput(): CrossHarnessSchedulerInput {
  return {
    taskClass: 'hard',
    current: {
      harnessId: CLAUDE,
      available: true,
      fiveHourPace: 'over-pace',
      weeklyPace: 'on-pace',
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    candidate: {
      harnessId: CODEX,
      available: true,
      fiveHourPace: 'under-pace',
      weeklyPace: 'on-pace',
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    transfer: {
      handoffBytes: 512,
      maxHandoffBytes: 2048,
      benefit: 'unknown',
    },
  };
}

function receipt(input: {
  benchmarkId: string;
  harness?: typeof CODEX;
  taskClass?: 'mechanical' | 'standard' | 'hard' | 'critical';
  variant?: 'baseline' | 'optimized';
  quality: TaskQualityGate;
}): TaskBenchmarkReceipt {
  return {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: input.variant ?? 'baseline',
    taskClass: input.taskClass ?? 'hard',
    harnessId: input.harness ?? CODEX,
    model: null,
    reasoningEffort: null,
    verbosity: null,
    startedAt: '2026-09-04T12:00:00.000Z',
    completedAt: '2026-09-04T12:05:00.000Z',
    usageBefore: [],
    usageAfter: [],
    localUsage: null,
    outcome: {
      qualityGate: input.quality,
      attempts: 1,
      failedAttempts: input.quality === 'failed' ? 1 : 0,
      errorCodes: [],
    },
  };
}

test('hydrates candidate quality from matching passed receipts only', () => {
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(schedulerInput(), [
    receipt({ benchmarkId: 'hard-a', quality: 'passed' }),
    receipt({ benchmarkId: 'hard-b', variant: 'optimized', quality: 'passed' }),
  ]);

  assert.equal(hydrated.input.candidate.quality, 'passed');
  assert.equal(hydrated.input.candidate.qualityTaskClass, 'hard');
  assert.equal(hydrated.input.candidate.qualitySamples, 2);
  assert.equal(hydrated.notes[0]?.code, 'benchmark-quality-passed');
});

test('hydrates failed only when all attributable known observations failed', () => {
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(schedulerInput(), [
    receipt({ benchmarkId: 'hard-a', quality: 'failed' }),
    receipt({ benchmarkId: 'hard-b', quality: 'failed' }),
  ]);

  assert.equal(hydrated.input.candidate.quality, 'failed');
  assert.equal(hydrated.input.candidate.qualitySamples, 2);
  assert.equal(hydrated.notes[0]?.code, 'benchmark-quality-failed');
});

test('conflicting passed and failed observations remain unknown', () => {
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(schedulerInput(), [
    receipt({ benchmarkId: 'hard-a', quality: 'passed' }),
    receipt({ benchmarkId: 'hard-b', quality: 'failed' }),
  ]);

  assert.equal(hydrated.input.candidate.quality, 'unknown');
  assert.equal(hydrated.input.candidate.qualityTaskClass, 'hard');
  assert.equal(hydrated.input.candidate.qualitySamples, 2);
  assert.equal(hydrated.notes[0]?.code, 'benchmark-quality-conflicting');
});

test('ignores other harnesses, task classes, and unknown quality gates', () => {
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(schedulerInput(), [
    receipt({ benchmarkId: 'claude-hard', harness: CLAUDE as typeof CODEX, quality: 'passed' }),
    receipt({ benchmarkId: 'codex-standard', taskClass: 'standard', quality: 'passed' }),
    receipt({ benchmarkId: 'codex-hard-unknown', quality: 'unknown' }),
  ]);

  assert.equal(hydrated.input.candidate.quality, 'unknown');
  assert.equal(hydrated.input.candidate.qualityTaskClass, null);
  assert.equal(hydrated.input.candidate.qualitySamples, 0);
  assert.equal(hydrated.notes[0]?.code, 'benchmark-quality-unavailable');
});

test('preserves any explicit candidate quality evidence instead of merging it', () => {
  const input = schedulerInput();
  input.candidate.quality = 'passed';
  input.candidate.qualityTaskClass = 'hard';
  input.candidate.qualitySamples = 3;

  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(input, [
    receipt({ benchmarkId: 'hard-failed', quality: 'failed' }),
  ]);

  assert.deepEqual(hydrated.input.candidate, input.candidate);
  assert.equal(hydrated.notes[0]?.code, 'explicit-quality-preserved');
});

test('deduplicates the same benchmark variant before counting samples', () => {
  const duplicated = receipt({ benchmarkId: 'hard-a', quality: 'passed' });
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(schedulerInput(), [
    duplicated,
    duplicated,
  ]);

  assert.equal(hydrated.input.candidate.quality, 'passed');
  assert.equal(hydrated.input.candidate.qualitySamples, 1);
});

test('quality hydration never changes quota pace or transfer evidence', () => {
  const input = schedulerInput();
  const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(input, [
    receipt({ benchmarkId: 'hard-a', quality: 'passed' }),
  ]);

  assert.equal(hydrated.input.current.fiveHourPace, input.current.fiveHourPace);
  assert.equal(hydrated.input.candidate.fiveHourPace, input.candidate.fiveHourPace);
  assert.deepEqual(hydrated.input.transfer, input.transfer);
});
