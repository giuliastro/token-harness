/**
 * Home: is Token Harness working, and what has it saved. Only large, true figures appear here:
 * measured tool-output reduction, delegated tokens read from local transcripts and the live plan
 * balance. Estimates are labelled; paired-evidence detail lives in Details.
 */
export const GUIDE_HOME_JS = String.raw`
  // Opus 5.5 list prices (USD per million tokens), used only for the labelled value estimate.
  const PRICE_CACHE_WRITE = 5;
  const PRICE_CACHE_READ = 0.2;
  const REREAD_TURNS = 20;

  function measuredTokenRows() {
    return (current?.savings?.rows || []).filter(row => row.unit === 'tokens' && row.measurement === 'Measured local output' && row.saved > 0);
  }

  function estimatedRows() {
    return (current?.savings?.rows || []).filter(row => row.measurement === 'Local estimate' && row.saved > 0);
  }

  function delegatedUsage() {
    const harnesses = (current?.usage?.harnesses || []).filter(item => item.state === 'observed');
    const total = harnesses.reduce((sum, item) => sum + (item.delegated?.total || 0), 0);
    return { harnesses, total, days: current?.usage?.days || 30 };
  }

  function homeAssessment() {
    const agents = activeAgents();
    if (!agents.length)
      return { tone: 'warn', title: t('No coding agent found'), detail: t('Install Claude Code or Codex, open a terminal where it works, then start Token Harness again.') };
    const routing = agents.filter(agent => routingState(agent).state === 'action');
    if (routing.length)
      return {
        tone: 'warn',
        title: t('One step left'),
        detail: routing.map(agent => agent.name + ': ' + routingState(agent).label).join(' · '),
        action: [t('Show me'), () => selectView('methods', true)],
      };
    if (current?.stack?.state === 'attention')
      return { tone: 'warn', title: t('A method needs a check'), detail: t('Something changed outside Token Harness. A quick check shows what.'), action: [t('Re-check health'), () => readOnlyOperation('verify')] };
    if (recommendedMissing())
      return { tone: 'warn', title: t('You can save more'), detail: t('The recommended methods are not on for every coding app yet.'), action: [t('Turn on recommended methods'), startOnboarding] };
    return { tone: 'good', title: t('Token Harness is working'), detail: t('Everything is running. There is nothing you need to do.') };
  }

  function statusIcon(tone) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', tone === 'good' ? 'M5 12.5l4.5 4.5L19 7.5' : 'M12 7v6M12 17h.01');
    svg.append(path);
    return svg;
  }

  function renderHomeStatus(root) {
    const assessment = homeAssessment();
    const band = node('section', undefined, 'card status-band ' + assessment.tone);
    const icon = node('div', undefined, 'status-icon');
    icon.append(statusIcon(assessment.tone));
    const copy = node('div', undefined, 'status-copy');
    copy.append(node('h2', assessment.title), node('p', assessment.detail));
    band.append(icon, copy);
    const side = node('div', undefined, 'status-side');
    for (const agent of activeAgents()) {
      const chip = node('span', undefined, 'agent-chip ' + routingState(agent).state);
      chip.append(node('span', undefined, 'dot'), node('span', agent.name));
      side.append(chip);
    }
    if (assessment.action) side.append(actionButton(assessment.action[0], assessment.action[1]));
    band.append(side);
    root.append(band);
  }

  function periodControl() {
    const group = node('div', undefined, 'segmented');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', t('Period'));
    for (const [value, label] of [['all', t('All time')], ['30d', t('30 days')], ['7d', t('7 days')]]) {
      const button = node('button', label);
      button.type = 'button';
      button.setAttribute('aria-pressed', String(period === value));
      button.addEventListener('click', () => changePeriod(value));
      group.append(button);
    }
    return group;
  }

  function dailyChart(daily) {
    const points = daily.slice(-30);
    if (points.length < 2) return null;
    const ns = 'http://www.w3.org/2000/svg';
    const width = 640, height = 170, left = 44, right = 10, top = 10, bottom = 24;
    const max = Math.max(...points.map(point => point.saved), 1);
    const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
    const step = [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(size => max / size <= 4) || magnitude * 10;
    const ceiling = Math.ceil(max / step) * step;
    const x = index => left + index * (width - left - right) / (points.length - 1);
    const y = value => top + (height - top - bottom) * (1 - value / ceiling);
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', t('Tokens saved per day'));
    const add = (tagName, attrs, text) => {
      const element = document.createElementNS(ns, tagName);
      for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
      if (text !== undefined) element.textContent = text;
      svg.append(element);
      return element;
    };
    for (let value = 0; value <= ceiling + 1e-9; value += step) {
      add('line', { x1: left, x2: width - right, y1: y(value), y2: y(value), class: 'grid' });
      add('text', { x: left - 8, y: y(value) + 3.5, 'text-anchor': 'end' }, value ? compact(value) : '0');
    }
    const line = points.map((point, index) => (index ? 'L' : 'M') + x(index).toFixed(1) + ',' + y(point.saved).toFixed(1)).join(' ');
    add('path', { d: line + ' L' + x(points.length - 1) + ',' + y(0) + ' L' + x(0) + ',' + y(0) + ' Z', class: 'area' });
    add('path', { d: line, class: 'line' });
    add('circle', { cx: x(points.length - 1), cy: y(points[points.length - 1].saved), r: 4.5, class: 'end' });
    for (let index = 0; index < points.length; index += Math.max(1, Math.round(points.length / 5))) {
      const label = new Date(points[index].date + 'T00:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
      add('text', { x: x(index), y: height - 6, 'text-anchor': 'middle' }, label);
    }
    return svg;
  }

  function renderSavedHero(root) {
    const card = node('section', undefined, 'card hero');
    const head = node('div', undefined, 'hero-head');
    head.append(node('span', t('Tokens your agents did not have to read'), 'eyebrow'), periodControl());
    card.append(head);
    const rows = measuredTokenRows();
    const total = rows.reduce((sum, row) => sum + row.saved, 0);
    if (!total) {
      card.append(
        node('div', '0', 'big-number muted'),
        node('p', t('Results appear here after you use Claude Code or Codex with a method turned on.'), 'hero-sub'),
      );
      root.append(card);
      return;
    }
    const big = node('div', undefined, 'big-number');
    big.append(node('span', compact(total)), node('small', t('tokens')));
    card.append(big, node('p', t('Command and log output that Token Harness shortened before your agent read it.'), 'hero-sub'));
    const low = total / 1e6 * PRICE_CACHE_WRITE;
    const high = total / 1e6 * (PRICE_CACHE_WRITE + REREAD_TURNS * PRICE_CACHE_READ);
    const estimate = node('div', undefined, 'estimate');
    estimate.append(
      node('strong', '≈ ' + money(low) + '–' + money(high)),
      node('span', t('at API prices')),
      tag(t('Estimate'), 'estimated'),
    );
    const info = actionButton('?', explainEstimate, 'info-button');
    info.setAttribute('aria-label', t('How is this estimated?'));
    estimate.append(info);
    card.append(estimate);
    for (const row of estimatedRows())
      card.append(node('p', t('Plus {amount} {unit} trimmed from logs by {provider} (estimate).', {
        amount: compact(row.saved), unit: row.unit === 'tokens' ? t('tokens') : t('characters'), provider: row.provider,
      }), 'caption'));
    const chart = current?.savings?.daily?.length ? dailyChart(current.savings.daily) : null;
    if (chart) {
      const wrap = node('div', undefined, 'chart');
      wrap.append(node('span', t('Saved per day'), 'eyebrow'), chart);
      card.append(wrap);
    }
    root.append(card);
  }

  function explainEstimate() {
    modal(t('How the estimate works'));
    $('modal-content').append(
      node('p', t('We price the tokens your agents did not read at Claude Opus 5.5 list prices. The low end counts each token once, as a cache write at $5 per million. The high end adds the re-reads it would have caused over about 20 later turns, at $0.20 per million each.')),
      node('p', t('Subscription plans do not bill per token, so this shows the value of the room you freed, not money refunded.')),
    );
    $('modal-actions').append(modalClose(t('Got it')));
  }

  function renderRoutingPanel(root) {
    const card = node('section', undefined, 'card panel routing-panel');
    card.append(node('span', t('Work handled by cheaper models'), 'eyebrow'));
    const usage = delegatedUsage();
    const agents = activeAgents();
    const anyOn = agents.some(agent => routingState(agent).configured);
    if (usage.total > 0) {
      const big = node('div', undefined, 'mid-number');
      big.append(node('span', compact(usage.total)), node('small', t('tokens · last {days} days', { days: usage.days })));
      card.append(big, node('p', t('Work that Haiku, Sonnet or Luna did instead of your main model.'), 'caption'));
      const bars = node('div', undefined, 'bars');
      for (const item of usage.harnesses.filter(entry => entry.delegated?.total > 0).sort((a, b) => b.delegated.total - a.delegated.total)) {
        const row = node('div', undefined, 'bar-row');
        const bar = node('div', undefined, 'bar');
        const fill = node('i');
        fill.style.width = Math.max(2, item.delegated.total / usage.total * 100) + '%';
        bar.append(fill);
        row.append(node('span', agentName(item.harnessId)), bar, node('span', compact(item.delegated.total), 'num'));
        bars.append(row);
      }
      card.append(bars);
    } else if (anyOn) {
      card.append(node('p', t('Routing is on. Work handed to cheaper models will appear here after you use your agents.'), 'panel-text'));
    } else {
      card.append(
        node('p', t('Model routing hands simple work to cheaper models. It is the method that stretches a plan the most.'), 'panel-text'),
        actionButton(t('Turn on model routing'), () => selectView('methods', true)),
      );
    }
    root.append(card);
  }

  function allowanceLabel(label) {
    const text = String(label || '').toLowerCase();
    if (text.includes('5-hour') || text.includes('five')) return t('5-hour window');
    if (text.includes('week')) return t('Weekly');
    return label;
  }

  function meter(agent, window) {
    const wrap = node('div', undefined, 'meter');
    const ns = 'http://www.w3.org/2000/svg';
    const radius = 22, circumference = 2 * Math.PI * radius;
    const value = Math.max(0, Math.min(100, window.remaining));
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 56 56');
    svg.setAttribute('class', 'ring');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', agent.name + ' · ' + allowanceLabel(window.label) + ' · ' + t('{n}% left', { n: count(value, 0) }));
    const track = document.createElementNS(ns, 'circle');
    const fill = document.createElementNS(ns, 'circle');
    for (const circle of [track, fill]) {
      circle.setAttribute('cx', '28'); circle.setAttribute('cy', '28'); circle.setAttribute('r', String(radius));
    }
    track.setAttribute('class', 'track');
    fill.setAttribute('class', 'value ' + (value < 25 ? 'low' : value < 60 ? 'mid' : ''));
    fill.setAttribute('stroke-dasharray', circumference.toFixed(1));
    fill.setAttribute('stroke-dashoffset', (circumference * (1 - value / 100)).toFixed(1));
    fill.setAttribute('transform', 'rotate(-90 28 28)');
    const label = document.createElementNS(ns, 'text');
    label.setAttribute('x', '28'); label.setAttribute('y', '33'); label.setAttribute('text-anchor', 'middle');
    label.textContent = count(value, 0);
    svg.append(track, fill, label);
    const copy = node('div');
    copy.append(node('strong', agent.name), node('span', allowanceLabel(window.label) + ' · ' + t('{n}% left', { n: count(value, 0) }), 'caption'));
    wrap.append(svg, copy);
    return wrap;
  }

  function renderPlanPanel(root) {
    const card = node('section', undefined, 'card panel');
    card.append(node('span', t('Your plan right now'), 'eyebrow'));
    const meters = node('div', undefined, 'meters');
    for (const agent of activeAgents())
      for (const window of agent.allowance || [])
        if (Number.isFinite(window.remaining)) meters.append(meter(agent, window));
    if (meters.children.length) card.append(meters);
    else {
      card.append(node('p', t('Plan usage is not readable yet.'), 'panel-text'));
      const helpAgent = activeAgents().find(agent => agent.allowanceAction?.kind === 'help');
      if (helpAgent) card.append(actionButton(t('Show plan usage'), () => runAgentAction(helpAgent.allowanceAction), 'secondary'));
    }
    root.append(card);
  }

  function kpi(label, value, detail) {
    const card = node('section', undefined, 'card kpi');
    card.append(node('span', label, 'eyebrow'), node('strong', value, 'kpi-value'), node('p', detail));
    return card;
  }

  function renderKpis(root) {
    const row = node('div', undefined, 'kpi-row');
    const started = activeAgents().reduce((sum, agent) => sum + (agent.promptRouting?.subagentsStarted || 0), 0);
    const tokenRows = measuredTokenRows();
    const operations = tokenRows.reduce((sum, item) => sum + (item.operations || 0), 0);
    const best = [...tokenRows].sort((a, b) => b.saved - a.saved)[0];
    if (started) row.append(kpi(t('Tasks delegated'), count(started, 0), t('Handed to a smaller model in the last 30 days.')));
    if (operations) row.append(kpi(t('Commands shortened'), count(operations, 0), t('Each one meant less for your agent to read.')));
    if (best?.impact?.percent) row.append(kpi(t('Shorter output'), percentText(best.impact.percent), t('On average, for the commands that were shortened.')));
    if (row.children.length) root.append(row);
  }

  function renderHome() {
    const root = $('home-root');
    root.replaceChildren();
    if (!current) {
      root.append(progress(t('Checking your computer…'), t('Looking for Claude Code, Codex and your methods.')));
      return;
    }
    renderHomeStatus(root);
    const grid = node('div', undefined, 'home-grid');
    renderSavedHero(grid);
    const side = node('div', undefined, 'home-side');
    renderRoutingPanel(side);
    renderPlanPanel(side);
    grid.append(side);
    root.append(grid);
    renderKpis(root);
  }
`;

export const GUIDE_HOME_IT: Readonly<Record<string, string>> = {
  'No coding agent found': 'Nessun agente di sviluppo trovato',
  'Install Claude Code or Codex, open a terminal where it works, then start Token Harness again.':
    'Installa Claude Code o Codex, apri un terminale in cui funziona e riavvia Token Harness.',
  'One step left': 'Manca un passaggio',
  'Show me': 'Mostrami',
  'A method needs a check': 'Un metodo va controllato',
  'Something changed outside Token Harness. A quick check shows what.':
    'Qualcosa è cambiato fuori da Token Harness. Un controllo rapido mostra cosa.',
  'You can save more': 'Puoi risparmiare di più',
  'The recommended methods are not on for every coding app yet.':
    'I metodi consigliati non sono ancora attivi per tutte le app di sviluppo.',
  'Turn on recommended methods': 'Attiva i metodi consigliati',
  'Token Harness is working': 'Token Harness sta lavorando',
  'Everything is running. There is nothing you need to do.':
    'È tutto attivo. Non devi fare niente.',
  Period: 'Periodo',
  'All time': 'Sempre',
  '30 days': '30 giorni',
  '7 days': '7 giorni',
  'Tokens saved per day': 'Token risparmiati al giorno',
  'Tokens your agents did not have to read': 'Token che i tuoi agenti non hanno dovuto leggere',
  'Results appear here after you use Claude Code or Codex with a method turned on.':
    'I risultati compaiono qui dopo che usi Claude Code o Codex con un metodo attivo.',
  tokens: 'token',
  characters: 'caratteri',
  'Command and log output that Token Harness shortened before your agent read it.':
    "Output di comandi e log che Token Harness ha accorciato prima che l'agente lo leggesse.",
  'at API prices': 'ai prezzi API',
  Estimate: 'Stima',
  'How is this estimated?': 'Come viene stimato?',
  'Plus {amount} {unit} trimmed from logs by {provider} (estimate).':
    'In più {amount} {unit} tolti dai log da {provider} (stima).',
  'Saved per day': 'Risparmio al giorno',
  'How the estimate works': 'Come funziona la stima',
  'We price the tokens your agents did not read at Claude Opus 5.5 list prices. The low end counts each token once, as a cache write at $5 per million. The high end adds the re-reads it would have caused over about 20 later turns, at $0.20 per million each.':
    'Valutiamo i token che i tuoi agenti non hanno letto ai prezzi di listino di Claude Opus 5.5. Il valore basso conta ogni token una volta, come scrittura in cache a 5 $ per milione. Quello alto aggiunge le riletture che avrebbe causato in circa 20 turni successivi, a 0,20 $ per milione ciascuna.',
  'Subscription plans do not bill per token, so this shows the value of the room you freed, not money refunded.':
    'I piani in abbonamento non si pagano a token: il valore indica lo spazio liberato, non soldi rimborsati.',
  'Got it': 'Ho capito',
  'Work handled by cheaper models': 'Lavoro gestito da modelli più economici',
  'tokens · last {days} days': 'token · ultimi {days} giorni',
  'Work that Haiku, Sonnet or Luna did instead of your main model.':
    'Lavoro fatto da Haiku, Sonnet o Luna al posto del modello principale.',
  'Routing is on. Work handed to cheaper models will appear here after you use your agents.':
    "L'instradamento è attivo. Il lavoro affidato ai modelli più economici comparirà qui dopo che usi i tuoi agenti.",
  'Model routing hands simple work to cheaper models. It is the method that stretches a plan the most.':
    "L'instradamento del modello affida il lavoro semplice a modelli più economici. È il metodo che fa durare di più il piano.",
  'Turn on model routing': "Attiva l'instradamento del modello",
  '5-hour window': 'Finestra 5 ore',
  Weekly: 'Settimanale',
  '{n}% left': '{n}% rimasto',
  'Your plan right now': 'Il tuo piano adesso',
  'Plan usage is not readable yet.': 'I consumi del piano non sono ancora leggibili.',
  'Show plan usage': 'Mostra i consumi del piano',
  'Tasks delegated': 'Compiti delegati',
  'Handed to a smaller model in the last 30 days.':
    'Affidati a un modello più piccolo negli ultimi 30 giorni.',
  'Commands shortened': 'Comandi accorciati',
  'Each one meant less for your agent to read.':
    "Ognuno ha significato meno da leggere per l'agente.",
  'Shorter output': 'Output più corto',
  'On average, for the commands that were shortened.': 'In media, sui comandi accorciati.',
  'Checking your computer…': 'Controllo il tuo computer…',
  'Looking for Claude Code, Codex and your methods.': 'Cerco Claude Code, Codex e i tuoi metodi.',
};
