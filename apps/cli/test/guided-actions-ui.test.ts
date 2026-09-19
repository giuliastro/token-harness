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

  it('makes baseline setup capability-aware and puts remediation beside the affected state', () => {
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /managed agent support is not identical/);
    assert.match(GUIDE_JS, /Review recommended setup for /);
    assert.match(GUIDE_JS, /actionButton\('Review setup'/);
    assert.match(GUIDE_JS, /'Connect to ' \+ agent\.name/);
    assert.match(GUIDE_JS, /recommendedProviders/);
    assert.doesNotMatch(GUIDE_JS, /Setup incomplete/);
    assert.doesNotMatch(GUIDE_HTML, /managed-setup-actions/);
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

  it('automatically refreshes the complete current state after an approved mutation', () => {
    assert.match(GUIDE_JS, /async function refreshAfterMutation\(run\)/);
    assert.match(GUIDE_JS, /refresh=1/);
    assert.match(GUIDE_JS, /refreshing current setup/i);
    assert.match(GUIDE_JS, /No manual page refresh is needed/i);
    assert.match(GUIDE_JS, /dashboard has already been refreshed/i);
    assert.match(GUIDE_JS, /automatic status refresh failed/i);
  });

  it('keeps advanced evaluation installation explicitly external and manual', () => {
    assert.match(GUIDE_JS, /Experimental, not managed/);
    assert.match(GUIDE_JS, /Token Harness will not execute them for you/);
    assert.match(GUIDE_JS, /Installation is not activation/);
  });
});
