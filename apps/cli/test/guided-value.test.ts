import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { TaskBenchmarkContextMatrixReport } from '@token-harness/core';

import { guidedValueEvidence } from '../src/guided-value.js';

function matrix(entries: unknown[]): TaskBenchmarkContextMatrixReport {
  return { entries } as unknown as TaskBenchmarkContextMatrixReport;
}

function quotaEntry(input: {
  baseline: number;
  optimized: number;
  scope?: 'five-hour' | 'weekly';
  confidence?: 'authoritative' | 'reported';
  evidenceLevel?: 'quota-backed' | 'none';
}): unknown {
  return {
    verdict: 'optimized-better',
    basis: 'backend-quota',
    evidenceLevel: input.evidenceLevel ?? 'quota-backed',
    quota: {
      scope: input.scope ?? 'five-hour',
      baselineDeltaUsedPercent: input.baseline,
      optimizedDeltaUsedPercent: input.optimized,
      confidence: input.confidence ?? 'authoritative',
    },
  };
}

describe('guided value evidence', () => {
  it('keeps missing benchmark evidence missing', () => {
    const value = guidedValueEvidence(null);
    assert.equal(value.allowance5h.state, 'not-measured');
    assert.equal(value.allowance7d.state, 'not-measured');
    assert.equal(value.quality.state, 'not-measured');
    assert.deepEqual(value.candidates, []);
    assert.equal(value.apiCost.state, 'not-measured');
  });

  it('uses a median instead of adding authoritative 5h quota deltas', () => {
    const value = guidedValueEvidence(
      matrix([
        quotaEntry({ baseline: 6, optimized: 4 }),
        quotaEntry({ baseline: 9, optimized: 5 }),
        quotaEntry({ baseline: 2, optimized: 3 }),
      ]),
    );

    assert.equal(value.allowance5h.state, 'measured');
    assert.equal(value.allowance5h.savedPercent, 2);
    assert.equal(value.allowance5h.equivalentMinutes, 6);
    assert.equal(value.allowance5h.pairs, 3);
    assert.equal(value.quality.state, 'preserved');
  });

  it('does not promote reported quota into the demonstrated allowance metric', () => {
    const value = guidedValueEvidence(
      matrix([quotaEntry({ baseline: 8, optimized: 3, confidence: 'reported' })]),
    );

    assert.equal(value.allowance5h.state, 'not-measured');
    assert.equal(value.allowance5h.savedPercent, null);
  });

  it('blocks a positive allowance claim when paired quality regresses', () => {
    const value = guidedValueEvidence(
      matrix([
        quotaEntry({ baseline: 8, optimized: 4 }),
        {
          verdict: 'baseline-better',
          basis: 'quality',
          evidenceLevel: 'quality-only',
          quota: null,
        },
      ]),
    );

    assert.equal(value.quality.state, 'regressed');
    assert.equal(value.quality.regressions, 1);
    assert.equal(value.allowance5h.savedPercent, 4);
    assert.equal(value.allowance5h.state, 'blocked-by-quality');
  });

  it('blocks a positive allowance claim when quality has not been measured', () => {
    const value = guidedValueEvidence(
      matrix([quotaEntry({ baseline: 8, optimized: 4, evidenceLevel: 'none' })]),
    );

    assert.equal(value.quality.state, 'not-measured');
    assert.equal(value.allowance5h.savedPercent, 4);
    assert.equal(value.allowance5h.state, 'blocked-by-quality');
  });

  it('keeps weekly allowance as a percentage instead of inventing time conversion', () => {
    const value = guidedValueEvidence(
      matrix([quotaEntry({ baseline: 7, optimized: 5.5, scope: 'weekly' })]),
    );

    assert.equal(value.allowance7d.state, 'measured');
    assert.equal(value.allowance7d.savedPercent, 1.5);
    assert.equal(value.allowance7d.equivalentMinutes, null);
  });

  it('passes candidate-attributed benchmark summaries through without changing global value math', () => {
    const report = matrix([quotaEntry({ baseline: 8, optimized: 4 })]) as TaskBenchmarkContextMatrixReport & {
      candidateEvidence: Array<Record<string, unknown>>;
    };
    report.candidateEvidence = [
      {
        candidateId: 'headroom',
        pairs: 2,
        optimizedBetter: 2,
        baselineBetter: 0,
        equivalent: 0,
        inconclusive: 0,
        incomparable: 0,
        quotaBacked: 1,
        localEvidence: 1,
        qualityOnly: 0,
        localComparablePairs: 1,
        baselineLocalTokens: 1000,
        optimizedLocalTokens: 700,
        localTokenSavingPercent: 30,
      },
    ];

    const value = guidedValueEvidence(report as never);
    assert.equal(value.allowance5h.savedPercent, 4);
    assert.equal(value.candidates.length, 1);
    assert.equal(value.candidates[0]?.candidateId, 'headroom');
    assert.equal(value.candidates[0]?.localTokenSavingPercent, 30);
  });
});
