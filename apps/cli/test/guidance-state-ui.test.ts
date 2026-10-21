import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { GUIDE_ONBOARDING_JS } from '../src/guided-ui-onboarding.js';

describe('guided agent capability state UI', () => {
  it('keeps advanced agent capability state available without making it a first-run step', () => {
    // Per-agent state is in the advanced Details view, which is off until the user opts in.
    assert.match(GUIDE_HTML, /id="advanced-toggle"/);
    assert.match(GUIDE_HTML, /id="tab-details"[^>]*\bhidden\b/);
    assert.match(GUIDE_JS, /id', 'details-agents'|agents\.id = 'details-agents'/);
    assert.match(GUIDE_JS, /Status without changing settings/);
    assert.match(GUIDE_JS, /In-session guidance/);
    assert.match(GUIDE_JS, /agent\.guidance\?\.label/);
    assert.match(GUIDE_JS, /agent\.allowance\?\.length/);
    assert.match(GUIDE_JS, /More agent checks/);
    // The first-run screen offers only the recommended baseline.
    assert.doesNotMatch(GUIDE_ONBOARDING_JS, /guidance|Reasoning|reasoning|skill/);
  });

  it('keeps optional in-session guidance behind the existing preview and apply transaction', () => {
    assert.match(GUIDE_JS, /reviewPreview\(\{ action: 'skill', harness: agentId \}/);
    assert.match(
      GUIDE_JS,
      /action\.kind === 'skill' && action\.harness\) return reviewSkill\(action\.harness\)/,
    );
    assert.match(GUIDE_JS, /Turn on in-session guidance/);
    assert.match(GUIDE_JS, /request\('\/api\/preview', body\)/);
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
  });
});
