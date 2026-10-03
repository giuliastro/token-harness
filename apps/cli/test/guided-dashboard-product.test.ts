import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_CSS, GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('first-run guided overview', () => {
  it('uses only Overview and Results as product destinations', () => {
    assert.match(GUIDE_HTML, /id="tab-dashboard"[^>]*>Overview</);
    assert.match(GUIDE_HTML, /id="tab-results"[^>]*>Results</);
    assert.doesNotMatch(GUIDE_HTML, /id="tab-setup"/);
    assert.doesNotMatch(GUIDE_HTML, />Setup<\/button>/);
    assert.match(GUIDE_HTML, /Your setup, results and next steps/);
  });

  it('keeps coding agents and the optimization stack as the two visible setup entities', () => {
    assert.match(GUIDE_HTML, /<h2>Coding agents<\/h2>/);
    assert.match(GUIDE_HTML, /<h2>Optimizer setup<\/h2>/);
    assert.match(GUIDE_HTML, /id="connection-overview"/);
    assert.match(GUIDE_HTML, /Setup alone does not prove runtime activity/);
    assert.doesNotMatch(GUIDE_HTML, /Remove Token Harness-managed configuration/);
    assert.match(GUIDE_JS, /Remove managed setup/);
    assert.match(GUIDE_JS, /Recommended baseline/);
    assert.match(GUIDE_JS, /RTK \+ HarnessTrim/);
    assert.doesNotMatch(GUIDE_HTML, /managed-tools|optional-tools|Optional optimizers/);
    assert.match(GUIDE_HTML, /Health and updates/);
    assert.doesNotMatch(GUIDE_HTML, /Checks and maintenance/);
    assert.doesNotMatch(GUIDE_HTML, /<h2>Managed optimizers<\/h2>/);
  });

  it('keeps coding-agent cards status-only and moves setup into the stack', () => {
    assert.match(GUIDE_JS, /Setup available/);
    assert.match(GUIDE_JS, /baselineStatusFor/);
    assert.match(GUIDE_JS, /target\.state === 'actionable'/);
    assert.match(GUIDE_JS, /Optimizer setup detected/);
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
    assert.match(GUIDE_JS, /Setup detected/);
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

  it('shows a concise summary and a filterable evidence list', () => {
    assert.match(GUIDE_HTML, /aria-label="Evidence by source"/);
    assert.match(GUIDE_HTML, /id="result-summary"/);
    assert.match(GUIDE_HTML, /id="result-evidence"/);
    assert.match(GUIDE_HTML, /id="evidence-filter"/);
    assert.match(GUIDE_HTML, /id="evidence-type"/);
    assert.match(GUIDE_HTML, /id="evidence-sort"/);
    assert.match(GUIDE_HTML, /<h2>Evidence<\/h2>/);
    assert.match(GUIDE_JS, /optimizerIds\(\)/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'optimizer'/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'routing'/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'harness'/);
    assert.match(GUIDE_JS, /applyEvidenceFilters/);
    assert.match(GUIDE_JS, /row\.measurement/);
    assert.match(GUIDE_JS, /row\.unit/);
    assert.match(GUIDE_JS, /optimizerSignal/);
    assert.match(GUIDE_JS, /same optimizer records/);
    assert.match(GUIDE_JS, /const routeStatus = routed\?\.state/);
  });

  it('makes Overview a real measured-impact summary', () => {
    assert.match(GUIDE_HTML, /Measured impact/);
    assert.match(GUIDE_JS, /5h \/ 7d allowance/);
    assert.match(GUIDE_JS, /Not measured yet/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /billed-token evidence/);
    assert.match(GUIDE_JS, /output savings alone are not proof/);
  });

  it('never schedules a full overview refresh in the background', () => {
    assert.doesNotMatch(
      GUIDE_JS,
      /setInterval\s*\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{[^}]*\brefresh\s*\(|\brefresh\s*\()/,
    );
    assert.match(GUIDE_JS, /setInterval\([^]*loadActivity\(\)/);
    assert.match(GUIDE_JS, /setInterval\(pollRouting, 15000\)/);
    assert.match(GUIDE_JS, /request\('\/api\/routing'\)/);
    assert.match(GUIDE_JS, /\$\('period'\)\.addEventListener\('change', changePeriod\)/);
  });

  it('bounds recent activity and checks for app updates after the first overview', () => {
    assert.match(GUIDE_JS, /rows\.slice\(0, 8\)/);
    assert.match(GUIDE_CSS, /\.activity-scroll\{max-height:/);
    assert.match(GUIDE_JS, /checkUpdatesOnStartup\(\)/);
    assert.match(GUIDE_JS, /request\('\/api\/update-check'/);
    assert.match(GUIDE_HTML, /id="update-notice"/);
  });

  it('offers mcptoon prerequisite options when the reviewed install is unavailable', () => {
    assert.match(GUIDE_JS, /Installation options/);
    assert.match(GUIDE_JS, /pipx\.pypa\.io\/stable\/installation/);
    assert.match(GUIDE_JS, /docs\.astral\.sh\/uv\/getting-started\/installation/);
    assert.match(GUIDE_JS, /after pipx or uv is available/);
  });

  it('keeps routing configuration and observed callbacks as separate states', () => {
    assert.match(GUIDE_JS, /routing\?\.verificationTier === 'runtime-observed'/);
    assert.match(GUIDE_JS, /routing\?\.enablement === 'untrusted'/);
    assert.match(GUIDE_JS, /Open \/hooks in Codex and trust this hook/);
    assert.match(GUIDE_JS, /Configured; waiting for the first runtime callback/);
    assert.match(GUIDE_JS, /routing\.promptSubmissions/);
    assert.match(GUIDE_JS, /routing\.subagentsStarted/);
    assert.match(GUIDE_JS, /routing\.subagentsStopped/);
    assert.match(GUIDE_JS, /request\('\/api\/routing'\)/);
  });

  it('refreshes status after an approved change without adding background polling', () => {
    assert.doesNotMatch(GUIDE_JS, /previous state until you choose Refresh/);
    assert.match(GUIDE_JS, /Refreshing the current setup/);
    assert.match(GUIDE_JS, /waitForAutomaticRefresh/);
    assert.match(GUIDE_JS, /refreshOverviewAfterMutation/);
  });
});
