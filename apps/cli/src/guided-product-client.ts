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
    dashboard: ['Overview', 'Your agents, optimizer status, results summary, and the next useful action.'],
    results: ['Results', 'Measured savings, quality evidence, and recent activity.'],
  };
  const TOOL_INFO = {
    rtk: {
      name: 'RTK',
      role: 'Reduces noisy command output before it reaches the model.',
      managed: true,
    },
    harnesstrim: {
      name: 'HarnessTrim',
      role: 'Adds reviewed instructions that help coding agents keep tool output and context lean.',
      managed: true,
    },
    mcptoon: {
      name: 'mcptoon',
      role: 'Provides the reviewed compact MCP discovery integration on exact admitted versions.',
      managed: true,
      optional: true,
    },
    gitnexus: {
      name: 'GitNexus',
      role: 'Registers an already-installed reviewed GitNexus CLI as a narrow Claude MCP integration.',
      managed: true,
      optional: true,
    },
    headroom: {
      name: 'Headroom',
      role: 'Provides local MCP compression and retrieval through the reviewed Headroom server.',
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
      ? (applying ? 'Applying only the reviewed change…' : 'Reading current state…')
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

  function configuredProviders() {
    return (current?.stack?.components || []).filter(component => component.configured);
  }

  function configuredFor(component, agentId) {
    return Boolean(component?.configuredHarnesses?.includes(agentId));
  }

  function baselineReady(agentId) {
    return ['rtk', 'harnesstrim'].every(id => configuredFor(managedComponent(id), agentId));
  }

  function providerSupportedForAgent(providerId, agentId) {
    return providerId !== 'gitnexus' || agentId === 'claude';
  }

  function availableUpdates(stack = current?.stack) {
    return (stack?.components || []).filter(component => component.update === 'available');
  }

  function blockedUpdates(stack = current?.stack) {
    return (stack?.components || []).filter(component => component.update === 'blocked');
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
        title: 'Review the recorded quality regression',
        detail: 'A paired benchmark favored the baseline. Token Harness is not crediting the affected savings.',
        action: 'results',
      };
    if (stack?.state === 'attention')
      return {
        label: 'Needs attention',
        cls: 'warn',
        title: 'One optimizer setup needs attention',
        detail: 'Run Verify setup below to see whether the configured optimizer connections are still healthy.',
        action: 'verify',
      };
    const incomplete = agents.filter(agent => !baselineReady(agent.id));
    if (incomplete.length)
      return {
        label: 'Setup needed',
        cls: 'warn',
        title: 'Finish the recommended setup',
        detail: 'Your coding agent is detected. Connect the RTK + HarnessTrim baseline so Token Harness can manage the normal optimization path.',
        action: 'setup',
      };
    if (!(current?.savings?.rows || []).length)
      return {
        label: 'Ready',
        cls: 'good',
        title: 'Setup complete',
        detail: 'The recommended optimizer setup is connected. Use your coding agent normally; measured results will appear when evidence is recorded.',
        action: 'results',
      };
    return {
      label: 'Ready',
      cls: 'good',
      title: 'Token Harness is configured',
      detail: 'No setup action is required. Results below summarize recorded evidence; optional optimizers remain separate.',
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
    if (assessment.action === 'setup') {
      for (const agent of activeAgents().filter(item => !baselineReady(item.id)))
        actions.append(actionButton('Set up ' + agent.name, () => reviewSetup(agent.id)));
    } else if (assessment.action === 'verify') {
      actions.append(actionButton('Verify setup', () => readOnlyOperation('verify')));
    } else if (assessment.action === 'results') {
      actions.append(navigateButton('View full results', 'results'));
    }
    if (actions.children.length) main.append(actions);
    $('dashboard-status').append(main, pill(assessment.label, assessment.cls));

    const reduction = bestReduction();
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    $('dashboard-metrics').replaceChildren(
      reduction
        ? metricCard('Measured output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement, 'positive')
        : metricCard('Measured output', 'No result yet', 'Results appear only after measured optimizer evidence exists.'),
      metricCard('5h / 7d allowance', allowance.value, allowance.detail, allowance.cls),
      metricCard('Quality', quality.value, quality.detail, quality.cls),
    );

    const active = $('dashboard-active');
    active.replaceChildren();
    for (const agent of activeAgents()) {
      const ready = baselineReady(agent.id);
      const row = node('div', undefined, 'status-row');
      row.append(
        node('div', agent.name + (agent.version ? ' · v' + agent.version : '')),
        pill(ready ? 'Setup complete' : 'Setup needed', ready ? 'good' : 'warn'),
      );
      active.append(row);
    }
    for (const component of configuredProviders()) {
      const row = node('div', undefined, 'status-row');
      const name = TOOL_INFO[component.providerId]?.name || component.displayName || component.providerId;
      const configuredForText = (component.configuredHarnesses || []).map(agentName).join(', ');
      row.append(
        node('div', name + (configuredForText ? ' · ' + configuredForText : '')),
        pill(component.health === 'attention' ? 'Needs attention' : 'Configured', component.health === 'attention' ? 'warn' : 'good'),
      );
      active.append(row);
    }
    if (!active.children.length) active.append(sectionEmpty('No supported coding agent or configured optimizer is visible yet.'));

    const checklist = $('dashboard-checklist');
    checklist.replaceChildren();
    const agentReady = activeAgents().length > 0;
    const baselineComplete = agentReady && activeAgents().every(agent => baselineReady(agent.id));
    const evidenceReady = (current?.savings?.rows || []).length > 0;
    for (const item of [
      [agentReady, 'Coding agent detected', agentReady ? activeAgents().map(agent => agent.name).join(', ') : 'Claude Code or Codex must be visible to Token Harness.'],
      [baselineComplete, 'Recommended setup complete', baselineComplete ? 'RTK + HarnessTrim are connected to every detected agent.' : 'Use the Set up button beside each detected agent that still needs the recommended baseline.'],
      [evidenceReady, 'Measured result available', evidenceReady ? 'Recorded optimizer evidence is available.' : 'After setup, use your coding agent normally; missing evidence is not reported as zero.'],
    ]) {
      const row = node('div', undefined, 'check-row');
      row.append(node('span', item[0] ? '✓' : '○', 'check-icon ' + (item[0] ? 'done' : '')), node('div'));
      row.lastChild.append(node('strong', item[1]), node('p', item[2], 'caption'));
      checklist.append(row);
    }
  }

  function componentState(component) {
    if (!component) return { label: 'Not detected', cls: '' };
    if (component.health === 'attention') return { label: 'Needs attention', cls: 'warn' };
    if (component.configured)
      return {
        label: component.verification === 'verified' ? 'Ready' : 'Configured',
        cls: 'good',
      };
    if (component.installed) return { label: 'Setup needed', cls: 'warn' };
    return { label: 'Not installed', cls: '' };
  }

  function renderManagedTool(id) {
    const info = TOOL_INFO[id];
    const component = managedComponent(id);
    const state = componentState(component);
    const card = node('article', undefined, 'tool-card');
    const head = node('div', undefined, 'tool-head');
    const title = node('div');
    title.append(
      node('h3', info.name),
      node('span', info.optional ? 'Optional optimizer' : 'Recommended optimizer', 'caption'),
    );
    head.append(title, pill(state.label, state.cls));
    card.append(head, node('p', info.role));

    const facts = node('div', undefined, 'tool-facts');
    const configuredForText = component?.configuredHarnesses?.length
      ? component.configuredHarnesses.map(agentName).join(', ')
      : 'Not configured';
    facts.append(node('span', 'Used with'), node('strong', configuredForText));
    if (component?.version) facts.append(node('span', 'Version'), node('strong', 'v' + component.version));
    if (component?.update === 'available' && component.updateAvailableVersion)
      facts.append(node('span', 'Update'), node('strong', 'v' + component.updateAvailableVersion + ' available'));
    card.append(facts);

    if (component?.warnings?.length) {
      const attention = component.health === 'attention';
      const prerequisite = !component.installed && component.nextAction?.kind === 'install-configure';
      if (attention || prerequisite)
        card.append(
          messageBox(
            attention ? 'Needs attention' : 'Prerequisite needed',
            component.warnings[0].message,
            attention ? 'warn' : '',
          ),
        );
    }

    const actions = node('div', undefined, 'inline-actions');
    for (const agent of activeAgents().filter(agent => providerSupportedForAgent(id, agent.id))) {
      if (!configuredFor(component, agent.id))
        actions.append(
          actionButton(
            'Set up ' + info.name + ' for ' + agent.name,
            () => reviewSetup(agent.id, id),
            info.optional ? 'secondary' : '',
          ),
        );
    }
    if (
      component?.configured &&
      (component.nextAction?.kind === 'verify' || component.health === 'attention')
    )
      actions.append(actionButton('Verify ' + info.name, () => readOnlyOperation('verify'), 'secondary'));
    if (component?.update === 'available')
      actions.append(actionButton('Update ' + info.name, applyUpdates, 'secondary'));
    if (component && (component.managedByTokenHarness || component.configured))
      actions.append(
        actionButton('Remove ' + info.name + ' setup', () => reviewRemoval(component), 'secondary'),
      );
    if (actions.children.length) card.append(actions);
    return card;
  }

  function renderAgentSetup() {
    const root = $('setup-agents');
    root.replaceChildren();
    if (!activeAgents().length) {
      root.append(
        messageBox(
          'No supported coding agent detected',
          'Install Claude Code or Codex, or start Token Harness from a terminal where the agent is available on PATH, then choose Refresh.',
          'warn',
        ),
      );
      return;
    }
    for (const agent of activeAgents()) {
      const ready = baselineReady(agent.id);
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(
        node('h3', agent.name),
        node('span', agent.version ? 'v' + agent.version : 'Version unavailable', 'caption'),
      );
      head.append(title, pill(ready ? 'Setup complete' : 'Setup needed', ready ? 'good' : 'warn'));
      card.append(
        head,
        node(
          'p',
          ready
            ? 'The recommended RTK + HarnessTrim setup is connected to this agent.'
            : 'Token Harness can see this agent, but the recommended RTK + HarnessTrim setup is not complete.',
        ),
      );
      if (agent.providers?.length)
        card.append(node('p', 'Connected optimizers: ' + agent.providers.join(', ') + '.', 'caption'));
      if (!ready) {
        const actions = node('div', undefined, 'inline-actions');
        actions.append(actionButton('Set up ' + agent.name, () => reviewSetup(agent.id)));
        card.append(actions);
      }
      root.append(card);
    }
  }

  function reviewSetup(agentId, providerId = null) {
    if (busy) return;
    const agent = activeAgents().find(item => item.id === agentId);
    if (!agent) return;
    const provider = providerId ? TOOL_INFO[providerId] : null;
    if (providerId && !provider) return;
    const run = modal(
      provider ? 'Set up ' + provider.name + ' for ' + agent.name : 'Set up ' + agent.name,
    );
    $('modal-content').append(
      messageBox(
        'Before anything changes',
        provider
          ? 'Token Harness checks whether ' + provider.name + ' can be safely connected to ' + agent.name + ' on this exact installed version.'
          : 'Token Harness checks the recommended RTK + HarnessTrim setup for ' + agent.name + ' and prepares only changes supported by the installed versions.',
      ),
      messageBox('Nothing changes yet', 'This first step only prepares the setup. You will see the exact change before an Apply setup button appears.'),
      progress('Checking ' + agent.name, 'Reading installed optimizer versions and current integration state.'),
    );
    if (providerId === 'gitnexus')
      $('modal-content').append(
        messageBox(
          'License boundary',
          'GitNexus 1.6.12 is reviewed technically but carries PolyForm Noncommercial terms. Token Harness does not install or index it. Continue only when those terms fit your use.',
          'warn',
        ),
      );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request('/api/preview', {
          action: 'setup',
          harness: agentId,
          ...(providerId ? { provider: providerId } : {}),
        }),
      )
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        $('modal-content').replaceChildren();
        $('modal-content').append(
          messageBox(
            'Setup scope',
            provider
              ? 'This setup changes only ' + provider.name + ' for the selected coding agent. The recommended RTK + HarnessTrim baseline is separate.'
              : 'This setup covers only the recommended RTK + HarnessTrim baseline. Optional optimizers are configured separately.',
          ),
        );
        if (!data.changes.length) $('modal-content').append(messageBox('No managed change proposed', (data.notices || []).join(' ') || 'This agent already has the supported setup, or no safe managed change is available.'));
        for (const change of data.changes) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-content').append(messageBox('Safety', 'Apply uses the existing transactional engine with backups, compatibility checks, ownership checks and rollback. Unsupported versions are not forced.', 'safe'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket) $('modal-actions').append(actionButton('Apply setup', () => applyTicket(data.ticket), ''));
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

  function reviewRemoval(component) {
    if (busy || !component) return;
    const info = TOOL_INFO[component.providerId] || {
      name: component.displayName || component.providerId,
    };
    const run = modal('Remove ' + info.name + ' setup');
    $('modal-content').append(
      messageBox(
        'Before anything changes',
        'Token Harness checks its ownership receipts and current configuration. Only setup recorded as Token Harness-owned can be removed safely.',
      ),
      progress(
        'Checking ' + info.name + ' ownership',
        'Provider software and unrelated user configuration are left alone.',
      ),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request('/api/preview', {
          action: 'remove',
          provider: component.providerId,
        }),
      )
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        $('modal-content').replaceChildren();
        if (!(data.changes || []).length)
          $('modal-content').append(
            messageBox(
              'Nothing to remove',
              (data.notices || []).join(' ') ||
                'No Token Harness-owned setup can be removed from this optimizer.',
            ),
          );
        for (const change of data.changes || []) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || [])
          $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-content').append(
          messageBox(
            'Safety',
            'Removal uses the existing ownership-aware transaction. Provider installation remains user-owned and edited or unrelated configuration is not forced.',
            'safe',
          ),
        );
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket)
          $('modal-actions').append(
            actionButton('Remove setup', () => applyTicket(data.ticket), 'secondary'),
          );
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

  async function applyTicket(ticket) {
    if (!ticket || busy) return;
    const run = modalRun;
    setBusy(true, true);
    $('modal-actions').replaceChildren(modalClose('Applying…', true));
    $('modal-content').append(progress('Applying the reviewed change', 'Keep this window open until the transaction finishes.'));
    try {
      await ensureSession();
      const result = await request('/api/apply', { ticket });
      if (run !== modalRun) return;
      $('modal-title').textContent = result.title || (result.ok ? 'Setup completed' : 'Setup needs attention');
      $('modal-content').replaceChildren(messageBox(result.ok ? 'Completed' : 'Needs attention', (result.messages || []).join(' '), result.ok ? 'safe' : 'warn'));
      $('modal-content').append(node('p', 'The overview is now marked as previous state. Choose Refresh when you want to re-read the complete setup.', 'caption'));
      $('stale-state').hidden = false;
      $('stale-state').textContent = 'A setup change was applied. Displayed status is the previous state until you choose Refresh.';
      $('modal-actions').replaceChildren(modalClose('Done'));
      loadActivity();
    } catch (error) {
      if (run !== modalRun) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
      $('modal-actions').replaceChildren(modalClose('Close'));
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  function renderManagedSetup() {
    $('baseline-tools').replaceChildren(
      renderManagedTool('rtk'),
      renderManagedTool('harnesstrim'),
    );
    $('optional-tools').replaceChildren(
      renderManagedTool('mcptoon'),
      renderManagedTool('gitnexus'),
      renderManagedTool('headroom'),
    );
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

  function applyUpdates() {
    if (busy) return;
    const updates = availableUpdates();
    const run = modal('Update optimizers');
    if (!updates.length) {
      $('modal-content').append(
        messageBox(
          'Check for updates first',
          'No reviewed update is currently shown. Run Check for updates so Token Harness can read the provider channels before applying anything.',
        ),
      );
      $('modal-actions').append(
        modalClose('Close'),
        actionButton('Check for updates', () => readOnlyOperation('updates'), 'secondary'),
      );
      return;
    }

    $('modal-content').append(
      messageBox(
        'Updates ready to install',
        updates
          .map(component =>
            (TOOL_INFO[component.providerId]?.name || component.displayName || component.providerId) +
            ' ' +
            (component.version ? 'v' + component.version : 'installed') +
            ' → ' +
            (component.updateAvailableVersion ? 'v' + component.updateAvailableVersion : 'reviewed newer version'),
          )
          .join(' · '),
      ),
      messageBox(
        'What Update now does',
        'Only reviewed provider update channels are used. Compatibility and transactional safety checks still apply; blocked or unreviewed versions are not forced.',
      ),
    );
    $('modal-actions').append(
      modalClose('Cancel'),
      actionButton('Update now', async () => {
        if (run !== modalRun || busy) return;
        setBusy(true, true);
        $('modal-actions').replaceChildren(modalClose('Updating…', true));
        $('modal-content').append(
          progress('Updating reviewed optimizers', 'Keep this window open until the update result is recorded.'),
        );
        try {
          await ensureSession();
          const result = await request('/api/update-apply', { confirm: true });
          if (run !== modalRun) return;
          $('modal-title').textContent = result.title || (result.ok ? 'Updates applied' : 'Update needs attention');
          $('modal-content').replaceChildren(
            messageBox(
              result.ok ? 'Completed' : 'Needs attention',
              (result.messages || []).join(' ') || 'The update operation finished.',
              result.ok ? 'safe' : 'warn',
            ),
          );
          $('stale-state').hidden = false;
          $('stale-state').textContent =
            'Optimizer versions may have changed. Choose Refresh to read the current setup.';
          $('modal-actions').replaceChildren(modalClose('Done'));
          loadActivity();
        } catch (error) {
          if (run !== modalRun) return;
          $('modal-error').textContent = error.message;
          $('modal-error').hidden = false;
          $('modal-actions').replaceChildren(modalClose('Close'));
        } finally {
          if (run === modalRun) setBusy(false, false);
        }
      }),
    );
  }

  function readOnlyOperation(kind) {
    if (busy) return;
    const isVerify = kind === 'verify';
    const run = modal(isVerify ? 'Verify setup' : 'Check for optimizer updates');
    $('modal-content').append(
      messageBox(
        isVerify ? 'What Verify setup does' : 'What this check does',
        isVerify
          ? 'Checks whether the optimizer configuration Token Harness can see is still connected and healthy. It does not change or repair anything.'
          : 'Reads the update channels for installed optimizers. If a reviewed update is available, this dialog will offer Update now.',
      ),
      progress(isVerify ? 'Verifying configured optimizers' : 'Checking installed optimizer versions', 'Nothing will be changed during this check.'),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() =>
        request(isVerify ? '/api/verify' : '/api/update-check', {
          period: $('period').value,
        }),
      )
      .then(result => {
        if (run !== modalRun || !$('modal').open) return;
        if (result.stack && current) {
          current = { ...current, stack: result.stack };
          renderDashboard();
          renderManagedSetup();
          renderMaintenance();
        }
        $('modal-content').replaceChildren(
          messageBox(
            result.ok ? 'Completed' : 'Needs attention',
            (result.messages || []).join(' ') || 'Check completed.',
            result.ok ? 'safe' : 'warn',
          ),
        );
        const updates = isVerify ? [] : availableUpdates(result.stack);
        $('modal-actions').replaceChildren(modalClose(updates.length ? 'Later' : 'Done'));
        if (updates.length)
          $('modal-actions').append(actionButton('Update now', applyUpdates));
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

    const verify = node('article', undefined, 'maintenance-row');
    const verifyText = node('div');
    verifyText.append(
      node('strong', 'Verify setup'),
      node('p', 'Confirm that configured optimizers are still connected to the detected coding agents. This check never changes configuration.', 'caption'),
    );
    verify.append(verifyText, actionButton('Verify now', () => readOnlyOperation('verify'), 'secondary'));
    root.append(verify);

    const updates = node('article', undefined, 'maintenance-row');
    const updateText = node('div');
    const available = availableUpdates();
    const blocked = blockedUpdates();
    const updateChecked = (current?.stack?.components || []).some(component => component.update !== 'not-checked');
    if (available.length) {
      updateText.append(
        node('strong', 'Optimizer updates'),
        node(
          'p',
          available
            .map(component => TOOL_INFO[component.providerId]?.name || component.displayName || component.providerId)
            .join(', ') + ' can be updated now.',
          'caption',
        ),
      );
      updates.append(updateText, actionButton('Update now', applyUpdates));
    } else {
      const detail = blocked.length
        ? 'A newer version exists for ' +
          blocked.map(component => TOOL_INFO[component.providerId]?.name || component.providerId).join(', ') +
          ', but it is outside reviewed compatibility and will not be installed.'
        : updateChecked
          ? 'No reviewed optimizer update is currently available.'
          : 'Check installed optimizer versions. If a reviewed update exists, you can install it from the result.';
      updateText.append(node('strong', 'Optimizer updates'), node('p', detail, 'caption'));
      updates.append(
        updateText,
        actionButton(updateChecked ? 'Check again' : 'Check for updates', () => readOnlyOperation('updates'), 'secondary'),
      );
    }
    root.append(updates);

    if (activityState?.canUndo) {
      const undo = node('article', undefined, 'maintenance-row');
      const undoText = node('div');
      undoText.append(
        node('strong', 'Undo last change'),
        node('p', 'Review and restore the exact last transaction made from this app session.', 'caption'),
      );
      undo.append(undoText, actionButton('Review undo', undoLastChange, 'secondary'));
      root.append(undo);
    }
  }

  function renderSetup() {
    renderAgentSetup();
    renderManagedSetup();
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
        ['Agents', row.agents?.length ? row.agents.join(', ') : 'not attributed'],
      ];
      for (const [label, value] of values) {
        const wrap = node('div');
        wrap.append(node('dt', label), node('dd', value));
        facts.append(wrap);
      }
      card.append(facts);
      root.append(card);
    }
  }

  function measurementHelp() {
    modal('How Token Harness measures results');
    $('modal-content').append(
      messageBox('Tool output', 'Local output reductions are shown only from recorded optimizer evidence. Different providers are never silently added together.'),
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

  function renderResults() {
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    const reduction = bestReduction();
    $('result-summary').replaceChildren(
      reduction ? metricCard('Measured output', reduction.impact.headline, reduction.provider + ' · ' + reduction.measurement, 'positive') : metricCard('Measured output', 'No result yet', 'No measured optimizer output is available for this period.'),
      metricCard('5h / 7d allowance', allowance.value, allowance.detail, allowance.cls),
      metricCard('API cost', 'Not measured yet', 'Requires billed-token evidence and a verified price basis.'),
      metricCard('Quality', quality.value, quality.detail, quality.cls),
    );
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
