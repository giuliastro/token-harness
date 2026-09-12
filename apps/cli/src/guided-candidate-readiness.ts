import type { OptimizationCandidateObservation } from '@token-harness/core';

import {
  assessCandidatePromotionReadiness,
  type CandidatePromotionReadiness,
} from './commands/candidate-promotion-readiness.js';

export type GuidedCandidateObservation = OptimizationCandidateObservation & {
  promotionReadiness: CandidatePromotionReadiness;
};

/**
 * Project the same conservative promotion gates used by the CLI into the guided UI payload.
 * Candidate benchmark attribution is not a formal selection assessment, so this surface keeps
 * selection evidence unreviewed until a reviewed assessment is explicitly available.
 */
export function guidedCandidateObservation(
  observation: OptimizationCandidateObservation,
): GuidedCandidateObservation {
  return {
    ...observation,
    promotionReadiness: assessCandidatePromotionReadiness({
      candidateId: observation.id,
      assessment: null,
      observation,
    }),
  };
}
