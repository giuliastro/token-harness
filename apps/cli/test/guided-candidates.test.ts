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

  it('renders the typed candidate lifecycle without promoting candidates into the active stack', () => {
    assert.match(GUIDE_STACK_JS, /displayName: 'Headroom'/);
    assert.match(GUIDE_STACK_JS, /displayName: 'mcptoon'/);
    assert.match(GUIDE_STACK_JS, /'absent'/);
    assert.match(GUIDE_STACK_JS, /'installed'/);
    assert.match(GUIDE_STACK_JS, /'unsupported-version'/);
    assert.match(GUIDE_STACK_JS, /'benchmark-ready'/);
    assert.match(GUIDE_STACK_JS, /Not installed/);
    assert.match(GUIDE_STACK_JS, /Benchmark needed/);
    assert.match(GUIDE_STACK_JS, /Version not reviewed/);
    assert.match(GUIDE_STACK_JS, /Ready to benchmark/);
    assert.match(GUIDE_STACK_JS, /not admitted to the active stack/);
    assert.match(GUIDE_STACK_JS, /Benchmark baseline/);
    assert.doesNotMatch(GUIDE_STACK_JS, /Headroom[^\n]*saved/i);
    assert.doesNotMatch(GUIDE_STACK_JS, /mcptoon[^\n]*saved/i);
  });

  it('consumes only the bounded overview projection and adds no candidate network or install action', () => {
    assert.match(GUIDE_STACK_JS, /data\?\.optimizationCandidates/);
    assert.match(GUIDE_STACK_JS, /never performed silently/);
    assert.match(GUIDE_STACK_JS, /No sync or compression policy is enabled automatically/);
    assert.doesNotMatch(GUIDE_STACK_JS, /fetch\([^\n]*(headroom|mcptoon)/i);
    assert.doesNotMatch(GUIDE_STACK_JS, /proxyButton\([^\n]*(headroom|mcptoon)/i);
    assert.doesNotThrow(() => new Script(GUIDE_STACK_JS));
  });
});
