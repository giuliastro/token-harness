/** Advanced local advice uses the same engines as the CLI; no commands or paths are executed. */
export const GUIDE_TOOLS_JS = String.raw`
  function toolText(key) {
    const labels = {
      "Coding agent": t("Coding agent"),
      "Kind of work": t("Kind of work"),
      "Preference": t("Preference"),
      "Allowance reserve (%)": t("Allowance reserve (%)"),
      "Remaining tasks (optional)": t("Remaining tasks (optional)"),
      "Current coding agent": t("Current coding agent"),
      "Compare with": t("Compare with"),
      "Small routine edits": t("Small routine edits"),
      "Everyday coding": t("Everyday coding"),
      "Complex work": t("Complex work"),
      "Critical changes": t("Critical changes"),
      "What needs to be finished?": t("What needs to be finished?"),
      "Next action": t("Next action"),
      "Acceptance checks": t("Acceptance checks"),
      "Facts to keep": t("Facts to keep"),
      "Decisions already made": t("Decisions already made"),
      "Changed files": t("Changed files"),
      "Validation completed": t("Validation completed"),
      "Still unresolved": t("Still unresolved"),
      "Comparison name": t("Comparison name"),
      "Step": t("Step"),
      "Comparison arm": t("Comparison arm"),
      "Initial version or fixture": t("Initial version or fixture"),
      "Actual check result": t("Actual check result"),
      "Total attempts": t("Total attempts"),
      "Failed attempts": t("Failed attempts"),
      "Balance quality and usage": t("Balance quality and usage"),
      "Use less on routine work": t("Use less on routine work"),
      "Quality first": t("Quality first"),
      "Prepare an arm": t("Prepare an arm"),
      "Record outcome and restore": t("Record outcome and restore"),
      "Read the four-arm report": t("Read the four-arm report"),
      "Compression off · routing off": t("Compression off · routing off"),
      "Compression on · routing off": t("Compression on · routing off"),
      "Compression off · routing on": t("Compression off · routing on"),
      "Compression on · routing on": t("Compression on · routing on"),
      "Not checked": t("Not checked"),
      "Checks passed": t("Checks passed"),
      "Checks failed": t("Checks failed"),
    };
    return labels[key] || key;
  }
  function toolField(parent, labelText, id, kind = 'text', choices = null) {
    const label = node('label', toolText(labelText));
    label.htmlFor = id;
    const control = node(choices ? 'select' : kind === 'textarea' ? 'textarea' : 'input');
    control.id = id;
    if (!choices && kind !== 'textarea') control.type = kind;
    if (choices) for (const [value, text] of choices) {
      const option = node('option', toolText(text)); option.value = value; control.append(option);
    }
    else control.maxLength = kind === 'textarea' ? 2000 : 80;
    if (kind === 'textarea') control.rows = 3;
    if (choices?.length) control.value = choices[0][0];
    const row = node('div', undefined, 'tool-field'); row.append(label, control); parent.append(row);
    return control;
  }

  function renderToolResult(root, result, mode) {
    root.replaceChildren();
    const envelope = result.envelope || {};
    const data = envelope.data || {};
    if (mode === 'handoff' && typeof data.markdown === 'string') {
      root.append(messageBox(t('Handoff ready'), t('Copy this summary into the other coding agent. No session was moved.')));
      const output = node('pre', data.markdown, 'tool-output');
      root.append(output, copyRow(data.markdown));
      if (data.truncated) root.append(messageBox(t('Summary shortened'), t('The byte limit shortened this summary. Review the retained facts and omission counts before using it.')));
    } else if (mode === 'schedule') {
      root.append(messageBox(t('Workload advice'), t('Assigned {assigned} of {total} requested tasks using the available evidence.', { assigned: data.allocatedTasks ?? 0, total: data.requestedTasks ?? 0 })));
      for (const reason of data.reasons || []) if (reason.summary) root.append(node('p', reason.summary));
      if (data.allocatedTasks === 0) root.append(messageBox(t('More evidence needed'), t('Missing quality or allowance evidence stays unknown. Keep your current workflow until a comparison is supported.')));
    } else {
      for (const agent of data.harnesses || []) {
        root.append(messageBox(agentName(agent.harnessId), t('Suggested reasoning: {level}', { level: agent.recommendedEffort || t('Unknown') })));
        for (const reason of agent.reasons || []) if (reason.summary) root.append(node('p', reason.summary));
      }
    }
    for (const diagnostic of envelope.diagnostics || []) if (diagnostic.message)
      root.append(messageBox(t('Evidence and limitations'), diagnostic.message, diagnostic.severity === 'error' ? 'warn' : 'safe'));
    if (envelope.exitCode) root.append(messageBox(t('Advice could not be completed'), t('Review the diagnostic details. No settings were changed.'), 'warn'));
    const details = node('details');
    details.append(node('summary', t('Technical report')), node('pre', JSON.stringify(envelope, null, 2), 'tool-output'));
    root.append(details);
    root.setAttribute('aria-live', 'polite');
  }

  function openAdvancedTool(mode) {
    if (busy) return;
    const title = mode === 'plan' ? t('Plan my workload') : mode === 'schedule' ? t('Compare coding agents') : t('Prepare a handoff');
    const run = modal(title);
    const form = node('form', undefined, 'tool-form');
    form.setAttribute('aria-label', title);
    $('modal-content').append(messageBox(t('Advice only'), t('These tools read local evidence or format your summary. They do not change settings, launch agents or move work automatically.')), form);
    const agents = [['codex', 'Codex'], ['claude', 'Claude Code']];
    const fields = {};
    if (mode === 'plan') {
      fields.harness = toolField(form, 'Coding agent', 'tool-agent', 'text', agents);
      fields.task = toolField(form, 'Kind of work', 'tool-task', 'text', [['standard', 'Everyday coding'], ['mechanical', 'Small routine edits'], ['hard', 'Complex work'], ['critical', 'Critical changes']]);
      fields.profile = toolField(form, 'Preference', 'tool-profile', 'text', [['balanced', 'Balance quality and usage'], ['economy', 'Use less on routine work'], ['quality', 'Quality first']]);
      fields.reserve = toolField(form, 'Allowance reserve (%)', 'tool-reserve', 'number');
      fields.reserve.min = '0'; fields.reserve.max = '90'; fields.reserve.value = '20';
      fields.tasksLeft = toolField(form, 'Remaining tasks (optional)', 'tool-tasks-left', 'number');
      fields.tasksLeft.min = '1'; fields.tasksLeft.max = '10000';
    } else if (mode === 'schedule') {
      fields.current = toolField(form, 'Current coding agent', 'tool-current', 'text', agents);
      fields.candidate = toolField(form, 'Compare with', 'tool-candidate', 'text', [...agents].reverse());
      for (const [key, label] of [['mechanical', 'Small routine edits'], ['standard', 'Everyday coding'], ['hard', 'Complex work'], ['critical', 'Critical changes']]) {
        fields[key] = toolField(form, label, 'tool-' + key, 'number'); fields[key].min = '0'; fields[key].max = '10000'; fields[key].value = '0';
      }
      form.append(node('p', t('Enter the tasks you actually have left. Token Harness does not estimate your backlog.'), 'caption'));
    } else {
      fields.objective = toolField(form, 'What needs to be finished?', 'tool-objective', 'textarea'); fields.objective.required = true;
      fields.nextAction = toolField(form, 'Next action', 'tool-next-action', 'textarea'); fields.nextAction.required = true;
      for (const [key, label] of [['acceptance', 'Acceptance checks'], ['facts', 'Facts to keep'], ['decisions', 'Decisions already made'], ['changedFiles', 'Changed files'], ['validation', 'Validation completed'], ['unresolved', 'Still unresolved']])
        fields[key] = toolField(form, label, 'tool-' + key, 'textarea');
      form.append(node('p', t('Optional lists: one item per line. File names are included as text; no files are opened.'), 'caption'));
    }
    const output = node('div'); $('modal-content').append(output);
    const submit = async event => {
      event?.preventDefault?.();
      if (busy || run !== modalRun) return;
      if (form.reportValidity && !form.reportValidity()) return;
      let body;
      if (mode === 'plan') body = { mode, harness: fields.harness.value, task: fields.task.value, profile: fields.profile.value, reserve: Number(fields.reserve.value), ...(fields.tasksLeft.value ? { tasksLeft: Number(fields.tasksLeft.value) } : {}) };
      else if (mode === 'schedule') body = { mode, current: fields.current.value, candidate: fields.candidate.value, workload: Object.fromEntries(['mechanical', 'standard', 'hard', 'critical'].map(key => [key, Number(fields[key].value)])) };
      else {
        body = { mode, objective: fields.objective.value, nextAction: fields.nextAction.value };
        for (const key of ['acceptance', 'facts', 'decisions', 'changedFiles', 'validation', 'unresolved']) body[key] = fields[key].value.split('\n').map(item => item.trim()).filter(Boolean);
      }
      setBusy(true, false); output.replaceChildren(progress(t('Reading local evidence'), t('No settings are changing.')));
      try {
        await ensureSession();
        const result = await request('/api/tools', body);
        if (run !== modalRun || !$('modal').open) return;
        renderToolResult(output, result, mode);
      } catch (error) { if (run === modalRun) { output.replaceChildren(messageBox(t('Check your options'), error.message, 'warn')); } }
      finally { if (run === modalRun) setBusy(false, false); }
    };
    form.addEventListener('submit', submit);
    $('modal-actions').append(modalClose(), actionButton(mode === 'handoff' ? t('Create summary') : t('Get advice'), submit));
  }
  function openFactorialExperiment() {
    if (busy) return;
    const run = modal(t('Four-arm comparison'));
    $('modal-content').append(messageBox(t('Controlled experiment'), t('Use the same project, starting tree, task and checks in every arm. The app prepares supported configuration only; you run the task in your coding agent. Native trust stays in that agent.')));
    const form = node('form', undefined, 'tool-form'); $('modal-content').append(form);
    const name = toolField(form, 'Comparison name', 'experiment-name'); name.value = 'comparison'; name.required = true; name.pattern = '[a-z0-9]{1,32}';
    form.append(node('p', t('Use lowercase letters and digits. Reuse this name to resume or read the same comparison after reopening.'), 'caption'));
    const mode = toolField(form, 'Step', 'experiment-mode', 'text', [['prepare', 'Prepare an arm'], ['finish', 'Record outcome and restore'], ['report', 'Read the four-arm report']]);
    const variant = toolField(form, 'Comparison arm', 'experiment-variant', 'text', [['baseline', 'Compression off · routing off'], ['compression-only', 'Compression on · routing off'], ['routing-only', 'Compression off · routing on'], ['combined', 'Compression on · routing on']]);
    const preparation = node('div'), finishing = node('div'); form.append(preparation, finishing);
    const agent = toolField(preparation, 'Coding agent', 'experiment-agent', 'text', [['codex', 'Codex'], ['claude', 'Claude Code']]);
    const task = toolField(preparation, 'Kind of work', 'experiment-task', 'text', [['standard', 'Everyday coding'], ['mechanical', 'Small routine edits'], ['hard', 'Complex work'], ['critical', 'Critical changes']]);
    const state = toolField(preparation, 'Initial version or fixture', 'experiment-state'); state.maxLength = 256;
    const quality = toolField(finishing, 'Actual check result', 'experiment-quality', 'text', [['unknown', 'Not checked'], ['passed', 'Checks passed'], ['failed', 'Checks failed']]);
    const attempts = toolField(finishing, 'Total attempts', 'experiment-attempts', 'number'); attempts.value = '1'; attempts.min = '1'; attempts.max = '1000';
    const failed = toolField(finishing, 'Failed attempts', 'experiment-failed', 'number'); failed.value = '0'; failed.min = '0'; failed.max = '1000';
    const updateFields = () => { preparation.hidden = mode.value !== 'prepare'; finishing.hidden = mode.value !== 'finish'; variant.disabled = mode.value === 'report'; state.required = mode.value === 'prepare'; };
    mode.addEventListener('change', updateFields); updateFields();
    const output = node('div'); $('modal-content').append(output);
    const apply = async ticket => {
      if (busy || run !== modalRun || !$('modal').open) return;
      setBusy(true, true); $('modal-actions').replaceChildren(modalClose(t('Working…'), true));
      try {
        const result = await request('/api/experiments', { mode: 'apply', ticket });
        if (run !== modalRun) return;
        output.replaceChildren(messageBox(result.ok ? t('Step completed') : t('Recovery may be needed'), [result.summary, ...(result.messages || [])].join(' '), result.ok ? 'safe' : 'warn'));
        if (!result.ok) output.append(actionButton(t('Review benchmark recovery'), openBenchmarkRecovery, 'secondary'));
        $('modal-actions').replaceChildren(modalClose(t('Done')));
      } catch (error) { if (run === modalRun) { output.replaceChildren(messageBox(t('Review a fresh preview'), error.message, 'warn')); $('modal-actions').replaceChildren(modalClose()); } }
      finally { if (run === modalRun) { setBusy(false, false); refresh(true); } }
    };
    const preview = async event => {
      event?.preventDefault?.(); if (busy || run !== modalRun) return;
      if (form.reportValidity && !form.reportValidity()) return;
      const body = mode.value === 'report' ? { mode: 'report', name: name.value }
        : mode.value === 'prepare' ? { mode: 'prepare', name: name.value, variant: variant.value, harness: agent.value, task: task.value, startingState: state.value }
          : { mode: 'finish', name: name.value, variant: variant.value, quality: quality.value, attempts: Number(attempts.value), failedAttempts: Number(failed.value) };
      setBusy(true, false); output.replaceChildren(progress(t('Preparing a preview'), t('Nothing changes until you approve it.')));
      try {
        await ensureSession(); const result = await request('/api/experiments', body);
        if (run !== modalRun) return;
        if (result.envelope) { output.replaceChildren(); const report = node('pre', JSON.stringify(result.envelope, null, 2), 'tool-output'); report.setAttribute('aria-label', t('Technical report')); output.append(report); }
        else output.replaceChildren(messageBox(t('Review this step'), [result.summary, ...(result.messages || [])].filter(Boolean).join(' '), result.ok ? 'safe' : 'warn'));
        $('modal-actions').replaceChildren(modalClose());
        if (result.ticket) $('modal-actions').append(actionButton(t('Apply reviewed step'), () => apply(result.ticket)));
      } catch (error) { if (run === modalRun) output.replaceChildren(messageBox(t('Check your options'), error.message, 'warn')); }
      finally { if (run === modalRun) setBusy(false, false); }
    };
    form.addEventListener('submit', preview);
    $('modal-actions').append(modalClose(), actionButton(t('Review step'), preview));
  }

  function prepareAppRemoval() {
    if (busy) return;
    modal(t('Prepare to remove the app'));
    $('modal-content').append(messageBox(t('Keep your coding agents working'), t('Review and turn off the connections Token Harness owns before moving or removing its runtime. Your agents, provider packages and manually configured connections stay installed. Reopen this checklist after each reviewed change.')));
    for (const id of optimizerIds()) {
      const component = managedComponent(id);
      if (component?.managedByTokenHarness) $('modal-content').append(actionButton(t('Turn off {name}', { name: optimizerInfo(id).name }), () => reviewRemoval(id), 'secondary'));
    }
    for (const agent of activeAgents()) if (routingState(agent).configured && routingState(agent).state !== 'external')
      $('modal-content').append(actionButton(t('Turn off routing') + ' · ' + agent.name, () => reviewPromptRouting(agent.id, false), 'secondary'));
    $('modal-content').append(messageBox(t('After reviewing connections'), t('Re-check health and review any custom skills or external integrations before removing the app. Close Token Harness, then use your operating system to uninstall it. Keep the saved data and backups if you may reinstall. This checklist does not certify external integrations or remove the app itself.')));
    $('modal-actions').append(modalClose());
  }
`;

export const GUIDE_TOOLS_IT: Readonly<Record<string, string>> = {
  Unknown: 'Sconosciuto',
  'Working…': 'Operazione in corso…',
  'Turn off routing': 'Disattiva instradamento',
  'Four-arm comparison': 'Confronto a quattro varianti',
  'Controlled experiment': 'Esperimento controllato',
  'Comparison name': 'Nome del confronto',
  Step: 'Passaggio',
  'Prepare an arm': 'Prepara una variante',
  'Record outcome and restore': 'Registra esito e ripristina',
  'Read the four-arm report': 'Leggi il report delle quattro varianti',
  'Comparison arm': 'Variante del confronto',
  'Initial version or fixture': 'Versione iniziale o fixture',
  'Actual check result': 'Esito effettivo delle verifiche',
  'Not checked': 'Non verificato',
  'Checks passed': 'Verifiche superate',
  'Checks failed': 'Verifiche fallite',
  'Total attempts': 'Tentativi totali',
  'Failed attempts': 'Tentativi falliti',
  'Use the same project, starting tree, task and checks in every arm. The app prepares supported configuration only; you run the task in your coding agent. Native trust stays in that agent.':
    'Usa lo stesso progetto, stato iniziale, attività e verifiche in ogni variante. L’app prepara solo la configurazione supportata; esegui l’attività nel tuo agente. Le autorizzazioni native restano nell’agente.',
  'Use lowercase letters and digits. Reuse this name to resume or read the same comparison after reopening.':
    'Usa lettere minuscole e cifre. Riutilizza questo nome per riprendere o leggere lo stesso confronto dopo la riapertura.',
  'Step completed': 'Passaggio completato',
  'Recovery may be needed': 'Potrebbe servire un ripristino',
  'Review a fresh preview': 'Esamina una nuova anteprima',
  'Review this step': 'Esamina questo passaggio',
  'Apply reviewed step': 'Applica il passaggio esaminato',
  'Review step': 'Esamina passaggio',
  'Prepare to remove the app': 'Prepara la rimozione dell’app',
  'Keep your coding agents working': 'Mantieni funzionanti i tuoi agenti',
  'Review and turn off the connections Token Harness owns before moving or removing its runtime. Your agents, provider packages and manually configured connections stay installed. Reopen this checklist after each reviewed change.':
    'Esamina e disattiva i collegamenti gestiti da Token Harness prima di spostare o rimuovere il runtime. Agenti, pacchetti provider e collegamenti configurati manualmente restano installati. Riapri questo elenco dopo ogni modifica approvata.',
  'After reviewing connections': 'Dopo aver esaminato i collegamenti',
  'Re-check health and review any custom skills or external integrations before removing the app. Close Token Harness, then use your operating system to uninstall it. Keep the saved data and backups if you may reinstall. This checklist does not certify external integrations or remove the app itself.':
    'Ricontrolla lo stato ed esamina skill personalizzate e integrazioni esterne prima di rimuovere l’app. Chiudi Token Harness, poi disinstallalo dal sistema operativo. Conserva dati e backup se potresti reinstallarlo. Questo elenco non certifica le integrazioni esterne e non rimuove l’app.',
  'Advanced tools': 'Strumenti avanzati',
  'Plan my workload': 'Pianifica il mio lavoro',
  'Compare coding agents': 'Confronta gli agenti',
  'Prepare a handoff': 'Prepara un passaggio di lavoro',
  'Advice only': 'Solo consigli',
  'These tools read local evidence or format your summary. They do not change settings, launch agents or move work automatically.':
    'Questi strumenti leggono le prove locali o preparano un riepilogo. Non modificano impostazioni, avviano agenti o trasferiscono il lavoro automaticamente.',
  'Coding agent': 'Agente di programmazione',
  'Kind of work': 'Tipo di lavoro',
  'Everyday coding': 'Programmazione quotidiana',
  'Small routine edits': 'Piccole modifiche ripetitive',
  'Complex work': 'Lavoro complesso',
  'Critical changes': 'Modifiche critiche',
  Preference: 'Preferenza',
  'Balance quality and usage': 'Equilibrio tra qualità e consumo',
  'Use less on routine work': 'Riduci il consumo sui lavori ripetitivi',
  'Quality first': 'Priorità alla qualità',
  'Allowance reserve (%)': 'Riserva del piano (%)',
  'Remaining tasks (optional)': 'Attività rimanenti (facoltativo)',
  'Current coding agent': 'Agente attuale',
  'Compare with': 'Confronta con',
  'Enter the tasks you actually have left. Token Harness does not estimate your backlog.':
    'Inserisci le attività che ti restano davvero. Token Harness non stima il lavoro arretrato.',
  'What needs to be finished?': 'Che cosa occorre completare?',
  'Next action': 'Prossima azione',
  'Acceptance checks': 'Criteri di accettazione',
  'Facts to keep': 'Informazioni da conservare',
  'Decisions already made': 'Decisioni già prese',
  'Changed files': 'File modificati',
  'Validation completed': 'Verifiche completate',
  'Still unresolved': 'Ancora da risolvere',
  'Optional lists: one item per line. File names are included as text; no files are opened.':
    'Elenchi facoltativi: una voce per riga. I nomi dei file sono inclusi come testo; nessun file viene aperto.',
  'Handoff ready': 'Riepilogo pronto',
  'Copy this summary into the other coding agent. No session was moved.':
    'Copia il riepilogo nell’altro agente. Nessuna sessione è stata trasferita.',
  'Summary shortened': 'Riepilogo abbreviato',
  'The byte limit shortened this summary. Review the retained facts and omission counts before using it.':
    'Il limite di byte ha abbreviato il riepilogo. Controlla le informazioni conservate e le omissioni prima di utilizzarlo.',
  'Workload advice': 'Consiglio sul carico di lavoro',
  'Assigned {assigned} of {total} requested tasks using the available evidence.':
    'Assegnate {assigned} delle {total} attività richieste usando le prove disponibili.',
  'More evidence needed': 'Servono altre prove',
  'Missing quality or allowance evidence stays unknown. Keep your current workflow until a comparison is supported.':
    'Le prove mancanti sulla qualità o sul piano restano sconosciute. Continua come prima finché il confronto non è supportato.',
  'Suggested reasoning: {level}': 'Ragionamento suggerito: {level}',
  'Evidence and limitations': 'Prove e limiti',
  'Advice could not be completed': 'Consiglio non completato',
  'Review the diagnostic details. No settings were changed.':
    'Controlla i dettagli diagnostici. Nessuna impostazione è stata modificata.',
  'Technical report': 'Report tecnico',
  'Reading local evidence': 'Lettura delle prove locali',
  'No settings are changing.': 'Nessuna impostazione viene modificata.',
  'Check your options': 'Controlla le opzioni',
  'Create summary': 'Crea riepilogo',
  'Get advice': 'Ottieni un consiglio',
  'Plan work and prepare a summary without command-line parameters.':
    'Pianifica il lavoro e prepara un riepilogo senza parametri da riga di comando.',
  'Download desktop update': 'Scarica aggiornamento desktop',
};
