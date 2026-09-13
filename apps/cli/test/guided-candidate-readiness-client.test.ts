import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_READINESS_JS } from '../src/guided-candidate-readiness-client.js';
import { GUIDE_PRODUCT_CSS } from '../src/guided-product-styles.js';

describe('guided candidate readiness presentation', () => {
  it('shows promotion progress without claiming evaluation readiness is approval', () => {
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Promotion review/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Next gate/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Evaluation readiness is not promotion approval/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /promotionReadiness/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_READINESS_JS));
  });

  it('keeps the comparison action as a compact full-width toolbar rather than a card-sized grid cell', () => {
    assert.match(
      GUIDE_PRODUCT_CSS,
      /\.candidate-comparison-toolbar\{[^}]*grid-column:1\/-1;[^}]*justify-content:flex-end;[^}]*align-self:start[^}]*\}/,
    );
  });

  it('reuses existing read-only endpoints and never runs candidate install or activation commands', () => {
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /\/api\/overview\?period=/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /\/api\/candidate-campaign\?candidate=/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Compare evaluation evidence/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /localStorage\.getItem/);
    assert.doesNotMatch(GUIDE_CANDIDATE_READINESS_JS, /localStorage\.setItem/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_READINESS_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze/,
    );
  });
});
