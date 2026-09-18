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

  it('keeps first-run setup visible beside agents and optimizers', () => {
    assert.match(GUIDE_HTML, /Coding agents/);
    assert.match(GUIDE_HTML, /Recommended optimizers/);
    assert.match(GUIDE_JS, /Set up ' \+ agent\.name/);
    assert.match(GUIDE_JS, /Set up ' \+ info\.name \+ ' for ' \+ agent\.name/);
    assert.match(GUIDE_JS, /Nothing changes yet/);
    assert.match(GUIDE_JS, /Apply setup/);
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

  it('makes checked updates actionable from the same UI', () => {
    assert.match(GUIDE_JS, /Check for optimizer updates/);
    assert.match(GUIDE_JS, /Update now/);
    assert.match(GUIDE_JS, /request\('\/api\/update-apply', \{ confirm: true \}\)/);
  });

  it('never automatically refreshes the whole overview after apply', () => {
    assert.match(GUIDE_JS, /choose Refresh when you want to re-read the complete setup/i);
    const applyStart = GUIDE_JS.indexOf('async function applyTicket(ticket)');
    const manualRefresh = "$('refresh').addEventListener";
    const refreshHandler = GUIDE_JS.indexOf(manualRefresh, applyStart);
    assert.notEqual(applyStart, -1);
    assert.notEqual(refreshHandler, -1);
    assert.doesNotMatch(GUIDE_JS.slice(applyStart, refreshHandler), /refresh\(true\)/);
  });

  it('keeps historical experimental installation explicitly external and manual', () => {
    assert.match(GUIDE_JS, /Experimental, not managed/);
    assert.match(GUIDE_JS, /Token Harness will not execute them for you/);
    assert.match(GUIDE_JS, /Installation is not activation/);
  });
});
