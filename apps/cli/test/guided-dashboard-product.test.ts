import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_CSS, GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

/**
 * Static contract of the shipped page. Behaviour is exercised against the controller in
 * guided-evidence-client.test.ts and guided-methods-ui.test.ts.
 */
describe('first-run guided overview', () => {
  it('uses Home, Methods and Details as the product destinations', () => {
    for (const [view, label] of [
      ['home', 'Home'],
      ['methods', 'Methods'],
      ['details', 'Details'],
    ] as const) {
      assert.match(
        GUIDE_HTML,
        new RegExp(`id="tab-${view}"[^>]*role="tab"[^>]*>${label}</button>`),
      );
      assert.match(GUIDE_HTML, new RegExp(`id="view-${view}"[^>]*role="tabpanel"`));
    }
    assert.doesNotMatch(GUIDE_HTML, /id="tab-(dashboard|results|setup)"/);
    assert.doesNotMatch(GUIDE_HTML, />Setup<\/button>/);
    // Details is an advanced destination: hidden until the switch is turned on.
    assert.match(GUIDE_HTML, /id="tab-details"[^>]*\bhidden\b/);
    assert.match(GUIDE_HTML, /id="advanced-toggle"[^>]*role="switch"[^>]*aria-checked="false"/);
    assert.match(GUIDE_HTML, /id="view-onboarding" hidden/);
  });

  it('keeps one place to turn methods on and off, apart from the evidence', () => {
    assert.match(GUIDE_HTML, /id="methods-root"/);
    assert.match(GUIDE_HTML, /id="details-root"/);
    assert.match(GUIDE_JS, /recommended: !info\.optional/);
    assert.match(GUIDE_JS, /t\('Recommended'\)/);
    assert.match(GUIDE_JS, /t\('More methods'\)/);
    assert.match(GUIDE_JS, /reviewRemoval\(method\.key\)/);
    assert.match(GUIDE_JS, /reviewSetup\(method\.key\)/);
    assert.match(
      GUIDE_JS,
      /Token Harness removes only the connection it added\. \{name\} stays installed/,
    );
    assert.doesNotMatch(GUIDE_HTML, /managed-tools|optional-tools|Optional optimizers/);
    assert.doesNotMatch(GUIDE_JS, /Experimental tools|Remove managed setup/);
  });

  it('derives a method state from reviewed targets and never from detected setup alone', () => {
    assert.match(GUIDE_JS, /target\.state === 'connected'/);
    assert.match(GUIDE_JS, /target\.state === 'actionable'/);
    assert.match(GUIDE_JS, /Not available for your apps/);
    assert.match(GUIDE_JS, /No results yet/);
    assert.match(GUIDE_JS, /They appear after you use your agents\./);
    assert.match(GUIDE_JS, /Detected setup alone does not prove that the optimizer ran/);
    assert.doesNotMatch(GUIDE_JS, /Finish setup/);
  });

  it('gives each method one switch and one reviewed dialog instead of a connection matrix', () => {
    assert.match(GUIDE_JS, /function switchControl/);
    assert.match(GUIDE_JS, /setAttribute\('role', 'switch'\)/);
    assert.match(GUIDE_JS, /setup-choice/);
    assert.match(GUIDE_JS, /Choose the coding apps where \{name\} should work\./);
    assert.match(GUIDE_JS, /Add to more apps/);
    assert.match(GUIDE_JS, /No supported coding app was found for it\./);
    assert.match(GUIDE_JS, /Install update/);
    assert.match(GUIDE_JS, /Re-check health/);
    assert.doesNotMatch(
      GUIDE_JS,
      /connectionPresentation|renderConnectionOverview|connection-overview/,
    );
    assert.doesNotMatch(GUIDE_JS, /Connect to ['"] \+ agent\.name/);
  });

  it('keeps preview and explicit approval for setup changes', () => {
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Nothing changes until you approve it\./);
    assert.match(GUIDE_JS, /Turn on the recommended setup/);
    assert.match(GUIDE_JS, /Only changes Token Harness owns are applied, with a backup first/);
    assert.match(GUIDE_JS, /Applying the approved change/);
    // Applying is reachable only through a ticket that a preview returned.
    assert.match(GUIDE_JS, /request\('\/api\/preview', body\)/);
    assert.match(GUIDE_JS, /applyTicket\(data\.ticket\)/);
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
  });

  it('shows a concise summary and a filterable evidence list in Details', () => {
    assert.match(GUIDE_JS, /setAttribute\('aria-label', t\('Evidence by source'\)\)/);
    for (const id of [
      'result-summary',
      'result-evidence',
      'evidence-filter',
      'evidence-type',
      'evidence-sort',
    ])
      assert.ok(GUIDE_JS.includes(id), id);
    assert.match(GUIDE_JS, /\['candidate', t\('Experiments'\)\]/);
    assert.match(GUIDE_JS, /optimizerIds\(\)/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'optimizer'/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'routing'/);
    assert.match(GUIDE_JS, /addEvidenceRow\(body, 'harness'/);
    assert.match(GUIDE_JS, /applyEvidenceFilters/);
    // Measurement class and unit are part of every optimizer signal and detail.
    assert.match(GUIDE_JS, /row\.measurement/);
    assert.match(GUIDE_JS, /row\.unit/);
    assert.match(GUIDE_JS, /optimizerSignal/);
    assert.match(GUIDE_JS, /same optimizer records/);
    assert.doesNotMatch(GUIDE_JS, /metricCard\('Automatic routing'/);
  });

  it('keeps Home to measured output, delegated usage and plan balance, with estimates labelled', () => {
    assert.match(
      GUIDE_JS,
      /row\.unit === 'tokens' && row\.measurement === 'Measured local output'/,
    );
    assert.match(GUIDE_JS, /row\.measurement === 'Local estimate'/);
    assert.match(GUIDE_JS, /tag\(t\('Estimate'\), 'estimated'\)/);
    assert.match(GUIDE_JS, /\(estimate\)/);
    assert.match(GUIDE_JS, /Subscription plans do not bill per token/);
    assert.match(GUIDE_JS, /Plan usage is not readable yet\./);
    assert.match(GUIDE_JS, /renderHome\(\)/);
    assert.match(GUIDE_JS, /renderMethods\(\)/);
  });

  it('keeps Details a measured-impact summary with explicit quality and allowance gates', () => {
    assert.match(GUIDE_JS, /5h \/ 7d allowance/);
    assert.match(GUIDE_JS, /Comparison needed/);
    assert.match(GUIDE_JS, /authoritative paired allowance evidence/);
    assert.match(GUIDE_JS, /Billed money is never presented as measured/);
    assert.match(GUIDE_JS, /Token reductions and hook runs do not evaluate correctness/);
    assert.match(GUIDE_JS, /blocked-by-quality/);
  });

  it('never schedules a full overview refresh in the background', () => {
    assert.doesNotMatch(
      GUIDE_JS,
      /setInterval\s*\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{[^}]*\brefresh\s*\(|\brefresh\s*\()/,
    );
    assert.doesNotMatch(GUIDE_JS, /setInterval\(\s*refresh\b/);
    assert.match(GUIDE_JS, /setInterval\([^]*loadActivity\(\)/);
    assert.match(GUIDE_JS, /setInterval\(pollRouting, 15000\)/);
    assert.match(GUIDE_JS, /request\('\/api\/routing'\)/);
    assert.match(GUIDE_JS, /button\.addEventListener\('click', \(\) => changePeriod\(value\)\)/);
  });

  it('bounds recent activity and checks for app updates after the first overview', () => {
    assert.match(GUIDE_JS, /rows\.slice\(0, 8\)/);
    assert.match(GUIDE_CSS, /\.activity-scroll/);
    assert.match(GUIDE_JS, /checkUpdatesOnStartup\(\)/);
    assert.match(GUIDE_JS, /request\('\/api\/update-check', \{ period, background: true \}\)/);
    assert.match(GUIDE_HTML, /id="update-notice"/);
  });

  it('offers mcptoon prerequisite options when the reviewed install is unavailable', () => {
    assert.match(GUIDE_JS, /Install what mcptoon needs/);
    assert.match(GUIDE_JS, /pipx\.pypa\.io\/stable\/installation/);
    assert.match(GUIDE_JS, /docs\.astral\.sh\/uv\/getting-started\/installation/);
    assert.match(GUIDE_JS, /once pipx or uv is available/);
  });

  it('keeps routing configuration and observed hook runs as separate states', () => {
    assert.match(GUIDE_JS, /routing\?\.verificationTier === 'runtime-observed'/);
    assert.match(GUIDE_JS, /routing\?\.enablement === 'untrusted'/);
    assert.match(GUIDE_JS, /open \/hooks in Codex and trust this hook/);
    assert.match(GUIDE_JS, /Configured; waiting for the first hook run after a prompt/);
    assert.match(GUIDE_JS, /On · waiting for first use/);
    assert.match(GUIDE_JS, /routing\.promptSubmissions/);
    assert.match(GUIDE_JS, /routing\.subagentsStarted/);
    assert.match(GUIDE_JS, /routing\.subagentsStopped/);
    assert.match(GUIDE_JS, /request\('\/api\/routing'\)/);
  });

  it('refreshes status after an approved change without adding background polling', () => {
    assert.match(GUIDE_JS, /Refreshing after the approved change…/);
    assert.match(GUIDE_JS, /refreshOverviewAfterMutation/);
    assert.match(GUIDE_JS, /\/api\/overview\?period=.*&refresh=1/);
    assert.doesNotMatch(
      GUIDE_JS,
      /previous state until you choose Refresh|waitForAutomaticRefresh/,
    );
  });
});
