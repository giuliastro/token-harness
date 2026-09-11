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
    dashboard: ['Dashboard', 'Your coding setup, what is active, and what to do next.'],
    setup: ['Setup', 'Install and configure optimization tools in a clear order.'],
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
  };
  const EXPERIMENTAL = [
    {
      id: 'headroom',
      name: 'Headroom',
      category: 'Context optimization',
      purpose: 'Evaluated as a broader context-compression layer for coding-agent sessions.',
      install: 'uv tool install --python 3.13 "headroom-ai[all]"',
      fallback: 'pip install "headroom-ai[all]"',
      verify: 'headroom --version',
      activation:
        'For an experiment, Headroom can launch a wrapped Claude Code or Codex session. Token Harness does not run that wrapper or make it persistent for you.',
      activationCommands: ['headroom wrap claude', 'headroom wrap codex'],
      warning:
        'Installing the CLI is separate from activating it. Do not count a benchmark as Headroom evidence unless the optimized run actually used the wrapper.',
    },
    {
      id: 'mcptoon',
      name: 'mcptoon',
      category: 'MCP discovery',
      purpose: 'Evaluated for smaller MCP manifests and tool-schema discovery context.',
      install: 'pip install mcptoon',
      fallback: null,
      verify: 'mcptoon --version',
      activation:
        'Token Harness currently evaluates mcptoon as a read-only MCP context candidate. It does not run mcptoon init/add/sync or rewrite your agent MCP configuration.',
      activationCommands: ['mcptoon manifest --compact', 'mcptoon manifest --json'],
      warning:
        'The compact and JSON manifest commands are evidence surfaces, not automatic Claude Code or Codex integration.',
    },
    {
      id: 'gitnexus',
      name: 'GitNexus',
      category: 'Repository exploration',
      purpose: 'Evaluated for reducing repeated repository exploration by using a local code graph.',
      install: 'npm install -g gitnexus@latest',
      fallback: null,
      verify: 'gitnexus --version',
      activation:
        'GitNexus needs a repository index before it can provide graph-backed context. Token Harness deliberately does not create that index or register MCP automatically.',
      activationCommands: ['gitnexus analyze', 'gitnexus setup -c codex'],
      warning:
        'gitnexus analyze changes the repository by creating its index and agent context files. Run it only in a repository you intentionally want to evaluate.',
    },
  ];
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
    const configured = configuredProviders();
    const stack = current?.stack;
    if (!agents.length)
      return {
        label: 'Agent needed',
        cls: 'warn',
        title: 'Connect a supported coding agent first',
        detail: 'Token Harness could not find Claude Code or Codex in the environment that started this app.',
        action: 'setup',
      };
    if (current?.value?.quality?.state === 'regressed')
      return {
        label: 'Needs attention',
        cls: 'warn',
        title: 'Review the quality regression before increasing optimization',
        detail: 'A paired benchmark favored the baseline. Token Harness is not crediting the affected savings.',
        action: 'results',
      };
    if (stack?.state === 'attention')
      return {
        label: 'Needs attention',
        cls: 'warn',
        title: 'One integration needs attention',
        detail: 'Open Setup to see the affected tool and run the read-only integration check.',
        action: 'setup',
      };
    if (!configured.length)
      return {
        label: 'Setup incomplete',
        cls: 'warn',
        title: 'Your coding agent is ready; add the managed optimization stack',
        detail: 'Start with RTK and HarnessTrim. You will review every proposed configuration change before it is applied.',
        action: 'setup',
      };
    if (!(current?.savings?.rows || []).length)
      return {
        label: 'Ready',
        cls: 'good',
        title: 'Setup is ready; use your coding agent normally',
        detail: 'Token Harness has no measured result yet. Keep working normally and results will appear after evidence is recorded.',
        action: 'results',
      };
    return {
      label: 'Ready',
      cls: 'good',
      title: 'Your managed setup is active',
      detail: 'No urgent action is required. Review measured results or explore optional experimental tools when you want to.',
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
    main.append(node('span', 'SETUP STATUS', 'eyebrow'), node('h2', assessment.title), node('p', assessment.detail));
    const actions = node('div', undefined, 'inline-actions');
    actions.append(
      assessment.action === 'setup'
        ? navigateButton('Open setup', 'setup')
        : navigateButton('View results', 'results'),
    );
    if (assessment.action !== 'setup') actions.append(navigateButton('Manage setup', 'setup', 'secondary'));
    main.append(actions);
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

    const active = $('dashboard-active');
    active.replaceChildren();
    for (const agent of activeAgents()) {
      const row = node('div', undefined, 'status-row');
      row.append(node('div', agent.name + (agent.version ? ' · v' + agent.version : '')), pill(agent.state, agent.configured ? 'good' : ''));
      active.append(row);
    }
    for (const component of configuredProviders()) {
      const row = node('div', undefined, 'status-row');
      const name = TOOL_INFO[component.providerId]?.name || component.displayName || component.providerId;
      const configuredFor = (component.configuredHarnesses || []).map(agentName).join(', ');
      row.append(node('div', name + (configuredFor ? ' · ' + configuredFor : '')), pill(component.health === 'healthy' ? 'Verified' : 'Configured', component.health === 'attention' ? 'warn' : 'good'));
      active.append(row);
    }
    if (!active.children.length) active.append(sectionEmpty('No managed optimization is active yet. Open Setup to start.'));

    const checklist = $('dashboard-checklist');
    checklist.replaceChildren();
    const agentReady = activeAgents().length > 0;
    const managedReady = configuredProviders().length > 0;
    const evidenceReady = (current?.savings?.rows || []).length > 0;
    for (const item of [
      [agentReady, 'Coding agent detected', agentReady ? activeAgents().map(agent => agent.name).join(', ') : 'Claude Code or Codex must be visible to this process.'],
      [managedReady, 'Managed optimizer configured', managedReady ? configuredProviders().map(item => TOOL_INFO[item.providerId]?.name || item.providerId).join(', ') : 'RTK/HarnessTrim setup has not been completed yet.'],
      [evidenceReady, 'Measured result available', evidenceReady ? 'Recorded optimization evidence is available.' : 'Use your configured coding agent normally to build evidence.'],
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
    if (component.configured) return { label: component.verification === 'verified' ? 'Configured + verified' : 'Configured', cls: 'good' };
    if (component.installed) return { label: 'Installed · setup needed', cls: '' };
    return { label: 'Not installed/configured', cls: '' };
  }

  function renderManagedTool(id) {
    const info = TOOL_INFO[id];
    const component = managedComponent(id);
    const state = componentState(component);
    const card = node('article', undefined, 'tool-card');
    const head = node('div', undefined, 'tool-head');
    const title = node('div');
    title.append(node('h3', info.name), node('span', 'Managed by Token Harness', 'caption'));
    head.append(title, pill(state.label, state.cls));
    card.append(head, node('p', info.role));
    const facts = node('div', undefined, 'tool-facts');
    const configuredFor = component?.configuredHarnesses?.length
      ? component.configuredHarnesses.map(agentName).join(', ')
      : 'No agent yet';
    facts.append(node('span', 'Configured for'), node('strong', configuredFor));
    if (component?.version) facts.append(node('span', 'Version'), node('strong', 'v' + component.version));
    card.append(facts);
    if (component?.health === 'attention' && component.warnings?.length)
      card.append(messageBox('Needs attention', component.warnings[0].message, 'warn'));
    return card;
  }

  function renderAgentSetup() {
    const root = $('setup-agents');
    root.replaceChildren();
    if (!activeAgents().length) {
      root.append(messageBox('No supported agent detected', 'Start Token Harness from a terminal where Claude Code or Codex is installed and available on PATH, then choose Refresh.', 'warn'));
      return;
    }
    for (const agent of activeAgents()) {
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(node('h3', agent.name), node('span', agent.version ? 'v' + agent.version : 'Version unavailable', 'caption'));
      head.append(title, pill('Detected', 'good'));
      card.append(head, node('p', agent.configured ? 'At least one managed optimizer is configured for this agent.' : 'The agent is available, but managed optimizer setup is not complete.'));
      root.append(card);
    }
  }

  function reviewSetup(agentId) {
    if (busy) return;
    const agent = activeAgents().find(item => item.id === agentId);
    if (!agent) return;
    const run = modal('Review managed setup for ' + agent.name);
    $('modal-content').append(
      messageBox('What this checks', 'RTK and HarnessTrim are the two managed optimization tools in this build. Token Harness will inspect both for ' + agent.name + ' and propose only compatible changes.'),
      messageBox('Nothing changes yet', 'This step is read-only. If a change is available, you will see exactly what it writes before an Apply button appears.'),
      progress('Checking ' + agent.name, 'Reading installed optimizer versions and current integration state.'),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', { action: 'setup', harness: agentId }))
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        $('modal-content').replaceChildren();
        $('modal-content').append(messageBox('Managed stack', 'This review covers RTK and HarnessTrim only. Experimental tools are never installed or activated by this action.'));
        if (!data.changes.length) $('modal-content').append(messageBox('No managed change proposed', (data.notices || []).join(' ') || 'This agent already has the supported setup, or no safe managed change is available.'));
        for (const change of data.changes) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('modal-content').append(item);
        }
        for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
        $('modal-content').append(messageBox('Safety', 'Apply uses the existing transactional engine with backups, compatibility checks, ownership checks and rollback. Unsupported versions are not forced.', 'safe'));
        $('modal-actions').replaceChildren(modalClose(data.ticket ? 'Cancel' : 'Done'));
        if (data.ticket) $('modal-actions').append(actionButton('Apply reviewed setup', () => applyTicket(data.ticket), ''));
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
      $('modal-title').textContent = result.ok ? 'Setup completed' : 'Setup needs attention';
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
    $('managed-tools').replaceChildren(renderManagedTool('rtk'), renderManagedTool('harnesstrim'));
    const actions = $('managed-setup-actions');
    actions.replaceChildren();
    if (!activeAgents().length) {
      actions.append(sectionEmpty('A supported coding agent must be detected before managed setup can be reviewed.'));
      return;
    }
    actions.append(node('p', 'Choose the agent you want to configure. Review setup is read-only; Apply appears only after a concrete safe plan is shown.', 'caption'));
    const buttons = node('div', undefined, 'inline-actions');
    for (const agent of activeAgents())
      buttons.append(actionButton('Review setup for ' + agent.name, () => reviewSetup(agent.id)));
    actions.append(buttons);
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

  function renderExperimental() {
    const root = $('experimental-tools');
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
    const run = modal(isVerify ? 'Check integrations' : 'Check optimizer updates');
    $('modal-content').append(
      messageBox('Read-only check', isVerify ? 'Verifies the currently configured managed integrations. It does not repair or change configuration.' : 'Checks update channels for installed managed optimizers. It does not download or upgrade anything.'),
      progress(isVerify ? 'Checking integrations' : 'Checking update channels', 'Nothing will be changed.'),
    );
    $('modal-actions').append(modalClose('Cancel'));
    setBusy(true, false);
    ensureSession()
      .then(() => request(isVerify ? '/api/verify' : '/api/update-check', { period: $('period').value }))
      .then(result => {
        if (run !== modalRun || !$('modal').open) return;
        $('modal-content').replaceChildren(messageBox(result.ok ? 'Completed' : 'Needs attention', (result.messages || []).join(' ') || 'Check completed.', result.ok ? 'safe' : 'warn'));
        $('modal-actions').replaceChildren(modalClose('Done'));
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
    verifyText.append(node('strong', 'Check integrations'), node('p', 'Read-only verification of configured managed tools.', 'caption'));
    verify.append(verifyText, actionButton('Check', () => readOnlyOperation('verify'), 'secondary'));
    const updates = node('article', undefined, 'maintenance-row');
    const updateText = node('div');
    updateText.append(node('strong', 'Check optimizer updates'), node('p', 'Read-only version check. Nothing is upgraded automatically.', 'caption'));
    updates.append(updateText, actionButton('Check updates', () => readOnlyOperation('updates'), 'secondary'));
    root.append(verify, updates);
    if (activityState?.canUndo) {
      const undo = node('article', undefined, 'maintenance-row');
      const undoText = node('div');
      undoText.append(node('strong', 'Undo last dashboard change'), node('p', 'Review and restore the exact last transaction from this app session.', 'caption'));
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
