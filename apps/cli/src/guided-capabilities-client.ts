/** Keeps existing guided capabilities visible without restoring the old action-heavy layout. */
export const GUIDE_CAPABILITIES_JS = String.raw`
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const originalFetch = window.fetch.bind(window);
  const managedProviders = new Set(['rtk', 'harnesstrim']);
  const HELP = {
    'claude-effort': ['Change reasoning in Claude', 'Inside Claude Code, use /effort. Token Harness keeps difficult work above its quality floor.', '/effort'],
    'codex-effort': ['Change reasoning in Codex', 'Inside Codex, use /model to review model and reasoning settings.', '/model'],
    'claude-tools': ['Review Claude tools', 'Inside Claude Code, use /mcp. Disable only tools you know you do not need.', '/mcp'],
    'codex-tools': ['Review Codex tools', 'Inside Codex, use /mcp. Fix or disable only tools you understand.', '/mcp'],
    measurements: ['How savings are measured', 'Token Harness reports only evidence it can defend. Local output reduction is not automatically converted into subscription minutes, weekly credits, API cost or quality.', null],
    cclimits: ['Show Claude allowance', 'Install the reviewed cclimits companion, keep Claude signed in, then Refresh this dashboard.', 'npm install --global cclimits@1.7.0'],
    python: ['Python is required', 'Make Python 3 available in the terminal that starts Token Harness, then reopen Token Harness.', 'python --version'],
    'claude-login': ['Sign in to Claude', 'Sign in inside Claude Code. Keep credentials inside Claude.', null],
    compatibility: ['Check this integration', 'Use Checks and maintenance for read-only verification. Unsupported or ambiguous configurations are left unchanged.', null],
  };
  let csrf = '';
  let working = false;
  let runId = 0;

  function actionButton(label, handler, cls = 'secondary') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.dataset.action = 'preserved-capability';
    button.addEventListener('click', handler);
    return button;
  }

  function pill(text, cls = '') {
    return node('span', text, 'pill ' + cls);
  }

  function commandRow(command) {
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
    });
    block.append(code, copy);
    return block;
  }

  function openModal(title) {
    runId += 1;
    $('modal-title').textContent = title;
    $('modal-content').replaceChildren();
    $('modal-actions').replaceChildren();
    $('modal-error').textContent = '';
    $('modal-error').hidden = true;
    if (!$('modal').open) $('modal').showModal();
    return runId;
  }

  function closeButton(label = 'Close', disabled = false) {
    const button = actionButton(label, () => {
      if (disabled) return;
      runId += 1;
      if ($('modal').open) $('modal').close();
    });
    button.disabled = disabled;
    return button;
  }

  function message(title, detail, cls = '') {
    const box = node('div', undefined, 'explain-box ' + cls);
    box.append(node('strong', title), node('p', detail));
    return box;
  }

  function progress(title, detail) {
    const box = node('div', undefined, 'operation-progress');
    const line = node('div', undefined, 'read-status');
    line.append(node('span', undefined, 'spinner'), node('strong', title));
    box.append(line, node('p', detail, 'caption'));
    return box;
  }

  async function ensureSession() {
    if (csrf) return;
    const response = await originalFetch('/api/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not start a local review session.');
    csrf = data.token;
  }

  async function request(path, body) {
    await ensureSession();
    const response = await originalFetch(path, {
      method: 'POST',
      cache: 'no-store',
      signal: AbortSignal.timeout(120000),
      headers: { 'Content-Type': 'application/json', 'X-Token-Harness-CSRF': csrf },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The operation did not finish.');
    return data;
  }

  function markStale() {
    $('stale-state').hidden = false;
    $('stale-state').textContent = 'A reviewed change was applied. Displayed status is the previous state until you choose Refresh.';
  }

  async function applyTicket(ticket, title) {
    if (!ticket || working) return;
    const activeRun = runId;
    working = true;
    $('modal-actions').replaceChildren(closeButton('Applying…', true));
    $('modal-content').append(progress('Applying the reviewed change', 'Only the approved transaction is being applied. Keep this window open until it finishes.'));
    try {
      const result = await request('/api/apply', { ticket });
      if (activeRun !== runId) return;
      $('modal-title').textContent = result.ok ? title : 'Change needs attention';
      $('modal-content').replaceChildren(message(result.ok ? 'Completed' : 'Needs attention', (result.messages || []).join(' ') || 'The transaction finished.', result.ok ? 'safe' : 'warn'));
      if (result.ok) markStale();
      $('modal-actions').replaceChildren(closeButton('Done'));
    } catch (error) {
      if (activeRun !== runId) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
      $('modal-actions').replaceChildren(closeButton('Close'));
    } finally {
      if (activeRun === runId) working = false;
    }
  }

  async function preview(body, title, applyLabel, completedTitle) {
    if (working || $('modal').open) return;
    const activeRun = openModal(title);
    working = true;
    $('modal-content').append(
      message('Nothing changes yet', 'This is a read-only review. Token Harness will show the exact managed change before Apply is available.'),
      progress('Checking current state', 'Reading the existing configuration and ownership record.'),
    );
    $('modal-actions').append(closeButton('Cancel'));
    try {
      const data = await request('/api/preview', body);
      if (activeRun !== runId || !$('modal').open) return;
      $('modal-content').replaceChildren();
      if (!(data.changes || []).length)
        $('modal-content').append(message('No managed change proposed', (data.notices || []).join(' ') || 'Nothing needs to be changed.'));
      for (const change of data.changes || []) {
        const item = node('article', undefined, 'preview-change');
        item.append(node('h3', change.title), node('p', change.description));
        $('modal-content').append(item);
      }
      for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
      $('modal-content').append(message('Safety', 'Only Token Harness-owned changes can be applied or removed. User-owned provider installations and unrelated configuration are left untouched.', 'safe'));
      $('modal-actions').replaceChildren(closeButton(data.ticket ? 'Cancel' : 'Done'));
      if (data.ticket)
        $('modal-actions').append(actionButton(applyLabel, () => applyTicket(data.ticket, completedTitle), ''));
    } catch (error) {
      if (activeRun !== runId) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
    } finally {
      if (activeRun === runId) working = false;
    }
  }

  function showHelp(action) {
    if ($('modal').open) return;
    const help = HELP[action?.topic] || HELP.compatibility;
    openModal(help[0]);
    $('modal-content').append(node('p', help[1]));
    if (help[2]) $('modal-content').append(commandRow(help[2]));
    $('modal-actions').append(closeButton('Done'));
  }

  function runContextAction(action) {
    if (!action) return;
    if (action.kind === 'help') return showHelp(action);
    if (action.kind === 'skill' && action.harness)
      return preview(
        { action: 'skill', harness: action.harness },
        'Review in-session guidance for ' + (action.harness === 'claude' ? 'Claude Code' : 'Codex'),
        'Enable reviewed guidance',
        'Guidance enabled',
      );
    if (action.kind === 'refresh') return $('refresh')?.click();
  }

  function ruleDetails(agent) {
    const useful = (agent.rules || []).filter(rule =>
      rule.mode === 'observation' || rule.mode === 'advice' || rule.mode === 'not-enabled' || rule.action?.kind === 'help' || rule.action?.kind === 'skill',
    );
    if (!useful.length) return null;
    const details = node('details', undefined, 'agent-details');
    details.append(node('summary', 'More agent checks'));
    for (const rule of useful) {
      const row = node('div', undefined, 'status-row');
      const copy = node('div');
      copy.append(node('strong', rule.title), node('p', rule.state + ' · ' + rule.what, 'caption'));
      row.append(copy);
      if (rule.action?.kind === 'help' || rule.action?.kind === 'skill')
        row.append(actionButton(rule.action.label, () => runContextAction(rule.action), 'secondary'));
      details.append(row);
    }
    return details;
  }

  function renderAgentCapabilities(data) {
    const root = $('agent-capabilities');
    if (!root) return;
    root.replaceChildren();
    for (const agent of data.agents || []) {
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(node('h3', agent.name + ' details'), node('span', 'Useful status without changing settings', 'caption'));
      head.append(title, pill(agent.guidance?.label || 'Guidance not checked', agent.guidance?.state === 'managed' || agent.guidance?.state === 'external' ? 'good' : ''));
      card.append(head);

      const facts = node('div', undefined, 'tool-facts');
      facts.append(node('span', 'In-session guidance'), node('strong', agent.guidance?.label || 'Not verified'));
      if (agent.allowance?.length) {
        for (const window of agent.allowance) {
          const value = window.remaining === null ? 'unknown' : window.remaining + '% left';
          facts.append(node('span', window.label), node('strong', value));
        }
      } else {
        facts.append(node('span', 'Plan allowance'), node('strong', 'Not available'));
      }
      card.append(facts);

      const actions = node('div', undefined, 'inline-actions');
      if (agent.guidance?.action)
        actions.append(actionButton(agent.guidance.action.label, () => runContextAction(agent.guidance.action), 'secondary'));
      if (!agent.allowance?.length && agent.allowanceAction?.kind === 'help')
        actions.append(actionButton(agent.allowanceAction.label, () => runContextAction(agent.allowanceAction), 'secondary'));
      if (actions.children.length) card.append(actions);
      if (agent.allowanceNote) card.append(node('p', agent.allowanceNote, 'caption'));
      const details = ruleDetails(agent);
      if (details) card.append(details);
      root.append(card);
    }
    if (!root.children.length) root.append(node('p', 'Agent details appear after a supported coding agent is detected.', 'empty'));
  }

  function renderRemovalControls(data) {
    const root = $('managed-removal-actions');
    if (!root) return;
    root.replaceChildren();
    const removable = (data.stack?.components || []).filter(component =>
      managedProviders.has(component.providerId) && (component.managedByTokenHarness || component.configured),
    );
    if (!removable.length) {
      root.append(node('p', 'No managed configuration is currently eligible for removal.', 'caption'));
      return;
    }
    for (const component of removable) {
      const row = node('div', undefined, 'maintenance-row');
      const text = node('div');
      const name = component.displayName || (component.providerId === 'rtk' ? 'RTK' : 'HarnessTrim');
      text.append(
        node('strong', name),
        node('p', component.managedByTokenHarness
          ? 'Review removal of Token Harness-owned integration changes.'
          : 'Check whether Token Harness owns any removable changes. The provider installation remains user-owned.', 'caption'),
      );
      row.append(
        text,
        actionButton('Review removal', () => preview(
          { action: 'remove', provider: component.providerId },
          'Review removal for ' + name,
          'Remove reviewed integration',
          'Integration removed',
        ), 'secondary'),
      );
      root.append(row);
    }
  }

  function consumeOverview(data) {
    if (!data || !Array.isArray(data.agents)) return;
    renderAgentCapabilities(data);
    renderRemovalControls(data);
  }

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const input = args[0];
    const target = typeof input === 'string' ? input : input?.url || '';
    if (target.includes('/api/overview?') && response.ok) {
      response.clone().json().then(consumeOverview).catch(() => undefined);
    }
    return response;
  };
})();
`;
