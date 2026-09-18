/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
import { GUIDE_CANDIDATE_CAMPAIGN_JS } from './guided-candidate-campaign-client.js';
import { GUIDE_CANDIDATE_READINESS_JS } from './guided-candidate-readiness-client.js';
import { GUIDE_CAPABILITIES_JS } from './guided-capabilities-client.js';
import { GUIDE_CSS as GUIDE_BASE_CSS } from './guided-dashboard-styles.js';
import { GUIDE_MODAL_GUARD_JS } from './guided-modal-guard-client.js';
import { GUIDE_PRODUCT_JS } from './guided-product-client.js';
import { GUIDE_PRODUCT_CSS } from './guided-product-styles.js';
import { GUIDE_STACK_JS } from './guided-stack-client.js';

export const GUIDE_CSS = `${GUIDE_BASE_CSS}\n${GUIDE_PRODUCT_CSS}`;
export { GUIDE_STACK_JS };
export const GUIDE_JS = `${GUIDE_CAPABILITIES_JS}\n${GUIDE_MODAL_GUARD_JS}\n${GUIDE_PRODUCT_JS}\n${GUIDE_CANDIDATE_CAMPAIGN_JS}\n${GUIDE_CANDIDATE_READINESS_JS}`;

export const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="app-header"><div class="header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true">TH</span><span>Token Harness<small>Use less. Know what changed.</small></span></div>
<nav class="view-tabs" role="tablist" aria-label="Token Harness">
<button id="tab-dashboard" role="tab" aria-selected="true" aria-controls="view-dashboard" data-view="dashboard" type="button">Overview</button>
<button id="tab-results" role="tab" aria-selected="false" aria-controls="view-results" data-view="results" tabindex="-1" type="button">Results</button>
</nav>
<div class="header-tools"><label><span class="sr-only">Appearance</span><select id="theme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button id="refresh" class="secondary" type="button">Refresh</button></div>
</div></header>
<main id="main">
<div class="page-heading"><div><h1 id="view-title">Overview</h1><p id="view-description">Your agents, optimizer status, results summary, and the next useful action.</p></div></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption">Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>

<section id="view-dashboard" role="tabpanel" aria-labelledby="tab-dashboard" tabindex="0">
<section id="dashboard-status" class="dashboard-status"><div><span class="eyebrow">CURRENT STATUS</span><h2>Checking your machine…</h2><p>Finding Claude Code, Codex and optimizer configuration.</p></div><span class="pill">Checking</span></section>

<div class="section-title"><div><h2>At a glance</h2><p>A small summary only. Full measurement details stay in Results.</p></div></div>
<div id="dashboard-metrics" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Measured output</span><strong class="metric-value">Checking…</strong><p class="metric-help">Recorded optimizer output.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only when measured.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured separately from savings.</p></article>
</div>

<div class="dashboard-columns">
<section class="panel"><h2>Current setup</h2><p class="caption">Detected coding agents and optimizers that are already connected.</p><div id="dashboard-active" class="status-list"><p class="empty">Checking…</p></div></section>
<section class="panel"><h2>First-run checklist</h2><p class="caption">If something is incomplete, its action appears beside the affected agent or optimizer below.</p><div id="dashboard-checklist" class="checklist"><p class="empty">Checking…</p></div></section>
</div>

<div class="section-title"><div><h2>Coding agents</h2><p>Token Harness currently works with Claude Code and Codex. A detected agent that needs setup has its Set up button on the same card.</p></div></div>
<div id="setup-agents" class="tool-grid"><article class="tool-card"><h3>Checking agents…</h3></article></div>

<div class="section-title"><div><h2>Recommended optimizers</h2><p>RTK + HarnessTrim are the normal baseline. Each tool shows exactly which agent it is connected to and exposes setup beside the missing connection.</p></div></div>
<div id="baseline-tools" class="tool-grid"><article class="tool-card"><h3>Checking recommended optimizers…</h3></article></div>

<details class="disclosure"><summary>Optional optimizers</summary>
<p class="caption">mcptoon, GitNexus and Headroom are optional. They are not required to complete first-run setup and are configured one tool at a time.</p>
<div id="optional-tools" class="tool-grid"><article class="tool-card"><h3>Checking optional optimizers…</h3></article></div>
</details>

<details class="disclosure"><summary>Agent preferences (advanced)</summary>
<p class="caption">Reasoning preferences are separate from optimizer setup. Change them only when you intentionally want a persistent agent preference.</p>
<div id="agent-tuning" class="tool-grid"><article class="tool-card"><h3>Checking reasoning controls…</h3></article></div>
</details>

<div class="section-title"><div><h2>Maintenance</h2><p>Verify the current setup, install reviewed optimizer updates, or undo the last app change. These are maintenance actions, not additional setup steps.</p></div></div>
<div id="maintenance-actions" class="maintenance-list"><p class="empty">Checking…</p></div>
</section>

<section id="view-results" role="tabpanel" aria-labelledby="tab-results" tabindex="0" hidden>
<div class="results-header"><div><h2>Measured results</h2><p>What Token Harness can actually prove, kept separate from estimates and experimental claims.</p></div><div class="filter-row"><label for="period">Period</label><select id="period"><option value="all">All</option><option value="7d">7 days</option><option value="30d">30 days</option></select><button id="measurement-help" class="secondary" type="button">How measurement works</button></div></div>
<div id="result-summary" class="impact-grid" aria-label="Measured value"><article class="metric-card"><span class="metric-label">Measured output</span><strong class="metric-value">Checking…</strong></article></div>
<div class="section-title"><div><h2>Optimizer evidence</h2><p id="results-period-note">Checking recorded dates…</p></div></div><section class="panel"><div id="result-savings" class="evidence-list"><p class="empty">Checking recorded results…</p></div></section>
<div class="section-title"><div><h2>Experimental benchmark results</h2><p>Candidate evidence is evaluation only; it never promotes a tool automatically.</p></div></div><section class="panel"><div id="candidate-results" class="evidence-list"><p class="empty">Checking candidate evidence…</p></div></section>
<div class="section-title"><div><h2>Recent activity</h2><p>Checks and changes from this local app session.</p></div></div><section class="panel"><div id="activity"><p class="empty">No activity yet.</p></div></section>
</section>

<footer><span>Local data. No account required.</span><span>Full setup refresh runs only when you choose Refresh.</span></footer>
</main>
<dialog id="modal" aria-labelledby="modal-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="modal-title">Review</h2></div><div id="modal-content"></div><div id="modal-error" class="error" role="alert" hidden></div><div id="modal-actions" class="dialog-actions"></div></div></dialog>
<script src="/guide.js" defer></script></body></html>`;
