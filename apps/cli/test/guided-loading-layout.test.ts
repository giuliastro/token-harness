import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided loading layout', () => {
  it('uses the loaded agent-card padding while Claude and Codex are still skeletons', () => {
    assert.equal(GUIDE_HTML.match(/class="panel agent loading-card"/g)?.length, 2);
    assert.equal(GUIDE_HTML.includes('class="panel loading-card"'), false);
  });

  it('surfaces progressive read feedback without triggering another full refresh', () => {
    assert.match(GUIDE_JS, /PROGRESS_POLL_MS = 500/);
    assert.match(GUIDE_JS, /checks finished/);
    assert.match(GUIDE_JS, /Still /);
    assert.match(GUIDE_JS, /target\.includes\('\/api\/activity'\)/);
    assert.match(GUIDE_JS, /typeof activity === 'function'/);
    assert.doesNotMatch(GUIDE_JS, /PROGRESS_POLL_MS[^]*refresh\(/);
  });
});
