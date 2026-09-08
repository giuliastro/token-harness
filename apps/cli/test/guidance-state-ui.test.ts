import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GUIDE_JS } from '../src/guided-assets.js';

describe('guided Agent Skill state UI', () => {
  it('renders guidance state on the agent card and only exposes install when an action exists', () => {
    assert.match(GUIDE_JS, /node\('span','Guidance','key'\)/);
    assert.match(GUIDE_JS, /agent\.guidance\.label/);
    assert.match(GUIDE_JS, /if\(agent\.guidance\.action\)guidanceLine\.append/);
  });
});
