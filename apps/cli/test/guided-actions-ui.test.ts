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

  it('uses one central connection action per optimizer instead of per coding agent', () => {
    assert.match(GUIDE_HTML, /Recommended baseline/);
    assert.match(GUIDE_HTML, /RTK \+ HarnessTrim/);
    assert.match(GUIDE_HTML, /<h2>Optimization stack<\/h2>/);
    assert.match(GUIDE_HTML, /id="connection-overview"/);
    assert.match(GUIDE_JS, /renderConnectionOverview/);
    assert.match(GUIDE_JS, /actionButton\('Set up recommended stack'/);
    assert.match(GUIDE_JS, /reviewSetup\(null, id\)/);
    assert.doesNotMatch(GUIDE_HTML, /managed-setup-actions/);
    assert.doesNotMatch(GUIDE_JS, /Finish setup/);
    assert.doesNotMatch(GUIDE_JS, /Connect to ['"] \+ agent\.name/);
    assert.doesNotMatch(GUIDE_JS, /Set up for ['"] \+ agent\.name/);
    assert.match(GUIDE_HTML, /<summary>Optional optimizers<\/summary>/);
    assert.match(GUIDE_JS, /Safe preview first/);
    assert.match(GUIDE_JS, /This first step only prepares the safe plan/);
    assert.match(GUIDE_JS, /One optimizer, all compatible agents/);
    assert.match(GUIDE_JS, /Apply recommended setup/);
    assert.match(GUIDE_JS, /No automatic change is available/);
  });

  it('keeps setup routed through the existing preview and apply transaction endpoints', () => {
    assert.match(
      GUIDE_JS,
      /request\('\/api\/preview', \{\s*action: 'setup',\s*\.\.\.\(agentId \? \{ harness: agentId \} : \{\}\),\s*\.\.\.\(providerId \? \{ provider: providerId \} : \{\}\),\s*\}\)/,
    );
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
    assert.match(GUIDE_JS, /transactional engine with backups, ownership checks and rollback/i);
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });

  it('keeps the shared review dialog open while an approved mutation is applying', () => {
    assert.match(GUIDE_JS, /querySelectorAll\('button:disabled'\)/);
    assert.match(GUIDE_JS, /event\.preventDefault\(\)/);
    assert.match(GUIDE_JS, /event\.stopImmediatePropagation\(\)/);
  });

  it('automatically re-reads the overview after an approved mutation', () => {
    assert.match(GUIDE_JS, /refreshOverviewAfterMutation/);
    assert.match(GUIDE_JS, /Applying the new configuration and refreshing status/);
    assert.match(GUIDE_JS, /Refreshing the current setup/);
    assert.match(GUIDE_JS, /\/api\/overview\?period=.*&refresh=1/);
    assert.doesNotMatch(
      GUIDE_JS,
      /Displayed status is the previous state until you choose Refresh/,
    );
  });

  it('keeps advanced evaluation installation explicitly external and manual', () => {
    assert.match(GUIDE_JS, /Experimental, not managed/);
    assert.match(GUIDE_JS, /Token Harness will not execute them for you/);
    assert.match(GUIDE_JS, /Installation is not activation/);
  });
});
