/** Dependency-free local dashboard model, assets, and argument parser. */

import type { BudgetReport, DoctorReport, OptimizeReport, StatusReport } from '@token-harness/core';

export interface UiOptions {
  help: boolean;
  json: boolean;
  open: boolean;
  port: number;
}

export type UiParseResult = { ok: true; options: UiOptions } | { ok: false; message: string };

export function parseUiArgs(argv: readonly string[]): UiParseResult {
  const options: UiOptions = { help: false, json: false, open: true, port: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    if (token === '--help') options.help = true;
    else if (token === '--json') options.json = true;
    else if (token === '--no-open') options.open = false;
    else if (token === '--port') {
      const raw = argv[index + 1];
      const port = Number(raw);
      if (raw === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
        return { ok: false, message: '--port requires an integer from 1 to 65535' };
      }
      options.port = port;
      index += 1;
    } else {
      return { ok: false, message: `Unknown ui option ${JSON.stringify(token)}` };
    }
  }
  return { ok: true, options };
}

export const UI_USAGE = `token-harness ui — open the local status and guidance dashboard

Usage
  token-harness ui [--no-open] [--port <number>] [--json]

The dashboard listens only on 127.0.0.1 and is read-only. It does not send data
anywhere and cannot change configuration. It shows what is active, what needs attention,
and what to do next. When the setup is ready, keep using Claude Code, Codex, or OpenCode
normally — Token Harness does not replace their launch commands. Close the local dashboard
server with Ctrl+C.`;

export interface DashboardWindow {
  label: string;
  remainingPercent: number | null;
  resetsAt: string | null;
  confidence: string;
}

export type DashboardHealth = 'active' | 'limited' | 'attention';

export interface DashboardHarness {
  id: string;
  name: string;
  health: DashboardHealth;
  statusLabel: string;
  version: string | null;
  providers: string[];
  allowance: DashboardWindow[];
}

export interface DashboardModel {
  generatedAt: string;
  state: 'ready' | 'limited' | 'setup-needed' | 'action-needed';
  statusLabel: string;
  headline: string;
  summary: string;
  harnesses: DashboardHarness[];
  otherHarnesses: { name: string; version: string | null }[];
  providers: { id: string; name: string; harnesses: string[] }[];
  recommendation: { action: string; reason: string | null } | null;
  nextStep: { command: string | null; title: string; description: string };
}

function nameOf(id: string): string {
  if (id === 'claude') return 'Claude Code';
  if (id === 'codex') return 'Codex';
  if (id === 'opencode') return 'OpenCode';
  if (id === 'pi') return 'Pi';
  if (id === 'hermes') return 'Hermes';
  return id;
}

function providerName(id: string): string {
  if (id === 'harnesstrim') return 'HarnessTrim';
  if (id === 'rtk') return 'RTK';
  return id;
}

function usefulReason(evidence: readonly { summary: string }[]): string | null {
  const useful = evidence.find(
    (item) =>
      !/^0B known loaded of /i.test(item.summary) &&
      !/^0 MCP servers/i.test(item.summary) &&
      !/^0B of instruction candidates/i.test(item.summary),
  );
  return useful?.summary ?? evidence[0]?.summary ?? null;
}

export function buildDashboardModel(input: {
  generatedAt: string;
  doctor: DoctorReport;
  status: StatusReport;
  budget: BudgetReport;
  optimize: OptimizeReport;
}): DashboardModel {
  const present = input.doctor.harnesses.filter((item) => item.state !== 'absent');
  const connectedProviders = input.doctor.providers.filter(
    (item) => item.configuredHarnesses.length > 0,
  );
  const configuredProviders = connectedProviders.filter((item) => item.state === 'configured');

  // The primary dashboard is about the setup the user is actually using. A secondary detected
  // harness (for example Pi or Hermes) must not downgrade the whole product merely because its
  // version is newer than Token Harness has tested. It becomes primary only when it is wired to an
  // active provider, exposes an allowance window, or participates in a live status pipeline.
  const relevantHarnessIds = new Set<string>();
  for (const provider of connectedProviders) {
    for (const harness of provider.configuredHarnesses) relevantHarnessIds.add(harness);
  }
  for (const item of input.budget.harnesses) {
    if (item.windows.length > 0) relevantHarnessIds.add(item.harnessId);
  }
  for (const pipeline of input.status.pipelines) relevantHarnessIds.add(pipeline.harness);

  const relevantHarnesses = present.filter((harness) => relevantHarnessIds.has(harness.harnessId));
  const broken =
    relevantHarnesses.some((item) => item.state === 'broken') ||
    connectedProviders.some((item) => item.state === 'broken');
  const newerThanTested =
    relevantHarnesses.some((item) => item.versionVerdict === 'unknown-newer') ||
    connectedProviders.some((item) => item.versionVerdict === 'unknown-newer');

  const state: DashboardModel['state'] =
    present.length === 0
      ? 'setup-needed'
      : broken || input.status.problemCount > 0
        ? 'action-needed'
        : configuredProviders.length === 0
          ? 'setup-needed'
          : newerThanTested
            ? 'limited'
            : 'ready';

  const rankedRecommendations = input.optimize.harnesses
    .filter((harness) => harness.state !== 'absent' && relevantHarnessIds.has(harness.harnessId))
    .flatMap((harness) =>
      harness.recommendations.map((item) => ({
        harness: harness.harnessId,
        priority: item.priority,
        action: item.action,
        reason: usefulReason(item.evidence),
      })),
    )
    .sort((left, right) => {
      const rank = { first: 0, next: 1, optional: 2 } as const;
      return rank[left.priority] - rank[right.priority];
    });
  const recommendation = rankedRecommendations.find((item) => item.priority !== 'optional');

  const harnesses: DashboardHarness[] = relevantHarnesses.map((harness) => {
    const providerIds = configuredProviders
      .filter((provider) => provider.configuredHarnesses.includes(harness.harnessId))
      .map((provider) => provider.providerId);
    const budget = input.budget.harnesses.find((item) => item.harnessId === harness.harnessId);
    const health: DashboardHealth =
      harness.state === 'broken'
        ? 'attention'
        : harness.versionVerdict === 'unknown-newer'
          ? 'limited'
          : 'active';
    const statusLabel =
      health === 'attention'
        ? 'Needs attention'
        : health === 'limited'
          ? 'Works · newer than tested'
          : providerIds.length > 0
            ? 'Optimized'
            : 'Available';
    return {
      id: harness.harnessId,
      name: nameOf(harness.harnessId),
      health,
      statusLabel,
      version: harness.version,
      providers: providerIds.map(providerName),
      allowance: (budget?.windows ?? []).map((window) => ({
        label: window.bucketName ?? window.scope,
        remainingPercent: window.remainingPercent,
        resetsAt: window.resetsAt,
        confidence: window.confidence,
      })),
    };
  });

  const otherHarnesses = present
    .filter((harness) => !relevantHarnessIds.has(harness.harnessId))
    .map((harness) => ({ name: nameOf(harness.harnessId), version: harness.version }));

  const providers = configuredProviders.map((provider) => ({
    id: provider.providerId,
    name: providerName(provider.providerId),
    harnesses: provider.configuredHarnesses.map(nameOf),
  }));

  const copy =
    state === 'ready'
      ? {
          statusLabel: 'READY',
          headline: 'Everything important is connected.',
          summary:
            'Token Harness is already active through your configured integrations. This dashboard is for status and guidance; it is not a launcher.',
          nextStep: {
            command: null,
            title: 'Use your coding agent normally',
            description:
              'Open Claude Code, Codex, or OpenCode exactly as you normally do. RTK and HarnessTrim run automatically where they are configured.',
          },
        }
      : state === 'limited'
        ? {
            statusLabel: 'READY WITH LIMITATIONS',
            headline: 'You can keep working.',
            summary:
              'An active integration uses a version newer than the tested range. Token Harness will keep working read-only and stay conservative about changes.',
            nextStep: {
              command: 'token-harness verify',
              title: 'Verify the active integrations',
              description:
                'Keep using your coding agents normally. Run this check when you want evidence that the configured interception still works.',
            },
          }
        : state === 'action-needed'
          ? {
              statusLabel: 'ACTION NEEDED',
              headline: 'One active integration needs attention.',
              summary:
                'Do not change providers yet. Review the live pipeline or configuration issue first; your other working integrations can remain untouched.',
              nextStep: {
                command:
                  input.status.problemCount > 0
                    ? 'token-harness status --verbose'
                    : 'token-harness doctor --verbose',
                title: 'Review the specific problem',
                description:
                  'The detailed command is only for the integration that needs attention. It is not part of the normal daily workflow.',
              },
            }
          : {
              statusLabel: 'SETUP NEEDED',
              headline: 'Finish the one-time setup.',
              summary:
                'A supported coding agent was not found with an active optimization provider yet.',
              nextStep: {
                command: 'token-harness setup',
                title: 'Continue guided setup',
                description:
                  'Token Harness will detect what is available and propose only supported changes.',
              },
            };

  return {
    generatedAt: input.generatedAt,
    state,
    statusLabel: copy.statusLabel,
    headline: copy.headline,
    summary: copy.summary,
    harnesses,
    otherHarnesses,
    providers,
    recommendation:
      recommendation === undefined
        ? null
        : {
            action: `${nameOf(recommendation.harness)}: ${recommendation.action}`,
            reason: recommendation.reason,
          },
    nextStep: copy.nextStep,
  };
}

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Token Harness</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <a class="skip" href="#main">Skip to dashboard</a>
  <header class="topbar">
    <div class="brand"><span class="mark" aria-hidden="true">TH</span><span>Token Harness</span></div>
    <button id="refresh" class="secondary-button" type="button">Refresh</button>
  </header>
  <main id="main">
    <section class="hero" aria-labelledby="headline">
      <div id="status" class="status-chip">CHECKING</div>
      <h1 id="headline">Checking your setup...</h1>
      <p id="summary" class="hero-copy">Reading local status and guidance.</p>
      <p id="updated" class="timestamp" aria-live="polite"></p>
    </section>

    <section class="action-card" aria-labelledby="next-title">
      <div class="action-copy">
        <p class="eyebrow">WHAT TO DO NOW</p>
        <h2 id="next-title">Checking the next step...</h2>
        <p id="description" class="supporting"></p>
      </div>
      <div id="command-row" class="command-row" hidden>
        <code id="command"></code>
        <button id="copy" class="primary-button" type="button">Copy command</button>
      </div>
    </section>

    <section class="section" aria-labelledby="active-title">
      <div class="section-heading">
        <div><p class="eyebrow">ACTIVE SETUP</p><h2 id="active-title">What is working</h2></div>
        <p class="section-note">Only active or relevant tools are shown here.</p>
      </div>
      <div id="harnesses" class="harness-grid" aria-live="polite"></div>
    </section>

    <section id="recommendation-panel" class="recommendation-card" aria-labelledby="recommendation-title" hidden>
      <p class="eyebrow">USEFUL NOW</p>
      <h2 id="recommendation-title">Recommendation</h2>
      <p id="recommendation" class="recommendation-action"></p>
      <p id="reason" class="supporting"></p>
    </section>

    <section id="providers-panel" class="compact-panel" aria-labelledby="providers-title" hidden>
      <div><p class="eyebrow">ACTIVE OPTIMIZERS</p><h2 id="providers-title">Providers</h2></div>
      <ul id="providers" class="provider-list"></ul>
    </section>

    <details id="other-panel" class="details-panel" hidden>
      <summary id="other-summary">Other detected tools</summary>
      <ul id="other-harnesses" class="secondary-list"></ul>
    </details>

    <p id="error" class="error" role="alert"></p>
  </main>
  <footer>
    <strong>Local and read-only.</strong> You can close this page whenever you want. Configured optimizers keep working through their normal harness integrations.
  </footer>
  <script src="/app.js" defer></script>
</body>
</html>`;

export const DASHBOARD_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;font-synthesis:none;--bg:#f6f8fb;--surface:#ffffff;--surface-2:#f1f5f9;--text:#111827;--muted:#5b6472;--subtle:#7b8492;--border:#dce2ea;--accent:#0f766e;--accent-strong:#115e59;--accent-soft:#ccfbf1;--warning:#92400e;--warning-soft:#fef3c7;--danger:#b42318;--danger-soft:#fee4e2;--shadow:0 14px 34px rgba(15,23,42,.08);--focus:#2563eb}*{box-sizing:border-box}html{background:var(--bg)}body{margin:0;min-height:100vh;background:linear-gradient(180deg,rgba(15,118,110,.045),transparent 240px),var(--bg);color:var(--text);font-size:16px;line-height:1.5}button{font:inherit}button:focus-visible,a:focus-visible,summary:focus-visible{outline:3px solid var(--focus);outline-offset:3px}.skip{position:absolute;left:-999px;top:1rem;z-index:10;background:var(--text);color:var(--surface);padding:.6rem .8rem;border-radius:8px}.skip:focus{left:1rem}.topbar,main,footer{width:min(1040px,calc(100% - 32px));margin-inline:auto}.topbar{height:68px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border)}.brand{display:flex;align-items:center;gap:.7rem;font-weight:800;letter-spacing:-.01em}.mark{display:grid;place-items:center;width:36px;height:36px;border-radius:10px;background:var(--accent);color:#fff;font:800 13px ui-monospace,SFMono-Regular,Consolas,monospace}.secondary-button,.primary-button{min-height:44px;border-radius:10px;padding:0 1rem;font-weight:750;cursor:pointer}.secondary-button{border:1px solid var(--border);background:var(--surface);color:var(--text)}.secondary-button:hover{background:var(--surface-2)}.primary-button{border:1px solid var(--accent-strong);background:var(--accent);color:#fff}.primary-button:hover{background:var(--accent-strong)}button:disabled{cursor:wait;opacity:.62}.hero{padding:54px 0 28px;max-width:780px}.status-chip{display:inline-flex;align-items:center;min-height:28px;padding:0 .65rem;border-radius:999px;background:var(--accent-soft);color:var(--accent-strong);font-size:.76rem;font-weight:850;letter-spacing:.08em}.status-chip.limited{background:var(--warning-soft);color:var(--warning)}.status-chip.action-needed{background:var(--danger-soft);color:var(--danger)}.status-chip.setup-needed{background:var(--surface-2);color:var(--muted)}.hero h1{margin:14px 0 10px;font-size:clamp(2.05rem,5vw,3.65rem);line-height:1.04;letter-spacing:-.045em}.hero-copy{margin:0;max-width:720px;color:var(--muted);font-size:1.08rem}.timestamp{margin:12px 0 0;color:var(--subtle);font-size:.82rem}.action-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:24px;border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border));border-radius:18px;background:var(--surface);box-shadow:var(--shadow)}.eyebrow{margin:0 0 6px;color:var(--accent-strong);font-size:.72rem;font-weight:850;letter-spacing:.11em}.action-card h2,.section h2,.recommendation-card h2,.compact-panel h2{margin:0;font-size:1.18rem;letter-spacing:-.015em}.supporting{margin:7px 0 0;color:var(--muted)}.command-row{display:flex;align-items:center;gap:10px;max-width:100%}.command-row code{display:block;max-width:440px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;background:var(--surface-2);color:var(--text);font:650 .88rem ui-monospace,SFMono-Regular,Consolas,monospace;overflow-wrap:anywhere}.section{padding-top:34px}.section-heading{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:14px}.section-note{margin:0;color:var(--subtle);font-size:.86rem}.harness-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:12px}.harness-card{min-width:0;padding:18px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}.harness-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.harness-card h3{margin:0;font-size:1.06rem}.health{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;color:var(--accent-strong);font-size:.76rem;font-weight:800}.health::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--accent)}.health.limited{color:var(--warning)}.health.limited::before{background:var(--warning)}.health.attention{color:var(--danger)}.health.attention::before{background:var(--danger)}.harness-meta{margin:5px 0 0;color:var(--muted);font-size:.86rem}.provider-line{margin:13px 0 0;font-size:.9rem}.provider-line strong{font-weight:800}.allowance{margin-top:16px;padding-top:14px;border-top:1px solid var(--border)}.quota{margin-top:12px}.quota:first-child{margin-top:0}.quota-row{display:flex;justify-content:space-between;gap:16px;margin-bottom:6px;font-size:.88rem}.quota-row strong{font-variant-numeric:tabular-nums}.track{height:7px;border-radius:999px;background:var(--surface-2);overflow:hidden}.fill{height:100%;border-radius:inherit;background:var(--accent)}.quota-meta{margin:5px 0 0;color:var(--subtle);font-size:.76rem}.no-allowance{margin:14px 0 0;color:var(--subtle);font-size:.82rem}.recommendation-card,.compact-panel,.details-panel{margin-top:14px;border:1px solid var(--border);border-radius:16px;background:var(--surface)}.recommendation-card{padding:20px}.recommendation-action{margin:9px 0 0;font-weight:760}.compact-panel{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:16px 18px}.provider-list,.secondary-list{margin:0;padding:0;list-style:none}.provider-list{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.provider-list li{padding:7px 9px;border:1px solid var(--border);border-radius:9px;background:var(--surface-2);font-size:.82rem}.details-panel{padding:0 16px}.details-panel summary{min-height:48px;display:flex;align-items:center;cursor:pointer;color:var(--muted);font-weight:750}.secondary-list{padding:0 0 14px}.secondary-list li{padding:7px 0;border-top:1px solid var(--border);color:var(--muted);font-size:.86rem}.error{color:var(--danger);font-weight:700}footer{padding:28px 0 42px;color:var(--subtle);font-size:.82rem}footer strong{color:var(--muted)}[hidden]{display:none!important}@media(prefers-color-scheme:dark){:root{--bg:#0b1118;--surface:#111923;--surface-2:#17212d;--text:#f3f6fa;--muted:#b2bdc9;--subtle:#8996a4;--border:#273443;--accent:#2dd4bf;--accent-strong:#99f6e4;--accent-soft:#123d39;--warning:#fbbf24;--warning-soft:#422f12;--danger:#ff8a80;--danger-soft:#44201f;--shadow:0 16px 38px rgba(0,0,0,.22);--focus:#60a5fa}.primary-button{color:#062a27}.mark{color:#062a27}.action-card{border-color:#28514d}}@media(max-width:760px){.topbar,main,footer{width:min(100% - 24px,1040px)}.hero{padding:38px 0 22px}.action-card{grid-template-columns:1fr;gap:16px;padding:19px}.command-row{align-items:stretch;flex-direction:column}.command-row code{max-width:none}.command-row .primary-button{width:100%}.section{padding-top:28px}.section-heading{align-items:flex-start;flex-direction:column;gap:3px}.compact-panel{align-items:flex-start;flex-direction:column}.provider-list{justify-content:flex-start}.topbar{height:62px}}@media(max-width:390px){.hero h1{font-size:2rem}.harness-card{padding:15px}.harness-top{align-items:flex-start;flex-direction:column;gap:6px}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important;animation:none!important}}`;

export const DASHBOARD_JS = `const byId=(id)=>document.getElementById(id);const setText=(id,value)=>{const node=byId(id);if(node)node.textContent=value};function formatReset(value){return value?'Resets '+new Date(value).toLocaleString():'Reset time unavailable'}function renderHarness(item){const card=document.createElement('article');card.className='harness-card';const top=document.createElement('div');top.className='harness-top';const title=document.createElement('h3');title.textContent=item.name;const health=document.createElement('span');health.className='health '+item.health;health.textContent=item.statusLabel;top.append(title,health);card.append(top);const meta=document.createElement('p');meta.className='harness-meta';meta.textContent=item.version?'Version '+item.version:'Version unavailable';card.append(meta);if(item.providers.length){const provider=document.createElement('p');provider.className='provider-line';const strong=document.createElement('strong');strong.textContent=item.providers.join(', ');provider.append(strong,document.createTextNode(' active automatically'));card.append(provider)}if(item.allowance.length){const allowance=document.createElement('div');allowance.className='allowance';for(const quota of item.allowance){const box=document.createElement('div');box.className='quota';const row=document.createElement('div');row.className='quota-row';const label=document.createElement('span');label.textContent=quota.label;const value=document.createElement('strong');value.textContent=quota.remainingPercent===null?'Unknown':quota.remainingPercent+'% left';row.append(label,value);const track=document.createElement('div');track.className='track';track.setAttribute('role','progressbar');track.setAttribute('aria-label',item.name+' '+quota.label);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');if(quota.remainingPercent!==null){track.setAttribute('aria-valuenow',String(quota.remainingPercent));track.setAttribute('aria-valuetext',quota.remainingPercent+'% remaining')}const fill=document.createElement('div');fill.className='fill';fill.style.width=(quota.remainingPercent===null?0:Math.max(0,Math.min(100,quota.remainingPercent)))+'%';track.append(fill);const detail=document.createElement('p');detail.className='quota-meta';detail.textContent=formatReset(quota.resetsAt)+(quota.confidence==='authoritative'?' · verified allowance':' · '+quota.confidence);box.append(row,track,detail);allowance.append(box)}card.append(allowance)}else{const empty=document.createElement('p');empty.className='no-allowance';empty.textContent='Allowance data is not available for this harness.';card.append(empty)}return card}function render(model){document.body.dataset.state=model.state;const status=byId('status');status.textContent=model.statusLabel;status.className='status-chip '+model.state;setText('headline',model.headline);setText('summary',model.summary);setText('updated','Updated '+new Date(model.generatedAt).toLocaleString());setText('next-title',model.nextStep.title);setText('description',model.nextStep.description);const commandRow=byId('command-row');if(model.nextStep.command){setText('command',model.nextStep.command);commandRow.hidden=false}else{setText('command','');commandRow.hidden=true}const harnesses=byId('harnesses');harnesses.replaceChildren();if(model.harnesses.length===0){const empty=document.createElement('p');empty.className='supporting';empty.textContent='No active optimized harness is available yet.';harnesses.append(empty)}for(const item of model.harnesses)harnesses.append(renderHarness(item));const recommendationPanel=byId('recommendation-panel');if(model.recommendation){setText('recommendation',model.recommendation.action);setText('reason',model.recommendation.reason||'This recommendation is based on the currently observable local signals.');recommendationPanel.hidden=false}else{recommendationPanel.hidden=true}const providersPanel=byId('providers-panel');const providers=byId('providers');providers.replaceChildren();if(model.providers.length){for(const item of model.providers){const node=document.createElement('li');node.textContent=item.name+' · '+item.harnesses.join(', ');providers.append(node)}providersPanel.hidden=false}else{providersPanel.hidden=true}const otherPanel=byId('other-panel');const other=byId('other-harnesses');other.replaceChildren();if(model.otherHarnesses.length){setText('other-summary','Other detected tools ('+model.otherHarnesses.length+')');for(const item of model.otherHarnesses){const node=document.createElement('li');node.textContent=item.name+(item.version?' · '+item.version:'')+' · detected, not active in the optimized setup';other.append(node)}otherPanel.hidden=false}else{otherPanel.hidden=true}setText('error','')}async function load(){const refresh=byId('refresh');refresh.disabled=true;refresh.textContent='Refreshing…';try{const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw new Error('Dashboard data is unavailable');render(await response.json())}catch(error){setText('error',error instanceof Error?error.message:String(error))}finally{refresh.disabled=false;refresh.textContent='Refresh'}}byId('refresh').addEventListener('click',load);byId('copy').addEventListener('click',async()=>{const command=byId('command').textContent||'';try{await navigator.clipboard.writeText(command);setText('updated','Command copied')}catch{setText('updated','Copy unavailable — select the command manually')}});load();setInterval(()=>{if(!document.hidden)load()},30000);`;

export interface UiAssetResponse {
  status: number;
  contentType: string;
  body: string;
}

export function uiAsset(path: string, model: DashboardModel): UiAssetResponse {
  if (path === '/')
    return { status: 200, contentType: 'text/html; charset=utf-8', body: DASHBOARD_HTML };
  if (path === '/app.css')
    return { status: 200, contentType: 'text/css; charset=utf-8', body: DASHBOARD_CSS };
  if (path === '/app.js')
    return { status: 200, contentType: 'text/javascript; charset=utf-8', body: DASHBOARD_JS };
  if (path === '/api/status')
    return {
      status: 200,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify(model),
    };
  return { status: 404, contentType: 'text/plain; charset=utf-8', body: 'Not found\n' };
}
