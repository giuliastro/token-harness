/**
 * Shared browser helpers for the guided app: i18n, DOM helpers, the API client and the
 * reviewed preview/apply flows every view reuses. Concatenated into one controller scope by
 * guided-product-client.ts; `TRANSLATIONS`, `TOOL_INFO` and `render()` are defined there.
 */
export const GUIDE_CORE_JS = String.raw`
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const storage = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* per-viewer convenience only */ } },
  };
  const LANGUAGES = ['en', 'it'];
  let lang = (() => {
    const saved = storage.get('token-harness-lang');
    if (LANGUAGES.includes(saved)) return saved;
    const preferred = typeof navigator === 'undefined' ? '' : String(navigator.language || '');
    return preferred.toLowerCase().startsWith('it') ? 'it' : 'en';
  })();

  /** English source text is the key; missing translations fall back to English. */
  function t(text, params) {
    let value = lang === 'en' ? text : (TRANSLATIONS[lang] && TRANSLATIONS[lang][text]) || text;
    if (params) for (const key of Object.keys(params)) value = value.split('{' + key + '}').join(String(params[key]));
    return value;
  }
  const locale = () => (lang === 'it' ? 'it-IT' : 'en-US');
  const count = (value, digits = 1) => new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(value);
  const compact = value => new Intl.NumberFormat(locale(), { notation: 'compact', maximumFractionDigits: value >= 1e6 ? 2 : 1 }).format(value);
  const money = value => new Intl.NumberFormat(locale(), { style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(value);
  /** Server percentages arrive as English text such as "62.6%" or "<0.1%". */
  const percentText = text => {
    const match = /^(<)?(\d+(?:\.\d+)?)%$/.exec(String(text || ''));
    return match ? (match[1] || '') + count(Number(match[2])) + '%' : String(text || '');
  };
  function measurementLabel(value) {
    if (value === 'Measured local output') return t('Measured local output');
    if (value === 'Local estimate') return t('Local estimate');
    if (value === 'Paired session measurement') return t('Paired session measurement');
    return value;
  }
  function unitLabel(unit) {
    if (unit === 'tokens') return t('tokens');
    if (unit === 'characters' || unit === 'chars') return t('characters');
    return unit;
  }
  function impactHeadline(row) {
    const impact = row.impact;
    if (!impact?.percent) return impact?.headline || '';
    const value = percentText(impact.percent);
    const estimated = row.measurement === 'Local estimate';
    if (impact.kind === 'reduction') return estimated ? t('Estimated {percent} less tool output', { percent: value }) : t('{percent} less tool output', { percent: value });
    if (impact.kind === 'growth') return estimated ? t('Estimated {percent} more tool output', { percent: value }) : t('{percent} more tool output', { percent: value });
    return t('No net change');
  }
  function claimText(headline) {
    const localize = text => text.replace(/\d+(?:\.\d+)?/g, number => count(Number(number)));
    const upTo = /^Up to (.+)% less$/i.exec(String(headline || ''));
    if (upTo) return t('up to {percent}% less', { percent: localize(upTo[1]) });
    const plain = /^([\d.]+(?:\s*[–-]\s*[\d.]+)?)% less$/i.exec(String(headline || ''));
    if (plain) return t('{percent}% less', { percent: localize(plain[1]) });
    return null;
  }
  function effortLabel(value) {
    const key = String(value || '').toLowerCase().replace(/[\s_-]/g, '');
    if (key === 'none') return t('None');
    if (key === 'minimal') return t('Minimal');
    if (key === 'low') return t('Low');
    if (key === 'medium') return t('Medium');
    if (key === 'high') return t('High');
    if (key === 'xhigh' || key === 'extrahigh') return t('Extra high');
    if (key === 'max' || key === 'maximum') return t('Maximum');
    return value;
  }
  const date = value => (value ? new Date(value).toLocaleString(locale()) : t('not recorded'));
  const paths = value => (value === 1 ? t('{n} configuration path', { n: count(value) }) : t('{n} configuration paths', { n: count(value) }));

  let csrf = '';
  let current = null;
  let activityState = null;
  let operationsRun = 0;
  let busy = false;
  let reading = false;
  let selectedView = 'home';
  let modalRun = 0;
  let pendingTicket = null;
  let updateCheckStarted = false;

  // Update state applies to the running process, not every CLI installation on the machine.
  let runningApplication = null;
  function installationDescription() {
    if (!runningApplication)
      return t('Running installation not yet verified. Check for updates to see its version and path; the global CLI status is unknown.');
    const source = runningApplication.installationSource === 'npm-global'
      ? t('Verified global npm')
      : runningApplication.installationSource === 'desktop'
        ? t('Desktop')
        : runningApplication.installationSource === 'other'
          ? t('Non-global (for example npx)')
          : t('Unverified');
    return t('Running copy: {source}; version {version}; path {path}. Updates shown here apply to this copy only. A separate global CLI installation has not been checked.', {
      source,
      version: runningApplication.installed || t('unknown'),
      path: runningApplication.installationPath || t('unavailable'),
    });
  }

  function displayUpdateNotice(result) {
    if (result.application) runningApplication = result.application;
    if (result.stack && current) {
      current = { ...current, stack: result.stack };
      render();
    }
    const root = $('update-notice');
    root.replaceChildren();
    if (!result.ok || !result.updatesAvailable) {
      root.hidden = true;
      if (selectedView === 'details' && current) renderDetails();
      return;
    }
    const copy = node('div');
    copy.append(node('strong', t('An update is available')), node('p', (result.messages || []).join(' '), 'caption'));
    root.append(copy, actionButton(t('Review update'), () => readOnlyOperation('update'), 'secondary'));
    root.hidden = false;
    if (selectedView === 'details' && current) renderDetails();
  }

  function restartUpdateNotice() {
    const root = $('update-notice');
    root.replaceChildren();
    root.append(
      node('strong', t('Restart required to finish the Token Harness update')),
      actionButton(t('Restart and re-check'), restartAndRecheck, 'secondary'),
    );
    root.hidden = false;
  }

  async function recheckUpdateNoticeAfterInstall() {
    try {
      const result = await request('/api/update-check', { period, background: true });
      displayUpdateNotice(result);
    } catch {
      // Never leave the old "update available" banner after an applied update.
      const root = $('update-notice');
      root.replaceChildren();
      root.append(
        node('strong', t('Update status needs a new check')),
        actionButton(t('Check for updates'), () => readOnlyOperation('updates'), 'secondary'),
      );
      root.hidden = false;
    }
  }
  let period = 'all';
  let advanced = storage.get('token-harness-advanced') === 'on';
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
    if (!response.ok) throw new Error(data.error || t('The operation did not finish.'));
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
    document.querySelectorAll('[data-action],#refresh,#evidence-filter,#evidence-type,#evidence-sort').forEach(element => {
      element.disabled = value;
    });
    $('live-status').textContent = value
      ? (applying ? t('Applying only the approved change…') : t('Reading current state…'))
      : t('Nothing changes without your approval');
  }

  function actionButton(label, handler, cls = '') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.dataset.action = 'product';
    button.disabled = busy;
    button.addEventListener('click', handler);
    return button;
  }

  function navigateButton(label, view, cls = 'secondary') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.dataset.action = 'navigate-' + view;
    button.addEventListener('click', () => selectView(view, true));
    return button;
  }

  function pill(label, state = '') {
    return node('span', label, 'pill ' + state);
  }

  function tag(label, state = '') {
    return node('span', label, 'tag ' + state);
  }

  function sectionEmpty(text) {
    return node('p', text, 'empty');
  }

  function copyRow(command) {
    const block = node('div', undefined, 'command-block');
    const code = node('code', command);
    const copy = actionButton(t('Copy'), async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = t('Copied');
        setTimeout(() => { copy.textContent = t('Copy'); }, 1200);
      } catch {
        copy.textContent = t('Select the command');
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

  function modalClose(label = t('Close'), disabled = false) {
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

  function modalFailure(run, error) {
    if (run !== modalRun) return;
    $('modal-error').textContent = error.message;
    $('modal-error').hidden = false;
    $('modal-actions').replaceChildren(modalClose());
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
    link.setAttribute('aria-label', accessibleLabel + ' ' + t('(opens in a new tab)'));
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

  /** Preview content from the server stays in its original wording; the frame around it is translated. */
  function showChanges(data, emptyTitle, emptyText) {
    const changes = data.changes || [];
    if (!changes.length) $('modal-content').append(messageBox(emptyTitle, (data.notices || []).join(' ') || emptyText));
    for (const change of changes) {
      const item = node('article', undefined, 'preview-change');
      item.append(node('h3', change.title), node('p', change.description));
      if (change.files) item.append(node('p', t('{paths} will be restored.', { paths: paths(change.files) }), 'caption'));
      $('modal-content').append(item);
    }
    if (changes.length) for (const notice of data.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
  }

  function safetyNote() {
    return messageBox(
      t('Safety'),
      t('Only changes Token Harness owns are applied, with a backup first. Your own settings and installed programs stay untouched. Everything can be undone.'),
      'safe',
    );
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
    return {
      name: component?.displayName || id,
      role: t('Optimizer managed through the common Token Harness lifecycle.'),
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

  function routingState(agent) {
    const routing = agent?.promptRouting;
    const configured = routing?.configured === true || routing?.enablement === 'enabled' || routing?.enablement === 'untrusted' ||
      (!routing?.enablement && routing?.state === 'managed');
    const observed = routing?.verificationTier === 'runtime-observed';
    if (routing?.needsRepair) return { state: 'action', configured, label: t('Needs repair') };
    if (routing?.enablement === 'untrusted') return { state: 'action', configured, label: t('Approve the hook in Codex') };
    if (routing?.enablement === 'disabled') return { state: 'action', configured, label: t('Hooks are turned off') };
    if (routing?.state === 'external') return { state: 'external', configured: false, label: t('Managed elsewhere') };
    if (configured && observed) return { state: 'active', configured, label: t('On') };
    if (configured && routing?.enablement === 'unknown') return { state: 'action', configured, label: t('Check the hook in the app') };
    if (configured) return { state: 'waiting', configured, label: t('On · waiting for first use') };
    return { state: 'off', configured: false, label: t('Off') };
  }

  async function refreshOverviewAfterMutation(message = t('Refreshing after the approved change…')) {
    setStatus(message, true);
    $('stale-state').hidden = true;
    $('stale-state').textContent = '';
    periodCache.clear();
    current = await request('/api/overview?period=' + encodeURIComponent(period) + '&refresh=1');
    periodCache.set(period, current);
    render();
    await loadActivity();
    if (selectedView === 'details') await loadOperations();
    setStatus(t('Updated at {time}', { time: new Date(current.generatedAt).toLocaleTimeString(locale()) }), false);
  }

  async function applyTicket(ticket, options = {}) {
    if (!ticket || busy) return null;
    const run = modalRun;
    setBusy(true, true);
    $('modal-actions').replaceChildren(modalClose(t('Applying…'), true));
    $('modal-content').append(progress(t('Applying the approved change'), t('Keep this window open until it finishes.')));
    try {
      await ensureSession();
      const result = await request('/api/apply', { ticket });
      if (run !== modalRun) return result;
      if (options.quiet) return result;
      if (options.update && result.ok && result.restartRequired) restartUpdateNotice();
      if (result.restartRequired) {
        $('modal-title').textContent = result.title || t('Token Harness update installed');
        $('modal-content').replaceChildren(messageBox(t('Restart to finish'), (result.messages || []).join(' ') || t('Token Harness must restart before it can check the updated installation.'), 'safe'));
        $('modal-actions').replaceChildren(modalClose(t('Later')), actionButton(t('Restart and re-check'), restartAndRecheck));
        return result;
      }
      if (options.update && result.ok) { $('update-notice').replaceChildren(); $('update-notice').hidden = true; }
      $('modal-title').textContent = result.ok ? t('Done') : t('Needs attention');
      $('modal-content').replaceChildren(
        messageBox(result.ok ? t('Applied') : t('Needs attention'), (result.messages || []).join(' '), result.ok ? 'safe' : 'warn'),
        progress(t('Refreshing'), t('Reading your agents and methods again after the change.')),
      );
      $('modal-actions').replaceChildren(modalClose(t('Refreshing…'), true));
      try {
        await refreshOverviewAfterMutation();
        if (options.update) await recheckUpdateNoticeAfterInstall();
        if (run !== modalRun) return result;
        $('modal-content').replaceChildren(messageBox(
          result.ok ? t('Completed') : t('Finished with notes'),
          (result.messages || []).join(' ') || t('The latest state is now shown.'),
          result.ok ? 'safe' : 'warn',
        ));
        if (options.after) options.after(result);
      } catch (refreshError) {
        if (run !== modalRun) return result;
        $('stale-state').hidden = false;
        $('stale-state').textContent = t('The change finished, but the latest state could not be read automatically. Choose Refresh.');
        $('modal-content').replaceChildren(
          messageBox(result.ok ? t('Change applied') : t('Finished with notes'), (result.messages || []).join(' ') || t('The action completed.'), result.ok ? 'safe' : 'warn'),
          messageBox(t('Automatic refresh failed'), refreshError.message, 'warn'),
        );
      }
      $('modal-actions').replaceChildren(modalClose(t('Done')));
      return result;
    } catch (error) {
      modalFailure(run, error);
      return null;
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  async function restartAndRecheck() {
    if (busy) return;
    setBusy(true, true);
    $('modal-content').replaceChildren(progress(t('Restarting Token Harness'), t('The updated app checks its health when it opens again.')));
    $('modal-actions').replaceChildren(modalClose(t('Restarting…'), true));
    try {
      await ensureSession();
      const result = await request('/api/restart', {});
      if (!result.ok) throw new Error((result.messages || []).join(' ') || t('Restart did not complete.'));
      setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
      $('modal-actions').replaceChildren(modalClose());
      setBusy(false, false);
    }
  }

  /** One reviewed preview → explicit Apply. Every configuration change goes through here. */
  function reviewPreview(body, options) {
    if (busy) return;
    const run = modal(options.title);
    for (const intro of options.intro || []) $('modal-content').append(intro);
    $('modal-content').append(progress(t('Preparing a preview'), t('Nothing changes until you approve it.')));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    ensureSession()
      .then(() => request('/api/preview', body))
      .then(data => {
        if (run !== modalRun || !$('modal').open) return;
        pendingTicket = data.ticket;
        $('modal-content').replaceChildren(...(options.intro || []));
        showChanges(data, t('No change needed'), t('The current state is already right or cannot be changed safely.'));
        if (data.ticket) {
          for (const note of options.after || []) $('modal-content').append(note);
          $('modal-content').append(safetyNote());
        }
        $('modal-actions').replaceChildren(modalClose(data.ticket ? t('Cancel') : t('Done')));
        if (data.ticket) $('modal-actions').append(actionButton(options.apply, () => applyTicket(data.ticket)));
      })
      .catch(error => modalFailure(run, error))
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
      });
  }

  function reviewSetup(providerId = null) {
    if (busy) return;
    const providers = providerId ? [providerId] : ['rtk', 'harnesstrim'];
    const choices = activeAgents()
      .map(agent => ({ agent, targets: providers.map(id => ({ id, target: setupTarget(agent.id, id) })).filter(item => item.target) }))
      .filter(choice => choice.targets.some(item => item.target.state === 'actionable'));
    if (!choices.length) return;
    const provider = providerId ? optimizerInfo(providerId) : null;
    const run = modal(provider ? t('Turn on {name}', { name: provider.name }) : t('Turn on the recommended methods'));
    $('modal-content').append(node('p', provider
      ? t('Choose the coding apps where {name} should work.', { name: provider.name })
      : t('Choose the coding apps for RTK and HarnessTrim.')));
    if (providerId === 'gitnexus')
      $('modal-content').append(messageBox(t('License'), t('GitNexus uses PolyForm Noncommercial terms. Continue only when they fit your use. Token Harness never builds its repository index.'), 'warn'));
    const list = node('div', undefined, 'setup-choice-list');
    const inputs = [];
    for (const choice of choices) {
      const input = node('input');
      input.type = 'checkbox';
      input.checked = true;
      input.value = choice.agent.id;
      input.id = 'setup-target-' + run + '-' + choice.agent.id;
      inputs.push(input);
      const copy = node('span', undefined, 'setup-choice-copy');
      copy.append(node('strong', choice.agent.name));
      const limits = choice.targets.filter(item => item.target.state === 'unavailable').map(item => optimizerInfo(item.id).name + ': ' + item.target.reason);
      if (limits.length) copy.append(node('span', limits.join(' '), 'caption'));
      const label = node('label', undefined, 'setup-choice');
      label.htmlFor = input.id;
      label.append(input, copy);
      list.append(label);
    }
    $('modal-content').append(list, node('p', t('The next step shows exactly what changes. Nothing changes yet.'), 'caption'));
    const next = actionButton(t('Review changes'), () => {
      const harnesses = inputs.filter(input => input.checked).map(input => input.value);
      if (!harnesses.length) return;
      reviewPreview({ action: 'setup', harnesses, ...(providerId ? { provider: providerId } : {}) }, {
        title: provider ? t('Turn on {name}', { name: provider.name }) : t('Turn on the recommended methods'),
        apply: t('Turn on'),
      });
    });
    for (const input of inputs) input.addEventListener('change', () => { next.disabled = !inputs.some(item => item.checked); });
    $('modal-actions').append(modalClose(t('Cancel')), next);
  }

  function reviewRemoval(providerId) {
    const name = optimizerInfo(providerId).name;
    reviewPreview({ action: 'remove', provider: providerId }, {
      title: t('Turn off {name}', { name }),
      intro: [messageBox(t('What turning off means'), t('Token Harness removes only the connection it added. {name} stays installed, so you can turn it on again at any time.', { name }))],
      apply: t('Turn off'),
    });
  }

  function reviewPromptRouting(agentId, enabled) {
    const agent = activeAgents().find(item => item.id === agentId);
    const after = [];
    if (enabled)
      after.push(messageBox(
        agentId === 'codex' ? t('One step in Codex') : t('When it starts'),
        agentId === 'codex'
          ? t('Codex asks you to approve new hooks once: open Codex, type /hooks and approve Token Harness.')
          : t('It starts with the next new Claude Code session.'),
        'safe',
      ));
    reviewPreview({ action: enabled ? 'routing-enable' : 'routing-disable', harness: agentId }, {
      title: (enabled ? t('Turn on model routing') : t('Turn off model routing')) + ' · ' + (agent?.name || agentName(agentId)),
      intro: [messageBox(t('How it works'), enabled
        ? t('A small hook asks your agent to hand simple work, like reading and searching, to a cheaper model. Your main model stays in charge and reviews the result.')
        : t('Token Harness removes only the routing hook it added.'))],
      after,
      apply: enabled ? t('Turn on') : t('Turn off'),
    });
  }

  function reviewSkill(agentId) {
    reviewPreview({ action: 'skill', harness: agentId }, {
      title: t('Turn on in-session guidance') + ' · ' + agentName(agentId),
      apply: t('Turn on'),
    });
  }

  function reasoningGuide(agent) {
    modal(t('Reasoning level · {agent}', { agent: agent.name }));
    $('modal-content').append(
      node('p', t('Pick the kind of work you usually do. Token Harness suggests a supported level and shows the exact change first.')),
      messageBox(t('Saved preference'), t('This applies to future sessions. It does not change your model, login or billing.')),
    );
    const grid = node('div', undefined, 'choice-grid');
    for (const [task, label, detail] of [
      ['mechanical', t('Lighter'), t('Cheapest. Fine for small, routine edits.')],
      ['standard', t('Balanced'), t('Good for everyday coding.')],
      ['hard', t('Deeper'), t('For complex work and difficult debugging.')],
      ['critical', t('Maximum'), t('For critical changes where quality comes first.')],
    ]) {
      const button = actionButton(label, () => reviewPreview({ action: 'effort', harness: agent.id, task }, {
        title: t('Reasoning level · {agent}', { agent: agent.name }),
        apply: t('Save preference'),
      }), 'choice-button');
      button.append(node('span', detail, 'caption'));
      grid.append(button);
    }
    $('modal-content').append(grid);
    $('modal-actions').append(modalClose(t('Cancel')));
  }

  const HELP = {
    'claude-effort': () => [t('Change reasoning in Claude Code'), t('Inside Claude Code, use /effort.'), '/effort'],
    'codex-effort': () => [t('Change reasoning in Codex'), t('Inside Codex, use /model to review model and reasoning.'), '/model'],
    'claude-tools': () => [t('Review Claude Code tools'), t('Inside Claude Code, use /mcp. Turn off only tools you know you do not need.'), '/mcp'],
    'codex-tools': () => [t('Review Codex tools'), t('Inside Codex, use /mcp. Turn off only tools you understand.'), '/mcp'],
    cclimits: () => [t('Show your Claude plan usage'), t('Install the reviewed cclimits companion, stay signed in to Claude, then choose Refresh.'), 'npm install --global cclimits@1.7.0'],
    python: () => [t('Python is needed'), t('Make Python 3 available in the terminal that starts Token Harness, then reopen it.'), 'python --version'],
    'claude-login': () => [t('Sign in to Claude'), t('Sign in inside Claude Code. Your credentials stay in Claude.'), null],
    compatibility: () => [t('Check this integration'), t('Use Re-check health in Details. Unsupported or unclear setups are left unchanged.'), null],
  };

  function showHelp(topic) {
    const [title, text, command] = (HELP[topic] || HELP.compatibility)();
    modal(title);
    $('modal-content').append(node('p', text));
    if (command) $('modal-content').append(copyRow(command));
    $('modal-actions').append(modalClose(t('Done')));
  }

  function runAgentAction(action) {
    if (!action) return;
    if (action.kind === 'help') return showHelp(action.topic);
    if (action.kind === 'skill' && action.harness) return reviewSkill(action.harness);
    if (action.kind === 'refresh') return refresh(true);
  }

  function readOnlyOperation(kind, providerId = null) {
    if (busy) return;
    const isVerify = kind === 'verify';
    const name = providerId ? optimizerInfo(providerId).name : null;
    const run = modal(isVerify ? t('Re-check health') : name ? t('Update {name}', { name }) : t('Check for updates'));
    if (name) $('modal-content').append(node('p', t('Token Harness checks every update together, so you review them all in one place.'), 'caption'));
    $('modal-content').append(progress(
      isVerify ? t('Checking your methods') : t('Checking for updates'),
      t('Nothing changes during this check.'),
    ));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    ensureSession()
      // Updates are always reviewed together: the apply step refuses any unapproved upgrade.
      .then(() => request(isVerify ? '/api/verify' : '/api/update-check', { period }))
      .then(result => {
        if (run !== modalRun || !$('modal').open) return;
        if (!isVerify) displayUpdateNotice({ ...result, updatesAvailable: !!result.ticket });
        else if (result.stack && current) { current = { ...current, stack: result.stack }; render(); }
        $('modal-content').replaceChildren(messageBox(
          result.title || (result.ok ? t('Completed') : t('Needs attention')),
          (result.messages || []).join(' ') || t('Check completed.'),
          result.ok ? 'safe' : 'warn',
        ));
        if (!isVerify) $('modal-content').append(messageBox(t('Which installation was checked?'), t('This update check applies to the Token Harness copy running this dashboard. If launched through npx, the globally installed CLI is separate and its update status is unknown. To update the global CLI, run npm install --global token-harness@latest, then restart the dashboard.'), 'warn'));
        if (!isVerify) $('modal-content').append(messageBox(t('Running Token Harness installation'), installationDescription(), 'safe'));
        if (result.ticket) $('modal-content').append(messageBox(t('Safe update'), t('The new version is installed and checked. If something goes wrong, the previous configuration can be restored.'), 'safe'));
        $('modal-actions').replaceChildren(modalClose(result.ticket ? t('Cancel') : t('Done')));
        if (result.ticket) $('modal-actions').append(actionButton(t('Install update'), () => applyTicket(result.ticket, { update: true })));
        if (result.desktopUpdateUrl === 'https://github.com/giuliastro/token-harness/releases/latest') {
          const download = node('a', t('Download desktop update'), 'button secondary');
          download.href = result.desktopUpdateUrl;
          download.target = '_blank';
          download.rel = 'noopener noreferrer';
          $('modal-actions').append(download);
        }
      })
      .catch(error => modalFailure(run, error))
      .finally(() => {
        if (run === modalRun) setBusy(false, false);
        loadActivity();
      });
  }

  function undoLastChange(action = 'undo') {
    reviewPreview({ action }, {
      title: action === 'benchmark-recover' ? t('Recover benchmark configuration') : t('Undo a change'),
      apply: t('Restore the reviewed backup'),
    });
  }

  async function openBenchmarkRecovery() {
    if (busy) return;
    const run = modal(t('Temporary benchmark configuration'));
    $('modal-content').append(progress(t('Reading saved recovery state'), t('Checking the project where this app was opened.')));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    try {
      await ensureSession();
      const report = await request('/api/benchmark-recovery');
      if (run !== modalRun) return;
      $('modal-content').replaceChildren(messageBox(
        report.state === 'pending' ? t('Temporary configuration is still in place') : report.state === 'none' ? t('No recovery needed') : t('Recovery needs attention'),
        report.note,
      ));
      if (report.state === 'pending')
        $('modal-content').append(evidenceSection(t('Prepared benchmark arm'), [
          [t('Benchmark'), report.benchmarkId], [t('Arm'), report.variant], [t('Coding app'), report.harness],
          [t('Configuration paths'), count(report.files)],
        ], t('Recovery restores the saved configuration only. It does not finish the capture or record its quality.')));
      $('modal-actions').replaceChildren(modalClose(t('Done')), actionButton(t('Check again'), openBenchmarkRecovery, 'secondary'));
      if (report.state === 'pending') $('modal-actions').append(actionButton(t('Review recovery'), () => undoLastChange('benchmark-recover')));
    } catch (error) {
      modalFailure(run, error);
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  function mcptoonInstallOptions() {
    modal(t('Install what mcptoon needs'));
    $('modal-content').append(node('p', t('Token Harness can install mcptoon once pipx or uv is available. Install one of them, choose Refresh, then turn mcptoon on.')));
    const links = node('div', undefined, 'inline-actions');
    for (const [label, href] of [
      [t('Install pipx'), 'https://pipx.pypa.io/stable/installation/'],
      [t('Install uv'), 'https://docs.astral.sh/uv/getting-started/installation/'],
    ]) {
      const link = node('a', label, 'button secondary');
      link.href = href;
      link.target = '_blank';
      link.rel = 'noreferrer noopener';
      links.append(link);
    }
    $('modal-content').append(links);
    $('modal-actions').append(modalClose(t('Done')));
  }
`;

export const GUIDE_CORE_IT: Readonly<Record<string, string>> = {
  'not recorded': 'non registrato',
  'Measured local output': 'Output locale misurato',
  'Local estimate': 'Stima locale',
  'Paired session measurement': 'Misura su sessioni confrontate',
  'Estimated {percent} less tool output': 'Stima: {percent} di output in meno',
  '{percent} less tool output': '{percent} di output in meno',
  'Estimated {percent} more tool output': 'Stima: {percent} di output in più',
  '{percent} more tool output': '{percent} di output in più',
  'No net change': 'Nessuna variazione',
  'up to {percent}% less': 'fino al {percent}% in meno',
  '{percent}% less': '{percent}% in meno',
  None: 'Nessuno',
  Minimal: 'Minimo',
  Low: 'Basso',
  Medium: 'Medio',
  High: 'Alto',
  'Extra high': 'Molto alto',
  '{n} configuration path': '{n} percorso di configurazione',
  '{n} configuration paths': '{n} percorsi di configurazione',
  'The operation did not finish.': "L'operazione non è terminata.",
  'Applying only the approved change…': 'Applico solo la modifica approvata…',
  'Reading current state…': 'Leggo lo stato attuale…',
  'Nothing changes without your approval': 'Niente cambia senza la tua approvazione',
  Copy: 'Copia',
  Copied: 'Copiato',
  'Select the command': 'Seleziona il comando',
  Close: 'Chiudi',
  '(opens in a new tab)': '(si apre in una nuova scheda)',
  '{paths} will be restored.': '{paths} verranno ripristinati.',
  Safety: 'Sicurezza',
  'Only changes Token Harness owns are applied, with a backup first. Your own settings and installed programs stay untouched. Everything can be undone.':
    'Vengono applicate solo modifiche gestite da Token Harness, dopo un backup. Le tue impostazioni e i programmi installati restano intatti. Tutto si può annullare.',
  'Optimizer managed through the common Token Harness lifecycle.':
    'Ottimizzatore gestito con il ciclo di vita comune di Token Harness.',
  'Needs repair': 'Da riparare',
  'Approve the hook in Codex': "Approva l'hook in Codex",
  'Hooks are turned off': 'Gli hook sono disattivati',
  'Managed elsewhere': 'Gestito altrove',
  On: 'Attivo',
  'Check the hook in the app': "Controlla l'hook nell'app",
  'On · waiting for first use': 'Attivo · in attesa del primo uso',
  Off: 'Spento',
  'Refreshing after the approved change…': 'Aggiorno dopo la modifica approvata…',
  'Updated at {time}': 'Aggiornato alle {time}',
  'Applying…': 'Applico…',
  'Applying the approved change': 'Applico la modifica approvata',
  'Keep this window open until it finishes.': 'Tieni aperta questa finestra fino alla fine.',
  'Token Harness update installed': 'Aggiornamento di Token Harness installato',
  'Restart to finish': 'Riavvia per completare',
  'Token Harness must restart before it can check the updated installation.':
    "Token Harness deve riavviarsi prima di poter controllare l'installazione aggiornata.",
  Later: 'Più tardi',
  'Restart and re-check': 'Riavvia e ricontrolla',
  Done: 'Fatto',
  'Needs attention': 'Richiede attenzione',
  Applied: 'Applicato',
  Refreshing: 'Aggiornamento',
  'Reading your agents and methods again after the change.':
    'Rileggo agenti e metodi dopo la modifica.',
  'Refreshing…': 'Aggiorno…',
  Completed: 'Completato',
  'Finished with notes': 'Terminato con note',
  'The latest state is now shown.': 'Ora è mostrato lo stato più recente.',
  'The change finished, but the latest state could not be read automatically. Choose Refresh.':
    'La modifica è terminata, ma non è stato possibile rileggere lo stato. Scegli Aggiorna.',
  'Change applied': 'Modifica applicata',
  'The action completed.': "L'operazione è terminata.",
  'Automatic refresh failed': 'Aggiornamento automatico non riuscito',
  'Restarting Token Harness': 'Riavvio Token Harness',
  'The updated app checks its health when it opens again.':
    "L'app aggiornata controlla il suo stato quando si riapre.",
  'Restarting…': 'Riavvio…',
  'Restart did not complete.': 'Il riavvio non è terminato.',
  'Preparing a preview': "Preparo un'anteprima",
  'Nothing changes until you approve it.': 'Niente cambia finché non approvi.',
  Cancel: 'Annulla',
  'No change needed': 'Nessuna modifica necessaria',
  'The current state is already right or cannot be changed safely.':
    'Lo stato attuale è già corretto o non si può cambiare in sicurezza.',
  'Turn on {name}': 'Attiva {name}',
  'Turn on the recommended methods': 'Attiva i metodi consigliati',
  'Choose the coding apps where {name} should work.':
    'Scegli le app di sviluppo in cui deve funzionare {name}.',
  'Choose the coding apps for RTK and HarnessTrim.':
    'Scegli le app di sviluppo per RTK e HarnessTrim.',
  License: 'Licenza',
  'GitNexus uses PolyForm Noncommercial terms. Continue only when they fit your use. Token Harness never builds its repository index.':
    "GitNexus usa la licenza PolyForm Noncommercial. Prosegui solo se è adatta al tuo uso. Token Harness non crea mai l'indice del repository.",
  'The next step shows exactly what changes. Nothing changes yet.':
    'Il passo successivo mostra esattamente cosa cambia. Per ora non cambia niente.',
  'Review changes': 'Controlla le modifiche',
  'Turn on': 'Attiva',
  'Turn off {name}': 'Spegni {name}',
  'What turning off means': 'Cosa significa spegnere',
  'Token Harness removes only the connection it added. {name} stays installed, so you can turn it on again at any time.':
    'Token Harness rimuove solo il collegamento che ha aggiunto. {name} resta installato, quindi puoi riattivarlo quando vuoi.',
  'Turn off': 'Spegni',
  'One step in Codex': 'Un passaggio in Codex',
  'When it starts': 'Quando parte',
  'Codex asks you to approve new hooks once: open Codex, type /hooks and approve Token Harness.':
    'Codex chiede di approvare una volta i nuovi hook: apri Codex, scrivi /hooks e approva Token Harness.',
  'It starts with the next new Claude Code session.':
    'Parte dalla prossima nuova sessione di Claude Code.',
  'Turn on model routing': "Attiva l'instradamento del modello",
  'Turn off model routing': "Spegni l'instradamento del modello",
  'How it works': 'Come funziona',
  'A small hook asks your agent to hand simple work, like reading and searching, to a cheaper model. Your main model stays in charge and reviews the result.':
    'Un piccolo hook chiede al tuo agente di affidare il lavoro semplice, come leggere e cercare, a un modello più economico. Il modello principale resta al comando e controlla il risultato.',
  'Token Harness removes only the routing hook it added.':
    "Token Harness rimuove solo l'hook di instradamento che ha aggiunto.",
  'Turn on in-session guidance': 'Attiva la guida in sessione',
  'Reasoning level · {agent}': 'Livello di ragionamento · {agent}',
  'Pick the kind of work you usually do. Token Harness suggests a supported level and shows the exact change first.':
    'Scegli il tipo di lavoro che fai di solito. Token Harness propone un livello supportato e mostra prima la modifica esatta.',
  'Saved preference': 'Preferenza salvata',
  'This applies to future sessions. It does not change your model, login or billing.':
    'Vale per le sessioni future. Non cambia modello, accesso o fatturazione.',
  Lighter: 'Leggero',
  'Cheapest. Fine for small, routine edits.':
    'Il più economico. Va bene per piccole modifiche di routine.',
  Balanced: 'Bilanciato',
  'Good for everyday coding.': 'Adatto al lavoro di tutti i giorni.',
  Deeper: 'Profondo',
  'For complex work and difficult debugging.': 'Per lavori complessi e debug difficili.',
  Maximum: 'Massimo',
  'For critical changes where quality comes first.':
    'Per modifiche critiche in cui conta prima la qualità.',
  'Save preference': 'Salva preferenza',
  'Change reasoning in Claude Code': 'Cambia il ragionamento in Claude Code',
  'Inside Claude Code, use /effort.': 'In Claude Code usa /effort.',
  'Change reasoning in Codex': 'Cambia il ragionamento in Codex',
  'Inside Codex, use /model to review model and reasoning.':
    'In Codex usa /model per controllare modello e ragionamento.',
  'Review Claude Code tools': 'Controlla i tool di Claude Code',
  'Inside Claude Code, use /mcp. Turn off only tools you know you do not need.':
    'In Claude Code usa /mcp. Spegni solo i tool che sai di non usare.',
  'Review Codex tools': 'Controlla i tool di Codex',
  'Inside Codex, use /mcp. Turn off only tools you understand.':
    'In Codex usa /mcp. Spegni solo i tool che conosci.',
  'Show your Claude plan usage': 'Mostra i consumi del tuo piano Claude',
  'Install the reviewed cclimits companion, stay signed in to Claude, then choose Refresh.':
    'Installa il componente verificato cclimits, resta connesso a Claude e scegli Aggiorna.',
  'Python is needed': 'Serve Python',
  'Make Python 3 available in the terminal that starts Token Harness, then reopen it.':
    'Rendi disponibile Python 3 nel terminale che avvia Token Harness, poi riaprilo.',
  'Sign in to Claude': 'Accedi a Claude',
  'Sign in inside Claude Code. Your credentials stay in Claude.':
    'Accedi da Claude Code. Le credenziali restano in Claude.',
  'Check this integration': 'Controlla questa integrazione',
  'Use Re-check health in Details. Unsupported or unclear setups are left unchanged.':
    'Usa Ricontrolla lo stato nei Dettagli. Le configurazioni non supportate o poco chiare restano invariate.',
  'Re-check health': 'Ricontrolla lo stato',
  'Update {name}': 'Aggiorna {name}',
  'Token Harness checks every update together, so you review them all in one place.':
    'Token Harness controlla tutti gli aggiornamenti insieme, così li rivedi in un unico posto.',
  'Check for updates': 'Cerca aggiornamenti',
  'Checking your methods': 'Controllo i tuoi metodi',
  'Checking for updates': 'Cerco aggiornamenti',
  'Nothing changes during this check.': 'Durante questo controllo non cambia niente.',
  'Check completed.': 'Controllo completato.',
  'Which installation was checked?': 'Quale installazione è stata controllata?',
  'This update check applies to the Token Harness copy running this dashboard. If launched through npx, the globally installed CLI is separate and its update status is unknown. To update the global CLI, run npm install --global token-harness@latest, then restart the dashboard.':
    'Questo controllo riguarda la copia di Token Harness che esegue la dashboard. Se avviata tramite npx, la CLI globale è separata e il suo stato di aggiornamento è sconosciuto. Per aggiornare la CLI globale esegui npm install --global token-harness@latest, poi riavvia la dashboard.',
  'Running installation not yet verified. Check for updates to see its version and path; the global CLI status is unknown.':
    'Installazione in esecuzione non ancora verificata. Controlla gli aggiornamenti per visualizzarne versione e percorso; lo stato della CLI globale è sconosciuto.',
  'Verified global npm': 'npm globale verificato',
  'Desktop': 'Desktop',
  'Non-global (for example npx)': 'Non globale (per esempio npx)',
  'Unverified': 'Non verificato',
  'Running copy: {source}; version {version}; path {path}. Updates shown here apply to this copy only. A separate global CLI installation has not been checked.':
    'Copia in esecuzione: {source}; versione {version}; percorso {path}. Gli aggiornamenti mostrati riguardano solo questa copia. Una eventuale CLI globale separata non è stata verificata.',
  'unknown': 'sconosciuta',
  'unavailable': 'non disponibile',
  'Restart required to finish the Token Harness update':
    'Riavvio necessario per completare l’aggiornamento di Token Harness',
  'Update status needs a new check': 'Serve un nuovo controllo dello stato degli aggiornamenti',
  'Running Token Harness installation': 'Installazione Token Harness in esecuzione',
  'Safe update': 'Aggiornamento sicuro',
  'The new version is installed and checked. If something goes wrong, the previous configuration can be restored.':
    'La nuova versione viene installata e verificata. Se qualcosa va storto, si può ripristinare la configurazione precedente.',
  'Install update': "Installa l'aggiornamento",
  'Recover benchmark configuration': 'Recupera la configurazione del benchmark',
  'Undo a change': 'Annulla una modifica',
  'Restore the reviewed backup': 'Ripristina il backup controllato',
  'Temporary benchmark configuration': 'Configurazione temporanea del benchmark',
  'Reading saved recovery state': 'Leggo lo stato di recupero salvato',
  'Checking the project where this app was opened.':
    "Controllo il progetto in cui è stata aperta l'app.",
  'Temporary configuration is still in place': 'La configurazione temporanea è ancora attiva',
  'No recovery needed': 'Nessun recupero necessario',
  'Recovery needs attention': 'Il recupero richiede attenzione',
  'Prepared benchmark arm': 'Variante di benchmark preparata',
  Benchmark: 'Benchmark',
  Arm: 'Variante',
  'Coding app': 'App di sviluppo',
  'Configuration paths': 'Percorsi di configurazione',
  'Recovery restores the saved configuration only. It does not finish the capture or record its quality.':
    'Il recupero ripristina solo la configurazione salvata. Non completa la misura e non ne registra la qualità.',
  'Check again': 'Ricontrolla',
  'Review recovery': 'Controlla il recupero',
  'Install what mcptoon needs': 'Installa ciò che serve a mcptoon',
  'Token Harness can install mcptoon once pipx or uv is available. Install one of them, choose Refresh, then turn mcptoon on.':
    'Token Harness può installare mcptoon quando è disponibile pipx o uv. Installane uno, scegli Aggiorna e poi attiva mcptoon.',
  'Install pipx': 'Installa pipx',
  'Install uv': 'Installa uv',
};
