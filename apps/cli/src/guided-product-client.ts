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
    dashboard: ['Overview', 'Your coding agents, optimizer setup, health and measured results in one place.'],
    results: ['Results', 'Detailed measured savings, quality evidence, and recent activity.'],
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

  function componentConfiguredFor(id, agentId) {
    const component = managedComponent(id);
    return Boolean(component?.configuredHarnesses?.includes(agentId));
  }

  function baselineReadyFor(agentId) {
    return componentConfiguredFor('rtk', agentId) && componentConfiguredFor('harnesstrim', agentId);
  }

  function baselineIncompleteAgents() {
    return activeAgents().filter(agent => !baselineReadyFor(agent.id));
  }

  function providerSupportsAgent(providerId, agentId) {
    if (providerId === 'gitnexus') return agentId === 'claude';
    return agentId === 'claude' || agentId === 'codex';
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
        detail: 'Use Re-check health below to see whether the configured integration still matches its reviewed state.',
        action: 'verify',
      };
    if (incomplete.length)
      return {
        label: 'Setup incomplete',
        cls: 'warn',
        title: incomplete.length === 1
          ? 'Finish setup for ' + incomplete[0].name
          : 'Finish the recommended setup for your coding agents',
        detail: 'The recommended baseline is RTK + HarnessTrim. Finish setup on each incomplete coding-agent card below; you will see the exact safe plan before anything changes.',
        action: 'configure',
      };
    if (!(current?.savings?.rows || []).length)
      return {
        label: 'Ready',
        cls: 'good',
        title: 'Recommended setup is complete',
        detail: 'Use your coding agents normally. Measured results will appear when Token Harness has evidence to report.',
        action: 'results',
      };
    return {
      label: 'Ready',
      cls: 'good',
      title: 'Your recommended setup is active',
      detail: 'No setup action is required. The summary below shows what Token Harness can actually measure.',
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

  function componentState(component) {
    if (!component || component.detectedState === 'absent') return { label: 'Not installed', cls: '' };
    if (component.health === 'attention') return { label: 'Needs attention', cls: 'warn' };
    if (component.configured)
      return {
        label: component.verification === 'verified' ? 'Connected · verified' : 'Connected',
        cls: 'good',
      };
    if (component.installed) return { label: 'Installed · not connected', cls: '' };
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
      node('span', info.optional ? 'Optional optimizer' : 'Recommended baseline', 'caption'),
    );
    head.append(title, pill(state.label, state.cls));
    card.append(head, node('p', info.role));

    const facts = node('div', undefined, 'tool-facts');
    if (component?.version) facts.append(node('span', 'Installed version'), node('strong', 'v' + component.version));
    const configuredFor = component?.configuredHarnesses?.length
      ? component.configuredHarnesses.map(agentName).join(', ')
      : 'Not connected to a coding agent';
    facts.append(node('span', 'Connection'), node('strong', configuredFor));
    if (component?.update === 'available')
      facts.append(
        node('span', 'Update'),
        node('strong', 'v' + (component.updateAvailableVersion || 'new version') + ' available'),
      );
    else if (component?.update === 'blocked')
      facts.append(node('span', 'Update'), node('strong', 'Newer version not reviewed yet'));
    card.append(facts);

    if (component?.warnings?.length) {
      const attention = component.health === 'attention';
      const prerequisite = !component.installed && component.nextAction?.kind === 'install-configure';
      if (attention || prerequisite)
        card.append(
          messageBox(
            attention ? 'Needs attention' : 'Setup requirement',
            component.warnings[0].message,
            attention ? 'warn' : '',
          ),
        );
    }

    const actions = node('div', undefined, 'inline-actions');
    if (info.optional) {
      for (const agent of activeAgents()) {
        if (!providerSupportsAgent(id, agent.id)) continue;
        if (!component?.configuredHarnesses?.includes(agent.id))
          actions.append(
            actionButton(
              'Set up for ' + agent.name,
              () => reviewSetup(agent.id, id),
              'secondary',
            ),
          );
      }
    }
    if (component?.update === 'available')
      actions.append(actionButton('Install update', () => readOnlyOperation('updates'), 'secondary'));
    if (
      component?.configured &&
      (component.health === 'attention' || component.verification === 'degraded')
    )
      actions.append(actionButton('Re-check health', () => readOnlyOperation('verify'), 'secondary'));
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
          'Start Token Harness from a terminal where Claude Code or Codex is installed and available on PATH, then choose Refresh.',
          'warn',
        ),
      );
      return;
    }
    for (const agent of activeAgents()) {
      const ready = baselineReadyFor(agent.id);
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(
        node('h3', agent.name),
        node('span', agent.version ? 'v' + agent.version : 'Version unavailable', 'caption'),
      );
      head.append(title, pill(ready ? 'Ready' : 'Setup incomplete', ready ? 'good' : 'warn'));
      card.append(
        head,
        node(
          'p',
          ready
            ? 'RTK + HarnessTrim are configured for this coding agent.'
            : 'The agent is detected. Finish the recommended RTK + HarnessTrim setup to complete onboarding.',
        ),
      );
      if (agent.providers?.length)
        card.append(
          node(
            'p',
            'Connected optimizers: ' + agent.providers.join(', '),
            'caption',
          ),
        );
      if (!ready) {
        const actions = node('div', undefined, 'inline-actions');
        actions.append(actionButton('Finish setup', () => reviewSetup(agent.id)));
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
      provider
        ? 'Set up ' + provider.name + ' for ' + agent.name
        : 'Set up recommended optimizers for ' + agent.name,
    );
    $('modal-content').append(
      messageBox(
        'Safe preview first',
        provider
          ? 'Token Harness will inspect only ' + provider.name + ' for ' + agent.name + '. If setup is supported, the exact change appears before you confirm it.'
          : 'Token Harness will prepare the recommended RTK + HarnessTrim setup for ' + agent.name + '. The exact files and changes appear before you confirm them.',
      ),
      messageBox('Nothing changes yet', 'This first step only prepares the safe plan. You decide whether to apply it after seeing the concrete changes.'),
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
            provider ? 'This optimizer only' : 'Recommended setup',
            provider
              ? 'This approval changes only ' + provider.name + ' for ' + agent.name + '. Other optimizers are left unchanged.'
              : 'This approval covers only RTK + HarnessTrim for ' + agent.name + '. Optional optimizers stay separate.',
          ),
        );
        if (!data.changes.length)
          $('modal-content').append(
            messageBox(
              'No setup change available',
              (data.notices || []).join(' ') ||
                'This setup is already complete, or a prerequisite/version prevents Token Harness from changing it safely.',
            ),
          );
        for (const change of data.changes) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-content').append(messageBox('Safety', 'Apply uses the existing transactional engine with backups, compatibility checks, ownership checks and rollback. Unsupported versions are not forced.', 'safe'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket)
          $('modal-actions').append(
            actionButton(provider ? 'Set up ' + provider.name : 'Apply recommended setup', () => applyTicket(data.ticket), ''),
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
      $('modal-content').append(node('p', 'The dashboard is now marked as previous state. Choose Refresh when you want to re-read the complete setup.', 'caption'));
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
    $('managed-tools').replaceChildren(
      renderManagedTool('rtk'),
      renderManagedTool('harnesstrim'),
    );
    const optionalRoot = $('optional-tools');
    if (optionalRoot)
      optionalRoot.replaceChildren(
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

  function readOnlyOperation(kind) {
    if (busy) return;
    const isVerify = kind === 'verify';
    const run = modal(isVerify ? 'Re-check optimizer health' : 'Check for optimizer updates');
    $('modal-content').append(
      messageBox(
        isVerify ? 'Troubleshooting check' : 'Update preview',
        isVerify
          ? 'Re-checks the configured optimizer integrations without repairing or changing them. Normal setup already performs its own safety checks.'
          : 'Checks reviewed update channels first. If an installable update exists, you can approve it from this window.',
      ),
      progress(
        isVerify ? 'Checking configured optimizers' : 'Checking update channels',
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
      node('strong', 'Optimizer updates'),
      node(
        'p',
        available.length
          ? available.map(component => (TOOL_INFO[component.providerId]?.name || component.providerId) + ' has an update ready.').join(' ')
          : 'Check installed optimizer versions. If a reviewed update is available, you can install it from the same dialog.',
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
