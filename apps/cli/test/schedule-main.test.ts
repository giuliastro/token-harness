import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { scheduleMain } from '../src/schedule-main.js';

function capture() {
  let stdout = '';
  let stderr = '';
  return {
    streams: {
      out(text: string) {
        stdout += text;
      },
      err(text: string) {
        stderr += text;
      },
    },
    stdout: () => stdout,
    stderr: () => stderr,
  };
}

const base = [
  '--current',
  'claude',
  '--candidate',
  'codex',
  '--task-class',
  'hard',
] as const;

describe('schedule CLI', () => {
  it('returns insufficient evidence instead of inventing a switch', async () => {
    const output = capture();
    const exitCode = await scheduleMain(base, output.streams);

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /recommendation: insufficient-evidence/);
    assert.match(output.stdout(), /current-quota-unknown/);
  });

  it('recommends switching only with fully positive evidence', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [
        ...base,
        '--current-five-hour',
        'over-pace',
        '--current-weekly',
        'on-pace',
        '--candidate-five-hour',
        'under-pace',
        '--candidate-weekly',
        'on-pace',
        '--candidate-quality',
        'passed',
        '--candidate-quality-task',
        'hard',
        '--candidate-quality-samples',
        '3',
        '--handoff-bytes',
        '900',
        '--transfer-benefit',
        'proven-positive',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: switch/);
    assert.match(output.stdout(), /transfer-benefit-positive/);
  });

  it('stays when transfer evidence says the handoff is not worth it', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [
        ...base,
        '--current-five-hour',
        'over-pace',
        '--current-weekly',
        'on-pace',
        '--candidate-five-hour',
        'under-pace',
        '--candidate-weekly',
        'on-pace',
        '--candidate-quality',
        'passed',
        '--candidate-quality-task',
        'hard',
        '--candidate-quality-samples',
        '2',
        '--handoff-bytes',
        '900',
        '--transfer-benefit',
        'non-positive',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.match(output.stdout(), /recommendation: stay/);
    assert.match(output.stdout(), /transfer-cost-not-worth-it/);
  });

  it('keeps the decision machine-readable in the standard envelope', async () => {
    const output = capture();
    const exitCode = await scheduleMain([...base, '--json'], output.streams);

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      data: { decision: string; currentHarness: string; candidateHarness: string };
    };
    assert.equal(envelope.command, 'schedule');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.data.decision, 'insufficient-evidence');
    assert.equal(envelope.data.currentHarness, 'claude');
    assert.equal(envelope.data.candidateHarness, 'codex');
  });

  it('rejects malformed evidence as usage errors', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [...base, '--candidate-quality-samples', '-1'],
      output.streams,
    );

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /invalid-schedule-number/);
  });

  it('lets help/version win over invalid arguments', async () => {
    const help = capture();
    assert.equal(await scheduleMain(['--bad', '--help'], help.streams), 0);
    assert.equal(help.stderr(), '');
    assert.match(help.stdout(), /token-harness schedule/);

    const version = capture();
    assert.equal(await scheduleMain(['--bad', '--version'], version.streams), 0);
    assert.equal(version.stderr(), '');
    assert.match(version.stdout(), /^0\.1\.5\n$/);
  });
});
