import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided actions UI', () => {
  it('keeps reasoning-only Agent and Work controls hidden outside the reasoning flow', () => {
    assert.match(GUIDE_HTML, /<style>\[hidden\]\{display:none!important\}<\/style>/);
    assert.match(GUIDE_HTML, /<div id="task-form" hidden>/);
    assert.match(GUIDE_HTML, /These choices are used only for reasoning optimization/);
  });

  it('explains optimizer setup before running a preview', () => {
    assert.match(GUIDE_HTML, /Set up output optimizers/);
    assert.match(GUIDE_HTML, /RTK \+ HarnessTrim/);
    assert.match(GUIDE_HTML, /Choose agent and review setup/);
    assert.match(GUIDE_JS, /Choose the coding agent you want to optimize/);
    assert.match(GUIDE_JS, /Review setup is read-only/);
    assert.match(GUIDE_JS, /Apply reviewed setup/);
    assert.match(
      GUIDE_JS,
      /The Apply button appears only if Token Harness can build a safe, concrete change plan/,
    );
  });

  it('does not automatically refresh after applying optimizer setup', () => {
    assert.match(GUIDE_JS, /will not run another full check automatically/);
    assert.doesNotMatch(
      GUIDE_JS,
      /async function applySetup[\s\S]*?\$\('refresh'\)\.click\(\)/,
    );
  });

  it('keeps setup routed through the existing preview and apply transaction endpoints', () => {
    assert.match(
      GUIDE_JS,
      /post\('\/api\/preview', \{ action: 'setup', harness: agent \}\)/,
    );
    assert.match(GUIDE_JS, /post\('\/api\/apply', \{ ticket \}\)/);
    assert.match(
      GUIDE_JS,
      /Backups, ownership checks and verification run as part of the transaction/,
    );
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });
});
