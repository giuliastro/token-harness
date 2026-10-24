/**
 * First run: one screen, one button. Every step is previewed and shown before anything changes;
 * after approval each step is re-previewed just before it is applied, and the run stops for a new
 * review if a step no longer matches what the user approved.
 */
export const GUIDE_ONBOARDING_JS = String.raw`
  let onboardingStep = 'intro';
  let onboardingForced = false;

  function recommendedTargets() {
    const agents = activeAgents();
    const setup = agents.filter(agent => ['rtk', 'harnesstrim'].some(id => setupTarget(agent.id, id)?.state === 'actionable'));
    const routing = agents.filter(agent => {
      const state = routingState(agent);
      return !state.configured && state.state !== 'external';
    });
    return { setup, routing };
  }

  function recommendedMissing() {
    const targets = recommendedTargets();
    return targets.setup.length > 0 || targets.routing.length > 0;
  }

  function isFreshInstall() {
    const agents = activeAgents();
    if (!agents.length) return false;
    const anyConnected = agents.some(agent => ['rtk', 'harnesstrim'].some(id => setupTarget(agent.id, id)?.state === 'connected'));
    const anyRouting = agents.some(agent => routingState(agent).configured);
    return !anyConnected && !anyRouting && recommendedMissing();
  }

  function onboardingActive() {
    if (onboardingForced) return true;
    return storage.get('token-harness-onboarded') !== 'yes' && !!current && isFreshInstall();
  }

  function startOnboarding() {
    onboardingForced = true;
    onboardingStep = 'intro';
    selectView('home');
    render();
  }

  function finishOnboarding(view = 'home') {
    storage.set('token-harness-onboarded', 'yes');
    onboardingForced = false;
    if (window.location?.hash === '#welcome') {
      try { history.replaceState(null, '', window.location.pathname); } catch { /* the hash only reopens this screen */ }
    }
    onboardingStep = 'intro';
    selectView(view, true);
    render();
  }

  function planItem(title, detail) {
    const item = node('div', undefined, 'plan-item');
    const check = node('span', '✓', 'plan-check');
    check.setAttribute('aria-hidden', 'true');
    const copy = node('div');
    copy.append(node('strong', title), node('span', detail));
    item.append(check, copy);
    return item;
  }

  function renderOnboarding() {
    const root = $('onboarding-root');
    root.replaceChildren();
    const wrap = node('section', undefined, 'onboarding');
    if (onboardingStep === 'done') {
      wrap.append(node('h1', t('You are all set')), node('p', t('Token Harness now works in the background. Your savings appear on Home as you use your agents.'), 'lead'));
      const codex = activeAgents().find(agent => agent.id === 'codex' && agent.promptRouting?.enablement === 'untrusted');
      if (codex) {
        const todo = node('div', undefined, 'card todo');
        todo.append(
          node('h3', t('One step left in Codex')),
          node('p', t('Codex asks you to approve new hooks once. Open Codex, type /hooks and approve Token Harness.')),
          copyRow('/hooks'),
          actionButton(t('Done, check again'), () => refresh(true), 'secondary'),
        );
        wrap.append(todo);
      }
      const actions = node('div', undefined, 'onboarding-actions');
      actions.append(actionButton(t('Go to Home'), () => finishOnboarding('home'), 'big'));
      wrap.append(actions);
      root.append(wrap);
      return;
    }
    wrap.append(
      node('h1', t('Get more out of your Claude and Codex plans')),
      node('p', t('Token Harness trims the noise your coding agent reads and hands simple work to cheaper models. You keep working exactly as before.'), 'lead'),
    );
    const agents = activeAgents();
    if (agents.length) {
      wrap.append(node('span', t('Found on this computer'), 'eyebrow'));
      const found = node('div', undefined, 'found');
      for (const agent of agents) {
        const chip = node('span', undefined, 'agent-chip active');
        chip.append(node('span', undefined, 'dot'), node('span', agent.name + (agent.version ? ' ' + agent.version : '')));
        found.append(chip);
      }
      wrap.append(found);
    }
    const targets = recommendedTargets();
    wrap.append(node('span', t('Recommended setup'), 'eyebrow'));
    const plan = node('div', undefined, 'card plan');
    if (targets.setup.length) {
      plan.append(planItem(t('Shorter command output'), t('Test, build and Git output is compacted before your agent reads it. (RTK)')));
      plan.append(planItem(t('Leaner logs and context'), t('Repetitive logs are trimmed and your agent gets tips to keep context small. (HarnessTrim)')));
    }
    if (targets.routing.length)
      plan.append(planItem(t('Smart model routing'), t('Simple tasks go to a cheaper helper model. Your main model stays in charge.')));
    if (!plan.children.length) plan.append(planItem(t('Already set up'), t('The recommended methods are already on.')));
    wrap.append(plan);
    const actions = node('div', undefined, 'onboarding-actions');
    if (targets.setup.length || targets.routing.length) {
      actions.append(actionButton(t('Turn on the recommended setup'), reviewOnboarding, 'big'));
      actions.append(actionButton(t('Choose methods myself'), () => finishOnboarding('methods'), 'ghost'));
    } else {
      actions.append(actionButton(t('Go to Home'), () => finishOnboarding('home'), 'big'));
    }
    wrap.append(actions, node('p', t('Takes about 20 seconds. You review every change first, and everything can be undone.'), 'caption'));
    root.append(wrap);
  }

  function onboardingSteps() {
    const targets = recommendedTargets();
    const steps = [];
    if (targets.setup.length)
      steps.push({ title: t('RTK and HarnessTrim'), body: { action: 'setup', harnesses: targets.setup.map(agent => agent.id) } });
    for (const agent of targets.routing)
      steps.push({ title: t('Model routing') + ' · ' + agent.name, body: { action: 'routing-enable', harness: agent.id } });
    return steps;
  }

  const changeKey = data => JSON.stringify((data.changes || []).map(change => change.title));

  async function reviewOnboarding() {
    if (busy) return;
    const steps = onboardingSteps();
    const run = modal(t('Review before turning on'));
    $('modal-content').append(progress(t('Preparing a preview'), t('Nothing changes until you approve it.')));
    $('modal-actions').append(modalClose(t('Cancel')));
    setBusy(true, false);
    try {
      await ensureSession();
      for (const step of steps) step.preview = await request('/api/preview', step.body);
      if (run !== modalRun) return;
      $('modal-content').replaceChildren(node('p', t('These changes will be made. A backup is saved first.')));
      for (const step of steps) {
        $('modal-content').append(node('h3', step.title, 'step-title'));
        showChanges(step.preview, t('No change needed'), t('The current state is already right or cannot be changed safely.'));
      }
      if (steps.some(step => step.body.action === 'routing-enable' && step.body.harness === 'codex'))
        $('modal-content').append(messageBox(t('One step in Codex'), t('Codex asks you to approve new hooks once: open Codex, type /hooks and approve Token Harness.'), 'safe'));
      $('modal-content').append(safetyNote());
      const runnable = steps.filter(step => step.preview.ticket);
      $('modal-actions').replaceChildren(modalClose(runnable.length ? t('Cancel') : t('Done')));
      if (runnable.length) $('modal-actions').append(actionButton(t('Turn on'), () => applyOnboarding(runnable)));
    } catch (error) {
      modalFailure(run, error);
    } finally {
      if (run === modalRun) setBusy(false, false);
    }
  }

  async function applyOnboarding(steps) {
    const run = modalRun;
    const notes = [];
    for (const [index, step] of steps.entries()) {
      let ticket = step.preview.ticket;
      if (index > 0) {
        // Earlier steps changed configuration files; plan this step again against the new state.
        await ensureSession();
        const fresh = await request('/api/preview', step.body).catch(error => ({ error }));
        if (run !== modalRun) return;
        if (fresh.error || !fresh.ticket || changeKey(fresh) !== changeKey(step.preview)) {
          $('modal-title').textContent = t('Please review this step again');
          $('modal-content').replaceChildren(messageBox(t('Something changed'), t('The next step no longer matches what you approved, so Token Harness stopped. Review it again.'), 'warn'));
          if (fresh.error) $('modal-content').append(messageBox(t('Needs attention'), fresh.error.message, 'warn'));
          else showChanges(fresh, t('No change needed'), t('The current state is already right or cannot be changed safely.'));
          $('modal-actions').replaceChildren(modalClose(t('Cancel')));
          if (fresh.ticket) $('modal-actions').append(actionButton(t('Turn on'), () => applyOnboarding([{ ...step, preview: fresh }, ...steps.slice(index + 1)])));
          return;
        }
        ticket = fresh.ticket;
      }
      $('modal-content').replaceChildren(progress(t('Turning on: {step}', { step: step.title }), t('Keep this window open until it finishes.')));
      const result = await applyTicket(ticket, { quiet: true });
      if (run !== modalRun) return;
      if (!result) return;
      if (!result.ok) {
        $('modal-title').textContent = t('Needs attention');
        $('modal-content').replaceChildren(messageBox(step.title, (result.messages || []).join(' '), 'warn'));
        $('modal-actions').replaceChildren(modalClose(t('Close')));
        await refreshOverviewAfterMutation().catch(() => undefined);
        return;
      }
      notes.push(...(result.messages || []));
    }
    $('modal-content').replaceChildren(progress(t('Refreshing'), t('Reading your agents and methods again after the change.')));
    try {
      await refreshOverviewAfterMutation();
    } catch {
      $('stale-state').hidden = false;
      $('stale-state').textContent = t('The change finished, but the latest state could not be read automatically. Choose Refresh.');
    }
    if (run !== modalRun) return;
    closeModal();
    onboardingForced = true;
    onboardingStep = 'done';
    render();
  }
`;

export const GUIDE_ONBOARDING_IT: Readonly<Record<string, string>> = {
  'You are all set': 'Tutto pronto',
  'Token Harness now works in the background. Your savings appear on Home as you use your agents.':
    'Token Harness ora lavora in background. I risparmi compaiono nella Home man mano che usi i tuoi agenti.',
  'One step left in Codex': 'Manca un passaggio in Codex',
  'Codex asks you to approve new hooks once. Open Codex, type /hooks and approve Token Harness.':
    'Codex chiede di approvare una volta i nuovi hook. Apri Codex, scrivi /hooks e approva Token Harness.',
  'Done, check again': 'Fatto, ricontrolla',
  'Go to Home': 'Vai alla Home',
  'Get more out of your Claude and Codex plans': 'Ottieni di più dai tuoi piani Claude e Codex',
  'Token Harness trims the noise your coding agent reads and hands simple work to cheaper models. You keep working exactly as before.':
    'Token Harness riduce il rumore che il tuo agente legge e affida il lavoro semplice a modelli più economici. Tu continui a lavorare come prima.',
  'Found on this computer': 'Trovati su questo computer',
  'Recommended setup': 'Configurazione consigliata',
  'Shorter command output': 'Output dei comandi più corto',
  'Test, build and Git output is compacted before your agent reads it. (RTK)':
    "L'output di test, build e Git viene compattato prima che l'agente lo legga. (RTK)",
  'Leaner logs and context': 'Log e contesto più leggeri',
  'Repetitive logs are trimmed and your agent gets tips to keep context small. (HarnessTrim)':
    "I log ripetitivi vengono ridotti e l'agente riceve indicazioni per tenere il contesto piccolo. (HarnessTrim)",
  'Smart model routing': 'Instradamento intelligente del modello',
  'Simple tasks go to a cheaper helper model. Your main model stays in charge.':
    'I compiti semplici vanno a un modello di supporto più economico. Il modello principale resta al comando.',
  'Already set up': 'Già configurato',
  'The recommended methods are already on.': 'I metodi consigliati sono già attivi.',
  'Turn on the recommended setup': 'Attiva la configurazione consigliata',
  'Choose methods myself': 'Scelgo io i metodi',
  'Takes about 20 seconds. You review every change first, and everything can be undone.':
    'Richiede circa 20 secondi. Controlli prima ogni modifica e si può annullare tutto.',
  'RTK and HarnessTrim': 'RTK e HarnessTrim',
  'Review before turning on': 'Controlla prima di attivare',
  'These changes will be made. A backup is saved first.':
    'Verranno fatte queste modifiche. Prima viene salvato un backup.',
  'Please review this step again': 'Controlla di nuovo questo passaggio',
  'Something changed': 'Qualcosa è cambiato',
  'The next step no longer matches what you approved, so Token Harness stopped. Review it again.':
    'Il passaggio successivo non corrisponde più a ciò che hai approvato, quindi Token Harness si è fermato. Controllalo di nuovo.',
  'Turning on: {step}': 'Attivo: {step}',
};
