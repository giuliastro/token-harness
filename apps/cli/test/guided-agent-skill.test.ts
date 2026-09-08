import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { GuideService, type GuideCall } from '../src/guided.js';

function envelope(command: string, data: unknown, exitCode = 0) {
  return {
    schemaVersion: 1,
    toolVersion: '0.0.0-test',
    command,
    status: exitCode === 0 ? 'ok' : 'error',
    exitCode,
    data,
    diagnostics: [],
  };
}

describe('guided in-session guidance flow', () => {
  it('turns one UI action into a reviewed plan and stored-plan apply', async () => {
    const calls: string[][] = [];
    const call: GuideCall = async (args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === 'doctor') {
        return envelope('doctor', {
          harnesses: [{ harnessId: 'claude', state: 'present', version: '2.1.261' }],
          providers: [],
        }) as never;
      }
      if (args[0] === 'plan') {
        return envelope('plan', {
          planId: '1234abcd',
          persisted: true,
          conflicts: [],
          network: [],
          actions: [
            {
              kind: 'write-owned-file',
              id: 'agent-skill:claude:write',
              riskClass: 'reversible',
              requiresNetwork: false,
              requiresElevation: false,
              affectedPaths: ['/home/dev/.claude/skills/token-harness/SKILL.md'],
              affectedProcesses: [],
              preconditions: [],
              postconditions: [],
              rollbackData: 'file-snapshot',
              explanation: 'Install skill',
              path: '/home/dev/.claude/skills/token-harness/SKILL.md',
              content: 'skill',
              mode: '0644',
              expectedDigest: null,
            },
          ],
        }) as never;
      }
      if (args[0] === 'apply') return envelope('apply', { outcome: 'committed' }) as never;
      throw new Error('unexpected call: ' + args.join(' '));
    };
    const service = new GuideService(
      call,
      () => 1_000,
      () => 'ticket',
    );
    const preview = await service.preview({ action: 'skill', harness: 'claude' });
    assert.equal(preview.ticket, 'ticket');
    assert.equal(preview.changes[0]?.title, 'Claude Code: enable in-session guidance');
    assert.deepEqual(calls[1], [
      'plan',
      '--harness',
      'claude',
      '--provider',
      'none',
      '--agent-skill',
    ]);
    const applied = await service.apply({ ticket: 'ticket' });
    assert.equal(applied.ok, true);
    assert.deepEqual(calls.at(-1), ['apply', '--plan', '1234abcd', '--yes']);
  });
});
