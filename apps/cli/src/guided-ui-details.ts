/**
 * Details: the evidence behind every number (per optimizer, routing, coding app and measurement),
 * per-agent status, checks and maintenance, retained change history and recent activity.
 * Concatenated into the shared controller scope next to guided-ui-core.ts.
 */
export const GUIDE_DETAILS_JS = String.raw`
  let detailsLang = '';
  let operationsHistory = null;

  const dotted = (...parts) => parts.filter(Boolean).join(' · ');
  const scoped = (source, label) => dotted(source && source.harnessId ? agentName(source.harnessId) : '', label);
  const outcomeText = value => (value === 'passed' ? t('passed') : value === 'failed' ? t('failed') : String(value));

  function evidenceTypeLabel(type) {
    if (type === 'optimizer') return t('Optimizer');
    if (type === 'routing') return t('Routing');
    if (type === 'harness') return t('Coding app');
    if (type === 'measurement') return t('Measurement');
    return t('Experiment');
  }

  function benchmarkId(candidateId) {
    return candidateId + '-eval-' + Date.now().toString(36);
  }

  function bestReduction() {
    const rows = (current?.savings?.rows || []).filter(row => row.impact?.kind === 'reduction');
    rows.sort((a, b) => {
      const measured = row => (row.measurement === 'Measured local output' ? 1 : 0);
      const pa = Number.parseFloat(String(a.impact?.percent || '0')) || 0;
      const pb = Number.parseFloat(String(b.impact?.percent || '0')) || 0;
      return measured(b) - measured(a) || pb - pa;
    });
    return rows[0] || null;
  }

  function comparisonReason(topic) {
    const comparisons = current?.value?.comparisons;
    if (comparisons?.available === false) return t('Benchmark evidence could not be read. Refresh to retry.');
    if (comparisons?.incomplete) return t('{n} comparison(s) are unfinished. Finish both task variants, then Refresh.', { n: count(comparisons.incomplete) });
    if (comparisons?.invalid) return t('{n} comparison(s) could not be validated. Capture a new matched pair.', { n: count(comparisons.invalid) });
    if (comparisons?.complete) return topic === 'quality'
      ? t('Task checks are missing or failed for the recorded comparisons. Record the actual quality outcome for both runs.')
      : t('Recorded comparisons lack authoritative quota readings in matching windows. Live balances alone do not measure savings.');
    const base = t('No baseline/optimized task comparison for this project.');
    const other = comparisons?.otherProject ? t('Comparisons recorded in other projects are outside this view.') : '';
    return [base, other, t('Use Record a comparison to capture usage and quality checks.')].filter(Boolean).join(' ');
  }

  function qualitySummary() {
    const quality = current?.value?.quality;
    if (quality?.state === 'regressed') return { value: t('Regression detected'), detail: t('Savings claims are blocked until quality is recovered.'), cls: 'warn' };
    if (quality?.state === 'preserved') return { value: t('Preserved'), detail: t('{n} paired benchmark(s) support this result.', { n: count(quality.pairs) }), cls: 'good' };
    return {
      value: current?.value?.comparisons?.available === false ? t('Evidence unavailable') : t('Comparison needed'),
      detail: comparisonReason('quality'),
      cls: '',
    };
  }

  function allowanceSignal(evidence, label) {
    if (evidence?.state === 'blocked-by-quality') return { value: t('Not credited'), label: t('{label} · quality gate did not pass', { label }), tone: 'warn' };
    if (evidence?.state !== 'measured' || evidence.savedPercent === null || evidence.savedPercent === undefined) return null;
    const value = evidence.savedPercent;
    const n = count(Math.abs(value));
    return {
      value: value < 0 ? t('{n} percentage points more used', { n }) : value > 0 ? t('{n} percentage points saved', { n }) : t('{n} percentage points net change', { n }),
      label,
      tone: value < 0 ? 'warn' : value > 0 ? 'good' : '',
    };
  }

  function allowanceSummary() {
    const five = current?.value?.allowance5h;
    const weekly = current?.value?.allowance7d;
    if (!current?.value?.byHarness?.length && (five?.state === 'blocked-by-quality' || weekly?.state === 'blocked-by-quality'))
      return { value: t('Not credited'), detail: t('A quota reduction exists, but quality evidence does not yet allow it to be credited.'), cls: 'warn' };
    const sources = current?.value?.byHarness?.length ? current.value.byHarness : [{ allowance5h: five, allowance7d: weekly }];
    const signals = sources.flatMap(source => [['allowance5h', '5h'], ['allowance7d', '7d']].flatMap(([key, label]) => {
      const signal = allowanceSignal(source[key], scoped(source, label));
      return signal ? [signal] : [];
    }));
    if (signals.length) return {
      value: signals.length === 1 ? signals[0].value : t('Paired readings'),
      detail: signals.map(signal => signal.label + ': ' + signal.value).join(' · '),
      cls: signals.some(signal => signal.tone === 'warn') ? 'warn' : 'good',
    };
    const live = activeAgents().some(agent => (agent.allowance || []).some(window => Number.isFinite(window.remaining)));
    const reason = comparisonReason('allowance');
    return {
      value: current?.value?.comparisons?.available === false ? t('Evidence unavailable') : t('Comparison needed'),
      detail: live ? t('Current quota is being read; savings need a comparison.') + ' ' + reason : reason,
      cls: '',
    };
  }

  function metricCard(title, value, detail, cls = '') {
    const card = node('article', undefined, 'metric-card ' + cls);
    card.append(node('span', title, 'metric-label'), node('strong', value, 'metric-value'), node('p', detail, 'metric-help'));
    return card;
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
    const typeLabel = evidenceTypeLabel(type);
    identity.append(node('span', typeLabel, 'evidence-kind'), node('strong', name), node('span', scope, 'caption'));
    const results = node('span', undefined, 'evidence-signals');
    for (const signal of signals) {
      const result = node('span', undefined, 'evidence-signal ' + (signal.tone || ''));
      result.append(node('strong', signal.value), node('span', signal.label, 'caption'));
      results.append(result);
    }
    const cue = node('span', t('Details'), 'evidence-cue');
    const chevron = node('span', '›', 'evidence-chevron');
    chevron.setAttribute('aria-hidden', 'true');
    cue.append(chevron);
    summary.append(identity, results, cue);
    const detailBody = node('div', undefined, 'evidence-detail-body');
    detailBody.append(...sections);
    disclosure.append(summary, detailBody);
    row.append(disclosure);
    // Search includes provenance, so a unit or linked app can be found while collapsed.
    row.dataset.search = [type, typeLabel, name, scope, row.textContent].join(' ').toLocaleLowerCase();
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
    const n = count(Math.abs(row.saved));
    const value = impact && impact.kind !== 'unavailable'
      ? impactHeadline(row)
      : row.saved < 0 ? t('{n} {unit} added', { n, unit: unitLabel(row.unit) })
        : row.saved > 0 ? t('{n} {unit} saved', { n, unit: unitLabel(row.unit) })
          : t('{n} {unit} net change', { n, unit: unitLabel(row.unit) });
    return {
      value,
      label: dotted(includeProvider ? row.provider : '', measurementLabel(row.measurement), unitLabel(row.unit)),
      tone: impact?.kind === 'growth' ? 'warn' : impact?.kind === 'reduction' ? 'good' : '',
    };
  }

  function optimizerEvidenceDetail(row, includeProvider = false) {
    const volume = value => (value === null || value === undefined ? t('Not recorded') : count(value) + ' ' + unitLabel(row.unit));
    const note = row.impact?.detail || t('A comparable before/after pair is needed to report a percentage.');
    return evidenceSection(dotted(includeProvider ? row.provider : '', measurementLabel(row.measurement), unitLabel(row.unit)), [
      [t('Before'), volume(row.before)],
      [t('After'), volume(row.after)],
      [row.saved < 0 ? t('Added') : t('Saved'), volume(Math.abs(row.saved))],
      [t('Changed outputs'), count(row.operations)],
      [t('Recorded app'), row.agents?.length ? row.agents.join(', ') : t('Not attributed')],
    ], row.agents?.length ? note : note + ' ' + t('These records do not identify which coding app ran the command.'));
  }

  function routingDetails(agent) {
    const routing = agent.promptRouting || {};
    const tier = routing.verificationTier;
    let line;
    if (routing.enablement === 'untrusted') line = t('Action required: open /hooks in Codex and trust this hook, then submit a prompt.');
    else if (routing.enablement === 'disabled') line = t('Hooks are turned off for this coding app. Recorded hook runs describe earlier activity.');
    else if (routing.configured === false) line = t('Automatic routing is not enabled. Recorded hook runs describe earlier activity.');
    else if (tier === 'runtime-observed') line = t('A real hook run was observed. Subagent starts prove delegation; savings require a comparison.');
    else if (routing.configured !== false && routing.enablement === 'unknown') line = t('Authorization is unknown; check the hook status in the coding app.');
    else if (routing.enablement === 'enabled' || (!routing.enablement && routing.state === 'managed')) line = t('Configured; waiting for the first hook run after a prompt.');
    else if (routing.state === 'external') line = t('Routing is managed elsewhere; Token Harness leaves it unchanged.');
    else line = t('Automatic routing is not enabled for this coding app.');
    const facts = [[t('Verification'), tier === 'runtime-observed' ? t('Hook run observed') : tier === 'config-only' ? t('Configuration only') : t('Not verified')]];
    if (Number.isFinite(routing.promptSubmissions)) facts.push([t('Prompt hook runs'), count(routing.promptSubmissions)]);
    if (Number.isFinite(routing.subagentsStarted)) facts.push([t('Subagents started'), count(routing.subagentsStarted)]);
    if (Number.isFinite(routing.subagentsStopped)) facts.push([t('Subagents stopped'), count(routing.subagentsStopped)]);
    if (routing.reportedModels?.length) facts.push([t('Reported models'), routing.reportedModels.join(', ')]);
    if (routing.lastObservedAt) facts.push([t('Last hook run'), date(routing.lastObservedAt)]);
    return evidenceSection(t('{agent} · routing activity', { agent: agent.name }), facts, line);
  }

  function runtimeSignals(agent) {
    const routing = agent.promptRouting;
    if (routing?.verificationTier !== 'runtime-observed' || routing.receiptState === 'unavailable') return [];
    const label = t('{agent} · observed routing activity', { agent: agent.name });
    const signals = [];
    for (const [key, text] of [
      ['promptSubmissions', n => t('{n} prompt hook runs', { n })],
      ['subagentsStarted', n => t('{n} subagents started', { n })],
      ['subagentsStopped', n => t('{n} subagents stopped', { n })],
    ]) {
      if (Number.isFinite(routing[key]) && routing[key] > 0) signals.push({ value: text(count(routing[key])), label });
    }
    return signals;
  }

  function liveAllowanceSignals(agent) {
    return (agent.allowance || []).filter(window => Number.isFinite(window.remaining)).map(window => ({
      value: t('{n}% remaining', { n: count(window.remaining) }),
      label: t('{agent} · {window} · current balance', { agent: agent.name, window: window.label }),
    }));
  }

  function liveAllowanceDetails(agent) {
    const windows = agent.allowance || [];
    const sections = windows.map(window => evidenceSection(dotted(agent.name, window.label), [
      [t('Remaining'), Number.isFinite(window.remaining) ? count(window.remaining) + '%' : t('Unavailable')],
      [t('Source'), window.source || t('Not recorded')],
      [t('Reset'), window.resetsAt ? date(window.resetsAt) : t('Not recorded')],
      [t('Read at'), date(window.observedAt || current.generatedAt)],
    ], t('Current balance observation; this is not a saved allowance percentage.')));
    if (!sections.length) {
      const section = evidenceSection(t('{agent} · current allowance', { agent: agent.name }), [], agent.pending?.includes('allowance')
        ? t('Reading current allowance…')
        : agent.allowanceNote || t('No readable allowance source is available. This does not mean a zero balance.'));
      section.append(actionButton(t('Refresh readings'), () => refresh(true), 'secondary'));
      sections.push(section);
    }
    return sections;
  }

  function comparisonSection() {
    const comparisons = current?.value?.comparisons;
    const section = evidenceSection(t('Current-project comparisons'), [
      [t('Evidence read'), !comparisons ? t('Not checked') : comparisons.available === false ? t('Unavailable') : t('Available')],
      [t('Complete pairs'), count(comparisons?.complete || 0)],
      [t('Unfinished pairs'), count(comparisons?.incomplete || 0)],
      [t('Invalid pairs'), count(comparisons?.invalid || 0)],
    ], t('Comparisons cover the project where Token Harness was opened. They are independent of the output-history period filter.'));
    section.append(actionButton(t('Record a comparison'), () => measurementGuide(), 'secondary'));
    const pending = current?.value?.pendingConfiguration;
    if (pending) {
      section.append(messageBox(
        t('Temporary configuration needs completion or recovery'),
        pending.state === 'active'
          ? t('Prepared arm: {id} / {variant}. Finish this arm or restore it before another managed change.', { id: pending.benchmarkId, variant: pending.variant })
          : t('The configuration lease is unreadable. Preserve the checkpoint and backups and inspect local state.'),
      ));
      section.append(actionButton(t('Review benchmark recovery'), openBenchmarkRecovery, 'secondary'));
    }
    return section;
  }

  function measurementGuide(agentId = activeAgents()[0]?.id) {
    modal(t('Record a baseline/optimized comparison'));
    const agents = activeAgents();
    if (!agents.length) {
      $('modal-content').append(messageBox(t('Coding app needed'), t('Open Methods and expose Codex or Claude Code before recording a comparison.')));
      $('modal-actions').append(modalClose(t('Done')));
      return;
    }
    const id = benchmarkId('task');
    const selected = node('select');
    selected.id = 'comparison-agent';
    selected.setAttribute('aria-label', t('Coding app for both comparison runs'));
    for (const agent of agents) {
      const option = node('option', agent.name);
      option.value = agent.id;
      selected.append(option);
    }
    selected.value = agents.some(agent => agent.id === agentId) ? agentId : agents[0].id;
    const design = node('select');
    design.id = 'comparison-design';
    design.setAttribute('aria-label', t('Comparison design'));
    for (const [value, text] of [['paired', t('Baseline / optimized')], ['factorial', t('Four arms: compression and routing')]]) {
      const option = node('option', text);
      option.value = value;
      design.append(option);
    }
    design.value = 'paired';
    const designLabel = node('label', t('Comparison design'));
    designLabel.setAttribute('for', design.id);
    const checkInput = node('input');
    checkInput.id = 'comparison-check';
    checkInput.setAttribute('aria-label', t('Optional quality check'));
    checkInput.maxLength = 20480;
    checkInput.placeholder = '["npm","run","verify"]';
    const checkLabel = node('label', t('Optional quality check (executable and arguments)'));
    checkLabel.setAttribute('for', checkInput.id);
    const checkHint = node('p', t('Leave empty to record your checks manually. Commands below use Bash or PowerShell quoting.'), 'caption');
    checkHint.id = 'comparison-check-hint';
    checkInput.setAttribute('aria-describedby', checkHint.id);
    const stateInput = node('input');
    stateInput.id = 'comparison-starting-state';
    stateInput.setAttribute('aria-label', t('Same starting state'));
    stateInput.placeholder = t('Initial Git commit or fixture id');
    const stateLabel = node('label', t('Same starting state for all four arms'));
    stateLabel.setAttribute('for', stateInput.id);
    const steps = node('div');
    steps.setAttribute('aria-live', 'polite');
    const renderSteps = () => {
      stateInput.hidden = stateLabel.hidden = design.value !== 'factorial';
      checkInput.setAttribute('aria-invalid', 'false');
      stateInput.setAttribute('aria-invalid', 'false');
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
          steps.replaceChildren(messageBox(t('Check needs an executable and arguments'), t('Enter a JSON array such as ["npm","run","verify"]. If an argument contains an apostrophe, use the CLI and quote it for your shell.')));
          return;
        }
      }
      const finish = arm => 'token-harness benchmark-finish --benchmark-id ' + id + ' --variant ' + arm +
        (checkSuffix ? ' --yes' : ' --quality <passed|failed>') + ' --attempts <n> --failed-attempts <n>';
      if (design.value === 'factorial') {
        const state = stateInput.value.trim();
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(state)) {
          stateInput.setAttribute('aria-invalid', 'true');
          steps.replaceChildren(messageBox(t('Starting state needed'), t('Enter the initial Git commit or fixture id. Restore that same starting tree before every arm.')));
          return;
        }
        const rows = [messageBox(t('Exploratory four-arm comparison'), t('Preview each temporary configuration with benchmark-prepare, then repeat that command with --yes. Finish restores the original configuration. Restore the same starting tree and start a fresh coding session before every task. Setup must already support owned RTK/HarnessTrim changes. Configuration checks are config-only; routing arms need real hook runs.'))];
        for (const [arm, label] of [
          ['baseline', t('Compression off · routing off')],
          ['compression-only', t('Compression on · routing off')],
          ['routing-only', t('Compression off · routing on')],
          ['combined', t('Compression on · routing on')],
        ]) {
          rows.push(
            node('h3', arm + ' — ' + label),
            copyRow('token-harness benchmark-prepare --benchmark-id ' + id + ' --variant ' + arm + ' --starting-state ' + state + ' --task standard --harness ' + selected.value + checkSuffix),
            node('p', checkSuffix
              ? t('Run the same task. Review the saved check before running the finish command.')
              : t('Run the same task. Run the same acceptance checks and record their result.')),
            copyRow(finish(arm)),
            node('p', t('If the task is cancelled or the process is interrupted, preview recovery, then add --yes:')),
            copyRow('token-harness benchmark-restore --benchmark-id ' + id + ' --variant ' + arm),
          );
        }
        rows.push(
          copyRow('token-harness benchmark-factorial --benchmark-id ' + id),
          node('p', t('Run from the same project where this app was opened, then choose Refresh. Repeat controlled four-arm sets before drawing conclusions.')),
        );
        steps.replaceChildren(...rows);
        return;
      }
      steps.replaceChildren(
        node('h3', t('1. Prepare the baseline')),
        node('p', t('Use the same representative task, starting state, coding app and checks for both runs. For a routing comparison, turn routing off in Methods before starting the baseline. Start a fresh coding session after changing hooks.')),
        copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --variant baseline --task standard --harness ' + selected.value + checkSuffix),
        node('h3', t('2. Run the task and check its result')),
        node('p', t('Run the baseline task in the coding app, then run its tests or acceptance checks. Replace the placeholders below with the actual result and attempt counts; passed means the checks succeeded.')),
        copyRow(finish('baseline')),
        node('h3', t('3. Repeat with optimization enabled')),
        node('p', t('Restore the same starting state. Turn on the optimization under evaluation in Methods. For routing, trust the hook in Codex /hooks and start a fresh session; the optimized task must actually start a native subagent.')),
        copyRow('token-harness benchmark-start --benchmark-id ' + id + ' --variant optimized --task standard --harness ' + selected.value + checkSuffix),
        node('p', t('Run the same task and checks, then record the actual optimized outcome.')),
        copyRow(finish('optimized')),
        node('h3', t('4. Refresh Details')),
        node('p', t('Run the capture commands from the same project where this app was opened. Start/finish read quota, local session usage and routing records automatically; quality comes from the saved direct check, or from your recorded checks when no command is set. If a quota window resets during a run or the source is unavailable, that window stays unmeasured. Repeat representative pairs before drawing conclusions.')),
      );
    };
    selected.addEventListener('change', renderSteps);
    design.addEventListener('change', renderSteps);
    checkInput.addEventListener('input', renderSteps);
    stateInput.addEventListener('input', renderSteps);
    renderSteps();
    $('modal-content').append(
      messageBox(t('Why a comparison is needed'), t('Normal usage records optimizer output and routing activity. Demonstrated savings require comparable baseline and optimized tasks; Token Harness cannot reconstruct an unrecorded baseline or decide whether your task passed its checks.')),
      selected, designLabel, design, checkLabel, checkInput, checkHint, stateLabel, stateInput, steps,
    );
    $('modal-actions').append(modalClose(t('Done')));
  }

  function labelledField(label, element, id) {
    element.id = id;
    const heading = node('label', label);
    heading.setAttribute('for', id);
    const wrap = node('div', undefined, 'evidence-field');
    wrap.append(heading, element);
    return wrap;
  }

  async function reviewComparison(body) {
    if (busy) return;
    const run = modal(t('Review comparison step'));
    $('modal-content').append(progress(t('Preparing the measurement preview'), t('No evidence is recorded until you approve this step.')));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    try {
      await ensureSession();
      const preview = await request('/api/preview', body);
      if (run !== modalRun) return;
      $('modal-title').textContent = preview.title;
      $('modal-content').replaceChildren();
      for (const change of preview.changes || []) {
        const row = node('article', undefined, 'preview-change');
        row.append(node('h3', change.title), node('p', change.description));
        $('modal-content').append(row);
      }
      for (const notice of preview.notices || []) $('modal-content').append(node('p', notice, 'notice-row'));
      $('modal-actions').replaceChildren(modalClose(t('Cancel')));
      if (preview.ticket) $('modal-actions').append(actionButton(t('Record reviewed step'), () => applyTicket(preview.ticket)));
    } catch (error) {
      if (run !== modalRun) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  function comparisonOutcome(item) {
    modal(t('Record checks and attempts'));
    $('modal-content').append(messageBox(t('Your recorded checks'), t('Run the same tests or acceptance checks yourself before choosing an outcome. Token Harness does not execute a check or infer quality from the assistant response. Failed outcomes are retained.')));
    const quality = node('select');
    for (const [value, label] of [['', t('Choose the actual outcome')], ['passed', t('Checks passed')], ['failed', t('Checks failed')]]) {
      const option = node('option', label);
      option.value = value;
      quality.append(option);
    }
    quality.value = '';
    const attempts = node('input');
    const failed = node('input');
    attempts.type = failed.type = 'number';
    attempts.min = '1';
    failed.min = '0';
    attempts.step = failed.step = '1';
    attempts.value = '1';
    failed.value = '0';
    $('modal-content').append(
      labelledField(t('Check outcome (recorded by you)'), quality, 'paired-quality'),
      labelledField(t('Total coding attempts'), attempts, 'paired-attempts'),
      labelledField(t('Failed coding attempts'), failed, 'paired-failed'),
    );
    const hint = node('p', t('Choose an outcome and enter the actual attempt counts. Passed needs at least one successful attempt.'), 'caption');
    hint.setAttribute('role', 'status');
    $('modal-content').append(hint);
    const review = actionButton(t('Review recorded outcome'), () => reviewComparison({
      action: 'comparison-step', key: item.key, expected: item.next, quality: quality.value,
      attempts: Number(attempts.value), failedAttempts: Number(failed.value),
    }));
    const validate = () => {
      const total = Number(attempts.value);
      const errors = Number(failed.value);
      const counts = Number.isSafeInteger(total) && total >= 1 && Number.isSafeInteger(errors) && errors >= 0 && errors <= total && (quality.value !== 'passed' || errors < total);
      review.disabled = !['passed', 'failed'].includes(quality.value) || !counts;
      attempts.setAttribute('aria-invalid', String(!counts));
      failed.setAttribute('aria-invalid', String(!counts));
    };
    for (const input of [quality, attempts, failed]) input.addEventListener('input', validate);
    quality.addEventListener('change', validate);
    $('modal-actions').append(modalClose(t('Cancel')), review);
    validate();
  }

  function optimizedComparison(item) {
    modal(t('Prepare the optimized run'));
    $('modal-content').append(messageBox(t('Repeat the same task'), t('Restore the same starting tree and acceptance checks. Turn on the optimization under evaluation in Methods, then start a fresh coding session when hooks change. This acknowledgement does not prove provider execution, child models or savings.')));
    const checkbox = node('input');
    checkbox.type = 'checkbox';
    const label = node('label', undefined, 'setup-choice');
    label.append(checkbox, node('span', t('I restored the same task/tree/checks and turned on the optimization to evaluate.')));
    $('modal-content').append(label);
    const review = actionButton(t('Review optimized capture'), () => reviewComparison({
      action: 'comparison-step', key: item.key, expected: 'start-optimized', acknowledged: checkbox.checked === true,
    }));
    review.disabled = true;
    checkbox.addEventListener('change', () => { review.disabled = !checkbox.checked; });
    $('modal-actions').append(modalClose(t('Cancel')), review);
  }

  async function openComparisons() {
    if (busy) return;
    const run = modal(t('Record a paired comparison'));
    $('modal-content').append(progress(t('Reading retained comparisons'), t('Measurements for the project where this app was opened.')));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    try {
      await ensureSession();
      const report = await request('/api/comparisons');
      if (run !== modalRun) return;
      $('modal-content').replaceChildren(messageBox(t('Baseline → task and checks → optimized → task and checks'), report.note));
      const agents = activeAgents();
      let newForm = null;
      if (report.available && !report.blocked && agents.length) {
        const harness = node('select');
        const task = node('select');
        for (const agent of agents) {
          const option = node('option', agent.name);
          option.value = agent.id;
          harness.append(option);
        }
        harness.value = agents[0].id;
        for (const [value, label] of [['mechanical', t('Mechanical')], ['standard', t('Standard')], ['hard', t('Hard')], ['critical', t('Critical')]]) {
          const option = node('option', label);
          option.value = value;
          task.append(option);
        }
        task.value = 'standard';
        const form = node('section');
        form.append(
          node('h3', t('Start a new baseline')),
          labelledField(t('Coding app for both runs'), harness, 'paired-harness'),
          labelledField(t('Task class for both runs'), task, 'paired-task'),
          node('p', t('Run one comparison at a time. Starting records observations; run the coding task yourself, including from Harness Remote, then return to finish it.')),
          actionButton(t('Review new baseline'), () => reviewComparison({ action: 'comparison-new', harness: harness.value, task: task.value })),
        );
        newForm = form;
      } else if (!agents.length) $('modal-content').append(sectionEmpty(t('Expose a supported coding app in Methods before starting a comparison.')));
      const stateLabel = state => (state === 'baseline-running' ? t('1 / 4 · Baseline capture started')
        : state === 'optimized-ready' ? t('2 / 4 · Baseline outcome recorded')
          : state === 'optimized-running' ? t('3 / 4 · Optimized capture started')
            : state === 'complete' ? t('4 / 4 · Pair complete')
              : state === 'invalid' ? t('Retained evidence needs inspection') : t('Comparison state unavailable'));
      for (const item of report.items || []) {
        const row = node('article', undefined, 'preview-change');
        row.append(node('h3', stateLabel(item.state)), node('p', dotted(agentName(item.harness), item.task, date(item.startedAt))));
        if (item.baselineQuality) row.append(node('p', t('Baseline checks: {outcome} (recorded by you).', { outcome: outcomeText(item.baselineQuality) })));
        if (item.optimizedQuality) row.append(node('p', t('Optimized checks: {outcome} (recorded by you). Inspect Details for comparable measurements and missing evidence.', { outcome: outcomeText(item.optimizedQuality) })));
        if (!report.blocked && item.next) {
          const label = item.next === 'start-optimized' ? t('Prepare optimized run')
            : item.next === 'finish-baseline' ? t('Record baseline outcome') : t('Record optimized outcome');
          row.append(actionButton(label, () => (item.next === 'start-optimized' ? optimizedComparison(item) : comparisonOutcome(item)), 'secondary'));
        }
        $('modal-content').append(row);
      }
      if (!report.items?.length) $('modal-content').append(sectionEmpty(t('No supported app comparisons are available for the current project. Advanced CLI comparisons remain visible in Details.')));
      if (newForm) $('modal-content').append(newForm);
      $('modal-actions').replaceChildren(
        modalClose(t('Done')),
        actionButton(t('Refresh comparisons'), openComparisons, 'secondary'),
        actionButton(t('Advanced comparison guide'), () => measurementGuide(), 'secondary'),
      );
    } catch (error) {
      if (run !== modalRun) return;
      $('modal-error').textContent = error.message;
      $('modal-error').hidden = false;
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  function renderEvidence() {
    const body = $('result-evidence');
    if (!body) return;
    const openKeys = new Set([...body.querySelectorAll('details[open]')].map(item => item.dataset.key));
    body.replaceChildren();
    const savings = current?.savings?.rows || [];
    for (const id of optimizerIds()) {
      const info = optimizerInfo(id);
      const component = managedComponent(id);
      const measured = savings.filter(row => row.providerId === id);
      const scope = component?.configuredHarnesses?.length
        ? t('Setup: {apps}', { apps: component.configuredHarnesses.map(agentName).join(', ') })
        : t('No setup detected');
      const signals = measured.length
        ? measured.map(row => optimizerSignal(row))
        : [{ value: t('No results yet'), label: t('No output recorded for this period') }];
      const sections = measured.map(row => optimizerEvidenceDetail(row));
      if (!measured.length) {
        const nextStep = evidenceSection(t('Start recording results'), [], component?.configured
          ? t('Use a connected coding app normally, then Refresh. Detected setup alone does not prove that the optimizer ran.')
          : t('Review this optimizer in Methods to see available connections.'));
        nextStep.append(navigateButton(t('Open Methods'), 'methods'));
        sections.push(nextStep);
      }
      addEvidenceRow(body, 'optimizer', info.name, scope, signals, measured.length, sections);
    }

    const routing = current?.value?.routing;
    const routingAgents = activeAgents();
    const blocked = routing?.state === 'blocked-by-quality';
    const routeSignals = routingAgents.flatMap(runtimeSignals);
    if (blocked) routeSignals.push({ value: t('Not credited'), label: t('Quality gate did not pass'), tone: 'warn' });
    else {
      if (routing?.savedLocalTokens !== null && routing?.savedLocalTokens !== undefined) {
        const n = count(Math.abs(routing.savedLocalTokens));
        routeSignals.push({
          value: routing.savedLocalTokens < 0 ? t('{n} tokens added', { n }) : t('{n} tokens saved', { n }),
          label: t('Paired end-to-end local usage'),
          tone: routing.savedLocalTokens < 0 ? 'warn' : routing.savedLocalTokens > 0 ? 'good' : '',
        });
      }
      const routeSources = current?.value?.byHarness?.length ? current.value.byHarness : [{ routing }];
      for (const source of routeSources) {
        for (const [key, label] of [['allowance5h', t('5h allowance')], ['allowance7d', t('7d allowance')]]) {
          const signal = allowanceSignal(source.routing?.[key], dotted(source.harnessId ? agentName(source.harnessId) : '', label, t('paired evidence')));
          if (signal) routeSignals.push(signal);
        }
      }
      if (routing?.state !== 'measured') routeSignals.push({
        value: t('Savings comparison needed'),
        label: routing?.pairs ? t('Quality passed; comparable usage is missing') : t('Activity is recorded automatically; savings need paired runs'),
      });
      if (!routingAgents.some(agent => runtimeSignals(agent).length) && !routing?.pairs)
        routeSignals.push({ value: t('No runtime activity yet'), label: t('Check the hook status under Coding agents') });
    }
    const routingSections = [
      evidenceSection(t('Savings verification'), [[t('Quality-passed pairs'), count(routing?.pairs || 0)]],
        blocked ? t('A quality regression blocks the savings claim.') : routing?.basis || t('Hook runs prove the hook ran. Savings require paired runs with a passing quality gate.')),
      comparisonSection(),
    ];
    for (const agent of routingAgents) routingSections.push(routingDetails(agent));
    const runtimeCount = routingAgents.reduce((total, agent) => total + (agent.promptRouting?.verificationTier === 'runtime-observed'
      ? (agent.promptRouting.promptSubmissions || 0) + (agent.promptRouting.subagentsStarted || 0) + (agent.promptRouting.subagentsStopped || 0) : 0), 0);
    addEvidenceRow(body, 'routing', t('Automatic prompt routing'),
      dotted(t('Recorded hook runs across projects'), routingAgents.map(agent => agent.name).join(', ') || t('No coding app detected')),
      routeSignals, runtimeCount + (routing?.pairs || 0), routingSections);

    const allowanceSources = current?.value?.byHarness?.length ? current.value.byHarness : [current?.value || {}];
    const quotaSignals = allowanceSources.flatMap(source => [['allowance5h', '5h'], ['allowance7d', '7d']].flatMap(([key, label]) => {
      const signal = allowanceSignal(source[key], dotted(source.harnessId ? agentName(source.harnessId) : '', label, t('paired allowance')));
      return signal ? [signal] : [];
    }));
    const liveSignals = routingAgents.flatMap(liveAllowanceSignals);
    const allowanceSections = [evidenceSection(t('Allowance savings'), [], allowanceSummary().detail), comparisonSection(), ...routingAgents.flatMap(liveAllowanceDetails)];
    addEvidenceRow(body, 'measurement', t('5h / 7d allowance'), t('Current balances · current-project paired savings'),
      [...quotaSignals, ...liveSignals].length
        ? [...quotaSignals, ...liveSignals]
        : [{ value: t('No quota reading'), label: t('Open the details for the missing source and comparison steps') }],
      quotaSignals.length + liveSignals.length, allowanceSections);
    const quality = qualitySummary();
    addEvidenceRow(body, 'measurement', t('Task quality'), t('Current-project task checks'),
      [{ value: quality.value, label: quality.detail, tone: quality.cls }], current?.value?.quality?.pairs || 0, [
        evidenceSection(t('Quality checks'), [
          [t('Evaluated pairs'), count(current?.value?.quality?.pairs || 0)],
          [t('Regressions'), count(current?.value?.quality?.regressions || 0)],
        ], t('Quality comes from the actual checks recorded for both task variants. Token reductions and hook runs do not evaluate correctness.')),
        comparisonSection(),
      ]);

    for (const mismatch of current?.value?.qualityMismatches || []) {
      addEvidenceRow(body, 'measurement', t('Check disagreement · {id}', { id: mismatch.benchmarkId }), t('The direct check result takes precedence'),
        [{ value: t('Check overrides recorded quality'), label: mismatch.details.join('; '), tone: 'warn' }], 1, []);
    }
    for (const experiment of current?.value?.factorial || []) {
      const sections = [evidenceSection(t('Quality by arm'), Object.entries(experiment.quality || {}),
        t('Direct checks or manually recorded acceptance; all effects retain their quality gate.'))];
      for (const effect of experiment.effects || []) {
        const value = amount => (amount === null ? t('Not measured') : count(amount));
        sections.push(evidenceSection(dotted(effect.unit, effect.scope), [
          [t('Compression saving'), value(effect.compressionSaving)],
          [t('Routing saving'), value(effect.routingSaving)],
          [t('Combined saving'), value(effect.combinedSaving)],
          [t('Interaction cost'), value(effect.interactionCost)],
        ], t('Positive interaction cost means the combined run cost more than the single effects predict. Units and quota windows remain separate.')));
      }
      sections.push(evidenceSection(t('Evidence limits'), [], (experiment.reasons || []).join(' ')));
      if (experiment.qualityMismatches?.length)
        sections.push(evidenceSection(t('Check disagreements'), [], t('{ids}: the direct check overrides recorded quality.', { ids: experiment.qualityMismatches.join(', ') })));
      addEvidenceRow(body, 'measurement', t('Four-arm comparison · {id}', { id: experiment.benchmarkId }),
        t('Exploratory · configuration {evidence}', { evidence: experiment.configurationEvidence || t('declared by you') }),
        [{
          value: experiment.status,
          label: experiment.combinedQualityRegression ? t('Combined quality regressed; savings blocked') : t('Repeated controlled sets needed'),
          tone: experiment.combinedQualityRegression ? 'warn' : '',
        }], Object.keys(experiment.quality || {}).length, sections);
    }

    for (const agent of routingAgents) {
      const linked = current?.savings?.byHarness?.find(group => group.harnessId === agent.id)?.rows || [];
      const configured = configuredProviders().filter(component => component.configuredHarnesses?.includes(agent.id)).map(component => optimizerInfo(component.providerId).name);
      const sections = [evidenceSection(t('App attribution'), [[t('Detected setup'), configured.join(', ') || t('None')]],
        linked.length
          ? t('These are the same optimizer records shown above, scoped to this app. They are not additional savings.')
          : t('No app-scoped reducer amount is available for this period. Shared and aggregate totals stay under their optimizer.'))];
      sections.push(...linked.map(row => optimizerEvidenceDetail(row, true)));
      sections.push(routingDetails(agent), ...liveAllowanceDetails(agent));
      const signals = [...linked.map(row => optimizerSignal(row, true)), ...runtimeSignals(agent), ...liveAllowanceSignals(agent)];
      const paired = current?.value?.byHarness?.find(source => source.harnessId === agent.id);
      if (paired?.quality?.state === 'preserved') signals.push({ value: t('Quality preserved'), label: t('{n} evaluated pairs · this app', { n: count(paired.quality.pairs) }), tone: 'good' });
      if (paired?.quality?.state === 'regressed') signals.push({ value: t('Quality regression'), label: t('Savings claims need review'), tone: 'warn' });
      if (paired?.pairs) sections.push(evidenceSection(t('App comparisons'), [[t('Paired tasks'), count(paired.pairs)]], t('These comparisons identify {agent}; they are part of the current-project results above.', { agent: agent.name })));
      addEvidenceRow(body, 'harness', agent.name, agent.version ? 'v' + agent.version : t('Version unavailable'),
        signals.length ? signals : [{ value: t('No activity recorded'), label: t('Open the details for routing status and quota availability') }], signals.length, sections);
    }

    for (const item of current?.value?.candidates || []) {
      if (!(item.pairs > 0)) continue;
      const candidate = (current?.optimizationCandidates || []).find(entry => entry.id === item.candidateId);
      const name = candidate?.name || item.candidateId;
      addEvidenceRow(body, 'candidate', name, t('Experimental'), [{ value: t('{n} paired results', { n: count(item.pairs) }), label: t('Evaluation evidence') }], item.pairs, [
        evidenceSection(t('Paired evaluation'), [
          [t('Optimized better'), count(item.optimizedBetter || 0)],
          [t('Baseline better'), count(item.baselineBetter || 0)],
        ], t('Evaluation does not automatically promote or activate this optimizer.')),
      ]);
    }
    for (const details of body.querySelectorAll('details')) details.open = openKeys.has(details.dataset.key);
    applyEvidenceFilters();
  }

  function applyEvidenceFilters() {
    const body = $('result-evidence');
    if (!body || !$('evidence-filter')) return;
    const filter = $('evidence-filter').value.trim().toLocaleLowerCase();
    const type = $('evidence-type').value;
    const sort = $('evidence-sort').value;
    const rows = [...body.children].filter(row => row.dataset.type);
    const sourceOrder = { optimizer: 0, routing: 1, harness: 2, measurement: 3, candidate: 4 };
    rows.sort((a, b) => (sort === 'evidence'
      ? Number(Number(b.dataset.amount) > 0) - Number(Number(a.dataset.amount) > 0)
        || sourceOrder[a.dataset.type] - sourceOrder[b.dataset.type]
        || Number(b.dataset.amount) - Number(a.dataset.amount) || a.dataset.name.localeCompare(b.dataset.name)
      : sort === 'type'
        ? a.dataset.type.localeCompare(b.dataset.type) || a.dataset.name.localeCompare(b.dataset.name)
        : a.dataset.name.localeCompare(b.dataset.name)));
    for (const row of rows) {
      row.hidden = !((type === 'all' || row.dataset.type === type) && (!filter || row.dataset.search.includes(filter)));
      body.append(row);
    }
    const visible = rows.filter(row => !row.hidden).length;
    $('evidence-count').textContent = t('{visible} of {total} sources', { visible, total: rows.length });
    $('evidence-empty').hidden = visible > 0;
    $('evidence-reset').hidden = !filter && type === 'all';
  }

  function measurementHelp() {
    modal(t('How Token Harness measures results'));
    $('modal-content').append(
      messageBox(t('Tool output'), t('Local output reductions are shown only from recorded optimizer evidence. Different providers are never silently added together.')),
      messageBox(t('Setup and results'), t('App evidence includes attributed optimizer output, observed routing hook runs and current quota readings. RTK shared history stays unattributed; records from a Token Harness per-app hook database can identify their app. HarnessTrim records identify an app only when the telemetry names it. Setup alone does not establish attribution.')),
      messageBox(t('5h / 7d allowance'), t('Subscription-plan savings appear only when authoritative paired allowance evidence exists and quality is preserved.')),
      messageBox(t('API cost'), t('The dollar figure on Home is a labelled estimate from public list prices. Billed money is never presented as measured, and local output reduction is never turned into invented dollars or euros.')),
      messageBox(t('Quality'), t('Both task variants need recorded quality checks. A regression can block a positive savings claim.')),
      actionButton(t('Record a comparison'), () => measurementGuide(), 'secondary'),
    );
    $('modal-actions').append(modalClose(t('Done')));
  }

  function renderDetailsSummary() {
    const root = $('result-summary');
    if (!root) return;
    const allowance = allowanceSummary();
    const quality = qualitySummary();
    const savings = current?.savings?.rows || [];
    const reduction = bestReduction();
    root.replaceChildren(
      reduction
        ? metricCard(t('Recorded output'), impactHeadline(reduction), dotted(reduction.provider, measurementLabel(reduction.measurement), t('changed outputs only')), 'positive')
        : metricCard(t('Recorded output'),
          savings.length ? t('{n} measurement groups', { n: count(savings.length) }) : t('No records yet'),
          savings.length ? t('Open each source below for its unit and details.') : t('Use a connected app, then Refresh.')),
      metricCard(t('Allowance saved · 5h / 7d'), allowance.value, allowance.detail, allowance.cls),
      metricCard(t('Quality'), quality.value, quality.detail, quality.cls),
    );
  }

  function renderEvidencePeriodNote() {
    const note = $('results-period-note');
    if (!note) return;
    const savings = current?.savings;
    note.textContent = savings?.firstRecordedAt
      ? t('All locally recorded projects · {from} – {to}', {
        from: new Date(savings.firstRecordedAt).toLocaleDateString(locale()),
        to: new Date(savings.lastRecordedAt).toLocaleDateString(locale()),
      })
      : t('All locally recorded projects · no results for this period.');
    if (savings?.errors) note.textContent += ' · ' + t('{n} records could not be read', { n: count(savings.errors) });
  }

  function ruleDetails(agent) {
    const useful = (agent.rules || []).filter(rule =>
      rule.mode === 'observation' || rule.mode === 'advice' || rule.mode === 'not-enabled' || rule.action?.kind === 'help' || rule.action?.kind === 'skill');
    if (!useful.length) return null;
    const details = node('details', undefined, 'agent-details');
    details.append(node('summary', t('More agent checks')));
    for (const rule of useful) {
      const row = node('div', undefined, 'status-row');
      const copy = node('div');
      copy.append(node('strong', rule.title), node('p', dotted(rule.state, rule.what), 'caption'));
      row.append(copy);
      if (rule.action?.kind === 'help' || rule.action?.kind === 'skill')
        row.append(actionButton(rule.action.label, () => runAgentAction(rule.action), 'secondary'));
      details.append(row);
    }
    return details;
  }

  function renderDetailsAgents() {
    const root = $('details-agents');
    if (!root) return;
    root.replaceChildren();
    for (const agent of activeAgents()) {
      const card = node('article', undefined, 'tool-card compact');
      const head = node('div', undefined, 'tool-head');
      const title = node('div');
      title.append(node('h3', agent.name), node('span', t('Status without changing settings'), 'caption'));
      head.append(title, pill(agent.guidance?.label || t('Guidance not checked'), agent.guidance?.state === 'managed' || agent.guidance?.state === 'external' ? 'good' : ''));
      card.append(head);

      const facts = node('div', undefined, 'tool-facts');
      facts.append(node('span', t('In-session guidance')), node('strong', agent.guidance?.label || t('Not verified')));
      if (agent.allowance?.length) {
        for (const window of agent.allowance) {
          const value = Number.isFinite(window.remaining) ? t('{n}% left', { n: count(window.remaining) }) : t('unknown');
          facts.append(node('span', window.label), node('strong', value));
        }
      } else {
        facts.append(node('span', t('Plan allowance')), node('strong', t('Not available')));
      }
      card.append(facts);

      const actions = node('div', undefined, 'inline-actions');
      if (agent.guidance?.action)
        actions.append(actionButton(agent.guidance.action.label, () => runAgentAction(agent.guidance.action), 'secondary'));
      if (!agent.allowance?.length && agent.allowanceAction?.kind === 'help')
        actions.append(actionButton(agent.allowanceAction.label, () => runAgentAction(agent.allowanceAction), 'secondary'));
      if (actions.children.length) card.append(actions);
      if (agent.allowanceNote) card.append(node('p', agent.allowanceNote, 'caption'));
      const more = ruleDetails(agent);
      if (more) card.append(more);
      root.append(card);
    }
    if (!root.children.length) root.append(sectionEmpty(t('Agent details appear after a supported coding agent is detected.')));
  }

  function maintenanceRow(title, text, button) {
    const row = node('article', undefined, 'maintenance-row');
    const copy = node('div');
    copy.append(node('strong', title), node('p', text, 'caption'));
    row.append(copy, button);
    return row;
  }

  function renderMaintenance() {
    const root = $('details-maintenance');
    if (!root) return;
    root.replaceChildren();
    const attention = current?.stack?.state === 'attention';

    if (configuredProviders().length)
      root.append(maintenanceRow(
        t('Optimizer health'),
        attention
          ? t('Something changed or could not be verified. Re-check the configured integrations for details.')
          : t('Re-check integrations after external changes or when troubleshooting.'),
        actionButton(attention ? t('Check now') : t('Re-check health'), () => readOnlyOperation('verify'), 'secondary'),
      ));

    const available = (current?.stack?.components || []).filter(component => component.update === 'available');
    root.append(maintenanceRow(
      t('Token Harness and optimizer updates'),
      available.length
        ? available.map(component => t('{name} has an update ready.', { name: optimizerInfo(component.providerId).name })).join(' ')
        : t('Check available versions and review updates before installing.'),
      actionButton(available.length ? t('Review updates') : t('Check for updates'), () => readOnlyOperation('updates'), available.length ? '' : 'secondary'),
    ));

    if (activityState?.canUndo)
      root.append(maintenanceRow(
        t('Undo last change'),
        t('Review and restore the exact last configuration transaction from this app session.'),
        actionButton(t('Review undo'), () => undoLastChange(), 'secondary'),
      ));

    root.append(maintenanceRow(
      t('Temporary benchmark configuration'),
      t('Review recovery of an unfinished prepared benchmark after reopening the app.'),
      actionButton(t('Review benchmark recovery'), openBenchmarkRecovery, 'secondary'),
    ));
  }

  function renderActivity() {
    const root = $('activity');
    if (!root) return;
    root.replaceChildren();
    const rows = [...(activityState?.activity || [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    if (!rows.length) {
      root.append(sectionEmpty(t('No checks or changes have been recorded in this app session.')));
      return;
    }
    const visible = rows.slice(0, 8);
    for (const item of visible) {
      const row = node('div', undefined, 'activity-row');
      row.append(
        pill(item.state === 'success' ? t('Done') : item.state === 'attention' ? t('Attention') : t('Working'), item.state === 'success' ? 'good' : item.state === 'attention' ? 'warn' : ''),
        node('span', item.message),
        node('time', date(item.at), 'caption'),
      );
      root.append(row);
    }
    if (rows.length > visible.length) root.prepend(node('p', t('Showing the latest {shown} of {total} entries.', { shown: visible.length, total: rows.length }), 'caption'));
  }

  function renderOperations(history) {
    const root = $('operations');
    if (!root) return;
    root.replaceChildren();
    $('operations-note').textContent = history.note;
    for (const item of history.operations || []) {
      const row = node('article', undefined, 'maintenance-row');
      const detail = node('div');
      const outcome = item.outcome === 'committed' ? t('Applied')
        : item.outcome === 'rolled-back' ? t('Restored')
          : item.outcome === 'dirty' ? t('Recovery needed')
            : item.outcome === 'in-progress' ? t('Unfinished') : t('Unknown operation');
      detail.append(node('strong', outcome), node('p', item.actions.join(', ')), node('p', dotted(date(item.startedAt), paths(item.files)), 'caption'));
      row.append(detail);
      if (item.canRestore) row.append(actionButton(t('Review restore'), () => undoLastChange('restore-latest'), 'secondary'));
      root.append(row);
    }
    if (!history.operations?.length) root.append(sectionEmpty(history.state === 'ready'
      ? t('No retained operations for this project. Manually configured integrations do not create Token Harness transactions.')
      : t('History is unavailable. No recovery target was selected.')));
  }

  async function loadOperations() {
    const run = ++operationsRun;
    const root = $('operations');
    if (!root) return;
    $('operations-note').textContent = t('Reading retained change history…');
    root.replaceChildren(sectionEmpty(t('Reading changes…')));
    try {
      const history = await request('/api/operations');
      if (run !== operationsRun) return;
      operationsHistory = history;
      renderOperations(history);
    } catch (error) {
      if (run !== operationsRun) return;
      operationsHistory = null;
      $('operations-note').textContent = error.message || t('Change history could not be read. Choose Refresh history to retry.');
      root.replaceChildren(sectionEmpty(t('History is unavailable. No recovery target was selected.')));
    }
  }

  async function loadActivity() {
    try {
      activityState = await request('/api/activity');
      renderActivity();
      renderMaintenance();
      if (!current) renderLoading();
      else if (reading && activityState?.loading?.running && Array.isArray(activityState.loading.stages)) {
        const stages = activityState.loading.stages;
        const done = stages.filter(stage => stage.state !== 'working').length;
        const working = stages.filter(stage => stage.state === 'working').slice(0, 2).map(stage => String(stage.label).toLowerCase());
        const base = t('{done}/{total} checks finished', { done, total: stages.length });
        setStatus(working.length ? base + ' · ' + working.join(' · ') : base, true);
      }
    } catch {
      // Activity is supplementary and must never hide the main dashboard.
    }
  }

  function detailsSection(title, caption, ...content) {
    const section = node('section', undefined, 'details-section');
    const head = node('div', undefined, 'section-title');
    const copy = node('div');
    copy.append(node('h2', title), node('p', caption, 'caption'));
    head.append(copy);
    section.append(head, ...content);
    return section;
  }

  function buildDetailsSkeleton(root) {
    const previous = {
      filter: $('evidence-filter') ? $('evidence-filter').value : '',
      type: $('evidence-type') ? $('evidence-type').value : 'all',
      sort: $('evidence-sort') ? $('evidence-sort').value : 'evidence',
    };
    root.replaceChildren();

    const toolbar = node('div', undefined, 'filter-row');
    for (const [label, handler] of [
      [t('Record a comparison'), () => openComparisons()],
      [t('Comparison guide'), () => measurementGuide()],
      [t('How results are measured'), () => measurementHelp()],
    ]) toolbar.append(actionButton(label, handler, 'secondary'));

    const summary = node('div', undefined, 'impact-grid');
    summary.id = 'result-summary';
    summary.setAttribute('aria-label', t('Results overview'));

    const search = node('input');
    search.type = 'search';
    search.placeholder = t('Search sources, apps or measurements');
    search.autocomplete = 'off';
    search.value = previous.filter;
    const type = node('select');
    for (const [value, label] of [
      ['all', t('All sources')], ['optimizer', t('Optimizers')], ['routing', t('Routing')],
      ['harness', t('Coding apps')], ['measurement', t('Measurements')], ['candidate', t('Experiments')],
    ]) {
      const option = node('option', label);
      option.value = value;
      type.append(option);
    }
    type.value = previous.type;
    const sort = node('select');
    for (const [value, label] of [['evidence', t('With results first')], ['name', t('Name')], ['type', t('Source type')]]) {
      const option = node('option', label);
      option.value = value;
      sort.append(option);
    }
    sort.value = previous.sort;
    const controls = node('div', undefined, 'evidence-controls');
    const searchField = labelledField(t('Search evidence'), search, 'evidence-filter');
    searchField.className = 'evidence-field evidence-search';
    controls.append(searchField, labelledField(t('Source type'), type, 'evidence-type'), labelledField(t('Sort by'), sort, 'evidence-sort'));

    const meta = node('div', undefined, 'evidence-list-meta');
    const countLine = node('p', undefined, 'caption');
    countLine.id = 'evidence-count';
    countLine.setAttribute('role', 'status');
    const reset = node('button', t('Clear filters'), 'text-button');
    reset.id = 'evidence-reset';
    reset.type = 'button';
    reset.hidden = true;
    meta.append(countLine, reset);

    const list = node('ul', undefined, 'result-evidence');
    list.id = 'result-evidence';
    list.setAttribute('aria-label', t('Evidence by source'));
    const empty = node('div', undefined, 'evidence-empty');
    empty.id = 'evidence-empty';
    empty.hidden = true;
    empty.append(node('strong', t('No matching sources')), node('p', t('Try a different search or clear the filters.')));
    const periodNote = node('p', undefined, 'caption');
    periodNote.id = 'results-period-note';

    const panel = node('section', undefined, 'panel evidence-panel');
    panel.append(controls, meta, list, empty);

    const agents = node('div', undefined, 'tool-grid');
    agents.id = 'details-agents';
    const maintenance = node('div', undefined, 'maintenance-list');
    maintenance.id = 'details-maintenance';

    const operationsNote = node('p', t('History loads when you open Details.'), 'caption');
    operationsNote.id = 'operations-note';
    operationsNote.setAttribute('role', 'status');
    const operations = node('div', undefined, 'activity-scroll');
    operations.id = 'operations';
    const refreshHistory = actionButton(t('Refresh history'), () => { if (!busy) loadOperations(); }, 'secondary');
    const historyPanel = node('section', undefined, 'panel');
    historyPanel.setAttribute('aria-label', t('Change history'));
    historyPanel.append(operationsNote, operations);

    const activity = node('div', undefined, 'activity-scroll');
    activity.id = 'activity';
    const activityPanel = node('section', undefined, 'panel');
    activityPanel.append(activity);

    root.append(
      detailsSection(t('Evidence'), t('Every number keeps its source and how it was measured.'), toolbar, summary, panel, periodNote),
      detailsSection(t('Coding agents'), t('What each agent reports, without changing any settings.'), agents),
      detailsSection(t('Checks and maintenance'), t('Re-check health, look for updates and undo changes.'), maintenance),
      detailsSection(t('Change history'), t('Changes Token Harness made to this project, kept across sessions.'), historyPanel, refreshHistory),
      detailsSection(t('Recent activity'), t('Latest checks and changes from this app session.'), activityPanel),
    );

    search.addEventListener('input', applyEvidenceFilters);
    type.addEventListener('change', applyEvidenceFilters);
    sort.addEventListener('change', applyEvidenceFilters);
    reset.addEventListener('click', () => {
      search.value = '';
      type.value = 'all';
      applyEvidenceFilters();
      search.focus();
    });
    detailsLang = lang;
    if (operationsHistory) renderOperations(operationsHistory);
  }

  function renderDetails() {
    const root = $('details-root');
    if (!root) return;
    if (!$('result-evidence') || detailsLang !== lang) buildDetailsSkeleton(root);
    renderDetailsSummary();
    renderEvidence();
    renderEvidencePeriodNote();
    renderDetailsAgents();
    renderMaintenance();
    renderActivity();
  }
`;

export const GUIDE_DETAILS_IT: Readonly<Record<string, string>> = {
  Routing: 'Instradamento',
  Details: 'Dettagli',
  After: 'Dopo',
  Available: 'Disponibile',
  unknown: 'sconosciuto',
  Name: 'Nome',
  passed: 'superato',
  failed: 'fallito',
  Measurement: 'Misurazione',
  Experiment: 'Esperimento',
  'Benchmark evidence could not be read. Refresh to retry.':
    'Non è stato possibile leggere le prove del benchmark. Aggiorna per riprovare.',
  '{n} comparison(s) are unfinished. Finish both task variants, then Refresh.':
    '{n} confronti non sono finiti. Completa entrambe le varianti del compito, poi scegli Aggiorna.',
  '{n} comparison(s) could not be validated. Capture a new matched pair.':
    'Non è stato possibile convalidare {n} confronti. Registra una nuova coppia equivalente.',
  'Task checks are missing or failed for the recorded comparisons. Record the actual quality outcome for both runs.':
    'Per i confronti registrati mancano i controlli del compito o sono falliti. Registra il vero esito di qualità per entrambe le esecuzioni.',
  'Recorded comparisons lack authoritative quota readings in matching windows. Live balances alone do not measure savings.':
    'Nei confronti registrati mancano letture affidabili della quota nelle finestre corrispondenti. I saldi attuali da soli non misurano il risparmio.',
  'No baseline/optimized task comparison for this project.':
    'Nessun confronto tra compito di base e ottimizzato per questo progetto.',
  'Comparisons recorded in other projects are outside this view.':
    'I confronti registrati in altri progetti non compaiono in questa vista.',
  'Use Record a comparison to capture usage and quality checks.':
    'Usa Registra un confronto per raccogliere consumi e controlli di qualità.',
  'Regression detected': 'Regressione rilevata',
  'Savings claims are blocked until quality is recovered.':
    'Le dichiarazioni di risparmio restano bloccate finché la qualità non viene ripristinata.',
  Preserved: 'Mantenuta',
  '{n} paired benchmark(s) support this result.':
    'Questo risultato è supportato da {n} benchmark in coppia.',
  'Evidence unavailable': 'Prove non disponibili',
  'Comparison needed': 'Serve un confronto',
  'Not credited': 'Non conteggiato',
  '{label} · quality gate did not pass': '{label} · il controllo di qualità non è stato superato',
  '{n} percentage points more used': '{n} punti percentuali in più usati',
  '{n} percentage points saved': '{n} punti percentuali risparmiati',
  '{n} percentage points net change': '{n} punti percentuali di variazione netta',
  'A quota reduction exists, but quality evidence does not yet allow it to be credited.':
    'Esiste una riduzione della quota, ma le prove di qualità non permettono ancora di conteggiarla.',
  'Paired readings': 'Letture in coppia',
  'Current quota is being read; savings need a comparison.':
    'La quota attuale viene letta; per il risparmio serve un confronto.',
  '{n} {unit} added': '{n} {unit} in più',
  '{n} {unit} saved': '{n} {unit} risparmiati',
  '{n} {unit} net change': '{n} {unit} di variazione netta',
  'Not recorded': 'Non registrato',
  'A comparable before/after pair is needed to report a percentage.':
    'Per indicare una percentuale serve una coppia confrontabile prima/dopo.',
  Before: 'Prima',
  Added: 'Aggiunto',
  'Changed outputs': 'Output modificati',
  'Recorded app': 'App registrata',
  'Not attributed': 'Non attribuito',
  'These records do not identify which coding app ran the command.':
    'Questi record non indicano quale app di sviluppo ha eseguito il comando.',
  'Action required: open /hooks in Codex and trust this hook, then submit a prompt.':
    'Azione richiesta: apri /hooks in Codex, approva questo hook e poi invia un prompt.',
  'Hooks are turned off for this coding app. Recorded hook runs describe earlier activity.':
    'Gli hook sono disattivati per questa app di sviluppo. Le esecuzioni registrate descrivono attività precedenti.',
  'Automatic routing is not enabled. Recorded hook runs describe earlier activity.':
    "L'instradamento automatico non è attivo. Le esecuzioni dell'hook registrate descrivono attività precedenti.",
  'A real hook run was observed. Subagent starts prove delegation; savings require a comparison.':
    "È stata osservata un'esecuzione reale dell'hook. L'avvio dei subagenti prova la delega; per il risparmio serve un confronto.",
  'Authorization is unknown; check the hook status in the coding app.':
    "L'autorizzazione non è nota; controlla lo stato dell'hook nell'app di sviluppo.",
  'Configured; waiting for the first hook run after a prompt.':
    "Configurato; in attesa della prima esecuzione dell'hook dopo un prompt.",
  'Routing is managed elsewhere; Token Harness leaves it unchanged.':
    "L'instradamento è gestito altrove; Token Harness lo lascia invariato.",
  'Automatic routing is not enabled for this coding app.':
    "L'instradamento automatico non è attivo per questa app di sviluppo.",
  Verification: 'Verifica',
  'Hook run observed': 'Esecuzione hook osservata',
  'Configuration only': 'Solo configurazione',
  'Not verified': 'Non verificato',
  'Prompt hook runs': 'Esecuzioni hook sui prompt',
  'Subagents started': 'Subagenti avviati',
  'Subagents stopped': 'Subagenti fermati',
  'Reported models': 'Modelli riportati',
  'Last hook run': 'Ultima esecuzione hook',
  '{agent} · routing activity': '{agent} · attività di instradamento',
  '{agent} · observed routing activity': '{agent} · attività di instradamento osservata',
  '{n} prompt hook runs': '{n} esecuzioni hook sui prompt',
  '{n} subagents started': '{n} subagenti avviati',
  '{n} subagents stopped': '{n} subagenti fermati',
  '{n}% remaining': '{n}% rimasto',
  '{agent} · {window} · current balance': '{agent} · {window} · saldo attuale',
  Remaining: 'Rimanente',
  Unavailable: 'Non disponibile',
  Source: 'Fonte',
  Reset: 'Azzeramento',
  'Read at': 'Letto alle',
  'Current balance observation; this is not a saved allowance percentage.':
    'Osservazione del saldo attuale; non è una percentuale di quota risparmiata.',
  '{agent} · current allowance': '{agent} · quota attuale',
  'Reading current allowance…': 'Leggo la quota attuale…',
  'No readable allowance source is available. This does not mean a zero balance.':
    "Non c'è una fonte leggibile per la quota. Non significa che il saldo sia zero.",
  'Refresh readings': 'Aggiorna le letture',
  'Current-project comparisons': 'Confronti del progetto attuale',
  'Evidence read': 'Lettura delle prove',
  'Complete pairs': 'Coppie complete',
  'Unfinished pairs': 'Coppie non terminate',
  'Invalid pairs': 'Coppie non valide',
  'Comparisons cover the project where Token Harness was opened. They are independent of the output-history period filter.':
    'I confronti riguardano il progetto in cui è stato aperto Token Harness. Non dipendono dal filtro del periodo dello storico degli output.',
  'Record a comparison': 'Registra un confronto',
  'Temporary configuration needs completion or recovery':
    'La configurazione temporanea va completata o ripristinata',
  'Prepared arm: {id} / {variant}. Finish this arm or restore it before another managed change.':
    "Variante preparata: {id} / {variant}. Completa questa variante o ripristinala prima di un'altra modifica gestita.",
  'The configuration lease is unreadable. Preserve the checkpoint and backups and inspect local state.':
    'Il blocco della configurazione non è leggibile. Conserva il checkpoint e i backup e controlla lo stato locale.',
  'Review benchmark recovery': 'Controlla il recupero del benchmark',
  'Record a baseline/optimized comparison': 'Registra un confronto base/ottimizzato',
  'Coding app needed': "Serve un'app di sviluppo",
  'Open Methods and expose Codex or Claude Code before recording a comparison.':
    'Apri Metodi e rendi disponibile Codex o Claude Code prima di registrare un confronto.',
  'Coding app for both comparison runs': 'App di sviluppo per entrambe le esecuzioni del confronto',
  'Comparison design': 'Schema del confronto',
  'Baseline / optimized': 'Base / ottimizzato',
  'Four arms: compression and routing': 'Quattro varianti: compressione e instradamento',
  'Optional quality check': 'Controllo di qualità facoltativo',
  'Optional quality check (executable and arguments)':
    'Controllo di qualità facoltativo (eseguibile e argomenti)',
  'Leave empty to record your checks manually. Commands below use Bash or PowerShell quoting.':
    'Lascia vuoto per registrare i controlli a mano. I comandi qui sotto usano le virgolette di Bash o PowerShell.',
  'Same starting state': 'Stesso stato di partenza',
  'Initial Git commit or fixture id': 'Commit Git iniziale o id della fixture',
  'Same starting state for all four arms':
    'Stesso stato di partenza per tutte e quattro le varianti',
  'Check needs an executable and arguments':
    'Il controllo richiede un eseguibile e degli argomenti',
  'Enter a JSON array such as ["npm","run","verify"]. If an argument contains an apostrophe, use the CLI and quote it for your shell.':
    'Inserisci un array JSON come ["npm","run","verify"]. Se un argomento contiene un apostrofo, usa la CLI e scrivilo con le virgolette adatte alla tua shell.',
  'Starting state needed': 'Serve lo stato di partenza',
  'Enter the initial Git commit or fixture id. Restore that same starting tree before every arm.':
    "Inserisci il commit Git iniziale o l'id della fixture. Ripristina lo stesso albero di partenza prima di ogni variante.",
  'Exploratory four-arm comparison': 'Confronto esplorativo a quattro varianti',
  'Preview each temporary configuration with benchmark-prepare, then repeat that command with --yes. Finish restores the original configuration. Restore the same starting tree and start a fresh coding session before every task. Setup must already support owned RTK/HarnessTrim changes. Configuration checks are config-only; routing arms need real hook runs.':
    "Controlla in anteprima ogni configurazione temporanea con benchmark-prepare, poi ripeti il comando con --yes. Il termine ripristina la configurazione originale. Ripristina lo stesso albero di partenza e avvia una nuova sessione di sviluppo prima di ogni compito. La configurazione deve già supportare le modifiche gestite di RTK/HarnessTrim. I controlli di configurazione verificano solo la configurazione; le varianti con instradamento richiedono esecuzioni reali dell'hook.",
  'Compression off · routing off': 'Compressione spenta · instradamento spento',
  'Compression on · routing off': 'Compressione attiva · instradamento spento',
  'Compression off · routing on': 'Compressione spenta · instradamento attivo',
  'Compression on · routing on': 'Compressione attiva · instradamento attivo',
  'Run the same task. Review the saved check before running the finish command.':
    'Esegui lo stesso compito. Controlla il controllo salvato prima di lanciare il comando finale.',
  'Run the same task. Run the same acceptance checks and record their result.':
    'Esegui lo stesso compito. Esegui gli stessi controlli di accettazione e registrane il risultato.',
  'If the task is cancelled or the process is interrupted, preview recovery, then add --yes:':
    'Se il compito viene annullato o il processo si interrompe, controlla in anteprima il ripristino, poi aggiungi --yes:',
  'Run from the same project where this app was opened, then choose Refresh. Repeat controlled four-arm sets before drawing conclusions.':
    'Esegui dallo stesso progetto in cui è stata aperta questa app, poi scegli Aggiorna. Ripeti più serie controllate a quattro varianti prima di trarre conclusioni.',
  '1. Prepare the baseline': '1. Prepara la base',
  'Use the same representative task, starting state, coding app and checks for both runs. For a routing comparison, turn routing off in Methods before starting the baseline. Start a fresh coding session after changing hooks.':
    "Usa lo stesso compito rappresentativo, lo stesso stato di partenza, la stessa app di sviluppo e gli stessi controlli per entrambe le esecuzioni. Per un confronto sull'instradamento, spegni l'instradamento in Metodi prima di avviare la base. Avvia una nuova sessione dopo aver cambiato gli hook.",
  '2. Run the task and check its result': '2. Esegui il compito e controlla il risultato',
  'Run the baseline task in the coding app, then run its tests or acceptance checks. Replace the placeholders below with the actual result and attempt counts; passed means the checks succeeded.':
    "Esegui il compito di base nell'app di sviluppo, poi lancia i test o i controlli di accettazione. Sostituisci i segnaposto qui sotto con il risultato reale e il numero di tentativi; superato significa che i controlli sono andati a buon fine.",
  '3. Repeat with optimization enabled': "3. Ripeti con l'ottimizzazione attiva",
  'Restore the same starting state. Turn on the optimization under evaluation in Methods. For routing, trust the hook in Codex /hooks and start a fresh session; the optimized task must actually start a native subagent.':
    "Ripristina lo stesso stato di partenza. Attiva in Metodi l'ottimizzazione da valutare. Per l'instradamento, approva l'hook in Codex con /hooks e avvia una nuova sessione; il compito ottimizzato deve davvero avviare un subagente nativo.",
  'Run the same task and checks, then record the actual optimized outcome.':
    "Esegui lo stesso compito e gli stessi controlli, poi registra l'esito reale dell'esecuzione ottimizzata.",
  '4. Refresh Details': '4. Aggiorna i Dettagli',
  'Run the capture commands from the same project where this app was opened. Start/finish read quota, local session usage and routing records automatically; quality comes from the saved direct check, or from your recorded checks when no command is set. If a quota window resets during a run or the source is unavailable, that window stays unmeasured. Repeat representative pairs before drawing conclusions.':
    "Esegui i comandi di registrazione dallo stesso progetto in cui è stata aperta questa app. Avvio e fine leggono da soli quota, consumi della sessione locale e record di instradamento; la qualità deriva dal controllo diretto salvato o, se non c'è un comando, dai controlli che hai registrato. Se una finestra di quota si azzera durante l'esecuzione o la fonte non è disponibile, quella finestra resta non misurata. Ripeti coppie rappresentative prima di trarre conclusioni.",
  'Why a comparison is needed': 'Perché serve un confronto',
  'Normal usage records optimizer output and routing activity. Demonstrated savings require comparable baseline and optimized tasks; Token Harness cannot reconstruct an unrecorded baseline or decide whether your task passed its checks.':
    "L'uso normale registra l'output degli ottimizzatori e l'attività di instradamento. Per dimostrare un risparmio servono compiti di base e ottimizzati confrontabili; Token Harness non può ricostruire una base non registrata né stabilire se il tuo compito ha superato i controlli.",
  'Review comparison step': 'Controlla il passaggio del confronto',
  'Preparing the measurement preview': "Preparo l'anteprima della misurazione",
  'No evidence is recorded until you approve this step.':
    'Nessuna prova viene registrata finché non approvi questo passaggio.',
  'Record reviewed step': 'Registra il passaggio controllato',
  'Record checks and attempts': 'Registra controlli e tentativi',
  'Your recorded checks': 'I controlli che hai registrato',
  'Run the same tests or acceptance checks yourself before choosing an outcome. Token Harness does not execute a check or infer quality from the assistant response. Failed outcomes are retained.':
    "Esegui tu stesso gli stessi test o controlli di accettazione prima di scegliere un esito. Token Harness non esegue controlli e non deduce la qualità dalla risposta dell'assistente. Gli esiti negativi vengono conservati.",
  'Choose the actual outcome': "Scegli l'esito reale",
  'Checks passed': 'Controlli superati',
  'Checks failed': 'Controlli falliti',
  'Check outcome (recorded by you)': 'Esito dei controlli (registrato da te)',
  'Total coding attempts': 'Tentativi di sviluppo totali',
  'Failed coding attempts': 'Tentativi di sviluppo falliti',
  'Choose an outcome and enter the actual attempt counts. Passed needs at least one successful attempt.':
    'Scegli un esito e inserisci il numero reale di tentativi. Per "superato" serve almeno un tentativo riuscito.',
  'Review recorded outcome': "Controlla l'esito registrato",
  'Prepare the optimized run': "Prepara l'esecuzione ottimizzata",
  'Repeat the same task': 'Ripeti lo stesso compito',
  'Restore the same starting tree and acceptance checks. Turn on the optimization under evaluation in Methods, then start a fresh coding session when hooks change. This acknowledgement does not prove provider execution, child models or savings.':
    "Ripristina lo stesso albero di partenza e gli stessi controlli di accettazione. Attiva in Metodi l'ottimizzazione da valutare, poi avvia una nuova sessione se gli hook cambiano. Questa conferma non prova l'esecuzione del provider, i modelli figli o i risparmi.",
  'I restored the same task/tree/checks and turned on the optimization to evaluate.':
    "Ho ripristinato lo stesso compito, albero e controlli e ho attivato l'ottimizzazione da valutare.",
  'Review optimized capture': 'Controlla la registrazione ottimizzata',
  'Record a paired comparison': 'Registra un confronto in coppia',
  'Reading retained comparisons': 'Leggo i confronti conservati',
  'Measurements for the project where this app was opened.':
    'Misurazioni per il progetto in cui è stata aperta questa app.',
  'Baseline → task and checks → optimized → task and checks':
    'Base → compito e controlli → ottimizzato → compito e controlli',
  Mechanical: 'Meccanico',
  Standard: 'Standard',
  Hard: 'Difficile',
  Critical: 'Critico',
  'Start a new baseline': 'Avvia una nuova base',
  'Coding app for both runs': 'App di sviluppo per entrambe le esecuzioni',
  'Task class for both runs': 'Tipo di compito per entrambe le esecuzioni',
  'Run one comparison at a time. Starting records observations; run the coding task yourself, including from Harness Remote, then return to finish it.':
    "Esegui un confronto alla volta. L'avvio registra delle osservazioni; esegui tu il compito di sviluppo, anche da Harness Remote, poi torna qui per terminarlo.",
  'Review new baseline': 'Controlla la nuova base',
  'Expose a supported coding app in Methods before starting a comparison.':
    "Rendi disponibile in Metodi un'app di sviluppo supportata prima di avviare un confronto.",
  '1 / 4 · Baseline capture started': '1 / 4 · Registrazione della base avviata',
  '2 / 4 · Baseline outcome recorded': '2 / 4 · Esito della base registrato',
  '3 / 4 · Optimized capture started': '3 / 4 · Registrazione ottimizzata avviata',
  '4 / 4 · Pair complete': '4 / 4 · Coppia completa',
  'Retained evidence needs inspection': 'Le prove conservate vanno controllate',
  'Comparison state unavailable': 'Stato del confronto non disponibile',
  'Baseline checks: {outcome} (recorded by you).':
    'Controlli della base: {outcome} (registrato da te).',
  'Optimized checks: {outcome} (recorded by you). Inspect Details for comparable measurements and missing evidence.':
    'Controlli ottimizzati: {outcome} (registrato da te). Guarda i Dettagli per le misurazioni confrontabili e le prove mancanti.',
  'Prepare optimized run': "Prepara l'esecuzione ottimizzata",
  'Record baseline outcome': "Registra l'esito della base",
  'Record optimized outcome': "Registra l'esito ottimizzato",
  'No supported app comparisons are available for the current project. Advanced CLI comparisons remain visible in Details.':
    'Per il progetto attuale non ci sono confronti con app supportate. I confronti avanzati da CLI restano visibili nei Dettagli.',
  'Refresh comparisons': 'Aggiorna i confronti',
  'Advanced comparison guide': 'Guida avanzata al confronto',
  'Setup: {apps}': 'Configurazione: {apps}',
  'No setup detected': 'Nessuna configurazione rilevata',
  'No output recorded for this period': 'Nessun output registrato in questo periodo',
  'Start recording results': 'Inizia a registrare i risultati',
  'Use a connected coding app normally, then Refresh. Detected setup alone does not prove that the optimizer ran.':
    "Usa normalmente un'app di sviluppo collegata, poi scegli Aggiorna. La sola configurazione rilevata non prova che l'ottimizzatore sia stato eseguito.",
  'Review this optimizer in Methods to see available connections.':
    'Guarda questo ottimizzatore in Metodi per vedere i collegamenti disponibili.',
  'Open Methods': 'Apri Metodi',
  'Quality gate did not pass': 'Il controllo di qualità non è stato superato',
  '{n} tokens added': '{n} token in più',
  '{n} tokens saved': '{n} token risparmiati',
  'Paired end-to-end local usage': 'Consumo locale completo in coppia',
  '5h allowance': 'Quota 5h',
  '7d allowance': 'Quota 7g',
  'paired evidence': 'prove in coppia',
  'Savings comparison needed': 'Serve un confronto per il risparmio',
  'Quality passed; comparable usage is missing': 'Qualità superata; mancano consumi confrontabili',
  'Activity is recorded automatically; savings need paired runs':
    "L'attività viene registrata in automatico; per il risparmio servono esecuzioni in coppia",
  'No runtime activity yet': 'Ancora nessuna attività reale',
  'Check the hook status under Coding agents': "Controlla lo stato dell'hook in Agenti di sviluppo",
  'Savings verification': 'Verifica dei risparmi',
  'Quality-passed pairs': 'Coppie con qualità superata',
  'A quality regression blocks the savings claim.':
    'Una regressione di qualità blocca la dichiarazione di risparmio.',
  'Hook runs prove the hook ran. Savings require paired runs with a passing quality gate.':
    "Le esecuzioni dell'hook provano che l'hook è partito. Per il risparmio servono esecuzioni in coppia con il controllo di qualità superato.",
  'Automatic prompt routing': 'Instradamento automatico dei prompt',
  'Recorded hook runs across projects': 'Esecuzioni hook registrate in tutti i progetti',
  'No coding app detected': 'Nessuna app di sviluppo rilevata',
  'paired allowance': 'quota in coppia',
  'Allowance savings': 'Risparmio di quota',
  '5h / 7d allowance': 'Quota 5h / 7g',
  'Current balances · current-project paired savings':
    'Saldi attuali · risparmi in coppia del progetto attuale',
  'No quota reading': 'Nessuna lettura della quota',
  'Open the details for the missing source and comparison steps':
    'Apri i dettagli per vedere la fonte mancante e i passaggi del confronto',
  'Task quality': 'Qualità del compito',
  'Current-project task checks': 'Controlli dei compiti del progetto attuale',
  'Quality checks': 'Controlli di qualità',
  'Evaluated pairs': 'Coppie valutate',
  Regressions: 'Regressioni',
  'Quality comes from the actual checks recorded for both task variants. Token reductions and hook runs do not evaluate correctness.':
    'La qualità deriva dai controlli reali registrati per entrambe le varianti del compito. Le riduzioni di token e le esecuzioni degli hook non valutano la correttezza.',
  'Check disagreement · {id}': 'Controlli discordanti · {id}',
  'The direct check result takes precedence': 'Prevale il risultato del controllo diretto',
  'Check overrides recorded quality': 'Il controllo prevale sulla qualità registrata',
  'Quality by arm': 'Qualità per variante',
  'Direct checks or manually recorded acceptance; all effects retain their quality gate.':
    'Controlli diretti o accettazione registrata a mano; ogni effetto mantiene il proprio controllo di qualità.',
  'Not measured': 'Non misurato',
  'Compression saving': 'Risparmio da compressione',
  'Routing saving': 'Risparmio da instradamento',
  'Combined saving': 'Risparmio combinato',
  'Interaction cost': 'Costo di interazione',
  'Positive interaction cost means the combined run cost more than the single effects predict. Units and quota windows remain separate.':
    "Un costo di interazione positivo significa che l'esecuzione combinata è costata più di quanto prevedano i singoli effetti. Unità e finestre di quota restano separate.",
  'Evidence limits': 'Limiti delle prove',
  'Check disagreements': 'Controlli discordanti',
  '{ids}: the direct check overrides recorded quality.':
    '{ids}: il controllo diretto prevale sulla qualità registrata.',
  'Four-arm comparison · {id}': 'Confronto a quattro varianti · {id}',
  'Exploratory · configuration {evidence}': 'Esplorativo · configurazione {evidence}',
  'declared by you': 'dichiarata da te',
  'Combined quality regressed; savings blocked':
    'La qualità combinata è peggiorata; risparmi bloccati',
  'Repeated controlled sets needed': 'Servono più serie controllate',
  'App attribution': "Attribuzione all'app",
  'Detected setup': 'Configurazione rilevata',
  None: 'Nessuna',
  'These are the same optimizer records shown above, scoped to this app. They are not additional savings.':
    "Sono gli stessi record dell'ottimizzatore mostrati sopra, limitati a questa app. Non sono risparmi aggiuntivi.",
  'No app-scoped reducer amount is available for this period. Shared and aggregate totals stay under their optimizer.':
    "Per questo periodo non c'è un valore del riduttore riferito all'app. I totali condivisi e aggregati restano sotto il rispettivo ottimizzatore.",
  'Quality preserved': 'Qualità mantenuta',
  '{n} evaluated pairs · this app': '{n} coppie valutate · questa app',
  'Quality regression': 'Regressione di qualità',
  'Savings claims need review': 'Le dichiarazioni di risparmio vanno riviste',
  'App comparisons': "Confronti dell'app",
  'Paired tasks': 'Compiti in coppia',
  'These comparisons identify {agent}; they are part of the current-project results above.':
    'Questi confronti indicano {agent}; fanno parte dei risultati del progetto attuale qui sopra.',
  'Version unavailable': 'Versione non disponibile',
  'No activity recorded': 'Nessuna attività registrata',
  'Open the details for routing status and quota availability':
    "Apri i dettagli per lo stato dell'instradamento e la disponibilità della quota",
  Experimental: 'Sperimentale',
  '{n} paired results': '{n} risultati in coppia',
  'Evaluation evidence': 'Prove di valutazione',
  'Paired evaluation': 'Valutazione in coppia',
  'Optimized better': 'Ottimizzato migliore',
  'Baseline better': 'Base migliore',
  'Evaluation does not automatically promote or activate this optimizer.':
    'La valutazione non promuove né attiva automaticamente questo ottimizzatore.',
  '{visible} of {total} sources': '{visible} di {total} fonti',
  'How Token Harness measures results': 'Come Token Harness misura i risultati',
  'Tool output': 'Output dei tool',
  'Local output reductions are shown only from recorded optimizer evidence. Different providers are never silently added together.':
    "Le riduzioni di output locale compaiono solo se supportate da prove registrate dall'ottimizzatore. Provider diversi non vengono mai sommati di nascosto.",
  'Setup and results': 'Configurazione e risultati',
  'App evidence includes attributed optimizer output, observed routing hook runs and current quota readings. RTK shared history stays unattributed; records from a Token Harness per-app hook database can identify their app. HarnessTrim records identify an app only when the telemetry names it. Setup alone does not establish attribution.':
    "Le prove per app comprendono l'output attribuito degli ottimizzatori, le esecuzioni osservate degli hook di instradamento e le letture attuali della quota. Lo storico condiviso di RTK resta non attribuito; i record di un database hook per app di Token Harness possono indicare la loro app. I record di HarnessTrim indicano un'app solo se la telemetria la nomina. La sola configurazione non stabilisce l'attribuzione.",
  'Subscription-plan savings appear only when authoritative paired allowance evidence exists and quality is preserved.':
    'I risparmi sul piano in abbonamento compaiono solo quando esistono prove affidabili di quota in coppia e la qualità è mantenuta.',
  'API cost': 'Costo API',
  'The dollar figure on Home is a labelled estimate from public list prices. Billed money is never presented as measured, and local output reduction is never turned into invented dollars or euros.':
    "La cifra in dollari nella Home è una stima etichettata, basata sui prezzi di listino pubblici. Il denaro fatturato non viene mai presentato come misurato e la riduzione dell'output locale non viene mai trasformata in dollari o euro inventati.",
  Quality: 'Qualità',
  'Both task variants need recorded quality checks. A regression can block a positive savings claim.':
    'Per entrambe le varianti del compito servono controlli di qualità registrati. Una regressione può bloccare una dichiarazione di risparmio positiva.',
  'Recorded output': 'Output registrato',
  'changed outputs only': 'solo output modificati',
  '{n} measurement groups': '{n} gruppi di misurazioni',
  'No records yet': 'Ancora nessun record',
  'Open each source below for its unit and details.':
    'Apri ogni fonte qui sotto per unità e dettagli.',
  'Use a connected app, then Refresh.': "Usa un'app collegata, poi scegli Aggiorna.",
  'Allowance saved · 5h / 7d': 'Quota risparmiata · 5h / 7g',
  'All locally recorded projects · {from} – {to}':
    'Tutti i progetti registrati in locale · {from} – {to}',
  'All locally recorded projects · no results for this period.':
    'Tutti i progetti registrati in locale · nessun risultato per questo periodo.',
  '{n} records could not be read': 'Non è stato possibile leggere {n} record',
  'More agent checks': "Altri controlli dell'agente",
  'Status without changing settings': 'Stato, senza cambiare le impostazioni',
  'Guidance not checked': 'Guida non controllata',
  'Plan allowance': 'Quota del piano',
  'Agent details appear after a supported coding agent is detected.':
    'I dettagli degli agenti compaiono dopo che viene rilevato un agente di sviluppo supportato.',
  'Optimizer health': 'Stato degli ottimizzatori',
  'Something changed or could not be verified. Re-check the configured integrations for details.':
    'Qualcosa è cambiato o non si è potuto verificare. Ricontrolla le integrazioni configurate per i dettagli.',
  'Re-check integrations after external changes or when troubleshooting.':
    'Ricontrolla le integrazioni dopo modifiche esterne o per risolvere un problema.',
  'Check now': 'Controlla ora',
  'Token Harness and optimizer updates': 'Aggiornamenti di Token Harness e degli ottimizzatori',
  '{name} has an update ready.': "Per {name} c'è un aggiornamento pronto.",
  'Check available versions and review updates before installing.':
    'Controlla le versioni disponibili e verifica gli aggiornamenti prima di installarli.',
  'Review updates': 'Controlla gli aggiornamenti',
  'Undo last change': "Annulla l'ultima modifica",
  'Review and restore the exact last configuration transaction from this app session.':
    "Controlla e ripristina l'ultima transazione di configurazione di questa sessione dell'app.",
  'Review undo': "Controlla l'annullamento",
  'Review recovery of an unfinished prepared benchmark after reopening the app.':
    "Controlla il recupero di un benchmark preparato e non terminato, dopo aver riaperto l'app.",
  'No checks or changes have been recorded in this app session.':
    "In questa sessione dell'app non è stato registrato nessun controllo o modifica.",
  Attention: 'Attenzione',
  Working: 'In corso',
  'Showing the latest {shown} of {total} entries.': 'Mostro le ultime {shown} voci su {total}.',
  Restored: 'Ripristinato',
  'Recovery needed': 'Serve un ripristino',
  Unfinished: 'Non terminato',
  'Unknown operation': 'Operazione sconosciuta',
  'Review restore': 'Controlla il ripristino',
  'No retained operations for this project. Manually configured integrations do not create Token Harness transactions.':
    'Nessuna operazione conservata per questo progetto. Le integrazioni configurate a mano non creano transazioni di Token Harness.',
  'History is unavailable. No recovery target was selected.':
    'Lo storico non è disponibile. Non è stato scelto nessun obiettivo di ripristino.',
  'Reading retained change history…': 'Leggo lo storico delle modifiche conservato…',
  'Reading changes…': 'Leggo le modifiche…',
  'Change history could not be read. Choose Refresh history to retry.':
    'Non è stato possibile leggere lo storico delle modifiche. Scegli Aggiorna storico per riprovare.',
  '{done}/{total} checks finished': '{done}/{total} controlli terminati',
  'Comparison guide': 'Guida al confronto',
  'How results are measured': 'Come vengono misurati i risultati',
  'Results overview': 'Panoramica dei risultati',
  'Search sources, apps or measurements': 'Cerca fonti, app o misurazioni',
  'All sources': 'Tutte le fonti',
  Optimizers: 'Ottimizzatori',
  'Coding apps': 'App di sviluppo',
  Measurements: 'Misurazioni',
  Experiments: 'Esperimenti',
  'With results first': 'Prima con risultati',
  'Source type': 'Tipo di fonte',
  'Search evidence': 'Cerca nelle prove',
  'Sort by': 'Ordina per',
  'Clear filters': 'Cancella i filtri',
  'Evidence by source': 'Prove per fonte',
  'No matching sources': 'Nessuna fonte corrispondente',
  'Try a different search or clear the filters.': "Prova un'altra ricerca o cancella i filtri.",
  'History loads when you open Details.': 'Lo storico si carica quando apri i Dettagli.',
  'Refresh history': 'Aggiorna storico',
  'Change history': 'Storico delle modifiche',
  Evidence: 'Prove',
  'Every number keeps its source and how it was measured.':
    'Ogni numero conserva la sua fonte e il modo in cui è stato misurato.',
  'Coding agents': 'Agenti di sviluppo',
  'What each agent reports, without changing any settings.':
    'Ciò che riporta ogni agente, senza cambiare nessuna impostazione.',
  'Checks and maintenance': 'Controlli e manutenzione',
  'Re-check health, look for updates and undo changes.':
    'Ricontrolla lo stato, cerca aggiornamenti e annulla modifiche.',
  'Changes Token Harness made to this project, kept across sessions.':
    "Le modifiche che Token Harness ha fatto a questo progetto, conservate tra una sessione e l'altra.",
  'Recent activity': 'Attività recente',
  'Latest checks and changes from this app session.':
    "Ultimi controlli e modifiche di questa sessione dell'app.",
};
