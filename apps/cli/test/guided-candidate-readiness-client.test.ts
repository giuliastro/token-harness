import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_READINESS_JS } from '../src/guided-candidate-readiness-client.js';

describe('guided candidate readiness presentation', () => {
  it('shows promotion progress without claiming evaluation readiness is approval', () => {
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Promotion review/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Next gate/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /Evaluation readiness is not promotion approval/);
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /promotionReadiness/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_READINESS_JS));
  });

  it('only reuses the local overview endpoint and never runs candidate install or activation commands', () => {
    assert.match(GUIDE_CANDIDATE_READINESS_JS, /\/api\/overview\?period=/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_READINESS_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze/,
    );
  });
});
