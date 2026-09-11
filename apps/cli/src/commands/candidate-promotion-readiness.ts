import {
  OPTIMIZATION_CANDIDATE_CATEGORY_BY_ID,
  type OptimizationCandidateId,
  type OptimizationCandidateObservation,
} from '@token-harness/core';

import type { CandidateEvidenceAssessment } from './candidate-evidence-assessment.js';

export type CandidatePromotionGateId =
  | 'benchmark-capability'
  | 'category-fit'
  | 'selection-evidence'
  | 'activation-verification'
  | 'managed-lifecycle'
  | 'compatibility-reversibility'
  | 'project-maturity'
  | 'combined-stack-validation'
  | 'context-owner-admission';

export type CandidatePromotionGateState =
  | 'passed'
  | 'blocked'
  | 'unreviewed'
  | 'not-applicable';
export type CandidatePromotionReadinessState = 'eligible' | 'blocked' | 'unreviewed';

export interface CandidatePromotionGate {
  id: CandidatePromotionGateId;
  state: CandidatePromotionGateState;
  reason: string;
}

export interface CandidateReviewedGateResult {
  state: 'passed' | 'blocked';
  reason: string;
}

/**
 * Reviewed evidence supplied by future managed candidate integrations.
 * Omitted fields are deliberately `unreviewed`, never assumed safe.
 */
export interface CandidatePromotionReview {
  activationVerification?: CandidateReviewedGateResult;
  managedLifecycle?: CandidateReviewedGateResult;
  compatibilityReversibility?: CandidateReviewedGateResult;
  projectMaturity?: CandidateReviewedGateResult;
  combinedStackValidation?: CandidateReviewedGateResult;
  contextOwnerAdmission?: CandidateReviewedGateResult;
}

export interface CandidatePromotionReadinessInput {
  candidateId: OptimizationCandidateId;
  /** Null when this surface has capability evidence but no paired benchmark summary. */
  assessment: CandidateEvidenceAssessment | null;
  /** Null when this surface has benchmark evidence but no fresh local capability observation. */
  observation: OptimizationCandidateObservation | null;
  review?: CandidatePromotionReview;
}

export interface CandidatePromotionReadiness {
  candidateId: OptimizationCandidateId;
  state: CandidatePromotionReadinessState;
  promotionEligible: boolean;
  passedGateCount: number;
  requiredGateCount: number;
  blockedGateIds: CandidatePromotionGateId[];
  unreviewedGateIds: CandidatePromotionGateId[];
  nextGate: CandidatePromotionGateId | null;
  gates: CandidatePromotionGate[];
}

function observedBenchmarkCapability(
  candidateId: OptimizationCandidateId,
  observation: OptimizationCandidateObservation | null,
): CandidatePromotionGate {
  if (observation === null) {
    return {
      id: 'benchmark-capability',
      state: 'unreviewed',
      reason: 'candidate capability observation is unavailable in this command environment',
    };
  }
  if (observation.id !== candidateId) {
    return {
      id: 'benchmark-capability',
      state: 'blocked',
      reason: 'candidate capability observation belongs to a different candidate',
    };
  }
  if (observation.state === 'benchmark-ready') {
    return {
      id: 'benchmark-capability',
      state: 'passed',
      reason: `installed ${observation.displayName} exposes the reviewed benchmark surfaces`,
    };
  }
  const version = observation.version === null ? '' : ` ${observation.version}`;
  return {
    id: 'benchmark-capability',
    state: 'blocked',
    reason:
      observation.state === 'absent'
        ? `${observation.displayName} is not installed, so local benchmark capability is not available`
        : observation.state === 'unsupported-version'
          ? `${observation.displayName}${version} is below the reviewed benchmark baseline`
          : `${observation.displayName}${version} is installed but does not expose every reviewed benchmark surface`,
  };
}

function observedCategoryFit(
  candidateId: OptimizationCandidateId,
  observation: OptimizationCandidateObservation | null,
): CandidatePromotionGate {
  const expected = OPTIMIZATION_CANDIDATE_CATEGORY_BY_ID[candidateId];
  if (observation === null) {
    return {
      id: 'category-fit',
      state: 'unreviewed',
      reason: `candidate category could not be observed; expected ${expected}`,
    };
  }
  if (observation.id !== candidateId || observation.category !== expected) {
    return {
      id: 'category-fit',
      state: 'blocked',
      reason: `candidate taxonomy mismatch; expected ${expected}, observed ${observation.category}`,
    };
  }
  return {
    id: 'category-fit',
    state: 'passed',
    reason: `candidate is classified as ${expected}`,
  };
}

function selectionEvidence(
  assessment: CandidateEvidenceAssessment | null,
): CandidatePromotionGate {
  if (assessment === null) {
    return {
      id: 'selection-evidence',
      state: 'unreviewed',
      reason: 'paired candidate benchmark evidence is not available on this surface',
    };
  }
  const passed = assessment.decisionReady && assessment.signal === 'promising';
  return {
    id: 'selection-evidence',
    state: passed ? 'passed' : 'blocked',
    reason: passed
      ? `decision-ready paired evidence is ${assessment.signal}`
      : `selection evidence is ${assessment.signal}${assessment.decisionReady ? '' : ' and is not decision-ready'}`,
  };
}

function reviewedGate(
  id: CandidatePromotionGateId,
  result: CandidateReviewedGateResult | undefined,
  defaultState: Extract<CandidatePromotionGateState, 'blocked' | 'unreviewed'>,
  defaultReason: string,
): CandidatePromotionGate {
  return result === undefined
    ? { id, state: defaultState, reason: defaultReason }
    : { id, state: result.state, reason: result.reason };
}

/**
 * Convert available candidate evidence plus explicitly reviewed integration facts into promotion
 * readiness. No gate is inferred from another: benchmark readiness is not activation verification,
 * a local semantic version is not project maturity, and candidate attribution is not combined-stack
 * proof. Partial surfaces may omit either benchmark or capability evidence and will report that gate
 * as unreviewed rather than guessing.
 */
export function assessCandidatePromotionReadiness(
  input: CandidatePromotionReadinessInput,
): CandidatePromotionReadiness {
  const review = input.review ?? {};
  const gates: CandidatePromotionGate[] = [
    observedBenchmarkCapability(input.candidateId, input.observation),
    observedCategoryFit(input.candidateId, input.observation),
    selectionEvidence(input.assessment),
    reviewedGate(
      'activation-verification',
      review.activationVerification,
      'blocked',
      'Token Harness has no reviewed proof that this candidate is active during an optimized task',
    ),
    reviewedGate(
      'managed-lifecycle',
      review.managedLifecycle,
      'blocked',
      'candidate support is observation-only; no reviewed plan/apply/verify/rollback lifecycle is registered',
    ),
    reviewedGate(
      'compatibility-reversibility',
      review.compatibilityReversibility,
      'unreviewed',
      'compatibility, ownership overlap, failure isolation and reversibility have not been reviewed',
    ),
    reviewedGate(
      'project-maturity',
      review.projectMaturity,
      'unreviewed',
      'an installed version does not establish upstream release activity, license or maintenance maturity',
    ),
    reviewedGate(
      'combined-stack-validation',
      review.combinedStackValidation,
      'unreviewed',
      'the recommended stack has not been validated with independently verified candidate activation',
    ),
    input.candidateId === 'headroom'
      ? reviewedGate(
          'context-owner-admission',
          review.contextOwnerAdmission,
          'unreviewed',
          'broad context ownership still requires the dedicated context-owner admission gate',
        )
      : {
          id: 'context-owner-admission',
          state: 'not-applicable',
          reason: 'candidate is not the broad context owner',
        },
  ];

  const required = gates.filter((gate) => gate.state !== 'not-applicable');
  const blockedGateIds = required
    .filter((gate) => gate.state === 'blocked')
    .map((gate) => gate.id);
  const unreviewedGateIds = required
    .filter((gate) => gate.state === 'unreviewed')
    .map((gate) => gate.id);
  const passedGateCount = required.filter((gate) => gate.state === 'passed').length;
  const promotionEligible = passedGateCount === required.length;
  const state: CandidatePromotionReadinessState = promotionEligible
    ? 'eligible'
    : blockedGateIds.length > 0
      ? 'blocked'
      : 'unreviewed';
  const nextGate = required.find((gate) => gate.state !== 'passed')?.id ?? null;

  return {
    candidateId: input.candidateId,
    state,
    promotionEligible,
    passedGateCount,
    requiredGateCount: required.length,
    blockedGateIds,
    unreviewedGateIds,
    nextGate,
    gates,
  };
}
