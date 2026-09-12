import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_COMPARISON_JS } from '../src/guided-candidate-comparison-client.js';

describe('guided candidate campaign comparison', () => {
  it('compares saved campaign evidence without producing a score or winner', () => {
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Compare candidate evidence/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Evidence, not a leaderboard/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Promotion review/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Next gate/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /Gate counts are not a score or a ranking/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /\/api\/candidate-campaign\?candidate=/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_COMPARISON_JS));
  });

  it('reads only existing campaign ids and never creates or activates candidate state', () => {
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /localStorage\.getItem/);
    assert.doesNotMatch(GUIDE_CANDIDATE_COMPARISON_JS, /localStorage\.setItem|newCampaignId|Date\.now/);
    assert.match(GUIDE_CANDIDATE_COMPARISON_JS, /document\.addEventListener\('click'/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_COMPARISON_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze|mcptoon init|promotionEligible\s*=\s*true/,
    );
  });

  it('keeps candidate and harness ordering deterministic instead of sorting by evidence', () => {
    const headroom = GUIDE_CANDIDATE_COMPARISON_JS.indexOf("id: 'headroom'");
    const mcptoon = GUIDE_CANDIDATE_COMPARISON_JS.indexOf("id: 'mcptoon'");
    const gitnexus = GUIDE_CANDIDATE_COMPARISON_JS.indexOf("id: 'gitnexus'");
    const claude = GUIDE_CANDIDATE_COMPARISON_JS.indexOf("id: 'claude'");
    const codex = GUIDE_CANDIDATE_COMPARISON_JS.indexOf("id: 'codex'");

    assert.ok(headroom >= 0 && headroom < mcptoon && mcptoon < gitnexus);
    assert.ok(claude >= 0 && claude < codex);
    assert.doesNotMatch(GUIDE_CANDIDATE_COMPARISON_JS, /\.sort\(/);
  });
});
