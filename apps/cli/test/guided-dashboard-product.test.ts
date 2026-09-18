import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('actionable first-run overview', () => {
  it('uses two product destinations with setup embedded in Overview', () => {
    assert.match(GUIDE_HTML, /id="tab-dashboard"[^>]*>Overview</);
    assert.match(GUIDE_HTML, /id="tab-results"[^>]*>Results</);
    assert.doesNotMatch(GUIDE_HTML, /id="tab-setup"/);
    assert.doesNotMatch(GUIDE_HTML, /id="view-setup"/);
    assert.ok(
      GUIDE_HTML.includes(
        'Your agents, optimizer status, results summary, and the next useful action.',
      ),
    );
  });

  it('organizes first run around agents and recommended optimizers', () => {
    assert.ok(GUIDE_HTML.includes('Coding agents'));
    assert.ok(GUIDE_HTML.includes('Recommended optimizers'));
    assert.ok(GUIDE_HTML.includes('RTK + HarnessTrim'));
    assert.ok(GUIDE_HTML.includes('<summary>Optional optimizers</summary>'));
    assert.ok(GUIDE_HTML.includes('mcptoon, GitNexus and Headroom are optional'));
    assert.ok(GUIDE_HTML.includes('Agent preferences (advanced)'));
    assert.ok(!GUIDE_HTML.includes('Set up Token Harness in order'));
  });

  it('puts the action beside every incomplete first-run state', () => {
    assert.ok(GUIDE_JS.includes("'Set up ' + agent.name"));
    assert.ok(GUIDE_JS.includes("'Set up ' + info.name + ' for ' + agent.name"));
    assert.ok(GUIDE_JS.includes('Setup needed'));
    assert.ok(!GUIDE_JS.includes('Review baseline for '));
    assert.ok(!GUIDE_JS.includes('Open setup'));
    assert.ok(!GUIDE_JS.includes('Manage setup'));
    assert.ok(!GUIDE_JS.includes('No agent yet'));
    assert.ok(!GUIDE_JS.includes('Installed · setup needed'));
  });

  it('keeps safe preview and explicit apply underneath simple setup language', () => {
    assert.ok(GUIDE_JS.includes('Nothing changes yet'));
    assert.ok(GUIDE_JS.includes('Apply setup'));
    assert.ok(GUIDE_JS.includes('transactional engine with backups'));
    assert.ok(GUIDE_JS.includes('Applying the reviewed change'));
    assert.ok(GUIDE_JS.includes("request('/api/preview', {"));
    assert.ok(GUIDE_JS.includes("action: 'setup'"));
    assert.ok(GUIDE_JS.includes('harness: agentId'));
    assert.ok(GUIDE_JS.includes("request('/api/apply', { ticket })"));
  });

  it('turns maintenance into understandable actions', () => {
    assert.ok(GUIDE_HTML.includes('<h2>Maintenance</h2>'));
    assert.ok(GUIDE_JS.includes('Verify setup'));
    assert.ok(GUIDE_JS.includes('Check for updates'));
    assert.ok(GUIDE_JS.includes('Update now'));
    assert.ok(GUIDE_JS.includes('/api/update-apply'));
    assert.ok(!GUIDE_JS.includes('Check integrations'));
    assert.ok(!GUIDE_JS.includes('Check optimizer updates'));
  });

  it('keeps overview metrics as a summary and full evidence in Results', () => {
    assert.ok(GUIDE_HTML.includes('A small summary only. Full measurement details stay in Results.'));
    assert.ok(GUIDE_JS.includes('5h / 7d allowance'));
    assert.ok(GUIDE_JS.includes('Not measured yet'));
    assert.ok(GUIDE_JS.includes('authoritative paired allowance evidence'));
    assert.ok(GUIDE_JS.includes('Quality is never inferred from token savings alone'));
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
    assert.ok(GUIDE_JS.includes('previous state until you choose Refresh'));
    assert.doesNotMatch(GUIDE_JS, /finally\s*\{[^}]*await refresh\(/);
  });
});
