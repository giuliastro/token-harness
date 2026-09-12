import type { StackCombinationReviewRecord } from '@token-harness/core';

/**
 * Shipped exact combined-stack reviews.
 *
 * Intentionally empty until a real provider/version/harness fingerprint has been
 * captured, tested together, and deliberately reviewed. Individual compatibility
 * rows or healthy verification results must never populate this automatically.
 */
export const SHIPPED_STACK_COMBINATION_REVIEWS =
  [] as const satisfies readonly StackCombinationReviewRecord[];
