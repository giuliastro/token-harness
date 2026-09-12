import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';

import type { CandidateAwareBenchmarkMatrixReport } from '../src/commands/candidate-benchmark.js';
import { parseGuideCandidateCampaignActionRequest } from '../src/guided-candidate-campaign-action.js';
import { createGuideCandidateCampaignReader } from '../src/guided-candidate-campaign-status.js';
import type { GuideCall } from '../src/guided.js';

const CAMPAIGN = 'gitnexus-codex-eval-m123abc';
const BENCHMARK = `${CAMPAIGN}-m-1`;

function report(state: 'baseline-not-started' | 'baseline-running' | 'optimized-not-started') {
  return {
    entries: [],
    candidateEvidence: [],
    campaign: {
      campaignId: CAMPAIGN,
      candidateId: 'gitnexus',
      harnessId: 'codex',
      runsPerTask: 2,
      totalPairs: 8,
      completedPairs: 0,
      invalidPairs: 0,
      slots: [{ benchmarkId: BENCHMARK, taskClass: 'mechanical', run: 1, state }],
      nextCommand: 'bounded by campaign state',
      nextInstruction: 'Follow the current step.',
      evidence: {
        candidateId: 'gitnexus',
        pairs: 0,
        optimizedBetter: 0,
        baselineBetter: 0,
        equivalent: 0,
        inconclusive: 0,
        incomparable: 0,
        quotaBacked: 0,
        localEvidence: 0,
        qualityOnly: 0,
        evidencePairs: 0,
        evidenceCoveragePercent: null,
        localComparablePairs: 0,
        baselineLocalTokens: null,
        optimizedLocalTokens: null,
        localTokenSavingPercent: null,
        wallClockComparablePairs: 0,
        baselineWallClockMs: null,
        optimizedWallClockMs: null,
        wallClockSavingPercent: null,
      },
      assessment: {
        signal: 'insufficient-evidence',
        decisionReady: false,
        completedPairs: 0,
        evidencePairs: 0,
        coveredTaskClasses: [],
        minimumEvidencePairs: 6,
        minimumTaskClasses: 3,
        minimumEvidenceCoveragePercent: 75,
        hardRegressionPairs: 0,
        reasons: ['need evidence'],
        promotionEligible: false,
        promotionBlockers: ['campaign incomplete'],
      },
    },
  } as unknown as CandidateAwareBenchmarkMatrixReport;
}

function fixture(state: 'baseline-not-started' | 'baseline-running' | 'optimized-not-started') {
  const calls: string[][] = [];
  const matrix = report(state);
  const call: GuideCall = async <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
    calls.push([...args]);
    const data = args[0] === 'benchmark-matrix' ? (matrix as unknown as T) : (null as T);
    return toEnvelope(commandResult({ command: args[0] ?? 'test', exitCode: 0, data }), 'test');
  };
  return { calls, controller: createGuideCandidateCampaignReader(call) };
}

function action(kind: 'start-baseline' | 'finish-baseline' | 'start-optimized') {
  return {
    candidateId: 'gitnexus' as const,
    harnessId: 'codex' as const,
    campaignId: CAMPAIGN,
    expectedKind: kind,
    expectedBenchmarkId: BENCHMARK,
    activationAcknowledged: false,
    outcome:
      kind === 'finish-baseline'
        ? { quality: 'passed' as const, attempts: 2, failedAttempts: 1 }
        : null,
  };
}

describe('guided candidate campaign actions', () => {
  it('parses only the bounded action shape and rejects arbitrary command fields', () => {
    assert.ok(
      parseGuideCandidateCampaignActionRequest({
        ...action('start-baseline'),
      }),
    );
    assert.equal(
      parseGuideCandidateCampaignActionRequest({
        ...action('start-baseline'),
        argv: ['doctor', '--verbose'],
      }),
      null,
    );
    assert.equal(
      parseGuideCandidateCampaignActionRequest({
        ...action('finish-baseline'),
        outcome: { quality: 'passed', attempts: 1, failedAttempts: 2 },
      }),
      null,
    );
  });

  it('starts only the exact baseline slot reported by the campaign engine', async () => {
    const world = fixture('baseline-not-started');
    const result = await world.controller.action(action('start-baseline'));

    assert.equal(result.ok, true);
    assert.deepEqual(world.calls[1], [
      'benchmark-start',
      '--benchmark-id',
      BENCHMARK,
      '--candidate',
      'gitnexus',
      '--variant',
      'baseline',
      '--task',
      'mechanical',
      '--harness',
      'codex',
    ]);
    assert.equal(world.calls[0]?.[0], 'benchmark-matrix');
    assert.equal(world.calls[2]?.[0], 'benchmark-matrix');
  });

  it('records the user-observed outcome instead of assuming a successful task', async () => {
    const world = fixture('baseline-running');
    const result = await world.controller.action(action('finish-baseline'));

    assert.equal(result.ok, true);
    assert.deepEqual(world.calls[1], [
      'benchmark-finish',
      '--benchmark-id',
      BENCHMARK,
      '--variant',
      'baseline',
      '--quality',
      'passed',
      '--attempts',
      '2',
      '--failed-attempts',
      '1',
    ]);
  });

  it('requires explicit external-activation acknowledgement before optimized capture', async () => {
    const world = fixture('optimized-not-started');
    const result = await world.controller.action(action('start-optimized'));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 400);
    assert.match(result.error, /not activation verification/);
    assert.equal(world.calls.length, 1);

    const accepted = await world.controller.action({
      ...action('start-optimized'),
      activationAcknowledged: true,
    });
    assert.equal(accepted.ok, true);
    assert.deepEqual(world.calls[2], [
      'benchmark-start',
      '--benchmark-id',
      BENCHMARK,
      '--candidate',
      'gitnexus',
      '--variant',
      'optimized',
      '--task',
      'mechanical',
      '--harness',
      'codex',
    ]);
  });

  it('rejects a stale browser step before any mutation runs', async () => {
    const world = fixture('baseline-running');
    const result = await world.controller.action(action('start-baseline'));

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.statusCode, 409);
    assert.match(result.error, /state changed/);
    assert.equal(world.calls.length, 1);
  });
});
