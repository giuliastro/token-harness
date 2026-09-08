/** Browser controller; dynamic observations are inserted using textContent, never HTML. */
export const GUIDE_JS = String.raw`
'use strict';
const $ = id => document.getElementById(id);
const node = (tag, text, cls) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (cls) element.className = cls;
  return element;
};
const count = value => new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
const date = value => value ? new Date(value).toLocaleString() : 'not recorded';
const shortDate = value => value ? new Date(value).toLocaleDateString() : 'not recorded';
let csrf = '', current = null, ticket = null, working = false, reading = false;
let shownSavings = null, loadStarted = 0, readEpoch = 0, activityPending = false;
let progressKey = '', partialAgentsKey = '', partialSavingsKey = '', currentAgents = [];
let shareOptions = [], shareSnapshot = null, shareTrigger = null, shareCanvas = null;
const READ_LABELS = [
  ['agents','Finding agents and output integrations'], ['allowance','Checking allowance with agents and companions'],
  ['rules','Reading saved preferences and connected tools'], ['savings','Importing recorded reductions'],
  ['checks','Checking integration configuration'],
];
let trigger = null, triggerKey = null, selectedView = 'overview', selectedRules = null, previewAction = null;
const VIEW_COPY = {
  overview: ['Overview', 'Your agents and recorded results, in one place.'],
  rules: ['Rules & settings', 'See what runs automatically and how to change anything else.'],
  activity: ['Activity', 'Checks, approvals and results from this dashboard session.'],
};
const HELP = {
  'claude-effort': {
    title: 'Change reasoning in Claude',
    steps: [
      'Open Claude Code in the project you are working on.',
      'Enter /effort in the Claude conversation, not in PowerShell. Inspect the current level before choosing a new one.',
      'Choose a level suited to your work. Low is for simple, scoped tasks; difficult work needs more reasoning. Use auto to return to the model default.',
      'The saved user preference can be overridden by project, organization, environment or session settings. This dashboard cannot read the running session. Refresh here after changing it.',
    ],
    where: 'Inside Claude Code', command: '/effort', label: 'Copy command',
  },
  'codex-effort': {
    title: 'Change reasoning in Codex',
    steps: [
      'Open Codex in the project you are working on.',
      'Enter /model in the Codex conversation, not in PowerShell. Keep your current model and inspect its available reasoning controls.',
      'Choose the appropriate reasoning level. Project or profile settings can override a global preference; update the intended scope rather than overwriting unrelated settings.',
      'Refresh this dashboard afterward. The displayed configuration is not a live reading of an already running session.',
    ],
    where: 'Inside Codex', command: '/model', label: 'Copy command',
  },
  'claude-tools': {
    title: 'Manage Claude connected tools',
    steps: [
      'Open Claude Code in the relevant project and enter /mcp.',
      'Inspect the connected servers and resolve any authentication request inside Claude.',
      'Disable a server only when you know your task does not need it. A large tool count alone is not a reason to remove it.',
      'Return here and refresh. Token Harness only observes this inventory; it does not remove servers for you.',
    ],
    where: 'Inside Claude Code', command: '/mcp', label: 'Copy command',
  },
  'codex-tools': {
    title: 'Manage Codex connected tools',
    steps: [
      'Open Codex in the relevant project and enter /mcp to inspect the available servers and tools.',
      'Resolve sign-in or server configuration issues using Codex MCP settings. The /mcp view is an inventory, not a promise of an automatic repair.',
      'Disable a server only when you know the task does not need it, then refresh here.',
    ],
    where: 'Inside Codex', command: '/mcp', label: 'Copy command',
  },
  measurements: {
    title: 'Get and understand measurements',
    steps: [
      'Run Check integrations, then use your configured coding agent normally. This page imports readable provider records automatically.',
      'RTK history is read directly. HarnessTrim logging is optional: its integration needs a supported local metrics path. A skills-only installation must actually invoke the reducer.',
      'You can give the prompt below to your coding agent to inspect that setup. Review its proposed changes; this page does not install or rewrite a logging hook silently.',
      'Project-local HarnessTrim records must be imported from their project or available through a known configured metrics path. No private project folders are scanned.',
      'Counts describe recorded output only. Tokens, characters, estimates and providers are separate; they are not money saved or a measured subscription-quota benefit.',
    ],
    where: 'Optional prompt for your coding agent', label: 'Copy prompt',
    command: 'Inspect my existing Token Harness and HarnessTrim integration. Explain whether it uses hooks or skills, and whether local output-reduction metrics are enabled and readable by Token Harness. Show a supported, reversible plan for missing telemetry and ask before changing anything. Do not replace unrelated hooks, grant trust, change models or authentication, or claim unmeasured savings.',
  },
  cclimits: {
    title: 'Set up the Claude allowance reader',
    steps: [
      'The allowance meter is optional. Output reduction can work without it.',
      'Install or update cclimits in a terminal with the command below. The reviewed 1.7.0 version includes Claude discovery and the safe read-only flags; Python must also be installed.',
      'Keep Claude signed in. Restart Token Harness if you changed the terminal PATH, then refresh this page.',
      'This installs the companion only. It does not install Claude, sign in, or grant access automatically.',
    ],
    where: 'In PowerShell or your terminal', command: 'npm install --global cclimits@1.7.0', label: 'Copy install command',
  },
  python: {
    title: 'Make Python available to cclimits',
    steps: [
      'cclimits needs Python. Check that Python 3 is installed and available to the terminal used to start Token Harness.',
      'On Windows, enable the Python installer option to add it to PATH. Reopen the terminal and Token Harness after changing PATH.',
      'Run the check below in that terminal, then refresh here. No agent settings need to be changed.',
    ],
    where: 'In PowerShell or your terminal', command: 'python --version', label: 'Copy check command',
  },
  'claude-login': {
    title: 'Restore the Claude sign-in',
    steps: [
      'Open Claude Code and complete its sign-in process. On Windows, the supported companion can also discover a readable signed-in Claude Desktop session.',
      'Keep credentials inside Claude. Do not copy access tokens or passwords into this dashboard.',
      'Refresh here after signing in. A cached snapshot is labeled as cached; missing data is not zero remaining allowance.',
    ],
  },
  compatibility: {
    title: 'Resolve an unavailable check',
    steps: [
      'Use Check integrations in Activity for the current setup result. Unreviewed versions are left untouched; configured does not mean every command was reduced.',
      'For a missing allowance reading, check that the agent is signed in. Claude also needs the optional cclimits companion.',
      'For reasoning, use Adjust reasoning on an agent card. When the app cannot apply a safe change, Change in Claude or Change in Codex shows the native controls.',
      'For a long conversation, inspect it in the coding agent. Use its /compact command only when you choose to summarize the history, or start a new session for a new task. This app never clears a session.',
      'After fixing a setting, refresh the dashboard. Never force an unsupported integration or bypass hook trust.',
    ],
  },
};
async function request(path, body) {
  const options = { cache: 'no-store', signal: AbortSignal.timeout(120000) };
  if (body !== undefined) {
    options.method = 'POST';
    options.headers = { 'Content-Type': 'application/json', 'X-Token-Harness-CSRF': csrf };
    options.body = JSON.stringify(body);
  }
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The operation did not finish.');
  return data;
}
function error(message) { $('error').textContent = message; $('error').hidden = false; }
function announce(message) { $('announcement').textContent = message; }
function lock(value, message = 'Checking current state. No additional change is being started.') {
  working = value;
  document.querySelectorAll('[data-operation],#setup,#task-review,#verify,#undo,#refresh,#period,#harness,#task').forEach(element => { element.disabled = value; });
  $('approve').disabled = value; $('close').disabled = value;
  $('review-content').setAttribute('aria-busy', String(value));
  $('dialog-status').textContent = value ? message : '';
  $('dialog-status').classList.toggle('is-loading', value);
  $('live-status').textContent = value ? message : 'Changes always need approval';
  if (!value && current) $('setup').disabled = current.agents.length === 0;
}
function actionButton(action, key, cls = 'secondary') {
  const button = node('button', action.label, cls);
  button.type = 'button'; button.dataset.operation = action.kind; button.dataset.focus = key; button.disabled = working || (reading && ['setup','effort','skill','verify'].includes(action.kind));
  button.addEventListener('click', () => performAction(action));
  return button;
}
function performAction(action) {
  if (working || (reading && ['setup','effort','skill','verify'].includes(action.kind))) return;
  if (action.kind === 'setup') return preview({ action: 'setup', ...(action.harness ? { harness: action.harness } : {}) });
  if (action.kind === 'effort') return showTask(action.harness);
  if (action.kind === 'skill') return preview({ action: 'skill', harness: action.harness });
  if (action.kind === 'verify') return verify();
  if (action.kind === 'refresh') return refresh();
  if (action.kind === 'help') return showHelp(action.topic, action.harness);
}
function selectView(view, focus = false) {
  if (!VIEW_COPY[view]) return;
  selectedView = view;
  for (const id of Object.keys(VIEW_COPY)) {
    const active = id === view;
    $('view-' + id).hidden = !active;
    $('tab-' + id).setAttribute('aria-selected', String(active));
    $('tab-' + id).tabIndex = active ? 0 : -1;
  }
  $('view-title').textContent = VIEW_COPY[view][0];
  $('view-description').textContent = VIEW_COPY[view][1];
  if (focus) $('tab-' + view).focus();
  if (view === 'activity') activity();
}
function tabKeys(event, buttons, choose) {
  if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
  const index = buttons.indexOf(event.target); if (index < 0) return;
  event.preventDefault();
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  choose(buttons[next]);
}
function renderRules(data) {
  const choices = [...data.agents.map(agent => ({ id: agent.id, name: agent.name })), { id: 'general', name: 'Decision & safety rules' }];
  if (!choices.some(item => item.id === selectedRules)) selectedRules = choices[0].id;
  const filters = choices.map(item => {
    const button = node('button', item.name); button.type = 'button';
    button.id = 'rules-tab-' + item.id; button.dataset.focus = button.id;
    button.setAttribute('role','tab'); button.setAttribute('aria-controls','rules');
    button.setAttribute('aria-selected',String(item.id === selectedRules)); button.tabIndex = item.id === selectedRules ? 0 : -1;
    button.addEventListener('click', () => { selectedRules = item.id; renderRules({agents:currentAgents,rules:current?.rules || []}); $('rules-tab-' + item.id).focus(); });
    return button;
  });
  $('rule-filters').replaceChildren(...filters);
  $('rules').setAttribute('aria-labelledby','rules-tab-' + selectedRules);
  const list = selectedRules === 'general' ? data.rules : data.agents.find(agent => agent.id === selectedRules)?.rules || [];
  const agent=data.agents.find(agent=>agent.id===selectedRules);
  if(agent?.pending?.includes('reasoning'))$('rules').replaceChildren(node('p','Reading saved preferences and connected tools...','section-loading is-loading'));
  else $('rules').replaceChildren(...list.map(renderRule));
}
function renderRule(rule) {
  const card = node('article', undefined, 'rule');
  const top = node('div', undefined, 'rule-top'), content = node('div');
  const title = node('div', undefined, 'rule-title');
  title.append(node('h3', rule.title), node('span', rule.state, 'pill'));
  content.append(title, node('p', rule.what, 'rule-summary'));
  top.append(content);
  if (rule.action) { const actions = node('div', undefined, 'inline-actions'); actions.append(actionButton(rule.action, rule.id + '-action')); top.append(actions); }
  card.append(top);
  const modes = { automatic:'Runs through the configured agent integration', integration:'Depends on the installed adapter or agent instructions', preference:'Saved after approval; persists across sessions', observation:'Read-only check when readings refresh', advice:'Evaluated when you request a task preview', 'not-enabled':'Not running: setup is required', safety:'Enforced for every supported change' };
  const details = node('details', undefined, 'rule-details'); details.dataset.rule = rule.id;
  details.append(node('summary','How it works'));
  const grid = node('div', undefined, 'rule-detail-grid');
  for (const [label,text] of [['How it is applied',modes[rule.mode]], ['Why it matters',rule.why], [rule.mode === 'safety' || rule.mode === 'advice' ? 'Implementation' : 'Observed',rule.evidence]]) {
    const pair = node('dl'); pair.append(node('dt',label),node('dd',text)); grid.append(pair);
  }
  if (rule.next) { const pair=node('dl',undefined,'next-step'); pair.append(node('dt','What you can do'),node('dd',rule.next)); grid.append(pair); }
  details.append(grid); card.append(details); return card;
}
function renderAgent(agent) {
  const card = node('article', undefined, 'panel agent');
  const head = node('div', undefined, 'agent-head'), title = node('div', undefined, 'agent-title');
  title.append(node('h2',agent.name),node('span',agent.version ? 'v' + agent.version : 'version unavailable','version'));
  const needsAttention=agent.state==='Needs attention';
  head.append(title,node('span',needsAttention ? 'Needs attention' : agent.configured ? 'Configured' : 'Setup needed','pill' + (agent.configured && !needsAttention ? ' good' : ' warn'))); card.append(head); card.dataset.agent=agent.id;
  const integration = node('div',undefined,'agent-line'), integrationText = node('div');
  integrationText.append(node('span','Optimizer','key'), node('span',agent.providers.length ? agent.providers.join(', ') : 'Not configured'));
  integration.append(integrationText);
  const rulesButton=node('button','View rules','text-button'); rulesButton.type='button'; rulesButton.dataset.focus=agent.id+'-rules';
  rulesButton.addEventListener('click',()=>{selectedRules=agent.id;renderRules({agents:currentAgents,rules:current?.rules || []});selectView('rules',true);}); integration.append(rulesButton); card.append(integration);
  const guidanceRule=agent.rules.find(rule=>rule.id===agent.id+'-guidance');
  if(guidanceRule?.action) {
    const guidance=node('div',undefined,'agent-line'), guidanceText=node('div');
    guidanceText.append(node('span','Guidance','key'),node('span','Available on demand'));
    guidance.append(guidanceText,actionButton(guidanceRule.action,agent.id+'-guidance','text-button'));card.append(guidance);
  }
  const reasoning = agent.reasoning;
  const line = node('div',undefined,'agent-line'), text=node('div');
  text.append(node('span','Reasoning','key'),node('strong',agent.pending?.includes('reasoning') ? 'Reading saved preference...' : reasoning.label));
  line.append(text);if(!agent.pending?.includes('reasoning'))line.append(actionButton(reasoning.action,agent.id+'-reasoning','text-button'));  card.append(line);
  if (agent.pending?.includes('reasoning')) { const pending=node('p',undefined,'section-loading caption'); pending.append(node('span',undefined,'spinner'),node('span','Reading preferences and connected tools...'));pending.firstChild.setAttribute('aria-hidden','true');card.append(pending); }
  else if (reasoning.state === 'unavailable' || reasoning.state === 'default') card.append(node('p',reasoning.description,'subtle-note'));
  else card.append(node('p',reasoning.action.kind === 'help' ? 'Saved preference is readable; changes from this app are not available.' : 'Saved preference, not a live session reading.','subtle-note'));
  if (agent.effort === 'low') card.append(node('p','Using low reasoning? Review it before difficult work.','low-note'));
  if (agent.pending?.includes('allowance')) {
    const waiting=node('div',undefined,'allowance section-loading');
    waiting.append(node('span',undefined,'spinner'),node('span','Checking allowance and reset times...','caption'));
    waiting.firstChild.setAttribute('aria-hidden','true'); card.append(waiting);
  } else {
  const allowance=node('div',undefined,'allowance' + (!agent.allowance.length ? ' full' : ''));
  if (!agent.allowance.length) {
    const missing=node('div',undefined,'allowance-missing');
    missing.append(node('p',agent.allowanceNote),actionButton(agent.allowanceAction,agent.id+'-allowance','text-button')); allowance.append(missing);
  }
  for (const window of agent.allowance) {
    const item=node('div',undefined,'allowance-entry');
    item.append(node('span',window.label,'allowance-label'),node('strong',window.remaining === null ? 'Unknown' : count(window.remaining)+'% left'));
    const reset=window.resetsAt ? 'Resets ' + date(window.resetsAt) : 'Reset time unavailable';
    item.append(node('span',(window.source === 'Cached observation' ? 'Cached. ' : '') + reset,'caption')); allowance.append(item);
  }
  card.append(allowance);  }
 return card;
}
function renderSavings(savings) {
  shownSavings=savings;
  $('savings').replaceChildren(); $('savings').setAttribute('aria-busy','false');
  if (!savings.rows.length) {
    const empty=node('div',undefined,'empty');
    empty.append(node('h3','Your next reduced output starts the story'),node('p','No reductions measured in this period yet. Use a configured agent normally; available records appear here automatically. Missing data is not zero savings.'));
    empty.append(actionButton({kind:'help',label:'Enable or check measurements',topic:'measurements'},'empty-measurements')); $('savings').append(empty);
  }
  savings.rows.forEach((row,index) => {
    const item=node('div',undefined,'saving-row' + (row.saved < 0 ? ' negative' : ''));
    const source=node('div',undefined,'impact-summary');
    source.append(node('p',row.provider+' / '+row.measurement,'caption'));
    source.append(node('h3',row.impact?.headline || (row.saved<0 ? 'Output increased' : 'Recorded output reduction'),'impact-headline'));
    source.append(node('p',row.impact?.detail || 'Scope: recorded changed outputs only.','caption'));
    const breakdown=node('div',undefined,'breakdown');
    if (row.before !== null && row.after !== null) {
      breakdown.append(node('p',count(row.before)+' \u2192 '+count(row.after),'volume'));
      breakdown.append(node('span',row.unit+' before / after','caption'));
    }
    breakdown.append(node('span',count(row.operations)+' recorded changed outputs','caption'));
    breakdown.append(node('span',row.agents.length ? row.agents.join(', ') : 'Agent not recorded','caption'));
    const amount=node('div',undefined,'amount');
    amount.append(node('span',count(Math.abs(row.saved)),'number'),node('span',row.unit + (row.saved < 0 ? ' added, not saved' : ' removed'),'unit'));
    if(row.impact?.share) {
      const share=node('button','Share result','secondary'); share.type='button'; share.dataset.focus='share-'+index;
      share.addEventListener('click',()=>showShare(index)); amount.append(share);
    }
    item.append(source,breakdown,amount); $('savings').append(item);
  });
  $('savings-dates').textContent=savings.firstRecordedAt ? 'Available history: '+shortDate(savings.firstRecordedAt)+' to '+shortDate(savings.lastRecordedAt)+'. All recorded projects.' : 'No dated records in this period.';
  $('savings-note').textContent=savings.note;
  $('savings-quality').textContent=[savings.errors ? count(savings.errors)+' recorded reducer errors' : '',savings.inflated ? count(savings.inflated)+' recorded outputs grew (included in the net result)' : ''].filter(Boolean).join('. ');
  $('export').disabled=reading;
}
function shareCard(snapshot) {
  const canvas=document.createElement('canvas'); canvas.width=1200;canvas.height=630;
  const ctx=canvas.getContext('2d'); if(!ctx)throw new Error('Image export is not available in this browser. Copy the summary instead.');
  const tokens=getComputedStyle(document.documentElement);
  const color=name=>tokens.getPropertyValue(name).trim();
  ctx.fillStyle=color('--bg');ctx.fillRect(0,0,1200,630);
  ctx.fillStyle=color('--accent');ctx.fillRect(52,52,5,526);
  ctx.fillStyle=color('--text');ctx.font='600 28px system-ui, sans-serif';ctx.fillText('Token Harness',84,85);
  ctx.fillStyle=color('--muted');ctx.font='21px system-ui, sans-serif';ctx.fillText(snapshot.provider+' / '+snapshot.measurement,84,137);
  function wrap(text,x,y,width,font,lineHeight) {
    ctx.font=font;let line='';
    for(const word of text.split(' ')) {
      const next=line ? line+' '+word : word;
      if(ctx.measureText(next).width>width && line){ctx.fillText(line,x,y);y+=lineHeight;line=word;}else line=next;
    }
    ctx.fillText(line,x,y);return y;
  }
  ctx.fillStyle=color('--accent');
  const headline=snapshot.title.slice(snapshot.provider.length+2);
  wrap(headline,84,225,1030,'600 60px system-ui, sans-serif',70);
  ctx.fillStyle=color('--text');ctx.font='28px system-ui, sans-serif';ctx.fillText(snapshot.beforeAfter,84,352);
  ctx.fillStyle=color('--muted');ctx.font='22px system-ui, sans-serif';ctx.fillText(snapshot.operations,84,389);ctx.fillText(snapshot.window,84,433);
  ctx.strokeStyle=color('--line');ctx.beginPath();ctx.moveTo(84,463);ctx.lineTo(1130,463);ctx.stroke();
  wrap(snapshot.caveat,84,501,1020,'19px system-ui, sans-serif',27);
  ctx.font='18px system-ui, sans-serif';ctx.fillText('github.com/giuliastro/token-harness',84,570);
  return canvas;
}
function updateShare() {
  const selected=shareOptions[Number($('share-result').value)]; if(!selected)return;
  shareSnapshot=structuredClone(selected.share);const data=shareSnapshot;
  $('share-text').value=data.text; $('share-status').textContent='';
  const x=new URL('https://twitter.com/intent/tweet');x.searchParams.set('text',data.shortText);x.searchParams.set('url',data.url);
  const reddit=new URL('https://www.reddit.com/submit');reddit.searchParams.set('url',data.url);
  reddit.searchParams.set('title',data.title+' ('+data.measurement+'; changed outputs only; '+data.window+')');
  $('share-x').href=x.href;$('share-reddit').href=reddit.href;
  $('share-native').hidden=typeof navigator.share!=='function';
  try{shareCanvas=shareCard(data);$('share-image').src=shareCanvas.toDataURL('image/png');$('share-image').hidden=false;$('share-png').disabled=false;}
  catch(e){shareCanvas=null;$('share-image').hidden=true;$('share-png').disabled=true;$('share-status').textContent=e.message;}
}
function showShare(index) {
  if(!shownSavings || working)return;
  shareOptions=shownSavings.rows.map((row,index)=>({index,share:row.impact?.share})).filter(item=>item.share);
  if(!shareOptions.length)return;
  $('share-result').replaceChildren(...shareOptions.map((item,i)=>{
    const option=node('option',item.share.provider+' / '+item.share.measurement);option.value=String(i);return option;
  }));
  $('share-result').value=String(Math.max(0,shareOptions.findIndex(item=>item.index===index)));
  shareTrigger=document.activeElement;updateShare();$('share-dialog').showModal();$('share-result').focus();
}
async function copyShare(discord=false) {
  if(!shareSnapshot)return;
  const data=shareSnapshot;
  const text=discord ? '**'+data.title+'**\n'+data.text.split('\n').slice(1).join('\n') : data.text;
  try{await navigator.clipboard.writeText(text);$('share-status').textContent=discord ? 'Copied. Paste into your chosen Discord channel. Nothing has been sent.' : 'Summary copied. Paste it where you want to share it.';}
  catch{ $('share-text').value=text;$('share-text').focus();$('share-text').select();$('share-status').textContent='Clipboard access is unavailable. The text is selected: copy it manually.'; }
}
$('share-copy').addEventListener('click',()=>copyShare());
$('share-discord').addEventListener('click',()=>copyShare(true));
$('share-result').addEventListener('change',updateShare);
$('share-close').addEventListener('click',()=>$('share-dialog').close());
$('share-dialog').addEventListener('close',()=>{shareSnapshot=null;shareCanvas=null;if(shareTrigger?.isConnected)shareTrigger.focus({preventScroll:true});else $('period').focus();});
$('share-png').addEventListener('click',()=>{
  if(!shareCanvas)return;
  shareCanvas.toBlob(blob=>{
    if(!blob){$('share-status').textContent='Image export failed. Copy the summary instead.';return;}
    const url=URL.createObjectURL(blob),link=node('a');link.href=url;link.download='token-harness-recorded-impact.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    $('share-status').textContent='Image prepared for download. Attach it to your post; it is not uploaded automatically.';
  },'image/png');
});
$('share-native').addEventListener('click',async()=>{
  if(!shareSnapshot)return;
  try{await navigator.share({title:shareSnapshot.title,text:shareSnapshot.text});$('share-status').textContent='The device sharing dialog was opened.';}
  catch(e){if(e.name!=='AbortError')$('share-status').textContent='Device sharing is unavailable. Use Copy summary or Save image.';}
});

function readControls(value) {
  for(const id of ['refresh','period','setup','verify'])$(id).disabled=value || working;
  document.querySelectorAll('[data-operation="setup"],[data-operation="effort"],[data-operation="skill"],[data-operation="verify"]').forEach(button=>{button.disabled=value || working;});
  if(!value)$('setup').disabled=working || !current?.agents.length;
}
function sectionLoading(id,workingNow,text) {
  const element=$(id+'-loading'); element.hidden=!workingNow;
  if(text)element.lastElementChild.textContent=text;
}
function displayProgress(loading) {
  if(!reading || !loading || loading.period!==$('period').value || !loading.running)return;
  const focusKey=document.activeElement?.dataset?.focus;
  const disclosures=new Set([...$('rules').querySelectorAll('details[open]')].map(item=>item.dataset.rule));
  const key=JSON.stringify(loading.stages);
  if(key!==progressKey) {
    progressKey=key;
    $('load-progress').replaceChildren(...loading.stages.map(stage=>{
      const item=node('div',undefined,'load-step '+stage.state); item.dataset.stage=stage.id;
      const icon=node('span',stage.state==='ready' ? '\u2713' : stage.state==='attention' ? '!' : '', stage.state==='working' ? 'spinner' : 'step-icon'); icon.setAttribute('aria-hidden','true');
      item.append(icon,node('span',stage.label+(stage.state==='ready' ? ': checked' : stage.state==='attention' ? ': needs attention' : '...')));return item;
    }));
    const pending=loading.stages.filter(stage=>stage.state==='working');
    const message=pending.length ? (loading.stages.length-pending.length)+' of '+loading.stages.length+' checks finished. '+pending.map(stage=>stage.label).join('; ')+'.' : 'Checks finished. Preparing your overview.';
    $('updated').textContent=message; announce(message);
  }
  const isWorking=id=>loading.stages.some(stage=>stage.id===id && stage.state==='working');
  sectionLoading('agents',isWorking('agents') || isWorking('allowance') || isWorking('rules'),isWorking('agents') ? 'Finding agents and output integrations...' : 'Agents found. Remaining settings and allowance checks are in progress...');
  sectionLoading('rules',isWorking('rules'));
  sectionLoading('savings',isWorking('savings'));
  $('rules').setAttribute('aria-busy',String(isWorking('rules')));
  $('agents').setAttribute('aria-busy',String(isWorking('agents') || isWorking('rules') || isWorking('allowance')));
  if(loading.agents!==null) {
    const key=JSON.stringify(loading.agents);
    if(key!==partialAgentsKey) {
      partialAgentsKey=key; currentAgents=loading.agents;
      $('agents').replaceChildren(...loading.agents.map(renderAgent));
      if(!isWorking('rules'))renderRules({agents:loading.agents,rules:current?.rules || []});
    }
  }
  if(loading.savings!==null) {
    const key=JSON.stringify(loading.savings);
    if(key!==partialSavingsKey){partialSavingsKey=key;renderSavings(loading.savings);}
  }
  for(const detail of $('rules').querySelectorAll('details'))detail.open=disclosures.has(detail.dataset.rule);
  if(focusKey && !$('review').open && !$('share-dialog').open) {
    const focus=[...document.querySelectorAll('[data-focus]')].find(element=>element.dataset.focus===focusKey);
    if(focus)focus.focus({preventScroll:true});
  }
}
function render(data) {
  const focusKey=document.activeElement?.dataset?.focus;
  const openRules=new Set([...$('rules').querySelectorAll('details[open]')].map(item=>item.dataset.rule));
  const noticesOpen=$('notices').querySelector('details')?.open;
  current=data; currentAgents=data.agents; $('error').hidden=true;
  $('updated').textContent='Checked '+new Date(data.generatedAt).toLocaleTimeString()+'. Refreshes while visible.';
  $('notices').replaceChildren();
  if (data.notices.length) {
    const details=node('details'); details.open=noticesOpen || false;
    details.append(node('summary',data.notices.length+' item'+(data.notices.length===1 ? '' : 's')+' to review'));
    for (const text of data.notices) details.append(node('p',text,'notice-row'));
    details.append(actionButton({kind:'verify',label:'Check integrations'},'notice-check','text-button')); $('notices').append(details);
  }
  $('agents').replaceChildren(...data.agents.map(renderAgent)); $('agents').setAttribute('aria-busy','false');
  if (!data.agents.length) {
    const empty=node('div',undefined,'empty'); empty.append(node('h3','No coding agent detected'),node('p','Install and sign in to Claude Code or Codex, then reopen this app. Existing agents must be available in the terminal used to start it.'));
    $('agents').append(empty);
  }
  $('setup').disabled=working || data.agents.length===0;
  $('setup').textContent=data.agents.some(agent=>!agent.configured) ? 'Set up automatically' : 'Check setup';
  renderRules(data); renderSavings(data.savings);
  for (const item of $('rules').querySelectorAll('details')) item.open=openRules.has(item.dataset.rule);
  if (focusKey && !$('review').open) {
    const next=[...document.querySelectorAll('[data-focus]')].find(element=>element.dataset.focus===focusKey);
    if (next) next.focus({preventScroll:true});
  }
}
async function refresh() {
  if (working || reading || $('share-dialog').open) return;
  reading=true; const epoch=++readEpoch; loadStarted=Date.now(); progressKey=''; partialAgentsKey=''; partialSavingsKey='';
  shownSavings=null; readControls(true); $('export').disabled=true;
  $('reading-spinner').hidden=false;
  $('updated').textContent='Checking agents, settings and measurements. No settings are being changed.';
  $('live-status').textContent='Read-only checks';
  for(const id of ['agents','rules','savings'])sectionLoading(id,true);
  for(const id of ['agents','rules','savings'])$(id).setAttribute('aria-busy','true');
  document.querySelectorAll('.amount button').forEach(button=>{button.disabled=true;});
  displayProgress({period:$('period').value,running:true,stages:READ_LABELS.map(([id,label])=>({id,label,state:'working'})),agents:null,savings:null});
  try { csrf=(await request('/api/session')).token; render(await request('/api/overview?period='+$('period').value)); }
  catch (e) {
    error((e.name==='TimeoutError' ? 'A check took too long. Nothing was changed. Use Refresh to try again.' : e.message) || 'Could not read this app. Check that its terminal is still open.');
    $('updated').textContent='Refresh failed. Any displayed figures are previous or partial readings.';
    if (!current && !partialAgentsKey) $('agents').replaceChildren(node('p','Could not load your agents. Use Refresh to try the read again.','empty'));
    if (!current && !partialSavingsKey) $('savings').replaceChildren(node('p','Measurements are unavailable until the connection is restored.','empty'));
  } finally {
    if(epoch===readEpoch) {
      reading=false; readControls(false); $('reading-spinner').hidden=true;
      for(const id of ['agents','rules','savings']){sectionLoading(id,false);$(id).setAttribute('aria-busy','false');}
      $('load-progress').replaceChildren(); $('live-status').textContent='Changes always need approval';
      $('export').disabled=!current;
    }
  }
}
function showDialog(title) {
  if (!$('review').open) { trigger=document.activeElement; triggerKey=trigger?.dataset?.focus; }
  $('review-title').textContent=title; $('review-content').replaceChildren(); $('review-error').hidden=true;
  $('approve').hidden=true; $('task-review').hidden=true; $('task-form').hidden=true; ticket=null;
  if (!$('review').open) $('review').showModal();
}
function closeDialog() { if (working) return; ticket=null; $('review').close(); }
$('review').addEventListener('close',()=>{
  if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus({preventScroll:true});
  else {
    const replacement=[...document.querySelectorAll('[data-focus]')].find(element=>element.dataset.focus===triggerKey);
    (replacement || $('tab-'+selectedView)).focus({preventScroll:true});
  }
});
function showTask(harness) {
  if (!current) return;
  const agent=current.agents.find(item=>item.id===harness) || current.agents.find(item=>item.reasoning.action.kind==='effort') || current.agents[0];
  if (!agent) return showHelp('compatibility');
  if (agent.reasoning.action.kind==='help') return showHelp(agent.reasoning.action.topic,agent.id);
  showDialog('Adjust reasoning');
  $('review-content').append(node('p','Choose the type of work. You will see the exact supported preference change before approving it.'));
  for (const option of $('harness').options) option.disabled=!current.agents.some(item=>item.id===option.value && item.reasoning.action.kind==='effort');
  $('harness').value=agent.id; $('task').value='standard'; $('task-form').hidden=false; $('task-review').hidden=false;
  $('harness').focus();
}
function showHelp(topic, harness) {
  const help=HELP[topic] || HELP.compatibility; showDialog(help.title);
  const agent=currentAgents.find(item=>item.id===harness);
  if ((topic==='claude-effort' || topic==='codex-effort') && agent) {
    const observed=node('div',undefined,'read-only-box');
    observed.append(node('strong',agent.reasoning.label),node('p',agent.reasoning.description),node('p',agent.reasoning.changeNote)); $('review-content').append(observed);
  }
  const steps=node('ol',undefined,'help-steps'); steps.append(...help.steps.map(text=>node('li',text))); $('review-content').append(steps);
  if (help.command) {
    $('review-content').append(node('p',help.where,'command-context'));
    const box=node('div',undefined,'command-box'), copy=node('button',help.label,'secondary'); copy.type='button';
    copy.addEventListener('click',async()=>{
      try { await navigator.clipboard.writeText(help.command); copy.textContent='Copied'; announce('Copied. Nothing was executed.'); }
      catch {
        if (!box.querySelector('textarea')) {
          const fallback=node('textarea',undefined,'copy-fallback'); fallback.readOnly=true; fallback.value=help.command; fallback.setAttribute('aria-label','Select and copy this text'); box.append(fallback); fallback.focus(); fallback.select();
        }
        copy.textContent='Select and copy';
      }
    });
    box.append(node('code',help.command),copy); $('review-content').append(box,node('p','Copying does not run anything.','caption'));
  }
  const actions=node('div',undefined,'help-refresh');
  const refreshButton=node('button','Done, refresh readings','secondary'); refreshButton.type='button';
  refreshButton.addEventListener('click',()=>{closeDialog();refresh();}); actions.append(refreshButton); $('review-content').append(actions);
}
function resultView(data) {
  $('review-title').textContent=data.title; $('review-content').replaceChildren(...data.messages.map(text=>node('p',text)));
  $('approve').hidden=true; ticket=null;
  const go=node('button',data.ok ? 'View updated rules' : 'See troubleshooting','secondary'); go.type='button';
  go.addEventListener('click',()=>{
    if (data.ok) { closeDialog(); if (previewAction?.harness) selectedRules=previewAction.harness; if(current)renderRules(current); selectView('rules',true); }
    else showHelp('compatibility');
  }); $('review-content').append(go);
  announce(data.title);
}
async function preview(body) {
  if (working || !csrf) return;
  previewAction=body;
  showDialog(body.action==='effort' ? 'Preparing a reasoning preview' : body.action==='skill' ? 'Preparing in-session guidance' : body.action==='undo' ? 'Preparing a restore preview' : 'Checking your setup'); lock(true, 'Reading current settings. Nothing is being changed.');
  $('review-content').append(node('p','Reading current settings. Nothing is being changed.'));
  try {
    const data=await request('/api/preview',body); $('review-title').textContent=data.title; $('review-content').replaceChildren();
    const list=node('ul',undefined,'checklist');
    for (const change of data.changes) {
      const item=node('li'); item.append(node('strong',change.title),node('p',change.description),node('span',change.files ? change.files+' configuration file(s)' : 'Files from the reviewed backup','caption')); list.append(item);
    }
    if(data.changes.length)$('review-content').append(list);
    $('review-content').append(...data.notices.map(text=>node('p',text,'notice')));
    if(data.network)$('review-content').append(node('p','This setup requires a network request to its declared installation source.','notice'));
    if(data.restart)$('review-content').append(node('p','Reopen the affected agent after applying. An already running session may keep its previous settings.','notice'));
    if(data.ticket)$('review-content').append(node('p','Backups are created before applying. Each agent has a separate transaction; partial success is reported.','caption'));
    ticket=data.ticket; $('approve').hidden=!ticket;
    if(!ticket) $('review-content').append(actionButton({kind:'help',label:'What can I do next?',harness:body.harness,topic:body.action==='effort' ? body.harness==='claude' ? 'claude-effort' : 'codex-effort' : 'compatibility'},'preview-help'));
  } catch(e) { $('review-error').textContent=e.message; $('review-error').hidden=false; }
  finally { lock(false); activity(); if(ticket){$('dialog-status').textContent='Preview ready. Waiting for your approval.';$('approve').focus();} }
}
async function verify() {
  if(working || !csrf)return; showDialog('Checking integrations'); lock(true, 'Checking configuration and execution evidence. Nothing is being changed.');
  $('review-content').append(node('p','Checking configuration and available evidence. No agent settings are changed.'));
  try { resultView(await request('/api/verify',{})); }
  catch(e) { $('review-error').textContent=e.message; $('review-error').hidden=false; }
  finally { lock(false); activity(); }
}
async function activity() {
  if(activityPending)return;
  activityPending=true; const epoch=readEpoch;
  try {
    const data=await request('/api/activity'); $('undo').hidden=!data.canUndo;
    if(epoch===readEpoch)displayProgress(data.loading);
    if(working && data.busy && data.activity[0]?.state==='working') {
      $('dialog-status').textContent=data.activity[0].message;
      $('live-status').textContent=data.activity[0].message;
    }
    if(!data.activity.length)return;
    $('activity').replaceChildren(...data.activity.map((item,index)=>{
      const row=node('div',undefined,'activity-row '+item.state+(data.busy && index===0 ? ' active-operation' : '')),time=node('time',new Date(item.at).toLocaleTimeString());time.dateTime=item.at;
      row.append(time,node('p',item.message));return row;
    }));
  } catch { /* The foreground request owns errors; a progress poll is not another operation. */ }
  finally { activityPending=false; }
}
$('approve').addEventListener('click',async()=>{
  if(!ticket || working)return;
  const approved=ticket; ticket=null; lock(true, 'Applying only the changes you approved, with backups and safety checks.'); $('approve').hidden=true;
  $('review-content').replaceChildren(node('p','Backing up, applying the changes you approved, and checking the result...'));
  try { resultView(await request('/api/apply',{ticket:approved})); }
  catch(e) { $('review-error').textContent=e.message+' No automatic retry was made. Check the current state before trying again.'; $('review-error').hidden=false; }
  finally { lock(false); await refresh(); activity(); }
});
$('setup').addEventListener('click',()=>preview({action:'setup'}));
$('undo').addEventListener('click',()=>preview({action:'undo'}));
$('task-review').addEventListener('click',()=>preview({action:'effort',harness:$('harness').value,task:$('task').value}));
$('verify').addEventListener('click',verify);
$('measurement-help').addEventListener('click',()=>showHelp('measurements'));
$('close').addEventListener('click',closeDialog);
$('review').addEventListener('cancel',event=>{if(working)event.preventDefault();else ticket=null;});
$('refresh').addEventListener('click',refresh); $('period').addEventListener('change',refresh);
for(const button of document.querySelectorAll('[data-view]'))button.addEventListener('click',()=>selectView(button.dataset.view));
document.querySelector('.view-tabs').addEventListener('keydown',event=>tabKeys(event,[...document.querySelectorAll('[data-view]')],button=>selectView(button.dataset.view,true)));
$('rule-filters').addEventListener('keydown',event=>tabKeys(event,[...$('rule-filters').querySelectorAll('button')],button=>button.click()));
$('theme').addEventListener('change',()=>{
  const theme=$('theme').value;
  if(theme==='system')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;
});
$('export').addEventListener('click',()=>{
  if(!current)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)],{type:'application/json'}));
  const link=node('a'); link.href=url;link.download='token-harness-report.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
refresh().then(()=>activity());
setInterval(()=>{if(!document.hidden && !working && !$('review').open && !$('share-dialog').open){refresh();activity();}},30000);
setInterval(()=>{
  if(!document.hidden && (working || reading))activity();
  if(reading && Date.now()-loadStarted>10000)$('live-status').textContent='Still checking ('+Math.floor((Date.now()-loadStarted)/1000)+'s). Ready results appear as they arrive.';
},750);
`;
