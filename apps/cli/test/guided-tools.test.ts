import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { CliEnvelope } from '@token-harness/core';
import { GuideError, type GuideCall } from '../src/guided.js';
import { createGuideTools, type GuideScheduleRunner } from '../src/guided-tools.js';

const response: CliEnvelope<never> = {
  schemaVersion: 1,
  toolVersion: '0.1.32',
  command: 'advisory',
  status: 'ok',
  exitCode: 0,
  data: null,
  diagnostics: [],
};

describe('guided advanced tools', () => {
  it('builds a fixed optimize invocation and applies defaults', async () => {
    let argv: readonly string[] = [];
    const call: GuideCall = async <T>(args: readonly string[]) => {
      argv = args;
      return response as unknown as CliEnvelope<T>;
    };
    const result = await createGuideTools({ call, cwd: 'C:\\project' })({
      mode: 'plan',
      harness: 'codex',
      task: 'standard',
      profile: 'balanced',
      tasksLeft: 5,
    });
    assert.deepEqual(argv, [
      'optimize',
      '--harness',
      'codex',
      '--task',
      'standard',
      '--profile',
      'balanced',
      '--reserve',
      '20',
      '--tasks-left',
      '5',
    ]);
    assert.equal(result.mode, 'plan');
    assert.deepEqual(result.envelope, response);
  });

  it('rejects unknown fields, malformed inputs, conflicting harnesses, and bounded values', async () => {
    const tools = createGuideTools({ call: async () => response, cwd: 'C:\\project' });
    for (const invalidInput of [
      { mode: 'plan', harness: 'codex', task: 'standard', profile: 'balanced', command: 'echo' },
      { mode: 'plan', harness: 'codex', task: 'standard', profile: 'balanced', reserve: 91 },
      { mode: 'plan', harness: 'codex', task: 'standard', profile: 'balanced', tasksLeft: 0 },
      { mode: 'schedule', current: 'claude', candidate: 'claude', workload: { hard: 1 } },
      { mode: 'schedule', current: 'claude', candidate: 'codex', workload: { hard: 10001 } },
      { mode: 'schedule', current: 'claude', candidate: 'codex', workload: { hard: 0 } },
      { mode: 'schedule', current: 'claude', candidate: 'codex', workload: { hard: 1, shell: 1 } },
      { mode: 'handoff', objective: 'work', nextAction: 'continue', maxBytes: 255 },
      {
        mode: 'handoff',
        objective: 'work',
        nextAction: 'continue',
        facts: new Array(21).fill('fact'),
      },
      { mode: 'other' },
      null,
    ]) {
      await assert.rejects(tools(invalidInput), (error: unknown) => {
        assert.ok(error instanceof GuideError);
        assert.equal(error.status, 400);
        return true;
      });
    }
  });

  it('preserves schedule no-evidence outcomes and supplies the trusted observers', async () => {
    let capturedArgv: readonly string[] = [];
    const runSchedule: GuideScheduleRunner = async (argv, streams, runtime) => {
      capturedArgv = argv;
      assert.equal(typeof runtime.observeBudget, 'function');
      assert.equal(typeof runtime.observeQualityReceipts, 'function');
      assert.equal(typeof runtime.observeTransferReceipts, 'function');
      streams.out(
        JSON.stringify({
          ...response,
          command: 'schedule',
          exitCode: 0,
          data: { decision: 'insufficient-evidence', evidence: { receipts: 'no-evidence' } },
        }),
      );
      return 0;
    };
    const result = await createGuideTools({
      call: async () => response,
      cwd: 'C:\\repo',
      runSchedule,
    })({
      mode: 'schedule',
      current: 'codex',
      candidate: 'claude',
      workload: { mechanical: 2, standard: 0 },
    });
    assert.deepEqual(capturedArgv, [
      '--current',
      'codex',
      '--candidate',
      'claude',
      '--workload',
      'mechanical=2',
      '--json',
    ]);
    assert.equal(
      (result.envelope['data'] as { decision: string }).decision,
      'insufficient-evidence',
    );
  });

  it('uses the pure handoff formatter with fixed flags and textual changed-file values', async () => {
    const result = await createGuideTools({ call: async () => response, cwd: 'C:\\repo' })({
      mode: 'handoff',
      objective: 'Finish the feature',
      nextAction: 'Review the focused changes',
      acceptance: ['CLI remains advisory'],
      facts: ['The scheduler uses project receipts'],
      decisions: ['Keep the current harness unless evidence supports switching'],
      changedFiles: ['apps/cli/src/example.ts'],
      validation: ['TypeScript check passed'],
      unresolved: ['Live quota remains unavailable'],
      maxBytes: 1024,
    });
    const data = result.envelope['data'] as { markdown: string };
    assert.match(data.markdown, /Finish the feature/);
    assert.match(data.markdown, /apps\/cli\/src\/example\.ts/);
    assert.equal(result.envelope['exitCode'], 0);
  });
});
