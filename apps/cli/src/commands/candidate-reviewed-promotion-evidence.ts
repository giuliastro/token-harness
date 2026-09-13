import type { OptimizationCandidateId } from '@token-harness/core';

import type {
  CandidatePromotionReview,
  CandidateReviewedGateResult,
} from './candidate-promotion-readiness.js';

export interface CandidateManagedLifecycleReviewRecord {
  candidateId: OptimizationCandidateId;
  reviewedAt: string;
  reviewedVersion: string;
  packageManager: string;
  activationSurfaces: readonly string[];
  residualScope: string;
  result: CandidateReviewedGateResult;
}

export interface CandidateProjectMaturityReviewRecord {
  candidateId: OptimizationCandidateId;
  reviewedAt: string;
  repository: string;
  repositoryCreatedAt: string;
  earliestReviewedStableReleaseAt: string;
  latestReviewedStableReleaseAt: string;
  latestReviewedRelease: string;
  license: string;
  residualRisk: string;
  result: CandidateReviewedGateResult;
}

/**
 * Explicit lifecycle review of the already-landed mcptoon integration. It proves ownership and
 * rollback mechanics only; it deliberately does not claim compatibility for unrecorded surfaces.
 */
export const MCPTOON_MANAGED_LIFECYCLE_REVIEW: CandidateManagedLifecycleReviewRecord = {
  candidateId: 'mcptoon',
  reviewedAt: '2026-09-13',
  reviewedVersion: '0.7.10',
  packageManager: 'pipx',
  activationSurfaces: ['Claude Code owned skill', 'Codex surgical AGENTS.md marker block'],
  residualScope:
    'Lifecycle review does not widen the exact RFC 0009 compatibility evidence or prove combined-stack behavior.',
  result: {
    state: 'passed',
    reason:
      'Reviewed 2026-09-13 for mcptoon 0.7.10: exact pipx install/inventory, brownfield-safe Claude/Codex instruction ownership, passive verification, rollback/uninstall, prior-state restoration and conflict refusal are implemented and covered by repository lifecycle tests. Compatibility breadth remains a separate gate.',
  },
};

/**
 * Explicit project-level review. This is deliberately independent from the installed candidate
 * version: local semver never proves upstream maintenance or licensing maturity.
 */
export const MCPTOON_PROJECT_MATURITY_REVIEW: CandidateProjectMaturityReviewRecord = {
  candidateId: 'mcptoon',
  reviewedAt: '2026-09-13',
  repository: 'activeing123/mcptoon',
  repositoryCreatedAt: '2026-07-27T08:24:21Z',
  earliestReviewedStableReleaseAt: '2026-08-12T08:20:03Z',
  latestReviewedStableReleaseAt: '2026-09-12T12:29:33Z',
  latestReviewedRelease: '0.7.10',
  license: 'Apache-2.0',
  residualRisk:
    'The upstream project is still young, so project maturity should be re-reviewed if maintenance activity materially changes.',
  result: {
    state: 'passed',
    reason:
      'Reviewed 2026-09-13: Apache-2.0 upstream is active and non-archived, stable releases span 2026-08-12 through 2026-09-12, and recent releases document regression fixes plus automated release/test discipline. The project remains young, which is retained as residual risk rather than hidden.',
  },
};

/** Return only gates backed by explicit reviewed evidence. */
export function reviewedPromotionEvidenceForCandidate(
  candidateId: OptimizationCandidateId,
): CandidatePromotionReview {
  if (candidateId === 'mcptoon') {
    return {
      managedLifecycle: MCPTOON_MANAGED_LIFECYCLE_REVIEW.result,
      projectMaturity: MCPTOON_PROJECT_MATURITY_REVIEW.result,
    };
  }
  return {};
}
