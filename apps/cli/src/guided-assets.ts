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
<div class="page-heading"><div><h1 id="view-title">Overview</h1><p id="view-description">Your setup, results and next steps.</p></div></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption">Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>
<div id="update-notice" class="update-notice" role="status" hidden></div>

<section id="view-dashboard" role="tabpanel" aria-labelledby="tab-dashboard" tabindex="0">
<section id="dashboard-status" class="dashboard-status"><div><span class="eyebrow">CURRENT STATUS</span><h2>Checking your machine…</h2><p>Finding Claude Code, Codex, recommended optimizers and measured results.</p></div><span class="pill">Checking</span></section>

<div class="section-title"><div><h2>Measured impact</h2><p>Recorded output, allowance and quality.</p></div><button id="overview-results" class="secondary" type="button">View results</button></div>
<div id="dashboard-metrics" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Recorded output</span><strong class="metric-value">Checking…</strong><p class="metric-help">Recorded optimizer output.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only when measured.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured separately from savings.</p></article>
</div>

<section class="setup-step" id="coding-agents">
<div class="section-title"><div><h2>Coding agents</h2><p>Manage automatic routing for each app.</p></div></div>
<div id="setup-agents" class="tool-grid"><article class="tool-card"><h3>Checking agents…</h3></article></div>
<details class="disclosure advanced-disclosure">
<summary>Agent details &amp; reasoning settings</summary>
<div id="agent-capabilities" class="tool-grid"><article class="tool-card"><h3>Checking agent details…</h3></article></div>
<div class="subsection-heading"><h3>Optional reasoning settings</h3><p class="caption">Persistent agent preferences are separate from optimizer setup.</p></div>
<div id="agent-tuning" class="tool-grid"><article class="tool-card"><h3>Checking reasoning controls…</h3></article></div>
</details>
</section>

<section class="setup-step" id="optimizers">
<div class="section-title"><div><h2>Optimizer setup</h2><p>Connections detected for each app. Setup alone does not prove runtime activity.</p></div></div>
<div id="connection-overview" class="connection-overview"><p class="empty">Checking optimizer connections…</p></div>
</section>

<section class="setup-step" id="maintenance">
<div class="section-title"><div><h2>Health and updates</h2></div></div>
<div id="maintenance-actions" class="maintenance-list"><p class="empty">Checking…</p></div>
</section>
</section>

<section id="view-results" role="tabpanel" aria-labelledby="tab-results" tabindex="0" hidden>
<div class="results-header"><div><h2>Measured impact</h2><p>Each result keeps its source and measurement type.</p></div><div class="filter-row"><label for="period" class="sr-only">Output history period</label><select id="period"><option value="all">All recorded history</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select><button id="manage-comparisons" class="secondary" type="button" data-action="comparisons">Start or finish a comparison</button><button id="record-comparison" class="secondary" type="button">Advanced comparison guide</button><button id="measurement-help" class="secondary" type="button">How to read results</button></div></div>
<div id="result-summary" class="impact-grid" aria-label="Results overview"><article class="metric-card"><span class="metric-label">Measured evidence</span><strong class="metric-value">Checking…</strong></article></div>
<div class="section-title"><div><h2>Evidence</h2><p id="results-period-note">Checking recorded dates…</p></div></div>
<section class="panel evidence-panel">
<div class="evidence-controls">
<div class="evidence-field evidence-search"><label for="evidence-filter">Search evidence</label><input id="evidence-filter" type="search" placeholder="Search sources, apps or measurements" autocomplete="off"></div>
<div class="evidence-field"><label for="evidence-type">Source type</label><select id="evidence-type"><option value="all">All sources</option><option value="optimizer">Optimizers</option><option value="routing">Routing</option><option value="harness">Coding apps</option><option value="measurement">Measurements</option><option value="candidate">Experiments</option></select></div>
<div class="evidence-field"><label for="evidence-sort">Sort by</label><select id="evidence-sort"><option value="evidence">With results first</option><option value="name">Name</option><option value="type">Source type</option></select></div>
</div>
<div class="evidence-list-meta"><p id="evidence-count" class="caption" role="status"></p><button id="evidence-reset" class="text-button" type="button" hidden>Clear filters</button></div>
<ul id="result-evidence" class="result-evidence" aria-label="Evidence by source"><li class="empty">Checking recorded results…</li></ul>
<div id="evidence-empty" class="evidence-empty" hidden><strong>No matching sources</strong><p>Try a different search or clear the filters.</p></div>
</section>
<div class="section-title"><div><h2>Operation history &amp; recovery</h2><p>Retained changes for the current project, including previous app sessions.</p></div><button id="operations-refresh" class="secondary" type="button" data-action="history">Refresh history</button></div>
<section class="panel" aria-label="Operation history"><p id="operations-note" class="caption" role="status">Open Results to read retained operations.</p><div id="operations" class="activity-scroll"><p class="empty">No history loaded yet.</p></div></section>
<div class="section-title"><div><h2>Recent activity</h2><p>Latest checks and changes from this app session.</p></div></div><section class="panel"><div id="activity" class="activity-scroll"><p class="empty">No activity yet.</p></div></section>
</section>

<footer><span>Local data. No account required.</span></footer>
</main>
<dialog id="modal" aria-labelledby="modal-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="modal-title">Review</h2></div><div id="modal-content"></div><div id="modal-error" class="error" role="alert" hidden></div><div id="modal-actions" class="dialog-actions"></div></div></dialog>
<script src="/guide.js" defer></script></body></html>`;
