/** Single-owner browser controller for the novice-facing local product UI. */
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
    dashboard: ['Overview', 'Your coding agents, optimization stack, health and measured results in one place.'],
    results: ['Results', 'A dashboard of optimizer results, coding-app links, quality information, and recent activity.'],
  };
  const TOOL_INFO = {
    rtk: {
      name: 'RTK',
      role: 'Reduces noisy command output before it reaches the model.',
      managed: true,
    },
    harnesstrim: {
      name: 'HarnessTrim',
      role: 'Adds version-aware instructions that help coding agents keep tool output and context lean.',
      managed: true,
    },
    mcptoon: {
      name: 'mcptoon',
      role: 'Provides compact MCP discovery integration and verifies the resulting setup.',
      managed: true,
      optional: true,
    },
    gitnexus: {
      name: 'GitNexus',
      role: 'Registers GitNexus as a narrow MCP integration for Claude Code and Codex and verifies the result.',
      managed: true,
      optional: true,
    },
    headroom: {
      name: 'Headroom',
      role: 'Provides local MCP compression and retrieval through the installed Headroom server.',
      managed: true,
      optional: true,
    },
  };
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
  const periodCache = new Map();

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
    document.querySelectorAll('[data-action],#refresh,#period').forEach(element => {
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
    if (focus) $('tab-' + view).focus();
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
    return ids.length ? [...new Set(ids)] : Object.keys(TOOL_INFO);
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
    return { value: 'Not measured yet', detail: 'Quality is never inferred from token savings alone.', cls: '' };
  }

  function allowanceSummary() {
    const five = current?.value?.allowance5h;
    const weekly = current?.value?.allowance7d;
    if (five?.state === 'blocked-by-quality' || weekly?.state === 'blocked-by-quality')
      return { value: 'Not credited', detail: 'A quota reduction exists, but quality evidence does not yet allow it to be credited.', cls: 'warn' };
    const parts = [];
    if (five?.state === 'measured' && five.savedPercent !== null) parts.push('5h ' + count(five.savedPercent) + '%');
    if (weekly?.state === 'measured' && weekly.savedPercent !== null) parts.push('7d ' + count(weekly.savedPercent) + '%');
    if (parts.length) return { value: parts.join(' · '), detail: 'Based only on authoritative paired allowance evidence.', cls: 'good' };
    return { value: 'Not measured yet', detail: 'Plan savings appear only when before/after allowance evidence exists.', cls: '' };
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
        detail: 'A paired benchmark favored the baseline. Token Harness is not crediting the affected savings.',
        action: 'results',
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
        title: 'Your optimization stack has available setup options',
        detail: 'Choose an optimizer and the coding apps to set it up for. Token Harness shows measured results separately from detected setup.',
        action: 'configure',
      };
    const unavailable = baselineUnavailableAgents();
    if (unavailable.length)
      return {
        label: 'Setup unavailable',
        cls: '',
        title: 'No automatic optimizer setup is currently available',
        detail: 'The installed providers do not currently expose a compatible managed connection for these coding agents. This is a capability limitation, not unfinished setup.',
        action: 'none',
      };
    if (!(current?.savings?.rows || []).length)
      return {
        label: 'Setup detected',
        cls: 'good',
        title: 'Recommended setup is complete',
        detail: 'Setup has been detected. This does not prove an optimizer ran or recorded a result; check the Results page for evidence linked to each agent.',
        action: 'results',
      };
    return {
      label: 'Ready',
      cls: 'good',
      title: 'Your setup has been checked',
      detail: 'No setup action is required. The summary below shows which results Token Harness has actually recorded.',
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
    } else if (assessment.action === 'results') {
      actions.append(navigateButton('View detailed results', 'results'));
    }
    if (actions.children.length) main.append(actions);
    $('dashboard-status').append(main, pill(assessment.label, assessment.cls));

    const reduction = bestReduction();
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    $('dashboard-metrics').replaceChildren(
      reduction
        ? metricCard('Measured output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement, 'positive')
        : metricCard('Measured output', 'No result yet', 'Missing measurements are not reported as zero savings.'),
      metricCard('5h / 7d allowance', allowance.value, allowance.detail, allowance.cls),
      metricCard('API cost', 'Not measured yet', 'Requires billed-token evidence and a verified price basis.'),
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
            : 'This card shows detected setup. It does not confirm that an optimizer ran or recorded results.';
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
      const routingState = routingPresentation(agent.routing);
      const routingLine = node('div', undefined, 'result-signal');
      routingLine.append(
        node('span', 'Smart model routing', 'caption'),
        pill(routingState.label, routingState.cls),
        actionButton(
          agent.routing?.state === 'off' ? 'Enable' : 'Configure',
          () => manageRouting(agent.id),
          'secondary',
        ),
      );
      card.append(routingLine);
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

  function connectionPresentation(target) {
    if (!target) return { label: 'Not targeted', cls: '' };
    if (target.state === 'connected') return { label: 'Setup detected', cls: 'good' };
    if (target.state === 'actionable') return { label: 'Available', cls: 'warn' };
    if (target.state === 'unavailable') return { label: 'Unavailable', cls: '' };
    return { label: 'Not applicable', cls: '' };
  }

  function renderConnectionOverview() {
    const root = $('connection-overview');
    if (!root) return;
    root.replaceChildren();
    const agents = activeAgents();
    const ids = optimizerIds();
    if (!agents.length) {
      root.append(sectionEmpty('Optimizer setup will appear when a supported coding app is detected.'));
      return;
    }

    const summary = node('div', undefined, 'connection-summary');
    const summaryText = node('div');
    summaryText.append(
      node('strong', ids.length + ' optimizer' + (ids.length === 1 ? '' : 's') + ' · ' + agents.length + ' coding agent' + (agents.length === 1 ? '' : 's')),
      node('p', 'This matrix shows where setup was detected, not proof that an optimizer ran. Measured results are shown separately on the Results page.', 'caption'),
    );
    summary.append(summaryText);
    const baselineActionable = ['rtk', 'harnesstrim'].some(id =>
      agents.some(agent => setupTarget(agent.id, id)?.state === 'actionable'),
    );
    if (baselineActionable)
      summary.append(actionButton('Set up recommended stack', () => reviewSetup(), ''));
    root.append(summary);

    const scroll = node('div', undefined, 'connection-scroll');
    const table = node('div', undefined, 'connection-table');
    table.style.setProperty('--connection-columns', String(agents.length));
    const header = node('div', undefined, 'connection-row connection-head');
    header.append(node('strong', 'Optimizer', 'connection-name'));
    for (const agent of agents) header.append(node('strong', agent.name, 'connection-cell'));
    header.append(node('strong', 'Action', 'connection-action'));
    table.append(header);

    for (const id of ids) {
      const info = optimizerInfo(id);
      const component = managedComponent(id);
      const row = node('div', undefined, 'connection-row');
      const nameCell = node('div', undefined, 'connection-name');
      nameCell.append(
        node('strong', info.name),
        node('span', info.optional ? 'Optional optimizer' : 'Recommended baseline', 'caption'),
        node('span', info.role, 'caption connection-role'),
        node('span', component?.version ? 'v' + component.version : 'Not installed', 'caption'),
      );
      row.append(nameCell);
      let actionable = false;
      for (const agent of agents) {
        const target = setupTarget(agent.id, id);
        const state = connectionPresentation(target);
        const cell = node('div', undefined, 'connection-cell');
        cell.append(pill(state.label, state.cls));
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
      else action.append(node('span', 'No action', 'caption'));
      row.append(action);
      table.append(row);
    }

    const routingRow = node('div', undefined, 'connection-row');
    const routingName = node('div', undefined, 'connection-name');
    routingName.append(
      node('strong', 'Smart Model Routing'),
      node('span', 'Optional model routing', 'caption'),
      node(
        'span',
        'Shadow observes locally; Conservative can route high-confidence simple requests to a selected model.',
        'caption connection-role',
      ),
    );
    routingRow.append(routingName);
    for (const agent of agents) {
      const state = routingPresentation(agent.routing);
      const cell = node('div', undefined, 'connection-cell');
      cell.append(
        pill(state.label, state.cls),
        actionButton(
          agent.routing?.state === 'off' ? 'Enable' : 'Configure',
          () => manageRouting(agent.id),
          'secondary',
        ),
      );
      routingRow.append(cell);
    }
    const routingAction = node('div', undefined, 'connection-action');
    routingAction.append(node('span', 'Per agent', 'caption'));
    routingRow.append(routingAction);
    table.append(routingRow);

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
      $('modal-content').append(messageBox('Prerequisites stay yours', 'An approved setup may install the exact reviewed mcptoon build only through an already-installed pipx. Token Harness does not install Python, pipx or administrator prerequisites.'));
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


  function routingPresentation(routing) {
    if (!routing || routing.state === 'off') return { label: 'Off', cls: '' };
    if (routing.state === 'shadow') return { label: 'Shadow', cls: 'good' };
    if (routing.state === 'conservative') return { label: 'Conservative', cls: 'good' };
    return { label: 'Needs attention', cls: 'warn' };
  }

  function bareRoutingModel(value) {
    if (!value) return '';
    const slash = value.indexOf('/');
    return slash >= 0 ? value.slice(slash + 1) : value;
  }

  function routingModelChoices(agent) {
    const choices = [];
    for (const item of agent?.models || []) {
      if (!item?.model || choices.some(choice => choice.model === item.model)) continue;
      choices.push(item);
    }
    return choices;
  }

  function routingSelect(labelText, choices, selected, includeEmpty = false) {
    const wrap = node('label', undefined, 'setup-choice-copy');
    wrap.append(node('strong', labelText));
    const select = node('select');
    if (includeEmpty) {
      const option = node('option', 'Choose a model…');
      option.value = '';
      select.append(option);
    }
    for (const choice of choices) {
      const option = node(
        'option',
        choice.displayName && choice.displayName !== choice.model
          ? choice.displayName + ' · ' + choice.model
          : choice.model,
      );
      option.value = choice.model;
      select.append(option);
    }
    if (selected && choices.some(choice => choice.model === selected)) select.value = selected;
    else if (!includeEmpty && choices.length) {
      const preferred = choices.find(choice => choice.isDefault);
      select.value = preferred?.model || choices[0].model;
    }
    wrap.append(select);
    return { wrap, select };
  }

  function reviewRoutingAction(harness, action, config, run) {
    const routeMode = config?.mode || 'shadow';
    const label =
      action === 'routing-metrics'
        ? 'Reading routing activity'
        : action === 'routing-remove'
          ? 'Reviewing routing disable'
          : 'Reviewing routing configuration';
    $('modal-content').replaceChildren(
      progress(label, 'Nothing changes while Token Harness reads the current local routing state.'),
    );
    $('modal-actions').replaceChildren(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request('/api/preview', {
          action,
          harness,
          ...(action === 'routing-setup'
            ? {
                routeMode,
                ...(config?.profileModel ? { routeProfileModel: config.profileModel } : {}),
                ...(routeMode === 'conservative' && config?.simpleModel
                  ? { routeSimpleModel: config.simpleModel }
                  : {}),
              }
            : {}),
        }),
      )
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        $('modal-content').replaceChildren(
          messageBox(
            'Smart Model Routing · ' + agentName(harness),
            action === 'routing-metrics'
              ? 'Local routing decisions and CCR activity only. Prompt text and credentials are not shown.'
              : action === 'routing-remove'
                ? 'Disable removes only the Token Harness-owned routing rule/profile. The coding-agent login and unrelated CCR settings are kept.'
                : routeMode === 'shadow'
                  ? 'Shadow records how requests would be classified. Routing decisions do not request a model switch.'
                  : 'Conservative may request the selected simple model only for high-confidence simple prompts. Ambiguous, complex, image and safety-gated requests pass through without a routing switch.',
          ),
        );
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || [])
          $('modal-content').append(node('p', notice, 'notice-row'));
        if (action !== 'routing-metrics')
          $('modal-content').append(
            messageBox(
              'Safety boundary',
              'Token Harness owns only its exact local CCR runtime, rule and profile. Enabling routing may reuse the existing local Codex/Claude login, but native coding-agent settings are not rewritten.',
              'safe',
            ),
          );
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket)
          $('modal-actions').append(
            actionButton(
              action === 'routing-remove' ? 'Disable routing' : 'Apply configuration',
              () => applyTicket(data.ticket),
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
        loadActivity();
      });
  }

  function manageRouting(harness) {
    if (busy) return;
    const agent = activeAgents().find(item => item.id === harness);
    if (!agent) return;
    const routing = agent.routing || {
      state: 'off',
      mode: null,
      detail: 'Smart Model Routing is not enabled.',
      launchCommand: null,
      profileModel: null,
      simpleModel: null,
    };
    const state = routingPresentation(routing);
    const run = modal('Smart Model Routing · ' + agentName(harness));
    const models = routingModelChoices(agent);
    const currentProfileModel =
      bareRoutingModel(routing.profileModel) ||
      agent.model ||
      models.find(choice => choice.isDefault)?.model ||
      models[0]?.model ||
      '';
    const currentSimpleModel = bareRoutingModel(routing.simpleModel);
    const currentMode =
      routing.mode === 'conservative' ? 'conservative' : 'shadow';

    $('modal-content').append(
      messageBox(
        'Current status: ' + state.label,
        routing.detail ||
          'Smart Model Routing is optional and uses only the local Token Harness-managed routing runtime.',
        routing.state === 'attention' ? 'warn' : routing.state === 'off' ? undefined : 'safe',
      ),
    );

    const form = node('div', undefined, 'setup-choice-list');
    form.append(
      node('h3', routing.state === 'off' ? 'Enable routing' : 'Configuration'),
      node(
        'p',
        'Shadow is the recommended starting mode. Conservative is the mode that can actually switch simple requests to another model.',
        'caption',
      ),
    );

    const modeLabel = node('label', undefined, 'setup-choice-copy');
    modeLabel.append(node('strong', 'Mode'));
    const modeSelect = node('select');
    for (const [value, label] of [
      ['shadow', 'Shadow · observe only'],
      ['conservative', 'Conservative · route simple requests'],
    ]) {
      const option = node('option', label);
      option.value = value;
      modeSelect.append(option);
    }
    modeSelect.value = currentMode;
    modeLabel.append(modeSelect);
    form.append(modeLabel);

    const base = routingSelect(
      'Base model',
      models,
      currentProfileModel,
      models.length === 0,
    );
    base.wrap.append(
      node(
        'span',
        'This is the model used by the routed launcher before any Conservative routing decision. Token Harness uses the agent current/default model when it can observe it.',
        'caption',
      ),
    );
    form.append(base.wrap);

    const simple = routingSelect('Simple model', models, currentSimpleModel, true);
    simple.wrap.append(
      node(
        'span',
        'Used only in Conservative mode for high-confidence simple requests. Token Harness does not guess which model you consider the cheaper/simple target.',
        'caption',
      ),
    );
    form.append(simple.wrap);
    $('modal-content').append(form);

    const advanced = node('details', undefined, 'agent-details');
    advanced.append(node('summary', 'Advanced'));
    advanced.append(
      node(
        'p',
        'Classification is local and deterministic; no paid routing API or local LLM is needed. Routing decisions are not counted as savings without separate quality and allowance evidence.',
        'caption',
      ),
    );
    if (routing.launchCommand) {
      advanced.append(node('p', 'Routed launcher', 'caption'), copyRow(routing.launchCommand));
    }
    advanced.append(
      actionButton(
        'View 30-day activity',
        () => reviewRoutingAction(harness, 'routing-metrics', { mode: currentMode }, run),
        'secondary',
      ),
    );
    $('modal-content').append(advanced);

    const primary = actionButton(
      routing.state === 'off'
        ? 'Enable routing'
        : routing.state === 'attention'
          ? 'Repair routing'
          : 'Save configuration',
      () =>
        reviewRoutingAction(
          harness,
          'routing-setup',
          {
            mode: modeSelect.value,
            profileModel: base.select.value || null,
            simpleModel: simple.select.value || null,
          },
          run,
        ),
    );
    const updateAvailability = () => {
      simple.wrap.hidden = modeSelect.value !== 'conservative';
      primary.disabled =
        (models.length > 0 && !base.select.value) ||
        (modeSelect.value === 'conservative' && !simple.select.value);
    };
    modeSelect.addEventListener('change', updateAvailability);
    base.select.addEventListener('change', updateAvailability);
    simple.select.addEventListener('change', updateAvailability);

    $('modal-actions').append(modalClose('Cancel'));
    if (routing.state !== 'off' && routing.mode !== null)
      $('modal-actions').append(
        actionButton(
          'Disable routing',
          () => reviewRoutingAction(harness, 'routing-remove', { mode: routing.mode }, run),
          'secondary',
        ),
      );
    $('modal-actions').append(primary);
    updateAvailability();
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
            : 'Setup is already complete. Re-check only when troubleshooting or after external changes.',
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
          : 'Checks Token Harness and installed optimizer versions. If an update is available, install it from the same dialog; restart this app after updating Token Harness.',
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

  function renderSavings() {
    const root = $('result-savings');
    root.replaceChildren();
    const rows = current?.savings?.rows || [];
    if (!rows.length) {
      root.append(sectionEmpty('No measured optimizer output has been recorded for this period. Missing data is not zero savings.'));
      return;
    }
    for (const row of rows) {
      const card = node('article', undefined, 'evidence-row');
      const head = node('div', undefined, 'evidence-head');
      head.append(node('h3', row.provider), pill(row.measurement));
      card.append(head, node('strong', row.impact?.headline || count(row.saved) + ' ' + row.unit, 'evidence-value'), node('p', row.impact?.detail || 'Recorded optimization output.'));
      const facts = node('dl', undefined, 'evidence-facts');
      const values = [
        ['Recorded change', row.before !== null && row.after !== null ? count(row.before) + ' → ' + count(row.after) + ' ' + row.unit : count(Math.abs(row.saved)) + ' ' + row.unit],
        ['Operations', count(row.operations)],
        ['Coding agent', row.agents?.length ? row.agents.join(', ') : 'Not linked to an agent'],
      ];
      for (const [label, value] of values) {
        const wrap = node('div');
        wrap.append(node('dt', label), node('dd', value));
        facts.append(wrap);
      }
      card.append(facts);
      if (!row.agents?.length) {
        card.append(
          node(
            'p',
            row.providerId === 'rtk'
              ? 'RTK records these reductions but does not record whether Codex or Claude ran each command. The result is real, but Token Harness cannot assign it to either agent.'
              : 'The source did not include a coding-agent identity, so Token Harness keeps this result unassigned.',
            'caption',
          ),
        );
      }
      root.append(card);
    }
  }

  function measurementHelp() {
    modal('How Token Harness measures results');
    $('modal-content').append(
      messageBox('Tool output', 'Local output reductions are shown only from recorded optimizer evidence. Different providers are never silently added together.'),
      messageBox('Setup and results', 'A detected setup does not prove the optimizer ran. RTK records command reductions but its history does not say whether Codex or Claude ran each command, so those results cannot be shown under either app. HarnessTrim appears under an app only when its saved result names that app.'),
      messageBox('5h / 7d allowance', 'Subscription-plan savings appear only when authoritative paired allowance evidence exists and quality is preserved.'),
      messageBox('API cost', 'Money is shown only when billed-token evidence and a verified price basis exist. Token Harness does not convert local output reduction into invented dollars or euros.'),
      messageBox('Quality', 'Quality is evaluated separately. A regression can block a positive savings claim.'),
    );
    $('modal-actions').append(modalClose('Done'));
  }

  function renderCandidateResults() {
    const root = $('candidate-results');
    root.replaceChildren();
    const evidence = current?.value?.candidates || [];
    if (!evidence.some(item => item.pairs > 0)) {
      root.append(sectionEmpty('No experimental candidate has completed paired evidence yet. Experimental tools are optional and do not affect managed setup.'));
      return;
    }
    for (const item of evidence.filter(entry => entry.pairs > 0)) {
      const candidate = EXPERIMENTAL.find(entry => entry.id === item.candidateId);
      if (!candidate) continue;
      const card = node('article', undefined, 'evidence-row');
      card.append(node('h3', candidate.name), node('strong', count(item.pairs) + ' paired result(s)', 'evidence-value'));
      card.append(node('p', count(item.optimizedBetter || 0) + ' optimized better · ' + count(item.baselineBetter || 0) + ' baseline better. This is evaluation evidence, not automatic promotion.'));
      root.append(card);
    }
  }

  function renderResultOptimizers() {
    const root = $('result-optimizers');
    if (!root) return;
    root.replaceChildren();
    const rows = current?.savings?.rows || [];
    for (const id of optimizerIds()) {
      const component = managedComponent(id);
      const info = optimizerInfo(id);
      const state = componentState(id, component);
      const card = node('article', undefined, 'tool-card result-overview-card');
      const head = node('div', undefined, 'tool-head');
      head.append(node('h3', info.name), pill(state.label, state.cls));
      card.append(head, node('p', info.role));
      const facts = node('div', undefined, 'tool-facts');
      facts.append(
        node('span', 'Setup detected for'),
        node('strong', component?.configuredHarnesses?.length ? component.configuredHarnesses.map(agentName).join(', ') : 'No detected agent'),
      );
      const measured = rows.filter(row => row.providerId === id);
      facts.append(
        node('span', 'Recorded results'),
        node('strong', measured.length ? measured.length + ' recorded result' + (measured.length === 1 ? '' : 's') : 'None in this period'),
      );
      card.append(facts);
      if (!measured.length) {
        card.append(
          node(
            'p',
            component?.configured
              ? 'Setup is detected, but no result was recorded in the selected period.'
              : 'No result was recorded for this optimizer in the selected period.',
            'caption',
          ),
        );
      } else {
        for (const row of measured) {
          const evidence = node('div', undefined, 'result-signal');
          evidence.append(
            node('span', row.measurement, 'caption'),
            node('strong', row.impact?.headline || count(row.saved) + ' ' + row.unit),
            node('span', count(row.operations) + ' operation' + (row.operations === 1 ? '' : 's'), 'caption'),
          );
          card.append(evidence);
        }
      }
      root.append(card);
    }
  }

  function renderResultAgents() {
    const root = $('result-agents');
    if (!root) return;
    root.replaceChildren();
    const rows = current?.savings?.rows || [];
    if (!activeAgents().length) {
      root.append(sectionEmpty('No supported coding agent is currently detected.'));
      return;
    }
    for (const agent of activeAgents()) {
      const setupDetected = configuredProviders().filter(component =>
        component.configuredHarnesses?.includes(agent.id),
      );
      const measured = rows.filter(row => row.harnesses?.includes(agent.id));
      const rtkUnattributed = rows.some(row =>
        row.providerId === 'rtk' && !row.agents?.length,
      );
      const notes = [];
      if (
        setupDetected.some(component => component.providerId === 'rtk') &&
        !measured.some(row => row.providerId === 'rtk')
      ) {
        notes.push(
          rtkUnattributed
            ? 'RTK has saved command-output data, but its history does not say whether Codex or Claude ran each command. Token Harness keeps those results under RTK instead of guessing.'
            : 'RTK setup is detected, but no RTK result can be linked to this agent in the selected period.',
        );
      }
      if (
        setupDetected.some(component => component.providerId === 'harnesstrim') &&
        !measured.some(row => row.providerId === 'harnesstrim')
      ) {
        notes.push(
          'HarnessTrim setup is detected, but no HarnessTrim result is linked to this app in the selected period. Setup alone does not mean it was used.',
        );
      }
      if (!setupDetected.length && !measured.length) {
        notes.push('No optimizer setup or agent-linked result was found for this coding app.');
      }
      const card = node('article', undefined, 'tool-card result-overview-card');
      const head = node('div', undefined, 'tool-head');
      head.append(node('h3', agent.name), pill(setupDetected.length ? 'Setup detected' : 'No setup', setupDetected.length ? 'good' : ''));
      card.append(
        head,
        node('p', agent.version ? 'v' + agent.version : 'Version unavailable', 'caption'),
      );
      const facts = node('div', undefined, 'tool-facts');
      facts.append(
        node('span', 'Setup found'),
        node('strong', setupDetected.length ? setupDetected.map(component => optimizerInfo(component.providerId).name).join(', ') : 'None'),
        node('span', 'Results linked to this agent'),
        node('strong', measured.length ? measured.map(row => row.provider).join(', ') : 'None in this period'),
      );
      card.append(facts);
      for (const note of notes) card.append(node('p', note, 'caption'));
      root.append(card);
    }
  }

  function renderResults() {
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    const configured = configuredProviders();
    const connectionCount = configured.reduce(
      (total, component) => total + (component.configuredHarnesses?.length || 0),
      0,
    );
    const measuredProviders = new Set(
      (current?.savings?.rows || []).map(row => row.providerId).filter(Boolean),
    );
    $('result-summary').replaceChildren(
      metricCard('Configured optimizers', count(configured.length), optimizerIds().length + ' optimizer(s) tracked in the stack.', configured.length ? 'positive' : ''),
      metricCard('Setups detected', count(connectionCount), 'Detected optimizer setup links; this is not proof of measured activity.', connectionCount ? 'positive' : ''),
      metricCard('Optimizers with results', count(measuredProviders.size), 'Providers with recorded measurements in the selected period.'),
      metricCard('5h / 7d allowance', allowance.value, allowance.detail, allowance.cls),
      metricCard('Quality', quality.value, quality.detail, quality.cls),
    );
    renderResultOptimizers();
    renderResultAgents();
    renderSavings();
    renderCandidateResults();
    $('results-period-note').textContent = current?.savings?.firstRecordedAt
      ? 'Recorded from ' + date(current.savings.firstRecordedAt) + ' through ' + date(current.savings.lastRecordedAt)
      : 'No recorded result dates for this period.';
  }

  function renderActivity() {
    const root = $('activity');
    root.replaceChildren();
    const rows = activityState?.activity || [];
    if (!rows.length) {
      root.append(sectionEmpty('No checks or changes have been recorded in this app session.'));
      return;
    }
    for (const item of rows) {
      const row = node('div', undefined, 'activity-row');
      row.append(pill(item.state === 'success' ? 'Done' : item.state === 'attention' ? 'Attention' : 'Working', item.state === 'success' ? 'good' : item.state === 'attention' ? 'warn' : ''), node('span', item.message), node('time', date(item.at), 'caption'));
      root.append(row);
    }
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
      setStatus('Checked at ' + new Date(current.generatedAt).toLocaleTimeString() + '. Full checks run again only when you choose Refresh.', false);
    } catch (error) {
      setError(error.name === 'TimeoutError' ? 'The check took too long. Existing results were kept; choose Refresh to try again.' : error.message);
      setStatus('Check needs attention.', false);
    } finally {
      clearInterval(progressTimer);
      reading = false;
      $('refresh').disabled = false;
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
  $('refresh').addEventListener('click', () => refresh(true));
  $('period').addEventListener('change', changePeriod);
  $('measurement-help').addEventListener('click', measurementHelp);
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
})();
`;
