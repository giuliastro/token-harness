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

  it('parses automatic prompt routing enable and disable intents', () => {
    const enable = parseArgv([
      'plan',
      '--harness',
      'codex',
      '--provider',
      'none',
      '--agent-routing',
    ]);
    assert.equal(enable.kind, 'command');
    if (enable.kind !== 'command') return;
    assert.equal(enable.options.agentRouting, true);
    assert.equal(enable.options.disableAgentRouting, false);

    const disable = parseArgv([
      'plan',
      '--harness',
      'claude',
      '--provider',
      'none',
      '--disable-agent-routing',
    ]);
    assert.equal(disable.kind, 'command');
    if (disable.kind !== 'command') return;
    assert.equal(disable.options.agentRouting, false);
    assert.equal(disable.options.disableAgentRouting, true);
  });

  it('rejects conflicting prompt-routing intents', () => {
    const parsed = parseArgv(['plan', '--agent-routing', '--disable-agent-routing']);
    assert.equal(parsed.kind, 'usage-error');
  });
});
