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

  it('uses each authoritative quota scope independently and does not count the legacy selection twice', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          ...(quotaEntry({ baseline: 90, optimized: 1 }) as Record<string, unknown>),
          quotaComparisons: [
            {
              key: 'five-hour',
              scope: 'five-hour',
              baselineDeltaUsedPercent: 8,
              optimizedDeltaUsedPercent: 4,
              confidence: 'authoritative',
            },
            {
              key: 'weekly',
              scope: 'weekly',
              baselineDeltaUsedPercent: 3,
              optimizedDeltaUsedPercent: 6,
              confidence: 'authoritative',
            },
          ],
          quality: { baseline: 'passed', optimized: 'passed' },
        },
      ]),
    );

    assert.equal(value.allowance5h.savedPercent, 4);
    assert.equal(value.allowance5h.pairs, 1);
    assert.equal(value.allowance7d.savedPercent, -3);
    assert.equal(value.allowance7d.pairs, 1);
  });

  it('preserves authoritative negative savings rather than treating growth as zero', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          ...(quotaEntry({ baseline: 2, optimized: 5 }) as Record<string, unknown>),
          quotaComparisons: [
            {
              key: 'five-hour',
              scope: 'five-hour',
              baselineDeltaUsedPercent: 2,
              optimizedDeltaUsedPercent: 5,
              confidence: 'authoritative',
            },
          ],
          quality: { baseline: 'passed', optimized: 'passed' },
        },
      ]),
    );

    assert.equal(value.allowance5h.savedPercent, -3);
    assert.equal(value.allowance5h.state, 'measured');
  });

  it('falls back to the legacy selected quota when window comparisons are absent', () => {
    const value = guidedValueEvidence(matrix([quotaEntry({ baseline: 8, optimized: 5 })]));

    assert.equal(value.allowance5h.state, 'measured');
    assert.equal(value.allowance5h.savedPercent, 3);
    assert.equal(value.allowance5h.pairs, 1);
  });

  it('preserves quality-only passes when no efficiency usage is available', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          verdict: 'inconclusive',
          basis: 'none',
          evidenceLevel: 'none',
          quota: null,
          quotaComparisons: [],
          quality: { baseline: 'passed', optimized: 'passed' },
          baselineLocalTokens: null,
          optimizedLocalTokens: null,
        },
      ]),
    );

    assert.equal(value.quality.state, 'preserved');
    assert.equal(value.quality.pairs, 1);
    assert.equal(value.allowance5h.state, 'not-measured');
  });

  it('marks known optimized quality failure as a regression and leaves unknown quality unmeasured', () => {
    const regressed = guidedValueEvidence(
      matrix([
        {
          verdict: 'inconclusive',
          basis: 'none',
          evidenceLevel: 'none',
          quota: null,
          quality: { baseline: 'passed', optimized: 'failed' },
        },
      ]),
    );
    const unknown = guidedValueEvidence(
      matrix([
        {
          verdict: 'inconclusive',
          basis: 'none',
          evidenceLevel: 'none',
          quota: null,
          quality: { baseline: 'passed', optimized: 'unknown' },
        },
      ]),
    );

    assert.equal(regressed.quality.state, 'regressed');
    assert.equal(regressed.quality.regressions, 1);
    assert.equal(unknown.quality.state, 'not-measured');
    assert.equal(unknown.quality.pairs, 0);
  });

  it('reports routing token and quota evidence separately for quality-passed pairs', () => {
    const route = {
      ...(quotaEntry({ baseline: 8, optimized: 4 }) as Record<string, unknown>),
      nativeRouting: {
        verdict: 'attributed',
        baselineSubagents: 0,
        optimizedSubagents: 1,
        optimizedReportedModels: [],
        qualityGatesPassed: true,
      },
      baselineLocalTokens: 1000,
      optimizedLocalTokens: 800,
      localTokenSavingPercent: 20,
    };
    const value = guidedValueEvidence(matrix([route]));
    assert.equal(value.routing.state, 'measured');
    assert.equal(value.routing.savedLocalTokens, 200);
    assert.equal(value.routing.localTokenSavingPercent, 20);
    assert.equal(value.routing.allowance5h.savedPercent, 4);
    assert.equal(value.routing.allowance7d.savedPercent, null);
  });

  it('blocks route savings when the routed pair fails its quality gate', () => {
    const route = {
      ...(quotaEntry({ baseline: 8, optimized: 4 }) as Record<string, unknown>),
      nativeRouting: {
        verdict: 'attributed',
        baselineSubagents: 0,
        optimizedSubagents: 1,
        optimizedReportedModels: [],
        qualityGatesPassed: false,
      },
      baselineLocalTokens: 1000,
      optimizedLocalTokens: 800,
      localTokenSavingPercent: null,
    };
    const value = guidedValueEvidence(matrix([route]));
    assert.equal(value.routing.state, 'blocked-by-quality');
    assert.equal(value.routing.savedLocalTokens, null);
    assert.equal(value.routing.allowance5h.state, 'not-measured');
  });

  it('keeps quality-passed routing pairs counted when no usage amount was measured', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          verdict: 'inconclusive',
          basis: 'none',
          evidenceLevel: 'none',
          quota: null,
          nativeRouting: {
            verdict: 'attributed',
            baselineSubagents: 0,
            optimizedSubagents: 1,
            optimizedReportedModels: [],
            qualityGatesPassed: true,
          },
          baselineLocalTokens: null,
          optimizedLocalTokens: null,
          localTokenSavingPercent: null,
        },
      ]),
    );

    assert.equal(value.routing.state, 'not-measured');
    assert.equal(value.routing.pairs, 1);
    assert.equal(value.routing.localPairs, 0);
    assert.equal(value.routing.savedLocalTokens, null);
    assert.match(value.routing.basis, /no savings amount is inferred/i);
  });

  it('passes candidate-attributed benchmark summaries through without changing global value math', () => {
    const report = matrix([
      quotaEntry({ baseline: 8, optimized: 4 }),
    ]) as TaskBenchmarkContextMatrixReport & {
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

  it('does not borrow a passing quality gate from another pair to credit unknown quality', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          ...(quotaEntry({ baseline: 8, optimized: 3 }) as Record<string, unknown>),
          quality: { baseline: 'passed', optimized: 'unknown' },
        },
        {
          verdict: 'inconclusive',
          basis: 'none',
          evidenceLevel: 'none',
          quota: null,
          quality: { baseline: 'passed', optimized: 'passed' },
        },
      ]),
    );
    assert.equal(value.quality.state, 'preserved');
    assert.equal(value.allowance5h.state, 'blocked-by-quality');
  });

  it('keeps per-app quota comparisons and read failures explicit', () => {
    const value = guidedValueEvidence(
      matrix([
        {
          ...(quotaEntry({ baseline: 8, optimized: 3 }) as Record<string, unknown>),
          harnessId: 'codex',
        },
        {
          ...(quotaEntry({ baseline: 2, optimized: 4 }) as Record<string, unknown>),
          harnessId: 'claude',
        },
      ]),
    );
    assert.equal(value.byHarness[0]?.allowance5h.savedPercent, 5);
    assert.equal(value.byHarness[1]?.allowance5h.savedPercent, -2);
    assert.equal(value.comparisons.available, true);
    assert.equal(guidedValueEvidence(null).comparisons.available, false);
  });
});
