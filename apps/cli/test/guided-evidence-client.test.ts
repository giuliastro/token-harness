import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML } from '../src/guided-assets.js';
import { GUIDE_PRODUCT_JS } from '../src/guided-product-client.js';

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
  return {
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
}

async function browser(data = observation()) {
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
  const fetch = async (path: string) => {
    reads.push(path);
    return {
      ok: true,
      json: async () =>
        path === '/api/session'
          ? { token: 'fake' }
          : path.startsWith('/api/overview')
            ? data
            : path === '/api/activity'
              ? { activity: [] }
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
  return { get, tabs, reads, settle };
}

describe('guided evidence interactions', () => {
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
    assert.equal(get('evidence-count').textContent, '1 of 7 sources');
    get('evidence-filter').value = 'no-such-source';
    get('evidence-filter').fire('input');
    assert.equal(get('evidence-empty').hidden, false);
    get('evidence-reset').fire('click');
    assert.equal(get('evidence-type').value, 'all');
    assert.equal(get('evidence-filter').value, '');
    assert.equal(get('evidence-count').textContent, '7 of 7 sources');
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
    assert.equal(get('result-evidence').children[0]!.dataset['name'], 'automatic prompt routing');
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
    assert.match(growth.get('result-summary').textContent, /250 tokens added/);
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
});
