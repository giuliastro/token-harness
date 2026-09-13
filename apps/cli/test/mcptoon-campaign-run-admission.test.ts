import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformFacts } from '@token-harness/core';

import { run } from '../src/run.js';

const WINDOWS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

async function runWindows(argv: string[]) {
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    argv,
    platform: WINDOWS,
    cwd: 'C:/repo',
    home: 'C:/Users/test',
    stateRoot: 'C:/Users/test/AppData/Local/token-harness',
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  });
  return { exitCode, stdout, stderr };
}

describe('mcptoon campaign CLI admission', () => {
  it('does not emit campaign steps for mcptoon on Windows', async () => {
    const result = await runWindows([
      'benchmark-matrix',
      '--benchmark-id',
      'mcptoon-real-codex',
      '--candidate',
      'mcptoon',
      '--harness',
      'codex',
    ]);

    assert.equal(result.exitCode, 9);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /mcptoon/);
    assert.doesNotMatch(result.stderr, /Start baseline/);
  });

  it('blocks a copied mcptoon benchmark-start command on Windows too', async () => {
    const result = await runWindows([
      'benchmark-start',
      '--benchmark-id',
      'mcptoon-real-codex-m-1',
      '--candidate',
      'mcptoon',
      '--variant',
      'baseline',
      '--task',
      'mechanical',
      '--harness',
      'codex',
    ]);

    assert.equal(result.exitCode, 9);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /mcptoon/);
  });

  it('keeps the complete fail-closed reason machine-readable under --json', async () => {
    const result = await runWindows([
      'benchmark-matrix',
      '--benchmark-id',
      'mcptoon-real-codex',
      '--candidate',
      'mcptoon',
      '--harness',
      'codex',
      '--json',
    ]);

    assert.equal(result.exitCode, 9);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; message: string }>;
    };
    assert.equal(envelope.diagnostics[0]?.code, 'candidate-benchmark-campaign-surface-unreviewed');
    assert.match(envelope.diagnostics[0]?.message ?? '', /native Linux/);
  });
});
