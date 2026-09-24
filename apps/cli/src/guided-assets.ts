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
<div class="page-heading"><div><h1 id="view-title">Overview</h1><p id="view-description">Your coding agents, optimization stack, health and measured results in one place.</p></div></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption">Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>

<section id="view-dashboard" role="tabpanel" aria-labelledby="tab-dashboard" tabindex="0">
<section id="dashboard-status" class="dashboard-status"><div><span class="eyebrow">CURRENT STATUS</span><h2>Checking your machine…</h2><p>Finding Claude Code, Codex, recommended optimizers and measured results.</p></div><span class="pill">Checking</span></section>

<div class="section-title"><div><h2>Measured impact</h2><p>A summary of what Token Harness can actually prove. Open Results for the detailed evidence.</p></div></div>
<div id="dashboard-metrics" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Measured output</span><strong class="metric-value">Checking…</strong><p class="metric-help">Recorded optimizer output.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only when measured.</p></article>
<article class="metric-card"><span class="metric-label">API cost</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only from billing evidence.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured separately from savings.</p></article>
</div>

<section class="setup-step" id="coding-agents">
<div class="section-title"><div><h2>Coding agents</h2><p>Detected coding apps are shown here as status. Optimizer setup is managed centrally below; a detected setup does not prove that it ran or recorded results.</p></div></div>
<div id="setup-agents" class="tool-grid"><article class="tool-card"><h3>Checking agents…</h3></article></div>
<details class="disclosure advanced-disclosure">
<summary>Agent details and optional reasoning settings</summary>
<p class="caption">Allowance, tool observations and reasoning preferences are advanced information. They are not required to finish optimizer setup.</p>
<div id="agent-capabilities" class="tool-grid"><article class="tool-card"><h3>Checking agent details…</h3></article></div>
<div class="subsection-heading"><h3>Optional reasoning settings</h3><p class="caption">Persistent agent preferences are separate from optimizer setup.</p></div>
<div id="agent-tuning" class="tool-grid"><article class="tool-card"><h3>Checking reasoning controls…</h3></article></div>
</details>
</section>

<section class="setup-step" id="optimizers">
<div class="section-title"><div><h2>Optimizer setup</h2><p>This matrix shows which optimizer setup Token Harness detected for each coding app. It does not confirm runtime activity; measured results appear separately when evidence is recorded.</p></div></div>
<div id="connection-overview" class="connection-overview"><p class="empty">Checking optimizer connections…</p></div>
<details class="disclosure"><summary>Remove Token Harness-managed configuration</summary><p class="caption">Removal is reviewed first. Token Harness removes only configuration it owns; installed provider software and user-owned configuration may remain.</p><div id="managed-removal-actions" class="maintenance-list"><p class="caption">Checking managed ownership…</p></div></details>
</section>

<section class="setup-step" id="maintenance">
<div class="section-title"><div><h2>Health and updates</h2><p>These are maintenance actions, not onboarding steps. Setup already performs its own safety checks.</p></div></div>
<div id="maintenance-actions" class="maintenance-list"><p class="empty">Checking…</p></div>
</section>
</section>

<section id="view-results" role="tabpanel" aria-labelledby="tab-results" tabindex="0" hidden>
<div class="results-header"><div><h2>Results dashboard</h2><p>See which optimizer setups Token Harness found and which results it actually recorded for each coding app.</p></div><div class="filter-row"><label for="period">Period</label><select id="period"><option value="all">All</option><option value="7d">7 days</option><option value="30d">30 days</option></select><button id="measurement-help" class="secondary" type="button">How results are recorded</button></div></div>
<div id="result-summary" class="impact-grid" aria-label="Results overview"><article class="metric-card"><span class="metric-label">Optimization stack</span><strong class="metric-value">Checking…</strong></article></div>
<div class="section-title"><div><h2>By optimizer</h2><p>Detected setup and recorded results for every optimizer in the stack.</p></div></div>
<div id="result-optimizers" class="tool-grid"><article class="tool-card"><h3>Checking optimizer results…</h3></article></div>
<div class="section-title"><div><h2>By coding agent</h2><p>Which optimizer setups were detected for each app and which measured results can be linked to it.</p></div></div>
<div id="result-agents" class="tool-grid"><article class="tool-card"><h3>Checking results by coding app…</h3></article></div>
<div class="section-title"><div><h2>Measurement evidence</h2><p id="results-period-note">Checking recorded dates…</p></div></div><section class="panel"><div id="result-savings" class="evidence-list"><p class="empty">Checking recorded results…</p></div></section>
<div class="section-title"><div><h2>Experimental benchmark results</h2><p>Candidate evidence is evaluation only; it never promotes a tool automatically.</p></div></div><section class="panel"><div id="candidate-results" class="evidence-list"><p class="empty">Checking candidate evidence…</p></div></section>
<div class="section-title"><div><h2>Recent activity</h2><p>Checks and changes from this local app session.</p></div></div><section class="panel"><div id="activity"><p class="empty">No activity yet.</p></div></section>
</section>

<footer><span>Local data. No account required.</span><span>Full overview refresh runs only when you choose Refresh.</span></footer>
</main>
<dialog id="modal" aria-labelledby="modal-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="modal-title">Review</h2></div><div id="modal-content"></div><div id="modal-error" class="error" role="alert" hidden></div><div id="modal-actions" class="dialog-actions"></div></div></dialog>
<script src="/guide.js" defer></script></body></html>`;
