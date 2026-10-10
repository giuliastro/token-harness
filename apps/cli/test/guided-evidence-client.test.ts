import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';
import { harnessId } from '@token-harness/core';

import { GUIDE_HTML } from '../src/guided-assets.js';
import { GUIDE_PRODUCT_JS } from '../src/guided-product-client.js';
import type { GuideOperationHistory } from '../src/guided-operation-history.js';
import type { GuideComparisons } from '../src/guided-comparisons.js';
import type { GuideBenchmarkRecovery } from '../src/guided-benchmark-recovery.js';

/** Small DOM double: execute the shipped controller against fake reads, without a browser dependency. */
class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Array<(event: Record<string, unknown>) => unknown>>();
  className = '';
  value = '';
  hidden = false;
  open = false;
  disabled = false;
  tabIndex = 0;
  parent: Element | null = null;
  style = { setProperty() {} };
  private text = '';

  tagName: string;
  constructor(tagName = 'div') {
    this.tagName = tagName;
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join(' ');
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  append(...children: Element[]) {
    for (const child of children) {
      if (child.parent)
        child.parent.children = child.parent.children.filter((item) => item !== child);
      child.parent = this;
      this.children.push(child);
    }
  }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
    this.append(...children);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  addEventListener(name: string, callback: (event: Record<string, unknown>) => unknown) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), callback]);
  }
  fire(name: string, event: Record<string, unknown> = {}) {
    for (const callback of this.listeners.get(name) || []) callback(event);
  }
  focus() {
    this.attributes['focused'] = 'true';
  }
  scrollIntoView() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  querySelectorAll(selector: string): Element[] {
    const descendants = this.children.flatMap((child) => [child, ...child.querySelectorAll('*')]);
    return descendants.filter(
      (child) =>
        selector === '*' ||
        selector === child.tagName ||
        (selector === 'details[open]' && child.tagName === 'details' && child.open),
    );
  }
}

function observation() {
  const data = {
    generatedAt: '2026-10-03T12:00:00Z',
    notices: [],
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        version: '0.100.0',
        providers: ['rtk'],
        setup: [],
        promptRouting: { configured: true, enablement: 'enabled', verificationTier: 'config-only' },
      },
    ],
    stack: {
      state: 'ready',
      components: [{ providerId: 'rtk', configured: true, configuredHarnesses: ['codex'] }],
    },
    savings: {
      rows: [
        {
          providerId: 'rtk',
          provider: 'RTK',
          measurement: 'Measured local output',
          unit: 'tokens',
          before: 1000,
          after: 200,
          saved: 800,
          operations: 4,
          harnesses: [],
          agents: [],
          impact: {
            kind: 'reduction',
            headline: '80% less tool output',
            detail: 'Recorded changed outputs only.',
          },
        },
        {
          providerId: 'rtk',
          provider: 'RTK',
          measurement: 'Local estimate',
          unit: 'characters',
          before: 500,
          after: 100,
          saved: 400,
          operations: 2,
          harnesses: ['codex'],
          agents: ['Codex'],
          impact: {
            kind: 'reduction',
            headline: 'Estimated 80% less tool output',
            detail: 'Recorded changed outputs only.',
          },
        },
      ],
    },
    value: {
      routing: { state: 'not-measured', savedLocalTokens: null as number | null, pairs: 0 },
      candidates: [],
    },
  };
  return {
    ...data,
    savings: {
      ...data.savings,
      byHarness: [{ harnessId: 'codex', rows: [data.savings.rows[1]!] }],
    },
  };
}

async function browser(
  data = observation(),
  history?: GuideOperationHistory,
  comparisons?: GuideComparisons,
  recovery?: GuideBenchmarkRecovery,
) {
  const elements = new Map<string, Element>();
  for (const match of GUIDE_HTML.matchAll(/<(\w+)[^>]*\bid="([^"]+)"[^>]*>/g))
    elements.set(match[2]!, new Element(match[1]!));
  const get = (id: string) => {
    const element = elements.get(id);
    assert.ok(element, 'Missing HTML control: ' + id);
    return element;
  };
  get('period').value = 'all';
  get('evidence-type').value = 'all';
  get('evidence-sort').value = 'evidence';
  get('tab-dashboard').dataset['view'] = 'dashboard';
  get('tab-results').dataset['view'] = 'results';
  const tabs = new Element('nav');
  const reads: string[] = [];
  const writes: Array<{ path: string; body: unknown }> = [];
  const fetch = async (path: string, options?: { method?: string; body?: string }) => {
    reads.push(path);
    if (options?.method === 'POST') writes.push({ path, body: JSON.parse(options.body!) });
    return {
      ok: true,
      json: async () =>
        path === '/api/session'
          ? { token: 'fake' }
          : path.startsWith('/api/overview')
            ? data
            : path === '/api/activity'
              ? { activity: [] }
              : path === '/api/operations'
                ? (history ?? { state: 'ready', operations: [], note: 'No retained changes.' })
                : path === '/api/benchmark-recovery'
                  ? (recovery ?? { state: 'none', note: 'No benchmark recovery needed.' })
                  : path === '/api/comparisons'
                    ? (comparisons ?? {
                        available: true,
                        blocked: false,
                        items: [],
                        note: 'Checks are user-recorded.',
                      })
                    : path === '/api/preview'
                      ? {
                          ticket: 'restore-ticket',
                          changes: [
                            {
                              title: 'Restore configuration',
                              description: 'Manual edits will also be undone.',
                              files: 1,
                            },
                          ],
                          notices: [],
                        }
                      : {},
    };
  };
  new Script(GUIDE_PRODUCT_JS).runInNewContext({
    document: {
      getElementById: (id: string) => elements.get(id) || null,
      createElement: (tag: string) => new Element(tag),
      documentElement: new Element('html'),
      querySelector: () => tabs,
      querySelectorAll: () => [get('tab-dashboard'), get('tab-results')],
      addEventListener() {},
    },
    window: {},
    fetch,
    AbortSignal,
    Intl: {
      NumberFormat: class extends Intl.NumberFormat {
        constructor(locales?: Intl.LocalesArgument, options?: Intl.NumberFormatOptions) {
          super(locales ?? 'en-US', options);
        }
      },
    },
    localStorage: { getItem: () => 'light' },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout() {},
  });
  const settle = async () => {
    for (let turn = 0; turn < 4; turn++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(get('error').textContent, '');
  };
  await settle();
  assert.match(get('updated').textContent, /Updated at/);
  return { get, tabs, reads, writes, settle };
}

describe('guided evidence interactions', () => {
  it('starts a paired capture only through a separate preview and approval', async () => {
    const { get, writes, settle } = await browser();
    get('manage-comparisons').fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /Baseline → task and checks → optimized/);
    assert.ok(writes.every((item) => !['/api/preview', '/api/apply'].includes(item.path)));
    get('modal-content')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Review new baseline')!
      .fire('click');
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
        .some((button) => button.textContent === 'Record reviewed step'),
    );
  });

  it('requires an explicit quality result and coherent counts before reviewing a retained capture', async () => {
    const { get, writes, settle } = await browser(observation(), undefined, {
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
    });
    get('manage-comparisons').fire('click');
    await settle();
    get('modal-content')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Record baseline outcome')!
      .fire('click');
    const review = get('modal-actions')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Review recorded outcome')!;
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
    const { get, writes, settle } = await browser(observation(), {
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
    });
    get('tab-results').fire('click');
    await settle();
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
        .some((button) => button.textContent === 'Restore reviewed backup'),
    );
  });
  it('keeps project claims scoped to setup and links the live source projects', async () => {
    const { get, reads } = await browser();
    const setup = get('connection-overview');
    const items = setup.querySelectorAll('article');
    assert.equal(items.length, 5);
    const expected = [
      ['rtk', 'https://github.com/rtk-ai/rtk', 'Supported shell-command output'],
      ['harnesstrim', 'https://github.com/giuliastro/HarnessTrim', '10 fixed fixtures'],
      ['mcptoon', 'https://github.com/activeing123/mcptoon', '255 tools'],
      ['gitnexus', 'https://github.com/abhigyanpatwari/GitNexus', 'No published %'],
      ['headroom', 'https://github.com/headroomlabs-ai/headroom', '4 offline scenarios'],
    ];
    for (const [id, url, scope] of expected) {
      const item = items.find((item) => item.dataset['optimizer'] === id)!;
      assert.ok(item);
      assert.ok(item.textContent.includes(scope!));
      const source = item.querySelectorAll('a')[0]! as Element & {
        href: string;
        target: string;
        rel: string;
      };
      assert.equal(source.href, url);
      assert.equal(source.target, '_blank');
      assert.equal(source.rel, 'noopener noreferrer');
      assert.match(source.attributes['aria-label']!, /source project \(opens in a new tab\)/);
      assert.equal(item.querySelectorAll('details')[0]!.open, false);
    }
    assert.match(setup.textContent, /not expected savings on your machine/);
    assert.match(items[2]!.textContent, /name index, not full schemas or tool results/);
    assert.match(items[4]!.textContent, /does not enable the project’s broader proxy features/);
    assert.doesNotMatch(get('result-evidence').textContent, /99\.2%|75\.8%|21–57%/);
    assert.doesNotMatch(get('dashboard-metrics').textContent, /99\.2%|75\.8%|21–57%/);
    const before = reads.length;
    const details = items[0]!.querySelectorAll('details')[0]!;
    details.open = true;
    details.fire('toggle');
    assert.equal(reads.length, before);
  });

  it('retains optimizer and routing explanations across read-only refreshes', async () => {
    const { get, settle } = await browser();
    const optimizer = get('connection-overview').querySelectorAll('details')[0]!;
    const routing = get('setup-agents').querySelectorAll('details')[0]!;
    assert.match(routing.textContent, /gpt-6-luna/);
    assert.match(routing.textContent, /main model reviews and integrates/);
    assert.match(routing.textContent, /does not prove delegation or savings/);
    assert.match(routing.textContent, /trust the hook in Codex \/hooks/);
    for (const details of [optimizer, routing]) {
      details.open = true;
      details.fire('toggle');
    }
    get('refresh').fire('click');
    await settle();
    assert.equal(get('connection-overview').querySelectorAll('details')[0]!.open, true);
    assert.equal(get('setup-agents').querySelectorAll('details')[0]!.open, true);
    const restored = get('connection-overview').querySelectorAll('details')[0]!;
    restored.open = false;
    restored.fire('toggle');
    get('refresh').fire('click');
    await settle();
    assert.equal(get('connection-overview').querySelectorAll('details')[0]!.open, false);
  });

  it('lets users explore projects before a coding app is detected', async () => {
    const data = observation();
    data.agents = [];
    const { get } = await browser(data);
    assert.equal(get('connection-overview').querySelectorAll('article').length, 5);
    assert.match(get('connection-overview').textContent, /Connections become available/);
    assert.equal(get('connection-overview').querySelectorAll('button').length, 1);
    assert.doesNotMatch(get('connection-overview').textContent, /Install & connect/);
  });

  it('keeps classes and units separate and does not infer app attribution from setup', async () => {
    const { get } = await browser();
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

  it('searches collapsed provenance, combines type filters, and resets an empty search', async () => {
    const { get } = await browser();
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
    const { get, settle } = await browser();
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
  });

  it('blocks routed savings when quality regresses and keeps increased usage explicit', async () => {
    const data = observation();
    data.value.routing = { state: 'blocked-by-quality', savedLocalTokens: 999, pairs: 0 };
    const blocked = await browser(data);
    const routing = blocked
      .get('result-evidence')
      .children.find((row) => row.dataset['type'] === 'routing')!;
    assert.match(routing.textContent, /Not credited/);
    assert.doesNotMatch(routing.textContent, /999.*saved/);
    data.value.routing = { state: 'measured', savedLocalTokens: -250, pairs: 1 };
    const growth = await browser(data);
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

  it('supports keyboard tabs and the direct Overview results action without another overview read', async () => {
    const { get, tabs, reads } = await browser();
    get('overview-results').fire('click');
    assert.equal(get('view-results').hidden, false);
    assert.equal(get('tab-results').attributes['aria-selected'], 'true');
    let prevented = false;
    tabs.fire('keydown', {
      key: 'Home',
      preventDefault: () => {
        prevented = true;
      },
    });
    assert.equal(prevented, true);
    assert.equal(get('view-dashboard').hidden, false);
    assert.equal(get('tab-dashboard').attributes['focused'], 'true');
    assert.equal(reads.filter((path) => path.startsWith('/api/overview')).length, 1);
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
    const { get } = await browser(data);
    const app = get('result-evidence').children.find((row) => row.dataset['name'] === 'codex')!;
    assert.match(app.textContent, /v0\.146\.0/);
    assert.match(app.textContent, /3 prompt callbacks.*1 subagents started/);
    assert.match(app.textContent, /75% remaining.*45% remaining/);
    assert.match(app.textContent, /gpt-6-luna/);
    assert.doesNotMatch(app.textContent, /No linked results|800 tokens|80% less/);
    const routing = get('result-evidence').children.find(
      (row) => row.dataset['type'] === 'routing',
    )!;
    assert.match(routing.textContent, /3 prompt callbacks/);
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
    const { get } = await browser(data);
    const app = get('result-evidence').children.find((row) => row.dataset['type'] === 'harness')!;
    assert.match(app.textContent, /No activity recorded/);
    assert.match(app.textContent, /trust this hook/);
    assert.match(app.textContent, /Configuration only/);
    assert.match(app.textContent, /Native quota reader is unavailable/);
    assert.doesNotMatch(app.textContent, /prompt callbacks|0% remaining|tokens saved/);
  });

  it('filters allowance and quality as measurements and opens a real paired capture guide', async () => {
    const { get, reads } = await browser();
    get('evidence-type').value = 'measurement';
    get('evidence-type').fire('change');
    assert.deepEqual(
      get('result-evidence')
        .children.filter((row) => !row.hidden)
        .map((row) => row.dataset['name']),
      ['5h / 7d allowance', 'task quality'],
    );
    const before = reads.length;
    get('record-comparison').fire('click');
    assert.equal(get('modal').open, true);
    const guide = get('modal-content');
    assert.match(guide.textContent, /benchmark-start.*--variant baseline.*--harness codex/);
    assert.match(guide.textContent, /benchmark-start.*--variant optimized.*--harness codex/);
    assert.match(guide.textContent, /benchmark-finish.*--quality <passed\|failed>/);
    assert.match(guide.textContent, /disable routing.*baseline/);
    assert.match(guide.textContent, /must actually start a native subagent/);
    assert.match(guide.textContent, /same project where this dashboard was opened/);
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
    const { get, reads, writes, settle } = await browser(data, undefined, undefined, {
      state: 'pending',
      benchmarkId: 'active-four',
      variant: 'combined',
      harness: harnessId('codex'),
      files: 1,
      note: 'Review saved original configuration. Recovery does not finish the capture.',
    });
    const content = get('result-evidence').textContent;
    assert.match(content, /Temporary configuration needs completion or recovery/);
    assert.match(content, /Prepared arm: active-four \/ combined/);
    assert.doesNotMatch(content, /benchmark-restore/);
    assert.ok(!reads.some((r) => r.includes('benchmark-restore')));
    get('result-evidence')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Review benchmark recovery')!
      .fire('click');
    await settle();
    assert.ok(reads.includes('/api/benchmark-recovery'));
    assert.match(get('modal-content').textContent, /active-four.*combined/);
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
    get('modal-actions')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Review benchmark recovery')!
      .fire('click');
    await settle();
    assert.deepEqual(
      writes.filter((write) => ['/api/preview', '/api/apply'].includes(write.path)),
      [{ path: '/api/preview', body: { action: 'benchmark-recover' } }],
    );
    get('modal-actions')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Cancel')!
      .fire('click');
    await settle();
    assert.ok(
      !writes.some((write) => write.path === '/api/apply'),
      'closing the preview never applies recovery',
    );
  });

  it('offers no recovery approval when the retained lease belongs to another project', async () => {
    const { get, writes, settle } = await browser(observation(), undefined, undefined, {
      state: 'other-project',
      benchmarkId: null,
      variant: null,
      harness: null,
      files: 0,
      note: 'Open the project that owns this temporary configuration.',
    });
    get('maintenance-actions')
      .querySelectorAll('button')
      .find((button) => button.textContent === 'Review benchmark recovery')!
      .fire('click');
    await settle();
    assert.match(get('modal-content').textContent, /Open the project/);
    assert.deepEqual(
      get('modal-actions')
        .querySelectorAll('button')
        .map((button) => button.textContent),
      ['Done', 'Refresh recovery'],
    );
    assert.ok(writes.every((write) => !['/api/preview', '/api/apply'].includes(write.path)));
  });

  it('offers a saved direct check and four arms without executing anything from the guide', async () => {
    const { get, reads } = await browser();
    get('record-comparison').fire('click');
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

  it('shows check disagreements and combined-only regressions in Results without merging evidence classes', async () => {
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
    const { get } = await browser(data);
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
});
