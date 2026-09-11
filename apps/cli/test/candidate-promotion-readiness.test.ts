import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  OPTIMIZATION_CANDIDATE_CATEGORY_BY_ID,
  type OptimizationCandidateId,
  type OptimizationCandidateObservation,
} from '@token-harness/core';

import type { CandidateEvidenceAssessment } from '../src/commands/candidate-evidence-assessment.js';
import {
  assessCandidatePromotionReadiness,
  type CandidatePromotionReview,
} from '../src/commands/candidate-promotion-readiness.js';

function evidence(
  candidateId: OptimizationCandidateId,
  signal: CandidateEvidenceAssessment['signal'] = 'promising',
  decisionReady = true,
): CandidateEvidenceAssessment {
  return {
    signal,
    decisionReady,
    completedPairs: 8,
    evidencePairs: 8,
    coveredTaskClasses: ['mechanical', 'standard', 'hard', 'critical'],
    minimumEvidencePairs: 6,
    minimumTaskClasses: 3,
    minimumEvidenceCoveragePercent: 75,
    hardRegressionPairs: 0,
    reasons: ['fixture'],
    promotionEligible: false,
    promotionBlockers: [`${candidateId} fixture blocker`],
  };
}

function observation(
  candidateId: OptimizationCandidateId,
  input: Partial<OptimizationCandidateObservation> = {},
): OptimizationCandidateObservation {
  const displayName =
    candidateId === 'gitnexus' ? 'GitNexus' : candidateId === 'headroom' ? 'Headroom' : 'mcptoon';
  return {
    id: candidateId,
    displayName,
    category: OPTIMIZATION_CANDIDATE_CATEGORY_BY_ID[candidateId],
    state: 'benchmark-ready',
    version: '1.2.3',
    minimumBenchmarkVersion: 'reviewed',
    ...input,
  };
}

const PASS: CandidatePromotionReview = {
  activationVerification: { state: 'passed', reason: 'activation verified' },
  managedLifecycle: { state: 'passed', reason: 'managed lifecycle reviewed' },
  compatibilityReversibility: { state: 'passed', reason: 'compatibility reviewed' },
  projectMaturity: { state: 'passed', reason: 'maturity reviewed' },
  combinedStackValidation: { state: 'passed', reason: 'combined stack validated' },
};

const PASS_WITHOUT_MATURITY: CandidatePromotionReview = {
  activationVerification: { state: 'passed', reason: 'activation verified' },
  managedLifecycle: { state: 'passed', reason: 'managed lifecycle reviewed' },
  compatibilityReversibility: { state: 'passed', reason: 'compatibility reviewed' },
  combinedStackValidation: { state: 'passed', reason: 'combined stack validated' },
};

describe('candidate promotion readiness', () => {
  it('separates promising benchmark evidence from missing managed integration gates', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'gitnexus',
      assessment: evidence('gitnexus'),
      observation: observation('gitnexus'),
    });

    assert.equal(result.state, 'blocked');
    assert.equal(result.promotionEligible, false);
    assert.equal(result.passedGateCount, 3);
    assert.equal(result.requiredGateCount, 8);
    assert.equal(result.nextGate, 'activation-verification');
    assert.deepEqual(result.blockedGateIds, ['activation-verification', 'managed-lifecycle']);
    assert.ok(result.unreviewedGateIds.includes('project-maturity'));
  });

  it('keeps benchmark evidence unreviewed on capability-only surfaces', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'gitnexus',
      assessment: null,
      observation: observation('gitnexus'),
    });

    assert.equal(result.passedGateCount, 2);
    assert.equal(result.nextGate, 'selection-evidence');
    assert.ok(result.unreviewedGateIds.includes('selection-evidence'));
    assert.equal(result.promotionEligible, false);
  });

  it('does not infer project maturity from a local semantic version', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'mcptoon',
      assessment: evidence('mcptoon'),
      observation: observation('mcptoon', { version: '99.0.0' }),
      review: PASS_WITHOUT_MATURITY,
    });

    const maturity = result.gates.find((gate) => gate.id === 'project-maturity');
    assert.equal(maturity?.state, 'unreviewed');
    assert.equal(result.promotionEligible, false);
  });

  it('blocks a candidate whose observed taxonomy does not match the product category', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'gitnexus',
      assessment: evidence('gitnexus'),
      observation: observation('gitnexus', { category: 'context-minimization' }),
      review: PASS,
    });

    assert.equal(result.state, 'blocked');
    assert.ok(result.blockedGateIds.includes('category-fit'));
    assert.equal(
      result.gates
        .find((gate) => gate.id === 'category-fit')
        ?.reason.includes('repository-exploration'),
      true,
    );
  });

  it('blocks local benchmark capability when the candidate is absent', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'gitnexus',
      assessment: evidence('gitnexus'),
      observation: observation('gitnexus', { state: 'absent', version: null }),
      review: PASS,
    });

    assert.ok(result.blockedGateIds.includes('benchmark-capability'));
    assert.equal(result.promotionEligible, false);
  });

  it('can become eligible only when every required reviewed gate passes', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'gitnexus',
      assessment: evidence('gitnexus'),
      observation: observation('gitnexus'),
      review: PASS,
    });

    assert.equal(result.state, 'eligible');
    assert.equal(result.promotionEligible, true);
    assert.equal(result.passedGateCount, result.requiredGateCount);
    assert.equal(result.nextGate, null);
    assert.deepEqual(result.blockedGateIds, []);
    assert.deepEqual(result.unreviewedGateIds, []);
  });

  it('requires the additional broad-context-owner admission gate for Headroom', () => {
    const result = assessCandidatePromotionReadiness({
      candidateId: 'headroom',
      assessment: evidence('headroom'),
      observation: observation('headroom'),
      review: PASS,
    });

    assert.equal(result.state, 'unreviewed');
    assert.equal(result.promotionEligible, false);
    assert.equal(result.nextGate, 'context-owner-admission');
    assert.ok(result.unreviewedGateIds.includes('context-owner-admission'));
  });
});