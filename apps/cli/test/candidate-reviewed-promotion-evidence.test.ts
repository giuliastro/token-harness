import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GITNEXUS_MANAGED_LIFECYCLE_REVIEW,
  GITNEXUS_PROJECT_MATURITY_REVIEW,
  MCPTOON_MANAGED_LIFECYCLE_REVIEW,
  MCPTOON_PROJECT_MATURITY_REVIEW,
  reviewedPromotionEvidenceForCandidate,
} from '../src/commands/candidate-reviewed-promotion-evidence.js';

describe('reviewed candidate promotion evidence', () => {
  it('records mcptoon managed lifecycle as explicit scoped evidence', () => {
    assert.equal(MCPTOON_MANAGED_LIFECYCLE_REVIEW.candidateId, 'mcptoon');
    assert.equal(MCPTOON_MANAGED_LIFECYCLE_REVIEW.reviewedAt, '2026-09-13');
    assert.equal(MCPTOON_MANAGED_LIFECYCLE_REVIEW.reviewedVersion, '0.7.10');
    assert.equal(MCPTOON_MANAGED_LIFECYCLE_REVIEW.packageManager, 'pipx');
    assert.equal(MCPTOON_MANAGED_LIFECYCLE_REVIEW.result.state, 'passed');
    assert.match(MCPTOON_MANAGED_LIFECYCLE_REVIEW.result.reason, /rollback\/uninstall/);
    assert.match(MCPTOON_MANAGED_LIFECYCLE_REVIEW.residualScope, /compatibility/i);
  });

  it('records mcptoon project maturity as explicit dated evidence', () => {
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.candidateId, 'mcptoon');
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.reviewedAt, '2026-09-13');
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.repository, 'activeing123/mcptoon');
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.license, 'Apache-2.0');
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.latestReviewedRelease, '0.7.10');
    assert.equal(MCPTOON_PROJECT_MATURITY_REVIEW.result.state, 'passed');
    assert.match(MCPTOON_PROJECT_MATURITY_REVIEW.result.reason, /Reviewed 2026-09-13/);
    assert.match(MCPTOON_PROJECT_MATURITY_REVIEW.result.reason, /project remains young/i);
  });

  it('records the existing GitNexus Claude lifecycle without widening its scope', () => {
    assert.equal(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.candidateId, 'gitnexus');
    assert.equal(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.reviewedAt, '2026-09-14');
    assert.equal(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.reviewedVersion, '1.6.12');
    assert.equal(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.result.state, 'passed');
    assert.deepEqual(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.activationSurfaces, [
      'Claude Code user MCP entry mcpServers.gitnexus',
    ]);
    assert.match(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.residualScope, /Codex/i);
    assert.match(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.residualScope, /RFC 0009/i);
    assert.match(GITNEXUS_MANAGED_LIFECYCLE_REVIEW.result.reason, /does not install GitNexus/i);
  });

  it('keeps GitNexus project promotion blocked by the reviewed noncommercial license', () => {
    assert.equal(GITNEXUS_PROJECT_MATURITY_REVIEW.candidateId, 'gitnexus');
    assert.equal(GITNEXUS_PROJECT_MATURITY_REVIEW.repository, 'abhigyanpatwari/GitNexus');
    assert.equal(GITNEXUS_PROJECT_MATURITY_REVIEW.latestReviewedRelease, '1.6.12');
    assert.equal(GITNEXUS_PROJECT_MATURITY_REVIEW.license, 'PolyForm-Noncommercial-1.0.0');
    assert.equal(GITNEXUS_PROJECT_MATURITY_REVIEW.result.state, 'blocked');
    assert.match(GITNEXUS_PROJECT_MATURITY_REVIEW.result.reason, /commercial production/i);
    assert.match(GITNEXUS_PROJECT_MATURITY_REVIEW.residualRisk, /license/i);
  });

  it('does not infer reviewed evidence for Headroom', () => {
    assert.deepEqual(reviewedPromotionEvidenceForCandidate('headroom'), {});
  });

  it('returns only the explicitly reviewed mcptoon gates', () => {
    const review = reviewedPromotionEvidenceForCandidate('mcptoon');
    assert.deepEqual(Object.keys(review), ['managedLifecycle', 'projectMaturity']);
    assert.equal(review.managedLifecycle?.state, 'passed');
    assert.equal(review.projectMaturity?.state, 'passed');
    assert.equal(review.compatibilityReversibility, undefined);
    assert.equal(review.combinedStackValidation, undefined);
  });

  it('returns the reviewed GitNexus lifecycle plus the explicit license blocker', () => {
    const review = reviewedPromotionEvidenceForCandidate('gitnexus');
    assert.deepEqual(Object.keys(review), ['managedLifecycle', 'projectMaturity']);
    assert.equal(review.managedLifecycle?.state, 'passed');
    assert.equal(review.projectMaturity?.state, 'blocked');
    assert.equal(review.compatibilityReversibility, undefined);
    assert.equal(review.combinedStackValidation, undefined);
  });
});
