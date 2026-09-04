import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { handoffMain } from '../src/handoff-main.js';

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

describe('handoff CLI', () => {
  it('renders only the compact Markdown payload in human mode', async () => {
    const output = capture();
    const exitCode = await handoffMain(
      [
        '--objective',
        'Finish the optimizer safely',
        '--decision',
        'Keep quota sources separate',
        '--changed-file',
        'packages/core/src/domain/optimizer.ts',
        '--validation',
        'tests pass',
        '--unresolved',
        'real cross-provider ranking still needs evidence',
        '--next-action',
        'Run the next benchmark pair',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /^# Compact handoff\n/);
    assert.match(output.stdout(), /Keep quota sources separate/);
    assert.match(output.stdout(), /## Next action/);
    assert.doesNotMatch(output.stdout(), /bytes:/i);
  });

  it('accepts repeated optional fields and a hard byte budget', async () => {
    const output = capture();
    const exitCode = await handoffMain(
      [
        '--objective=Transfer explicit state only',
        '--decision=first decision',
        '--decision=second decision',
        '--validation=typecheck passes',
        '--validation=lint passes',
        '--next-action=Continue from the compact state',
        '--max-bytes=320',
      ],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.equal(Buffer.byteLength(output.stdout().trimEnd(), 'utf8') <= 320, true);
  });

  it('emits the standard JSON envelope with handoff metadata', async () => {
    const output = capture();
    const exitCode = await handoffMain(
      ['--objective', 'Move the task', '--next-action', 'Continue implementation', '--json'],
      output.streams,
    );

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      command: string;
      status: string;
      exitCode: number;
      data: { markdown: string; bytes: number; maxBytes: number; truncated: boolean };
    };
    assert.equal(envelope.command, 'handoff');
    assert.equal(envelope.status, 'ok');
    assert.equal(envelope.exitCode, 0);
    assert.match(envelope.data.markdown, /Move the task/);
    assert.equal(envelope.data.maxBytes, 2048);
    assert.equal(envelope.data.bytes > 0, true);
    assert.equal(envelope.data.truncated, false);
  });

  it('returns usage error when mandatory state is missing', async () => {
    const output = capture();
    const exitCode = await handoffMain(['--decision', 'keep this'], output.streams);

    assert.equal(exitCode, 2);
    assert.match(output.stderr(), /handoff-objective-required/);
    assert.match(output.stderr(), /handoff-next-action-required/);
    assert.equal(output.stdout(), '');
  });

  it('keeps JSON usage errors on stdout as one envelope', async () => {
    const output = capture();
    const exitCode = await handoffMain(
      ['--objective', 'Valid objective', '--max-bytes', '128', '--json'],
      output.streams,
    );

    assert.equal(exitCode, 2);
    assert.equal(output.stderr(), '');
    const envelope = JSON.parse(output.stdout()) as {
      status: string;
      exitCode: number;
      data: unknown;
      diagnostics: Array<{ code: string }>;
    };
    assert.equal(envelope.status, 'error');
    assert.equal(envelope.exitCode, 2);
    assert.equal(envelope.data, null);
    assert.equal(
      envelope.diagnostics.some((entry) => entry.code === 'invalid-handoff-max-bytes'),
      true,
    );
  });

  it('prints command help without requiring objective or next action', async () => {
    const output = capture();
    const exitCode = await handoffMain(['--help'], output.streams);

    assert.equal(exitCode, 0);
    assert.equal(output.stderr(), '');
    assert.match(output.stdout(), /token-harness handoff/);
    assert.match(output.stdout(), /--max-bytes/);
  });
});
