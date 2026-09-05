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

const explicit = [
  '--current',
  'claude',
  '--candidate',
  'codex',
  '--task-class',
  'hard',
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
  '--transfer-benefit',
  'proven-positive',
] as const;

describe('schedule --handoff-file', () => {
  it('uses the measured current handoff bytes in the scheduler decision', async () => {
    const output = capture();
    let measuredPath = '';
    const exitCode = await scheduleMain(
      [...explicit, '--handoff-file', 'handoff.md'],
      output.streams,
      {
        measureHandoffBytes: async (handoffFile) => {
          measuredPath = handoffFile;
          return 777;
        },
      },
    );

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.equal(measuredPath, 'handoff.md');
    assert.match(output.stdout(), /recommendation: switch/);
    assert.match(output.stdout(), /handoff bytes: 777/);
  });

  it('refuses ambiguous file and byte-count evidence before measuring the file', async () => {
    const output = capture();
    let measurements = 0;
    const exitCode = await scheduleMain(
      [...explicit, '--handoff-file', 'handoff.md', '--handoff-bytes', '777'],
      output.streams,
      {
        measureHandoffBytes: async () => {
          measurements += 1;
          return 777;
        },
      },
    );

    assert.equal(exitCode, 2);
    assert.equal(measurements, 0);
    assert.match(output.stderr(), /handoff-evidence-conflict/);
  });

  it('fails closed instead of assuming zero bytes when the handoff file is unavailable', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [...explicit, '--handoff-file', 'missing.md'],
      output.streams,
      { measureHandoffBytes: async () => null },
    );

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /handoff-file-unavailable/);
    assert.doesNotMatch(output.stdout(), /recommendation:/);
  });

  it('fails closed when no handoff file observer is configured', async () => {
    const output = capture();
    const exitCode = await scheduleMain(
      [...explicit, '--handoff-file', 'handoff.md'],
      output.streams,
    );

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /handoff-file-unavailable/);
  });
});
