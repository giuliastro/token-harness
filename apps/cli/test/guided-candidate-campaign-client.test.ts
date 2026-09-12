import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_CANDIDATE_CAMPAIGN_JS } from '../src/guided-candidate-campaign-client.js';

describe('guided candidate campaign', () => {
  it('keeps resumable campaign identity separate per candidate and agent', () => {
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Run standard evaluation/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /localStorage/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /candidateId \+ ':' \+ harness/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /candidateId \+ '-' \+ harness \+ '-eval-'/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Campaign id:/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /stopImmediatePropagation/);
    assert.doesNotThrow(() => new Script(GUIDE_CANDIDATE_CAMPAIGN_JS));
  });

  it('reads progress, selection signal and Next directly in the browser', () => {
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /\/api\/candidate-campaign/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Progress/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Selection signal/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Decision ready/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Evidence pairs/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Refresh status/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /data\.nextStep/);
  });

  it('starts and finishes only bounded local capture steps through the protected endpoint', () => {
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /\/api\/candidate-campaign\/action/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /X-Token-Harness-CSRF/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Start baseline capture/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Start optimized capture/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Record outcome/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /quality: quality\.value/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /failedAttempts: failedCount/);
    assert.doesNotMatch(GUIDE_CANDIDATE_CAMPAIGN_JS, /argv\s*:/);
  });

  it('keeps a benchmark-matrix terminal fallback without making it the primary workflow', () => {
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /Terminal campaign status/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /CLI fallback for this step/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /benchmark-matrix/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--benchmark-id/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--candidate/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /--harness/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /debugging or automation/);
  });

  it('keeps activation and promotion separate from campaign evidence', () => {
    assert.match(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /Candidate attribution records the experiment target/,
    );
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /does not prove the candidate was active/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /does not treat it as activation verification/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /not promotion approval/);
    assert.match(GUIDE_CANDIDATE_CAMPAIGN_JS, /I enabled/);
    assert.doesNotMatch(
      GUIDE_CANDIDATE_CAMPAIGN_JS,
      /headroom wrap|pip install|npm install|gitnexus analyze/,
    );
  });
});
