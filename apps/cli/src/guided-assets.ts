/** Embedded local product UI. No remote assets, inline scripts, or framework runtime. */
export { GUIDE_JS } from './guided-simple-client-entry.js';
export { GUIDE_CSS } from './guided-dashboard-styles.js';
export { GUIDE_STACK_JS } from './guided-stack-client.js';

export const GUIDE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header class="app-header"><div class="header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true">TH</span><span>Token Harness<small>Use less. Know what changed.</small></span></div>
<nav class="view-tabs" role="tablist" aria-label="Workspace">
<button id="tab-overview" role="tab" aria-selected="true" aria-controls="view-overview" data-view="overview" type="button">Monitor</button>
<button id="tab-rules" role="tab" aria-selected="false" aria-controls="view-rules" data-view="rules" tabindex="-1" type="button">Actions</button>
<button id="tab-activity" role="tab" aria-selected="false" aria-controls="view-activity" data-view="activity" tabindex="-1" type="button">Results</button>
</nav>
<div class="header-tools"><label><span class="sr-only">Appearance</span><select id="theme" aria-label="Appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><button id="refresh" class="secondary" type="button">Refresh</button></div>
</div></header>
<main id="main">
<div class="page-heading"><div><h1 id="view-title">Monitor</h1><p id="view-description">See what is working and what you are saving.</p></div></div>
<div class="status-line"><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption">Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>

<section id="view-overview" role="tabpanel" aria-labelledby="tab-overview" tabindex="0">
<div class="hero"><section class="hero-main"><div class="agent-head"><div><h2 id="health-title">Checking…</h2><p id="health-detail">Reading coding agents, optimizers and available evidence.</p></div><span id="monitor-badge" class="pill">Checking</span></div><div class="policy-summary"><strong>Policies</strong><span id="policy-count">Checking…</span></div></section><aside id="next-action" class="next-action"><h2>Recommended</h2><p>Checking your setup…</p></aside></div>

<div class="section-title"><div><h2>What you are getting</h2><p>Only measured or clearly marked results.</p></div></div>
<div id="impact-summary" class="impact-grid" aria-label="Efficiency summary">
<article class="metric-card"><span class="metric-label">Output saved</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured optimizer output.</p></article>
<article class="metric-card"><span class="metric-label">5h / 7d allowance saved</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only when it can be measured.</p></article>
<article class="metric-card"><span class="metric-label">API cost saved</span><strong class="metric-value">Checking…</strong><p class="metric-help">Shown only from billing evidence.</p></article>
<article class="metric-card"><span class="metric-label">Quality</span><strong class="metric-value">Checking…</strong><p class="metric-help">Measured separately from savings.</p></article>
</div>

<div class="section-title"><div><h2>Coding agents</h2><p>The settings that matter right now.</p></div></div>
<div id="agents" class="agent-grid" aria-busy="true"><div class="panel agent loading-card"><h2>Claude Code</h2><p class="caption">Checking…</p></div><div class="panel agent loading-card"><h2>Codex</h2><p class="caption">Checking…</p></div></div>

<details class="disclosure"><summary>Technical details</summary>
<div class="section-title"><div><h2>Optimization stack</h2><p>Installed components and their health.</p></div></div>
<div id="stack" class="agent-grid" aria-busy="true"><div class="panel agent"><h2>Optimization stack</h2><p class="caption">Checking…</p></div></div>
<div class="section-title"><div><h2>Other optimizers</h2><p>Optional candidates that are not active yet.</p></div></div>
<div id="candidates" class="agent-grid"><div class="panel agent"><h2>Candidate catalog</h2><p class="caption">Checking…</p></div></div>
</details>
</section>

<section id="view-rules" role="tabpanel" aria-labelledby="tab-rules" tabindex="0" hidden>
<div class="section-title"><div><h2>Actions</h2><p>Choose an action. You will always review a change before it is applied.</p></div></div>
<div class="agent-grid">
<article class="panel agent"><div class="agent-head"><div><h2>Optimize reasoning</h2><span class="caption">Claude Code or Codex</span></div></div><p>Choose the type of work and review the recommended setting.</p><div class="inline-actions"><button id="optimize-action" type="button" disabled>Optimize</button></div></article>
<article class="panel agent"><div class="agent-head"><div><h2>Set up optimizers</h2><span class="caption">Optimization stack</span></div></div><p>Add or fix supported optimization components.</p><div class="inline-actions"><button id="setup" type="button" disabled>Set up</button></div></article>
<article class="panel agent"><div class="agent-head"><div><h2>Check integrations</h2><span class="caption">Read-only</span></div></div><p>Verify that connected components work correctly.</p><div class="inline-actions"><button id="verify" class="secondary" type="button">Check</button></div></article>
<article class="panel agent"><div class="agent-head"><div><h2>Check updates</h2><span class="caption">Read-only</span></div></div><p>See whether installed optimizers have an update available.</p><div class="inline-actions"><button id="update-check" class="secondary" type="button" disabled>Check</button><button id="undo" class="secondary" type="button" hidden>Undo last change</button></div></article>
</div>
<div class="section-title"><div><h2>More options</h2><p>Fine-tune individual policies only when you need to.</p></div></div>
<div id="rule-filters" class="subtabs" role="tablist" aria-label="Policies by agent"></div><div id="rules" class="rule-list" role="tabpanel" tabindex="0"></div>
</section>

<section id="view-activity" role="tabpanel" aria-labelledby="tab-activity" tabindex="0" hidden>
<div class="section-title"><div><h2>Measured results</h2><p>What Token Harness can actually prove.</p></div><div class="filter-row"><label for="period">Period</label><select id="period"><option value="all">All</option><option value="7d">7 days</option><option value="30d">30 days</option></select><button id="export" class="secondary" type="button" disabled>Export</button></div></div>
<div class="evidence-layout"><section class="panel"><div id="savings" class="evidence-list" aria-busy="true"><p class="empty">Checking recorded results…</p></div><p id="savings-quality" class="quality-note"></p><div class="section-head"><span id="savings-dates" class="caption"></span><button id="measurement-help" class="text-button" type="button">How this is measured</button></div><details class="disclosure"><summary>Measurement limits</summary><p id="savings-note" class="caption"></p></details></section>
<aside class="evidence-explainer">
<div class="truth-card"><strong>Allowance</strong><span>Plan savings appear only when before/after allowance evidence exists.</span></div>
<div class="truth-card"><strong>API cost</strong><span>Money appears only when billed tokens and verified pricing are known.</span></div>
<div class="truth-card"><strong>Quality</strong><span>Quality is reported separately and can block a savings claim.</span></div>
</aside></div>
<div class="section-title"><div><h2>Recent activity</h2><p>Checks and changes from this dashboard session.</p></div></div><div class="panel"><div id="activity"><p class="empty">No activity yet.</p></div></div>
</section>

<footer><span>Local data. No account required.</span><span>Full refresh runs only when you choose Refresh.</span></footer>
</main>
<dialog id="review" aria-labelledby="review-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="review-title">Review</h2></div><div id="review-content"></div>
<div id="task-form" hidden><label for="harness">Agent</label><select id="harness"><option value="claude">Claude Code</option><option value="codex">Codex</option></select><label for="task">Work</label><select id="task"><option value="standard">Normal coding</option><option value="mechanical">Simple edits</option><option value="hard">Complex work</option><option value="critical">Critical work</option></select><p class="caption">You will see the exact change before anything is applied.</p></div>
<div id="review-error" class="error" role="alert" hidden></div><div class="dialog-actions"><button id="close" class="secondary" type="button">Close</button><button id="task-review" type="button" hidden>Review recommendation</button><button id="approve" type="button" hidden>Apply change</button></div></div></dialog>
<script src="/stack.js" defer></script><script src="/guide.js" defer></script></body></html>`;