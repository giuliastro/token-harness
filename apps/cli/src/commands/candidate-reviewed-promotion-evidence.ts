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

/**
 * Review of the narrow GitNexus lifecycle already merged in #265. This is intentionally limited to
 * the exact 1.6.12 CLI and Claude Code user MCP JSON entry. Token Harness does not install GitNexus,
 * run setup/analyze, create an index, or infer Codex support from this record.
 */
export const GITNEXUS_MANAGED_LIFECYCLE_REVIEW: CandidateManagedLifecycleReviewRecord = {
  candidateId: 'gitnexus',
  reviewedAt: '2026-09-14',
  reviewedVersion: '1.6.12',
  packageManager: 'user-installed npm CLI; Token Harness does not install it',
  activationSurfaces: ['Claude Code user MCP entry mcpServers.gitnexus'],
  residualScope:
    'Lifecycle evidence is Claude JSON configuration only. Codex surgical TOML ownership, RFC 0009 compatibility, indexing/setup ownership and combined-stack behavior remain unreviewed.',
  result: {
    state: 'passed',
    reason:
      'Reviewed 2026-09-14 for GitNexus 1.6.12: the already-landed Claude MCP primitive uses snapshot-backed merge-json ownership, preserves brownfield user ownership, passively verifies the exact entry, removes only the recorded owned entry, and fails closed on drift. It does not install GitNexus or run setup/analyze/indexing.',
  },
};

/**
 * Upstream maintenance is active, but the exact reviewed package is licensed under PolyForm
 * Noncommercial 1.0.0. The project-maturity gate explicitly includes licensing, so generic managed
 * production promotion stays blocked unless separate terms or an appropriate license review admit
 * the intended deployment. This is not a conclusion about any particular user's legal rights.
 */
export const GITNEXUS_PROJECT_MATURITY_REVIEW: CandidateProjectMaturityReviewRecord = {
  candidateId: 'gitnexus',
  reviewedAt: '2026-09-14',
  repository: 'abhigyanpatwari/GitNexus',
  repositoryCreatedAt: '2025-08-02T23:20:31Z',
  earliestReviewedStableReleaseAt: '2026-09-04T19:28:22Z',
  latestReviewedStableReleaseAt: '2026-09-12T21:40:04Z',
  latestReviewedRelease: '1.6.12',
  license: 'PolyForm-Noncommercial-1.0.0',
  residualRisk:
    'Technical maintenance is active, but the reviewed license permits noncommercial purposes rather than generic commercial production use. Keep promotion blocked until the intended deployment has suitable license terms or an appropriate license review.',
  result: {
    state: 'blocked',
    reason:
      'Reviewed 2026-09-14: upstream is active and non-archived, stable 1.6.11 and 1.6.12 releases landed on 2026-09-04 and 2026-09-12, and a 1.6.13 release candidate followed on 2026-09-14. However GitNexus 1.6.12 declares PolyForm-Noncommercial-1.0.0, so Token Harness must not treat generic commercial production promotion as licensed by this review.',
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
  if (candidateId === 'gitnexus') {
    return {
      managedLifecycle: GITNEXUS_MANAGED_LIFECYCLE_REVIEW.result,
      projectMaturity: GITNEXUS_PROJECT_MATURITY_REVIEW.result,
    };
  }
  return {};
}
