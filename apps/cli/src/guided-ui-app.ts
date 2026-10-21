/** App shell behaviour: views, refresh, period, language, theme, advanced view and polling. */
export const GUIDE_APP_JS = String.raw`
  const VIEWS = ['home', 'methods', 'details'];

  function applyStaticText() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(element => { element.textContent = t(element.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria]').forEach(element => { element.setAttribute('aria-label', t(element.dataset.i18nAria)); });
    document.querySelectorAll('[data-lang]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.lang === lang)); });
    if (!busy) $('live-status').textContent = t('Nothing changes without your approval');
    $('advanced-toggle').setAttribute('aria-checked', String(advanced));
    $('tab-details').hidden = !advanced;
  }

  function selectView(view, focus = false) {
    if (!VIEWS.includes(view)) return;
    if (view === 'details' && !advanced) view = 'home';
    selectedView = view;
    const onboarding = !!current && onboardingActive();
    $('view-onboarding').hidden = !onboarding;
    $('main-tabs').hidden = onboarding;
    for (const key of VIEWS) {
      const active = key === view && !onboarding;
      $('view-' + key).hidden = !active;
      $('tab-' + key).setAttribute('aria-selected', String(key === view));
      $('tab-' + key).tabIndex = key === view ? 0 : -1;
    }
    if (view === 'details' && current) { renderDetails(); loadActivity(); loadOperations(); }
    if (focus) {
      if (!onboarding) $('tab-' + view).focus();
      $('main').scrollIntoView({ block: 'start' });
    }
  }

  function renderNotices() {
    const root = $('notices');
    root.replaceChildren();
    for (const notice of current?.notices || []) root.append(node('div', notice, 'notice-box'));
  }

  function render() {
    applyStaticText();
    renderNotices();
    if (current && onboardingActive()) renderOnboarding();
    renderHome();
    renderMethods();
    if (advanced && current) renderDetails();
    selectView(selectedView);
  }

  async function refresh(force = false) {
    if (busy || reading) return;
    reading = true;
    setError('');
    setStatus(current ? t('Refreshing. Current data stays visible.') : t('Checking your agents and methods…'), true);
    $('refresh').disabled = true;
    const progressTimer = setInterval(() => { if (!document.hidden) loadActivity(); }, 700);
    try {
      await ensureSession();
      if (force) periodCache.clear();
      current = await request('/api/overview?period=' + encodeURIComponent(period) + (force ? '&refresh=1' : ''));
      periodCache.set(period, current);
      $('stale-state').hidden = true;
      $('stale-state').textContent = '';
      render();
      await loadActivity();
      if (selectedView === 'details') await loadOperations();
      setStatus(t('Updated at {time}', { time: new Date(current.generatedAt).toLocaleTimeString(locale()) }), false);
    } catch (error) {
      setError(error.name === 'TimeoutError' ? t('The check took too long. Your last results are still shown; choose Refresh to try again.') : error.message);
      setStatus(t('The check needs attention.'), false);
    } finally {
      clearInterval(progressTimer);
      reading = false;
      $('refresh').disabled = false;
      if (current && !updateCheckStarted) checkUpdatesOnStartup();
    }
  }

  async function changePeriod(value) {
    if (value === period) return;
    period = value;
    const cached = periodCache.get(period);
    if (cached) {
      current = cached;
      render();
      return;
    }
    if (busy || reading) return;
    reading = true;
    setStatus(t('Loading this period…'), true);
    try {
      await ensureSession();
      current = await request('/api/overview?period=' + encodeURIComponent(period));
      periodCache.set(period, current);
      render();
      setStatus(t('Updated at {time}', { time: new Date(current.generatedAt).toLocaleTimeString(locale()) }), false);
    } catch (error) {
      setError(error.message);
      setStatus(t('The check needs attention.'), false);
    } finally {
      reading = false;
    }
  }

  async function checkUpdatesOnStartup() {
    if (updateCheckStarted) return;
    if ($('modal').open) {
      $('modal').addEventListener('close', checkUpdatesOnStartup, { once: true });
      return;
    }
    if (busy || reading) {
      setTimeout(checkUpdatesOnStartup, 1000);
      return;
    }
    updateCheckStarted = true;
    try {
      await ensureSession();
      const result = await request('/api/update-check', { period, background: true });
      if (busy || reading || $('modal').open) {
        updateCheckStarted = false;
        if ($('modal').open) $('modal').addEventListener('close', checkUpdatesOnStartup, { once: true });
        else setTimeout(checkUpdatesOnStartup, 1000);
        return;
      }
      if (result.stack && current) {
        current = { ...current, stack: result.stack };
        render();
      }
      const root = $('update-notice');
      root.replaceChildren();
      if (!result.updatesAvailable) {
        root.hidden = true;
        return;
      }
      const copy = node('div');
      copy.append(node('strong', t('An update is available')), node('p', (result.messages || []).join(' '), 'caption'));
      root.append(copy, actionButton(t('Review update'), () => readOnlyOperation('update'), 'secondary'));
      root.hidden = false;
    } catch {
      // The startup version check is supplementary; Details keeps a manual update check.
    }
  }

  async function pollRouting() {
    if (document.hidden || busy || reading || $('modal').open || !current) return;
    try {
      const result = await request('/api/routing');
      if (busy || reading || $('modal').open || !Array.isArray(result.agents)) return;
      const byId = new Map(result.agents.map(agent => [agent.id, agent.promptRouting]));
      const previous = new Map((current.agents || []).map(agent => [agent.id, agent.promptRouting]));
      if (![...byId].some(([id, routing]) => JSON.stringify(previous.get(id)) !== JSON.stringify(routing))) return;
      current = {
        ...current,
        agents: (current.agents || []).map(agent => (byId.has(agent.id) ? { ...agent, promptRouting: byId.get(agent.id) } : agent)),
      };
      if (document.activeElement?.closest?.('#view-methods, #view-details')) return;
      render();
    } catch {
      // Hook receipts are supplementary; the app stays usable if this read fails.
    }
  }

  function applyTheme(value) {
    $('theme').value = value;
    document.documentElement.dataset.theme = value === 'system' ? '' : value;
  }

  document.querySelectorAll('[data-view]').forEach(button => {
    button.addEventListener('click', () => selectView(button.dataset.view, true));
  });
  $('main-tabs').addEventListener('keydown', event => {
    const views = VIEWS.filter(view => advanced || view !== 'details');
    const index = views.indexOf(selectedView);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? views.length - 1
      : event.key === 'ArrowRight' ? (index + 1) % views.length
      : event.key === 'ArrowLeft' ? (index + views.length - 1) % views.length : null;
    if (next === null) return;
    event.preventDefault();
    selectView(views[next], true);
  });
  document.querySelectorAll('[data-lang]').forEach(button => {
    button.addEventListener('click', () => {
      lang = button.dataset.lang;
      storage.set('token-harness-lang', lang);
      render();
      if (current && !reading) setStatus(t('Updated at {time}', { time: new Date(current.generatedAt).toLocaleTimeString(locale()) }), false);
    });
  });
  $('advanced-toggle').addEventListener('click', () => {
    advanced = !advanced;
    storage.set('token-harness-advanced', advanced ? 'on' : 'off');
    if (!advanced && selectedView === 'details') selectedView = 'home';
    render();
    if (advanced) selectView('details', true);
  });
  $('refresh').addEventListener('click', () => refresh(true));
  $('theme').addEventListener('change', () => {
    storage.set('token-harness-theme', $('theme').value);
    applyTheme($('theme').value);
  });
  $('modal').addEventListener('cancel', event => {
    if (busy && $('live-status').textContent === t('Applying only the approved change…')) event.preventDefault();
    else closeModal();
  });

  if (window.location?.hash === '#welcome') onboardingForced = true;
  applyTheme(storage.get('token-harness-theme') || 'system');
  applyStaticText();
  setStatus(t('Checking your setup…'), true);
  setBusy(false);
  renderHome();
  renderMethods();
  selectView('home');
  refresh(false);
  setInterval(() => { if (!document.hidden && selectedView === 'details') loadActivity(); }, 4000);
  setInterval(pollRouting, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollRouting(); });
`;

export const GUIDE_APP_IT: Readonly<Record<string, string>> = {
  'Refreshing. Current data stays visible.': 'Aggiorno. I dati attuali restano visibili.',
  'Checking your agents and methods…': 'Controllo agenti e metodi…',
  'The check took too long. Your last results are still shown; choose Refresh to try again.':
    'Il controllo è durato troppo. Restano visibili gli ultimi risultati; scegli Aggiorna per riprovare.',
  'The check needs attention.': 'Il controllo richiede attenzione.',
  'Loading this period…': 'Carico questo periodo…',
  'An update is available': 'È disponibile un aggiornamento',
  'Review update': "Controlla l'aggiornamento",
  // Static page text (data-i18n attributes in the HTML shell).
  'Skip to content': 'Vai al contenuto',
  'Use less. Do more.': 'Consuma meno. Fai di più.',
  Home: 'Home',
  Methods: 'Metodi',
  Details: 'Dettagli',
  'Advanced view': 'Vista avanzata',
  Language: 'Lingua',
  Appearance: 'Aspetto',
  System: 'Sistema',
  Light: 'Chiaro',
  Dark: 'Scuro',
  Refresh: 'Aggiorna',
  'Checking your setup…': 'Controllo la configurazione…',
  'Every way Token Harness helps you use less. Turn each one on or off, update it, or read when it helps.':
    'Tutti i modi in cui Token Harness ti fa consumare meno. Attivali o spegnili, aggiornali o leggi quando aiutano.',
  'Every figure with its source and how it was measured.':
    'Ogni numero con la sua fonte e il modo in cui è stato misurato.',
  'Local only. No account. Nothing changes without your approval.':
    'Solo in locale. Nessun account. Niente cambia senza la tua approvazione.',
  'Main views': 'Viste principali',
  Review: 'Controlla',
};
