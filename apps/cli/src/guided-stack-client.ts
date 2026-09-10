/** Small browser projection for RFC 0027's primary product object. */
export const GUIDE_STACK_JS = String.raw`
'use strict';
(() => {
  const originalFetch = window.fetch.bind(window);
  const $ = id => document.getElementById(id);
  const node = (tag, text, cls) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (cls) element.className = cls;
    return element;
  };
  const count = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
  const stackCache = new Map();
  const candidateRunIds = new Map();
  const category = {
    'command-output-reduction': 'Shell / tool output',
    'context-minimization': 'Context minimization',
    'repository-retrieval': 'Repository exploration',
    'mcp-discovery': 'MCP schema / discovery',
    'result-compression': 'Tool result payload',
    'native-policy': 'Native model / reasoning',
    other: 'Other',
  };
  const verification = {
    'not-checked': 'Not checked',
    verified: 'Verified',
    degraded: 'Degraded',
    'not-exercised': 'Not exercised yet',
    'not-applicable': 'Not applicable',
  };
  const update = {
    'not-checked': 'Not checked',
    current: 'Up to date',
    available: 'Update available',
    blocked: 'Compatibility review needed',
    pinned: 'Pinned',
    unknown: 'Unknown',
    unavailable: 'Unavailable',
    'not-installed': 'Not installed',
    'no-channel': 'No update channel',
  };
  const measurement = {
    'exact-local': 'Measured local output',
    'estimated-local': 'Local estimate',
    'end-to-end-billed': 'Paired session measurement',
  };
  const candidateCatalog = [
    {
      id: 'headroom',
      displayName: 'Headroom',
      category: 'context-minimization',
      opportunity: 'Could reduce context overhead around agent-owned tool and file interactions.',
      evidence:
        'Token Harness can inspect Headroom as a read-only candidate, but it is not admitted to the active stack without paired quality-safe benchmark evidence.',
      beforeAdding:
        'Benchmark representative Claude Code and Codex tasks first. Installation or activation is never performed silently.',
    },
    {
      id: 'mcptoon',
      displayName: 'mcptoon',
      category: 'mcp-discovery',
      opportunity: 'Could reduce MCP discovery and schema payload before that context reaches the model.',
      evidence:
        'Token Harness can inspect mcptoon as a read-only candidate, but no MCP savings or quality benefit is assumed until native and compact paths are compared.',
      beforeAdding:
        'Compare native versus compact MCP context and verify tool correctness before any activation. No sync or compression policy is enabled automatically.',
    },
  ];
  const candidateStates = new Set([
    'absent',
    'installed',
    'benchmark-ready',
    'unsupported-version',
  ]);

  function proxyButton(sourceId, label, cls = 'secondary') {
    const button = node('button', label, cls);
    button.type = 'button';
    button.addEventListener('click', () => $(sourceId)?.click());
    return button;
  }

  function action(component) {
    const next = component.nextAction;
    if (!next) return null;
    if (next.kind === 'install-configure' || next.kind === 'configure')
      return proxyButton('setup', 'Review setup');
    if (next.kind === 'verify') return proxyButton('verify', 'Check integrations');
    if (next.kind === 'measure') return proxyButton('measurement-help', 'Measurement help');
    if (next.kind === 'review-health') return proxyButton('tab-activity', 'Review health evidence');
    if (next.kind === 'review-update') return proxyButton('update-check', 'Recheck updates');
    return null;
  }

  function renderComponent(component) {
    const card = node('article', undefined, 'panel agent');
    const head = node('div', undefined, 'agent-head');
    const title = node('div');
    title.append(
      node('h2', component.displayName),
      node('span', category[component.category] || component.category, 'caption'),
    );
    const healthLabel =
      component.health === 'healthy'
        ? 'Healthy'
        : component.health === 'attention'
          ? 'Needs attention'
          : 'Not fully verified';
    head.append(
      title,
      node(
        'span',
        healthLabel,
        'pill ' +
          (component.health === 'healthy' ? 'good' : component.health === 'attention' ? 'warn' : ''),
      ),
    );
    card.append(head);

    const lifecycle = node('div', undefined, 'agent-line');
    lifecycle.append(
      node('span', 'Lifecycle', 'key'),
      node(
        'strong',
        component.configured
          ? 'Configured'
          : component.installed
            ? 'Installed, not configured'
            : 'Available',
      ),
    );
    card.append(lifecycle);

    const version = node('div', undefined, 'agent-line');
    version.append(
      node('span', 'Version', 'key'),
      node('strong', component.version ? 'v' + component.version : 'Unavailable'),
    );
    card.append(version);

    const check = node('div', undefined, 'agent-line');
    check.append(
      node('span', 'Verification', 'key'),
      node('strong', verification[component.verification] || component.verification),
    );
    card.append(check);

    const updateLine = node('div', undefined, 'agent-line');
    const updateLabel = update[component.update] || component.update;
    updateLine.append(
      node('span', 'Update', 'key'),
      node(
        'strong',
        component.updateAvailableVersion
          ? updateLabel + ' · v' + component.updateAvailableVersion
          : updateLabel,
      ),
    );
    card.append(updateLine);

    const savings = (component.savings || []).filter(row => row.class !== 'counterfactual');
    if (savings.length) {
      for (const row of savings) {
        const saving = node('div', undefined, 'allowance-strip');
        saving.append(
          node('span', measurement[row.class] || row.class, 'key'),
          node(
            'strong',
            row.saved >= 0
              ? count(row.saved) + ' ' + row.unit + ' saved'
              : count(Math.abs(row.saved)) + ' ' + row.unit + ' more',
          ),
          node(
            'span',
            count(row.operations) + ' operation' + (row.operations === 1 ? '' : 's'),
            'caption',
          ),
        );
        card.append(saving);
      }
    } else {
      const saving = node('div', undefined, 'allowance-strip');
      saving.append(
        node('span', 'Measured value', 'key'),
        node('strong', 'No attributable result yet'),
      );
      card.append(saving);
    }

    const quality = node('div', undefined, 'agent-line');
    const qualityLabel =
      component.quality.state === 'preserved'
        ? 'Preserved'
        : component.quality.state === 'regressed'
          ? 'Regression detected'
          : component.quality.state === 'not-measured'
            ? 'Not measured'
            : 'Not attributed';
    quality.append(node('span', 'Quality', 'key'), node('strong', qualityLabel));
    card.append(quality);

    const details = node('details', undefined, 'agent-details');
    details.append(node('summary', 'Evidence and lifecycle details'));
    details.append(node('p', component.quality.detail, 'caption'));
    if (component.update === 'not-checked')
      details.append(
        node(
          'p',
          'No provider network update check runs automatically when the dashboard opens.',
          'caption',
        ),
      );
    for (const conflict of component.conflicts || [])
      details.append(node('p', 'Conflict: ' + conflict.detail, 'caption'));
    for (const warning of component.warnings || [])
      details.append(node('p', warning.message, 'caption'));
    if (component.nextAction)
      details.append(node('p', 'Next: ' + component.nextAction.reason, 'caption'));
    if (component.managedByTokenHarness || component.configured) {
      const remove = node(
        'button',
        component.managedByTokenHarness
          ? 'Remove managed integration'
          : 'Check removable managed changes',
        'secondary',
      );
      remove.type = 'button';
      remove.dataset.operation = 'remove';
      remove.addEventListener('click', () =>
        window.dispatchEvent(
          new CustomEvent('token-harness:remove-provider', {
            detail: { provider: component.providerId },
          }),
        ),
      );
      details.append(remove);
      if (!component.managedByTokenHarness)
        details.append(
          node(
            'p',
            'The provider installation is user-owned. This check can only remove configuration changes that Token Harness previously recorded as its own.',
            'caption',
          ),
        );
    }
    card.append(details);

    const next = action(component);
    if (next) {
      const actions = node('div', undefined, 'inline-actions');
      actions.append(next);
      card.append(actions);
    }
    return card;
  }

  function renderStack(stack) {
    const root = $('stack');
    if (!root || !stack) return;
    root.replaceChildren();
    root.setAttribute('aria-busy', 'false');
    const components = (stack.components || []).filter(
      component => component.detectedState !== 'absent',
    );
    if (!components.length) {
      root.append(
        node(
          'p',
          'No optimization component is currently installed or configured. Review setup to see supported changes.',
          'empty',
        ),
      );
      return;
    }
    for (const component of components) root.append(renderComponent(component));
    if (stack.unattributedDrift?.length) {
      const drift = node('article', undefined, 'panel agent');
      drift.append(
        node('h2', 'Unattributed configuration drift'),
        node('p', stack.unattributedDrift[0].detail),
        proxyButton('tab-activity', 'Review evidence'),
      );
      root.append(drift);
    }
  }

  function candidateStatus(observation) {
    if (!observation)
      return { label: 'Checking state', lifecycle: 'Candidate state is still being read', cls: '' };
    if (observation.state === 'absent')
      return { label: 'Not installed', lifecycle: 'Not installed · outside your active stack', cls: '' };
    if (observation.state === 'installed')
      return {
        label: 'Benchmark needed',
        lifecycle: 'Installed locally · not admitted to the active stack',
        cls: '',
      };
    if (observation.state === 'unsupported-version')
      return {
        label: 'Version not reviewed',
        lifecycle: 'Installed locally · below the reviewed benchmark baseline',
        cls: 'warn',
      };
    return {
      label: 'Ready to benchmark',
      lifecycle: 'Installed locally · eligible for read-only benchmarking',
      cls: '',
    };
  }

  function commandRow(command) {
    const row = node('div', undefined, 'agent-line');
    const code = node('code', command);
    const copy = node('button', 'Copy', 'secondary');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
      } catch {
        copy.textContent = 'Select command';
      }
    });
    row.append(code, copy);
    return row;
  }

  function candidateRunId(candidateId) {
    if (!candidateRunIds.has(candidateId))
      candidateRunIds.set(candidateId, candidateId + '-' + Date.now().toString(36));
    return candidateRunIds.get(candidateId);
  }

  function renderBenchmarkWorkflow(candidate, agents) {
    const details = node('details', undefined, 'agent-details');
    details.append(node('summary', 'Run a paired benchmark'));
    details.append(
      node(
        'p',
        'Run the same representative task twice: baseline without the candidate, then optimized with the candidate enabled through its own reviewed setup. Token Harness records boundaries and evidence; it does not install, enable, sync or configure the candidate.',
        'caption',
      ),
    );

    const harnesses = Array.isArray(agents)
      ? agents.map(agent => agent?.id).filter(id => id === 'claude' || id === 'codex')
      : [];
    const controls = node('div', undefined, 'agent-line');
    const harnessLabel = node('label', 'Agent', 'key');
    const harness = document.createElement('select');
    for (const id of (harnesses.length ? harnesses : ['codex'])) {
      const option = node('option', id === 'claude' ? 'Claude Code' : 'Codex');
      option.value = id;
      harness.append(option);
    }
    const taskLabel = node('label', 'Task class', 'key');
    const task = document.createElement('select');
    for (const id of ['mechanical', 'standard', 'hard', 'critical']) {
      const option = node('option', id[0].toUpperCase() + id.slice(1));
      option.value = id;
      option.selected = id === 'standard';
      task.append(option);
    }
    controls.append(harnessLabel, harness, taskLabel, task);
    details.append(controls);

    const commands = node('div');
    const renderCommands = () => {
      const id = candidateRunId(candidate.id);
      const common = ' --benchmark-id ' + id + ' --candidate ' + candidate.id;
      const run = ' --task ' + task.value + ' --harness ' + harness.value;
      commands.replaceChildren(
        node('p', '1. Start baseline, run the task with the candidate disabled, then finish with the actual outcome.', 'caption'),
        commandRow('token-harness benchmark-start' + common + ' --variant baseline' + run),
        commandRow('token-harness benchmark-finish --benchmark-id ' + id + ' --variant baseline --quality <passed|failed> --attempts <n> --failed-attempts <n>'),
        node('p', '2. Reproduce the same task with the candidate enabled through its own reviewed setup, then record the real outcome.', 'caption'),
        commandRow('token-harness benchmark-start' + common + ' --variant optimized' + run),
        commandRow('token-harness benchmark-finish --benchmark-id ' + id + ' --variant optimized --quality <passed|failed> --attempts <n> --failed-attempts <n>'),
        node('p', '3. Refresh this dashboard. The existing benchmark matrix will attribute the completed pair to this candidate.', 'caption'),
      );
    };
    harness.addEventListener('change', renderCommands);
    task.addEventListener('change', renderCommands);
    renderCommands();
    details.append(commands);
    details.append(
      node(
        'p',
        'Replace the finish placeholders with what actually happened. Candidate attribution identifies the experiment target only; it is not proof that the optimized run really used the candidate, and it never causes automatic admission to the active stack.',
        'caption',
      ),
    );
    return details;
  }

  function renderCandidateEvidence(card, evidence) {
    const line = node('div', undefined, 'agent-line');
    line.append(
      node('span', 'Paired evidence', 'key'),
      node(
        'strong',
        !evidence || evidence.pairs === 0
          ? 'No candidate-attributed pairs yet'
          : count(evidence.pairs) + ' pairs · ' + count(evidence.optimizedBetter) + ' optimized better · ' + count(evidence.baselineBetter) + ' baseline better',
      ),
    );
    card.append(line);
    if (!evidence || evidence.pairs === 0) return;

    const strength = node('div', undefined, 'agent-line');
    strength.append(
      node('span', 'Evidence strength', 'key'),
      node(
        'strong',
        count(evidence.quotaBacked) + ' quota-backed · ' +
          count(evidence.localEvidence) + ' local · ' +
          count(evidence.qualityOnly) + ' quality-only',
      ),
    );
    card.append(strength);

    if (evidence.localTokenSavingPercent !== null) {
      const local = node('div', undefined, 'allowance-strip');
      const delta = evidence.localTokenSavingPercent;
      local.append(
        node('span', 'Paired local token delta', 'key'),
        node(
          'strong',
          delta >= 0 ? count(delta) + '% lower in optimized runs' : count(Math.abs(delta)) + '% higher in optimized runs',
        ),
        node('span', 'Quality-passed locally attributable pairs only; not subscription quota.', 'caption'),
      );
      card.append(local);
    }

    if (evidence.baselineBetter > 0) {
      const warning = node('div', undefined, 'allowance-strip');
      warning.append(
        node('span', 'Caution', 'key'),
        node('strong', 'At least one paired result favored the baseline'),
      );
      card.append(warning);
    }
  }

  function renderCandidate(candidate, observation, evidence, agents) {
    const card = node('article', undefined, 'panel agent');
    const head = node('div', undefined, 'agent-head');
    const title = node('div');
    title.append(
      node('h2', candidate.displayName),
      node('span', category[candidate.category] || candidate.category, 'caption'),
    );
    const status = candidateStatus(observation);
    head.append(title, node('span', status.label, 'pill ' + status.cls));
    card.append(head);

    const lifecycle = node('div', undefined, 'agent-line');
    lifecycle.append(node('span', 'Lifecycle', 'key'), node('strong', status.lifecycle));
    card.append(lifecycle);

    if (observation) {
      const version = node('div', undefined, 'agent-line');
      version.append(
        node('span', 'Version', 'key'),
        node(
          'strong',
          observation.state === 'absent'
            ? 'Not installed'
            : observation.version
              ? 'v' + observation.version
              : 'Unavailable',
        ),
      );
      card.append(version);
      const baseline = node('div', undefined, 'agent-line');
      baseline.append(
        node('span', 'Benchmark baseline', 'key'),
        node('strong', 'v' + observation.minimumBenchmarkVersion),
      );
      card.append(baseline);
    }

    renderCandidateEvidence(card, evidence);

    const opportunity = node('div', undefined, 'allowance-strip');
    opportunity.append(
      node('span', 'What it could improve', 'key'),
      node('strong', candidate.opportunity),
    );
    card.append(opportunity);

    const evidenceDetails = node('details', undefined, 'agent-details');
    evidenceDetails.append(
      node('summary', 'Evidence required before adding'),
      node('p', candidate.evidence, 'caption'),
      node('p', candidate.beforeAdding, 'caption'),
    );
    card.append(evidenceDetails);
    if (observation?.state === 'benchmark-ready') card.append(renderBenchmarkWorkflow(candidate, agents));
    return card;
  }

  function candidateMap(observations) {
    const result = new Map();
    if (!Array.isArray(observations)) return result;
    for (const observation of observations) {
      if (
        !observation ||
        typeof observation !== 'object' ||
        !candidateStates.has(observation.state) ||
        !candidateCatalog.some(candidate => candidate.id === observation.id)
      )
        continue;
      result.set(observation.id, observation);
    }
    return result;
  }

  function candidateEvidenceMap(evidence) {
    const result = new Map();
    if (!Array.isArray(evidence)) return result;
    for (const item of evidence) {
      if (
        !item ||
        typeof item !== 'object' ||
        !candidateCatalog.some(candidate => candidate.id === item.candidateId) ||
        !Number.isFinite(item.pairs) ||
        item.pairs < 0
      )
        continue;
      result.set(item.candidateId, item);
    }
    return result;
  }

  function renderCandidates(observations, evidence, agents) {
    const root = $('candidates');
    if (!root) return;
    const observed = candidateMap(observations);
    const measured = candidateEvidenceMap(evidence);
    root.replaceChildren();
    for (const candidate of candidateCatalog)
      root.append(
        renderCandidate(candidate, observed.get(candidate.id), measured.get(candidate.id), agents),
      );
  }

  function selectedPeriod() {
    const value = $('period')?.value;
    return ['all', '7d', '30d'].includes(value) ? value : 'all';
  }

  $('period')?.addEventListener('change', () => {
    const stack = stackCache.get(selectedPeriod());
    if (stack) renderStack(stack);
  });

  renderCandidates(null, null, null);

  window.fetch = async (...args) => {
    let fetchArgs = args;
    const target = String(args[0]);
    const verifyRequest = target.includes('/api/verify');
    const updateRequest = target.includes('/api/update-check');
    const stackObservationRequest = verifyRequest || updateRequest;
    if (stackObservationRequest && args[1] && typeof args[1] === 'object') {
      try {
        const options = { ...args[1] };
        if (typeof options.body === 'string') {
          const body = JSON.parse(options.body);
          if (
            body &&
            typeof body === 'object' &&
            !Array.isArray(body) &&
            body.period === undefined
          ) {
            options.body = JSON.stringify({ ...body, period: selectedPeriod() });
            fetchArgs = [args[0], options];
          }
        }
      } catch {
        // Keep the original request unchanged if it is not the guided JSON shape.
      }
    }
    const response = await originalFetch(...fetchArgs);
    try {
      if (response.ok && (target.includes('/api/overview') || stackObservationRequest)) {
        const data = await response.clone().json();
        if (target.includes('/api/overview'))
          renderCandidates(
            data?.optimizationCandidates ?? [],
            data?.value?.candidates ?? [],
            data?.agents ?? [],
          );
        if (data?.stack) {
          const period = stackObservationRequest
            ? selectedPeriod()
            : (new URL(target, window.location.href).searchParams.get('period') ?? 'all');
          stackCache.set(period, data.stack);
          if (period === selectedPeriod()) renderStack(data.stack);
        }
      }
    } catch {
      // Stack and candidate rendering are supplementary. Never interfere with the existing request.
    }
    return response;
  };
})();
`;
