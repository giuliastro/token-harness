/**
 * Static page shell. Visible text carries data-i18n keys (English source text) and is replaced
 * with the selected language on load; the English text in the markup is the no-script fallback.
 */
import { TOOL_VERSION } from './version.js';

export const GUIDE_SHELL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><title>Token Harness</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main" data-i18n="Skip to content">Skip to content</a>
<header class="app-header"><div class="wrap header-inner">
<div class="brand"><span class="brand-mark" aria-hidden="true"><i></i><i></i><i></i></span><span class="brand-name">Token Harness<small data-i18n="Use less. Do more.">Use less. Do more.</small></span></div>
<nav id="main-tabs" class="view-tabs" role="tablist" aria-label="Main views" data-i18n-aria="Main views">
<button id="tab-home" role="tab" aria-selected="true" aria-controls="view-home" data-view="home" type="button" data-i18n="Home">Home</button>
<button id="tab-methods" role="tab" aria-selected="false" aria-controls="view-methods" data-view="methods" tabindex="-1" type="button" data-i18n="Methods">Methods</button>
<button id="tab-details" role="tab" aria-selected="false" aria-controls="view-details" data-view="details" tabindex="-1" type="button" data-i18n="Details" hidden>Details</button>
</nav>
<div class="header-tools">
<span class="switch-label"><span id="advanced-label" data-i18n="Advanced view">Advanced view</span><button id="advanced-toggle" class="switch accent" type="button" role="switch" aria-checked="false" aria-labelledby="advanced-label"></button></span>
<div class="segmented" role="group" aria-label="Language" data-i18n-aria="Language"><button type="button" data-lang="en" aria-pressed="true">EN</button><button type="button" data-lang="it" aria-pressed="false">IT</button></div>
<label class="theme-select"><span class="sr-only" data-i18n="Appearance">Appearance</span><select id="theme" aria-label="Appearance" data-i18n-aria="Appearance"><option value="system" data-i18n="System">System</option><option value="light" data-i18n="Light">Light</option><option value="dark" data-i18n="Dark">Dark</option></select></label>
<button id="refresh" class="secondary" type="button" data-i18n="Refresh">Refresh</button>
</div>
</div></header>
<main id="main" class="wrap">
<div id="status-line" class="status-line" hidden><span class="read-status" role="status"><span id="reading-spinner" class="spinner" aria-hidden="true"></span><span id="updated">Checking your setup…</span></span><span id="live-status" class="caption" hidden>Nothing changes without your approval</span></div>
<div id="stale-state" class="stale-state" hidden></div><div id="error" class="error" role="alert" hidden></div><div id="notices"></div>
<div id="update-notice" class="update-notice" role="status" hidden></div>

<section id="view-loading" class="loading-screen" aria-live="polite"><div id="loading-root"></div></section>

<section id="view-onboarding" hidden><div id="onboarding-root"></div></section>

<section id="view-home" role="tabpanel" aria-labelledby="tab-home" tabindex="0"><div id="home-root"></div></section>

<section id="view-methods" role="tabpanel" aria-labelledby="tab-methods" tabindex="0" hidden>
<div class="page-head"><h1 data-i18n="Methods">Methods</h1><p data-i18n="Every way Token Harness helps you use less. Turn each one on or off, update it, or read when it helps.">Every way Token Harness helps you use less. Turn each one on or off, update it, or read when it helps.</p></div>
<div id="methods-root"></div>
</section>

<section id="view-details" role="tabpanel" aria-labelledby="tab-details" tabindex="0" hidden>
<div class="page-head"><h1 data-i18n="Details">Details</h1><p data-i18n="Every figure with its source and how it was measured.">Every figure with its source and how it was measured.</p></div>
<div id="details-root"></div>
</section>
<footer class="app-footer"><span data-i18n="Version">Version</span> ${TOOL_VERSION}</footer>
</main>
<dialog id="modal" aria-labelledby="modal-title"><div class="dialog-body"><div class="dialog-heading"><h2 id="modal-title"></h2></div><div id="modal-content"></div><div id="modal-error" class="error" role="alert" hidden></div><div id="modal-actions" class="dialog-actions"></div></div></dialog>
<script src="/guide.js" defer></script></body></html>`;
