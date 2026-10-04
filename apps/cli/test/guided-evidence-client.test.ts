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
