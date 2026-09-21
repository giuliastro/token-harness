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

  it('keeps coding agents and optimizers as distinct scalable entities', () => {
    assert.match(GUIDE_HTML, /<h2>Coding agents<\/h2>/);
    assert.match(GUIDE_HTML, /<h2>Optimizers<\/h2>/);
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /Optional optimizers/);
    assert.match(GUIDE_HTML, /RTK and HarnessTrim/);
    assert.match(GUIDE_HTML, /Health and updates/);
    assert.match(GUIDE_HTML, /Optimizer connections are managed from the Optimizers section/);
  });

  it('keeps harness cards status-only instead of duplicating optimizer setup', () => {
    assert.match(GUIDE_JS, /Connected optimizers:/);
    assert.match(GUIDE_JS, /Manage additional optimizer connections from the Optimizers section/);
    assert.doesNotMatch(GUIDE_JS, /actionButton\('Finish setup'/);
    assert.doesNotMatch(GUIDE_JS, /Finish setup for /);
  });

  it('uses one connection control per optimizer no matter how many harnesses are detected', () => {
    assert.match(GUIDE_JS, /function manageOptimizerConnections/);
    assert.match(GUIDE_JS, /Manage connections/);
    assert.match(GUIDE_JS, /View connections/);
    assert.match(GUIDE_JS, /Harness to connect/);
    assert.match(GUIDE_JS, /Review connection/);
    assert.doesNotMatch(GUIDE_JS, /'Connect to ' \+ agent\.name/);
    assert.doesNotMatch(GUIDE_JS, /'Set up for ' \+ agent\.name/);
  });

  it('derives optimizer cards from the observed stack instead of a fixed render list', () => {
    assert.match(GUIDE_JS, /function managedProviderIds/);
    assert.match(GUIDE_JS, /current\?\.stack\?\.components/);
    assert.match(GUIDE_JS, /recommended\.map\(renderManagedTool\)/);
    assert.match(GUIDE_JS, /optional\.map\(renderManagedTool\)/);
    assert.doesNotMatch(GUIDE_JS, /renderManagedTool\('rtk'\)/);
    assert.doesNotMatch(GUIDE_JS, /renderManagedTool\('harnesstrim'\)/);
  });


  it('keeps preview and explicit approval for setup changes', () => {
    assert.match(GUIDE_JS, /Safe preview first/);
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply recommended setup/);
    assert.match(GUIDE_JS, /Set up ['"] \+ provider\.name/);
    assert.match(GUIDE_JS, /transactional engine with backups/);
    assert.match(GUIDE_JS, /Applying the approved change/);
  });

  it('makes Results a complete optimizer and harness overview before measured evidence', () => {
    assert.match(GUIDE_HTML, /Results overview/);
    assert.match(GUIDE_HTML, /Optimizer × harness coverage/);
    assert.match(GUIDE_HTML, /id="result-coverage"/);
    assert.match(GUIDE_HTML, /id="result-optimizers"/);
    assert.match(GUIDE_HTML, /id="result-harnesses"/);
    assert.match(GUIDE_JS, /function renderResultCoverage/);
    assert.match(GUIDE_JS, /function renderResultOptimizers/);
    assert.match(GUIDE_JS, /function renderResultHarnesses/);
    assert.match(GUIDE_JS, /No measured telemetry/);
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
