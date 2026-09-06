/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
export { GUIDE_JS } from './guided-client.js';
export { GUIDE_CSS } from './guided-styles.js';

export const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness | Efficiency</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="app-header"><div class="header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true">TH</span><span>Token Harness<small>Local efficiency</small></span></div>
<nav class="view-tabs" role="tablist" aria-label="Workspace">
<button id="tab-overview" role="tab" aria-selected="true" aria-controls="view-overview" data-view="overview" type="button">Overview</button>
<button id="tab-rules" role="tab" aria-selected="false" aria-controls="view-rules" data-view="rules" tabindex="-1" type="button">Rules &amp; settings</button>
<button id="tab-activity" role="tab" aria-selected="false" aria-controls="view-activity" data-view="activity" tabindex="-1" type="button">Activity</button>
</nav>
<div class="header-tools"><label class="theme-label"><span class="sr-only">Appearance</span><select id="theme" aria-label="Appearance"><option value="system">System theme</option><option value="light">Light theme</option><option value="dark">Dark theme</option></select></label><button id="refresh" class="secondary" type="button">Refresh</button></div>
</div></header>
<main id="main">
<div class="page-heading"><div><h1 id="view-title">Overview</h1><p id="view-description">Your agents and recorded results, in one place.</p></div>
<button id="setup" type="button" disabled>Check setup</button></div>
<div class="status-line"><span id="updated" role="status">Checking this device...</span><span id="live-status" class="caption">Changes always need approval</span></div>
<div id="error" class="error" role="alert" hidden></div>
<div id="notices"></div>
<section id="view-overview" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
<div id="agents" class="agent-grid" aria-busy="true"><div class="panel skeleton" aria-hidden="true"></div><div class="panel skeleton" aria-hidden="true"></div></div>
<p class="context-note">Keep using Claude or Codex normally. Closing this page does not disable configured integrations.</p>
<section class="panel savings-panel" aria-labelledby="savings-title"><div class="section-head"><div><h2 id="savings-title">Recorded savings</h2><p class="caption">Output removed from readable local records. Not extra subscription allowance.</p></div><div class="inline-actions"><label><span class="sr-only">Savings period</span><select id="period"><option value="all">All recorded history</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label><button id="export" class="secondary" type="button" disabled>Save report</button></div></div>
<div id="savings" aria-busy="true"><p class="empty">Reading measurement records...</p></div>
<div class="savings-footer"><span id="savings-dates" class="caption"></span><button id="measurement-help" class="text-button" type="button">How measurements work</button></div>
<details class="disclosure" id="measurement-details"><summary>Measurement details</summary><p id="savings-note" class="caption"></p></details>
</section>
</section>
<section id="view-rules" role="tabpanel" aria-labelledby="tab-rules" tabindex="0" hidden>
<div id="rule-filters" class="subtabs" role="tablist" aria-label="Rules by agent"></div>
<div id="rules" class="rule-list" role="tabpanel" tabindex="0"></div>
</section>
<section id="view-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0" hidden>
<div class="panel"><div class="section-head"><div><h2>Checks and changes</h2><p class="caption">Activity from this dashboard session. No changes run in the background.</p></div><div class="inline-actions"><button id="verify" class="secondary" type="button">Check integrations</button><button id="undo" class="secondary" type="button" hidden>Undo last change</button></div></div>
<div id="activity"><p class="empty">No checks or changes yet. Check integrations to verify the detected setup without modifying it.</p></div></div>
</section>
<footer><span>Local data. No account required.</span><span id="footer-state">Settings are only changed after a reviewed approval.</span></footer>
</main>
<dialog id="review" aria-labelledby="review-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="review-title">Review changes</h2><span id="dialog-status" class="caption" role="status"></span></div><div id="review-content"></div>
<div id="task-form" hidden><label for="harness">Coding agent</label><select id="harness"><option value="claude">Claude Code</option><option value="codex">Codex</option></select><label for="task">Type of work</label><select id="task"><option value="standard">Everyday coding</option><option value="mechanical">Simple edits and formatting</option><option value="hard">Complex debugging or implementation</option><option value="critical">Critical architecture or review</option></select><p class="notice">This saves a preference for future sessions until you change it again. It is not automatic per-task routing.</p></div>
<div id="review-error" class="error" role="alert" hidden></div><div class="dialog-actions"><button id="close" class="secondary" type="button">Close</button><button id="task-review" type="button" hidden>Preview change</button><button id="approve" type="button" hidden>Approve and apply</button></div></div></dialog>
<div id="announcement" class="sr-only" role="status" aria-live="polite"></div>
<script src="/guide.js" defer></script></body></html>`;
