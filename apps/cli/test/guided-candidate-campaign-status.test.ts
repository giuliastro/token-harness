import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';

import type { CandidateAwareBenchmarkMatrixReport } from '../src/commands/candidate-benchmark.js';
import {
  createGuideCandidateCampaignReader,
  parseGuideCandidateCampaignRequest,
} from '../src/guided-candidate-campaign-status.js';
import type { GuideCall } from '../src/guided.js';

function campaignReport(): CandidateAwareBenchmarkMatrixReport {
  return {
    entries: [],
    candidateEvidence: [],
    campaign: {
      campaignId: 'gitnexus-codex-eval-m123abc',
      candidateId: 'gitnexus',
      harnessId: 'codex',
      runsPerTask: 2,
      totalPairs: 6,
      completedPairs: 3,
      invalidPairs: 0,
      slots: [],
      nextCommand:
        'token-harness benchmark-start --benchmark gitnexus-eval-h-1 --task hard --agent codex --variant baseline --candidate gitnexus --campaign-id gitnexus-codex-eval-m123abc',
      nextInstruction: 'Run the next baseline task, then capture its result.',
      evidence: {
        candidateId: 'gitnexus',
        pairs: 3,
        optimizedBetter: 2,
        baselineBetter: 0,
        equivalent: 1,
        inconclusive: 0,
        incomparable: 0,
        quotaBacked: 0,
        localEvidence: 3,
        qualityOnly: 0,
        localComparablePairs: 3,
        baselineLocalTokens: 300,
        optimizedLocalTokens: 200,
        localTokenSavingPercent: 33.3,
        wallClockComparablePairs: 0,
        baselineWallClockMs: null,
        optimizedWallClockMs: null,
        wallClockSavingPercent: null,
      },
      assessment: {
        signal: 'insufficient-evidence',
        decisionReady: false,
        completedPairs: 3,
        evidencePairs: 3,
        coveredTaskClasses: ['mechanical', 'standard'],
        minimumEvidencePairs: 6,
        minimumTaskClasses: 3,
        minimumEvidenceCoveragePercent: 75,
        hardRegressionPairs: 0,
        reasons: ['need at least 6 evidence-bearing completed pairs'],
        promotionEligible: false,
        promotionBlockers: ['the standard benchmark campaign is not complete'],
      },
    },
  } as unknown as CandidateAwareBenchmarkMatrixReport;
}

describe('guided candidate campaign status', () => {
  it('accepts only dashboard-generated candidate+harness campaign ids', () => {
    assert.deepEqual(
      parseGuideCandidateCampaignRequest(
        new URLSearchParams({
          candidate: 'gitnexus',
          harness: 'codex',
          campaign: 'gitnexus-codex-eval-m123abc',
        }),
      ),
      {
        candidateId: 'gitnexus',
        harnessId: 'codex',
        campaignId: 'gitnexus-codex-eval-m123abc',
      },
    );
    assert.equal(
      parseGuideCandidateCampaignRequest(
        new URLSearchParams({
          candidate: 'gitnexus',
          harness: 'codex',
          campaign: 'another-benchmark-id',
        }),
      ),
      null,
    );
    assert.equal(
      parseGuideCandidateCampaignRequest(
        new URLSearchParams({
          candidate: 'unknown',
          harness: 'codex',
          campaign: 'unknown-codex-eval-m123abc',
        }),
      ),
      null,
    );
  });

  it('uses only the fixed benchmark-matrix reader and projects bounded UI status', async () => {
    const calls: string[][] = [];
    const report = campaignReport();
    const call: GuideCall = async <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
      calls.push([...args]);
      return toEnvelope(
        commandResult({ command: 'benchmark-matrix', exitCode: 0, data: report as unknown as T }),
        'test',
      );
    };

    const status = await createGuideCandidateCampaignReader(call)({
      candidateId: 'gitnexus',
      harnessId: 'codex',
      campaignId: 'gitnexus-codex-eval-m123abc',
    });

    assert.deepEqual(calls, [
      [
        'benchmark-matrix',
        '--benchmark-id',
        'gitnexus-codex-eval-m123abc',
        '--candidate',
        'gitnexus',
        '--harness',
        'codex',
      ],
    ]);
    assert.equal(status.available, true);
    assert.equal(status.completedPairs, 3);
    assert.equal(status.totalPairs, 6);
    assert.equal(status.progressPercent, 50);
    assert.equal(status.signal, 'insufficient-evidence');
    assert.equal(status.decisionReady, false);
    assert.equal(status.evidencePairs, 3);
    assert.deepEqual(status.coveredTaskClasses, ['mechanical', 'standard']);
    assert.match(status.nextCommand ?? '', /--variant baseline/);
    assert.equal(status.promotionEligible, false);
    assert.match(status.note, /does not prove activation/);
    assert.match(status.note, /decision-ready does not mean promotion-ready/);
  });
});
