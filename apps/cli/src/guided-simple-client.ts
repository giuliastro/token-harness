/** Simple, action-first browser controller for the local guided UI. */
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
let csrf = '', current = null, ticket = null;
let working = false, reading = false, periodReading = false, activityPending = false;
let selectedView = 'overview', selectedRules = null, stale = false, dialogRun = 0;
const periodCache = new Map();
const VIEWS = {
  overview: ['Monitor', 'See what is working and what you are saving.'],
  rules: ['Actions', 'Choose what you want Token Harness to do.'],
  activity: ['Results', 'See measured savings and recent changes.'],
};
const HELP = {
  'claude-effort': ['Change reasoning in Claude', 'Inside Claude Code, use /effort. Token Harness keeps difficult work above its quality floor.', '/effort'],
  'codex-effort': ['Change reasoning in Codex', 'Inside Codex, use /model to review model and reasoning settings.', '/model'],
  'claude-tools': ['Review Claude tools', 'Inside Claude Code, use /mcp. Disable only tools you know you do not need.', '/mcp'],
  'codex-tools': ['Review Codex tools', 'Inside Codex, use /mcp. Fix or disable only tools you understand.', '/mcp'],
  measurements: ['How savings are measured', 'Token Harness reports only evidence it can defend. Local output reduction is not automatically converted into subscription minutes, weekly credits, API cost or quality.', null],
  cclimits: ['Show Claude allowance', 'Install the reviewed cclimits companion, keep Claude signed in, then refresh this dashboard.', 'npm install --global cclimits@1.7.0'],
  python: ['Python is required', 'Make Python 3 available in the terminal that starts Token Harness, then reopen Token Harness.', 'python --version'],
  'claude-login': ['Sign in to Claude', 'Sign in inside Claude Code. Keep credentials inside Claude.', null],
  compatibility: ['Check this integration', 'Use Check integrations for a read-only verification. Unsupported or ambiguous configurations are left unchanged.', null],
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
function markStale(message = 'A setting changed. These results show the previous state until you choose Refresh.') {
  stale = true;
  $('stale-state').hidden = false;
  $('stale-state').textContent = message;
}
function clearStale() {
  stale = false;
  $('stale-state').hidden = true;
  $('stale-state').textContent = '';
}
function setLocked(value, mutating = false) {
  working = value;
  document.querySelectorAll('[data-operation],#setup,#verify,#update-check,#undo,#refresh,#task-review,#optimize-action').forEach(element => {
    element.disabled = value;
  });
  $('approve').disabled = value;
  $('close').disabled = value && mutating;
  $('live-status').textContent = value
    ? (mutating ? 'Applying the approved change…' : 'Checking current settings…')
    : 'Nothing changes without your approval';
  if (!value && current) {
    $('setup').disabled = !current.agents?.length;
    $('optimize-action').disabled = !current.agents?.length;
    $('update-check').disabled = !(current.stack?.components || []).some(component => component.detectedState !== 'absent');
  }
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
  dialogRun += 1;
  $('review-title').textContent = title;
  $('review-content').replaceChildren();
  $('review-error').hidden = true;
  $('task-form').hidden = true;
  $('task-review').hidden = true;
  $('approve').hidden = true;
  $('close').disabled = false;
  $('close').textContent = 'Close';
  if (!$('review').open) $('review').showModal();
  return dialogRun;
}
function closeDialog() {
  if (working && $('close').disabled) return;
  dialogRun += 1;
  ticket = null;
  if ($('review').open) $('review').close();
}
function progress(message, detail) {
  const wrap = node('div', undefined, 'preview-change');
  const line = node('div', undefined, 'read-status');
  line.append(node('span', undefined, 'spinner'), node('strong', message));
  wrap.append(line);
  if (detail) wrap.append(node('p', detail, 'caption'));
  return wrap;
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
      try { await navigator.clipboard.writeText(help[2]); copy.textContent = 'Copied'; }
      catch { copy.textContent = 'Copy unavailable'; }
    });
    block.append(code, copy);
    $('review-content').append(block);
  }
}
function showTask(harness) {
  showDialog('Optimize reasoning');
  $('harness').value = harness || current?.agents?.[0]?.id || 'claude';
  $('task-form').hidden = false;
  $('task-review').hidden = false;
  $('task-review').disabled = false;
  $('task-review').textContent = 'Review recommendation';
  $('review-content').append(node('p', 'Choose the agent and the kind of work. Nothing changes until you review and approve the recommendation.'));
}
function previewTitle(body) {
  if (body.action === 'setup') return 'Set up optimizers';
  if (body.action === 'skill') return 'Enable guidance';
  if (body.action === 'undo') return 'Undo last change';
  if (body.action === 'remove') return 'Remove optimizer';
  return 'Optimize reasoning';
}
async function preview(body) {
  if (working || !csrf) return;
  const run = showDialog('Preparing…');
  setLocked(true, false);
  $('close').textContent = 'Cancel';
  $('review-content').append(progress('Checking current settings', 'Read-only. No change is being made.'));
  try {
    const data = await request('/api/preview', body);
    if (run !== dialogRun || !$('review').open) return;
    ticket = data.ticket;
    $('review-title').textContent = previewTitle(body);
    $('review-content').replaceChildren();
    if (!data.changes.length) $('review-content').append(node('p', 'No change is needed.'));
    for (const change of data.changes) {
      const item = node('article', undefined, 'preview-change');
      item.append(node('h3', change.title), node('p', change.description));
      $('review-content').append(item);
    }
    for (const notice of data.notices || []) $('review-content').append(node('p', notice, 'notice-row'));
    if (ticket) {
      $('approve').hidden = false;
      $('approve').textContent = 'Apply change';
      $('close').textContent = 'Cancel';
    } else {
      $('close').textContent = 'Done';
    }
  } catch (e) {
    if (run !== dialogRun) return;
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
    $('close').textContent = 'Close';
  } finally {
    if (run === dialogRun) setLocked(false, false);
  }
}
function renderResult(result) {
  const run = showDialog(result.ok ? 'Done' : 'Needs attention');
  const state = node('div', result.ok ? 'Completed' : 'Needs attention', 'result-state ' + (result.ok ? 'good' : 'warn'));
  $('review-content').append(state);
  for (const message of result.messages || []) $('review-content').append(node('p', message));
  $('close').textContent = 'Done';
  return run;
}
async function verify() {
  if (working || !csrf) return;
  const run = showDialog('Checking integrations');
  setLocked(true, false);
  $('close').textContent = 'Cancel';
  $('review-content').append(progress('Checking integrations', 'Read-only. No settings will change.'));
  try {
    const result = await request('/api/verify', {});
    if (run !== dialogRun) return;
    renderResult(result);
  } catch (e) {
    if (run === dialogRun) { $('review-error').textContent = e.message; $('review-error').hidden = false; }
  } finally {
    if (run === dialogRun) setLocked(false, false);
    activity();
  }
}
async function checkUpdates() {
  if (working || !csrf) return;
  const run = showDialog('Checking updates');
  setLocked(true, false);
  $('close').textContent = 'Cancel';
  $('review-content').append(progress('Checking optimizer updates', 'Read-only. Nothing will be installed.'));
  try {
    const result = await request('/api/update-check', {});
    if (run !== dialogRun) return;
    renderResult(result);
  } catch (e) {
    if (run === dialogRun) { $('review-error').textContent = e.message; $('review-error').hidden = false; }
  } finally {
    if (run === dialogRun) setLocked(false, false);
    activity();
  }
}

function policyCounts(data) {
  const all = [...(data.rules || []), ...(data.agents || []).flatMap(agent => agent.rules || [])];
  const inactive = all.filter(rule => /not enabled|setup|required|unavailable/i.test(rule.state)).length;
  return { active: Math.max(0, all.length - inactive), available: inactive, total: all.length };
}
function bestReduction(savings) {
  const rows = (savings?.rows || []).filter(row => row.impact?.kind === 'reduction');
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
function allowanceCard(value) {
  const five = value?.allowance5h;
  const weekly = value?.allowance7d;
  const fiveMeasured = five?.state === 'measured' && five.savedPercent !== null;
  const weeklyMeasured = weekly?.state === 'measured' && weekly.savedPercent !== null;
  const blocked = five?.state === 'blocked-by-quality' || weekly?.state === 'blocked-by-quality';
  if (blocked) {
    const candidate = five?.state === 'blocked-by-quality' ? five : weekly;
    return metricCard('5h / 7d allowance saved', 'Not credited', 'Savings are visible, but quality is measured and preserved before Token Harness credits them.', 'warn');
  }
  if (fiveMeasured || weeklyMeasured) {
    const parts = [];
    if (fiveMeasured) parts.push('5h ' + count(five.savedPercent) + '%');
    if (weeklyMeasured) parts.push('7d ' + count(weekly.savedPercent) + '%');
    const detail = [];
    if (fiveMeasured && five.equivalentMinutes !== null) detail.push('The 5h result is equivalent to about ' + count(five.equivalentMinutes) + ' minutes of that 300-minute allowance window.');
    if (weeklyMeasured) detail.push('The weekly percentage is not converted into wall-clock time.');
    return metricCard('5h / 7d allowance saved', parts.join(' · '), detail.join(' '), 'positive');
  }
  return metricCard('5h / 7d allowance saved', 'Not measured yet', 'Shown only with authoritative paired allowance evidence.');
}
function qualityCard(value) {
  const quality = value?.quality;
  if (quality?.state === 'regressed') return metricCard('Quality', 'Regression detected', 'Positive allowance savings are blocked until quality is recovered.', 'warn');
  if (quality?.state === 'preserved') return metricCard('Quality', 'Preserved', count(quality.pairs) + ' paired benchmark(s) support this result.', 'quality');
  return metricCard('Quality', 'Not measured yet', 'Token Harness does not claim preserved quality until paired benchmark evidence exists.', 'quality');
}
function renderSummary(data) {
  const reduction = bestReduction(data.savings);
  const policies = policyCounts(data);
  const cards = [];
  cards.push(reduction
    ? metricCard('Output saved', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement, reduction.measurement === 'Measured local output' ? 'positive' : '')
    : metricCard('Output saved', 'No result yet', 'Use a configured agent normally to collect evidence.'));
  cards.push(allowanceCard(data.value));
  cards.push(metricCard('API cost saved', 'Not measured yet', 'Requires billed-token evidence and a verified price basis.'));
  cards.push(qualityCard(data.value));
  $('impact-summary').replaceChildren(...cards);
  $('policy-count').textContent = policies.total ? policies.active + ' active · ' + policies.available + ' available' : 'No policies observed yet';
}
function renderMonitorStatus(data) {
  const policies = policyCounts(data);
  const unconfigured = (data.agents || []).filter(agent => !agent.configured);
  let title = 'Working';
  let detail = 'Token Harness is monitoring ' + (data.agents || []).length + ' coding agent' + ((data.agents || []).length === 1 ? '' : 's') + ' and recording available evidence.';
  let badge = 'OK';
  let cls = 'pill good';
  if (!(data.agents || []).length) {
    title = 'No coding agent detected'; detail = 'Open Token Harness from a terminal where Claude Code or Codex is available.'; badge = 'Setup needed'; cls = 'pill warn';
  } else if (data.value?.quality?.state === 'regressed') {
    title = 'Quality needs attention'; detail = 'A benchmark found a regression. Savings are not being credited.'; badge = 'Attention'; cls = 'pill warn';
  } else if (unconfigured.length) {
    title = 'Optimization can be improved'; detail = unconfigured.map(agent => agent.name).join(', ') + ' needs optimizer setup.'; badge = 'Action available'; cls = 'pill warn';
  }
  $('health-title').textContent = title;
  $('health-detail').textContent = detail;
  $('monitor-badge').textContent = badge;
  $('monitor-badge').className = cls;
  $('policy-count').textContent = policies.total ? policies.active + ' active · ' + policies.available + ' available' : 'No policies observed yet';
}
function nextAction(data) {
  const box = $('next-action');
  box.replaceChildren();
  const title = node('h2', 'Recommended');
  const body = node('p');
  const actions = node('div', undefined, 'inline-actions');
  if (data.value?.quality?.state === 'regressed') {
    body.textContent = 'Review the quality result before increasing savings.';
    const evidence = node('button', 'Review quality evidence', 'secondary');
    evidence.type = 'button'; evidence.addEventListener('click', () => selectView('activity', true)); actions.append(evidence);
  } else if (!data.agents.length) {
    body.textContent = 'Connect Claude Code or Codex first.';
  } else {
    const unconfigured = data.agents.find(agent => !agent.configured);
    if (unconfigured) {
      body.textContent = unconfigured.name + ' can be optimized.';
      actions.append(actionButton({ kind: 'setup', label: 'Set up', harness: unconfigured.id }, 'next-setup'));
    } else if (!data.savings.rows.length) {
      body.textContent = 'Setup is ready. Use your coding agent normally; results will appear here.';
    } else {
      body.textContent = 'No urgent action. Review results when you want to tune further.';
      const results = node('button', 'View results', 'secondary');
      results.type = 'button'; results.addEventListener('click', () => selectView('activity', true)); actions.append(results);
    }
  }
  box.append(title, body, actions);
}
function renderAgent(agent) {
  const card = node('article', undefined, 'panel agent');
  const head = node('div', undefined, 'agent-head');
  const title = node('div');
  title.append(node('h2', agent.name), node('span', agent.version ? 'v' + agent.version : 'version unavailable', 'caption'));
  head.append(title, node('span', agent.configured ? 'Ready' : 'Setup needed', 'pill ' + (agent.configured ? 'good' : 'warn')));
  card.append(head);
  const optimizer = node('div', undefined, 'agent-line');
  optimizer.append(node('span', 'Optimizer', 'key'), node('strong', agent.providers.length ? agent.providers.join(', ') : 'Not configured'));
  card.append(optimizer);
  const reasoning = node('div', undefined, 'agent-line');
  reasoning.append(node('span', 'Reasoning', 'key'), node('strong', agent.reasoning.label), actionButton({ ...agent.reasoning.action, label: 'Change' }, agent.id + '-reasoning', 'text-button'));
  card.append(reasoning);
  const allowance = node('div', undefined, 'allowance-strip');
  allowance.append(node('span', 'Allowance', 'key'));
  if (!agent.allowance?.length) allowance.append(node('strong', 'Not available'), actionButton(agent.allowanceAction, agent.id + '-allowance', 'text-button'));
  else for (const window of agent.allowance) allowance.append(node('span', window.label + ': ' + (window.remaining === null ? 'unknown' : count(window.remaining) + '% left'), 'allowance-chip'));
  card.append(allowance);
  const details = node('details', undefined, 'agent-details');
  details.append(node('summary', 'Details'), node('p', agent.reasoning.description, 'caption'));
  if (agent.guidance) details.append(node('p', 'Guidance: ' + agent.guidance.label, 'caption'));
  if (agent.allowanceNote) details.append(node('p', agent.allowanceNote, 'caption'));
  card.append(details);
  return card;
}
function renderAgents(data) {
  $('agents').replaceChildren(...data.agents.map(renderAgent));
  $('agents').setAttribute('aria-busy', 'false');
  if (!data.agents.length) $('agents').append(node('p', 'No supported coding agent detected.', 'empty'));
  $('setup').disabled = working || !data.agents.length;
  $('optimize-action').disabled = working || !data.agents.length;
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
  details.append(node('summary', 'Details'), node('p', rule.why), node('p', rule.evidence, 'caption'));
  if (rule.next) details.append(node('p', rule.next, 'caption'));
  card.append(details);
  return card;
}
function renderRules(data) {
  const choices = [...data.agents.map(agent => ({ id: agent.id, name: agent.name })), { id: 'general', name: 'Other' }];
  if (!choices.some(item => item.id === selectedRules)) selectedRules = choices[0]?.id || 'general';
  const tabs = choices.map(item => {
    const button = node('button', item.name, item.id === selectedRules ? 'active' : '');
    button.type = 'button'; button.addEventListener('click', () => { selectedRules = item.id; renderRules(data); }); return button;
  });
  $('rule-filters').replaceChildren(...tabs);
  const list = selectedRules === 'general' ? data.rules : data.agents.find(agent => agent.id === selectedRules)?.rules || [];
  $('rules').replaceChildren(...list.map(renderRule));
  if (!list.length) $('rules').append(node('p', 'No other actions here.', 'empty'));
}
function renderSavings(savings) {
  periodCache.set(savings.period, savings);
  $('savings').replaceChildren(); $('savings').setAttribute('aria-busy', 'false');
  if (!savings.rows.length) $('savings').append(node('p', 'No measured result for this period yet.', 'empty'));
  for (const row of savings.rows) {
    const card = node('article', undefined, 'evidence-row');
    const head = node('div', undefined, 'evidence-head');
    head.append(node('h3', row.provider), node('span', row.measurement, 'pill'));
    card.append(head, node('strong', row.impact.headline, 'evidence-value'), node('p', row.impact.detail));
    const facts = node('dl', undefined, 'evidence-facts');
    const pairs = [
      ['Change', row.before !== null && row.after !== null ? count(row.before) + ' → ' + count(row.after) + ' ' + row.unit : count(Math.abs(row.saved)) + ' ' + row.unit],
      ['Operations', count(row.operations)],
      ['Agents', row.agents.length ? row.agents.join(', ') : 'not attributed'],
    ];
    for (const [label, value] of pairs) { const wrap = node('div'); wrap.append(node('dt', label), node('dd', value)); facts.append(wrap); }
    card.append(facts); $('savings').append(card);
  }
  $('savings-dates').textContent = savings.firstRecordedAt ? date(savings.firstRecordedAt) + ' → ' + date(savings.lastRecordedAt) : 'No recorded interval';
  const caveats = [];
  if (savings.errors) caveats.push(count(savings.errors) + ' errors');
  if (savings.inflated) caveats.push(count(savings.inflated) + ' results need review');
  $('savings-quality').textContent = caveats.length ? caveats.join(' · ') : 'No telemetry warning.';
  $('savings-note').textContent = savings.note;
  if (current) renderSummary({ ...current, savings });
}
function renderNotices(data) {
  $('notices').replaceChildren();
  if (!data.notices.length) return;
  const details = node('details', undefined, 'notice-box');
  details.append(node('summary', data.notices.length + ' item' + (data.notices.length === 1 ? '' : 's') + ' need attention'));
  for (const notice of data.notices) details.append(node('p', notice));
  $('notices').append(details);
}
function render(data) {
  current = data; setError(''); clearStale();
  setStatus('Checked ' + new Date(data.generatedAt).toLocaleTimeString() + '. Refresh only when you want a new full check.', false);
  renderMonitorStatus(data); renderSummary(data); nextAction(data); renderAgents(data); renderRules(data); renderSavings(data.savings); renderNotices(data);
  $('update-check').disabled = !(data.stack?.components || []).some(component => component.detectedState !== 'absent');
  $('export').disabled = false;
  $('live-status').textContent = 'Nothing changes without your approval';
}
function renderActivity(data) {
  $('undo').hidden = !data.canUndo;
  const list = data.activity || [];
  $('activity').replaceChildren();
  if (!list.length) $('activity').append(node('p', 'No checks or changes in this session.', 'empty'));
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
    if (reading && !periodReading && data.loading?.agents) {
      const partial = { ...(current || { rules: [], savings: data.loading.savings || { period: $('period').value, rows: [], errors: 0, inflated: 0 } }), agents: data.loading.agents };
      renderAgents(partial);
    }
    if (reading && !current && data.loading?.savings) renderSavings(data.loading.savings);
  } catch {}
  finally { activityPending = false; }
}
async function ensureSession() {
  if (csrf) return;
  csrf = (await request('/api/session')).token;
}
async function refresh(force = false) {
  if (working || reading) return;
  reading = true; periodReading = false; setError('');
  setStatus(current ? 'Refreshing. Current results stay visible.' : 'Checking your agents and optimizers…', true);
  $('refresh').disabled = true;
  try {
    await ensureSession();
    const period = $('period').value;
    const suffix = force ? '&refresh=1' : '';
    render(await request('/api/overview?period=' + encodeURIComponent(period) + suffix));
  } catch (e) {
    setError(e.name === 'TimeoutError' ? 'The check took too long. Current data was kept; try Refresh again.' : e.message);
    setStatus(current ? 'Refresh failed. Current data is still shown.' : 'Initial check failed.', false);
  } finally {
    reading = false; $('refresh').disabled = false; activity();
  }
}
async function changePeriod() {
  if (working || periodReading) return;
  const period = $('period').value;
  const cached = periodCache.get(period);
  if (cached) { renderSavings(cached); setStatus('Showing cached ' + period + ' results. Agent settings were not re-read.', false); return; }
  periodReading = true; $('period').disabled = true; $('savings').setAttribute('aria-busy', 'true');
  try {
    await ensureSession();
    const data = await request('/api/overview?period=' + encodeURIComponent(period));
    renderSavings(data.savings); setStatus('Updated the results period only.', false);
  } catch (e) { setError(e.message); }
  finally { periodReading = false; $('period').disabled = false; }
}

$('approve').addEventListener('click', async () => {
  if (!ticket || working) return;
  const approved = ticket; ticket = null;
  const run = dialogRun;
  setLocked(true, true); $('approve').hidden = true; $('close').textContent = 'Applying…';
  $('review-content').replaceChildren(progress('Applying approved change', 'Keep this window open until it finishes.'));
  try {
    const result = await request('/api/apply', { ticket: approved });
    if (run !== dialogRun) return;
    renderResult(result);
    if (result.ok) markStale();
  } catch (e) {
    if (run === dialogRun) { $('review-error').textContent = e.message + ' No automatic retry was made.'; $('review-error').hidden = false; }
  } finally {
    if (run === dialogRun) setLocked(false, false);
    activity();
  }
});
$('task-review').addEventListener('click', () => preview({ action: 'effort', harness: $('harness').value, task: $('task').value }));
$('optimize-action').addEventListener('click', () => showTask(current?.agents?.[0]?.id));
$('setup').addEventListener('click', () => preview({ action: 'setup' }));
$('verify').addEventListener('click', verify);
$('update-check').addEventListener('click', checkUpdates);
window.addEventListener('token-harness:remove-provider', event => {
  const provider = event?.detail?.provider;
  if (provider === 'rtk' || provider === 'harnesstrim') preview({ action: 'remove', provider });
});
$('undo').addEventListener('click', () => preview({ action: 'undo' }));
$('refresh').addEventListener('click', () => refresh(true));
$('period').addEventListener('change', changePeriod);
$('measurement-help').addEventListener('click', () => showHelp('measurements'));
$('close').addEventListener('click', closeDialog);
$('review').addEventListener('cancel', event => { if (working && $('close').disabled) event.preventDefault(); else closeDialog(); });
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => selectView(button.dataset.view));
$('theme').addEventListener('change', () => {
  const theme = $('theme').value;
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
});
$('export').addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' }));
  const link = node('a'); link.href = url; link.download = 'token-harness-report.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
refresh(false);
setInterval(() => {
  if (!document.hidden && (reading || working || selectedView === 'activity')) activity();
}, 2000);
`;