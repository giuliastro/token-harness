import assert from 'node:assert/strict';
import { Script } from 'node:vm';

import { GUIDE_HTML } from '../src/guided-assets.js';
import { GUIDE_PRODUCT_JS } from '../src/guided-product-client.js';
import type { GuideOperationHistory } from '../src/guided-operation-history.js';
import type { GuideComparisons } from '../src/guided-comparisons.js';
import type { GuideBenchmarkRecovery } from '../src/guided-benchmark-recovery.js';

/**
 * Small DOM double: it parses the shipped page shell, then executes the shipped controller
 * against fake /api responses without a browser dependency. Selectors support tag, #id, .class and
 * [attribute] compounds joined by commas, which is all the controller uses.
 */
type Listener = (event: Record<string, unknown>) => unknown;

const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

export class Element {
  children: Element[] = [];
  dataset: Record<string, string> = {};
  attributes: Record<string, string> = {};
  listeners = new Map<string, Listener[]>();
  className = '';
  id = '';
  value = '';
  hidden = false;
  open = false;
  disabled = false;
  checked = false;
  tabIndex = 0;
  type = '';
  href = '';
  target = '';
  rel = '';
  htmlFor = '';
  placeholder = '';
  lang = '';
  parent: Element | null = null;
  style: Record<string, unknown> = {};
  tagName: string;
  private text = '';

  constructor(tagName = 'div') {
    this.tagName = tagName;
  }
  get textContent(): string {
    return [this.text, ...this.children.map((child) => child.textContent)]
      .filter((part) => part !== '')
      .join(' ');
  }
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  addText(value: string) {
    this.text += value;
  }
  append(...children: Element[]) {
    for (const child of children) {
      assert.ok(child instanceof Element, 'append() received a non-element');
      child.parent?.detach(child);
      child.parent = this;
      this.children.push(child);
    }
  }
  prepend(...children: Element[]) {
    for (const child of children) child.parent?.detach(child);
    for (const child of children) child.parent = this;
    this.children.unshift(...children);
  }
  private detach(child: Element) {
    this.children = this.children.filter((item) => item !== child);
  }
  replaceChildren(...children: Element[]) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.text = '';
    this.append(...children);
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = String(value);
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  addEventListener(name: string, callback: Listener) {
    this.listeners.set(name, [...(this.listeners.get(name) ?? []), callback]);
  }
  fire(name: string, event: Record<string, unknown> = {}) {
    for (const callback of this.listeners.get(name) ?? []) callback(event);
  }
  click() {
    this.fire('click');
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
    this.fire('close');
  }
  private matchesCompound(compound: string): boolean {
    const match = /^([\w*]+)?((?:[#.][\w-]+|\[[^\]]+\])*)$/.exec(compound.trim());
    assert.ok(match, 'Unsupported selector in the DOM double: ' + compound);
    const tag = match[1];
    if (tag && tag !== '*' && tag.toLowerCase() !== this.tagName.toLowerCase()) return false;
    for (const part of match[2]!.match(/[#.][\w-]+|\[[^\]]+\]/g) ?? []) {
      if (part.startsWith('#')) {
        if (this.id !== part.slice(1)) return false;
      } else if (part.startsWith('.')) {
        if (!this.className.split(/\s+/).includes(part.slice(1))) return false;
      } else {
        const [name, expected] = part.slice(1, -1).split('=') as [string, string | undefined];
        const actual =
          name === 'open'
            ? this.open
              ? ''
              : undefined
            : name.startsWith('data-')
              ? this.dataset[camel(name.slice(5))]
              : this.attributes[name];
        if (actual === undefined) return false;
        if (expected !== undefined && actual !== expected.replace(/^["']|["']$/g, '')) return false;
      }
    }
    return true;
  }
  matches(selector: string): boolean {
    return selector.split(',').some((compound) => this.matchesCompound(compound));
  }
  closest(selector: string): Element | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  querySelectorAll(selector: string): Element[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): Element | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  findById(id: string): Element | null {
    for (const child of this.children) {
      if (child.id === id) return child;
      const nested = child.findById(id);
      if (nested) return nested;
    }
    return null;
  }
}

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr']);

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** Parse the static shell into a tree so queries, ids and data-* attributes behave as in a page. */
export function parseShell(html: string): Element {
  const root = new Element('#document');
  const stack: Element[] = [root];
  const token =
    /<!--[\s\S]*?-->|<!doctype[^>]*>|<\/(\w+)\s*>|<(\w+)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)/gi;
  for (const match of html.matchAll(token)) {
    const [whole, closing, opening, attributes, text] = match;
    if (text !== undefined) {
      stack[stack.length - 1]!.addText(decode(text));
    } else if (closing) {
      for (let index = stack.length - 1; index > 0; index--)
        if (stack[index]!.tagName === closing.toLowerCase()) {
          stack.length = index;
          break;
        }
    } else if (opening) {
      const element = new Element(opening.toLowerCase());
      for (const attribute of attributes!.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
        const name = attribute[1]!;
        const value = decode(attribute[2] ?? '');
        if (name === 'id') element.id = value;
        else if (name === 'class') element.className = value;
        else if (name === 'hidden') element.hidden = true;
        else if (name === 'tabindex') element.tabIndex = Number(value);
        else if (name.startsWith('data-')) element.dataset[camel(name.slice(5))] = value;
        else element.attributes[name] = value;
      }
      stack[stack.length - 1]!.append(element);
      if (!VOID.has(element.tagName) && !whole!.endsWith('/>')) stack.push(element);
    }
  }
  return root;
}

export interface BrowserOptions {
  data?: ReturnType<typeof observation>;
  history?: GuideOperationHistory;
  comparisons?: GuideComparisons;
  recovery?: GuideBenchmarkRecovery;
  /** Seed `localStorage`, e.g. `{ 'token-harness-advanced': 'on' }`. */
  storage?: Record<string, string>;
  hash?: string;
  /** Return as soon as the controller has started, before the first overview read finishes. */
  whileLoading?: boolean;
  /** Override or extend the fake API; return undefined to fall back to the default response. */
  respond?: (path: string, body: unknown) => unknown;
}

export interface Write {
  path: string;
  body: unknown;
}

export function observation() {
  const data = {
    generatedAt: '2026-10-03T12:00:00Z',
    notices: [] as string[],
    agents: [
      {
        id: 'codex',
        name: 'Codex',
        version: '0.100.0',
        providers: ['rtk'],
        setup: [] as Array<Record<string, unknown>>,
        promptRouting: {
          configured: true,
          enablement: 'enabled',
          verificationTier: 'config-only',
        } as Record<string, unknown>,
        allowance: [] as Array<Record<string, unknown>>,
      },
    ] as Array<
      Record<string, unknown> & { id: string; name: string; promptRouting: Record<string, unknown> }
    >,
    stack: {
      state: 'ready',
      components: [
        { providerId: 'rtk', configured: true, configuredHarnesses: ['codex'] },
      ] as Array<Record<string, unknown>>,
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
            percent: '80%',
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
            percent: '80%',
            headline: 'Estimated 80% less tool output',
            detail: 'Recorded changed outputs only.',
          },
        },
      ],
    },
    value: {
      routing: { state: 'not-measured', savedLocalTokens: null as number | null, pairs: 0 },
      candidates: [] as Array<Record<string, unknown>>,
    } as Record<string, unknown> & {
      routing: { state: string; savedLocalTokens: number | null; pairs: number };
    },
  };
  return {
    ...data,
    savings: {
      ...data.savings,
      byHarness: [{ harnessId: 'codex', rows: [data.savings.rows[1]!] }] as Array<{
        harnessId: string;
        rows: unknown[];
      }>,
    },
  };
}

export async function startGuidedBrowser(options: BrowserOptions = {}) {
  const data = options.data ?? observation();
  const root = parseShell(GUIDE_HTML);
  const documentElement = root.querySelector('html') ?? new Element('html');
  const storageValues = new Map(Object.entries(options.storage ?? {}));
  const documentListeners = new Map<string, Listener[]>();
  const reads: string[] = [];
  const writes: Write[] = [];
  const intervals = new Map<number, { callback: () => unknown; ms: number }>();
  const timeouts: Array<{ callback: () => unknown; ms: number }> = [];
  let nextTimer = 1;
  const document = {
    hidden: false,
    activeElement: null as Element | null,
    documentElement,
    getElementById: (id: string) => root.findById(id),
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_namespace: string, tag: string) => new Element(tag),
    querySelector: (selector: string) => root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    addEventListener(name: string, callback: Listener) {
      documentListeners.set(name, [...(documentListeners.get(name) ?? []), callback]);
    },
  };
  const get = (id: string) => {
    const element = document.getElementById(id);
    assert.ok(element, 'Missing control: ' + id);
    return element;
  };
  get('theme').value = 'system';

  const defaults = (path: string, body: unknown): unknown => {
    if (path === '/api/session') return { token: 'fake' };
    if (path.startsWith('/api/overview')) return data;
    if (path === '/api/activity') return { activity: [] };
    if (path === '/api/operations')
      return options.history ?? { state: 'ready', operations: [], note: 'No retained changes.' };
    if (path === '/api/benchmark-recovery')
      return options.recovery ?? { state: 'none', note: 'No benchmark recovery needed.' };
    if (path === '/api/comparisons')
      return (
        options.comparisons ?? {
          available: true,
          blocked: false,
          items: [],
          note: 'Checks are user-recorded.',
        }
      );
    if (path === '/api/routing')
      return {
        agents: data.agents.map((agent) => ({ id: agent.id, promptRouting: agent.promptRouting })),
      };
    if (path === '/api/update-check')
      return {
        ok: true,
        title: 'Updates checked',
        messages: [],
        updatesAvailable: false,
        ticket: null,
      };
    if (path === '/api/verify') return { ok: true, title: 'Checked', messages: ['All good.'] };
    if (path === '/api/preview')
      return {
        ticket: 'preview-ticket',
        changes: [
          {
            title: 'Restore configuration',
            description: 'Manual edits will also be undone.',
            files: 1,
          },
        ],
        notices: [],
      };
    if (path === '/api/apply') return { ok: true, messages: ['Applied the reviewed change.'] };
    void body;
    return {};
  };

  const fetch = async (path: string, init?: { method?: string; body?: string }) => {
    reads.push(path);
    const body = init?.body ? (JSON.parse(init.body) as unknown) : undefined;
    if (init?.method === 'POST') writes.push({ path, body });
    const custom = await options.respond?.(path, body);
    const result = custom !== undefined ? custom : defaults(path, body);
    if (result instanceof Error)
      return { ok: false, json: async () => ({ error: result.message }) };
    return { ok: true, json: async () => result };
  };

  const window = {
    location: { hash: options.hash ?? '', pathname: '/', reload() {} },
  };
  new Script(GUIDE_PRODUCT_JS).runInNewContext({
    document,
    window,
    history: { replaceState() {} },
    navigator: { language: 'en-US', clipboard: { writeText: async () => undefined } },
    fetch,
    AbortSignal,
    localStorage: {
      getItem: (key: string) => storageValues.get(key) ?? null,
      setItem: (key: string, value: string) => void storageValues.set(key, value),
    },
    setInterval: (callback: () => unknown, ms: number) => {
      intervals.set(nextTimer, { callback, ms });
      return nextTimer++;
    },
    clearInterval: (id: number) => void intervals.delete(id),
    setTimeout: (callback: () => unknown, ms: number) => {
      timeouts.push({ callback, ms });
      return 0;
    },
  });

  const settle = async (allowError = false) => {
    for (let turn = 0; turn < 24; turn++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    if (!allowError) assert.equal(get('error').textContent, '');
  };
  if (!options.whileLoading) {
    await settle();
    assert.match(get('updated').textContent, /Updated at/);
  }

  /** Every button under `root` whose visible text is exactly `label`. */
  const buttons = (parent: Element, label: string) =>
    parent.querySelectorAll('button').filter((button) => button.textContent === label);
  const button = (parent: Element, label: string) => {
    const found = buttons(parent, label)[0];
    assert.ok(found, 'Missing button: ' + label);
    return found;
  };
  const turn = async (view: 'home' | 'methods' | 'details') => {
    if (view === 'details' && get('tab-details').hidden) get('advanced-toggle').fire('click');
    else get('tab-' + view).fire('click');
    await settle();
  };
  const fireDocument = (name: string) => {
    for (const callback of documentListeners.get(name) ?? []) callback({});
  };

  return {
    get,
    data,
    reads,
    writes,
    intervals,
    timeouts,
    settle,
    buttons,
    button,
    turn,
    document,
    fireDocument,
    storage: storageValues,
    overviewReads: () => reads.filter((path) => path.startsWith('/api/overview')).length,
    previews: () => writes.filter((write) => write.path === '/api/preview'),
    applies: () => writes.filter((write) => write.path === '/api/apply'),
  };
}
