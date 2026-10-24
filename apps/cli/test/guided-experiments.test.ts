import assert from 'node:assert/strict';
import { it } from 'node:test';
import { toEnvelope, commandResult } from '@token-harness/core';
import { createGuideExperiments } from '../src/guided-experiments.js';
import { GuideError, type GuideCall } from '../src/guided.js';

const prepare = {
  mode: 'prepare',
  name: 'test1',
  harness: 'codex',
  task: 'standard',
  variant: 'baseline',
  startingState: 'fixture',
};
function fixture() {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    return toEnvelope(
      commandResult({
        command: args[0]!,
        exitCode: 0,
        data: {
          planId: 'abcdef12',
          status: 'planned',
          paths: ['/private/config'],
          actions: [],
          initialConfigurationId: 'private',
        } as T,
      }),
      'test',
    );
  };
  return { call, calls };
}

it('binds single-use preparation approval to the exact engine plan without exposing paths', async () => {
  const { call, calls } = fixture();
  const action = createGuideExperiments(
    call,
    () => 0,
    () => 'ticket',
  );
  const preview = (await action(prepare)) as { ticket: string; files: number };
  assert.equal(preview.files, 1);
  assert.doesNotMatch(JSON.stringify(preview), /private|abcdef12/);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]!.includes('--yes'));
  await action({ mode: 'apply', ticket: preview.ticket });
  assert.deepEqual(calls[1]!.slice(-3), ['--plan', 'abcdef12', '--yes']);
  await assert.rejects(action({ mode: 'apply', ticket: preview.ticket }), GuideError);
});

it('refuses expired, injected and superseded experiment tickets before any mutation', async () => {
  const { call, calls } = fixture();
  let now = 0;
  const action = createGuideExperiments(
    call,
    () => now,
    () => 'ticket',
  );
  await action(prepare);
  now = 600001;
  await assert.rejects(action({ mode: 'apply', ticket: 'ticket' }), GuideError);
  await assert.rejects(action({ ...prepare, command: 'rm' }), GuideError);
  await assert.rejects(action({ ...prepare, name: '../outside' }), GuideError);
  await assert.rejects(
    action({
      mode: 'finish',
      name: 'test1',
      variant: 'baseline',
      quality: 'passed',
      attempts: 1,
      failedAttempts: 2,
    }),
    GuideError,
  );
  assert.equal(calls.length, 1);
});

it('records manual quality only after review and keeps an engine drift failure visible', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    return toEnvelope(
      commandResult({ command: 'benchmark-finish', exitCode: 5, data: null as T, diagnostics: [] }),
      'test',
    );
  };
  const action = createGuideExperiments(
    call,
    () => 0,
    () => 'ticket',
  );
  await action({
    mode: 'finish',
    name: 'test1',
    variant: 'combined',
    quality: 'unknown',
    attempts: 2,
    failedAttempts: 1,
  });
  assert.equal(calls.length, 0);
  const result = (await action({ mode: 'apply', ticket: 'ticket' })) as { ok: boolean };
  assert.equal(result.ok, false);
  assert.ok(calls[0]!.includes('unknown'));
  assert.equal(calls[0]!.at(-1), '--yes');
});
