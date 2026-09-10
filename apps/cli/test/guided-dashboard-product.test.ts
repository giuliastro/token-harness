import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('simple guided dashboard', () => {
  it('uses three novice-facing destinations', () => {
    assert.match(GUIDE_HTML, />Monitor</);
    assert.match(GUIDE_HTML, />Actions</);
    assert.match(GUIDE_HTML, />Results</);
    assert.doesNotMatch(GUIDE_HTML, />Dashboard</);
    assert.doesNotMatch(GUIDE_HTML, />Policies</);
    assert.doesNotMatch(GUIDE_HTML, />Evidence</);
    assert.match(GUIDE_HTML, /What you are getting/);
    assert.match(GUIDE_HTML, /Coding agents/);
  });

  it('puts obvious actions in a dedicated section', () => {
    assert.match(GUIDE_HTML, /Optimize reasoning/);
    assert.match(GUIDE_HTML, /Set up optimizers/);
    assert.match(GUIDE_HTML, /Check integrations/);
    assert.match(GUIDE_HTML, /Check updates/);
    assert.match(GUIDE_HTML, /You will always review a change before it is applied/);
    assert.match(GUIDE_HTML, /Normal coding/);
    assert.match(GUIDE_HTML, /Simple edits/);
    assert.match(GUIDE_HTML, /Complex work/);
    assert.match(GUIDE_HTML, /Critical work/);
    assert.doesNotMatch(GUIDE_HTML, /Everyday coding/);
  });

  it('keeps advanced stack and candidate detail out of the primary flow', () => {
    assert.match(GUIDE_HTML, /<details class="disclosure"><summary>Technical details<\/summary>/);
    assert.match(GUIDE_HTML, /id="stack"/);
    assert.match(GUIDE_HTML, /id="candidates"/);
  });

  it('makes read, review and apply phases explicit', () => {
    assert.match(GUIDE_JS, /Checking current settings/);
    assert.match(GUIDE_JS, /Read-only\. No change is being made/);
    assert.match(GUIDE_JS, /Nothing changes until you review and approve the recommendation/);
    assert.match(GUIDE_JS, /Apply change/);
    assert.match(GUIDE_JS, /Applying approved change/);
    assert.match(GUIDE_JS, /Keep this window open until it finishes/);
    assert.match(GUIDE_JS, /\$\('close'\)\.disabled = value && mutating/);
  });

  it('does not invent plan-time, API-cost or quality savings', () => {
    assert.match(GUIDE_JS, /5h \/ 7d allowance saved/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /billed-token evidence/);
    assert.match(
      GUIDE_JS,
      /does not claim preserved quality until paired benchmark evidence exists/,
    );
  });

  it('translates demonstrated 5h quota evidence into an explicit window equivalent only', () => {
    assert.match(GUIDE_JS, /equivalent to about/);
    assert.match(GUIDE_JS, /300-minute allowance window/);
    assert.match(GUIDE_JS, /weekly percentage is not converted into wall-clock time/);
    assert.match(GUIDE_JS, /Not credited/);
    assert.match(GUIDE_JS, /quality is measured and preserved/);
  });

  it('makes a quality regression the next action instead of celebrating savings', () => {
    assert.match(GUIDE_JS, /Regression detected/);
    assert.match(GUIDE_JS, /Positive allowance savings are blocked/);
    assert.match(GUIDE_JS, /Review the quality result before increasing savings/);
    assert.match(GUIDE_JS, /Review quality evidence/);
  });

  it('never schedules a full dashboard refresh in the background', () => {
    assert.doesNotMatch(GUIDE_JS, /setInterval\([^]*refresh\(/);
    assert.match(GUIDE_JS, /setInterval\([^]*activity\(\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
    assert.doesNotMatch(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', refresh\)/);
  });

  it('keeps current results visible after an approved change instead of forcing a reload', () => {
    assert.match(GUIDE_JS, /markStale\(\)/);
    assert.match(GUIDE_JS, /until you choose Refresh/);
    assert.doesNotMatch(GUIDE_JS, /finally\s*\{[^}]*await refresh\(/);
  });

  it('keeps the existing loading-card contract for both primary agents', () => {
    assert.equal(GUIDE_HTML.match(/class="panel agent loading-card"/g)?.length, 2);
    assert.equal(GUIDE_HTML.includes('class="panel loading-card"'), false);
  });
});