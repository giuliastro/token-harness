import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided setup UX', () => {
  it('removes the shared Agent/Work form from unrelated dialogs', () => {
    assert.doesNotMatch(GUIDE_HTML, /id="task-form"/);
    assert.doesNotMatch(GUIDE_HTML, /<label for="harness">Agent<\/label>/);
    assert.doesNotMatch(GUIDE_HTML, /<label for="task">Work<\/label>/);
    assert.match(GUIDE_HTML, /id="modal-content"/);
    assert.match(GUIDE_JS, /choice-grid/);
  });

  it('uses one obvious first-run baseline action per incomplete coding agent', () => {
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /RTK \+ HarnessTrim/);
    assert.match(GUIDE_JS, /Set up recommended optimizers for /);
    assert.match(GUIDE_JS, /actionButton\('Finish setup'/);
    assert.doesNotMatch(GUIDE_HTML, /managed-setup-actions/);
    assert.doesNotMatch(GUIDE_JS, /actionButton\('Finish setup for '/);
    assert.match(GUIDE_HTML, /<summary>Optional optimizers<\/summary>/);
    assert.match(GUIDE_JS, /Safe preview first/);
    assert.match(GUIDE_JS, /This first step only prepares the safe plan/);
    assert.match(GUIDE_JS, /Optional optimizers stay separate/);
    assert.match(GUIDE_JS, /Apply recommended setup/);
  });

  it('keeps setup routed through the existing preview and apply transaction endpoints', () => {
    assert.match(
      GUIDE_JS,
      /request\('\/api\/preview', \{\s*action: 'setup',\s*harness: agentId,\s*\.\.\.\(providerId \? \{ provider: providerId \} : \{\}\),\s*\}\)/,
    );
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
    assert.match(GUIDE_JS, /backups, compatibility checks, ownership checks and rollback/i);
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });

  it('keeps the shared review dialog open while an approved mutation is applying', () => {
    assert.match(GUIDE_JS, /querySelectorAll\('button:disabled'\)/);
    assert.match(GUIDE_JS, /event\.preventDefault\(\)/);
    assert.match(GUIDE_JS, /event\.stopImmediatePropagation\(\)/);
  });

  it('automatically refreshes current state after an approved mutation', () => {
    assert.match(GUIDE_JS, /Refreshing current state/);
    assert.match(GUIDE_JS, /\/api\/overview\?period=.*&refresh=1/);
    assert.match(GUIDE_JS, /Completed and refreshed/);
    assert.doesNotMatch(GUIDE_JS, /previous state until you choose Refresh/i);
  });

  it('uses provider-specific recommended baselines and exposes remediation actions', () => {
    assert.match(
      GUIDE_JS,
      /agentId === 'claude' \? \['rtk', 'harnesstrim'\] : agentId === 'codex' \? \['harnesstrim'\]/,
    );
    assert.match(GUIDE_JS, /providerId === 'rtk' \|\| providerId === 'gitnexus'/);
    assert.match(GUIDE_JS, /'Connect to '.*agent\.name/);
  });

  it('keeps advanced evaluation installation explicitly external and manual', () => {
    assert.match(GUIDE_JS, /Experimental, not managed/);
    assert.match(GUIDE_JS, /Token Harness will not execute them for you/);
    assert.match(GUIDE_JS, /Installation is not activation/);
  });
});
