import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_CAMPAIGN_JS } from '../src/guided-candidate-campaign-client.js';

describe('guided candidate campaign', () => {
  it('uses the standardized resumable campaign command instead of ad-hoc pairs', () => {
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Run standard evaluation/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /benchmark-matrix/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--benchmark-id/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--candidate/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--harness/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /localStorage/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /candidateId \+ ':' \+ harness/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /candidateId \+ '-' \+ harness \+ '-eval-'/);
    assert.match(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /evidence from Claude Code and Codex can never be mixed accidentally/,
    );
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /stopImmediatePropagation/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_CAMPAIGN_JS));
  });

  it('keeps activation and promotion separate from campaign evidence', () => {
    assert.match(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /Candidate attribution records the experiment target/,
    );
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /does not prove the candidate was active/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /not promotion approval/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /benchmark-start|benchmark-finish|headroom wrap|pip install|npm install|gitnexus analyze/,
    );
  });
});
