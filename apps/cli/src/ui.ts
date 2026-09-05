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

export const UI_USAGE = `token-harness ui — open a simple local dashboard

Usage
  token-harness ui [--no-open] [--port <number>] [--json]

The dashboard listens only on 127.0.0.1 and reads the same reports as the CLI.
It does not send data anywhere and cannot change configuration. Close it with
Ctrl+C. Use --json for one complete dashboard snapshot without starting a server.`;

export interface DashboardWindow {
  label: string;
  remainingPercent: number | null;
  resetsAt: string | null;
  confidence: string;
}

export interface DashboardHarness {
  id: string;
  name: string;
  state: string;
  version: string | null;
  providers: string[];
  allowance: DashboardWindow[];
}

export interface DashboardModel {
  generatedAt: string;
  state: 'ready' | 'setup-needed' | 'attention';
  headline: string;
  harnesses: DashboardHarness[];
  providers: { id: string; state: string; harnesses: string[] }[];
  recommendation: { action: string; reason: string | null } | null;
  nextStep: { command: string; description: string };
}

function nameOf(id: string): string {
  if (id === 'claude') return 'Claude Code';
  if (id === 'codex') return 'Codex';
  if (id === 'opencode') return 'OpenCode';
  return id;
}

export function buildDashboardModel(input: {
  generatedAt: string;
  doctor: DoctorReport;
  status: StatusReport;
  budget: BudgetReport;
  optimize: OptimizeReport;
}): DashboardModel {
  const present = input.doctor.harnesses.filter((item) => item.state !== 'absent');
  const configured = input.doctor.providers.filter(
    (item) => item.state === 'configured' && item.configuredHarnesses.length > 0,
  );
  const hasProblems = input.doctor.problemCount > 0 || input.status.problemCount > 0;
  const state: DashboardModel['state'] = hasProblems
    ? 'attention'
    : present.length === 0 || configured.length === 0
      ? 'setup-needed'
      : 'ready';

  const recommendation = input.optimize.harnesses
    .flatMap((harness) =>
      harness.recommendations.map((item) => ({
        harness: harness.harnessId,
        priority: item.priority,
        action: item.action,
        reason: item.evidence[0]?.summary ?? null,
      })),
    )
    .sort((left, right) => {
      const rank = { first: 0, next: 1, optional: 2 } as const;
      return rank[left.priority] - rank[right.priority];
    })[0];

  const nextStep =
    state === 'setup-needed'
      ? { command: 'token-harness setup', description: 'Finish the guided setup.' }
      : state === 'attention'
        ? {
            command: 'token-harness doctor --verbose',
            description: 'Review the detected problem before changing anything.',
          }
        : {
            command: 'token-harness optimize',
            description: 'Refresh advice for the task you are about to start.',
          };

  return {
    generatedAt: input.generatedAt,
    state,
    headline:
      state === 'ready'
        ? 'Your coding harnesses are connected.'
        : state === 'attention'
          ? 'One or more checks need attention.'
          : 'Finish setup to activate Token Harness.',
    harnesses: input.doctor.harnesses.map((harness) => {
      const budget = input.budget.harnesses.find((item) => item.harnessId === harness.harnessId);
      return {
        id: harness.harnessId,
        name: nameOf(harness.harnessId),
        state: harness.state,
        version: harness.version,
        providers: input.doctor.providers
          .filter((provider) => provider.configuredHarnesses.includes(harness.harnessId))
          .map((provider) => provider.providerId),
        allowance: (budget?.windows ?? []).map((window) => ({
          label: window.bucketName ?? window.scope,
          remainingPercent: window.remainingPercent,
          resetsAt: window.resetsAt,
          confidence: window.confidence,
        })),
      };
    }),
    providers: input.doctor.providers.map((provider) => ({
      id: provider.providerId,
      state: provider.state,
      harnesses: provider.configuredHarnesses.map(nameOf),
    })),
    recommendation:
      recommendation === undefined
        ? null
        : {
            action: `${nameOf(recommendation.harness)}: ${recommendation.action}`,
            reason: recommendation.reason,
          },
    nextStep,
  };
}

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="dark">
  <title>Token Harness</title>
  <link rel="stylesheet" href="/app.css">
</head>
<body>
  <a class="skip" href="#main">Skip to dashboard</a>
  <header><div class="brand"><span class="mark">TH</span><span>Token Harness</span></div><button id="refresh" type="button">Refresh</button></header>
  <main id="main">
    <section class="hero" aria-labelledby="headline"><p class="eyebrow">LOCAL STATUS</p><h1 id="headline">Checking your harnesses...</h1><p id="updated" class="muted" aria-live="polite"></p></section>
    <section id="harnesses" class="grid" aria-label="Harness status"></section>
    <section class="panel recommendation"><p class="eyebrow">RECOMMENDATION</p><h2 id="recommendation">Waiting for observations...</h2><p id="reason" class="muted"></p></section>
    <section class="panel next"><div><p class="eyebrow">NEXT STEP</p><code id="command">token-harness setup</code><p id="description" class="muted"></p></div><button id="copy" type="button">Copy command</button></section>
    <section class="panel"><p class="eyebrow">PROVIDERS</p><div id="providers" class="provider-list"></div></section>
    <p id="error" class="error" role="alert"></p>
  </main>
  <footer>Private by design. Served only from this computer.</footer>
  <script src="/app.js" defer></script>
</body>
</html>`;

export const DASHBOARD_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;color:#f8fafc;background:#0f172a;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 90% 0,#172554 0,transparent 32rem),#0f172a}button{min-height:44px;border:1px solid #475569;border-radius:10px;background:#1e293b;color:#f8fafc;padding:0 1rem;font:inherit;font-weight:700;cursor:pointer}button:hover{background:#334155}button:focus-visible,a:focus-visible{outline:3px solid #38bdf8;outline-offset:3px}.skip{position:absolute;left:-999px;top:1rem;color:#fff}.skip:focus{left:1rem}header,main,footer{width:min(1120px,calc(100% - 2rem));margin-inline:auto}header{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #334155}.brand{display:flex;align-items:center;gap:.75rem;font-weight:800}.mark{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;background:#22c55e;color:#052e16;font:800 14px ui-monospace,monospace}.hero{padding:4.5rem 0 2rem}.eyebrow{margin:0 0 .65rem;color:#22c55e;font:700 .75rem ui-monospace,monospace;letter-spacing:.12em}.hero h1{max-width:760px;margin:0 0 .8rem;font-size:clamp(2rem,5vw,4.4rem);line-height:1.02;letter-spacing:-.045em}.muted{color:#94a3b8;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem}.panel,.card{border:1px solid #334155;border-radius:16px;background:#172033;padding:1.4rem;box-shadow:0 16px 40px #02061733}.card-top,.next{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem}.badge{border-radius:999px;padding:.35rem .65rem;background:#334155;color:#cbd5e1;font:700 .72rem ui-monospace,monospace}.badge.ready{background:#14532d;color:#bbf7d0}.badge.attention{background:#713f12;color:#fef3c7}.card h2,.panel h2{margin:.15rem 0;font-size:1.25rem}.meta{margin:.35rem 0 1.2rem;color:#94a3b8}.quota{margin-top:1rem}.quota-row{display:flex;justify-content:space-between;gap:1rem;margin-bottom:.45rem;font-size:.9rem}.quota-meta{margin:.45rem 0 0;color:#64748b;font-size:.78rem}.track{height:8px;border-radius:999px;background:#334155;overflow:hidden}.fill{height:100%;background:#22c55e;border-radius:inherit}.recommendation{margin-top:1rem}.next{margin-top:1rem;align-items:center}.next code{display:block;color:#e2e8f0;font-size:1rem;overflow-wrap:anywhere}.provider-list{display:flex;flex-wrap:wrap;gap:.65rem}.provider{border:1px solid #475569;border-radius:10px;padding:.65rem .8rem;color:#cbd5e1}.panel{margin-top:1rem}.error{color:#fecaca}.empty{color:#94a3b8}footer{padding:2.5rem 0;color:#64748b;font-size:.85rem}@media(max-width:720px){.grid{grid-template-columns:1fr}.hero{padding-top:3rem}.next{align-items:stretch;flex-direction:column}.next button{width:100%}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}`;

export const DASHBOARD_JS = `const byId=(id)=>document.getElementById(id);const text=(id,value)=>{byId(id).textContent=value};function badgeState(state){return state==='configured'||state==='detected'?'ready':state==='broken'?'attention':''}function render(model){text('headline',model.headline);text('updated','Updated '+new Date(model.generatedAt).toLocaleString());const harnesses=byId('harnesses');harnesses.replaceChildren();for(const item of model.harnesses){const card=document.createElement('article');card.className='card';const top=document.createElement('div');top.className='card-top';const heading=document.createElement('h2');heading.textContent=item.name;const badge=document.createElement('span');badge.className='badge '+badgeState(item.state);badge.textContent=item.state;top.append(heading,badge);card.append(top);const meta=document.createElement('p');meta.className='meta';meta.textContent=(item.version?'Version '+item.version+' · ':'')+(item.providers.length?item.providers.join(', ')+' active':'no provider active');card.append(meta);if(item.allowance.length===0){const empty=document.createElement('p');empty.className='empty';empty.textContent='Allowance unavailable';card.append(empty)}for(const quota of item.allowance){const box=document.createElement('div');box.className='quota';const row=document.createElement('div');row.className='quota-row';const label=document.createElement('span');label.textContent=quota.label;const value=document.createElement('strong');value.textContent=quota.remainingPercent===null?'Unknown':quota.remainingPercent+'% left';row.append(label,value);const track=document.createElement('div');track.className='track';track.setAttribute('role','progressbar');track.setAttribute('aria-label',item.name+' '+quota.label);track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax','100');if(quota.remainingPercent!==null){track.setAttribute('aria-valuenow',String(quota.remainingPercent));track.setAttribute('aria-valuetext',quota.remainingPercent+'% remaining')}const fill=document.createElement('div');fill.className='fill';fill.style.width=(quota.remainingPercent===null?0:Math.max(0,Math.min(100,quota.remainingPercent)))+'%';track.append(fill);const reset=document.createElement('p');reset.className='quota-meta';reset.textContent=(quota.resetsAt?'Resets '+new Date(quota.resetsAt).toLocaleString():'Reset unknown')+' · '+quota.confidence;box.append(row,track,reset);card.append(box)}harnesses.append(card)}text('recommendation',model.recommendation?model.recommendation.action:'No recommendation yet.');text('reason',model.recommendation?.reason||'More observations are needed before Token Harness recommends a change.');text('command',model.nextStep.command);text('description',model.nextStep.description);const providers=byId('providers');providers.replaceChildren();if(model.providers.length===0){const empty=document.createElement('span');empty.className='empty';empty.textContent='No provider detected';providers.append(empty)}for(const item of model.providers){const node=document.createElement('span');node.className='provider';node.textContent=item.id+' · '+(item.harnesses.length?'active on '+item.harnesses.join(', '):item.state);providers.append(node)}text('error','')}async function load(){byId('refresh').disabled=true;try{const response=await fetch('/api/status',{cache:'no-store'});if(!response.ok)throw new Error('Dashboard data is unavailable');render(await response.json())}catch(error){text('error',error instanceof Error?error.message:String(error))}finally{byId('refresh').disabled=false}}byId('refresh').addEventListener('click',load);byId('copy').addEventListener('click',async()=>{await navigator.clipboard.writeText(byId('command').textContent||'');text('updated','Command copied')});load();setInterval(()=>{if(!document.hidden)load()},30000);`;

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
