/** Outcome-first browser controller for the local guided UI. */
export const GUIDE_JS = String.raw`
'use strict';
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
const count = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const date = value => value ? new Date(value).toLocaleString() : 'not recorded';
let csrf = '', current = null, ticket = null, previewAction = null;
let working = false, reading = false, periodReading = false, activityPending = false;
let selectedView = 'overview', selectedRules = null, stale = false;
const periodCache = new Map();
const VIEWS = {
  overview: ['Dashboard', 'What Token Harness is doing for you, what is measured, and what to do next.'],
  rules: ['Policies', 'What is active, what can be enabled, and the trade-offs before you change anything.'],
  activity: ['Evidence', 'Measurements, quality limits, checks and the technical evidence behind the dashboard.'],
};
const HELP = {
  'claude-effort': ['Change reasoning in Claude', 'Open Claude Code and use /effort. Review the current level before changing it. Token Harness will not lower difficult work below its quality floor.', '/effort'],
  'codex-effort': ['Change reasoning in Codex', 'Open Codex and use /model to inspect the current model and reasoning controls. Project or profile settings can override a global preference.', '/model'],
  'claude-tools': ['Review Claude tools', 'Open Claude Code and use /mcp. Disable a server only when you know the task does not need it; a high tool count alone is not evidence that removal is safe.', '/mcp'],
  'codex-tools': ['Review Codex tools', 'Open Codex and use /mcp. Fix authentication or disable only tools you know are unnecessary for your work.', '/mcp'],
  measurements: ['How savings are measured', 'Token Harness reports only evidence it can defend. Local output reduction is not automatically converted into subscription minutes, weekly credits, API cost or quality. Those appear only when paired allowance, billed-token or quality evidence exists.', null],
  cclimits: ['Set up the Claude allowance reader', 'The allowance meter is optional. Install the reviewed cclimits companion, keep Claude signed in, then manually refresh this dashboard.', 'npm install --global cclimits@1.7.0'],
  python: ['Make Python available', 'cclimits needs Python. Make Python 3 available in the terminal that starts Token Harness, then reopen Token Harness.', 'python --version'],
  'claude-login': ['Restore Claude sign-in', 'Sign in inside Claude Code. Keep credentials inside Claude; never paste access tokens into this dashboard.', null],
  compatibility: ['Resolve unavailable data', 'Use Check integrations for a read-only verification. Unreviewed versions and ambiguous configuration are intentionally left untouched.', null],
};

async function request(path, body) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(120000) };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json', 'X-Token-Harness-CSRF': csrf };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The operation did not finish.');
  return data;
}
function setError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
function setStatus(message, busy = false) {
  $('updated').textContent = message;
  $('reading-spinner').hidden = !busy;
}
function markStale(message = 'A setting changed. The displayed configuration is now marked as previous state until you choose Refresh.') {
  stale = true;
  $('stale-state').hidden = false;
  $('stale-state').textContent = message;
}
function clearStale() {
  stale = false;
  $('stale-state').hidden = true;
  $('stale-state').textContent = '';
}
function setLocked(value) {
  working = value;
  document.querySelectorAll('[data-operation],#setup,#verify,#undo,#refresh,#task-review').forEach(element => {
    element.disabled = value;
  });
  $('approve').disabled = value;
  $('close').disabled = value;
  $('live-status').textContent = value ? 'Applying a reviewed operation…' : 'No changes run in the background';
}
function selectView(view, focus = false) {
  if (!VIEWS[view]) return;
  selectedView = view;
  for (const id of Object.keys(VIEWS)) {
    const active = id === view;
    $('view-' + id).hidden = !active;
    $('tab-' + id).setAttribute('aria-selected', String(active));
    $('tab-' + id).tabIndex = active ? 0 : -1;
  }
  $('view-title').textContent = VIEWS[view][0];
  $('view-description').textContent = VIEWS[view][1];
  if (view === 'activity') activity();
  if (focus) $('tab-' + view).focus();
}
function actionButton(action, key, cls = 'secondary') {
  const button = node('button', action.label, cls);
  button.type = 'button';
  button.dataset.operation = action.kind;
  button.dataset.focus = key;
  button.disabled = working;
  button.addEventListener('click', () => performAction(action));
  return button;
}
function performAction(action) {
  if (working) return;
  if (action.kind === 'setup') return preview({ action: 'setup', ...(action.harness ? { harness: action.harness } : {}) });
  if (action.kind === 'effort') return showTask(action.harness);
  if (action.kind === 'skill') return preview({ action: 'skill', harness: action.harness });
  if (action.kind === 'verify') return verify();
  if (action.kind === 'refresh') return refresh(true);
  if (action.kind === 'help') return showHelp(action.topic);
}
function showDialog(title) {
  $('review-title').textContent = title;
  $('review-content').replaceChildren();
  $('review-error').hidden = true;
  $('task-form').hidden = true;
  $('task-review').hidden = true;
  $('approve').hidden = true;
  $('review').showModal();
}
function closeDialog() {
  if (working) return;
  ticket = null;
  $('review').close();
}
function showHelp(topic) {
  const help = HELP[topic] || HELP.compatibility;
  showDialog(help[0]);
  $('review-content').append(node('p', help[1]));
  if (help[2]) {
    const code = node('code', help[2]);
    const block = node('div', undefined, 'command-block');
    const copy = node('button', 'Copy', 'secondary');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(help[2]);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy unavailable';
      }
    });
    block.append(code, copy);
    $('review-content').append(block);
  }
}
function showTask(harness) {
  previewAction = null;
  showDialog('Choose the work you want to optimize');
  $('harness').value = harness || 'claude';
  $('task-form').hidden = false;
  $('task-review').hidden = false;
  $('review-content').append(node('p', 'Token Harness chooses only a reviewed reasoning level that respects the task quality floor. You approve the exact saved setting before it changes.'));
}
async function preview(body) {
  if (working || !csrf) return;
  previewAction = body;
  showDialog(body.action === 'setup' ? 'Review optimizer setup' : body.action === 'skill' ? 'Review in-session guidance' : body.action === 'undo' ? 'Review restore' : 'Review reasoning change');
  setLocked(true);
  $('review-content').append(node('p', 'Reading the current configuration. Nothing is being changed yet.'));
  try {
    const data = await request('/api/preview', body);
    ticket = data.ticket;
    $('review-content').replaceChildren();
    if (!data.changes.length) $('review-content').append(node('p', 'No change is required for this configuration.'));
    for (const change of data.changes) {
      const item = node('article', undefined, 'preview-change');
      item.append(node('h3', change.title), node('p', change.description));
      $('review-content').append(item);
    }
    for (const notice of data.notices || []) $('review-content').append(node('p', notice, 'notice-row'));
    if (ticket) $('approve').hidden = false;
  } catch (e) {
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
  }
}
function renderResult(result) {
  showDialog(result.title);
  const state = node('div', result.ok ? 'Completed' : 'Needs attention', 'result-state ' + (result.ok ? 'good' : 'warn'));
  $('review-content').append(state);
  for (const message of result.messages || []) $('review-content').append(node('p', message));
}
async function verify() {
  if (working || !csrf) return;
  showDialog('Checking integrations');
  setLocked(true);
  $('review-content').append(node('p', 'This is read-only. No agent setting will be changed.'));
  try {
    renderResult(await request('/api/verify', {}));
  } catch (e) {
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
    activity();
  }
}

function policyCounts(data) {
  const all = [...data.rules, ...data.agents.flatMap(agent => agent.rules || [])];
  const inactive = all.filter(rule => /not enabled|setup|required|unavailable/i.test(rule.state)).length;
  return { active: Math.max(0, all.length - inactive), available: inactive, total: all.length };
}
function bestReduction(savings) {
  const rows = savings.rows.filter(row => row.impact?.kind === 'reduction');
  rows.sort((a, b) => {
    const measured = row => row.measurement === 'Measured local output' ? 1 : 0;
    const pa = Number.parseFloat(String(a.impact.percent || '0')) || 0;
    const pb = Number.parseFloat(String(b.impact.percent || '0')) || 0;
    return measured(b) - measured(a) || pb - pa;
  });
  return rows[0] || null;
}
function metricCard(title, value, description, state = '') {
  const card = node('article', undefined, 'metric-card ' + state);
  card.append(node('span', title, 'metric-label'), node('strong', value, 'metric-value'), node('p', description, 'metric-help'));
  return card;
}
function renderSummary(data) {
  const reduction = bestReduction(data.savings);
  const policies = policyCounts(data);
  const cards = [];
  cards.push(reduction
    ? metricCard('Recorded output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement + '. Results from different optimizers are not silently added together.', reduction.measurement === 'Measured local output' ? 'positive' : '')
    : metricCard('Recorded output', 'No result yet', 'Use a configured agent normally. Missing telemetry is not zero savings.'));
  cards.push(metricCard('5h / 7d allowance saved', 'Not measured yet', 'Current allowance can be read, but Token Harness will show minutes or plan credits saved only when paired allowance evidence proves the difference.'));
  cards.push(metricCard('API cost saved', 'Not measured yet', 'Local reductions are not converted into €/$ without billed-token evidence and a verified price basis.'));
  cards.push(metricCard('Quality', 'Guardrails active', 'Critical and difficult work keeps a minimum reasoning floor. Actual quality impact still requires paired task evidence.', 'quality'));
  $('impact-summary').replaceChildren(...cards);
  $('policy-count').textContent = policies.total ? policies.active + ' active · ' + policies.available + ' need attention or setup' : 'No policies observed yet';
}
function nextAction(data) {
  const box = $('next-action');
  box.replaceChildren();
  const title = node('h2', 'What to do next');
  const body = node('p');
  const actions = node('div', undefined, 'inline-actions');
  if (!data.agents.length) {
    body.textContent = 'Token Harness cannot optimize anything until Claude Code or Codex is available in the terminal that started this app.';
  } else {
    const unconfigured = data.agents.find(agent => !agent.configured);
    if (unconfigured) {
      body.textContent = unconfigured.name + ' is detected but has no supported optimizer configured. Review setup before enabling anything.';
      actions.append(actionButton({ kind: 'setup', label: 'Review setup', harness: unconfigured.id }, 'next-setup'));
    } else if (!data.savings.rows.length) {
      body.textContent = 'Your policies are configured. Keep using your coding agent normally; the next useful milestone is collecting enough evidence to show what actually changed.';
      actions.append(actionButton({ kind: 'help', label: 'How measurements work', topic: 'measurements' }, 'next-measure'));
    } else {
      const missingAllowance = data.agents.find(agent => !agent.allowance?.length);
      if (missingAllowance) {
        body.textContent = 'Output savings are being recorded. Add allowance visibility if you also want Token Harness to compare those results with your subscription windows.';
        actions.append(actionButton(missingAllowance.allowanceAction, 'next-allowance'));
      } else {
        body.textContent = 'No urgent setup action. Keep using your agents, then compare measured impact and quality evidence before enabling more aggressive policies.';
        const evidence = node('button', 'Review evidence', 'secondary');
        evidence.type = 'button';
        evidence.addEventListener('click', () => selectView('activity', true));
        actions.append(evidence);
      }
    }
  }
  box.append(title, body, actions);
}
function renderAgent(agent) {
  const card = node('article', undefined, 'panel agent');
  const head = node('div', undefined, 'agent-head');
  const title = node('div');
  title.append(node('h2', agent.name), node('span', agent.version ? 'v' + agent.version : 'version unavailable', 'caption'));
  head.append(title, node('span', agent.configured ? 'Configured' : 'Setup needed', 'pill ' + (agent.configured ? 'good' : 'warn')));
  card.append(head);

  const optimizer = node('div', undefined, 'agent-line');
  optimizer.append(node('span', 'Optimizer', 'key'), node('strong', agent.providers.length ? agent.providers.join(', ') : 'Not configured'));
  card.append(optimizer);

  const reasoning = node('div', undefined, 'agent-line');
  reasoning.append(node('span', 'Reasoning', 'key'), node('strong', agent.reasoning.label));
  reasoning.append(actionButton(agent.reasoning.action, agent.id + '-reasoning', 'text-button'));
  card.append(reasoning);

  if (agent.guidance) {
    const guidanceLine=node('div',undefined,'agent-line');
    guidanceLine.append(node('span','Guidance','key'),node('strong',agent.guidance.label));
    if(agent.guidance.action)guidanceLine.append(actionButton(agent.guidance.action,agent.id+'-guidance','text-button'));
    card.append(guidanceLine);
  }

  const allowance = node('div', undefined, 'allowance-strip');
  if (!agent.allowance?.length) {
    allowance.append(node('span', 'Allowance', 'key'), node('strong', 'Not available'));
    allowance.append(actionButton(agent.allowanceAction, agent.id + '-allowance', 'text-button'));
  } else {
    allowance.append(node('span', 'Allowance now', 'key'));
    for (const window of agent.allowance) {
      const text = window.remaining === null ? 'unknown' : count(window.remaining) + '% remaining';
      allowance.append(node('span', window.label + ': ' + text, 'allowance-chip'));
    }
  }
  card.append(allowance);

  const details = node('details', undefined, 'agent-details');
  details.append(node('summary', 'Why these settings matter'));
  details.append(node('p', agent.reasoning.description));
  if (agent.allowanceNote) details.append(node('p', agent.allowanceNote, 'caption'));
  card.append(details);
  return card;
}
function renderAgents(data) {
  $('agents').replaceChildren(...data.agents.map(renderAgent));
  $('agents').setAttribute('aria-busy', 'false');
  if (!data.agents.length) $('agents').append(node('p', 'No supported coding agent detected.', 'empty'));
  $('setup').disabled = working || !data.agents.length;
}
function renderRule(rule) {
  const card = node('article', undefined, 'rule');
  const head = node('div', undefined, 'rule-top');
  const text = node('div');
  text.append(node('h3', rule.title), node('span', rule.state, 'pill'));
  head.append(text);
  if (rule.action) head.append(actionButton(rule.action, rule.id + '-action', 'secondary'));
  card.append(head, node('p', rule.what));
  const details = node('details');
  details.append(node('summary', 'Trade-off and evidence'));
  details.append(node('p', 'Why it matters: ' + rule.why), node('p', 'Evidence: ' + rule.evidence, 'caption'));
  if (rule.next) details.append(node('p', 'Next: ' + rule.next));
  card.append(details);
  return card;
}
function renderRules(data) {
  const choices = [...data.agents.map(agent => ({ id: agent.id, name: agent.name })), { id: 'general', name: 'Decision & safety' }];
  if (!choices.some(item => item.id === selectedRules)) selectedRules = choices[0]?.id || 'general';
  const tabs = choices.map(item => {
    const button = node('button', item.name, item.id === selectedRules ? 'active' : '');
    button.type = 'button';
    button.addEventListener('click', () => { selectedRules = item.id; renderRules(data); });
    return button;
  });
  $('rule-filters').replaceChildren(...tabs);
  const list = selectedRules === 'general' ? data.rules : data.agents.find(agent => agent.id === selectedRules)?.rules || [];
  $('rules').replaceChildren(...list.map(renderRule));
  if (!list.length) $('rules').append(node('p', 'No policy information is available for this selection.', 'empty'));
}
function renderSavings(savings) {
  periodCache.set(savings.period, savings);
  $('savings').replaceChildren();
  $('savings').setAttribute('aria-busy', 'false');
  if (!savings.rows.length) {
    $('savings').append(node('p', 'No recorded reductions for this period. Missing data is not zero savings.', 'empty'));
  }
  for (const row of savings.rows) {
    const card = node('article', undefined, 'evidence-row');
    const head = node('div', undefined, 'evidence-head');
    head.append(node('h3', row.provider), node('span', row.measurement, 'pill'));
    card.append(head, node('strong', row.impact.headline, 'evidence-value'), node('p', row.impact.detail));
    const facts = node('dl', undefined, 'evidence-facts');
    const pairs = [
      ['Recorded change', row.before !== null && row.after !== null ? count(row.before) + ' → ' + count(row.after) + ' ' + row.unit : count(Math.abs(row.saved)) + ' ' + row.unit],
      ['Operations', count(row.operations)],
      ['Agents', row.agents.length ? row.agents.join(', ') : 'not attributed'],
    ];
    for (const [label, value] of pairs) { const wrap = node('div'); wrap.append(node('dt', label), node('dd', value)); facts.append(wrap); }
    card.append(facts);
    $('savings').append(card);
  }
  $('savings-dates').textContent = savings.firstRecordedAt ? 'Recorded ' + date(savings.firstRecordedAt) + ' → ' + date(savings.lastRecordedAt) : 'No recorded interval';
  const caveats = [];
  if (savings.errors) caveats.push(count(savings.errors) + ' records had errors');
  if (savings.inflated) caveats.push(count(savings.inflated) + ' potentially inflated operations');
  $('savings-quality').textContent = caveats.length ? caveats.join(' · ') : 'No telemetry quality warning in this view.';
  $('savings-note').textContent = savings.note;
  if (current) renderSummary({ ...current, savings });
}
function renderNotices(data) {
  $('notices').replaceChildren();
  if (!data.notices.length) return;
  const details = node('details', undefined, 'notice-box');
  details.append(node('summary', data.notices.length + ' item' + (data.notices.length === 1 ? '' : 's') + ' need review'));
  for (const notice of data.notices) details.append(node('p', notice));
  $('notices').append(details);
}
function render(data) {
  current = data;
  setError('');
  clearStale();
  setStatus('Checked at ' + new Date(data.generatedAt).toLocaleTimeString() + '. Data stays on screen until you choose Refresh.', false);
  renderSummary(data);
  nextAction(data);
  renderAgents(data);
  renderRules(data);
  renderSavings(data.savings);
  renderNotices(data);
  $('export').disabled = false;
  $('live-status').textContent = 'No automatic full refresh';
}
function renderActivity(data) {
  $('undo').hidden = !data.canUndo;
  const list = data.activity || [];
  $('activity').replaceChildren();
  if (!list.length) $('activity').append(node('p', 'No checks or changes in this dashboard session.', 'empty'));
  for (const item of list) {
    const row = node('div', undefined, 'activity-row');
    row.append(node('span', item.state, 'pill ' + (item.state === 'success' ? 'good' : item.state === 'attention' ? 'warn' : '')), node('span', item.message), node('time', new Date(item.at).toLocaleTimeString(), 'caption'));
    $('activity').append(row);
  }
}
async function activity() {
  if (activityPending) return;
  activityPending = true;
  try {
    const data = await request('/api/activity');
    renderActivity(data);
    if (reading && !periodReading && data.loading) {
      if (data.loading.agents) {
        const partial = { ...(current || { rules: [], savings: data.loading.savings || { period: $('period').value, rows: [], errors: 0, inflated: 0 } }), agents: data.loading.agents };
        renderAgents(partial);
      }
      if (data.loading.savings && !current) renderSavings(data.loading.savings);
    }
  } catch {}
  finally { activityPending = false; }
}
async function ensureSession() {
  if (csrf) return;
  csrf = (await request('/api/session')).token;
}
async function refresh(force = false) {
  if (working || reading) return;
  reading = true;
  periodReading = false;
  setError('');
  setStatus(current ? 'Refreshing current configuration. Existing results stay visible.' : 'First read: checking agents, allowance, policies and measurements…', true);
  $('refresh').disabled = true;
  try {
    await ensureSession();
    const period = $('period').value;
    const suffix = force ? '&refresh=1' : '';
    render(await request('/api/overview?period=' + encodeURIComponent(period) + suffix));
  } catch (e) {
    setError(e.name === 'TimeoutError' ? 'A read took too long. Existing data was kept; use Refresh to try again.' : e.message);
    setStatus(current ? 'Refresh failed. Existing data is still shown.' : 'Initial read failed.', false);
  } finally {
    reading = false;
    $('refresh').disabled = false;
    activity();
  }
}
async function changePeriod() {
  if (working || periodReading) return;
  const period = $('period').value;
  const cached = periodCache.get(period);
  if (cached) {
    renderSavings(cached);
    setStatus('Showing cached ' + period + ' evidence. Configuration was not re-read.', false);
    return;
  }
  periodReading = true;
  $('period').disabled = true;
  $('savings').setAttribute('aria-busy', 'true');
  $('savings-quality').textContent = 'Loading this evidence window. Agent cards and policies stay unchanged.';
  try {
    await ensureSession();
    const data = await request('/api/overview?period=' + encodeURIComponent(period));
    renderSavings(data.savings);
    setStatus('Updated the evidence period only in the UI. Current configuration stayed in place.', false);
  } catch (e) {
    setError(e.message);
  } finally {
    periodReading = false;
    $('period').disabled = false;
  }
}

$('approve').addEventListener('click', async () => {
  if (!ticket || working) return;
  const approved = ticket;
  ticket = null;
  setLocked(true);
  $('approve').hidden = true;
  $('review-content').replaceChildren(node('p', 'Applying only the reviewed change with backups and verification…'));
  try {
    const result = await request('/api/apply', { ticket: approved });
    renderResult(result);
    if (result.ok) markStale();
  } catch (e) {
    $('review-error').textContent = e.message + ' No automatic retry was made.';
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
    activity();
  }
});
$('task-review').addEventListener('click', () => preview({ action: 'effort', harness: $('harness').value, task: $('task').value }));
$('setup').addEventListener('click', () => preview({ action: 'setup' }));
$('verify').addEventListener('click', verify);
$('undo').addEventListener('click', () => preview({ action: 'undo' }));
$('refresh').addEventListener('click', () => refresh(true));
$('period').addEventListener('change', changePeriod);
$('measurement-help').addEventListener('click', () => showHelp('measurements'));
$('close').addEventListener('click', closeDialog);
$('review').addEventListener('cancel', event => { if (working) event.preventDefault(); else ticket = null; });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => selectView(button.dataset.view));
$('theme').addEventListener('change', () => {
  const theme = $('theme').value;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
});
$('export').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = 'token-harness-report.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

refresh(false);
setInterval(() => {
  if (!document.hidden && (reading || working || selectedView === 'activity')) activity();
}, 2000);
`;
