import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type OptimizationCandidateId,
  type TaskBenchmarkMatrixEntry,
  type TaskClass,
} from '@token-harness/core';

import {
  assessCandidateEvidence,
  type CandidateAssessmentSlot,
  type CandidateEvidenceAssessmentInput,
} from '../src/commands/candidate-evidence-assessment.js';

const CODEX = harnessId('codex');

function entry(
  benchmarkId: string,
  taskClass: TaskClass,
  verdict: TaskBenchmarkMatrixEntry['verdict'] = 'optimized-better',
  basis: TaskBenchmarkMatrixEntry['basis'] = 'local-usage',
): TaskBenchmarkMatrixEntry {
  return {
    benchmarkId,
    taskClass,
    harnessId: CODEX,
    verdict,
    basis,
    evidenceLevel: basis === 'quality' ? 'quality-only' : 'local-evidence',
    baselineLocalTokens: 1000,
    optimizedLocalTokens: verdict === 'baseline-better' ? 1100 : 700,
    localTokenSavingPercent: verdict === 'baseline-better' ? -10 : 30,
    quota: null,
  };
}

function campaign(
  rows: readonly TaskBenchmarkMatrixEntry[],
  candidateId: OptimizationCandidateId = 'gitnexus',
  input: Partial<CandidateEvidenceAssessmentInput['evidence']> = {},
): CandidateEvidenceAssessmentInput {
  const slots: CandidateAssessmentSlot[] = rows.map((row) => ({
    benchmarkId: row.benchmarkId,
    taskClass: row.taskClass,
    state: 'complete',
  }));
  const evidencePairs = rows.filter((row) => row.evidenceLevel !== 'none').length;
  return {
    candidateId,
    totalPairs: 8,
    completedPairs: rows.length,
    invalidPairs: 0,
    slots,
    entries: rows,
    evidence: {
      evidencePairs,
      evidenceCoveragePercent: rows.length === 0 ? null : 100,
      optimizedBetter: rows.filter((row) => row.verdict === 'optimized-better').length,
      baselineBetter: rows.filter((row) => row.verdict === 'baseline-better').length,
      equivalent: rows.filter((row) => row.verdict === 'equivalent').length,
      inconclusive: rows.filter((row) => row.verdict === 'inconclusive').length,
      incomparable: rows.filter((row) => row.verdict === 'incomparable').length,
      wallClockComparablePairs: 0,
      wallClockSavingPercent: null,
      ...input,
    },
  };
}

const sixClasses: readonly [string, TaskClass][] = [
  ['eval-m-1', 'mechanical'],
  ['eval-m-2', 'mechanical'],
  ['eval-s-1', 'standard'],
  ['eval-s-2', 'standard'],
  ['eval-h-1', 'hard'],
  ['eval-h-2', 'hard'],
];

describe('candidate evidence assessment', () => {
  it('keeps small or narrow samples explicitly insufficient', () => {
    const result = assessCandidateEvidence(
      campaign([entry('eval-m-1', 'mechanical'), entry('eval-m-2', 'mechanical', 'equivalent')]),
    );

    assert.equal(result.signal, 'insufficient-evidence');
    assert.equal(result.decisionReady, false);
    assert.equal(result.evidencePairs, 2);
    assert.deepEqual(result.coveredTaskClasses, ['mechanical']);
    assert.ok(result.reasons.some((reason) => reason.includes('6 evidence-bearing')));
    assert.ok(result.reasons.some((reason) => reason.includes('3 task classes')));
  });

  it('rejects a hard quality or reliability regression without waiting for the full campaign', () => {
    const result = assessCandidateEvidence(
      campaign([entry('eval-m-1', 'mechanical', 'baseline-better', 'quality')]),
    );

    assert.equal(result.signal, 'negative');
    assert.equal(result.decisionReady, true);
    assert.equal(result.hardRegressionPairs, 1);
    assert.ok(result.reasons.some((reason) => reason.includes('quality')));
  });

  it('marks contradictory decision-grade evidence as mixed', () => {
    const rows = sixClasses.map(([id, taskClass], index) =>
      entry(id, taskClass, index === 5 ? 'baseline-better' : 'optimized-better'),
    );
    const result = assessCandidateEvidence(campaign(rows));

    assert.equal(result.signal, 'mixed');
    assert.equal(result.decisionReady, true);
    assert.equal(result.coveredTaskClasses.length, 3);
    assert.ok(result.reasons.some((reason) => reason.includes('both optimized wins')));
  });

  it('treats material quality-passed latency regression as a mixed operational trade-off', () => {
    const rows = sixClasses.map(([id, taskClass]) => entry(id, taskClass));
    const result = assessCandidateEvidence(
      campaign(rows, 'gitnexus', {
        wallClockComparablePairs: 6,
        wallClockSavingPercent: -20,
      }),
    );

    assert.equal(result.signal, 'mixed');
    assert.equal(result.decisionReady, true);
    assert.ok(result.reasons.some((reason) => reason.includes('wall clock regressed')));
  });

  it('emits a promising selection signal only after repeated multi-class wins', () => {
    const rows = sixClasses.map(([id, taskClass], index) =>
      entry(id, taskClass, index < 4 ? 'optimized-better' : 'equivalent'),
    );
    const result = assessCandidateEvidence(campaign(rows));

    assert.equal(result.signal, 'promising');
    assert.equal(result.decisionReady, true);
    assert.equal(result.promotionEligible, false);
    assert.equal(result.hardRegressionPairs, 0);
    assert.deepEqual(result.coveredTaskClasses, ['mechanical', 'standard', 'hard']);
    assert.ok(result.promotionBlockers.some((blocker) => blocker.includes('verify activation')));
    assert.ok(
      result.promotionBlockers.some((blocker) => blocker.includes('campaign is not complete')),
    );
  });

  it('keeps the broad-context-owner admission gate visible for Headroom', () => {
    const rows = sixClasses.map(([id, taskClass]) => entry(id, taskClass));
    const result = assessCandidateEvidence(campaign(rows, 'headroom'));

    assert.equal(result.signal, 'promising');
    assert.ok(
      result.promotionBlockers.some((blocker) => blocker.includes('context-owner admission gate')),
    );
  });
});
