import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { observation, startGuidedBrowser, type Element } from './guided-browser-double.js';

type Data = ReturnType<typeof observation>;
type Agent = Data['agents'][number];

function agent(id: string, name: string, extra: Record<string, unknown> = {}): Agent {
  return {
    id,
    name,
    version: '1.0.0',
    providers: [],
    setup: [],
    promptRouting: { configured: false },
    allowance: [],
    ...extra,
  };
}

/** A computer where RTK is connected to Codex and everything else can still be turned on. */
function installed(): Data {
  const data = observation();
  data.agents[0]!['setup'] = [
    { providerId: 'rtk', state: 'connected' },
    { providerId: 'harnesstrim', state: 'actionable' },
    { providerId: 'gitnexus', state: 'actionable' },
    { providerId: 'mcptoon', state: 'unavailable', reason: 'Needs pipx or uv.' },
  ];
  data.stack.components = [
    {
      providerId: 'rtk',
      configured: true,
      configuredHarnesses: ['codex'],
      installed: true,
      version: '0.44.0',
    },
    {
      providerId: 'harnesstrim',
      configured: false,
      configuredHarnesses: [],
      installed: true,
      version: '1.2.0',
    },
    { providerId: 'gitnexus', configured: false, configuredHarnesses: [], installed: false },
  ];
  return data;
}

const card = (root: Element, key: string) =>
  root.querySelectorAll('article.method').find((item) => item.dataset['method'] === key)!;
const switchOf = (parent: Element, label?: string) =>
  parent
    .querySelectorAll('button')
    .find(
      (item) =>
        item.attributes['role'] === 'switch' &&
        (label === undefined || item.attributes['aria-label'] === label),
    )!;
const labels = (parent: Element) =>
  parent.querySelectorAll('button').map((item) => item.textContent);

describe('guided methods', () => {
  it('lists recommended and optional methods with one state each', async () => {
    const { get, turn } = await startGuidedBrowser({ data: installed() });
    await turn('methods');
    const root = get('methods-root');
    const headings = root.querySelectorAll('h2').map((item) => item.textContent);
    assert.deepEqual(headings, ['Recommended', 'More methods']);
    const sections = root.querySelectorAll('.method-grid');
    const keys = (grid: Element) =>
      grid.querySelectorAll('article.method').map((item) => item.dataset['method']);
    assert.deepEqual(keys(sections[0]!), ['rtk', 'harnesstrim', 'routing']);
    assert.deepEqual(keys(sections[1]!), [
      'reasoning',
      'guidance',
      'mcptoon',
      'gitnexus',
      'headroom',
    ]);
    const state = (key: string) => card(root, key).querySelector('.pill')!.textContent;
    assert.equal(state('rtk'), 'On');
    assert.equal(state('harnesstrim'), 'Off');
    assert.equal(state('gitnexus'), 'Not installed');
    assert.equal(state('mcptoon'), 'Not available for your apps');
    assert.equal(state('headroom'), 'Not available for your apps');
    // A method that cannot be used says why instead of offering an action.
    assert.match(card(root, 'mcptoon').textContent, /Needs pipx or uv\./);
    assert.match(card(root, 'headroom').textContent, /No supported coding app was found for it\./);
    // Filters count methods by state and never hide the counts behind another read.
    const filters = root.querySelectorAll('.filter').map((item) => item.textContent);
    assert.match(filters[0]!, /^All · 8$/);
    root.querySelectorAll('.filter')[1]!.fire('click');
    assert.ok(
      get('methods-root')
        .querySelectorAll('article.method')
        .every((item) => ['rtk', 'routing'].includes(item.dataset['method']!)),
    );
  });

  it('turns a method off only through a reviewed removal, then re-reads the overview once', async () => {
    const { get, turn, settle, writes, reads, button } = await startGuidedBrowser({
      data: installed(),
    });
    await turn('methods');
    const toggle = switchOf(card(get('methods-root'), 'rtk'), 'RTK');
    assert.equal(toggle.attributes['aria-checked'], 'true');
    toggle.fire('click');
    await settle();
    assert.equal(get('modal-title').textContent, 'Turn off RTK');
    assert.match(get('modal-content').textContent, /What turning off means/);
    assert.match(get('modal-content').textContent, /RTK stays installed/);
    assert.match(
      get('modal-content').textContent,
      /Only changes Token Harness owns are applied, with a backup first/,
    );
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'remove',
      provider: 'rtk',
    });
    assert.ok(
      writes.every((write) => write.path !== '/api/apply'),
      'a preview alone never applies',
    );

    const overviewsBefore = reads.filter((path) => path.startsWith('/api/overview')).length;
    button(get('modal-actions'), 'Turn off').fire('click');
    await settle();
    assert.deepEqual(
      writes.filter((write) => write.path === '/api/apply'),
      [{ path: '/api/apply', body: { ticket: 'preview-ticket' } }],
    );
    const applyAt = reads.lastIndexOf('/api/apply');
    const refreshed = reads.slice(applyAt).filter((path) => path.startsWith('/api/overview'));
    assert.deepEqual(refreshed, ['/api/overview?period=all&refresh=1']);
    assert.equal(
      reads.filter((path) => path.startsWith('/api/overview')).length,
      overviewsBefore + 1,
    );
    assert.match(get('modal-content').textContent, /Completed/);
    assert.ok(labels(get('modal-actions')).includes('Done'));
  });

  it('says so when the automatic refresh after an approved change fails', async () => {
    let applied = false;
    const { get, turn, settle, button } = await startGuidedBrowser({
      data: installed(),
      respond: (path) => {
        if (path === '/api/apply') applied = true;
        return applied && path.includes('refresh=1')
          ? new Error('Overview is unavailable.')
          : undefined;
      },
    });
    await turn('methods');
    switchOf(card(get('methods-root'), 'rtk'), 'RTK').fire('click');
    await settle();
    button(get('modal-actions'), 'Turn off').fire('click');
    await settle(true);
    assert.equal(get('stale-state').hidden, false);
    assert.match(
      get('stale-state').textContent,
      /could not be read automatically\. Choose Refresh\./,
    );
    assert.match(get('modal-content').textContent, /Change applied/);
    assert.match(
      get('modal-content').textContent,
      /Automatic refresh failed.*Overview is unavailable\./,
    );
  });

  it('turns on an installed method for the selected coding apps only after review', async () => {
    const data = installed();
    data.agents.push(
      agent('claude', 'Claude Code', {
        setup: [
          { providerId: 'harnesstrim', state: 'actionable' },
          { providerId: 'rtk', state: 'actionable' },
        ],
      }),
    );
    const { get, turn, settle, writes, button } = await startGuidedBrowser({ data });
    await turn('methods');
    const toggle = switchOf(card(get('methods-root'), 'harnesstrim'), 'HarnessTrim');
    assert.equal(toggle.attributes['aria-checked'], 'false');
    toggle.fire('click');
    assert.equal(get('modal-title').textContent, 'Turn on HarnessTrim');
    assert.match(
      get('modal-content').textContent,
      /Choose the coding apps where HarnessTrim should work\./,
    );
    assert.match(get('modal-content').textContent, /Nothing changes yet\./);
    const choices = get('modal-content').querySelectorAll('input');
    assert.equal(choices.length, 2);
    assert.ok(choices.every((choice) => choice.checked && choice.type === 'checkbox'));
    const review = button(get('modal-actions'), 'Review changes');
    for (const choice of choices) {
      choice.checked = false;
      choice.fire('change');
    }
    assert.equal(review.disabled, true, 'at least one coding app must stay selected');
    choices[0]!.checked = true;
    choices[0]!.fire('change');
    assert.equal(review.disabled, false);
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
    review.fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'setup',
      harnesses: ['codex'],
      provider: 'harnesstrim',
    });
    assert.ok(writes.every((write) => write.path !== '/api/apply'));
    button(get('modal-actions'), 'Turn on').fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/apply')?.body, {
      ticket: 'preview-ticket',
    });
  });

  it('installs a not-yet-installed method through a provider-scoped plan and states its license first', async () => {
    const { get, turn, settle, writes, button } = await startGuidedBrowser({ data: installed() });
    await turn('methods');
    const gitnexus = card(get('methods-root'), 'gitnexus');
    assert.equal(
      switchOf(gitnexus),
      undefined,
      'an uninstalled method has an Install action, not a switch',
    );
    button(gitnexus, 'Install').fire('click');
    assert.match(get('modal-content').textContent, /PolyForm Noncommercial/);
    assert.match(get('modal-content').textContent, /never builds its repository index/);
    button(get('modal-actions'), 'Review changes').fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'setup',
      harnesses: ['codex'],
      provider: 'gitnexus',
    });
    assert.ok(writes.every((write) => write.path !== '/api/apply'));
    // Nothing in the browser installs third-party software directly.
    assert.ok(
      writes.every((write) => !JSON.stringify(write.body).match(/pip|npm install|uv tool/)),
    );
  });

  it('offers no approval when a preview finds nothing to change', async () => {
    const { get, turn, settle, writes, button } = await startGuidedBrowser({
      data: installed(),
      respond: (path) =>
        path === '/api/preview'
          ? { ticket: null, changes: [], notices: ['Already in the requested state.'] }
          : undefined,
    });
    await turn('methods');
    switchOf(card(get('methods-root'), 'rtk'), 'RTK').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /No change needed/);
    assert.match(get('modal-content').textContent, /Already in the requested state\./);
    assert.deepEqual(labels(get('modal-actions')), ['Done']);
    assert.ok(writes.every((write) => write.path !== '/api/apply'));
    button(get('modal-actions'), 'Done').fire('click');
    assert.equal(get('modal').open, false);
  });

  it('routes each coding app separately and always through a preview', async () => {
    const data = installed();
    data.agents.push(agent('claude', 'Claude Code'));
    const { get, turn, settle, writes, button } = await startGuidedBrowser({ data });
    await turn('methods');
    const routing = card(get('methods-root'), 'routing');
    const codex = switchOf(routing, 'Model routing · Codex');
    const claude = switchOf(routing, 'Model routing · Claude Code');
    assert.equal(codex.attributes['aria-checked'], 'true');
    assert.equal(claude.attributes['aria-checked'], 'false');

    claude.fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'routing-enable',
      harness: 'claude',
    });
    assert.match(get('modal-title').textContent, /Turn on model routing · Claude Code/);
    assert.match(
      get('modal-content').textContent,
      /It starts with the next new Claude Code session\./,
    );
    button(get('modal-actions'), 'Cancel').fire('click');
    assert.equal(get('modal').open, false);
    assert.ok(
      writes.every((write) => write.path !== '/api/apply'),
      'cancelling never applies',
    );

    codex.fire('click');
    await settle();
    assert.deepEqual(writes.filter((write) => write.path === '/api/preview').at(-1)?.body, {
      action: 'routing-disable',
      harness: 'codex',
    });
    assert.match(get('modal-content').textContent, /removes only the routing hook it added/);
  });

  it('tells Codex users about the one approval step and keeps hooks managed elsewhere untouched', async () => {
    const data = observation();
    data.agents[0]!.promptRouting = { configured: false };
    data.agents.push(agent('claude', 'Claude Code', { promptRouting: { state: 'external' } }));
    const { get, turn, settle, button } = await startGuidedBrowser({ data });
    await turn('methods');
    const routing = card(get('methods-root'), 'routing');
    assert.equal(switchOf(routing, 'Model routing · Claude Code'), undefined);
    assert.match(routing.textContent, /Managed elsewhere/);
    switchOf(routing, 'Model routing · Codex').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /One step in Codex/);
    assert.match(get('modal-content').textContent, /type \/hooks and approve Token Harness/);
    button(get('modal-actions'), 'Cancel').fire('click');
  });

  it('changes the reasoning level only through a reviewed preference', async () => {
    const data = observation();
    data.agents[0]!['reasoning'] = { state: 'saved', value: 'high', action: { kind: 'effort' } };
    data.agents.push(
      agent('claude', 'Claude Code', {
        reasoning: {
          state: 'unavailable',
          value: null,
          action: { kind: 'help', topic: 'claude-effort', label: 'Change' },
        },
      }),
    );
    const { get, turn, settle, writes, button } = await startGuidedBrowser({ data });
    await turn('methods');
    const reasoning = card(get('methods-root'), 'reasoning');
    assert.match(reasoning.textContent, /Codex.*High/);
    button(reasoning, 'Change').fire('click');
    assert.match(get('modal-title').textContent, /Reasoning level · Codex/);
    assert.deepEqual(
      get('modal-content')
        .querySelectorAll('.choice-button')
        .map((item) => item.textContent.split(' ')[0]),
      ['Lighter', 'Balanced', 'Deeper', 'Maximum'],
    );
    assert.ok(writes.every((write) => write.path !== '/api/preview'));
    get('modal-content').querySelectorAll('.choice-button')[1]!.fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'effort',
      harness: 'codex',
      task: 'standard',
    });
    assert.ok(writes.every((write) => write.path !== '/api/apply'));
    assert.ok(labels(get('modal-actions')).includes('Save preference'));
    button(get('modal-actions'), 'Cancel').fire('click');

    // Where the app cannot be changed safely, the user is shown the in-app command instead.
    button(reasoning, 'How to change').fire('click');
    assert.equal(get('modal-title').textContent, 'Change reasoning in Claude Code');
    assert.match(get('modal-content').textContent, /\/effort/);
    assert.equal(writes.filter((write) => write.path === '/api/preview').length, 1);
  });

  it('turns on in-session guidance through the same preview and apply transaction', async () => {
    const data = observation();
    data.agents[0]!['guidance'] = {
      state: 'absent',
      label: 'Not enabled',
      action: { kind: 'skill', harness: 'codex', label: 'Enable guidance' },
    };
    const { get, turn, settle, writes, button } = await startGuidedBrowser({ data });
    await turn('methods');
    const guidance = card(get('methods-root'), 'guidance');
    assert.match(guidance.textContent, /Codex.*Off/);
    button(guidance, 'Turn on').fire('click');
    await settle();
    assert.deepEqual(writes.find((write) => write.path === '/api/preview')?.body, {
      action: 'skill',
      harness: 'codex',
    });
    assert.match(get('modal-title').textContent, /Turn on in-session guidance · Codex/);
    assert.ok(writes.every((write) => write.path !== '/api/apply'));
    button(get('modal-actions'), 'Turn on').fire('click');
    await settle();
    assert.equal(writes.filter((write) => write.path === '/api/apply').length, 1);
  });

  it('shows Home status as one honest sentence and routes the next step through Methods', async () => {
    const working = await startGuidedBrowser();
    assert.match(working.get('home-root').textContent, /Token Harness is working/);
    assert.equal(working.get('home-root').querySelectorAll('.status-band.good').length, 1);

    const none = observation();
    none.agents = [];
    const absent = await startGuidedBrowser({ data: none });
    assert.match(absent.get('home-root').textContent, /No coding agent found/);
    assert.match(absent.get('home-root').textContent, /Install Claude Code or Codex/);

    const step = observation();
    step.agents[0]!.promptRouting = { configured: true, enablement: 'untrusted' };
    const action = await startGuidedBrowser({ data: step });
    assert.match(action.get('home-root').textContent, /One step left/);
    action.button(action.get('home-root'), 'Show me').fire('click');
    assert.equal(action.get('view-methods').hidden, false);
    assert.equal(action.overviewReads(), 1);

    const attention = observation();
    attention.stack.state = 'attention';
    const check = await startGuidedBrowser({ data: attention });
    assert.match(check.get('home-root').textContent, /A method needs a check/);
    check.button(check.get('home-root'), 'Re-check health').fire('click');
    await check.settle();
    assert.deepEqual(check.writes.find((write) => write.path === '/api/verify')?.body, {
      period: 'all',
    });
    assert.ok(check.writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('caches each period and switches without re-reading what is already loaded', async () => {
    const { get, settle, reads } = await startGuidedBrowser();
    const period = (label: string) =>
      get('home-root')
        .querySelectorAll('button')
        .find((item) => item.textContent === label)!;
    period('7 days').fire('click');
    await settle();
    assert.equal(reads.filter((path) => path === '/api/overview?period=7d').length, 1);
    period('All time').fire('click');
    period('7 days').fire('click');
    await settle();
    assert.equal(
      reads.filter((path) => path.startsWith('/api/overview')).length,
      2,
      'cached periods are not re-read',
    );
    assert.equal(period('7 days').attributes['aria-pressed'], 'true');
  });

  it('switches the interface language without a reload and remembers it', async () => {
    const { get, storage, settle } = await startGuidedBrowser();
    const lang = (code: string) =>
      get('main')
        .parent!.querySelectorAll('button')
        .find((item) => item.dataset['lang'] === code)!;
    assert.equal(get('tab-methods').textContent, 'Methods');
    lang('it').fire('click');
    await settle();
    assert.equal(get('tab-methods').textContent, 'Metodi');
    assert.equal(lang('it').attributes['aria-pressed'], 'true');
    assert.equal(lang('en').attributes['aria-pressed'], 'false');
    assert.equal(storage.get('token-harness-lang'), 'it');
    assert.equal(get('refresh').textContent, 'Aggiorna');
    lang('en').fire('click');
    assert.equal(get('tab-methods').textContent, 'Methods');
  });
});

describe('guided first-run onboarding', () => {
  const fresh = () => {
    const data = observation();
    data.agents[0]!['setup'] = [
      { providerId: 'rtk', state: 'actionable' },
      { providerId: 'harnesstrim', state: 'actionable' },
    ];
    data.agents[0]!.promptRouting = { configured: false };
    data.stack.components = [];
    return data;
  };

  it('shows one screen with the recommended setup instead of the tabs', async () => {
    const { get, writes } = await startGuidedBrowser({ data: fresh() });
    assert.equal(get('view-onboarding').hidden, false);
    assert.equal(get('main-tabs').hidden, true);
    assert.equal(get('view-home').hidden, true);
    const text = get('onboarding-root').textContent;
    assert.match(text, /Get more out of your Claude and Codex plans/);
    assert.match(text, /Found on this computer/);
    assert.match(text, /Shorter command output/);
    assert.match(text, /Smart model routing/);
    assert.match(text, /You review every change first, and everything can be undone\./);
    // The first run offers only the recommended baseline, not guidance, reasoning or experiments.
    assert.doesNotMatch(text, /guidance|Reasoning|Experiment|comparison|benchmark/i);
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('previews every step first, re-previews before each later step and applies only after approval', async () => {
    const { get, settle, writes, button, storage } = await startGuidedBrowser({ data: fresh() });
    button(get('onboarding-root'), 'Turn on the recommended setup').fire('click');
    await settle();
    assert.equal(get('modal-title').textContent, 'Review before turning on');
    assert.deepEqual(
      writes.filter((write) => write.path === '/api/preview').map((write) => write.body),
      [
        { action: 'setup', harnesses: ['codex'] },
        { action: 'routing-enable', harness: 'codex' },
      ],
    );
    assert.match(get('modal-content').textContent, /RTK and HarnessTrim/);
    assert.match(get('modal-content').textContent, /Model routing · Codex/);
    assert.match(get('modal-content').textContent, /One step in Codex/);
    assert.equal(writes.filter((write) => write.path === '/api/apply').length, 0);

    button(get('modal-actions'), 'Turn on').fire('click');
    await settle();
    const previews = writes
      .filter((write) => write.path === '/api/preview')
      .map((write) => write.body);
    assert.equal(
      previews.length,
      3,
      'the second step is planned again after the first was applied',
    );
    assert.deepEqual(previews[2], { action: 'routing-enable', harness: 'codex' });
    assert.equal(writes.filter((write) => write.path === '/api/apply').length, 2);
    assert.equal(get('modal').open, false);
    assert.match(get('onboarding-root').textContent, /You are all set/);
    assert.equal(
      storage.get('token-harness-onboarded'),
      undefined,
      'finishing is the explicit last click',
    );
    button(get('onboarding-root'), 'Go to Home').fire('click');
    assert.equal(storage.get('token-harness-onboarded'), 'yes');
    assert.equal(get('view-home').hidden, false);
    assert.equal(get('view-onboarding').hidden, true);
    assert.equal(get('main-tabs').hidden, false);
  });

  it('stops for a new review when a later step no longer matches what was approved', async () => {
    let routingPreviews = 0;
    const { get, settle, writes, button } = await startGuidedBrowser({
      data: fresh(),
      respond: (path, body) => {
        if (path !== '/api/preview' || (body as { action: string }).action !== 'routing-enable')
          return undefined;
        routingPreviews += 1;
        return routingPreviews === 1
          ? undefined
          : {
              ticket: 'other-ticket',
              changes: [{ title: 'Something else', description: 'A different edit' }],
              notices: [],
            };
      },
    });
    button(get('onboarding-root'), 'Turn on the recommended setup').fire('click');
    await settle();
    button(get('modal-actions'), 'Turn on').fire('click');
    await settle();
    assert.equal(get('modal-title').textContent, 'Please review this step again');
    assert.match(get('modal-content').textContent, /no longer matches what you approved/);
    assert.match(get('modal-content').textContent, /Something else/);
    assert.equal(
      writes.filter((write) => write.path === '/api/apply').length,
      1,
      'the changed step was not applied',
    );
    assert.deepEqual(
      get('modal-actions')
        .querySelectorAll('button')
        .map((item) => item.textContent),
      ['Cancel', 'Turn on'],
    );
  });

  it('lets users choose methods themselves and remembers that the first run is over', async () => {
    const { get, button, storage, writes } = await startGuidedBrowser({ data: fresh() });
    button(get('onboarding-root'), 'Choose methods myself').fire('click');
    assert.equal(storage.get('token-harness-onboarded'), 'yes');
    assert.equal(get('view-methods').hidden, false);
    assert.equal(get('view-onboarding').hidden, true);
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('is skipped for an established setup and can be reopened with #welcome', async () => {
    const established = await startGuidedBrowser({ data: installed() });
    assert.equal(established.get('view-onboarding').hidden, true);
    assert.equal(established.get('view-home').hidden, false);

    const welcome = await startGuidedBrowser({ hash: '#welcome' });
    assert.equal(welcome.get('view-onboarding').hidden, false);
    assert.match(welcome.get('onboarding-root').textContent, /Already set up/);
    assert.deepEqual(labels(welcome.get('onboarding-root')), ['Go to Home']);
  });

  it('offers a recommended-setup shortcut from Home when something is still missing', async () => {
    const data = installed();
    data.agents[0]!.promptRouting = {
      configured: true,
      enablement: 'enabled',
      verificationTier: 'runtime-observed',
    };
    const { get, button } = await startGuidedBrowser({ data });
    assert.match(get('home-root').textContent, /You can save more/);
    button(get('home-root'), 'Turn on recommended methods').fire('click');
    assert.equal(get('view-onboarding').hidden, false);
    assert.match(get('onboarding-root').textContent, /Shorter command output/);
  });
});
