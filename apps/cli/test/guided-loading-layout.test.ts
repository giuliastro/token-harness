import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GUIDE_HTML } from '../src/guided-assets.js';

describe('guided loading layout', () => {
  it('uses the loaded agent-card padding while Claude and Codex are still skeletons', () => {
    assert.equal(GUIDE_HTML.match(/class="panel agent loading-card"/g)?.length, 2);
    assert.equal(GUIDE_HTML.includes('class="panel loading-card"'), false);
  });
});
