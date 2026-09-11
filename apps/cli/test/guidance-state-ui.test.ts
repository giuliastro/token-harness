import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUIDE_JS } from '../src/guided-assets.js';

describe('guided Agent Skill state UI', () => {
  it('renders guidance state in agent details and only exposes contextual rule actions when present', () => {
    assert.match(GUIDE_JS, /'Guidance: ' \+ agent\.guidance\.label/);
    assert.match(GUIDE_JS, /if \(rule\.action\) head\.append\(actionButton\(rule\.action/);
    assert.match(GUIDE_JS, /performAction\(action\)/);
  });
});
