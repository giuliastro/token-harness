/** Clear action chooser layered over the existing safe guided transaction API. */
export const GUIDE_ACTIONS_JS = String.raw`
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
  let setupTicket = null;
  let setupCsrf = '';
  let setupBusy = false;

  const agentNames = { claude: 'Claude Code', codex: 'Codex' };

  function resetDialogControls() {
    $('task-form').hidden = true;
    $('task-review').hidden = true;
    $('approve').hidden = true;
    $('approve').disabled = false;
    $('close').disabled = false;
    $('close').textContent = 'Close';
    $('review-error').hidden = true;
    setupTicket = null;
  }

  function openDialog(title) {
    resetDialogControls();
    $('review-title').textContent = title;
    $('review-content').replaceChildren();
    if (!$('review').open) $('review').showModal();
  }

  function detectedAgents() {
    const labels = Array.from(document.querySelectorAll('#agents h2')).map(item => item.textContent || '');
    const result = [];
    if (labels.some(label => label.includes('Claude Code'))) result.push('claude');
    if (labels.some(label => label === 'Codex' || label.includes('Codex'))) result.push('codex');
    return result;
  }

  function toolSummary(name, description) {
    const card = node('article', undefined, 'preview-change');
    card.append(node('h3', name), node('p', description));
    return card;
  }

  function showSetupChooser(preferred) {
    if (setupBusy) return;
    openDialog('Set up output optimizers');
    $('review-content').append(
      node(
        'p',
        'Choose the coding agent you want to optimize. Token Harness will only check the supported output optimizers for that agent, then show the exact changes before anything can be applied.',
      ),
      toolSummary(
        'RTK',
        'Reduces noisy shell and command output before it reaches the model. Setup is reviewed and reversible.',
      ),
      toolSummary(
        'HarnessTrim',
        'Reduces oversized tool output while preserving the original coding agent workflow. Setup is reviewed and reversible.',
      ),
    );

    const agents = detectedAgents();
    const choices = preferred && agents.includes(preferred) ? [preferred] : agents;
    if (!choices.length) {
      $('review-content').append(
        node(
          'p',
          'No supported coding agent is currently detected. Close this window, make Claude Code or Codex available in the terminal that starts Token Harness, then choose Refresh.',
          'notice-row',
        ),
      );
      $('close').textContent = 'Done';
      return;
    }

    const heading = node('h3', choices.length === 1 ? 'Review setup for' : 'Choose an agent');
    const actions = node('div', undefined, 'inline-actions');
    for (const id of choices) {
      const button = node('button', 'Review setup for ' + agentNames[id]);
      button.type = 'button';
      button.addEventListener('click', () => reviewSetup(id));
      actions.append(button);
    }
    $('review-content').append(
      heading,
      node(
        'p',
        'Review setup is read-only. The Apply button appears only if Token Harness can build a safe, concrete change plan.',
        'caption',
      ),
      actions,
    );
  }

  async function csrf() {
    if (setupCsrf) return setupCsrf;
    const response = await originalFetch('/api/session', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || !data.token) throw new Error(data.error || 'Could not start a safe review session.');
    setupCsrf = data.token;
    return setupCsrf;
  }

  async function post(path, body) {
    const token = await csrf();
    const response = await originalFetch(path, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Token-Harness-CSRF': token },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'The operation did not finish.');
    return data;
  }

  function progress(title, detail) {
    const card = node('article', undefined, 'preview-change');
    const status = node('div', undefined, 'read-status');
    status.append(node('span', undefined, 'spinner'), node('strong', title));
    card.append(status, node('p', detail, 'caption'));
    return card;
  }

  async function reviewSetup(agent) {
    if (setupBusy) return;
    setupBusy = true;
    setupTicket = null;
    $('review-title').textContent = 'Review setup for ' + agentNames[agent];
    $('review-content').replaceChildren(
      progress('Checking current optimizer setup', 'Read-only. No optimizer or agent setting is changing.'),
    );
    $('approve').hidden = true;
    $('close').textContent = 'Cancel';
    $('live-status').textContent = 'Checking current optimizer setup…';
    try {
      const data = await post('/api/preview', { action: 'setup', harness: agent });
      $('review-content').replaceChildren();
      setupTicket = data.ticket || null;
      if (data.changes?.length) {
        $('review-content').append(
          node(
            'p',
            'These are the exact changes Token Harness can safely make. Nothing has been applied yet.',
          ),
        );
        for (const change of data.changes) {
          const item = node('article', undefined, 'preview-change');
          item.append(node('h3', change.title), node('p', change.description));
          $('review-content').append(item);
        }
      } else {
        $('review-content').append(
          node('p', 'No safe setup change is currently needed or available for ' + agentNames[agent] + '.'),
        );
      }
      for (const notice of data.notices || [])
        $('review-content').append(node('p', notice, 'notice-row'));
      if (setupTicket) {
        $('approve').hidden = false;
        $('approve').textContent = 'Apply reviewed setup';
        $('close').textContent = 'Cancel';
      } else {
        $('close').textContent = 'Done';
      }
    } catch (error) {
      $('review-error').textContent = error.message;
      $('review-error').hidden = false;
      $('close').textContent = 'Close';
    } finally {
      setupBusy = false;
      $('live-status').textContent = 'Nothing changes without your approval';
    }
  }

  async function applySetup() {
    if (setupBusy || !setupTicket) return;
    setupBusy = true;
    const ticket = setupTicket;
    setupTicket = null;
    $('approve').hidden = true;
    $('close').disabled = true;
    $('review-title').textContent = 'Applying reviewed setup';
    $('review-content').replaceChildren(
      progress('Applying exactly what you approved', 'Backups, ownership checks and verification run as part of the transaction.'),
    );
    $('live-status').textContent = 'Applying the approved optimizer setup…';
    try {
      const result = await post('/api/apply', { ticket });
      $('review-title').textContent = result.ok ? 'Setup complete' : 'Setup needs attention';
      $('review-content').replaceChildren(
        node(
          'div',
          result.ok ? 'Completed' : 'Needs attention',
          'result-state ' + (result.ok ? 'good' : 'warn'),
        ),
      );
      for (const message of result.messages || []) $('review-content').append(node('p', message));
      $('review-content').append(
        node(
          'p',
          'The dashboard will not run another full check automatically. Choose Refresh when you want to re-read the current state.',
          'caption',
        ),
      );
      $('close').textContent = 'Done';
    } catch (error) {
      $('review-error').textContent = error.message;
      $('review-error').hidden = false;
      $('close').textContent = 'Close';
    } finally {
      setupBusy = false;
      $('close').disabled = false;
      $('live-status').textContent = 'Nothing changes without your approval';
    }
  }

  function renderGitNexus(data) {
    const root = $('candidates');
    if (!root) return;
    const existing = Array.from(root.querySelectorAll('h2')).some(item => item.textContent === 'GitNexus');
    if (existing) return;
    const observation = (data?.optimizationCandidates || []).find(item => item?.id === 'gitnexus');
    const evidence = (data?.value?.candidates || []).find(item => item?.candidateId === 'gitnexus');
    const card = node('article', undefined, 'panel agent');
    const head = node('div', undefined, 'agent-head');
    const title = node('div');
    title.append(node('h2', 'GitNexus'), node('span', 'Repository exploration', 'caption'));
    const label =
      observation?.state === 'benchmark-ready'
        ? 'Ready to benchmark'
        : observation?.state === 'installed'
          ? 'Benchmark needed'
          : observation?.state === 'unsupported-version'
            ? 'Version not reviewed'
            : 'Not installed';
    head.append(title, node('span', label, 'pill'));
    card.append(head);
    const lifecycle = node('div', undefined, 'agent-line');
    lifecycle.append(
      node('span', 'Lifecycle', 'key'),
      node(
        'strong',
        observation?.state === 'benchmark-ready'
          ? 'Experimental · read-only benchmark candidate'
          : 'Experimental · outside your active stack',
      ),
    );
    card.append(lifecycle);
    const value = node('div', undefined, 'allowance-strip');
    value.append(
      node('span', 'What it could improve', 'key'),
      node('strong', 'Repository navigation and code-context retrieval for coding tasks.'),
    );
    card.append(value);
    const pairs = node('div', undefined, 'agent-line');
    pairs.append(
      node('span', 'Paired evidence', 'key'),
      node('strong', evidence?.pairs ? String(evidence.pairs) + ' recorded pair(s)' : 'No candidate-attributed pairs yet'),
    );
    card.append(pairs);
    const details = node('details', undefined, 'agent-details');
    details.append(
      node('summary', 'Why it is not active'),
      node(
        'p',
        'Token Harness can observe and benchmark GitNexus, but it does not install, index repositories, register MCP, or enable it automatically. Promotion requires evidence plus compatibility and lifecycle review.',
        'caption',
      ),
    );
    if (observation?.state === 'benchmark-ready') {
      const code = node(
        'code',
        'token-harness benchmark-matrix --benchmark-id gitnexus-eval --candidate gitnexus --harness codex',
      );
      const command = node('div', undefined, 'command-block');
      command.append(code);
      details.append(command);
    }
    card.append(details);
    root.append(card);
  }

  document.addEventListener(
    'click',
    event => {
      const target = event.target instanceof Element ? event.target.closest('button') : null;
      if (!target) return;
      if (target.id === 'setup' || target.dataset.operation === 'setup') {
        event.preventDefault();
        event.stopImmediatePropagation();
        showSetupChooser(target.dataset.focus?.includes('claude') ? 'claude' : target.dataset.focus?.includes('codex') ? 'codex' : null);
        return;
      }
      if (target.id === 'approve' && setupTicket) {
        event.preventDefault();
        event.stopImmediatePropagation();
        applySetup();
      }
    },
    true,
  );

  $('review')?.addEventListener('close', () => {
    setupTicket = null;
    setupBusy = false;
  });

  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    try {
      const target = String(args[0]);
      if (response.ok && target.includes('/api/overview')) {
        const data = await response.clone().json();
        queueMicrotask(() => renderGitNexus(data));
      }
    } catch {
      // Supplementary UI only. Never interfere with the product request.
    }
    return response;
  };
})();
`;
