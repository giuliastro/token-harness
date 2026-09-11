import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided experimental tools', () => {
  it('puts candidates in Setup while keeping them visibly outside the managed stack', () => {
    assert.match(GUIDE_HTML, /<h2>Experimental tools<\/h2>/);
    assert.match(GUIDE_HTML, /Headroom, mcptoon and GitNexus/);
    assert.match(GUIDE_HTML, /does not silently install or activate them/);
    assert.match(GUIDE_JS, /Active stack/);
    assert.match(GUIDE_JS, /Automatic install/);
    assert.match(GUIDE_JS, /'No'/);
  });

  it('includes all three reviewed candidate install guides', () => {
    assert.match(GUIDE_JS, /name: 'Headroom'/);
    assert.match(GUIDE_JS, /uv tool install --python 3\.13/);
    assert.match(GUIDE_JS, /name: 'mcptoon'/);
    assert.match(GUIDE_JS, /pip install mcptoon/);
    assert.match(GUIDE_JS, /name: 'GitNexus'/);
    assert.match(GUIDE_JS, /npm install -g gitnexus@latest/);
    assert.match(GUIDE_JS, /Repository exploration/);
  });

  it('separates installation, activation and evidence collection', () => {
    assert.match(GUIDE_JS, /Installation is not activation/);
    assert.match(GUIDE_JS, /Candidate attribution names the experiment target/);
    assert.match(GUIDE_JS, /not proof that the optimized run used the candidate/);
    assert.match(GUIDE_JS, /benchmark-start/);
    assert.match(GUIDE_JS, /--variant baseline/);
    assert.match(GUIDE_JS, /--variant optimized/);
  });

  it('warns before candidate-side commands that mutate or activate external tools', () => {
    assert.match(GUIDE_JS, /Headroom can launch a wrapped Claude Code or Codex session/);
    assert.match(GUIDE_JS, /does not run mcptoon init\/add\/sync/);
    assert.match(GUIDE_JS, /GitNexus needs a repository index/);
    assert.match(GUIDE_JS, /gitnexus analyze changes the repository/);
    assert.match(GUIDE_JS, /Token Harness deliberately does not create that index/);
  });

  it('is a self-contained browser controller with no candidate network/install execution', () => {
    assert.doesNotMatch(GUIDE_JS, /fetch\([^\n]*(headroom|mcptoon|gitnexus)/i);
    assert.doesNotMatch(GUIDE_JS, /request\([^\n]*(headroom|mcptoon|gitnexus)/i);
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });
});
