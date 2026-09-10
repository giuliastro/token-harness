import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_STACK_JS } from '../src/guided-assets.js';

describe('guided optimization candidates', () => {
  it('keeps future candidates visibly separate from the active optimization stack', () => {
    assert.match(GUIDE_HTML, /<h2>Potential improvements<\/h2>/);
    assert.match(GUIDE_HTML, /id="stack"/);
    assert.match(GUIDE_HTML, /id="candidates"/);
    assert.match(GUIDE_HTML, /not presented as installed, recommended, or beneficial/);
  });

  it('surfaces Headroom and mcptoon as evaluation targets without claiming measured value', () => {
    assert.match(GUIDE_STACK_JS, /displayName: 'Headroom'/);
    assert.match(GUIDE_STACK_JS, /displayName: 'mcptoon'/);
    assert.match(GUIDE_STACK_JS, /Candidate only/);
    assert.match(GUIDE_STACK_JS, /Not in your active stack/);
    assert.match(GUIDE_STACK_JS, /Evidence required before adding/);
    assert.doesNotMatch(GUIDE_STACK_JS, /Headroom[^\n]*saved/i);
    assert.doesNotMatch(GUIDE_STACK_JS, /mcptoon[^\n]*saved/i);
  });

  it('states the safety boundary and adds no candidate network or install action', () => {
    assert.match(GUIDE_STACK_JS, /never performed silently/);
    assert.match(GUIDE_STACK_JS, /No sync or compression policy is enabled automatically/);
    assert.doesNotMatch(GUIDE_STACK_JS, /fetch\([^\n]*(headroom|mcptoon)/i);
    assert.doesNotMatch(GUIDE_STACK_JS, /proxyButton\([^\n]*(headroom|mcptoon)/i);
    assert.doesNotThrow(() => new Script(GUIDE_STACK_JS));
  });
});
