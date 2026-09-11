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

  it('explains managed setup before any apply action exists', () => {
    assert.match(GUIDE_HTML, /Managed optimizers/);
    assert.match(GUIDE_HTML, /RTK and HarnessTrim/);
    assert.match(GUIDE_JS, /Review managed setup for /);
    assert.match(GUIDE_JS, /This step is read-only/);
    assert.match(GUIDE_JS, /Experimental tools are never installed or activated by this action/);
    assert.match(GUIDE_JS, /Apply reviewed setup/);
  });

  it('keeps setup routed through the existing preview and apply transaction endpoints', () => {
    assert.match(GUIDE_JS, /request\('\/api\/preview', \{ action: 'setup', harness: agentId \}\)/);
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
    assert.match(GUIDE_JS, /backups, compatibility checks, ownership checks and rollback/i);
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });

  it('keeps the shared review dialog open while an approved mutation is applying', () => {
    assert.match(GUIDE_JS, /querySelectorAll\('button:disabled'\)/);
    assert.match(GUIDE_JS, /event\.preventDefault\(\)/);
    assert.match(GUIDE_JS, /event\.stopImmediatePropagation\(\)/);
  });

  it('never automatically refreshes the whole dashboard after apply', () => {
    assert.match(GUIDE_JS, /choose Refresh when you want to re-read the complete setup/i);
    const start = GUIDE_JS.indexOf('async function applyTicket(ticket)');
    assert.notEqual(start, -1);
    const laterFunctionStarts = [
      GUIDE_JS.indexOf('\n  function ', start + 1),
      GUIDE_JS.indexOf('\n  async function ', start + 1),
    ].filter(index => index > start);
    const end = laterFunctionStarts.length ? Math.min(...laterFunctionStarts) : GUIDE_JS.length;
    const applyTicketSource = GUIDE_JS.slice(start, end);
    assert.doesNotMatch(applyTicketSource, /refresh\(true\)/);
  });

  it('labels experimental installation as external and manual', () => {
    assert.match(GUIDE_JS, /Experimental, not managed/);
    assert.match(GUIDE_JS, /Token Harness will not execute them for you/);
    assert.match(GUIDE_JS, /Installation is not activation/);
  });
});
