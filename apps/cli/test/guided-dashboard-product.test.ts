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
      /Your coding agents, optimization stack, health and measured results in one place/,
    );
  });

  it('keeps coding agents and the optimization stack as the two visible setup entities', () => {
    assert.match(GUIDE_HTML, /<h2>Coding agents<\/h2>/);
    assert.match(GUIDE_HTML, /<h2>Optimizer connections<\/h2>/);
    assert.match(GUIDE_HTML, /id="connection-overview"/);
    assert.match(GUIDE_HTML, /Select one or more harnesses/);
    assert.match(GUIDE_JS, /Recommended baseline/);
    assert.match(GUIDE_JS, /RTK \+ HarnessTrim/);
    assert.doesNotMatch(GUIDE_HTML, /managed-tools|optional-tools|Optional optimizers/);
    assert.match(GUIDE_HTML, /Health and updates/);
    assert.doesNotMatch(GUIDE_HTML, /Checks and maintenance/);
    assert.doesNotMatch(GUIDE_HTML, /<h2>Managed optimizers<\/h2>/);
  });

  it('keeps coding-agent cards status-only and moves setup into the stack', () => {
    assert.match(GUIDE_JS, /Connections available/);
    assert.match(GUIDE_JS, /baselineStatusFor/);
    assert.match(GUIDE_JS, /target\.state === 'actionable'/);
    assert.match(GUIDE_JS, /This card is status only/);
    assert.match(GUIDE_JS, /Optimization stack below/);
    assert.doesNotMatch(GUIDE_JS, /Finish setup/);
    assert.doesNotMatch(GUIDE_JS, /Finish setup for /);
  });

  it('models optimizer-to-agent setup as one scalable connection matrix', () => {
    assert.match(GUIDE_JS, /connectionPresentation/);
    assert.match(GUIDE_JS, /renderConnectionOverview/);
    assert.match(GUIDE_JS, /Manage connections/);
    assert.match(GUIDE_JS, /Install & connect/);
    assert.match(GUIDE_JS, /reviewSetup\(id\)/);
    assert.match(GUIDE_JS, /setupChoiceData/);
    assert.match(GUIDE_JS, /setup-choice/);
    assert.match(GUIDE_JS, /Set up recommended stack/);
    assert.match(GUIDE_JS, /Connected to/);
    assert.match(GUIDE_JS, /Available/);
    assert.match(GUIDE_JS, /Not applicable/);
    assert.match(GUIDE_JS, /setup-choice-limitation/);
    assert.doesNotMatch(GUIDE_JS, /Connect to ['"] \+ agent\.name/);
    assert.doesNotMatch(GUIDE_JS, /Set up for ['"] \+ agent\.name/);
    assert.match(GUIDE_JS, /Install update/);
    assert.match(GUIDE_JS, /Re-check health/);
  });

  it('keeps preview and explicit approval for setup changes', () => {
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply recommended setup/);
    assert.match(GUIDE_JS, /Apply ['"] \+ provider\.name \+ ['"] connections/);
    assert.match(GUIDE_JS, /transactional engine with backups/);
    assert.match(GUIDE_JS, /Applying the approved change/);
  });

  it('makes Results a dynamic optimizer and harness dashboard', () => {
    assert.match(GUIDE_HTML, /Results dashboard/);
    assert.match(GUIDE_HTML, /<h2>By optimizer<\/h2>/);
    assert.match(GUIDE_HTML, /<h2>By coding agent<\/h2>/);
    assert.match(GUIDE_JS, /optimizerIds\(\)/);
    assert.match(GUIDE_JS, /row\.providerId === id/);
    assert.match(GUIDE_JS, /row\.harnesses\?\.includes\(agent\.id\)/);
    assert.match(GUIDE_JS, /Configured optimizers/);
    assert.match(GUIDE_JS, /Active connections/);
    assert.match(GUIDE_JS, /Measured optimizers/);
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
