/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
import { GUIDE_CAPABILITIES_JS } from './guided-capabilities-client.js';
import { GUIDE_CSS as GUIDE_BASE_CSS } from './guided-dashboard-styles.js';
import { GUIDE_PRODUCT_JS } from './guided-product-client.js';
import { GUIDE_PRODUCT_CSS } from './guided-product-styles.js';
import { GUIDE_STACK_JS } from './guided-stack-client.js';

export const GUIDE_CSS = `${GUIDE_BASE_CSS}\n${GUIDE_PRODUCT_CSS}`;
export { GUIDE_STACK_JS };
export const GUIDE_JS = `${GUIDE_CAPABILITIES_JS}\n${GUIDE_PRODUCT_JS}`;

export const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="app-header"><div class="header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true">TH</span><span>Token Harness<small>Use less. Know what changed.</small></span></div>
<nav class="view-tabs" role="tablist" aria-label="Token Harness">
<button id="tab-dashboard" role="tab" aria-selected="true" aria-controls="view-dashboard" data-view="dashboard" type="button">Dashboard</button>
<button id="tab-setup" role="tab" aria-selected="false" aria-controls="view-setup" data-view="setup" tabindex="-1" type="button">Setup</button>
<button id="tab-results" role="tab" aria-selected="false" aria-controls="view-results" data-view="results" tabindex="-1" type="button">Results</button>
</nav>
<div class="header-tools"><label><span class="sr-only">Appearance</span><select id="theme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button id="refresh" class="secondary" type="button">Refresh</button></div>
</div></header>
<main id="main">
<div class="page-heading"><div><h1 id="view-title">Dashboard</h1><p id="view-description">Your coding setup, what is active, and what to do next.</p></div></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption">Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>

<section id="view-dashboard" role="tabpanel" aria-labelledby="tab-dashboard" tabindex="0">
<section id="dashboard-status" class="dashboard-status"><div><span class="eyebrow">SETUP STATUS</span><h2>Checking your machine…</h2><p>Finding Claude Code, Codex, managed optimizers and measured results.</p></div><span class="pill">Checking</span></section>
<div class="section-title"><div><h2>What Token Harness is doing for you</h2><p>Only measured results or explicitly unknown values are shown.</p></div></div>
<div id="dashboard-metrics" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Measured output</span><strong class="metric-value">Checking…</strong><p class="metric-help">Recorded optimizer output.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only when measured.</p></article>
<article class="metric-card"><span class="metric-label">API cost</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only from billing evidence.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured separately from savings.</p></article>
</div>
<div class="dashboard-columns">
<section class="panel"><h2>Active today</h2><p class="caption">Coding agents and managed optimization that Token Harness can actually see.</p><div id="dashboard-active" class="status-list"><p class="empty">Checking…</p></div></section>
<section class="panel"><h2>Getting started</h2><p class="caption">The shortest path from installation to useful measured results.</p><div id="dashboard-checklist" class="checklist"><p class="empty">Checking…</p></div></section>
</div>
</section>

<section id="view-setup" role="tabpanel" aria-labelledby="tab-setup" tabindex="0" hidden>
<div class="setup-intro"><div><h2>Set up Token Harness in order</h2><p>Start with your coding agent and the two managed optimizers. Experimental tools are optional and stay outside the active stack until they earn promotion.</p></div><span class="pill good">Safe previews before changes</span></div>

<section class="setup-step"><div class="step-heading"><span class="step-number">1</span><div><h2>Coding agents</h2><p>Token Harness currently supports guided setup for Claude Code and Codex. The app must be started from an environment where the agent is detectable.</p></div></div><div id="setup-agents" class="tool-grid"><article class="tool-card"><h3>Checking agents…</h3></article></div><div class="subsection-heading"><h3>Agent details</h3><p class="caption">In-session guidance, plan allowance and useful connected-tool checks.</p></div><div id="agent-capabilities" class="tool-grid"><article class="tool-card"><h3>Checking agent details…</h3></article></div></section>

<section class="setup-step"><div class="step-heading"><span class="step-number">2</span><div><h2>Managed optimizers</h2><p>These are the optimizers Token Harness can configure transactionally today: RTK and HarnessTrim. Setup is reviewed before anything is written.</p></div></div><div id="managed-tools" class="tool-grid"><article class="tool-card"><h3>RTK</h3><p>Checking…</p></article><article class="tool-card"><h3>HarnessTrim</h3><p>Checking…</p></article></div><div id="managed-setup-actions" class="managed-action-box"><p>Checking available agents…</p></div><details class="disclosure"><summary>Remove managed changes</summary><p class="caption">Removal is reviewed first. Token Harness removes only changes it owns; provider installations remain user-owned.</p><div id="managed-removal-actions" class="maintenance-list"><p class="caption">Checking managed ownership…</p></div></details></section>

<section class="setup-step"><div class="step-heading"><span class="step-number">3</span><div><h2>Experimental tools</h2><p>Headroom, mcptoon and GitNexus are being evaluated. Token Harness can detect and benchmark them, but does not silently install or activate them.</p></div></div><div id="experimental-tools" class="tool-grid"><article class="tool-card experimental"><h3>Checking experimental tools…</h3></article></div></section>

<section class="setup-step"><div class="step-heading"><span class="step-number">4</span><div><h2>Optional agent tuning</h2><p>Reasoning preferences are separate from optimizer installation. Change them only when you intentionally want a persistent agent preference.</p></div></div><div id="agent-tuning" class="tool-grid"><article class="tool-card"><h3>Checking reasoning controls…</h3></article></div></section>

<section class="setup-step"><div class="step-heading"><span class="step-number">5</span><div><h2>Checks and maintenance</h2><p>Read-only verification and update checks live here. Undo is shown only when this dashboard has an exact transaction it can safely restore.</p></div></div><div id="maintenance-actions" class="maintenance-list"><p class="empty">Checking…</p></div></section>
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
