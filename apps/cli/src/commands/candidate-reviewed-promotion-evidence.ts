import type { OptimizationCandidateId } from '@token-harness/core';

import type {
  CandidatePromotionReview,
  CandidateReviewedGateResult,
} from './candidate-promotion-readiness.js';

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

/** Return only evidence that has had an explicit project-level review. */
export function reviewedPromotionEvidenceForCandidate(
  candidateId: OptimizationCandidateId,
): CandidatePromotionReview {
  if (candidateId === 'mcptoon') {
    return { projectMaturity: MCPTOON_PROJECT_MATURITY_REVIEW.result };
  }
  return {};
}
