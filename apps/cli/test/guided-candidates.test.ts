import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided optional managed optimizers', () => {
  it('promotes the reviewed tools into Managed optimizers instead of Experimental tools', () => {
    assert.match(GUIDE_HTML, /<h2>Managed optimizers<\/h2>/);
    assert.match(
      GUIDE_HTML,
      /mcptoon, GitNexus and Headroom also expose narrow optional managed integrations/,
    );
    assert.doesNotMatch(GUIDE_HTML, /<h2>Experimental tools<\/h2>/);
    assert.match(GUIDE_JS, /const EXPERIMENTAL = \[\];/);
    assert.match(GUIDE_JS, /renderManagedTool\('mcptoon'\)/);
    assert.match(GUIDE_JS, /renderManagedTool\('gitnexus'\)/);
    assert.match(GUIDE_JS, /renderManagedTool\('headroom'\)/);
  });

  it('reviews each optional optimizer through a provider-scoped managed plan', () => {
    assert.match(GUIDE_JS, /Review mcptoon for /);
    assert.match(GUIDE_JS, /Review GitNexus for /);
    assert.match(GUIDE_JS, /Review Headroom for /);
    assert.match(GUIDE_JS, /provider: providerId/);
    assert.match(GUIDE_JS, /PolyForm Noncommercial/);
  });

  it('keeps the production baseline distinct from optional managed integrations', () => {
    assert.match(GUIDE_HTML, /RTK and HarnessTrim are the production baseline/);
    assert.match(GUIDE_JS, /Production baseline/);
    assert.match(GUIDE_JS, /Optional managed integration/);
    assert.match(GUIDE_JS, /Enabling one does not create a savings claim/);
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
