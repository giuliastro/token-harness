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

  it('uses one central switch or install action per method with explicit coding-app selection', () => {
    assert.match(GUIDE_JS, /Turn on the recommended methods/);
    assert.match(GUIDE_JS, /Choose the coding apps for RTK and HarnessTrim\./);
    assert.match(GUIDE_JS, /Choose the coding apps where \{name\} should work\./);
    assert.match(GUIDE_JS, /function reviewSetup\(providerId = null\)/);
    assert.match(GUIDE_JS, /reviewSetup\(method\.key\)/);
    assert.match(GUIDE_JS, /harnesses,/);
    assert.match(GUIDE_JS, /\.\.\.\(providerId \? \{ provider: providerId \} : \{\}\)/);
    assert.match(GUIDE_JS, /t\('Install'\)/);
    assert.match(GUIDE_JS, /The next step shows exactly what changes\. Nothing changes yet\./);
    assert.match(GUIDE_JS, /No supported coding app was found for it\./);
    assert.match(GUIDE_JS, /Review changes/);
    assert.doesNotMatch(
      GUIDE_HTML,
      /managed-setup-actions|<summary>Optional optimizers<\/summary>/,
    );
    assert.doesNotMatch(GUIDE_JS, /Finish setup/);
    assert.doesNotMatch(GUIDE_JS, /Connect to ['"] \+ agent\.name/);
    assert.doesNotMatch(GUIDE_JS, /Set up for ['"] \+ agent\.name/);
  });

  it('keeps every configuration change routed through the preview and apply endpoints', () => {
    // One reviewed flow carries every change: setup, removal, routing, guidance, effort, undo.
    assert.match(GUIDE_JS, /function reviewPreview\(body, options\)/);
    assert.match(GUIDE_JS, /request\('\/api\/preview', body\)/);
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
    for (const action of [
      "action: 'setup'",
      "action: 'remove'",
      "action: enabled ? 'routing-enable' : 'routing-disable'",
      "action: 'skill'",
      "action: 'effort'",
    ])
      assert.ok(GUIDE_JS.includes(action), action);
    assert.match(GUIDE_JS, /reviewPreview\(\{ action: 'setup', harnesses/);
    assert.match(GUIDE_JS, /Only changes Token Harness owns are applied, with a backup first/);
    // The controller never posts an apply without a preview ticket and has no other mutation path.
    assert.equal(GUIDE_JS.match(/request\('\/api\/apply'/g)?.length, 1);
    assert.doesNotMatch(GUIDE_JS, /request\('\/api\/(install|uninstall|setup|remove)/);
    assert.doesNotThrow(() => new Script(GUIDE_JS));
  });

  it('keeps the shared review dialog open while an approved mutation is applying', () => {
    assert.match(GUIDE_JS, /querySelectorAll\('button:disabled'\)/);
    assert.match(GUIDE_JS, /event\.preventDefault\(\)/);
    assert.match(GUIDE_JS, /event\.stopImmediatePropagation\(\)/);
    assert.match(GUIDE_JS, /modalClose\(t\('Applying…'\), true\)/);
    assert.match(GUIDE_JS, /Applying only the approved change…/);
  });

  it('automatically re-reads the overview after an approved mutation', () => {
    assert.match(GUIDE_JS, /refreshOverviewAfterMutation/);
    assert.match(GUIDE_JS, /Applying the approved change/);
    assert.match(GUIDE_JS, /Refreshing after the approved change…/);
    assert.match(GUIDE_JS, /\/api\/overview\?period=.*&refresh=1/);
    assert.doesNotMatch(
      GUIDE_JS,
      /Displayed status is the previous state until you choose Refresh/,
    );
  });

  it('keeps third-party installation behind reviewed plans and shows manual commands as text only', () => {
    // Installing an optimizer is a provider-scoped plan reviewed in the dialog, never a direct call.
    assert.doesNotMatch(
      GUIDE_JS,
      /request\([^\n]*(pip install|pipx install|npm install|uv tool install)/i,
    );
    // Commands the user must run themselves are displayed to copy, not executed.
    assert.match(GUIDE_JS, /function copyRow\(command\)/);
    assert.match(GUIDE_JS, /navigator\.clipboard\.writeText\(command\)/);
    assert.match(GUIDE_JS, /Install the reviewed cclimits companion/);
    assert.match(GUIDE_JS, /Token Harness can install mcptoon once pipx or uv is available/);
    // Benchmark commands are guidance for the CLI; Details never runs them.
    assert.match(GUIDE_JS, /token-harness benchmark-start/);
    assert.match(GUIDE_JS, /Preview each temporary configuration with benchmark-prepare/);
    assert.doesNotMatch(GUIDE_JS, /request\('\/api\/benchmark-(start|prepare|finish)/);
  });
});
