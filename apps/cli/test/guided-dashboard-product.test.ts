import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('first-run guided overview', () => {
  it('uses only Overview and Results as product destinations', () => {
    assert.match(GUIDE_HTML, /id="tab-dashboard"[^>]*>Overview</);
    assert.match(GUIDE_HTML, /id="tab-results"[^>]*>Results</);
    assert.doesNotMatch(GUIDE_HTML, /id="tab-setup"/);
    assert.doesNotMatch(GUIDE_HTML, />Setup<\/button>/);
    assert.match(
      GUIDE_HTML,
      /Your coding agents, optimizer setup, health and measured results in one place/,
    );
  });

  it('keeps coding agents and optimizers as the two visible setup entities', () => {
    assert.match(GUIDE_HTML, /<h2>Coding agents<\/h2>/);
    assert.match(GUIDE_HTML, /<h2>Optimizers<\/h2>/);
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /Optional optimizers/);
    assert.match(GUIDE_HTML, /RTK \+ HarnessTrim/);
    assert.match(GUIDE_HTML, /Health and updates/);
    assert.doesNotMatch(GUIDE_HTML, /Checks and maintenance/);
    assert.doesNotMatch(GUIDE_HTML, /<h2>Managed optimizers<\/h2>/);
  });

  it('puts setup beside an agent only when a runtime-supported action is actually available', () => {
    assert.match(GUIDE_JS, /Setup incomplete/);
    assert.match(GUIDE_JS, /Finish setup for /);
    assert.match(GUIDE_JS, /Finish setup/);
    assert.match(GUIDE_JS, /baselineStatusFor/);
    assert.match(GUIDE_JS, /target\.state === 'actionable'/);
    assert.match(GUIDE_JS, /No automatic setup/);
    assert.doesNotMatch(GUIDE_JS, /baselineReadyFor/);
    assert.doesNotMatch(GUIDE_JS, /Review baseline for /);
    assert.doesNotMatch(GUIDE_JS, /Open setup/);
    assert.doesNotMatch(GUIDE_JS, /Manage setup/);
  });

  it('puts only actionable contextual setup controls on optimizer cards', () => {
    assert.match(GUIDE_JS, /Installed · setup available/);
    assert.match(GUIDE_JS, /Partially connected · setup available/);
    assert.match(GUIDE_JS, /Connected elsewhere · setup available/);
    assert.match(GUIDE_JS, /Installed · no automatic setup/);
    assert.match(GUIDE_JS, /target\.state === 'not-applicable'/);
    assert.match(GUIDE_JS, /no automatic setup/);
    assert.match(GUIDE_JS, /Compatibility note/);
    assert.match(GUIDE_JS, /target\?\.state !== 'actionable'/);
    assert.match(GUIDE_JS, /Why there is no Connect button/);
    assert.doesNotMatch(GUIDE_JS, /Installed · not connected/);
    assert.match(GUIDE_JS, /Set up for /);
    assert.match(GUIDE_JS, /Install update/);
    assert.match(GUIDE_JS, /Re-check health/);
    assert.doesNotMatch(GUIDE_JS, /No agent yet/);
    assert.doesNotMatch(GUIDE_JS, /Review mcptoon for /);
    assert.doesNotMatch(GUIDE_JS, /Review GitNexus for /);
    assert.doesNotMatch(GUIDE_JS, /Review Headroom for /);
  });

  it('keeps preview and explicit approval for setup changes', () => {
    assert.match(GUIDE_JS, /Safe preview first/);
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply recommended setup/);
    assert.match(GUIDE_JS, /Set up ['"] \+ provider\.name/);
    assert.match(GUIDE_JS, /transactional engine with backups/);
    assert.match(GUIDE_JS, /Applying the approved change/);
  });

  it('makes Overview a real measured-impact summary', () => {
    assert.match(GUIDE_HTML, /Measured impact/);
    assert.match(GUIDE_JS, /5h \/ 7d allowance/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /billed-token evidence/);
    assert.match(GUIDE_JS, /Quality is never inferred from token savings alone/);
  });

  it('never schedules a full overview refresh in the background', () => {
    assert.doesNotMatch(
      GUIDE_JS,
      /setInterval\s*\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{[^}]*\brefresh\s*\(|\brefresh\s*\()/,
    );
    assert.match(GUIDE_JS, /setInterval\([^]*loadActivity\(\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
  });

  it('refreshes status after an approved change without adding background polling', () => {
    assert.doesNotMatch(GUIDE_JS, /previous state until you choose Refresh/);
    assert.match(GUIDE_JS, /Refreshing the current setup/);
    assert.match(GUIDE_JS, /waitForAutomaticRefresh/);
    assert.match(GUIDE_JS, /refreshOverviewAfterMutation/);
  });
});
