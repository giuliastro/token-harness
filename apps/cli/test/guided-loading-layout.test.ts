import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided loading layout', () => {
  it('shows stable setup-first loading surfaces while agent data is being read', () => {
    assert.match(GUIDE_HTML, /id="dashboard-status"/);
    assert.match(GUIDE_HTML, /id="setup-agents"/);
    assert.match(GUIDE_HTML, /Checking agents…/);
    assert.match(GUIDE_HTML, /id="agent-capabilities"/);
  });

  it('surfaces progressive read feedback without triggering another full refresh', () => {
    assert.match(GUIDE_JS, /checks finished/);
    assert.match(GUIDE_JS, /setInterval\(\(\) => \{ if \(!document\.hidden\) loadActivity\(\); \}, 700\)/);
    assert.match(GUIDE_JS, /loadActivity\(\)/);
    assert.doesNotMatch(GUIDE_JS, /setInterval\([^]*refresh\(/);
  });
});
