import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

describe('guided agent capability state UI', () => {
  it('keeps advanced agent capability state available without making it a first-run step', () => {
    assert.match(GUIDE_HTML, /id="agent-capabilities"/);
    assert.match(GUIDE_HTML, /Agent details and optional reasoning settings/);
    assert.match(
      GUIDE_HTML,
      /Allowance, connected-tool observations and reasoning preferences are advanced information/,
    );
    assert.match(GUIDE_JS, /In-session guidance/);
    assert.match(GUIDE_JS, /agent\.guidance\?\.label/);
    assert.match(GUIDE_JS, /agent\.allowance\?\.length/);
    assert.match(GUIDE_JS, /More agent checks/);
  });

  it('keeps optional in-session guidance behind the existing review and apply transaction', () => {
    assert.match(GUIDE_JS, /\{ action: 'skill', harness: action\.harness \}/);
    assert.match(GUIDE_JS, /Enable reviewed guidance/);
    assert.match(GUIDE_JS, /request\('\/api\/preview', body\)/);
    assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
  });
});
