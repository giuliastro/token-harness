import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';

import type { CandidateAwareBenchmarkMatrixReport } from '../src/commands/candidate-benchmark.js';
import { createGuideCandidateCampaignReader } from '../src/guided-candidate-campaign-status.js';
import type { GuideCall } from '../src/guided.js';

function report(activationState: 'verified' | 'blocked'): CandidateAwareBenchmarkMatrixReport {
  return {
    entries: [],
    candidateEvidence: [],
    campaign: {
      campaignId: 'mcptoon-codex-eval-m123abc',
      candidateId: 'mcptoon',
      harnessId: 'codex',
      runsPerTask: 2,
      totalPairs: 8,
      completedPairs: 8,
      invalidPairs: 0,
      slots: [],
      nextCommand: null,
      nextInstruction: 'Campaign complete.',
      evidence: {
        candidateId: 'mcptoon',
        pairs: 8,
        optimizedBetter: 8,
        baselineBetter: 0,
        equivalent: 0,
        inconclusive: 0,
        incomparable: 0,
        quotaBacked: 0,
        localEvidence: 8,
        qualityOnly: 0,
        evidencePairs: 8,
        evidenceCoveragePercent: 100,
        localComparablePairs: 8,
        baselineLocalTokens: 800,
        optimizedLocalTokens: 400,
        localTokenSavingPercent: 50,
        wallClockComparablePairs: 8,
        baselineWallClockMs: 8000,
        optimizedWallClockMs: 7200,
        wallClockSavingPercent: 10,
      },
      activation: {
        candidateId: 'mcptoon',
        state: activationState,
        verifiedPairs: activationState === 'verified' ? 8 : 7,
        blockedPairs: activationState === 'blocked' ? 1 : 0,
        unknownPairs: 0,
        reason:
          activationState === 'verified'
            ? '8 optimized pair(s) recorded successful mcptoon 0.7.10 tool activity inside the task window'
            : '1 optimized pair did not record successful mcptoon activity inside the task window',
      },
      assessment: {
        signal: 'promising',
        decisionReady: true,
        completedPairs: 8,
        evidencePairs: 8,
        coveredTaskClasses: ['mechanical', 'standard', 'hard', 'critical'],
        minimumEvidencePairs: 6,
        minimumTaskClasses: 3,
        minimumEvidenceCoveragePercent: 75,
        hardRegressionPairs: 0,
        reasons: ['decision-ready paired evidence is promising'],
        promotionEligible: false,
        promotionBlockers: ['managed lifecycle gates remain independent'],
      },
    },
  } as unknown as CandidateAwareBenchmarkMatrixReport;
}

function callWith(reportValue: CandidateAwareBenchmarkMatrixReport): GuideCall {
  return async <T>(): Promise<CliEnvelope<T>> =>
    toEnvelope(
      commandResult({
        command: 'benchmark-matrix',
        exitCode: 0,
        data: reportValue as unknown as T,
      }),
      'test',
    );
}

const observation = {
  id: 'mcptoon' as const,
  displayName: 'mcptoon',
  category: 'mcp-discovery' as const,
  state: 'benchmark-ready' as const,
  version: '0.7.10',
  minimumBenchmarkVersion: '0.7.10',
};

describe('guided mcptoon activation readiness', () => {
  it('passes activation and explicit project-maturity gates from reviewed evidence', async () => {
    const status = await createGuideCandidateCampaignReader(
      callWith(report('verified')),
      () => observation,
    )({
      candidateId: 'mcptoon',
      harnessId: 'codex',
      campaignId: 'mcptoon-codex-eval-m123abc',
    });

    const activationGate = status.promotionReadiness?.gates.find(
      (item) => item.id === 'activation-verification',
    );
    const maturityGate = status.promotionReadiness?.gates.find(
      (item) => item.id === 'project-maturity',
    );
    assert.equal(status.activationState, 'verified');
    assert.equal(activationGate?.state, 'passed');
    assert.match(activationGate?.reason ?? '', /mcptoon 0\.7\.10/);
    assert.equal(maturityGate?.state, 'passed');
    assert.match(maturityGate?.reason ?? '', /Reviewed 2026-09-13/);
    assert.match(status.note, /explicit dated upstream review/);
  });

  it('keeps activation blocked without discarding the independent maturity review', async () => {
    const status = await createGuideCandidateCampaignReader(
      callWith(report('blocked')),
      () => observation,
    )({
      candidateId: 'mcptoon',
      harnessId: 'codex',
      campaignId: 'mcptoon-codex-eval-m123abc',
    });

    const activationGate = status.promotionReadiness?.gates.find(
      (item) => item.id === 'activation-verification',
    );
    const maturityGate = status.promotionReadiness?.gates.find(
      (item) => item.id === 'project-maturity',
    );
    assert.equal(status.activationState, 'blocked');
    assert.equal(activationGate?.state, 'blocked');
    assert.equal(maturityGate?.state, 'passed');
  });
});
