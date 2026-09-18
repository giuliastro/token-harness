import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('actionable first-run overview', () => {
  it('uses two product destinations with setup embedded in Overview', () => {
    assert.match(GUIDE_HTML, /id="tab-dashboard"[^>]*>Overview</);
    assert.match(GUIDE_HTML, /id="tab-results"[^>]*>Results</);
    assert.doesNotMatch(GUIDE_HTML, /id="tab-setup"/);
    assert.doesNotMatch(GUIDE_HTML, /id="view-setup"/);
    assert.match(
      GUIDE_HTML,
      /Your agents, optimizer status, results summary, and the next useful action/,
    );
  });

  it('organizes first run around agents and recommended optimizers', () => {
    assert.match(GUIDE_HTML, /Coding agents/);
    assert.match(GUIDE_HTML, /Recommended optimizers/);
    assert.match(GUIDE_HTML, /RTK + HarnessTrim/);
    assert.match(GUIDE_HTML, /<summary>Optional optimizers</summary>/);
    assert.match(GUIDE_HTML, /mcptoon, GitNexus and Headroom are optional/);
    assert.match(GUIDE_HTML, /Agent preferences (advanced)/);
    assert.doesNotMatch(GUIDE_HTML, /Set up Token Harness in order/);
  });

  it('puts the action beside every incomplete first-run state', () => {
    assert.match(GUIDE_JS, /Set up ' + agent.name/);
    assert.match(GUIDE_JS, /Set up ' + info.name + ' for ' + agent.name/);
    assert.match(GUIDE_JS, /Setup needed/);
    assert.doesNotMatch(GUIDE_JS, /Review baseline for /);
    assert.doesNotMatch(GUIDE_JS, /Open setup/);
    assert.doesNotMatch(GUIDE_JS, /Manage setup/);
    assert.doesNotMatch(GUIDE_JS, /No agent yet/);
    assert.doesNotMatch(GUIDE_JS, /Installed · setup needed/);
  });

  it('keeps safe preview and explicit apply underneath simple setup language', () => {
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply setup/);
    assert.match(GUIDE_JS, /transactional engine with backups/);
    assert.match(GUIDE_JS, /Applying the reviewed change/);
    assert.match(
      GUIDE_JS,
      /request('/api/preview', {s*action: 'setup',s*harness: agentId/,
    );
    assert.match(GUIDE_JS, /request('/api/apply', { ticket })/);
  });

  it('turns maintenance into understandable actions', () => {
    assert.match(GUIDE_HTML, /<h2>Maintenance</h2>/);
    assert.match(GUIDE_JS, /Verify setup/);
    assert.match(GUIDE_JS, /Check for updates/);
    assert.match(GUIDE_JS, /Update now/);
    assert.match(GUIDE_JS, //api/update-apply/);
    assert.doesNotMatch(GUIDE_JS, /Check integrations/);
    assert.doesNotMatch(GUIDE_JS, /Check optimizer updates/);
  });

  it('keeps overview metrics as a summary and full evidence in Results', () => {
    assert.match(GUIDE_HTML, /A small summary only. Full measurement details stay in Results/);
    assert.match(GUIDE_JS, /5h / 7d allowance/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /Quality is never inferred from token savings alone/);
  });

  it('never schedules a full dashboard refresh in the background', () => {
    assert.doesNotMatch(
      GUIDE_JS,
      /setInterval\s*\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{[^}]*\brefresh\s*\(|\brefresh\s*\()/,
    );
    assert.match(GUIDE_JS, /setInterval\([^]*loadActivity\(\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
  });

  it('marks visible state stale after a change instead of hiding it behind an automatic reload', () => {
    assert.match(GUIDE_JS, /previous state until you choose Refresh/);
    assert.doesNotMatch(GUIDE_JS, /finally\s*\{[^}]*await refresh\(/);
  });
});
