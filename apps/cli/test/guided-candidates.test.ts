import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided optional managed optimizers', () => {
  it('places reviewed tools under Optional optimizers instead of Experimental tools', () => {
    assert.match(GUIDE_HTML, /<h2>Optimization stack<\/h2>/);
    assert.match(GUIDE_HTML, /<summary>Optional optimizers<\/summary>/);
    assert.match(GUIDE_HTML, /They are not required to complete first-run setup/);
    assert.doesNotMatch(GUIDE_HTML, /<h2>Experimental tools<\/h2>/);
    assert.match(GUIDE_JS, /const EXPERIMENTAL = \[\];/);
    assert.match(GUIDE_JS, /optional\.map\(renderManagedTool\)/);
    assert.match(GUIDE_JS, /optimizerIds\(\)/);
  });

  it('sets up each optional optimizer through a provider-scoped managed plan', () => {
    assert.match(GUIDE_JS, /Optional optimizer/);
    assert.match(GUIDE_JS, /Manage connections/);
    assert.match(GUIDE_JS, /reviewSetup\(null, id\)/);
    assert.match(GUIDE_JS, /provider: providerId/);
    assert.match(GUIDE_JS, /PolyForm Noncommercial/);
  });

  it('keeps the recommended baseline distinct from optional managed integrations', () => {
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /RTK \+ HarnessTrim are the recommended starting stack/);
    assert.match(GUIDE_JS, /Recommended baseline/);
    assert.match(GUIDE_JS, /Optional optimizer/);
    assert.match(GUIDE_HTML, /never counted as savings merely because they are configured/);
  });

  it('keeps experimental benchmark evidence separate from managed setup', () => {
    assert.match(GUIDE_HTML, /<h2>Experimental benchmark results<\/h2>/);
    assert.match(
      GUIDE_HTML,
      /Candidate evidence is evaluation only; it never promotes a tool automatically/,
    );
    assert.match(GUIDE_JS, /benchmark-start/);
    assert.match(GUIDE_JS, /Candidate attribution names the experiment target/);
  });

  it('is a self-contained browser controller with no direct package-install execution', () => {
    assert.doesNotMatch(GUIDE_JS, /fetch\([^\n]*(headroom|mcptoon|gitnexus)/i);
    assert.doesNotMatch(
      GUIDE_JS,
      /request\([^\n]*(pip install|pipx install|npm install|uv tool install)/i,
    );
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });
});
