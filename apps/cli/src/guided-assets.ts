/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
export { GUIDE_JS } from './guided-dashboard-client.js';
export { GUIDE_CSS } from './guided-dashboard-styles.js';
export { GUIDE_STACK_JS } from './guided-stack-client.js';

export const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness | Efficiency</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="app-header"><div class="header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true">TH</span><span>Token Harness<small>Make your coding allowance go further</small></span></div>
<nav class="view-tabs" role="tablist" aria-label="Workspace">
<button id="tab-overview" role="tab" aria-selected="true" aria-controls="view-overview" data-view="overview" type="button">Dashboard</button>
<button id="tab-rules" role="tab" aria-selected="false" aria-controls="view-rules" data-view="rules" tabindex="-1" type="button">Policies</button>
<button id="tab-activity" role="tab" aria-selected="false" aria-controls="view-activity" data-view="activity" tabindex="-1" type="button">Evidence</button>
</nav>
<div class="header-tools"><label><span class="sr-only">Appearance</span><select id="theme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button id="refresh" class="secondary" type="button">Refresh data</button></div>
</div></header>
<main id="main">
<div class="page-heading"><div><h1 id="view-title">Dashboard</h1><p id="view-description">What Token Harness is doing for you, what is measured, and what to do next.</p></div><button id="setup" type="button" disabled>Review setup</button></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Connecting to this local app...</span></span><span id="live-status" class="caption">No changes run in the background</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>

<section id="view-overview" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
<div class="hero"><section class="hero-main"><h2>Save coding allowance without guessing</h2><p>Token Harness applies reviewed efficiency policies, records the evidence it can actually measure, and keeps difficult work above its quality floor.</p><div class="policy-summary"><strong>Policies</strong><span id="policy-count">Reading current policies…</span></div></section><aside id="next-action" class="next-action"><h2>What to do next</h2><p>Reading your current setup…</p></aside></div>
<div id="impact-summary" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Recorded output</span><strong class="metric-value">Reading…</strong><p class="metric-help">Measured evidence from configured optimizers.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance saved</span><strong class="metric-value">Reading…</strong><p class="metric-help">Shown only when paired allowance evidence exists.</p></article>
<article class="metric-card"><span class="metric-label">API cost saved</span><strong class="metric-value">Reading…</strong><p class="metric-help">Shown only from billed-token evidence and a verified price basis.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Reading…</strong><p class="metric-help">Guardrails and paired quality evidence are reported separately.</p></article>
</div>
<div class="section-title"><div><h2>Your optimization stack</h2><p>The components that actually make up your current efficiency stack. Installed, verified, measured and health state stay separate so a configured tool is never mistaken for a proven result.</p></div></div>
<div id="stack" class="agent-grid" aria-busy="true"><div class="panel agent loading-card"><h2>Optimization stack</h2><p class="caption">Checking installed components, verification and attributable evidence…</p></div></div>
<div class="section-title"><div><h2>Your coding agents</h2><p>Only the settings that affect efficiency and allowance are shown here. Open details when you need the technical explanation.</p></div></div>
<div id="agents" class="agent-grid" aria-busy="true"><div class="panel agent loading-card"><h2>Claude Code</h2><p class="caption">Checking optimizer, reasoning and allowance…</p></div><div class="panel agent loading-card"><h2>Codex</h2><p class="caption">Checking optimizer, reasoning and allowance…</p></div></div>
</section>

<section id="view-rules" role="tabpanel" aria-labelledby="tab-rules" tabindex="0" hidden>
<div class="section-title"><div><h2>Efficiency policies</h2><p>See what is active, what can be enabled, why it matters, and the trade-off before changing anything.</p></div></div>
<div id="rule-filters" class="subtabs" role="tablist" aria-label="Policies by agent"></div><div id="rules" class="rule-list" role="tabpanel" tabindex="0"></div>
</section>

<section id="view-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0" hidden>
<div class="section-title"><div><h2>Measured impact</h2><p>Evidence first. Token Harness does not convert local output reduction into plan minutes, API money or quality claims unless the necessary evidence exists.</p></div><div class="filter-row"><label for="period">Period</label><select id="period"><option value="all">All history</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><button id="export" class="secondary" type="button" disabled>Export evidence</button></div></div>
<div class="evidence-layout"><section class="panel"><div id="savings" class="evidence-list" aria-busy="true"><p class="empty">Reading recorded optimizer evidence…</p></div><p id="savings-quality" class="quality-note"></p><div class="section-head"><span id="savings-dates" class="caption"></span><button id="measurement-help" class="text-button" type="button">How measurements work</button></div><details class="disclosure"><summary>Measurement limits</summary><p id="savings-note" class="caption"></p></details></section>
<aside class="evidence-explainer">
<div class="truth-card"><strong>Allowance / time</strong><span>Current 5-hour or weekly balance is not the same thing as allowance saved. Minutes or credits appear only after a comparable before/after allowance measurement.</span></div>
<div class="truth-card"><strong>API cost</strong><span>Token reduction becomes money only when billed input/output tokens and a verified model price are known for the same traffic.</span></div>
<div class="truth-card"><strong>Quality</strong><span>Reasoning floors protect difficult work, but “no quality loss” is claimed only from paired task outcomes, retries and errors.</span></div>
</aside></div>
<div class="section-title"><div><h2>Checks and changes</h2><p>This dashboard session only. Verification is read-only; changes always require a preview and approval.</p></div><div class="inline-actions"><button id="verify" class="secondary" type="button">Check integrations</button><button id="undo" class="secondary" type="button" hidden>Undo last change</button></div></div><div class="panel"><div id="activity"><p class="empty">No checks or changes in this dashboard session.</p></div></div>
</section>

<footer><span>Local data. No account required.</span><span>Full data refresh happens only when you ask for it.</span></footer>
</main>
<dialog id="review" aria-labelledby="review-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="review-title">Review changes</h2></div><div id="review-content"></div>
<div id="task-form" hidden><label for="harness">Coding agent</label><select id="harness"><option value="claude">Claude Code</option><option value="codex">Codex</option></select><label for="task">Type of work</label><select id="task"><option value="standard">Everyday coding</option><option value="mechanical">Simple edits and formatting</option><option value="hard">Complex debugging or implementation</option><option value="critical">Critical architecture or review</option></select><p class="caption">The exact saved reasoning preference is previewed before approval. Difficult work keeps its minimum quality floor.</p></div>
<div id="review-error" class="error" role="alert" hidden></div><div class="dialog-actions"><button id="close" class="secondary" type="button">Close</button><button id="task-review" type="button" hidden>Preview change</button><button id="approve" type="button" hidden>Approve and apply</button></div></div></dialog>
<script src="/stack.js" defer></script><script src="/guide.js" defer></script></body></html>`;