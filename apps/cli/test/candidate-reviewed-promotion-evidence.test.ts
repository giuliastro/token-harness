import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MCPTOON_PROJECT_MATURITY_REVIEW,
  reviewedPromotionEvidenceForCandidate,
} from '../src/commands/candidate-reviewed-promotion-evidence.js';

describe('reviewed candidate promotion evidence', () => {
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

  it('does not infer maturity evidence for other candidates', () => {
    assert.deepEqual(reviewedPromotionEvidenceForCandidate('gitnexus'), {});
    assert.deepEqual(reviewedPromotionEvidenceForCandidate('headroom'), {});
  });

  it('returns only the reviewed project-maturity gate for mcptoon', () => {
    const review = reviewedPromotionEvidenceForCandidate('mcptoon');
    assert.deepEqual(Object.keys(review), ['projectMaturity']);
    assert.equal(review.projectMaturity?.state, 'passed');
  });
});
