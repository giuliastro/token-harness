import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Script } from 'node:vm';

import { GUIDE_STACK_COMBINATION_JS } from '../src/guided-stack-combination-client.js';

describe('guided managed-stack combination review', () => {
  it('keeps individual verification separate from exact combined review', () => {
    assert.match(GUIDE_STACK_COMBINATION_JS, /Combined review not recorded/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /does not prove they were reviewed together/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /Combined stack reviewed/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /exact-set review evidence/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /Combined stack needs attention/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /exact combination is incompatible/);
    assert.doesNotThrow(() => new Script(GUIDE_STACK_COMBINATION_JS));
  });

  it('is read-only and consumes only stack evidence returned by existing guide endpoints', () => {
    assert.match(GUIDE_STACK_COMBINATION_JS, /\/api\/overview/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /\/api\/verify/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /\/api\/update-check/);
    assert.match(GUIDE_STACK_COMBINATION_JS, /response\.clone\(\)\.json\(\)/);
    assert.doesNotMatch(
      GUIDE_STACK_COMBINATION_JS,
      /method\s*:\s*['"]POST['"]|\/api\/apply|\/api\/preview|install-configure/,
    );
  });
});
