import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { harnessId } from '@token-harness/core';

import { observation, startGuidedBrowser, type BrowserOptions } from './guided-browser-double.js';

/** Evidence, comparisons and recovery live in the advanced Details view. */
async function details(options: BrowserOptions = {}) {
  const browser = await startGuidedBrowser({
    ...options,
    storage: { 'token-harness-advanced': 'on', ...options.storage },
  });
  await browser.turn('details');
  return browser;
}

describe('guided evidence interactions', () => {
  it('starts a paired capture only through a separate preview and approval', async () => {
    const { get, writes, settle, button } = await details();
    button(get('details-root'), 'Record a comparison').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /Baseline → task and checks → optimized/);
    assert.ok(writes.every((item) => !['/api/preview', '/api/apply'].includes(item.path)));
    button(get('modal-content'), 'Review new baseline').fire('click');
    await settle();
    assert.deepEqual(writes.find((item) => item.path === '/api/preview')?.body, {
      action: 'comparison-new',
      harness: 'codex',
      task: 'standard',
    });
    assert.ok(writes.every((item) => item.path !== '/api/apply'));
    assert.ok(
      get('modal-actions')
        .querySelectorAll('button')
        .some((candidate) => candidate.textContent === 'Record reviewed step'),
    );
  });

  it('requires an explicit quality result and coherent counts before reviewing a retained capture', async () => {
    const { get, writes, settle, button } = await details({
      comparisons: {
        available: true,
        blocked: false,
        note: 'Checks are user-recorded.',
        items: [
          {
            key: 'guided-pair-example',
            harness: 'codex',
            task: 'mechanical',
            startedAt: '2026-10-09T16:00:00Z',
            state: 'baseline-running',
            next: 'finish-baseline',
            baselineQuality: null,
            optimizedQuality: null,
          },
        ],
      } as never,
    });
    button(get('details-root'), 'Record a comparison').fire('click');
    await settle();
    button(get('modal-content'), 'Record baseline outcome').fire('click');
    const review = button(get('modal-actions'), 'Review recorded outcome');
    assert.equal(review.disabled, true);
    const quality = get('modal-content').querySelectorAll('select')[0]!;
    const [attempts, failed] = get('modal-content').querySelectorAll('input');
    quality.value = 'passed';
    attempts!.value = '2';
    failed!.value = '2';
    quality.fire('change');
    assert.equal(review.disabled, true);
    failed!.value = '1';
    failed!.fire('input');
    assert.equal(review.disabled, false);
    review.fire('click');
    await settle();
    assert.deepEqual(writes.find((item) => item.path === '/api/preview')?.body, {
      action: 'comparison-step',
      key: 'guided-pair-example',
      expected: 'finish-baseline',
      quality: 'passed',
      attempts: 2,
      failedAttempts: 1,
    });
    assert.ok(writes.every((item) => item.path !== '/api/apply'));
  });

  it('shows retained history after reopen and reviews recovery without selecting an id or applying on read', async () => {
    const { get, writes, settle } = await details({
      history: {
        state: 'ready',
        note: 'Latest retained project operations.',
        operations: [
          {
            startedAt: '2026-10-09T12:00:00Z',
            finishedAt: '2026-10-09T12:00:01Z',
            outcome: 'committed',
            actions: ['Update JSON configuration'],
            files: 1,
            canRestore: true,
          },
        ],
      } as never,
    });
    assert.match(
      get('operations').textContent,
      /Applied.*Update JSON configuration.*1 configuration path/,
    );
    assert.equal(get('operations-note').textContent, 'Latest retained project operations.');
    assert.ok(writes.every((item) => !['/api/preview', '/api/apply'].includes(item.path)));
    const restore = get('operations').querySelectorAll('button')[0]!;
    assert.equal(restore.textContent, 'Review restore');
    restore.fire('click');
    await settle();
    assert.equal(get('modal').open, true);
    assert.match(get('modal-content').textContent, /Manual edits/);
    assert.deepEqual(writes.find((item) => item.path === '/api/preview')?.body, {
      action: 'restore-latest',
    });
    assert.ok(writes.every((item) => item.path !== '/api/apply'));
    assert.ok(
      get('modal-actions')
        .querySelectorAll('button')
        .some((candidate) => candidate.textContent === 'Restore the reviewed backup'),
    );
  });

  it('keeps project claims scoped to the project and links the live source projects', async () => {
    const { get, reads, turn } = await startGuidedBrowser();
    await turn('methods');
    const cards = get('methods-root').querySelectorAll('article.method');
    assert.equal(cards.length, 8);
    const expected: Array<[string, string, string | null]> = [
      ['rtk', 'https://github.com/rtk-ai/rtk', 'up to 90% less'],
      ['harnesstrim', 'https://github.com/giuliastro/HarnessTrim', '75.8% less'],
      ['mcptoon', 'https://github.com/activeing123/mcptoon', '99.2% less'],
      ['gitnexus', 'https://github.com/abhigyanpatwari/GitNexus', null],
      ['headroom', 'https://github.com/headroomlabs-ai/headroom', '21–57% less'],
    ];
    for (const [id, url, claim] of expected) {
      const card = cards.find((item) => item.dataset['method'] === id)!;
      assert.ok(card, id);
      // A published percentage is always attributed to the project and to its own tests.
      if (claim) {
        assert.ok(card.textContent.includes('Its project reports: ' + claim), id);
        assert.ok(card.textContent.includes('On its own tests, not on your computer.'), id);
      } else {
        assert.doesNotMatch(card.textContent, /Its project reports/);
      }
      const links = card.querySelectorAll('a');
      const source = links.find((link) => link.href === url)!;
      assert.ok(source, 'project link for ' + id);
      assert.equal(source.target, '_blank');
      assert.equal(source.rel, 'noopener noreferrer');
      assert.match(source.attributes['aria-label']!, /\(opens in a new tab\)/);
      assert.ok(links.every((link) => link.rel === 'noopener noreferrer'));
      const explanation = card.querySelector('details')!;
      assert.equal(explanation.open, false);
      assert.match(explanation.textContent, /What its project reports/);
    }
    const text = (id: string) => cards.find((item) => item.dataset['method'] === id)!.textContent;
    assert.match(text('mcptoon'), /name index, not full schemas or tool results/);
    assert.match(text('headroom'), /does not enable the project’s broader proxy features/);
    assert.match(text('rtk'), /whole-session saving/);
    // Upstream percentages never leak into measured results.
    assert.doesNotMatch(get('home-root').textContent, /99\.2%|75\.8%|21–57%/);
    await turn('details');
    assert.doesNotMatch(get('result-evidence').textContent, /99\.2%|75\.8%|21–57%/);
    await turn('methods');
    const before = reads.length;
    const disclosure = get('methods-root')
      .querySelectorAll('details')
      .find((item) => item.dataset['key'] === 'method:rtk')!;
    disclosure.open = true;
    disclosure.fire('toggle');
    assert.equal(reads.length, before, 'reading an explanation must not call the API');
  });

  it('retains optimizer and routing explanations across read-only refreshes', async () => {
    const { get, settle, turn } = await startGuidedBrowser();
    await turn('methods');
    const explanation = (key: string) =>
      get('methods-root')
        .querySelectorAll('details')
        .find((item) => item.dataset['key'] === key)!;
    const optimizer = explanation('method:rtk');
    const routing = explanation('method:routing');
    assert.match(routing.textContent, /Codex uses Luna/);
    assert.match(routing.textContent, /main model stays in charge/);
    assert.match(routing.textContent, /reviews every result/);
    for (const item of [optimizer, routing]) {
      item.open = true;
      item.fire('toggle');
    }
    get('refresh').fire('click');
    await settle();
    assert.equal(explanation('method:rtk').open, true);
    assert.equal(explanation('method:routing').open, true);
    const restored = explanation('method:rtk');
    restored.open = false;
    restored.fire('toggle');
    get('refresh').fire('click');
    await settle();
    assert.equal(explanation('method:rtk').open, false);
  });

  it('lets users explore methods before a coding app is detected', async () => {
    const data = observation();
    data.agents = [];
    const { get, turn, writes, buttons, settle } = await startGuidedBrowser({ data });
    assert.match(get('home-root').textContent, /No coding agent found/);
    await turn('methods');
    const root = get('methods-root');
    assert.equal(root.querySelectorAll('article.method').length, 8);
    assert.match(root.textContent, /No coding agent found\./);
    assert.equal(buttons(root, 'Install').length, 0);
    assert.equal(
      root.querySelectorAll('button').filter((item) => item.attributes['role'] === 'switch').length,
      0,
    );
    // Reading what a method does needs no coding app.
    assert.ok(root.querySelectorAll('details').length >= 5);
    // The prerequisites of mcptoon are explained without installing anything.
    root
      .querySelectorAll('button')
      .find((item) => item.textContent === 'What it needs')!
      .fire('click');
    await settle();
    assert.equal(get('modal-title').textContent, 'Install what mcptoon needs');
    assert.match(get('modal-content').textContent, /once pipx or uv is available/);
    const links = get('modal-content').querySelectorAll('a');
    assert.deepEqual(
      links.map((link) => link.href),
      [
        'https://pipx.pypa.io/stable/installation/',
        'https://docs.astral.sh/uv/getting-started/installation/',
      ],
    );
    assert.ok(links.every((link) => link.rel.includes('noopener')));
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('keeps classes and units separate and does not infer app attribution from setup', async () => {
    const { get } = await details();
    const rows = get('result-evidence').children;
    const rtk = rows.find((row) => row.dataset['name'] === 'rtk')!;
    const measurements = rtk.querySelectorAll('section');
    assert.equal(measurements.length, 2);
    assert.match(
      measurements[0]!.textContent,
      /Measured local output.*1,000 tokens.*200 tokens.*800 tokens.*Not attributed/,
    );
    assert.match(
      measurements[1]!.textContent,
      /Local estimate.*500 characters.*100 characters.*400 characters.*Codex/,
    );
    assert.doesNotMatch(rtk.textContent, /1,200.*saved/);
    const app = rows.find((row) => row.dataset['type'] === 'harness')!;
    assert.match(app.textContent, /same optimizer records/);
    assert.doesNotMatch(app.textContent, /800 tokens/);
  });

  it('shows measured tokens and estimates as separate labelled figures on Home', async () => {
    const { get } = await startGuidedBrowser();
    const home = get('home-root');
    const hero = home.querySelector('.hero')!;
    // The big number is the measured token reduction only: 800, never 1,200 or 800 + 400.
    assert.equal(hero.querySelector('.big-number')!.textContent, '800 tokens');
    assert.match(hero.textContent, /Command and log output that Token Harness shortened/);
    // The dollar figure is an explicitly labelled estimate, not a measurement.
    const estimate = hero.querySelector('.estimate')!;
    assert.match(estimate.textContent, /≈ \$\d+–\$\d+/);
    assert.match(estimate.textContent, /at API prices/);
    assert.ok(estimate.querySelector('.tag')!.className.includes('estimated'));
    assert.equal(estimate.querySelector('.tag')!.textContent, 'Estimate');
    // The estimated character count stays outside the token total, in its own labelled line.
    assert.match(hero.textContent, /Plus 400 characters trimmed from logs by RTK \(estimate\)\./);
    assert.doesNotMatch(hero.textContent, /1,200|1\.2K|1,?200 tokens/);
  });

  it('shows plan balances only when readable and keeps unreadable quota distinct from zero', async () => {
    const unreadable = await startGuidedBrowser();
    assert.match(unreadable.get('home-root').textContent, /Plan usage is not readable yet\./);
    assert.equal(unreadable.get('home-root').querySelectorAll('.meter').length, 0);

    const data = observation();
    data.agents[0]!['allowance'] = [
      { label: '5-hour allowance', remaining: 75, source: 'native-rpc' },
      { label: 'weekly allowance', remaining: 45, source: 'native-rpc' },
    ];
    const readable = await startGuidedBrowser({ data });
    const meters = readable.get('home-root').querySelectorAll('.meter');
    assert.equal(meters.length, 2);
    assert.match(meters[0]!.textContent, /Codex.*5-hour window · 75% left/);
    assert.match(meters[1]!.textContent, /Codex.*Weekly · 45% left/);
    assert.doesNotMatch(readable.get('home-root').textContent, /Plan usage is not readable yet\./);
  });

  it('searches collapsed provenance, combines type filters, and resets an empty search', async () => {
    const { get } = await details();
    assert.equal(get('evidence-count').textContent, '9 of 9 sources');
    get('evidence-filter').value = 'CHARACTERS';
    get('evidence-filter').fire('input');
    assert.deepEqual(
      get('result-evidence')
        .children.filter((row) => !row.hidden)
        .map((row) => row.dataset['name']),
      ['rtk', 'codex'],
    );
    get('evidence-type').value = 'optimizer';
    get('evidence-type').fire('change');
    assert.equal(get('evidence-count').textContent, '1 of 9 sources');
    get('evidence-filter').value = 'no-such-source';
    get('evidence-filter').fire('input');
    assert.equal(get('evidence-empty').hidden, false);
    get('evidence-reset').fire('click');
    assert.equal(get('evidence-type').value, 'all');
    assert.equal(get('evidence-filter').value, '');
    assert.equal(get('evidence-count').textContent, '9 of 9 sources');
    assert.equal(get('evidence-empty').hidden, true);
    assert.equal(get('evidence-filter').attributes['focused'], 'true');
  });

  it('sorts sources and retains expanded details when refreshing the results', async () => {
    const { get, settle } = await details();
    assert.equal(get('result-evidence').children[0]!.dataset['name'], 'rtk');
    const rtk = get('result-evidence').children[0]!.querySelectorAll('details')[0]!;
    rtk.open = true;
    get('evidence-sort').value = 'name';
    get('evidence-sort').fire('change');
    assert.equal(get('result-evidence').children[0]!.dataset['name'], '5h / 7d allowance');
    get('refresh').fire('click');
    await settle();
    assert.equal(
      get('result-evidence').querySelectorAll('details[open]')[0]!.dataset['key'],
      'optimizer:RTK',
    );
    assert.equal(get('evidence-sort').value, 'name', 'filters survive a refresh');
  });

  it('blocks routed savings when quality regresses and keeps increased usage explicit', async () => {
    const data = observation();
    data.value.routing = { state: 'blocked-by-quality', savedLocalTokens: 999, pairs: 0 };
    const blocked = await details({ data });
    const routing = blocked
      .get('result-evidence')
      .children.find((row) => row.dataset['type'] === 'routing')!;
    assert.match(routing.textContent, /Not credited/);
    assert.doesNotMatch(routing.textContent, /999.*saved/);
    data.value.routing = { state: 'measured', savedLocalTokens: -250, pairs: 1 };
    const growth = await details({ data });
    assert.doesNotMatch(
      growth.get('result-summary').textContent,
      /Automatic routing|250 tokens added/,
    );
    const growthRouting = growth
      .get('result-evidence')
      .children.find((row) => row.dataset['type'] === 'routing')!;
    assert.match(growthRouting.textContent, /250 tokens added/);
    assert.match(growthRouting.querySelectorAll('strong')[1]!.parent!.className, /warn/);
  });

  it('supports keyboard tabs and direct navigation actions without another overview read', async () => {
    const { get, overviewReads, settle } = await startGuidedBrowser();
    // Details is an advanced destination and is not offered until the switch is on.
    assert.equal(get('tab-details').hidden, true);
    assert.equal(get('tab-home').attributes['aria-selected'], 'true');
    get('tab-methods').fire('click');
    assert.equal(get('view-methods').hidden, false);
    assert.equal(get('view-home').hidden, true);
    assert.equal(get('tab-methods').attributes['aria-selected'], 'true');
    assert.equal(get('tab-methods').tabIndex, 0);
    assert.equal(get('tab-home').tabIndex, -1);
    const press = (key: string) => {
      let prevented = false;
      get('main-tabs').fire('keydown', {
        key,
        preventDefault: () => {
          prevented = true;
        },
      });
      return prevented;
    };
    assert.equal(press('Home'), true);
    assert.equal(get('view-home').hidden, false);
    assert.equal(get('tab-home').attributes['focused'], 'true');
    assert.equal(press('End'), true);
    assert.equal(get('view-methods').hidden, false);
    assert.equal(press('ArrowRight'), true, 'arrows wrap between the offered tabs');
    assert.equal(get('view-home').hidden, false);
    assert.equal(press('Tab'), false, 'other keys keep their native behaviour');

    get('advanced-toggle').fire('click');
    await settle();
    assert.equal(get('advanced-toggle').attributes['aria-checked'], 'true');
    assert.equal(get('tab-details').hidden, false);
    assert.equal(get('view-details').hidden, false);
    assert.equal(press('ArrowRight'), true);
    assert.equal(get('view-home').hidden, false);
    // A source with no results sends users to Methods through an in-page action.
    get('tab-details').fire('click');
    await settle();
    const open = get('result-evidence')
      .querySelectorAll('button')
      .find((item) => item.textContent === 'Open Methods')!;
    open.fire('click');
    assert.equal(get('view-methods').hidden, false);
    assert.equal(overviewReads(), 1);

    // Turning the switch off removes the destination again.
    get('advanced-toggle').fire('click');
    assert.equal(get('tab-details').hidden, true);
    assert.equal(get('view-details').hidden, true);
  });

  it('links observed Codex routing and current quota without attributing shared RTK output', async () => {
    const data = observation();
    data.savings.rows = [data.savings.rows[0]!];
    data.savings.byHarness = [];
    Object.assign(data.agents[0]!, {
      version: '0.146.0',
      promptRouting: {
        configured: true,
        enablement: 'enabled',
        verificationTier: 'runtime-observed',
        promptSubmissions: 3,
        subagentsStarted: 1,
        subagentsStopped: 1,
        reportedModels: ['gpt-6-luna'],
        lastObservedAt: '2026-10-04T12:00:00Z',
      },
      allowance: [
        {
          label: '5-hour allowance',
          remaining: 75,
          source: 'native-rpc · authoritative',
          resetsAt: '2026-10-04T16:00:00Z',
        },
        {
          label: 'weekly allowance',
          remaining: 45,
          source: 'native-rpc · authoritative',
          resetsAt: '2026-10-10T16:00:00Z',
        },
      ],
    });
    const { get } = await details({ data });
    const app = get('result-evidence').children.find((row) => row.dataset['name'] === 'codex')!;
    assert.match(app.textContent, /v0\.146\.0/);
    assert.match(app.textContent, /3 prompt hook runs.*1 subagents started/);
    assert.match(app.textContent, /75% remaining.*45% remaining/);
    assert.match(app.textContent, /gpt-6-luna/);
    assert.doesNotMatch(app.textContent, /No linked results|800 tokens|80% less/);
    const routing = get('result-evidence').children.find(
      (row) => row.dataset['type'] === 'routing',
    )!;
    assert.match(routing.textContent, /3 prompt hook runs/);
    assert.match(routing.textContent, /Savings comparison needed/);
    assert.ok(Number(routing.dataset['amount']) > 0);
    assert.match(get('result-summary').textContent, /Current quota is being read/);
    assert.doesNotMatch(get('result-summary').textContent, /Automatic routing|75.*saved|45.*saved/);
  });

  it('keeps configuration-only routing and unreadable quota out of observed activity', async () => {
    const data = observation();
    data.savings.rows = [];
    data.savings.byHarness = [];
    Object.assign(data.agents[0]!, {
      promptRouting: { configured: true, enablement: 'untrusted', verificationTier: 'config-only' },
      allowance: [],
      allowanceNote: 'Native quota reader is unavailable; sign in again.',
    });
    const { get, turn } = await details({ data });
    const app = get('result-evidence').children.find((row) => row.dataset['type'] === 'harness')!;
    assert.match(app.textContent, /No activity recorded/);
    assert.match(app.textContent, /trust this hook/);
    assert.match(app.textContent, /Configuration only/);
    assert.match(app.textContent, /Native quota reader is unavailable/);
    assert.doesNotMatch(app.textContent, /prompt hook runs|0% remaining|tokens saved/i);
    // Home and Methods say the same: configured, but not yet usable.
    await turn('home');
    assert.match(get('home-root').textContent, /One step left/);
    assert.match(get('home-root').textContent, /Codex: Approve the hook in Codex/);
    await turn('methods');
    const routingCard = get('methods-root')
      .querySelectorAll('article.method')
      .find((card) => card.dataset['method'] === 'routing')!;
    assert.match(routingCard.textContent, /Needs a step/);
    assert.match(routingCard.textContent, /Approve the hook in Codex/);
    assert.ok(
      routingCard.querySelectorAll('button').some((item) => item.textContent === 'How to approve'),
    );
    assert.doesNotMatch(routingCard.textContent, /waiting for first use/);
  });

  it('separates configured routing from routing observed at runtime', async () => {
    const states: Array<[Record<string, unknown>, RegExp, RegExp]> = [
      [
        { configured: true, enablement: 'enabled', verificationTier: 'config-only' },
        /On · waiting for first use/,
        /^On$/,
      ],
      [
        { configured: true, enablement: 'enabled', verificationTier: 'runtime-observed' },
        /\bOn\b/,
        /waiting for first use/,
      ],
      [
        { configured: false, enablement: 'disabled' },
        /Hooks are turned off/,
        /waiting for first use/,
      ],
    ];
    for (const [routing, expected, unexpected] of states) {
      const data = observation();
      data.agents[0]!.promptRouting = routing;
      const { get, turn } = await startGuidedBrowser({ data });
      await turn('methods');
      const card = get('methods-root')
        .querySelectorAll('article.method')
        .find((item) => item.dataset['method'] === 'routing')!;
      const row = card.querySelector('.agent-row')!;
      assert.match(row.textContent, expected);
      assert.doesNotMatch(row.textContent, unexpected);
    }
  });

  it('filters allowance and quality as measurements and opens a real paired capture guide', async () => {
    const { get, reads, button } = await details();
    get('evidence-type').value = 'measurement';
    get('evidence-type').fire('change');
    assert.deepEqual(
      get('result-evidence')
        .children.filter((row) => !row.hidden)
        .map((row) => row.dataset['name']),
      ['5h / 7d allowance', 'task quality'],
    );
    const before = reads.length;
    button(get('details-root'), 'Comparison guide').fire('click');
    assert.equal(get('modal').open, true);
    const guide = get('modal-content');
    assert.match(guide.textContent, /benchmark-start.*--variant baseline.*--harness codex/);
    assert.match(guide.textContent, /benchmark-start.*--variant optimized.*--harness codex/);
    assert.match(guide.textContent, /benchmark-finish.*--quality <passed\|failed>/);
    assert.match(guide.textContent, /turn routing off in Methods before starting the baseline/);
    assert.match(guide.textContent, /must actually start a native subagent/);
    assert.match(guide.textContent, /same project where this app was opened/);
    assert.equal(reads.length, before, 'Opening guidance must not execute captures or tasks');
  });

  it('requires a server-selected recovery preview and separate approval instead of executing copied commands', async () => {
    const data = observation();
    Object.assign(data.value, {
      pendingConfiguration: {
        state: 'active',
        benchmarkId: 'active-four',
        variant: 'combined',
        recoveryCommand:
          'token-harness benchmark-restore --benchmark-id active-four --variant combined --yes',
      },
    });
    const { get, reads, writes, settle, button } = await details({
      data,
      recovery: {
        state: 'pending',
        benchmarkId: 'active-four',
        variant: 'combined',
        harness: harnessId('codex'),
        files: 1,
        note: 'Review saved original configuration. Recovery does not finish the capture.',
      } as never,
    });
    const content = get('result-evidence').textContent;
    assert.match(content, /Temporary configuration needs completion or recovery/);
    assert.match(content, /Prepared arm: active-four \/ combined/);
    assert.doesNotMatch(content, /benchmark-restore/);
    assert.ok(!reads.some((r) => r.includes('benchmark-restore')));
    button(get('result-evidence'), 'Review benchmark recovery').fire('click');
    await settle();
    assert.ok(reads.includes('/api/benchmark-recovery'));
    assert.match(get('modal-content').textContent, /active-four.*combined/);
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
    button(get('modal-actions'), 'Review recovery').fire('click');
    await settle();
    assert.deepEqual(
      writes.filter((write) => ['/api/preview', '/api/apply'].includes(write.path)),
      [{ path: '/api/preview', body: { action: 'benchmark-recover' } }],
    );
    button(get('modal-actions'), 'Cancel').fire('click');
    await settle();
    assert.ok(
      !writes.some((write) => write.path === '/api/apply'),
      'closing the preview never applies recovery',
    );
  });

  it('offers no recovery approval when the retained lease belongs to another project', async () => {
    const { get, writes, settle, button } = await details({
      recovery: {
        state: 'other-project',
        benchmarkId: null,
        variant: null,
        harness: null,
        files: 0,
        note: 'Open the project that owns this temporary configuration.',
      } as never,
    });
    button(get('details-maintenance'), 'Review benchmark recovery').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /Open the project/);
    assert.deepEqual(
      get('modal-actions')
        .querySelectorAll('button')
        .map((item) => item.textContent),
      ['Done', 'Check again'],
    );
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('offers a saved direct check and four arms without executing anything from the guide', async () => {
    const { get, reads, button } = await details();
    button(get('details-root'), 'Comparison guide').fire('click');
    const guide = get('modal-content');
    const check = guide
      .querySelectorAll('input')
      .find((e) => e.attributes['aria-label'] === 'Optional quality check')!;
    const design = guide
      .querySelectorAll('select')
      .find((e) => e.attributes['aria-label'] === 'Comparison design')!;
    const state = guide
      .querySelectorAll('input')
      .find((e) => e.attributes['aria-label'] === 'Same starting state')!;
    const before = reads.length;
    check.value = '["npm","run","verify"]';
    check.fire('input');
    assert.equal(check.attributes['aria-invalid'], 'false');
    assert.match(guide.textContent, /--check-command '\["npm","run","verify"\]'/);
    assert.match(guide.textContent, /benchmark-finish.*--yes/);
    assert.doesNotMatch(guide.textContent, /--quality <passed/);
    design.value = 'factorial';
    design.fire('change');
    assert.match(guide.textContent, /Starting state needed/);
    state.value = 'initial-commit';
    state.fire('input');
    for (const arm of ['baseline', 'compression-only', 'routing-only', 'combined'])
      assert.ok(guide.textContent.includes('--variant ' + arm));
    assert.match(guide.textContent, /benchmark-factorial/);
    assert.match(guide.textContent, /benchmark-prepare/);
    assert.match(guide.textContent, /benchmark-restore/);
    assert.match(guide.textContent, /Finish restores the original configuration/);
    assert.equal(reads.length, before);
    check.value = 'npm test';
    check.fire('input');
    assert.equal(check.attributes['aria-invalid'], 'true');
    assert.match(guide.textContent, /Enter a JSON array/);
    assert.doesNotMatch(guide.textContent, /benchmark-start/);
  });

  it('shows check disagreements and combined-only regressions in Details without merging evidence classes', async () => {
    const data = observation();
    Object.assign(data.value, {
      qualityMismatches: [
        { benchmarkId: 'check-test', details: ['optimized: user recorded passed; check failed'] },
      ],
      factorial: [
        {
          benchmarkId: 'four-test',
          status: 'quality-blocked',
          quality: {
            baseline: 'passed',
            'compression-only': 'passed',
            'routing-only': 'passed',
            combined: 'failed',
          },
          combinedQualityRegression: true,
          qualityMismatches: ['combined'],
          reasons: ['Compression activation is user-declared'],
          effects: [
            {
              unit: 'local-tokens',
              scope: null,
              compressionSaving: 200,
              routingSaving: 300,
              combinedSaving: null,
              interactionCost: null,
            },
            {
              unit: 'percentage-points',
              scope: 'weekly',
              compressionSaving: 1,
              routingSaving: 2,
              combinedSaving: null,
              interactionCost: null,
            },
          ],
        },
      ],
    });
    const { get } = await details({ data });
    const body = get('result-evidence');
    const disagreement = body.children.find(
      (e) => e.dataset['name'] === 'check disagreement · check-test',
    )!;
    assert.match(disagreement.textContent, /user recorded passed; check failed/);
    const experiment = body.children.find(
      (e) => e.dataset['name'] === 'four-arm comparison · four-test',
    )!;
    assert.match(experiment.textContent, /Combined quality regressed; savings blocked/);
    assert.match(experiment.textContent, /local-tokens.*percentage-points.*weekly/);
    assert.match(experiment.textContent, /Combined saving.*Not measured/);
  });

  it('never refreshes the whole overview in the background; only activity and routing are polled', async () => {
    const { intervals, reads, overviewReads, settle, get, fireDocument } =
      await startGuidedBrowser();
    assert.equal(overviewReads(), 1);
    const periods = [...intervals.values()].map((timer) => timer.ms).sort((a, b) => a - b);
    assert.deepEqual(periods, [4000, 15000]);
    reads.length = 0;
    for (const timer of [...intervals.values()]) void timer.callback();
    fireDocument('visibilitychange');
    await settle();
    assert.equal(overviewReads(), 0);
    assert.ok(
      reads.every((path) => ['/api/routing', '/api/activity'].includes(path)),
      reads.join(),
    );
    assert.ok(reads.includes('/api/routing'));
    assert.equal(get('refresh').disabled, false);
  });

  it('applies a changed routing receipt from /api/routing without re-reading the overview', async () => {
    let observed = false;
    const { intervals, overviewReads, settle, get, turn } = await startGuidedBrowser({
      respond: (path) =>
        path === '/api/routing' && observed
          ? {
              agents: [
                {
                  id: 'codex',
                  promptRouting: {
                    configured: true,
                    enablement: 'enabled',
                    verificationTier: 'runtime-observed',
                    subagentsStarted: 2,
                  },
                },
              ],
            }
          : undefined,
    });
    await turn('methods');
    const routingRow = () =>
      get('methods-root')
        .querySelectorAll('article.method')
        .find((item) => item.dataset['method'] === 'routing')!
        .querySelector('.agent-row')!.textContent;
    assert.match(routingRow(), /waiting for first use/);
    observed = true;
    for (const timer of [...intervals.values()]) if (timer.ms === 15000) void timer.callback();
    await settle();
    assert.equal(overviewReads(), 1);
    assert.doesNotMatch(routingRow(), /waiting for first use/);
    assert.match(routingRow(), /Codex.*On/);
  });
});
