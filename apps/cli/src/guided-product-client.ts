/** Single-owner browser controller for the novice-facing local product UI. */
import { GUIDE_OPTIMIZER_INFO } from './guided-optimizer-info.js';

export const GUIDE_PRODUCT_JS = String.raw`
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const count = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  const date = value => value ? new Date(value).toLocaleString() : 'not recorded';
  const VIEWS = {
    dashboard: ['Overview', 'Your setup, results and next steps.'],
    results: ['Results', 'See what changed and the evidence behind it.'],
  };
  const TOOL_INFO = ${JSON.stringify(GUIDE_OPTIMIZER_INFO)};
  const EXPERIMENTAL = [];
  const CATEGORY = {
    'command-output-reduction': 'Command output',
    'context-minimization': 'Context optimization',
    'repository-exploration': 'Repository exploration',
    'repository-retrieval': 'Repository exploration',
    'mcp-discovery': 'MCP discovery',
  };

  let csrf = '';
  let current = null;
  let activityState = null;
  let busy = false;
  let reading = false;
  let selectedView = 'dashboard';
  let modalRun = 0;
  let pendingTicket = null;
  let updateCheckStarted = false;
  const periodCache = new Map();
  const openExplanations = new Set();

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

  async function ensureSession() {
    if (csrf) return;
    csrf = (await request('/api/session')).token;
  }

  function setStatus(message, spinning = false) {
    $('updated').textContent = message;
    $('reading-spinner').hidden = !spinning;
  }

  function setError(message) {
    $('error').textContent = message || '';
    $('error').hidden = !message;
  }

  function setBusy(value, applying = false) {
    busy = value;
    document.querySelectorAll('[data-action],#refresh,#period,#evidence-filter,#evidence-type,#evidence-sort').forEach(element => {
      element.disabled = value;
    });
    $('live-status').textContent = value
      ? (applying ? 'Applying only the approved change…' : 'Reading current state…')
      : 'Nothing changes without your approval';
  }

  function selectView(view, focus = false) {
    if (!VIEWS[view]) return;
    selectedView = view;
    for (const key of Object.keys(VIEWS)) {
      const active = key === view;
      $('view-' + key).hidden = !active;
      $('tab-' + key).setAttribute('aria-selected', String(active));
      $('tab-' + key).tabIndex = active ? 0 : -1;
    }
    $('view-title').textContent = VIEWS[view][0];
    $('view-description').textContent = VIEWS[view][1];
    if (view === 'results') loadActivity();
    if (focus) {
      $('tab-' + view).focus();
      $('main').scrollIntoView({ block: 'start' });
    }
  }

  function navigateButton(label, view, cls = 'secondary') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.dataset.action = 'navigate-' + view;
    button.addEventListener('click', () => selectView(view, true));
    return button;
  }

  function actionButton(label, handler, cls = '') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.dataset.action = 'product';
    button.disabled = busy;
    button.addEventListener('click', handler);
    return button;
  }

  function pill(label, state = '') {
    return node('span', label, 'pill ' + state);
  }

  function sectionEmpty(text) {
    return node('p', text, 'empty');
  }

  function copyRow(command) {
    const block = node('div', undefined, 'command-block');
    const code = node('code', command);
    const copy = actionButton('Copy', async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      } catch {
        copy.textContent = 'Select command';
      }
    }, 'secondary');
    block.append(code, copy);
    return block;
  }

  function modal(title) {
    modalRun += 1;
    pendingTicket = null;
    $('modal-title').textContent = title;
    $('modal-content').replaceChildren();
    $('modal-actions').replaceChildren();
    $('modal-error').hidden = true;
    $('modal-error').textContent = '';
    if (!$('modal').open) $('modal').showModal();
    return modalRun;
  }

  function modalClose(label = 'Close', disabled = false) {
    const close = actionButton(label, () => {
      if (disabled) return;
      modalRun += 1;
      pendingTicket = null;
      if ($('modal').open) $('modal').close();
    }, 'secondary');
    close.disabled = disabled;
    return close;
  }

  function closeModal() {
    if (!$('modal').open) return;
    modalRun += 1;
    pendingTicket = null;
    $('modal').close();
  }

  function progress(title, detail) {
    const wrap = node('div', undefined, 'operation-progress');
    const line = node('div', undefined, 'read-status');
    line.append(node('span', undefined, 'spinner'), node('strong', title));
    wrap.append(line);
    if (detail) wrap.append(node('p', detail, 'caption'));
    return wrap;
  }

  function messageBox(title, text, cls = '') {
    const box = node('div', undefined, 'explain-box ' + cls);
    box.append(node('strong', title), node('p', text));
    return box;
  }

  function projectLink(label, url, accessibleLabel) {
    const link = node('a', label, 'project-link');
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.setAttribute('aria-label', accessibleLabel + ' (opens in a new tab)');
    const icon = node('span', '↗', 'external-link-icon');
    icon.setAttribute('aria-hidden', 'true');
    link.append(icon);
    return link;
  }

  function explanation(key, label, cls = '') {
    const details = node('details', undefined, 'feature-explanation ' + cls);
    details.dataset.key = key;
    details.open = openExplanations.has(key);
    details.append(node('summary', label));
    details.addEventListener('toggle', () => {
      if (details.open) openExplanations.add(key);
      else openExplanations.delete(key);
    });
    return details;
  }

  function optimizerExplanation(id, info) {
    const details = explanation('optimizer:' + id, 'When is ' + info.name + ' useful?', 'optimizer-explanation');
    const body = node('div', undefined, 'explanation-grid');
    body.append(
      messageBox('When to consider it', info.useful || info.role),
      messageBox('How it works', info.mechanism || 'Review the project documentation for this optimizer’s mechanism.'),
      messageBox('Before you install', info.limitation || 'Check compatibility and measure the benefit on your own workload.'),
    );
    const claim = messageBox('What the project reports', info.claim?.context || 'No published benchmark is included for this optimizer.');
    if (info.claim?.source)
      claim.append(projectLink('Benchmark & methodology', info.claim.source, info.name + ' benchmark and methodology'));
    body.append(claim);
    details.append(body);
    return details;
  }

  function routingExplanation(agentId) {
    const details = explanation('routing:' + agentId, 'How routing works', 'routing-explanation');
    const model = agentId === 'codex' ? 'gpt-6-luna (or gpt-6.1-sol below Astra)' : 'Haiku or Sonnet, below your main model';
    details.append(
      messageBox('One prompt, a focused helper', 'On each submitted prompt, a local hook asks your coding agent to consider one native subagent for a substantial, independent piece of work. For example, the helper can research a module while the main agent implements the change.'),
      messageBox('The main agent stays in charge', 'The policy requests ' + model + ' when available. Your main model reviews and integrates the result. Trivial edits, tightly coupled work, architecture, security and release decisions stay with the main agent.'),
      messageBox('When it helps', 'Useful when a bounded task can run independently. Delegation can also add overhead and increase total usage; a cheaper helper alone does not prove token or subscription savings.'),
      messageBox('How to verify it', (agentId === 'codex' ? 'After enabling, review and trust the hook in Codex /hooks. ' : 'After enabling, start a new session so the hook is loaded. ') + 'A callback proves the hook ran; it does not prove delegation or savings. Results credit savings only from paired runs that pass the quality gate.'),
    );
    return details;
  }

  function activeAgents() {
    return current?.agents || [];
  }

  function agentName(id) {
    return id === 'claude' ? 'Claude Code' : id === 'codex' ? 'Codex' : id;
  }

  function managedComponent(id) {
    return (current?.stack?.components || []).find(component => component.providerId === id) || null;
  }

  function optimizerInfo(id) {
    const known = TOOL_INFO[id];
    if (known) return known;
    const component = managedComponent(id);
    const category = CATEGORY[component?.category] || component?.category || 'Optimization';
    return {
      name: component?.displayName || id,
      role: category + ' optimizer managed through the common Token Harness lifecycle.',
      managed: true,
      optional: !['rtk', 'harnesstrim'].includes(id),
    };
  }

  function optimizerIds() {
    const ids = (current?.stack?.components || []).map(component => component.providerId).filter(Boolean);
    return [...new Set([...Object.keys(TOOL_INFO), ...ids])];
  }

  function configuredProviders() {
    return (current?.stack?.components || []).filter(component => component.configured);
  }

  function setupTarget(agentId, providerId) {
    const agent = activeAgents().find(item => item.id === agentId);
    return agent?.setup?.find(item => item.providerId === providerId) || null;
  }

  function baselineStatusFor(agentId) {
    const targets = ['rtk', 'harnesstrim']
      .map(providerId => setupTarget(agentId, providerId))
      .filter(Boolean);
    const actionable = targets.filter(target => target.state === 'actionable');
    const unavailable = targets.filter(target => target.state === 'unavailable');
    const connected = targets.filter(target => target.state === 'connected');
    if (actionable.length)
      return {
        state: 'incomplete',
        label: 'Setup available',
        cls: 'warn',
        actionable,
        unavailable,
        connected,
      };
    if (unavailable.length && connected.length === 0)
      return {
        state: 'unavailable',
        label: 'Setup unavailable',
        cls: '',
        actionable,
        unavailable,
        connected,
      };
    if (unavailable.length)
      return {
        state: 'limited',
        label: 'Setup detected',
        cls: 'good',
        actionable,
        unavailable,
        connected,
      };
    return {
      state: 'ready',
      label: 'Ready',
      cls: 'good',
      actionable,
      unavailable,
      connected,
    };
  }

  function baselineIncompleteAgents() {
    return activeAgents().filter(agent => baselineStatusFor(agent.id).state === 'incomplete');
  }

  function baselineUnavailableAgents() {
    return activeAgents().filter(agent => baselineStatusFor(agent.id).state === 'unavailable');
  }

  function candidateObservation(id) {
    return (current?.optimizationCandidates || []).find(item => item.id === id) || null;
  }

  function candidateEvidence(id) {
    return (current?.value?.candidates || []).find(item => item.candidateId === id) || null;
  }

  function bestReduction() {
    const rows = (current?.savings?.rows || []).filter(row => row.impact?.kind === 'reduction');
    rows.sort((a, b) => {
      const measured = row => row.measurement === 'Measured local output' ? 1 : 0;
      const pa = Number.parseFloat(String(a.impact?.percent || '0')) || 0;
      const pb = Number.parseFloat(String(b.impact?.percent || '0')) || 0;
      return measured(b) - measured(a) || pb - pa;
    });
    return rows[0] || null;
  }

  function qualitySummary() {
    const quality = current?.value?.quality;
    if (quality?.state === 'regressed') return { value: 'Regression detected', detail: 'Savings claims are blocked until quality is recovered.', cls: 'warn' };
    if (quality?.state === 'preserved') return { value: 'Preserved', detail: count(quality.pairs) + ' paired benchmark(s) support this result.', cls: 'good' };
    return { value: current?.value?.comparisons?.available === false ? 'Evidence unavailable' : 'Comparison needed', detail: comparisonReason('quality'), cls: '' };
  }

  function comparisonReason(topic) {
    const comparisons = current?.value?.comparisons;
    if (comparisons?.available === false) return 'Benchmark evidence could not be read. Refresh to retry.';
    if (comparisons?.incomplete) return count(comparisons.incomplete) + ' comparison(s) are unfinished. Finish both task variants, then Refresh.';
    if (comparisons?.invalid) return count(comparisons.invalid) + ' comparison(s) could not be validated. Capture a new matched pair.';
    if (comparisons?.complete) return topic === 'quality'
      ? 'Task checks are missing or failed for the recorded comparisons. Record the actual quality outcome for both runs.'
      : 'Recorded comparisons lack authoritative quota readings in matching windows. Live balances alone do not measure savings.';
    return 'No baseline/optimized task comparison for this project.' +
      (comparisons?.otherProject ? ' Comparisons recorded in other projects are outside this view.' : '') +
      ' Use Record a comparison to capture usage and quality checks.';
  }

  function allowanceSignal(evidence, label) {
    if (evidence?.state === 'blocked-by-quality') return { value: 'Not credited', label: label + ' · quality gate did not pass', tone: 'warn' };
    if (evidence?.state !== 'measured' || evidence.savedPercent === null || evidence.savedPercent === undefined) return null;
    const value = evidence.savedPercent;
    return { value: count(Math.abs(value)) + ' percentage points ' + (value < 0 ? 'more used' : value > 0 ? 'saved' : 'net change'), label, tone: value < 0 ? 'warn' : value > 0 ? 'good' : '' };
  }

  function allowanceSummary() {
    const five = current?.value?.allowance5h;
    const weekly = current?.value?.allowance7d;
    if (!current?.value?.byHarness?.length && (five?.state === 'blocked-by-quality' || weekly?.state === 'blocked-by-quality'))
      return { value: 'Not credited', detail: 'A quota reduction exists, but quality evidence does not yet allow it to be credited.', cls: 'warn' };
    const sources = current?.value?.byHarness?.length ? current.value.byHarness : [{ allowance5h: five, allowance7d: weekly }];
    const signals = sources.flatMap(source => [['allowance5h', '5h'], ['allowance7d', '7d']].flatMap(([key, label]) => {
      const signal = allowanceSignal(source[key], (source.harnessId ? agentName(source.harnessId) + ' · ' : '') + label);
      return signal ? [signal] : [];
    }));
    if (signals.length) return { value: signals.length === 1 ? signals[0].value : 'Paired readings', detail: signals.map(signal => signal.label + ': ' + signal.value).join(' · '), cls: signals.some(signal => signal.tone === 'warn') ? 'warn' : 'good' };
    const live = activeAgents().some(agent => (agent.allowance || []).some(window => Number.isFinite(window.remaining)));
    return { value: current?.value?.comparisons?.available === false ? 'Evidence unavailable' : 'Comparison needed', detail: (live ? 'Current quota is being read; savings need a comparison. ' : '') + comparisonReason('allowance'), cls: '' };
  }

  function metricCard(title, value, detail, cls = '') {
    const card = node('article', undefined, 'metric-card ' + cls);
    card.append(node('span', title, 'metric-label'), node('strong', value, 'metric-value'), node('p', detail, 'metric-help'));
    return card;
  }

  function setupAssessment() {
    const agents = activeAgents();
    const incomplete = baselineIncompleteAgents();
    const stack = current?.stack;
    if (!agents.length)
      return {
        label: 'Agent needed',
        cls: 'warn',
        title: 'Install or expose Claude Code or Codex first',
        detail: 'Token Harness could not find a supported coding agent in the environment that started this app.',
        action: 'none',
      };
    if (current?.value?.quality?.state === 'regressed')
      return {
        label: 'Needs attention',
        cls: 'warn',
        title: 'Measured quality needs attention',
        detail: 'A paired benchmark favored the baseline. Affected savings are not credited.',
        action: 'results',
      };
    const routingAttention = agents.filter(agent => agent.promptRouting?.needsRepair ||
      (agent.promptRouting?.configured === true && ['untrusted', 'disabled', 'unknown'].includes(agent.promptRouting.enablement)));
    if (routingAttention.length)
      return {
        label: 'Routing action required',
        cls: 'warn',
        title: 'Automatic routing needs attention',
        detail: routingAttention.map(agent => agent.name + ': ' + (agent.promptRouting.detail ||
          (agent.promptRouting.enablement === 'untrusted' ? 'Trust the hook in /hooks, then submit a prompt.' : 'Review the hook status in the coding app.'))).join(' '),
        action: 'routing',
      };
    if (stack?.state === 'attention')
      return {
        label: 'Needs attention',
        cls: 'warn',
        title: 'One configured optimizer needs attention',
        detail: 'Use Re-check health below to see whether the configured integration still matches the provider and agent state currently installed.',
        action: 'verify',
      };
    if (incomplete.length)
      return {
        label: 'Setup available',
        cls: 'warn',
        title: 'Connect your optimization stack',
        detail: 'Review the recommended optimizers for your coding apps.',
        action: 'configure',
      };
    const unavailable = baselineUnavailableAgents();
    if (unavailable.length)
      return {
        label: 'Setup unavailable',
        cls: '',
        title: 'No automatic optimizer setup is currently available',
        detail: 'The installed optimizers do not offer a compatible managed connection for these apps.',
        action: 'none',
      };
    if (!(current?.savings?.rows || []).length)
      return {
        label: 'Setup detected',
        cls: 'good',
        title: 'Recommended setup is complete',
        detail: 'Use your coding apps normally. Results will show recorded activity; setup alone is not runtime proof.',
        action: 'results',
      };
    return {
      label: 'Ready',
      cls: 'good',
      title: 'Your setup has been checked',
      detail: 'No setup action required. Open Results to inspect recorded changes.',
      action: 'results',
    };
  }

  function renderNotices() {
    const root = $('notices');
    root.replaceChildren();
    for (const notice of current?.notices || []) {
      const box = node('div', notice, 'notice-box');
      root.append(box);
    }
  }

  function renderDashboard() {
    const assessment = setupAssessment();
    $('dashboard-status').replaceChildren();
    const main = node('div');
    main.append(node('span', 'CURRENT STATUS', 'eyebrow'), node('h2', assessment.title), node('p', assessment.detail));
    const actions = node('div', undefined, 'inline-actions');
    if (assessment.action === 'verify') {
      actions.append(actionButton('Re-check health', () => readOnlyOperation('verify')));
    } else if (assessment.action === 'routing') {
      actions.append(actionButton('Review routing', () => $('coding-agents').scrollIntoView({ block: 'start' })));
    } else if (assessment.action === 'results') {
      if (current?.value?.quality?.state === 'regressed')
        actions.append(navigateButton('Review quality evidence', 'results', ''));
    } else if (assessment.action === 'configure') {
      actions.append(actionButton('Review recommended setup', () => reviewSetup()));
    }
    if (actions.children.length) main.append(actions);
    $('dashboard-status').append(main, pill(assessment.label, assessment.cls));

    const reduction = bestReduction();
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    $('dashboard-metrics').replaceChildren(
      reduction
        ? metricCard('Recorded output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement + ' · changed outputs only', 'positive')
        : metricCard('Recorded output', 'No result yet', 'Use a connected app to start recording results.'),
      metricCard('Allowance saved · 5h / 7d', allowance.value, allowance.detail, allowance.cls),
      metricCard('Quality', quality.value, quality.detail, quality.cls),
    );
  }

  function componentState(id, component) {
    if (!component || component.detectedState === 'absent') return { label: 'Not installed', cls: '' };
    if (component.health === 'attention') return { label: 'Needs attention', cls: 'warn' };
    const targets = activeAgents().map(agent => setupTarget(agent.id, id)).filter(Boolean);
    const connectedHere = targets.some(target => target.state === 'connected');
    const actionableHere = targets.some(target => target.state === 'actionable');
    if (component.installed && actionableHere && connectedHere)
      return { label: 'Setup found · more available', cls: 'warn' };
    if (component.installed && actionableHere)
      return { label: 'Installed · setup available', cls: 'warn' };
    if (connectedHere)
      return {
        label: 'Setup detected',
        cls: 'good',
      };
    if (component.installed && targets.some(target => target.state === 'unavailable'))
      return { label: 'Installed · no automatic setup', cls: '' };
    if (component.configured) return { label: 'Setup detected elsewhere', cls: '' };
    if (component.installed) return { label: 'Installed', cls: '' };
    return { label: 'Not installed', cls: '' };
  }

  function setupChoiceData(providerId) {
    const providers = providerId ? [providerId] : ['rtk', 'harnesstrim'];
    return activeAgents()
      .map(agent => ({
        agent,
        targets: providers
          .map(id => ({ id, target: setupTarget(agent.id, id) }))
          .filter(item => item.target),
      }))
      .filter(choice => choice.targets.some(item => item.target.state === 'actionable'));
  }

  function setupChoiceSummary(choice) {
    return choice.targets
      .map(item => optimizerInfo(item.id).name + ': ' + connectionPresentation(item.target).label)
      .join(' · ');
  }

  function setupChoiceLimitations(choice) {
    return choice.targets
      .filter(item => item.target.state === 'unavailable' || item.target.state === 'not-applicable')
      .map(item => optimizerInfo(item.id).name + ': ' + item.target.reason)
      .join(' ');
  }

  function renderAgentSetup() {
    const root = $('setup-agents');
    root.replaceChildren();
    if (!activeAgents().length) {
      root.append(
        messageBox(
          'No supported coding agent detected',
          'Start Token Harness from a terminal where a supported coding agent is installed and available on PATH, then choose Refresh.',
          'warn',
        ),
      );
      return;
    }
    for (const agent of activeAgents()) {
      const baseline = baselineStatusFor(agent.id);
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(
        node('h3', agent.name),
        node('span', agent.version ? 'v' + agent.version : 'Version unavailable', 'caption'),
      );
      head.append(title, pill(baseline.label, baseline.cls));
      const detail =
        baseline.state === 'incomplete'
          ? baseline.actionable.map(target => target.provider).join(', ') +
            ' can be set up from the Optimization stack below.'
          : baseline.state === 'unavailable'
            ? 'No managed baseline connection is currently available for this agent.'
            : 'Optimizer setup detected. Recorded activity appears in Results.';
      card.append(head, node('p', detail));
      card.append(
        node(
          'p',
          agent.providers?.length
            ? 'Detected optimizer setup: ' + agent.providers.join(', ')
            : 'Detected optimizer setup: none yet',
          'caption',
        ),
      );
      const routing = agent.promptRouting;
      const routingConfigured = routing?.configured === true || routing?.enablement === 'enabled' || routing?.enablement === 'untrusted' || (!routing?.enablement && routing?.state === 'managed');
      const routingObserved = routing?.verificationTier === 'runtime-observed';
      const routingLabel = routingObserved ? 'Active · callback seen' : routing?.needsRepair ? 'Repair required' : routing?.enablement === 'untrusted' ? 'Trust required' : routing?.enablement === 'disabled' ? 'Hooks disabled' : routing?.configured !== false && routing?.enablement === 'unknown' ? 'Authorization unknown' : routingConfigured ? 'Enabled · awaiting callback' : routing?.state === 'external' ? 'Managed elsewhere' : 'Not enabled';
      const routingCard = node('div', undefined, 'routing-feature');
      const routingHead = node('div', undefined, 'tool-head');
      routingHead.append(
        node('strong', 'Automatic prompt routing'),
        pill(routingLabel, routingObserved ? 'good' : routingConfigured || routing?.needsRepair ? 'warn' : ''),
      );
      routingCard.append(
        routingHead,
        node('p', 'Lets your agent delegate suitable work to a smaller native helper while your main model stays in charge.', 'caption'),
        node(
          'p',
          routing?.detail || (routing?.enablement === 'untrusted'
              ? 'Open /hooks in Codex and trust this hook. Then submit a prompt to verify the callback.'
            : routing?.needsRepair
              ? routing.detail || 'Review and repair the Token Harness routing hook.'
              : routing?.enablement === 'unknown'
                ? routing.detail || 'Token Harness could not determine whether this hook is authorized.'
                : routingConfigured
                  ? routingObserved ? 'Automatic routing is running on submitted prompts.' : 'Configured; submit a prompt and Token Harness will show the callback when it arrives.'
                  : 'Enable once. The native hook then checks every submitted prompt automatically.'),
          'caption',
        ),
      );
      routingCard.append(routingExplanation(agent.id));
      const routingActions = node('div', undefined, 'inline-actions');
      if (routing?.needsRepair) {
        routingActions.append(actionButton('Repair routing', () => reviewPromptRouting(agent.id, true), 'secondary'));
      } else if (routing?.state === 'external') {
        routingActions.append(node('span', 'Managed elsewhere · left untouched', 'caption'));
      } else if (!routingConfigured) {
        routingActions.append(actionButton('Enable routing', () => reviewPromptRouting(agent.id, true), 'secondary'));
      } else if (routingConfigured) {
        routingActions.append(actionButton('Disable routing', () => reviewPromptRouting(agent.id, false), 'secondary'));
      }
      if (routingActions.children.length) routingCard.append(routingActions);
      card.append(routingCard);
      if (baseline.unavailable.length) {
        const details = node('details', undefined, 'agent-details');
        details.append(node('summary', 'Connection limitations'));
        for (const target of baseline.unavailable)
          details.append(node('p', target.provider + ': ' + target.reason, 'caption'));
        card.append(details);
      }
      root.append(card);
    }
  }

  function previewSetup(providerId, harnesses, run) {
    const provider = providerId ? optimizerInfo(providerId) : null;
    const targetLabel = harnesses.map(agentName).join(', ');
    $('modal-content').replaceChildren(
      progress(
        'Checking selected connections',
        'Preparing a read-only plan for ' + targetLabel + '. Nothing changes until you approve the preview.',
      ),
    );
    $('modal-actions').replaceChildren(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request('/api/preview', {
          action: 'setup',
          harnesses,
          ...(providerId ? { provider: providerId } : {}),
        }),
      )
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        if (!data.ticket)
          refreshOverviewAfterMutation('Refreshing setup availability after the review…').catch(
            () => undefined,
          );
        const changes = data.changes || [];
        $('modal-content').replaceChildren(
          messageBox(
            provider ? provider.name + ' · selected connections' : 'Recommended stack · selected connections',
            provider
              ? 'Only ' + provider.name + ' will be changed for ' + targetLabel + '. Other optimizers and unselected coding agents stay untouched.'
              : 'Only the selected RTK/HarnessTrim setups for ' + targetLabel + ' are included. Existing or unsupported setups stay untouched.',
          ),
        );
        if (!changes.length) {
          $('modal-content').append(
            messageBox(
              'No setup change available',
              (data.notices || []).join(' ') ||
                'No automatic change is available from the current provider and harness capabilities. Refreshing the dashboard keeps the visible state honest.',
            ),
          );
        } else {
          for (const change of changes) {
            const item = node('article', undefined, 'preview-change');
            item.append(node('h3', change.title), node('p', change.description));
            $('modal-content').append(item);
          }
          for (const notice of data.notices || [])
            $('modal-content').append(node('p', notice, 'notice-row'));
        }
        $('modal-content').append(
          messageBox(
            'Safety',
            'Apply uses the transactional engine with backups, ownership checks and rollback. The resulting agent and optimizer state is read again after Apply.',
            'safe',
          ),
        );
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket)
          $('modal-actions').append(
            actionButton(
              provider ? 'Apply ' + provider.name + ' connections' : 'Apply recommended setup',
              () => applyTicket(data.ticket),
              '',
            ),
          );
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
        $('modal-actions').replaceChildren(modalClose('Close'));
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }

  function reviewPromptRouting(agentId, enabled) {
    if (busy) return;
    const run = modal((enabled ? 'Enable' : 'Disable') + ' automatic routing · ' + agentName(agentId));
    $('modal-content').append(
      messageBox(
        'How this works',
        enabled
          ? 'Token Harness adds a native UserPromptSubmit hook that supplies a short routing policy on each prompt. The agent may delegate eligible bounded work to a lower-cost native subagent; the root model stays the same.'
          : 'Token Harness removes only the exact native routing entries it owns. User-edited or manually installed hooks remain untouched.',
      ),
      progress('Preparing a read-only plan', 'No harness settings change until you approve the exact preview.'),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', {
        action: enabled ? 'routing-enable' : 'routing-disable',
        harness: agentId,
      }))
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        $('modal-content').replaceChildren();
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        if (!(data.changes || []).length)
          $('modal-content').append(messageBox('No change proposed', (data.notices || []).join(' ') || 'The current routing state or ownership evidence does not support a safe change.'));
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        if (data.ticket) {
          const observed = activeAgents().find(agent => agent.id === agentId)?.promptRouting;
          const needsTrust = agentId === 'codex' && observed?.enablement === 'untrusted';
          $('modal-content').append(messageBox(
            needsTrust ? 'Trust required' : 'When it takes effect',
            needsTrust
              ? 'Open /hooks in Codex and trust this hook. Then send a prompt.'
              : 'Send a prompt in a new session. Token Harness will show the callback when it arrives.',
            'safe',
          ));
        }
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket) $('modal-actions').append(actionButton(enabled ? 'Apply routing hook' : 'Remove owned routing hook', () => applyTicket(data.ticket)));
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }

  function reviewSetup(providerId = null) {
    if (busy) return;
    const choices = setupChoiceData(providerId);
    if (!choices.length) return;
    const provider = providerId ? optimizerInfo(providerId) : null;
    const run = modal(provider ? 'Manage ' + provider.name + ' connections' : 'Set up recommended optimization stack');
    $('modal-content').append(
      messageBox(
        'Choose coding agents',
        provider
          ? 'Select the coding apps where ' + provider.name + ' should be set up. You can choose one or both; existing setups and unsupported targets are not changed.'
          : 'Select the harnesses for the recommended RTK + HarnessTrim baseline. You can choose one or both; each selected harness is reviewed in the same transaction.',
      ),
      messageBox('Nothing changes yet', 'The next step is still read-only. Token Harness will show the exact files and provider actions before Apply becomes available.'),
    );
    if (providerId === 'gitnexus')
      $('modal-content').append(
        messageBox(
          'License boundary',
          'GitNexus 1.6.12 is reviewed technically but carries PolyForm Noncommercial terms. An approved setup may install the reviewed CLI, but Token Harness never creates or refreshes its repository index. Continue only when those terms fit your use.',
          'warn',
        ),
      );
    const choicesBox = node('div', undefined, 'setup-choice-list');
    choicesBox.append(node('h3', 'Harness targets'));
    const selectedCount = node('p', '', 'caption');
    const inputs = [];
    for (const choice of choices) {
      const input = node('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = choice.agent.id;
      input.id = 'setup-target-' + run + '-' + choice.agent.id;
      input.setAttribute('aria-label', 'Configure ' + (provider?.name || 'recommended optimizers') + ' for ' + choice.agent.name);
      inputs.push(input);
      const copy = node('span', undefined, 'setup-choice-copy');
      copy.append(node('strong', choice.agent.name), node('span', setupChoiceSummary(choice), 'caption'));
      const limitations = setupChoiceLimitations(choice);
      if (limitations) copy.append(node('span', limitations, 'caption setup-choice-limitation'));
      const label = node('label', undefined, 'setup-choice');
      label.htmlFor = input.id;
      label.append(input, copy);
      choicesBox.append(label);
    }
    choicesBox.append(selectedCount);
    $('modal-content').append(choicesBox);
    const updateCount = () => {
      const selected = inputs.filter(input => input.checked).length;
      selectedCount.textContent = selected + ' of ' + inputs.length + ' harnesses selected';
      previewButton.disabled = selected === 0;
    };
    for (const input of inputs) input.addEventListener('change', updateCount);
    const previewButton = actionButton('Review selected setup', () => {
      const harnesses = inputs.filter(input => input.checked).map(input => input.value);
      if (harnesses.length) previewSetup(providerId, harnesses, run);
    });
    $('modal-actions').append(modalClose('Cancel'), previewButton);
    updateCount();
  }

  async function refreshOverviewAfterMutation(message = 'Refreshing setup after the approved change…') {
    setStatus(message, true);
    $('stale-state').hidden = true;
    $('stale-state').textContent = '';
    const period = $('period').value;
    current = await request('/api/overview?period=' + encodeURIComponent(period) + '&refresh=1');
    periodCache.set(period, current);
    render();
    await loadActivity();
    setStatus('Updated at ' + new Date(current.generatedAt).toLocaleTimeString() + '.', false);
  }

  async function applyTicket(ticket) {
    if (!ticket || busy) return;
    const run = modalRun;
    setBusy(true, true);
    $('modal-actions').replaceChildren(modalClose('Applying…', true));
    $('modal-content').append(progress('Applying the approved change', 'Keep this window open until the transaction finishes.'));
    try {
      await ensureSession();
      const result = await request('/api/apply', { ticket });
      if (run !== modalRun) return;
      if (result.restartRequired) {
        $('modal-title').textContent = result.title || 'Token Harness update installed';
        $('modal-content').replaceChildren(messageBox('Restart to finish', (result.messages || []).join(' ') || 'Token Harness must restart before it can check the updated installation.', 'safe'));
        $('modal-actions').replaceChildren(modalClose('Later'), actionButton('Restart and re-check', restartAndRecheck));
        return;
      }
      $('modal-title').textContent = result.title || (result.ok ? 'Setup completed' : 'Setup needs attention');
      $('modal-content').replaceChildren(
        messageBox(result.ok ? 'Applied' : 'Needs attention', (result.messages || []).join(' '), result.ok ? 'safe' : 'warn'),
        progress('Refreshing the current setup', 'Please wait while Token Harness re-reads agents, optimizer connections and health after the change.'),
      );
      $('modal-actions').replaceChildren(modalClose('Refreshing…', true));
      try {
        await refreshOverviewAfterMutation('Applying the new configuration and refreshing status…');
        if (run !== modalRun) return;
        $('modal-content').replaceChildren(
          messageBox(
            result.ok ? 'Completed and refreshed' : 'Action finished; status refreshed',
            (result.messages || []).join(' ') || 'The latest setup state is now shown on the dashboard.',
            result.ok ? 'safe' : 'warn',
          ),
        );
      } catch (refreshError) {
        if (run !== modalRun) return;
        $('stale-state').hidden = false;
        $('stale-state').textContent = 'The action finished, but Token Harness could not automatically refresh the latest setup state.';
        $('modal-content').replaceChildren(
          messageBox(
            result.ok ? 'Change applied' : 'Action finished',
            (result.messages || []).join(' ') || 'The action completed.',
            result.ok ? 'safe' : 'warn',
          ),
          messageBox(
            'Automatic refresh failed',
            refreshError.message || 'The latest setup state could not be read automatically. Use Refresh to retry the status check.',
            'warn',
          ),
        );
      }
      $('modal-actions').replaceChildren(modalClose('Done'));
    } catch (error) {
      if (run !== modalRun) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
      $('modal-actions').replaceChildren(modalClose('Close'));
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  async function restartAndRecheck() {
    if (busy) return;
    setBusy(true, true);
    $('modal-content').replaceChildren(progress('Restarting Token Harness', 'The updated app will run its health check when it opens again.'));
    $('modal-actions').replaceChildren(modalClose('Restarting…', true));
    try {
      await ensureSession();
      const result = await request('/api/restart', {});
      if (!result.ok) throw new Error((result.messages || []).join(' ') || 'Restart did not complete.');
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
      $('modal-actions').replaceChildren(modalClose('Close'));
      setBusy(false, false);
    }
  }

  function connectionPresentation(target) {
    if (!target) return { label: 'Not targeted', cls: '' };
    if (target.state === 'connected') return { label: 'Setup detected', cls: 'good' };
    if (target.state === 'actionable') return { label: 'Available', cls: 'warn' };
    if (target.state === 'unavailable') return { label: 'Unavailable', cls: '' };
    return { label: 'Not applicable', cls: '' };
  }

  function mcptoonInstallOptions() {
    modal('Install mcptoon prerequisites');
    $('modal-content').append(
      node('p', 'Token Harness can install mcptoon after pipx or uv is available. Install one, then Refresh and choose Install & connect.'),
    );
    const links = node('div', undefined, 'inline-actions');
    for (const [label, href] of [
      ['pipx installation', 'https://pipx.pypa.io/stable/installation/'],
      ['uv installation', 'https://docs.astral.sh/uv/getting-started/installation/'],
    ]) {
      const link = node('a', label, 'button secondary');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      links.append(link);
    }
    $('modal-content').append(links);
    $('modal-actions').append(modalClose('Done'));
  }

  function renderConnectionOverview() {
    const root = $('connection-overview');
    if (!root) return;
    root.replaceChildren();
    const agents = activeAgents();
    const ids = optimizerIds();
    if (!agents.length) {
      root.append(sectionEmpty('Explore the optimizers below. Connections become available when a supported coding app is detected.'));
    }

    const summary = node('div', undefined, 'connection-summary');
    const summaryText = node('div');
    summaryText.append(
      node('strong', ids.length + ' optimizer' + (ids.length === 1 ? '' : 's') + ' · ' + agents.length + ' coding agent' + (agents.length === 1 ? '' : 's')),
      node('p', 'RTK + HarnessTrim are the recommended baseline. Other optimizers are optional.', 'caption'),
    );
    summary.append(summaryText);
    const baselineActionable = ['rtk', 'harnesstrim'].some(id =>
      agents.some(agent => setupTarget(agent.id, id)?.state === 'actionable'),
    );
    if (baselineActionable)
      summary.append(actionButton('Set up recommended stack', () => reviewSetup(), ''));
    root.append(summary);
    root.append(node('p', 'Project-reported figures describe different workloads, not expected savings on your machine. Your measured results stay in Results.', 'caption optimizer-claims-note'));

    const scroll = node('div', undefined, 'connection-scroll');
    const table = node('div', undefined, 'connection-table');
    table.style.setProperty('--connection-template', 'minmax(240px,1.5fr) minmax(165px,1fr) ' + agents.map(() => 'minmax(110px,.7fr)').join(' ') + ' minmax(150px,.9fr)');
    const header = node('div', undefined, 'connection-row connection-head');
    header.append(node('strong', 'Optimizer', 'connection-name'));
    header.append(node('strong', 'Project-reported impact', 'optimizer-claim'));
    for (const agent of agents) header.append(node('strong', agent.name, 'connection-cell'));
    header.append(node('strong', 'Action', 'connection-action'));
    table.append(header);

    for (const id of ids) {
      const info = optimizerInfo(id);
      const component = managedComponent(id);
      const item = node('article', undefined, 'connection-item');
      item.dataset.optimizer = id;
      item.setAttribute('aria-label', info.name);
      const row = node('div', undefined, 'connection-row');
      const nameCell = node('div', undefined, 'connection-name');
      const identity = node('div', undefined, 'optimizer-identity');
      identity.append(node('strong', info.name));
      if (info.project) identity.append(projectLink('Source project', info.project, info.name + ' source project'));
      nameCell.append(
        identity,
        node('span', info.optional ? 'Optional optimizer' : 'Recommended baseline', 'caption'),
        node('span', info.role, 'caption connection-role'),
        node('span', component?.version ? 'v' + component.version : 'Not installed', 'caption'),
      );
      row.append(nameCell);
      const claimCell = node('div', undefined, 'optimizer-claim');
      claimCell.append(
        node('span', 'Project-reported impact', 'connection-app-label'),
        node('strong', info.claim?.headline || 'No published KPI'),
        node('span', info.claim?.scope || 'No comparable benchmark available', 'caption'),
      );
      row.append(claimCell);
      let actionable = false;
      for (const agent of agents) {
        const target = setupTarget(agent.id, id);
        const state = connectionPresentation(target);
        const cell = node('div', undefined, 'connection-cell');
        cell.append(node('span', agent.name, 'connection-app-label'), pill(state.label, state.cls));
        row.append(cell);
        actionable ||= target?.state === 'actionable';
      }
      const action = node('div', undefined, 'connection-action');
      if (actionable)
        action.append(
          actionButton(
            component?.installed ? 'Manage connections' : 'Install & connect',
            () => reviewSetup(id),
            'secondary',
          ),
          );
      const mcptoonUnavailable = id === 'mcptoon' && agents.some(agent => setupTarget(agent.id, id)?.state === 'unavailable');
      if (mcptoonUnavailable)
        action.append(actionButton('Installation options', mcptoonInstallOptions, 'secondary'));
      if (component?.managedByTokenHarness || component?.configured) {
        const remove = actionButton('Remove managed setup', () => {
          window.tokenHarnessReviewRemoval?.(id, info.name);
        }, 'text-button');
        remove.disabled = busy || typeof window.tokenHarnessReviewRemoval !== 'function';
        action.append(remove);
      }
      if (!action.children.length) action.append(node('span', 'No action', 'caption'));
      row.append(action);
      item.append(row, optimizerExplanation(id, info));
      table.append(item);
    }
    scroll.append(table);
    root.append(scroll);
  }

  function renderManagedSetup() {
    renderConnectionOverview();
  }

  function candidateState(observation) {
    if (!observation || observation.state === 'absent') return { label: 'Not installed', cls: '' };
    if (observation.state === 'unsupported-version') return { label: 'Update needed', cls: 'warn' };
    if (observation.state === 'benchmark-ready') return { label: 'Ready to evaluate', cls: 'good' };
    return { label: 'Installed · evaluation setup needed', cls: '' };
  }

  function candidateInstallGuide(candidate) {
    const observation = candidateObservation(candidate.id);
    modal('Install ' + candidate.name + ' for evaluation');
    $('modal-content').append(
      messageBox('Experimental, not managed', candidate.name + ' is not part of the active Token Harness stack. These commands install its own CLI only; Token Harness will not execute them for you.'),
      node('h3', '1. Install the CLI'),
      copyRow(candidate.install),
    );
    if (candidate.fallback) {
      $('modal-content').append(node('p', 'Alternative installation:', 'caption'), copyRow(candidate.fallback));
    }
    $('modal-content').append(node('h3', '2. Verify it is visible'), copyRow(candidate.verify));
    if (observation?.state && observation.state !== 'absent')
      $('modal-content').append(messageBox('Current local state', 'Token Harness currently sees: ' + candidateState(observation).label + (observation.version ? ' · v' + observation.version : '') + '.', observation.state === 'unsupported-version' ? 'warn' : 'safe'));
    $('modal-content').append(
      node('h3', '3. Return here and Refresh'),
      node('p', 'After installation, choose Refresh on the main page. Token Harness will re-run only its read-only candidate capability checks.'),
      messageBox('Installation is not activation', candidate.warning, 'warn'),
    );
    $('modal-actions').append(modalClose('Done'));
  }

  function benchmarkId(candidateId) {
    return candidateId + '-eval-' + Date.now().toString(36);
  }

  function candidateEvaluateGuide(candidate) {
    const observation = candidateObservation(candidate.id);
    const id = benchmarkId(candidate.id);
    modal('Evaluate ' + candidate.name);
    $('modal-content').append(
      messageBox('What Token Harness can do', 'Token Harness can record paired baseline/optimized evidence and keep the candidate outside the managed stack until evidence and lifecycle gates are satisfied.'),
      messageBox('What Token Harness will not do', candidate.activation, 'warn'),
    );
    if (candidate.activationCommands?.length) {
      $('modal-content').append(node('h3', 'Candidate-side commands you may need'));
      for (const command of candidate.activationCommands) $('modal-content').append(copyRow(command));
    }
    const agent = activeAgents()[0]?.id || 'codex';
    $('modal-content').append(
      node('h3', 'Record a paired benchmark'),
      node('p', 'Use the same representative task twice. The baseline must not use ' + candidate.name + '; the optimized run must actually use it.', 'caption'),
      copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --candidate ' + candidate.id + ' --variant baseline --task standard --harness ' + agent),
      copyRow('token-harness benchmark-finish --benchmark-id ' + id + ' --variant baseline --quality <passed|failed> --attempts <n> --failed-attempts <n>'),
      copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --candidate ' + candidate.id + ' --variant optimized --task standard --harness ' + agent),
      copyRow('token-harness benchmark-finish --benchmark-id ' + id + ' --variant optimized --quality <passed|failed> --attempts <n> --failed-attempts <n>'),
      messageBox('Do not fake activation', 'Candidate attribution names the experiment target; it is not proof that the optimized run used the candidate. Record only what actually happened.'),
    );
    if (observation?.state !== 'benchmark-ready')
      $('modal-content').append(messageBox('Not benchmark-ready yet', 'The installed CLI has not passed Token Harness read-only capability checks. Install/update it and Refresh before treating a run as candidate evidence.', 'warn'));
    $('modal-actions').append(modalClose('Done'));
  }

  function candidateLifecycleHarnesses(candidate) {
    if (candidate.id === 'mcptoon') return ['claude', 'codex'];
    if (candidate.id === 'gitnexus') return ['claude'];
    return [];
  }

  function reviewCandidateLifecycle(candidate, harness, action) {
    if (busy) return;
    const removing = action === 'candidate-remove';
    const run = modal((removing ? 'Review removal · ' : 'Review setup · ') + candidate.name + ' · ' + agentName(harness));
    $('modal-content').append(
      messageBox('Experimental stays experimental', candidate.name + ' remains outside the RTK + HarnessTrim production stack. This review uses only its existing candidate lifecycle and exact compatibility gates.'),
      progress(removing ? 'Checking owned candidate setup' : 'Checking reviewed candidate setup', 'Nothing changes until a concrete preview is shown and you approve it.'),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', { action, candidate: candidate.id, harness }))
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        $('modal-content').replaceChildren();
        if (!(data.changes || []).length)
          $('modal-content').append(messageBox('No experimental change proposed', (data.notices || []).join(' ') || 'The candidate is already in the requested state or this machine is outside the exact reviewed lifecycle.'));
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-content').append(messageBox('Safety boundary', 'Candidate setup never promotes the tool. Compatibility, ownership and drift checks are re-run when Apply is pressed; unsupported state is refused rather than forced.', 'safe'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket)
          $('modal-actions').append(actionButton(removing ? 'Remove reviewed experimental setup' : 'Apply reviewed experimental setup', () => applyTicket(data.ticket)));
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }

  function candidateLifecycleGuide(candidate) {
    const supported = candidateLifecycleHarnesses(candidate);
    modal('Managed evaluation setup · ' + candidate.name);
    $('modal-content').append(
      messageBox('Optional candidate lifecycle', 'This is an explicit evaluation setup, not production-stack setup. Token Harness does not silently install or activate candidates.'),
    );
    if (candidate.id === 'mcptoon')
      $('modal-content').append(messageBox('Prerequisites stay yours', 'An approved setup may install the exact reviewed mcptoon build through an already-installed pipx or uv. Token Harness does not install Python, pipx, uv or administrator prerequisites.'));
    if (candidate.id === 'gitnexus')
      $('modal-content').append(messageBox('Index stays yours', 'GitNexus must already be installed on the exact reviewed row. Token Harness can register only the reviewed Claude MCP entry; it never creates or refreshes the repository index.'));
    const agents = activeAgents().filter(agent => supported.includes(agent.id));
    if (!agents.length) {
      $('modal-content').append(messageBox('No reviewed agent available', 'This candidate lifecycle needs a compatible detected coding agent. Install or start the supported agent, then choose Refresh.', 'warn'));
    }
    for (const agent of agents) {
      const item = node('article', undefined, 'preview-change');
      item.append(node('h3', agent.name), node('p', 'Review setup or removal for this agent. Preview is read-only; Apply appears only if the candidate lifecycle returns a concrete safe change.'));
      const actions = node('div', undefined, 'inline-actions');
      actions.append(
        actionButton('Review setup', () => reviewCandidateLifecycle(candidate, agent.id, 'candidate-setup')),
        actionButton('Review removal', () => reviewCandidateLifecycle(candidate, agent.id, 'candidate-remove'), 'secondary'),
      );
      item.append(actions);
      $('modal-content').append(item);
    }
    $('modal-content').append(messageBox('Removal is surgical', 'Removal targets only Token Harness-owned candidate integration state. Candidate packages, GitNexus index data and unrelated user configuration remain untouched.'));
    $('modal-actions').append(modalClose('Done'));
  }

  function renderExperimental() {
    const root = $('experimental-tools');
    if (!root) return;
    root.replaceChildren();
    for (const candidate of EXPERIMENTAL) {
      const observation = candidateObservation(candidate.id);
      const evidence = candidateEvidence(candidate.id);
      const state = candidateState(observation);
      const card = node('article', undefined, 'tool-card experimental');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(node('h3', candidate.name), node('span', candidate.category + ' · Experimental', 'caption'));
      head.append(title, pill(state.label, state.cls));
      card.append(head, node('p', candidate.purpose));
      const facts = node('div', undefined, 'tool-facts');
      facts.append(node('span', 'Active stack'), node('strong', 'No'));
      facts.append(node('span', 'Automatic install'), node('strong', 'No'));
      if (observation?.version) facts.append(node('span', 'Detected version'), node('strong', 'v' + observation.version));
      if (evidence?.pairs > 0) facts.append(node('span', 'Paired evidence'), node('strong', count(evidence.pairs) + ' pair(s)'));
      card.append(facts);
      const actions = node('div', undefined, 'inline-actions');
      if (!observation || observation.state === 'absent' || observation.state === 'unsupported-version')
        actions.append(actionButton(observation?.state === 'unsupported-version' ? 'Update / install guide' : 'Install CLI for evaluation', () => candidateInstallGuide(candidate), 'secondary'));
      else
        actions.append(actionButton('Installation guide', () => candidateInstallGuide(candidate), 'secondary'));
      actions.append(actionButton('How to evaluate', () => candidateEvaluateGuide(candidate), 'secondary'));
      if (candidateLifecycleHarnesses(candidate).length > 0)
        actions.append(actionButton('Managed evaluation setup', () => candidateLifecycleGuide(candidate), 'secondary'));
      card.append(actions);
      root.append(card);
    }
  }

  function reasoningGuide(agent) {
    modal('Choose reasoning for ' + agent.name);
    $('modal-content').append(
      node('p', 'Choose the type of work. Token Harness will calculate a supported reasoning preference, show the exact change, and wait for your approval.'),
      messageBox('Persistent preference', 'This changes a saved agent preference for future sessions; it is not a one-task switch and it does not change your model, login or billing.'),
    );
    const grid = node('div', undefined, 'choice-grid');
    const choices = [
      ['mechanical', 'Simple edits', 'Formatting, renames, repetitive or low-risk mechanical changes.'],
      ['standard', 'Everyday coding', 'Normal implementation, debugging and code review.'],
      ['hard', 'Complex work', 'Architecture, difficult debugging or multi-step implementation.'],
      ['critical', 'Critical work', 'High-risk changes where quality takes priority over savings.'],
    ];
    for (const [task, label, detail] of choices) {
      const button = actionButton(label, () => reviewReasoning(agent.id, task), 'choice-button');
      button.append(node('span', detail, 'caption'));
      grid.append(button);
    }
    $('modal-content').append(grid);
    $('modal-actions').append(modalClose('Cancel'));
  }

  function reviewReasoning(agentId, task) {
    if (busy) return;
    const run = modal('Review reasoning change for ' + agentName(agentId));
    $('modal-content').append(progress('Calculating a safe recommendation', 'Reading supported model/reasoning controls. Nothing is being changed.'));
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', { action: 'effort', harness: agentId, task }))
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        $('modal-content').replaceChildren();
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        if (!(data.changes || []).length) $('modal-content').append(messageBox('No change proposed', (data.notices || []).join(' ') || 'The current preference is already appropriate or cannot be changed safely.'));
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket) $('modal-actions').append(actionButton('Apply reasoning preference', () => applyTicket(data.ticket)));
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }

  function renderTuning() {
    const root = $('agent-tuning');
    root.replaceChildren();
    if (!activeAgents().length) {
      root.append(sectionEmpty('No supported coding agent detected.'));
      return;
    }
    for (const agent of activeAgents()) {
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(node('h3', agent.name + ' reasoning'), node('span', 'Optional tuning', 'caption'));
      head.append(title, pill(agent.reasoning?.value ? 'Saved: ' + agent.reasoning.value : 'No managed preference'));
      card.append(head, node('p', agent.reasoning?.description || 'Review the current agent preference before changing it.'));
      const actions = node('div', undefined, 'inline-actions');
      actions.append(actionButton('Choose reasoning for ' + agent.name, () => reasoningGuide(agent), 'secondary'));
      card.append(actions);
      root.append(card);
    }
  }

  function readOnlyOperation(kind) {
    if (busy) return;
    const isVerify = kind === 'verify';
    const run = modal(isVerify ? 'Re-check optimizer health' : 'Check for updates');
    $('modal-content').append(
      messageBox(
        isVerify ? 'Troubleshooting check' : 'Update preview',
        isVerify
          ? 'Re-checks the configured optimizer integrations without repairing or changing them. Normal setup already performs its own safety checks.'
          : 'Checks Token Harness and optimizer update channels first. If an update is available, you can approve it from this window; installed versions are checked again after installation.',
      ),
      progress(
        isVerify ? 'Checking configured optimizers' : 'Checking Token Harness and optimizer updates',
        'Nothing changes during this check.',
      ),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request(isVerify ? '/api/verify' : '/api/update-check', { period: $('period').value }),
      )
      .then(result => {
        if (run !== modalRun || !$('modal').open) return;
        if (result.stack && current) {
          current = { ...current, stack: result.stack };
          renderDashboard();
          renderSetup();
        }
        $('modal-content').replaceChildren(
          messageBox(
            result.title || (result.ok ? 'Completed' : 'Needs attention'),
            (result.messages || []).join(' ') || 'Check completed.',
            result.ok ? 'safe' : 'warn',
          ),
        );
        $('modal-actions').replaceChildren(modalClose(result.ticket ? 'Cancel' : 'Done'));
        if (result.ticket)
          $('modal-actions').append(
            actionButton('Install updates', () => applyTicket(result.ticket), ''),
          );
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
        loadActivity();
      });
  }

  function undoLastChange() {
    if (busy) return;
    const run = modal('Review undo');
    $('modal-content').append(progress('Preparing the exact restore', 'Only the last change made by this dashboard session can be targeted.'));
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', { action: 'undo' }))
      .then(data => {
        if (run !== modalRun) return;
        $('modal-content').replaceChildren();
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket) $('modal-actions').append(actionButton('Restore reviewed backup', () => applyTicket(data.ticket)));
      })
      .catch(error => {
        if (run !== modalRun) return;
        $('modal-error').textContent = error.message;
        $('modal-error').hidden = false;
      })
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }


  function renderMaintenance() {
    const root = $('maintenance-actions');
    root.replaceChildren();

    if (configuredProviders().length) {
      const verify = node('article', undefined, 'maintenance-row');
      const verifyText = node('div');
      verifyText.append(
        node('strong', 'Optimizer health'),
        node(
          'p',
          current?.stack?.state === 'attention'
            ? 'Something changed or could not be verified. Re-check the configured integrations for details.'
            : 'Re-check integrations after external changes or when troubleshooting.',
          'caption',
        ),
      );
      verify.append(
        verifyText,
        actionButton(
          current?.stack?.state === 'attention' ? 'Check now' : 'Re-check health',
          () => readOnlyOperation('verify'),
          'secondary',
        ),
      );
      root.append(verify);
    }

    const updates = node('article', undefined, 'maintenance-row');
    const updateText = node('div');
    const available = (current?.stack?.components || []).filter(component => component.update === 'available');
    updateText.append(
      node('strong', 'Token Harness and optimizer updates'),
      node(
        'p',
        available.length
          ? available.map(component => (TOOL_INFO[component.providerId]?.name || component.providerId) + ' has an update ready.').join(' ')
          : 'Check available versions and review updates before installing.',
        'caption',
      ),
    );
    updates.append(
      updateText,
      actionButton(available.length ? 'Review updates' : 'Check for updates', () => readOnlyOperation('updates'), available.length ? '' : 'secondary'),
    );
    root.append(updates);

    if (activityState?.canUndo) {
      const undo = node('article', undefined, 'maintenance-row');
      const undoText = node('div');
      undoText.append(
        node('strong', 'Undo last change'),
        node('p', 'Review and restore the exact last configuration transaction from this app session.', 'caption'),
      );
      undo.append(undoText, actionButton('Review undo', undoLastChange, 'secondary'));
      root.append(undo);
    }
  }

  function renderSetup() {
    renderAgentSetup();
    renderManagedSetup();
    renderExperimental();
    renderTuning();
    renderMaintenance();
  }

  function addEvidenceRow(body, type, name, scope, signals, amount, sections) {
    const row = node('li', undefined, 'evidence-item');
    row.dataset.type = type;
    row.dataset.name = name.toLocaleLowerCase();
    row.dataset.amount = String(amount || 0);
    const disclosure = node('details', undefined, 'evidence-disclosure');
    disclosure.dataset.key = type + ':' + name;
    const summary = node('summary', undefined, 'evidence-summary');
    const identity = node('span', undefined, 'evidence-identity');
    const types = { optimizer: 'Optimizer', routing: 'Routing', harness: 'Coding app', measurement: 'Measurement', candidate: 'Experiment' };
    identity.append(node('span', types[type], 'evidence-kind'), node('strong', name), node('span', scope, 'caption'));
    const results = node('span', undefined, 'evidence-signals');
    for (const signal of signals) {
      const result = node('span', undefined, 'evidence-signal ' + (signal.tone || ''));
      result.append(node('strong', signal.value), node('span', signal.label, 'caption'));
      results.append(result);
    }
    const cue = node('span', 'Details', 'evidence-cue');
    const chevron = node('span', '›', 'evidence-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    cue.append(chevron);
    summary.append(identity, results, cue);
    const detailBody = node('div', undefined, 'evidence-detail-body');
    detailBody.append(...sections);
    disclosure.append(summary, detailBody);
    row.append(disclosure);
    // Search includes provenance, so a class/unit or linked app can be found while collapsed.
    row.dataset.search = [type, types[type], name, scope, row.textContent].join(' ').toLocaleLowerCase();
    body.append(row);
    return row;
  }

  function evidenceSection(title, facts = [], note = '') {
    const section = node('section', undefined, 'evidence-section');
    section.append(node('h3', title));
    if (facts.length) {
      const list = node('dl', undefined, 'evidence-fact-grid');
      for (const [label, value] of facts) {
        const fact = node('div');
        fact.append(node('dt', label), node('dd', value));
        list.append(fact);
      }
      section.append(list);
    }
    if (note) section.append(node('p', note, 'caption'));
    return section;
  }

  function optimizerSignal(row, includeProvider = false) {
    const impact = row.impact;
    const value = impact && impact.kind !== 'unavailable'
      ? impact.headline
      : count(Math.abs(row.saved)) + ' ' + row.unit + (row.saved < 0 ? ' added' : row.saved > 0 ? ' saved' : ' net change');
    return {
      value,
      label: (includeProvider ? row.provider + ' · ' : '') + row.measurement + ' · ' + row.unit,
      tone: impact?.kind === 'growth' ? 'warn' : impact?.kind === 'reduction' ? 'good' : '',
    };
  }

  function optimizerEvidenceDetail(row, includeProvider = false) {
    const volume = value => value === null || value === undefined ? 'Not recorded' : count(value) + ' ' + row.unit;
    return evidenceSection((includeProvider ? row.provider + ' · ' : '') + row.measurement + ' · ' + row.unit, [
      ['Before', volume(row.before)],
      ['After', volume(row.after)],
      [row.saved < 0 ? 'Added' : 'Saved', volume(Math.abs(row.saved))],
      ['Changed outputs', count(row.operations)],
      ['Recorded app', row.agents?.length ? row.agents.join(', ') : 'Not attributed'],
    ], (row.impact?.detail || 'A comparable before/after pair is needed to report a percentage.') +
      (!row.agents?.length ? ' These records do not identify which coding app ran the command.' : ''));
  }

  function routingDetails(agent) {
    const routing = agent.promptRouting || {};
    const lines = [];
    const tier = routing.verificationTier;
    if (routing.enablement === 'untrusted') lines.push('Action required: open /hooks in Codex and trust this hook, then submit a prompt.');
    else if (routing.enablement === 'disabled') lines.push('Hooks are disabled for this coding app. Recorded callbacks describe earlier activity.');
    else if (routing.configured === false) lines.push('Automatic routing is not enabled. Recorded callbacks describe earlier activity.');
    else if (tier === 'runtime-observed') lines.push('Runtime callback observed. Subagent starts prove delegation; savings require a comparison.');
    else if (routing.configured !== false && routing.enablement === 'unknown') lines.push('Authorization is unknown; check the hook status in the coding app.');
    else if (routing.enablement === 'enabled' || (!routing.enablement && routing.state === 'managed')) lines.push('Configured; waiting for the first runtime callback after a prompt.');
    else if (routing.state === 'external') lines.push('Routing is managed elsewhere; Token Harness leaves it unchanged.');
    else lines.push('Automatic routing is not enabled for this coding app.');
    const facts = [['Verification', tier === 'runtime-observed' ? 'Runtime callback observed' : tier === 'config-only' ? 'Configuration only' : 'Not verified']];
    if (Number.isFinite(routing.promptSubmissions)) facts.push(['Prompt callbacks', count(routing.promptSubmissions)]);
    if (Number.isFinite(routing.subagentsStarted)) facts.push(['Subagents started', count(routing.subagentsStarted)]);
    if (Number.isFinite(routing.subagentsStopped)) facts.push(['Subagents stopped', count(routing.subagentsStopped)]);
    if (routing.reportedModels?.length) facts.push(['Reported models', routing.reportedModels.join(', ')]);
    if (routing.lastObservedAt) facts.push(['Last callback', date(routing.lastObservedAt)]);
    return evidenceSection(agent.name + ' · routing activity', facts, lines[0]);
  }

  function runtimeSignals(agent) {
    const routing = agent.promptRouting;
    if (routing?.verificationTier !== 'runtime-observed' || routing.receiptState === 'unavailable') return [];
    return [['promptSubmissions', 'prompt callbacks'], ['subagentsStarted', 'subagents started'], ['subagentsStopped', 'subagents stopped']]
      .filter(([key]) => Number.isFinite(routing[key]) && routing[key] > 0)
      .map(([key, label]) => ({ value: count(routing[key]) + ' ' + label, label: agent.name + ' · observed routing activity' }));
  }

  function liveAllowanceSignals(agent) {
    return (agent.allowance || []).filter(window => Number.isFinite(window.remaining)).map(window => ({
      value: count(window.remaining) + '% remaining', label: agent.name + ' · ' + window.label + ' · current balance',
    }));
  }

  function liveAllowanceDetails(agent) {
    const windows = agent.allowance || [];
    const sections = windows.map(window => evidenceSection(agent.name + ' · ' + window.label, [
      ['Remaining', Number.isFinite(window.remaining) ? count(window.remaining) + '%' : 'Unavailable'],
      ['Source', window.source || 'Not recorded'],
      ['Reset', window.resetsAt ? date(window.resetsAt) : 'Not recorded'],
      ['Read at', date(window.observedAt || current.generatedAt)],
    ], 'Current balance observation; this is not a saved allowance percentage.'));
    if (!sections.length) {
      const section = evidenceSection(agent.name + ' · current allowance', [], agent.pending?.includes('allowance')
        ? 'Reading current allowance…' : agent.allowanceNote || 'No readable allowance source is available. This does not mean a zero balance.');
      section.append(actionButton('Refresh readings', () => refresh(true), 'secondary'));
      sections.push(section);
    }
    return sections;
  }

  function comparisonSection() {
    const comparisons = current?.value?.comparisons;
    const section = evidenceSection('Current-project comparisons', [
      ['Evidence read', !comparisons ? 'Not checked' : comparisons.available === false ? 'Unavailable' : 'Available'],
      ['Complete pairs', count(comparisons?.complete || 0)],
      ['Unfinished pairs', count(comparisons?.incomplete || 0)],
      ['Invalid pairs', count(comparisons?.invalid || 0)],
    ], 'Comparisons cover the project where Token Harness was opened. They are independent of the output-history period filter.');
    section.append(actionButton('Record a comparison', () => measurementGuide(), 'secondary'));
    const pending=current?.value?.pendingConfiguration;
    if(pending){
      section.append(messageBox('Temporary configuration needs completion or recovery',pending.state==='active'?'Prepared arm: '+pending.benchmarkId+' / '+pending.variant+'. Finish this arm or restore it before another managed change.':'The configuration lease is unreadable. Preserve the checkpoint and backups and inspect local state.'));
      if(pending.recoveryCommand)section.append(copyRow(pending.recoveryCommand));
    }
    return section;
  }

  function measurementGuide(agentId = activeAgents()[0]?.id) {
    modal('Record a baseline/optimized comparison');
    const agents = activeAgents();
    if (!agents.length) {
      $('modal-content').append(messageBox('Coding app needed', 'Open Overview and expose Codex or Claude Code before recording a comparison.'));
      $('modal-actions').append(modalClose('Done'));
      return;
    }
    const id = benchmarkId('task');
    const selected = node('select');
    selected.id = 'comparison-agent';
    selected.setAttribute('aria-label', 'Coding app for both comparison runs');
    for (const agent of agents) {
      const option = node('option', agent.name);
      option.value = agent.id;
      selected.append(option);
    }
    selected.value = agents.some(agent => agent.id === agentId) ? agentId : agents[0].id;
    const design = node('select');
    design.id = 'comparison-design'; design.setAttribute('aria-label', 'Comparison design');
    for (const [value, text] of [['paired', 'Baseline / optimized'], ['factorial', 'Four arms: compression and routing']]) {
      const option = node('option', text); option.value = value; design.append(option);
    }
    design.value = 'paired';
    const designLabel = node('label', 'Comparison design'); designLabel.setAttribute('for', design.id);
    const checkInput = node('input'); checkInput.id = 'comparison-check';
    checkInput.setAttribute('aria-label', 'Optional quality check'); checkInput.maxLength = 20480;
    checkInput.placeholder = '["npm","run","verify"]';
    const checkLabel = node('label', 'Optional quality check (executable and arguments)'); checkLabel.setAttribute('for', checkInput.id);
    const checkHint = node('p', 'Leave empty to record your checks manually. Commands below use Bash or PowerShell quoting.', 'caption');
    checkHint.id = 'comparison-check-hint'; checkInput.setAttribute('aria-describedby', checkHint.id);
    const stateInput = node('input'); stateInput.id = 'comparison-starting-state'; stateInput.setAttribute('aria-label', 'Same starting state'); stateInput.placeholder = 'Initial Git commit or fixture id';
    const stateLabel = node('label', 'Same starting state for all four arms'); stateLabel.setAttribute('for', stateInput.id);
    const steps = node('div'); steps.setAttribute('aria-live', 'polite');
    const renderSteps = () => {
      stateInput.hidden = stateLabel.hidden = design.value !== 'factorial';
      checkInput.setAttribute('aria-invalid', 'false'); stateInput.setAttribute('aria-invalid', 'false');
      let checkSuffix = '';
      if (checkInput.value.trim()) {
        try {
          const argv = checkInput.value.length <= 20480 ? JSON.parse(checkInput.value) : null;
          if (checkInput.value.length > 20480 || !Array.isArray(argv) || argv.length < 1 || argv.length > 65 ||
            typeof argv[0] !== 'string' || !argv[0].trim() || argv[0].length > 4096 ||
            argv.some(part => typeof part !== 'string' || /[\x00-\x1f']/.test(part)) || JSON.stringify(argv.slice(1)).length > 16384)
            throw new Error('invalid argv');
          checkSuffix = " --check-command '" + JSON.stringify(argv) + "'";
        } catch {
          checkInput.setAttribute('aria-invalid', 'true');
          steps.replaceChildren(messageBox('Check needs an executable and arguments', 'Enter a JSON array such as ["npm","run","verify"]. For arguments containing apostrophes, use the CLI with your shell’s quoting.'));
          return;
        }
      }
      const finish = arm => 'token-harness benchmark-finish --benchmark-id ' + id + ' --variant ' + arm +
        (checkSuffix ? ' --yes' : ' --quality <passed|failed>') + ' --attempts <n> --failed-attempts <n>';
      if (design.value === 'factorial') {
        const state = stateInput.value.trim();
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(state)) {
          stateInput.setAttribute('aria-invalid', 'true');
          steps.replaceChildren(messageBox('Starting state needed', 'Enter the initial Git commit or fixture id. Restore that same starting tree before every arm.'));
          return;
        }
        const rows = [messageBox('Exploratory four-arm comparison', 'Preview each temporary configuration with benchmark-prepare, then repeat that command with --yes. Finish restores the original configuration. Restore the same starting tree and start a fresh coding session before every task. Setup must already support owned RTK/HarnessTrim changes. Configuration checks are config-only; routing arms need real callbacks.')];
        for (const [arm, label] of [['baseline', 'Compression off · routing off'], ['compression-only', 'Compression on · routing off'], ['routing-only', 'Compression off · routing on'], ['combined', 'Compression on · routing on']]) {
          rows.push(node('h3', arm + ' — ' + label),
            copyRow('token-harness benchmark-prepare --benchmark-id ' + id + ' --variant ' + arm + ' --starting-state ' + state + ' --task standard --harness ' + selected.value + checkSuffix),
            node('p', 'Run the same task. ' + (checkSuffix ? 'Review the saved check before running the finish command.' : 'Run the same acceptance checks and record their result.')),
            copyRow(finish(arm)),
            node('p','If the task is cancelled or the process is interrupted, preview recovery, then add --yes:'),
            copyRow('token-harness benchmark-restore --benchmark-id ' + id + ' --variant ' + arm));
        }
        rows.push(copyRow('token-harness benchmark-factorial --benchmark-id ' + id),
          node('p', 'Run from the same project where this dashboard was opened, then refresh Results. Repeat controlled four-arm sets before drawing conclusions.'));
        steps.replaceChildren(...rows); return;
      }
      steps.replaceChildren(
        node('h3', '1. Prepare the baseline'),
        node('p', 'Use the same representative task, starting state, coding app and checks for both runs. For a routing comparison, disable routing in Overview before starting the baseline. Start a fresh coding session after changing hooks.'),
        copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --variant baseline --task standard --harness ' + selected.value + checkSuffix),
        node('h3', '2. Run the task and check its result'),
        node('p', 'Run the baseline task in the coding app, then run its tests or acceptance checks. Replace the placeholders below with the actual result and attempt counts; passed means the checks succeeded.'),
        copyRow(finish('baseline')),
        node('h3', '3. Repeat with optimization enabled'),
        node('p', 'Restore the same starting state. Enable the optimization under evaluation through Overview. For routing, trust the hook in Codex /hooks and start a fresh session; the optimized task must actually start a native subagent.'),
        copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --variant optimized --task standard --harness ' + selected.value + checkSuffix),
        node('p', 'Run the same task and checks, then record the actual optimized outcome.'),
        copyRow(finish('optimized')),
        node('h3', '4. Refresh Results'),
        node('p', 'Run the capture commands from the same project where this dashboard was opened. Start/finish read quota, local session usage and routing receipts automatically; quality comes from the saved direct check, or from your recorded checks when no command is set. If a quota window resets during a run or the source is unavailable, that window stays unmeasured. Repeat representative pairs before drawing conclusions.'),
      );
    };
    selected.addEventListener('change', renderSteps);
    design.addEventListener('change', renderSteps); checkInput.addEventListener('input', renderSteps); stateInput.addEventListener('input', renderSteps);
    renderSteps();
    $('modal-content').append(
      messageBox('Why a comparison is needed', 'Normal usage records optimizer output and routing activity. Demonstrated savings require comparable baseline and optimized tasks; Token Harness cannot reconstruct an unrecorded baseline or decide whether your task passed its checks.'),
      selected, designLabel, design, checkLabel, checkInput, checkHint, stateLabel, stateInput, steps,
    );
    $('modal-actions').append(modalClose('Done'));
  }

  function renderEvidence() {
    const body = $('result-evidence');
    const openKeys = new Set([...body.querySelectorAll('details[open]')].map(item => item.dataset.key));
    body.replaceChildren();
    const savings = current?.savings?.rows || [];
    for (const id of optimizerIds()) {
      const info = optimizerInfo(id);
      const component = managedComponent(id);
      const measured = savings.filter(row => row.providerId === id);
      const scope = component?.configuredHarnesses?.length
        ? 'Setup: ' + component.configuredHarnesses.map(agentName).join(', ')
        : 'No setup detected';
      const signals = measured.length
        ? measured.map(row => optimizerSignal(row))
        : [{ value: 'No results yet', label: 'No output recorded for this period' }];
      const sections = measured.map(row => optimizerEvidenceDetail(row));
      if (!measured.length) {
        const nextStep = evidenceSection('Start recording results', [], component?.configured
          ? 'Use a connected coding app normally, then Refresh. Detected setup alone does not prove that the optimizer ran.'
          : 'Review this optimizer in Overview to see available connections.');
        nextStep.append(navigateButton('Open Overview', 'dashboard'));
        sections.push(nextStep);
      }
      addEvidenceRow(body, 'optimizer', info.name, scope, signals, measured.length, sections);
    }

    const routing = current?.value?.routing;
    const routingAgents = activeAgents();
    const blocked = routing?.state === 'blocked-by-quality';
    const routeSignals = routingAgents.flatMap(runtimeSignals);
    if (blocked) routeSignals.push({ value: 'Not credited', label: 'Quality gate did not pass', tone: 'warn' });
    else {
      if (routing?.savedLocalTokens !== null && routing?.savedLocalTokens !== undefined)
        routeSignals.push({
          value: count(Math.abs(routing.savedLocalTokens)) + (routing.savedLocalTokens < 0 ? ' tokens added' : ' tokens saved'),
          label: 'Paired end-to-end local usage',
          tone: routing.savedLocalTokens < 0 ? 'warn' : routing.savedLocalTokens > 0 ? 'good' : '',
        });
      const routeSources = current?.value?.byHarness?.length ? current.value.byHarness : [{ routing }];
      for (const source of routeSources) {
        for (const [key, label] of [['allowance5h', '5h allowance'], ['allowance7d', '7d allowance']]) {
          const signal = allowanceSignal(source.routing?.[key], (source.harnessId ? agentName(source.harnessId) + ' · ' : '') + label + ' · paired evidence');
          if (signal) routeSignals.push(signal);
        }
      }
      if (routing?.state !== 'measured') routeSignals.push({ value: 'Savings comparison needed', label: routing?.pairs ? 'Quality passed; comparable usage is missing' : 'Activity is recorded automatically; savings need paired runs' });
      if (!routingAgents.some(agent => runtimeSignals(agent).length) && !routing?.pairs) routeSignals.push({ value: 'No runtime activity yet', label: 'Open Details to check enablement and trust' });
    }
    const routingSections = [evidenceSection('Savings verification', [['Quality-passed pairs', count(routing?.pairs || 0)]],
      blocked ? 'A quality regression blocks the savings claim.' : routing?.basis || 'Callback activity proves the hook ran. Savings require paired runs with a passing quality gate.'), comparisonSection()];
    for (const agent of routingAgents)
      routingSections.push(routingDetails(agent));
    const runtimeCount = routingAgents.reduce((total, agent) => total + (agent.promptRouting?.verificationTier === 'runtime-observed' ? (agent.promptRouting.promptSubmissions || 0) + (agent.promptRouting.subagentsStarted || 0) + (agent.promptRouting.subagentsStopped || 0) : 0), 0);
    addEvidenceRow(body, 'routing', 'Automatic prompt routing', 'Recorded callbacks across projects · ' + (routingAgents.map(agent => agent.name).join(', ') || 'No coding app detected'), routeSignals, runtimeCount + (routing?.pairs || 0), routingSections);

    const allowanceSources = current?.value?.byHarness?.length ? current.value.byHarness : [current?.value || {}];
    const quotaSignals = allowanceSources.flatMap(source => [['allowance5h', '5h'], ['allowance7d', '7d']].flatMap(([key, label]) => {
      const signal = allowanceSignal(source[key], (source.harnessId ? agentName(source.harnessId) + ' · ' : '') + label + ' · paired allowance');
      return signal ? [signal] : [];
    }));
    const liveSignals = routingAgents.flatMap(liveAllowanceSignals);
    const allowanceSections = [evidenceSection('Allowance savings', [], allowanceSummary().detail), comparisonSection(), ...routingAgents.flatMap(liveAllowanceDetails)];
    addEvidenceRow(body, 'measurement', '5h / 7d allowance', 'Current balances · current-project paired savings',
      [...quotaSignals, ...liveSignals].length ? [...quotaSignals, ...liveSignals] : [{ value: 'No quota reading', label: 'Open Details for the missing source and comparison steps' }], quotaSignals.length + liveSignals.length, allowanceSections);
    const quality = qualitySummary();
    addEvidenceRow(body, 'measurement', 'Task quality', 'Current-project task checks', [{ value: quality.value, label: quality.detail, tone: quality.cls }], current?.value?.quality?.pairs || 0, [
      evidenceSection('Quality checks', [['Evaluated pairs', count(current?.value?.quality?.pairs || 0)], ['Regressions', count(current?.value?.quality?.regressions || 0)]],
        'Quality comes from the actual checks recorded for both task variants. Token reductions and callbacks do not evaluate correctness.'), comparisonSection(),
    ]);

    for (const mismatch of current?.value?.qualityMismatches || []) {
      addEvidenceRow(body, 'measurement', 'Check disagreement · ' + mismatch.benchmarkId, 'Direct check result takes precedence',
        [{value:'Check overrides recorded quality',label:mismatch.details.join('; '),tone:'warn'}],1,[]);
    }
    for (const experiment of current?.value?.factorial || []) {
      const sections = [evidenceSection('Quality by arm', Object.entries(experiment.quality || {}),
        'Direct checks or manually recorded acceptance; all effects retain their quality gate.')];
      for (const effect of experiment.effects || []) {
        const value = amount => amount === null ? 'Not measured' : count(amount);
        sections.push(evidenceSection(effect.unit + (effect.scope ? ' · ' + effect.scope : ''), [
          ['Compression saving',value(effect.compressionSaving)],['Routing saving',value(effect.routingSaving)],
          ['Combined saving',value(effect.combinedSaving)],['Interaction cost',value(effect.interactionCost)],
        ], 'Positive interaction cost means the combined run cost more than the single effects predict. Units and quota windows remain separate.'));
      }
      sections.push(evidenceSection('Evidence limits', [], (experiment.reasons || []).join(' ')));
      if (experiment.qualityMismatches?.length) sections.push(evidenceSection('Check disagreements',[],experiment.qualityMismatches.join(', ') + ': direct check overrides recorded quality.'));
      addEvidenceRow(body,'measurement','Four-arm comparison · ' + experiment.benchmarkId,'Exploratory · configuration '+(experiment.configurationEvidence||'user-declared'),
        [{value:experiment.status,label:experiment.combinedQualityRegression ? 'Combined quality regressed; savings blocked' : 'Repeated controlled sets needed',tone:experiment.combinedQualityRegression?'warn':''}],
        Object.keys(experiment.quality || {}).length,sections);
    }

    for (const agent of routingAgents) {
      const linked = current?.savings?.byHarness?.find(group => group.harnessId === agent.id)?.rows || [];
      const configured = configuredProviders().filter(component => component.configuredHarnesses?.includes(agent.id)).map(component => optimizerInfo(component.providerId).name);
      const sections = [evidenceSection('App attribution', [['Detected setup', configured.join(', ') || 'None']],
        linked.length ? 'These are the same optimizer records shown above, scoped to this app. They are not additional savings.' : 'No app-scoped reducer amount is available for this period. Shared and aggregate totals stay under their optimizer.')];
      sections.push(...linked.map(row => optimizerEvidenceDetail(row, true)));
      sections.push(routingDetails(agent), ...liveAllowanceDetails(agent));
      const signals = [...linked.map(row => optimizerSignal(row, true)), ...runtimeSignals(agent), ...liveAllowanceSignals(agent)];
      const paired = current?.value?.byHarness?.find(source => source.harnessId === agent.id);
      if (paired?.quality?.state === 'preserved') signals.push({ value: 'Quality preserved', label: count(paired.quality.pairs) + ' evaluated pairs · this app', tone: 'good' });
      if (paired?.quality?.state === 'regressed') signals.push({ value: 'Quality regression', label: 'Savings claims need review', tone: 'warn' });
      if (paired?.pairs) sections.push(evidenceSection('App comparisons', [['Paired tasks', count(paired.pairs)]], 'These comparisons identify ' + agent.name + '; they are part of the current-project results above.'));
      addEvidenceRow(body, 'harness', agent.name, agent.version ? 'v' + agent.version : 'Version unavailable',
        signals.length ? signals : [{ value: 'No activity recorded', label: 'Open Details for routing status and quota availability' }], signals.length, sections);
    }

    for (const item of current?.value?.candidates || []) {
      if (!(item.pairs > 0)) continue;
      const candidate = (current?.optimizationCandidates || []).find(entry => entry.id === item.candidateId);
      const name = candidate?.name || item.candidateId;
      addEvidenceRow(body, 'candidate', name, 'Experimental', [{ value: count(item.pairs) + ' paired results', label: 'Evaluation evidence' }], item.pairs, [
        evidenceSection('Paired evaluation', [
          ['Optimized better', count(item.optimizedBetter || 0)],
          ['Baseline better', count(item.baselineBetter || 0)],
        ], 'Evaluation does not automatically promote or activate this optimizer.'),
      ]);
    }
    for (const details of body.querySelectorAll('details')) details.open = openKeys.has(details.dataset.key);
    applyEvidenceFilters();
  }

  function applyEvidenceFilters() {
    const body = $('result-evidence');
    if (!body) return;
    const filter = $('evidence-filter').value.trim().toLocaleLowerCase();
    const type = $('evidence-type').value;
    const sort = $('evidence-sort').value;
    const rows = [...body.children].filter(row => row.dataset.type);
    const sourceOrder = { optimizer: 0, routing: 1, harness: 2, measurement: 3, candidate: 4 };
    rows.sort((a, b) => sort === 'evidence'
      ? Number(Number(b.dataset.amount) > 0) - Number(Number(a.dataset.amount) > 0)
        || sourceOrder[a.dataset.type] - sourceOrder[b.dataset.type]
        || Number(b.dataset.amount) - Number(a.dataset.amount) || a.dataset.name.localeCompare(b.dataset.name)
      : sort === 'type'
        ? a.dataset.type.localeCompare(b.dataset.type) || a.dataset.name.localeCompare(b.dataset.name)
        : a.dataset.name.localeCompare(b.dataset.name));
    for (const row of rows) {
      row.hidden = !((type === 'all' || row.dataset.type === type) && (!filter || row.dataset.search.includes(filter)));
      body.append(row);
    }
    const visible = rows.filter(row => !row.hidden).length;
    $('evidence-count').textContent = visible + ' of ' + rows.length + ' sources';
    $('evidence-empty').hidden = visible > 0;
    $('evidence-reset').hidden = !filter && type === 'all';
  }

  function measurementHelp() {
    modal('How Token Harness measures results');
    $('modal-content').append(
      messageBox('Tool output', 'Local output reductions are shown only from recorded optimizer evidence. Different providers are never silently added together.'),
      messageBox('Setup and results', 'App evidence includes attributed optimizer output, observed routing callbacks and current quota readings. RTK shared history stays unattributed; records from a Token Harness per-app hook database can identify their app. HarnessTrim records identify an app only when the telemetry names it. Setup alone does not establish attribution.'),
      messageBox('5h / 7d allowance', 'Subscription-plan savings appear only when authoritative paired allowance evidence exists and quality is preserved.'),
      messageBox('API cost', 'Money is shown only when billed-token evidence and a verified price basis exist. Token Harness does not convert local output reduction into invented dollars or euros.'),
      messageBox('Quality', 'Both task variants need recorded quality checks. A regression can block a positive savings claim.'),
      actionButton('Record a comparison', () => measurementGuide(), 'secondary'),
    );
    $('modal-actions').append(modalClose('Done'));
  }

  function renderResults() {
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    const savings = current?.savings?.rows || [];
    const reduction = bestReduction();
    $('result-summary').replaceChildren(
      reduction
        ? metricCard('Recorded output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement + ' · changed outputs only', 'positive')
        : metricCard('Recorded output', savings.length ? count(savings.length) + ' measurement groups' : 'No records yet', savings.length ? 'Open Evidence for each source and unit.' : 'Use a connected app, then Refresh.'),
      metricCard('Allowance saved · 5h / 7d', allowance.value, allowance.detail, allowance.cls),
      metricCard('Quality', quality.value, quality.detail, quality.cls),
    );
    renderEvidence();
    $('results-period-note').textContent = current?.savings?.firstRecordedAt
      ? 'All locally recorded projects · ' + new Date(current.savings.firstRecordedAt).toLocaleDateString() + ' – ' + new Date(current.savings.lastRecordedAt).toLocaleDateString()
      : 'All locally recorded projects · no results for this period.';
    if (current?.savings?.errors) $('results-period-note').textContent += ' · ' + count(current.savings.errors) + ' records could not be read';
  }

  function renderActivity() {
    const root = $('activity');
    root.replaceChildren();
    const rows = [...(activityState?.activity || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    if (!rows.length) {
      root.append(sectionEmpty('No checks or changes have been recorded in this app session.'));
      return;
    }
    const visible = rows.slice(0, 8);
    for (const item of visible) {
      const row = node('div', undefined, 'activity-row');
      row.append(pill(item.state === 'success' ? 'Done' : item.state === 'attention' ? 'Attention' : 'Working', item.state === 'success' ? 'good' : item.state === 'attention' ? 'warn' : ''), node('span', item.message), node('time', date(item.at), 'caption'));
      root.append(row);
    }
    if (rows.length > visible.length) root.prepend(node('p', 'Showing the latest ' + visible.length + ' of ' + rows.length + ' entries.', 'caption'));
  }

  async function loadActivity() {
    try {
      activityState = await request('/api/activity');
      renderActivity();
      renderMaintenance();
      if (reading && activityState?.loading?.running && Array.isArray(activityState.loading.stages)) {
        const finished = activityState.loading.stages.filter(stage => stage.state !== 'working').length;
        const total = activityState.loading.stages.length;
        const working = activityState.loading.stages.filter(stage => stage.state === 'working').slice(0, 2).map(stage => stage.label.toLowerCase());
        setStatus(finished + '/' + total + ' checks finished' + (working.length ? ' · ' + working.join(' · ') : ''), true);
      }
    } catch {
      // Activity is supplementary and must never hide the main dashboard.
    }
  }

  async function checkUpdatesOnStartup() {
    if (updateCheckStarted) return;
    if ($('modal').open) {
      $('modal').addEventListener('close', checkUpdatesOnStartup, { once: true });
      return;
    }
    if (busy || reading) {
      setTimeout(checkUpdatesOnStartup, 1000);
      return;
    }
    updateCheckStarted = true;
    try {
      await ensureSession();
      const result = await request('/api/update-check', { period: $('period').value, background: true });
      if (busy || reading || $('modal').open) {
        updateCheckStarted = false;
        if ($('modal').open) $('modal').addEventListener('close', checkUpdatesOnStartup, { once: true });
        else setTimeout(checkUpdatesOnStartup, 1000);
        return;
      }
      if (result.stack && current) {
        current = { ...current, stack: result.stack };
        renderDashboard();
        renderSetup();
        renderResults();
      }
      const root = $('update-notice');
      root.replaceChildren();
      if (!result.updatesAvailable) {
        root.hidden = true;
        return;
      }
      const copy = node('div');
      copy.append(node('strong', result.title || 'Token Harness update available'), node('p', (result.messages || []).join(' ') || 'Review and install the available update.', 'caption'));
      root.append(copy, actionButton('Review update', () => readOnlyOperation('update-check'), 'secondary'));
      root.hidden = false;
    } catch {
      // The startup version check is supplementary; Refresh and Health and updates remain available.
    }
  }

  async function pollRouting() {
    if (document.hidden || busy || reading || $('modal').open || !current) return;
    try {
      const result = await request('/api/routing');
      if (busy || reading || $('modal').open || document.activeElement?.closest('#setup-agents, #result-evidence')) return;
      if (!Array.isArray(result.agents)) return;
      const byId = new Map(result.agents.map(agent => [agent.id, agent.promptRouting]));
      const previous = new Map((current.agents || []).map(agent => [agent.id, agent.promptRouting]));
      const changed = [...byId].some(([id, routing]) => JSON.stringify(previous.get(id)) !== JSON.stringify(routing));
      if (!changed) return;
      current = {
        ...current,
        agents: (current.agents || []).map(agent => byId.has(agent.id)
          ? { ...agent, promptRouting: byId.get(agent.id) }
          : agent),
      };
      renderDashboard();
      renderAgentSetup();
      renderResults();
    } catch {
      // Runtime receipts are supplementary; the overview remains usable if this read fails.
    }
  }

  function render() {
    renderNotices();
    renderDashboard();
    renderSetup();
    renderResults();
  }

  async function refresh(force = false) {
    if (busy || reading) return;
    reading = true;
    setError('');
    setStatus(current ? 'Refreshing. Current data stays visible.' : 'Checking agents, managed optimizers and evidence…', true);
    $('refresh').disabled = true;
    const progressTimer = setInterval(() => { if (!document.hidden) loadActivity(); }, 700);
    try {
      await ensureSession();
      const period = $('period').value;
      const suffix = force ? '&refresh=1' : '';
      current = await request('/api/overview?period=' + encodeURIComponent(period) + suffix);
      periodCache.set(period, current);
      $('stale-state').hidden = true;
      $('stale-state').textContent = '';
      render();
      await loadActivity();
      setStatus('Updated at ' + new Date(current.generatedAt).toLocaleTimeString(), false);
    } catch (error) {
      setError(error.name === 'TimeoutError' ? 'The check took too long. Existing results were kept; choose Refresh to try again.' : error.message);
      setStatus('Check needs attention.', false);
    } finally {
      clearInterval(progressTimer);
      reading = false;
      $('refresh').disabled = false;
      if (current && !updateCheckStarted) checkUpdatesOnStartup();
    }
  }

  async function changePeriod() {
    const period = $('period').value;
    const cached = periodCache.get(period);
    if (cached) {
      current = cached;
      renderResults();
      setStatus('Showing cached ' + period + ' results. Setup was not re-read.', false);
      return;
    }
    if (busy || reading) return;
    reading = true;
    setStatus('Loading this results period only…', true);
    try {
      await ensureSession();
      current = await request('/api/overview?period=' + encodeURIComponent(period));
      periodCache.set(period, current);
      render();
      setStatus('Results period updated. Full setup was not changed.', false);
    } catch (error) {
      setError(error.message);
    } finally {
      reading = false;
      setStatus($('updated').textContent, false);
    }
  }

  function theme() {
    const value = localStorage.getItem('token-harness-theme') || 'system';
    $('theme').value = value;
    document.documentElement.dataset.theme = value === 'system' ? '' : value;
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.view, true));
  });
  document.querySelector('.view-tabs').addEventListener('keydown', event => {
    const views = Object.keys(VIEWS);
    const index = views.indexOf(selectedView);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % views.length
      : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : null;
    if (next === null) return;
    event.preventDefault();
    selectView(views[next], true);
  });
  $('overview-results').addEventListener('click', () => selectView('results', true));
  $('refresh').addEventListener('click', () => refresh(true));
  $('period').addEventListener('change', changePeriod);
  $('evidence-filter').addEventListener('input', applyEvidenceFilters);
  $('evidence-type').addEventListener('change', applyEvidenceFilters);
  $('evidence-sort').addEventListener('change', applyEvidenceFilters);
  $('evidence-reset').addEventListener('click', () => {
    $('evidence-filter').value = '';
    $('evidence-type').value = 'all';
    applyEvidenceFilters();
    $('evidence-filter').focus();
  });
  $('measurement-help').addEventListener('click', measurementHelp);
  $('record-comparison').addEventListener('click', () => measurementGuide());
  $('theme').addEventListener('change', () => {
    const value = $('theme').value;
    localStorage.setItem('token-harness-theme', value);
    document.documentElement.dataset.theme = value === 'system' ? '' : value;
  });
  $('modal').addEventListener('cancel', event => {
    if (busy && $('live-status').textContent.includes('Applying')) event.preventDefault();
    else closeModal();
  });

  theme();
  selectView('dashboard');
  refresh(false);
  setInterval(() => { if (!document.hidden) loadActivity(); }, 4000);
  setInterval(pollRouting, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollRouting(); });
})();
`;
