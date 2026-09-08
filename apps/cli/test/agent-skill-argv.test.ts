import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseArgv } from '../src/argv.js';

describe('internal Agent Skill plan selector', () => {
  it('preserves the guided --agent-skill selector in the shared command context', () => {
    const parsed = parseArgv([
      'plan',
      '--harness',
      'claude',
      '--provider',
      'none',
      '--agent-skill',
    ]);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.agentSkill, true);
    assert.equal(parsed.options.nativePolicy, false);
  });
});
