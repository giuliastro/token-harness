import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('setup-first guided dashboard', () => {
  it('uses three product destinations with a clear mental model', () => {
    assert.match(GUIDE_HTML, /id="tab-dashboard"[^>]*>Dashboard</);
    assert.match(GUIDE_HTML, /id="tab-setup"[^>]*>Setup</);
    assert.match(GUIDE_HTML, /id="tab-results"[^>]*>Results</);
    assert.doesNotMatch(GUIDE_HTML, />Actions</);
    assert.doesNotMatch(GUIDE_HTML, />Monitor</);
    assert.match(GUIDE_HTML, /Your coding setup, what is active, and what to do next/);
  });

  it('makes setup an ordered onboarding flow instead of a bag of actions', () => {
    for (const label of [
      'Coding agents',
      'Managed optimizers',
      'Experimental tools',
      'Optional agent tuning',
      'Checks and maintenance',
    ])
      assert.match(GUIDE_HTML, new RegExp(label));
    assert.match(GUIDE_HTML, /RTK and HarnessTrim/);
    assert.match(GUIDE_HTML, /Headroom, mcptoon and GitNexus/);
    assert.doesNotMatch(GUIDE_HTML, /<h2>Actions<\/h2>/);
  });

  it('keeps setup status and the next useful destination on the dashboard', () => {
    assert.match(GUIDE_HTML, /SETUP STATUS/);
    assert.match(GUIDE_HTML, /Active today/);
    assert.match(GUIDE_HTML, /Getting started/);
    assert.match(GUIDE_JS, /Open setup/);
    assert.match(GUIDE_JS, /Manage setup/);
    assert.match(GUIDE_JS, /Setup incomplete/);
  });

  it('keeps read, review and apply phases explicit for managed setup', () => {
    assert.match(GUIDE_JS, /Review setup for /);
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply reviewed setup/);
    assert.match(GUIDE_JS, /transactional engine with backups/);
    assert.match(GUIDE_JS, /Applying the reviewed change/);
  });

  it('does not invent plan-time, API-cost or quality savings', () => {
    assert.match(GUIDE_JS, /5h \/ 7d allowance/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /billed-token evidence/);
    assert.match(GUIDE_JS, /Quality is never inferred from token savings alone/);
  });

  it('never schedules a full dashboard refresh in the background', () => {
    assert.doesNotMatch(GUIDE_JS, /setInterval\([^]*refresh\(/);
    assert.match(GUIDE_JS, /setInterval\([^]*loadActivity\(\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
  });

  it('marks status stale after a change instead of hiding the operation behind an automatic reload', () => {
    assert.match(GUIDE_JS, /previous state until you choose Refresh/);
    assert.doesNotMatch(GUIDE_JS, /finally\s*\{[^}]*await refresh\(/);
  });
});
