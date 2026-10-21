/**
 * Methods: every way Token Harness can stretch a plan, each with one clear state and the same
 * controls. Turning a tool off removes only the connection Token Harness added; the program
 * stays installed. All changes still go through the reviewed preview/apply flow.
 */
export const GUIDE_METHODS_JS = String.raw`
  let methodFilter = 'all';

  const METHOD_ICONS = {
    output: 'M4 6h16M4 12h10M4 18h5',
    model: 'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM12 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM7.5 8l3.5 7.5M16.5 8L13 15.5',
    context: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M9 12h6',
    code: 'M6 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18 20.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM8.3 11l7.4-3.8M8.3 13l7.4 3.8',
  };

  function methodIcon(kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const wrap = node('span', undefined, 'method-icon ' + kind);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', METHOD_ICONS[kind] || METHOD_ICONS.output);
    svg.append(path);
    wrap.append(svg);
    return wrap;
  }

  function providerCopy(id) {
    const copy = {
      rtk: [t('Shorter output'), t('Compacts test, build and Git output so your agent spends less on noise.'), 'output'],
      harnesstrim: [t('Shorter output'), t('Trims repetitive logs and gives your agent tips to keep context lean.'), 'output'],
      mcptoon: [t('Smaller context'), t('Loads MCP tool descriptions only when needed instead of keeping the full list in context.'), 'context'],
      gitnexus: [t('Code navigation'), t('Maps your code so the agent finds functions and dependencies without reading many files.'), 'code'],
      headroom: [t('Smaller context'), t('Compresses large tool results and retrieves only the relevant parts.'), 'context'],
    }[id];
    return copy || [t('Optimizer'), optimizerInfo(id).role, 'output'];
  }

  function switchControl(label, checked, onToggle, disabled = false) {
    const button = node('button', undefined, 'switch');
    button.type = 'button';
    button.dataset.action = 'product';
    button.setAttribute('role', 'switch');
    button.setAttribute('aria-checked', String(checked));
    button.setAttribute('aria-label', label);
    button.disabled = busy || disabled;
    button.addEventListener('click', onToggle);
    return button;
  }

  function providerMethod(id) {
    const info = optimizerInfo(id);
    const component = managedComponent(id);
    const targets = activeAgents()
      .map(agent => ({ agent, target: setupTarget(agent.id, id) }))
      .filter(item => item.target);
    const connected = targets.filter(item => item.target.state === 'connected');
    const actionable = targets.filter(item => item.target.state === 'actionable');
    const installed = component?.installed === true;
    let status;
    if (component?.health === 'attention') status = ['action', t('Needs a check')];
    else if (connected.length) status = ['active', t('On')];
    else if (installed && actionable.length) status = ['paused', t('Off')];
    else if (actionable.length) status = ['off', t('Not installed')];
    else status = ['unavailable', t('Not available for your apps')];
    const [category, description, kind] = providerCopy(id);
    return { key: id, kind, name: info.name, category, description, info, component, targets, connected, actionable, installed, status, recommended: !info.optional };
  }

  function providerResult(method) {
    const rows = (current?.savings?.rows || []).filter(row => row.providerId === method.key && row.saved > 0);
    const box = node('div', undefined, 'method-result');
    if (rows.length && method.connected.length) {
      const row = rows.find(item => item.unit === 'tokens') || rows[0];
      box.append(
        node('strong', compact(row.saved) + ' ' + (row.unit === 'tokens' ? t('tokens') : t('characters'))),
        node('span', row.impact?.percent ? t('saved · {percent} shorter', { percent: percentText(row.impact.percent) }) : t('saved')),
      );
      if (row.measurement === 'Local estimate') box.append(tag(t('Estimate'), 'estimated'));
      return box;
    }
    box.className += ' none';
    if (method.connected.length) {
      box.append(node('strong', t('No results yet')), node('span', t('They appear after you use your agents.')));
      return box;
    }
    const claim = claimText(method.info.claim?.headline);
    if (claim) {
      box.append(node('strong', t('Its project reports: {claim}', { claim })), node('span', t('On its own tests, not on your computer.')));
      return box;
    }
    return null;
  }

  function providerCard(method) {
    const card = methodShell(method);
    const result = providerResult(method);
    if (result) card.append(result);
    if (method.component?.update === 'available' && method.installed) {
      const update = node('div', undefined, 'update-strip');
      update.append(node('span', t('Update available: {from} → {to}', {
        from: method.component.version ? 'v' + method.component.version : t('installed'),
        to: method.component.updateAvailableVersion ? 'v' + method.component.updateAvailableVersion : t('newer version'),
      })), actionButton(t('Update'), () => readOnlyOperation('update', method.key), 'secondary small'));
      card.append(update);
    }
    if (method.connected.length) {
      const agents = node('div', undefined, 'agent-tags');
      for (const item of method.connected) agents.append(node('span', item.agent.name));
      card.append(agents);
    }
    const foot = node('div', undefined, 'method-foot');
    const on = method.connected.length > 0;
    if (method.installed || on) {
      foot.append(switchControl(method.name, on, () => (on ? reviewRemoval(method.key) : reviewSetup(method.key)), !on && !method.actionable.length));
      foot.append(node('span', method.component?.version ? 'v' + method.component.version : '', 'grow caption'));
      if (on && method.actionable.length) foot.append(actionButton(t('Add to more apps'), () => reviewSetup(method.key), 'ghost'));
    } else if (method.actionable.length) {
      foot.append(node('span', undefined, 'grow'), actionButton(t('Install'), () => reviewSetup(method.key)));
    } else {
      const reasons = method.targets.filter(item => item.target.reason).map(item => item.agent.name + ': ' + item.target.reason);
      foot.append(node('span', reasons[0] || t('No supported coding app was found for it.'), 'grow caption'));
      if (method.key === 'mcptoon') foot.append(actionButton(t('What it needs'), mcptoonInstallOptions, 'ghost'));
    }
    if (method.component?.health === 'attention') foot.append(actionButton(t('Re-check health'), () => readOnlyOperation('verify'), 'ghost'));
    card.append(foot, methodExplanation(method));
    return card;
  }

  function methodExplanation(method) {
    const info = method.info || {};
    const details = explanation('method:' + method.key, t('When is it useful?'), 'method-more');
    const body = node('div', undefined, 'explanation-grid');
    if (info.useful || info.role) body.append(messageBox(t('When to use it'), info.useful || info.role));
    if (info.mechanism) body.append(messageBox(t('How it works'), info.mechanism));
    if (info.limitation) body.append(messageBox(t('Good to know'), info.limitation));
    if (info.claim?.context) {
      const claim = messageBox(t('What its project reports'), info.claim.context);
      if (info.claim.source) claim.append(projectLink(t('Benchmark and method'), info.claim.source, info.name));
      body.append(claim);
    }
    if (info.project) body.append(projectLink(t('Project page'), info.project, info.name));
    if (!body.children.length) return node('span');
    details.append(body);
    return details;
  }

  function methodShell(method) {
    const card = node('article', undefined, 'card method');
    card.dataset.method = method.key;
    const head = node('div', undefined, 'method-head');
    const title = node('div', undefined, 'method-title');
    title.append(node('h3', method.name), node('span', method.category, 'caption'));
    head.append(methodIcon(method.kind), title, pill(method.status[1], method.status[0]));
    card.append(head, node('p', method.description, 'method-desc'));
    return card;
  }

  function aggregateStatus(states, labels) {
    for (const state of ['action', 'active', 'waiting', 'paused'])
      if (states.includes(state)) return [state, labels[state]];
    return ['off', labels.off];
  }

  function agentRow(agent, stateLabel, control) {
    const row = node('div', undefined, 'agent-row');
    const copy = node('div');
    copy.append(node('strong', agent.name), node('span', stateLabel, 'caption'));
    row.append(copy);
    if (control) row.append(control);
    return row;
  }

  function routingCard() {
    const agents = activeAgents();
    const states = agents.map(agent => routingState(agent).state);
    const method = {
      key: 'routing', kind: 'model', name: t('Model routing'), category: t('Model and reasoning'),
      description: t('Hands simple work, like reading, searching and running checks, to a cheaper model. Your main model stays in charge and reviews the result.'),
      status: aggregateStatus(states, { action: t('Needs a step'), active: t('On'), waiting: t('On · waiting for first use'), paused: t('Off'), off: t('Off') }),
    };
    const card = methodShell(method);
    const usage = delegatedUsage();
    const started = agents.reduce((sum, agent) => sum + (agent.promptRouting?.subagentsStarted || 0), 0);
    if (usage.total || started) {
      const box = node('div', undefined, 'method-result');
      if (usage.total) box.append(node('strong', compact(usage.total) + ' ' + t('tokens')), node('span', t('handled by cheaper models in {days} days', { days: usage.days })));
      else box.append(node('strong', count(started, 0)), node('span', t('tasks delegated in 30 days')));
      card.append(box);
    }
    const list = node('div', undefined, 'agent-list');
    for (const agent of agents) {
      const state = routingState(agent);
      let control = null;
      if (state.state === 'external') control = null;
      else if (agent.promptRouting?.needsRepair) control = actionButton(t('Repair'), () => reviewPromptRouting(agent.id, true), 'secondary small');
      else if (agent.promptRouting?.enablement === 'untrusted') control = actionButton(t('How to approve'), () => codexTrustHelp(), 'secondary small');
      else control = switchControl(t('Model routing') + ' · ' + agent.name, state.configured, () => reviewPromptRouting(agent.id, !state.configured));
      list.append(agentRow(agent, state.label, control));
    }
    if (!agents.length) list.append(node('p', t('No coding agent found.'), 'caption'));
    card.append(list);
    card.append(routingExplanation());
    return card;
  }

  function codexTrustHelp() {
    modal(t('Approve the hook in Codex'));
    $('modal-content').append(
      node('p', t('Codex asks you to approve new hooks once. Open Codex, type /hooks, approve the Token Harness hooks, then send a prompt.')),
      copyRow('/hooks'),
    );
    $('modal-actions').append(modalClose(t('Done')), actionButton(t('Check again'), () => { closeModal(); refresh(true); }, 'secondary'));
  }

  function routingExplanation() {
    const details = explanation('method:routing', t('When is it useful?'), 'method-more');
    const body = node('div', undefined, 'explanation-grid');
    body.append(
      messageBox(t('What it does'), t('On each prompt, a local hook reminds your agent that reading, searching, running tests and mechanical edits can go to a cheaper helper model.')),
      messageBox(t('Your main model stays in charge'), t('It reviews every result. Architecture, security, releases and final review always stay with the main model.')),
      messageBox(t('Which models'), t('Claude Code uses Haiku for reading and checks, and Sonnet for code changes. Codex uses Luna.')),
    );
    details.append(body);
    return details;
  }

  function reasoningCard() {
    const agents = activeAgents();
    const saved = agents.filter(agent => agent.reasoning?.state === 'saved');
    const method = {
      key: 'reasoning', kind: 'model', name: t('Reasoning level'), category: t('Model and reasoning'),
      description: t('Sets how hard the model thinks by default. Lighter is cheaper; deeper is better for hard problems.'),
      status: saved.length ? ['active', t('Saved')] : ['off', t('Default')],
    };
    const card = methodShell(method);
    const list = node('div', undefined, 'agent-list');
    for (const agent of agents) {
      const action = agent.reasoning?.action;
      const control = action?.kind === 'effort'
        ? actionButton(t('Change'), () => reasoningGuide(agent), 'secondary small')
        : action?.kind === 'help' ? actionButton(t('How to change'), () => runAgentAction(action), 'secondary small') : null;
      list.append(agentRow(agent, agent.reasoning?.value ? effortLabel(agent.reasoning.value) : t('Default'), control));
    }
    card.append(list);
    return card;
  }

  function guidanceLabel(state) {
    return { managed: t('On'), external: t('On (set up by you)'), absent: t('Off'), conflict: t('A custom skill is already there'), unavailable: t('Not available') }[state] || t('Not checked');
  }

  function guidanceCard() {
    const agents = activeAgents();
    const states = agents.map(agent => ['managed', 'external'].includes(agent.guidance?.state) ? 'active' : agent.guidance?.state === 'conflict' ? 'action' : 'off');
    const method = {
      key: 'guidance', kind: 'model', name: t('In-session guidance'), category: t('Model and reasoning'),
      description: t('Adds a short skill so your agent can check your plan and choose reasoning and helpers sensibly.'),
      status: aggregateStatus(states, { action: t('Needs a look'), active: t('On'), waiting: t('On'), paused: t('Off'), off: t('Off') }),
    };
    const card = methodShell(method);
    const list = node('div', undefined, 'agent-list');
    for (const agent of agents) {
      const control = agent.guidance?.action ? actionButton(t('Turn on'), () => runAgentAction(agent.guidance.action), 'secondary small') : null;
      list.append(agentRow(agent, guidanceLabel(agent.guidance?.state), control));
    }
    card.append(list);
    return card;
  }

  function methodState(card) {
    const pillNode = card.querySelector('.pill');
    return pillNode ? pillNode.className.replace('pill', '').trim() : 'off';
  }

  function renderMethods() {
    const root = $('methods-root');
    root.replaceChildren();
    if (!current) {
      root.append(progress(t('Checking your methods…'), t('Reading what is installed and connected.')));
      return;
    }
    const providers = optimizerIds().map(providerMethod);
    const recommended = [...providers.filter(method => method.recommended).map(providerCard), routingCard()];
    const more = [reasoningCard(), guidanceCard(), ...providers.filter(method => !method.recommended).map(providerCard)];
    const all = [...recommended, ...more];
    const isOn = card => ['active', 'waiting', 'action'].includes(methodState(card));
    const filters = node('div', undefined, 'filters');
    for (const [value, label] of [['all', t('All')], ['on', t('On')], ['off', t('Off')]]) {
      const amount = value === 'all' ? all.length : all.filter(card => (value === 'on') === isOn(card)).length;
      const button = node('button', label + ' · ' + amount, 'filter');
      button.type = 'button';
      button.setAttribute('aria-pressed', String(methodFilter === value));
      button.addEventListener('click', () => { methodFilter = value; renderMethods(); });
      filters.append(button);
    }
    root.append(filters);
    const visible = card => methodFilter === 'all' || (methodFilter === 'on') === isOn(card);
    for (const [title, detail, cards] of [
      [t('Recommended'), t('On for most people'), recommended],
      [t('More methods'), t('Useful in specific situations'), more],
    ]) {
      const shown = cards.filter(visible);
      if (!shown.length) continue;
      const heading = node('div', undefined, 'section-heading');
      heading.append(node('h2', title), node('span', detail, 'caption'));
      const grid = node('div', undefined, 'method-grid');
      grid.append(...shown);
      root.append(heading, grid);
    }
  }
`;

export const GUIDE_METHODS_IT: Readonly<Record<string, string>> = {
  'Shorter output': 'Output più corto',
  'Compacts test, build and Git output so your agent spends less on noise.':
    "Compatta l'output di test, build e Git così l'agente spende meno sul rumore.",
  'Trims repetitive logs and gives your agent tips to keep context lean.':
    "Riduce i log ripetitivi e dà all'agente indicazioni per tenere il contesto leggero.",
  'Smaller context': 'Contesto più piccolo',
  'Loads MCP tool descriptions only when needed instead of keeping the full list in context.':
    'Carica le descrizioni dei tool MCP solo quando servono, invece di tenerle tutte nel contesto.',
  'Code navigation': 'Navigazione del codice',
  'Maps your code so the agent finds functions and dependencies without reading many files.':
    "Mappa il tuo codice così l'agente trova funzioni e dipendenze senza leggere tanti file.",
  'Compresses large tool results and retrieves only the relevant parts.':
    'Comprime i risultati grandi dei tool e recupera solo le parti utili.',
  Optimizer: 'Ottimizzatore',
  'Needs a check': 'Da controllare',
  'Not installed': 'Non installato',
  'Not available for your apps': 'Non disponibile per le tue app',
  'saved · {percent} shorter': 'risparmiati · {percent} più corto',
  saved: 'risparmiati',
  'No results yet': 'Ancora nessun risultato',
  'They appear after you use your agents.': 'Compaiono dopo che usi i tuoi agenti.',
  'Its project reports: {claim}': 'Il progetto dichiara: {claim}',
  'On its own tests, not on your computer.': 'Sui suoi test, non sul tuo computer.',
  'Update available: {from} → {to}': 'Aggiornamento disponibile: {from} → {to}',
  installed: 'installata',
  'newer version': 'versione più recente',
  Update: 'Aggiorna',
  'Add to more apps': 'Aggiungi ad altre app',
  Install: 'Installa',
  'No supported coding app was found for it.':
    'Non è stata trovata nessuna app di sviluppo supportata.',
  'What it needs': 'Cosa serve',
  'When is it useful?': 'Quando è utile?',
  'When to use it': 'Quando usarlo',
  'Good to know': 'Da sapere',
  'What its project reports': 'Cosa dichiara il progetto',
  'Benchmark and method': 'Benchmark e metodo',
  'Project page': 'Pagina del progetto',
  'Model routing': 'Instradamento del modello',
  'Model and reasoning': 'Modello e ragionamento',
  'Hands simple work, like reading, searching and running checks, to a cheaper model. Your main model stays in charge and reviews the result.':
    'Affida il lavoro semplice, come leggere, cercare ed eseguire controlli, a un modello più economico. Il modello principale resta al comando e controlla il risultato.',
  'Needs a step': 'Serve un passaggio',
  'handled by cheaper models in {days} days': 'gestiti da modelli più economici in {days} giorni',
  'tasks delegated in 30 days': 'compiti delegati in 30 giorni',
  Repair: 'Ripara',
  'How to approve': 'Come approvare',
  'No coding agent found.': 'Nessun agente di sviluppo trovato.',
  'Approve the hook in Codex': "Approva l'hook in Codex",
  'Codex asks you to approve new hooks once. Open Codex, type /hooks, approve the Token Harness hooks, then send a prompt.':
    'Codex chiede di approvare una volta i nuovi hook. Apri Codex, scrivi /hooks, approva gli hook di Token Harness e poi invia un prompt.',
  'What it does': 'Cosa fa',
  'On each prompt, a local hook reminds your agent that reading, searching, running tests and mechanical edits can go to a cheaper helper model.':
    "A ogni prompt, un hook locale ricorda all'agente che lettura, ricerca, test e modifiche meccaniche possono andare a un modello di supporto più economico.",
  'Your main model stays in charge': 'Il modello principale resta al comando',
  'It reviews every result. Architecture, security, releases and final review always stay with the main model.':
    'Controlla ogni risultato. Architettura, sicurezza, release e revisione finale restano sempre al modello principale.',
  'Which models': 'Quali modelli',
  'Claude Code uses Haiku for reading and checks, and Sonnet for code changes. Codex uses Luna.':
    'Claude Code usa Haiku per lettura e controlli e Sonnet per le modifiche al codice. Codex usa Luna.',
  'Reasoning level': 'Livello di ragionamento',
  'Sets how hard the model thinks by default. Lighter is cheaper; deeper is better for hard problems.':
    'Imposta quanto ragiona il modello di default. Leggero costa meno, profondo è meglio per i problemi difficili.',
  Saved: 'Salvato',
  Default: 'Predefinito',
  Change: 'Cambia',
  'How to change': 'Come cambiarlo',
  'On (set up by you)': 'Attivo (configurato da te)',
  'A custom skill is already there': "C'è già una skill personalizzata",
  'Not available': 'Non disponibile',
  'Not checked': 'Non controllato',
  'In-session guidance': 'Guida in sessione',
  'Adds a short skill so your agent can check your plan and choose reasoning and helpers sensibly.':
    "Aggiunge una breve skill così l'agente può controllare il piano e scegliere bene ragionamento e modelli di supporto.",
  'Needs a look': 'Da guardare',
  'Checking your methods…': 'Controllo i tuoi metodi…',
  'Reading what is installed and connected.': 'Leggo cosa è installato e collegato.',
  All: 'Tutti',
  Recommended: 'Consigliati',
  'On for most people': 'Attivi per la maggior parte delle persone',
  'More methods': 'Altri metodi',
  'Useful in specific situations': 'Utili in situazioni specifiche',
};
