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
    // Nothing is known yet: each view says what it is waiting for and no state is invented.
    assert.match(browser.get('updated').textContent, /Checking your agents and methods…/);
    assert.equal(browser.get('reading-spinner').hidden, false);
    assert.match(browser.get('home-root').textContent, /Checking your computer…/);
    assert.match(browser.get('methods-root').textContent, /Checking your methods…/);
    assert.equal(browser.get('methods-root').querySelectorAll('article.method').length, 0);
    assert.doesNotMatch(browser.get('home-root').textContent, /Token Harness is working/);
    assert.equal(browser.get('view-home').hidden, false);
    assert.equal(
      browser.get('view-onboarding').hidden,
      true,
      'first-run is not guessed before data',
    );

    release();
    await browser.settle();
    assert.match(browser.get('updated').textContent, /Updated at/);
    assert.equal(browser.get('reading-spinner').hidden, true);
    assert.match(browser.get('home-root').textContent, /Token Harness is working/);
    assert.equal(browser.get('methods-root').querySelectorAll('article.method').length, 8);
  });

  it('surfaces progressive read feedback without triggering another full refresh', () => {
    assert.match(GUIDE_JS, /checks finished/);
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
                { label: 'Agents', state: 'success' },
                { label: 'Plan usage', state: 'working' },
                { label: 'Savings', state: 'working' },
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
    assert.match(browser.get('updated').textContent, /1\/3 checks finished · plan usage · savings/);
    assert.equal(browser.overviewReads(), 1);
    release();
    await browser.settle();
    assert.equal([...browser.intervals.values()].filter((item) => item.ms === 700).length, 0);
  });
});
