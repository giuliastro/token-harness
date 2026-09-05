/** Embedded, dependency-free guided application. Dynamic data uses textContent only. */
export const GUIDE_HTML = `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark"><title>Token Harness | Efficiency</title><link rel="stylesheet" href="/guide.css"></head>
<body><a class="skip" href="#main">Skip to content</a>
<header><div class="brand">Token Harness <span class="tag">Local efficiency</span></div><button id="refresh" class="secondary" type="button">Refresh</button></header>
<main id="main">
<section class="intro"><h1>Less setup. More useful work.</h1><p>Connect your optimizers once. Keep using Claude Code and Codex normally. See what changed and what was measured.</p>
<div class="actions"><button id="setup" type="button">Set up automatically</button><span>Preview first. Nothing changes without your approval.</span></div>
<p id="updated" class="caption" role="status">Reading local settings and measurements...</p>
<div id="error" role="alert" hidden></div><div id="notices"></div></section>
<section aria-labelledby="agents-title"><h2 id="agents-title">Your coding agents</h2><div id="agents" class="grid" aria-busy="true"><div class="panel skeleton">Checking installed agents...</div></div>
<p class="caption">Configured integrations keep working with their normal agent lifecycle. Closing this page does not disable them.</p></section>
<section aria-labelledby="savings-title" class="panel results"><div class="section-head"><div><h2 id="savings-title">Recorded savings</h2><p>All locally recorded projects. Measurements refresh automatically.</p></div>
<label>Period<select id="period"><option value="all">All recorded history</option><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option></select></label></div>
<div id="savings" aria-busy="true"><p>Reading available measurement records...</p></div><p id="savings-dates" class="caption"></p><p id="savings-note" class="caption"></p>
<button id="export" class="secondary" type="button" disabled>Save report</button></section>
<section aria-labelledby="rules-title"><h2 id="rules-title">What is being optimized?</h2><p>Expand a rule to see what it does, why it is used, and what has actually been verified.</p><div id="rules"></div></section>
<section class="panel" aria-labelledby="task-title"><h2 id="task-title">Optional: match reasoning to your work</h2>
<p>Output optimization does not require this step. Use it when you deliberately want to change a persistent reasoning preference.</p>
<div class="form-row"><label>Coding agent<select id="harness"><option value="claude">Claude Code</option><option value="codex">Codex</option></select></label>
<label>Type of work<select id="task"><option value="standard">Everyday coding</option><option value="mechanical">Simple edits and formatting</option><option value="hard">Complex debugging or implementation</option><option value="critical">Critical architecture or review</option></select></label>
<button id="task-review" class="secondary" type="button">Review task settings</button></div>
<p class="notice">This changes a preference for future sessions until you change it again. It is not an automatic per-task switch. Model, login and billing stay unchanged.</p></section>
<section aria-labelledby="activity-title"><div class="section-head"><h2 id="activity-title">What Token Harness is doing</h2><button id="verify" class="secondary" type="button">Check integrations</button></div>
<button id="undo" class="secondary" type="button" hidden>Undo last change</button><div id="activity" role="status"><p>No configuration changes in this dashboard session.</p></div></section>
<footer>Runs locally. No Token Harness account, AI subscription or background supervisor required for this dashboard.</footer>
</main>
<dialog id="review" aria-labelledby="review-title"><div class="dialog-body"><h2 id="review-title">Review changes</h2><div id="review-content"></div>
<div id="review-error" role="alert" hidden></div><div class="actions"><button id="approve" type="button" hidden>Approve and apply</button><button id="close" class="secondary" type="button">Close</button></div></div></dialog>
<script src="/guide.js" defer></script></body></html>`;

export const GUIDE_CSS = `
:root,.dark{--background:216 74% 12% / .5;--card:216 74% 12% / .5;--popup-surface:216 74% 12%;--foreground:0 0% 98%;--secondary:240 62% 60%;--secondary-foreground:0 0% 98%;--accent:238 44% 27%;--border:0 0% 100% / .1;--ring:240 62% 60%;--muted:0 0% 100% / .05;--qe-high:150 55% 42%;--qe-medium:24 93% 53%;--qe-low:358 74% 59%;--radius:.625rem;--s1:.25rem;--s2:.5rem;--s3:.75rem;--s4:1rem;--s6:1.5rem;--s8:2rem;--s12:3rem;--s16:4rem;--caption:.8125rem;--body:.9375rem;--title:2rem;--section:1.25rem;--metric:2rem;--sans:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--mono:Menlo,Consolas,monospace;--gradient:radial-gradient(221.6% 141.42% at 0% 100%,#7d4cfd80 0%,transparent 100%),radial-gradient(132.94% 79.88% at 0% 0%,#dd125480 0%,#dd125400 100%),#00192d}
*{box-sizing:border-box}html{background:var(--gradient);background-attachment:fixed;color-scheme:dark;min-height:100%}body{margin:0;background:hsl(var(--background));color:hsl(var(--foreground));font-family:var(--sans);font-size:var(--body);line-height:1.6;min-height:100dvh}header{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);padding:var(--s4) var(--s8);border-bottom:1px solid hsl(var(--border));background:hsl(var(--card))}.brand{font-weight:700;letter-spacing:-.02em}.tag,.pill{font-size:var(--caption);font-weight:500;border:1px solid hsl(var(--border));border-radius:var(--radius);padding:var(--s1) var(--s2);margin-left:var(--s2)}main{max-width:1120px;margin:auto;padding:var(--s8) var(--s6) var(--s16)}h1{font-size:var(--title);line-height:1.2;letter-spacing:-.03em;margin:0 0 var(--s4)}h2{font-size:var(--section);line-height:1.35;margin:0 0 var(--s3)}h3{font-size:var(--body);margin:0}p{margin:0 0 var(--s4);max-width:78ch}section{margin-bottom:var(--s8)}.intro{padding:var(--s4) 0}.actions{display:flex;align-items:center;gap:var(--s4);flex-wrap:wrap}.actions span,.caption,footer{font-size:var(--caption)}button,select{font:inherit;min-height:44px;border-radius:calc(var(--radius) - 2px);border:1px solid hsl(var(--border));padding:var(--s2) var(--s4)}button{background:hsl(var(--secondary));color:hsl(var(--secondary-foreground));font-weight:600;cursor:pointer;white-space:nowrap}button.secondary{background:hsl(var(--muted));color:hsl(var(--foreground))}button:disabled{opacity:.55;cursor:not-allowed}button:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:3px solid hsl(var(--ring));outline-offset:3px}button:active:not(:disabled){transform:translateY(1px)}select{background:hsl(var(--popup-surface));color:hsl(var(--foreground));width:100%}label{display:flex;flex-direction:column;gap:var(--s2);font-weight:600;font-size:var(--caption)}.form-row{display:grid;grid-template-columns:1fr 2fr auto;gap:var(--s4);align-items:end}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s4)}.panel{border:1px solid hsl(var(--border));border-radius:calc(var(--radius) + 4px);padding:var(--s6);background:hsl(var(--card))}.agent-head,.section-head{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);margin-bottom:var(--s4)}.section-head p{margin:0}.section-head label{min-width:180px}.agent-head .pill{margin:0}.agent p{margin-bottom:var(--s3)}.agent .version{font-family:var(--mono);font-size:var(--caption)}.allowance{margin-top:var(--s4);padding-top:var(--s4);border-top:1px solid hsl(var(--border))}.allowance strong{font-size:var(--section);font-variant-numeric:tabular-nums}.allowance .caption{display:block}.notice,#error,#review-error{border-left:3px solid hsl(var(--qe-medium));padding:var(--s3) var(--s4);background:hsl(var(--muted));margin-top:var(--s4);border-radius:calc(var(--radius) - 4px)}#error,#review-error{border-color:hsl(var(--qe-low))}#updated{margin-top:var(--s4)}.saving-row{display:grid;grid-template-columns:1fr auto;gap:var(--s4);padding:var(--s6) 0;border-top:1px solid hsl(var(--border))}.saving-row .number{font:700 var(--metric)/1.2 var(--mono);font-variant-numeric:tabular-nums;letter-spacing:-.04em;display:block}.saving-row .unit{font-size:var(--caption)}.saving-row .amount{text-align:right}.saving-row p{margin:var(--s2) 0}.negative{border-left:3px solid hsl(var(--qe-low));padding-left:var(--s4)}.empty{padding:var(--s6);background:hsl(var(--muted));border-radius:var(--radius);margin-bottom:var(--s4)}details{border:1px solid hsl(var(--border));background:hsl(var(--card));border-radius:var(--radius);margin-bottom:var(--s3)}summary{padding:var(--s4);cursor:pointer;font-weight:600}summary .pill{float:right}.rule-body{padding:0 var(--s4) var(--s4)}.rule-body p{margin-top:var(--s3);margin-bottom:0}.rule-group{margin:var(--s6) 0 var(--s3)}.activity-row{padding:var(--s3) 0;display:flex;gap:var(--s4);border-bottom:1px solid hsl(var(--border))}.activity-row time{font-size:var(--caption);white-space:nowrap}.activity-row p{margin:0}.checklist{padding-left:var(--s6)}.checklist li{margin-bottom:var(--s4)}dialog{color:hsl(var(--foreground));background:hsl(var(--popup-surface));border:1px solid hsl(var(--border));border-radius:var(--radius);max-width:680px;width:calc(100% - 32px);max-height:85dvh;padding:0}dialog::backdrop{background:hsl(var(--popup-surface) / .8)}.dialog-body{padding:var(--s8)}.dialog-body .actions{margin-top:var(--s6);justify-content:flex-end}.skip{position:absolute;left:-9999px;top:0}.skip:focus{left:var(--s4);padding:var(--s3);background:hsl(var(--popup-surface));color:hsl(var(--foreground));z-index:2}footer{border-top:1px solid hsl(var(--border));padding-top:var(--s6)}[hidden]{display:none!important}.skeleton{min-height:150px;background:hsl(var(--muted))}
@media(hover:hover){button:hover:not(:disabled){background:hsl(var(--accent))}summary:hover{background:hsl(var(--muted))}}
@media(max-width:1023px){.form-row{grid-template-columns:1fr 1fr}.form-row button{grid-column:1/-1;justify-self:start}}
@media(max-width:639px){header{padding:var(--s4)}.tag{display:none}main{padding:var(--s6) var(--s4) var(--s12)}.grid,.form-row{grid-template-columns:1fr}.section-head{align-items:stretch;flex-direction:column}.section-head label{min-width:0}.panel,.dialog-body{padding:var(--s4)}.agent-head{align-items:start;flex-direction:column;gap:var(--s2)}.actions{align-items:stretch;flex-direction:column}.actions button{width:100%}summary .pill{float:none;display:inline-block;margin-top:var(--s2)}.saving-row{grid-template-columns:1fr}.saving-row .amount{text-align:left}.activity-row{flex-direction:column;gap:var(--s1)}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
@media(forced-colors:active){button,details,.panel{border:1px solid CanvasText}:focus-visible{outline:2px solid Highlight}}
`;

export const GUIDE_JS = String.raw`
'use strict';
const $ = id => document.getElementById(id);
let csrf = '', current = null, ticket = null, working = false, reading = false, trigger = null;
const count = value => new Intl.NumberFormat().format(value);
const date = value => value ? new Date(value).toLocaleString() : 'not recorded';
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
async function request(path, body) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(120000) };
  if (body !== undefined) { options.method = 'POST'; options.headers = { 'Content-Type': 'application/json', 'X-Token-Harness-CSRF': csrf }; options.body = JSON.stringify(body); }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The operation did not finish.');
  return data;
}
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function lock(value) {
  working = value;
  for (const id of ['setup','task-review','verify','refresh','period','harness','task','undo']) $(id).disabled = value;
  $('approve').disabled = value; $('close').disabled = value;
  $('review-content').setAttribute('aria-busy', String(value));
}
function renderRule(rule) {
  const details = node('details'); details.dataset.rule = rule.id;
  const summary = node('summary', rule.title);
  summary.append(node('span', rule.state, 'pill')); details.append(summary);
  const body = node('div', undefined, 'rule-body');
  const modes = { automatic: 'Automatic integration', integration: 'Configured adapter or agent instructions', preference: 'Persistent preference', observation: 'Observation only', advice: 'Advice before approval', 'not-enabled': 'Not enabled', safety: 'Safety rule' };
  for (const [label, text] of [['Mode', modes[rule.mode]],['What it does',rule.what],['Why',rule.why],['Evidence',rule.evidence]]) {
    const p = node('p'); p.append(node('strong', label + ': '), node('span', text)); body.append(p);
  }
  details.append(body); return details;
}
function render(data) {
  current = data; $('error').hidden = true;
  $('updated').textContent = 'Last checked: ' + date(data.generatedAt) + '. Updates automatically while this page is visible.';
  $('notices').replaceChildren(...data.notices.map(text => node('p', text, 'notice')));
  $('agents').replaceChildren(); $('agents').setAttribute('aria-busy','false');
  const allowed = new Set(data.agents.map(agent => agent.id));
  for (const option of $('harness').options) option.disabled = !allowed.has(option.value);
  if (!allowed.has($('harness').value) && data.agents.length) $('harness').value = data.agents[0].id;
  $('task-review').disabled = working || !data.agents.length;
  if (!data.agents.length) $('agents').append(node('div','No supported coding agent was found in this terminal. Install and sign in to Claude Code or Codex, then refresh.','empty'));
  const openRules = new Set([...$('rules').querySelectorAll('details[open]')].map(item => item.dataset.rule));
  $('rules').replaceChildren();
  for (const agent of data.agents) {
    const card = node('article', undefined, 'panel agent');
    const head = node('div', undefined, 'agent-head'); head.append(node('h3', agent.name),node('span',agent.state,'pill')); card.append(head);
    card.append(node('p', 'Version ' + (agent.version || 'not observed'), 'version'));
    card.append(node('p', agent.providers.length ? 'Connected: ' + agent.providers.join(', ') : 'No configured output optimizer detected.'));
    card.append(node('p', 'Reasoning preference: ' + (agent.effort || 'not observed') + '.'));
    if (agent.effort === 'low') card.append(node('p','Low reasoning is a persistent preference. For difficult work, review the task settings below.','notice'));
    const allowance = node('div', undefined, 'allowance');
    if (!agent.allowance.length) allowance.append(node('p',agent.allowanceNote,'caption'));
    for (const window of agent.allowance) {
      const p = node('p'); p.append(node('strong',window.remaining === null ? 'Unknown' : count(window.remaining) + '% left'),node('span','  ' + window.label));
      p.append(node('span',window.source + '. Reset: ' + date(window.resetsAt), 'caption')); allowance.append(p);
    }
    card.append(allowance); $('agents').append(card);
    $('rules').append(node('h3',agent.name,'rule-group'), ...agent.rules.map(renderRule));
  }
  $('rules').append(node('h3','Safety and decision rules','rule-group'), ...data.rules.map(renderRule));
  for (const item of $('rules').querySelectorAll('details')) item.open = openRules.has(item.dataset.rule);
  $('setup').textContent = data.agents.length > 0 && data.agents.every(agent => agent.configured) ? 'Check automatic setup' : 'Set up automatically';
  $('savings').replaceChildren(); $('savings').setAttribute('aria-busy','false');
  const savings = data.savings;
  if (!savings.rows.length) {
    const empty = node('div', undefined,'empty'); empty.append(node('h3','No measurable reductions recorded yet'),node('p','This is not a measured zero. Use the configured agent normally; this page checks for new records automatically. Existing RTK history is read directly. HarnessTrim measurements may need to be enabled in its integration.')); $('savings').append(empty);
  }
  for (const row of savings.rows) {
    const item = node('div',undefined,'saving-row' + (row.saved < 0 ? ' negative' : ''));
    const description = node('div'); description.append(node('h3',row.provider),node('p',row.measurement + (row.agents.length ? ' / ' + row.agents.join(', ') : ' / agent not recorded')));
    description.append(node('p',count(row.operations) + ' recorded changed outputs', 'caption'));
    if (row.before !== null && row.after !== null) description.append(node('p',count(row.before) + ' before / ' + count(row.after) + ' after','caption'));
    const amount = node('div',undefined,'amount'); amount.append(node('span',count(Math.abs(row.saved)),'number'),node('span',row.unit + (row.saved < 0 ? ' added, not saved' : ' removed from recorded output'),'unit'));
    item.append(description,amount); $('savings').append(item);
  }
  $('savings-dates').textContent = savings.firstRecordedAt ? 'Available records: ' + date(savings.firstRecordedAt) + ' to ' + date(savings.lastRecordedAt) : 'No dated records in this period.';
  $('savings-note').textContent = savings.note + (savings.errors ? ' Recorded errors: ' + count(savings.errors) + '.' : '') + (savings.inflated ? ' Outputs that grew: ' + count(savings.inflated) + '.' : '');
  $('export').disabled = false;
}
async function refresh() {
  if (working || reading) return;
  reading = true; $('refresh').disabled = true; $('updated').textContent = 'Checking local agents and importing available measurements...';
  try { render(await request('/api/overview?period=' + $('period').value)); }
  catch (e) { error(e.message || 'Could not read the local application. Check that its terminal is still open.'); $('updated').textContent = 'The latest check did not finish. Previous data, if visible, may be out of date.'; }
  finally { reading = false; $('refresh').disabled = working; }
}
function showDialog(title) { trigger = document.activeElement; $('review-title').textContent = title; $('review-content').replaceChildren(); $('review-error').hidden = true; $('approve').hidden = true; ticket = null; $('review').showModal(); }
function resultView(data) { $('review-title').textContent = data.title; $('review-content').replaceChildren(...data.messages.map(text => node('p',text))); $('approve').hidden = true; ticket = null; }
async function preview(body) {
  if (working) return;
  showDialog('Checking the safest setup'); lock(true);
  $('review-content').append(node('p','Reading your current configuration. Nothing is being changed.'));
  try {
    const data = await request('/api/preview',body); $('review-title').textContent = data.title; $('review-content').replaceChildren();
    const list = node('ul',undefined,'checklist');
    for (const change of data.changes) { const li = node('li'); li.append(node('strong',change.title),node('p',change.description),node('span',change.files ? change.files + ' configuration file(s)' : 'Files from the reviewed backup','caption')); list.append(li); }
    $('review-content').append(list,...data.notices.map(text => node('p',text,'notice')));
    if (data.network) $('review-content').append(node('p','This reviewed setup requires a network request to its declared installation source.','notice'));
    if (data.ticket) $('review-content').append(node('p','Configuration backups are created before applying. Multiple agent setups are separate transactions; any partial success will be reported.','caption'));
    ticket = data.ticket; $('approve').hidden = !ticket;
  } catch (e) { $('review-error').textContent = e.message; $('review-error').hidden = false; }
  finally { lock(false); activity(); }
}
$('setup').addEventListener('click',()=>preview({action:'setup'}));
$('undo').addEventListener('click',()=>preview({action:'undo'}));
$('task-review').addEventListener('click',()=>preview({action:'effort',harness:$('harness').value,task:$('task').value}));
$('approve').addEventListener('click',async()=>{
  if (!ticket || working) return;
  const approved = ticket; ticket = null; lock(true);
  $('review-content').replaceChildren(node('p','Backing up, applying your reviewed changes and checking the result...'));
  try { resultView(await request('/api/apply',{ticket:approved})); }
  catch (e) { $('approve').hidden = true; $('review-error').textContent = e.message + ' No automatic retry was made. Check the current state before trying again.'; $('review-error').hidden = false; }
  finally { lock(false); refresh(); activity(); }
});
$('verify').addEventListener('click',async()=>{
  if (working) return; showDialog('Checking integrations'); lock(true);
  $('review-content').append(node('p','Reading integration checks. No agent settings are changed.'));
  try { resultView(await request('/api/verify',{})); } catch(e) { $('review-error').textContent = e.message; $('review-error').hidden = false; }
  finally { lock(false); activity(); }
});
$('close').addEventListener('click',()=>{ $('review').close(); ticket = null; if (trigger) trigger.focus(); });
$('review').addEventListener('cancel',event=>{ if(working) event.preventDefault(); else ticket = null; });
$('refresh').addEventListener('click',refresh); $('period').addEventListener('change',refresh);
$('export').addEventListener('click',()=>{
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));
  const a = node('a'); a.href = url; a.download = 'token-harness-report.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
});
async function activity() {
  try { const data = await request('/api/activity'); $('undo').hidden = !data.canUndo; if (!data.activity.length) return;
    $('activity').replaceChildren(...data.activity.map(item=>{const row=node('div',undefined,'activity-row');row.append(node('time',new Date(item.at).toLocaleTimeString()),node('p',item.message));return row;}));
  } catch { /* Main refresh owns connection error presentation. */ }
}
(async()=>{try{csrf=(await request('/api/session')).token;await refresh();}catch(e){error(e.message);}})();
setInterval(()=>{if(!document.hidden){if(!working)refresh();activity();}},30000);
setInterval(()=>{if(working)activity();},1500);
`;
