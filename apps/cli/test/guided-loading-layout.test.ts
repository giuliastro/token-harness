import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';
import { observation, startGuidedBrowser } from './guided-browser-double.js';

describe('guided loading layout', () => {
  it('shows stable loading surfaces in every view while the first read is pending', async () => {
    assert.match(GUIDE_HTML, /id="updated">Checking your setup…</);
    assert.match(GUIDE_HTML, /id="reading-spinner"/);
    assert.match(GUIDE_HTML, /id="home-root"/);
    assert.match(GUIDE_HTML, /id="methods-root"/);
    assert.match(GUIDE_HTML, /id="view-loading"/);

    const data = observation();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const browser = await startGuidedBrowser({
      data,
      whileLoading: true,
      respond: (path) => (path.startsWith('/api/overview') ? gate.then(() => data) : undefined),
    });
    await browser.settle();
    // Nothing is known yet: one centred loading screen says what is happening, the views and the
    // status line stay hidden, and no state is invented.
    assert.equal(browser.get('view-loading').hidden, false);
    assert.equal(browser.get('status-line').hidden, true);
    assert.match(browser.get('loading-root').textContent, /Checking your computer…/);
    assert.match(browser.get('loading-root').textContent, /Finding Claude Code and Codex/);
    assert.equal(browser.get('view-home').hidden, true);
    assert.equal(browser.get('view-methods').hidden, true);
    assert.equal(browser.get('methods-root').querySelectorAll('article.method').length, 0);
    assert.doesNotMatch(browser.get('home-root').textContent, /Token Harness is working/);
    assert.equal(
      browser.get('view-onboarding').hidden,
      true,
      'first-run is not guessed before data',
    );

    release();
    await browser.settle();
    assert.equal(browser.get('view-loading').hidden, true);
    assert.equal(browser.get('status-line').hidden, false);
    assert.equal(browser.get('view-home').hidden, false);
    assert.match(browser.get('updated').textContent, /Updated at/);
    assert.equal(browser.get('reading-spinner').hidden, true);
    assert.match(browser.get('home-root').textContent, /Token Harness is working/);
    assert.equal(browser.get('methods-root').querySelectorAll('article.method').length, 8);
  });

  it('surfaces progressive read feedback without triggering another full refresh', () => {
    assert.match(GUIDE_JS, /checks done/);
    assert.match(
      GUIDE_JS,
      /setInterval\(\(\) => \{ if \(!document\.hidden\) loadActivity\(\); \}, 700\)/,
    );
    assert.match(GUIDE_JS, /loadActivity\(\)/);
    assert.doesNotMatch(
      GUIDE_JS,
      /setInterval\s*\(\s*(?:async\s*)?\(\)\s*=>\s*(?:\{[^}]*\brefresh\s*\(|\brefresh\s*\()/,
    );
  });

  it('reports startup progress from the activity feed while the overview is still being read', async () => {
    const data = observation();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const browser = await startGuidedBrowser({
      data,
      whileLoading: true,
      respond: (path) => {
        if (path.startsWith('/api/overview')) return gate.then(() => data);
        if (path === '/api/activity')
          return {
            activity: [],
            loading: {
              running: true,
              stages: [
                { id: 'agents', label: 'Finding agents', state: 'ready' },
                { id: 'allowance', label: 'Checking allowance', state: 'working' },
                { id: 'savings', label: 'Importing reductions', state: 'working' },
              ],
            },
          };
        return undefined;
      },
    });
    await browser.settle();
    // The 700 ms progress timer is the only timer that runs while the first read is in flight.
    const timer = [...browser.intervals.values()].find((item) => item.ms === 700)!;
    assert.ok(timer);
    await timer.callback();
    await browser.settle();
    // Stages are named in plain language; stages not reported yet count as still working.
    const screen = browser.get('loading-root');
    assert.match(screen.textContent, /1 of 6 checks done/);
    assert.equal(screen.querySelectorAll('li.done').length, 1);
    assert.equal(screen.querySelectorAll('li.working').length, 5);
    assert.match(screen.textContent, /Reading your plan usage/);
    assert.equal(browser.overviewReads(), 1);
    release();
    await browser.settle();
    assert.equal([...browser.intervals.values()].filter((item) => item.ms === 700).length, 0);
  });
});
