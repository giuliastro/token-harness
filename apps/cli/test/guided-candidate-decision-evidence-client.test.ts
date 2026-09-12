import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_DECISION_EVIDENCE_JS } from '../src/guided-candidate-decision-evidence-client.js';

describe('guided candidate decision evidence', () => {
  it('shows bounded comparison facts and unified promotion gates without inventing a score', () => {
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Decision evidence/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Promotion review/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Next gate/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /passedGateCount/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /requiredGateCount/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Evidence coverage/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Task classes/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Pair verdicts/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Local token delta/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Wall-clock delta/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /not a composite score/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS));
  });

  it('keeps local-token, wall-clock, activation and promotion meanings separate', () => {
    assert.match(
      GUIDE_CANDIDATE_DECISION_EVIDENCE_JS,
      /Local token\/context evidence is not provider allowance/,
    );
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /operational evidence/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /Lifecycle and combined-stack gates remain explicit/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /What still blocks promotion/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /hard regression gate/);
    assert.match(GUIDE_CANDIDATE_DECISION_EVIDENCE_JS, /\/api\/candidate-campaign/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_DECISION_EVIDENCE_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze|promotionEligible\s*=\s*true/,
    );
  });
});
