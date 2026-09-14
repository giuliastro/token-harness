import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { EXIT_CODES, commandResult, type PlatformFacts } from '@token-harness/core';

import { DEFAULT_COMMANDS, run } from '../src/run.js';

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.18.0',
  isWsl: false,
};

function gitnexusStartArgs(json = false): string[] {
  return [
    'benchmark-start',
    '--benchmark-id',
    'gitnexus-real-claude-m-1',
    '--candidate',
    'gitnexus',
    '--variant',
    'baseline',
    '--task',
    'mechanical',
    '--harness',
    'claude',
    ...(json ? ['--json'] : []),
  ];
}

async function invoke(
  argv: string[],
  commands = DEFAULT_COMMANDS,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    argv,
    platform: LINUX,
    cwd: '/repo',
    home: '/home/test',
    stateRoot: '/home/test/.local/state/token-harness',
    commands,
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

describe('GitNexus candidate capture admission', () => {
  it('blocks new GitNexus candidate evidence before the benchmark handler can write state', async () => {
    let starts = 0;
    const result = await invoke(gitnexusStartArgs(), {
      ...DEFAULT_COMMANDS,
      'benchmark-start': async () => {
        starts += 1;
        return commandResult({ command: 'benchmark-start', exitCode: EXIT_CODES.ok, data: null });
      },
    });

    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.equal(starts, 0);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /gitnexus/i);
    assert.match(result.stderr, /no exact reviewed harness\/platform compatibility row/i);
  });

  it('keeps the exact fail-closed reason machine-readable under --json', async () => {
    const result = await invoke(gitnexusStartArgs(true));

    assert.equal(result.exitCode, EXIT_CODES['unsupported-environment']);
    assert.equal(result.stderr, '');
    const envelope = JSON.parse(result.stdout) as {
      diagnostics: Array<{ code: string; message: string; remediation: string | null }>;
    };
    assert.equal(envelope.diagnostics[0]?.code, 'candidate-benchmark-capture-row-unreviewed');
    assert.match(envelope.diagnostics[0]?.message ?? '', /no exact reviewed/i);
    assert.match(envelope.diagnostics[0]?.remediation ?? '', /GitNexus 1\.6\.12/);
  });

  it('continues to allow read-only GitNexus benchmark-matrix access', async () => {
    let reads = 0;
    const result = await invoke(
      [
        'benchmark-matrix',
        '--benchmark-id',
        'gitnexus-real-claude',
        '--candidate',
        'gitnexus',
        '--harness',
        'claude',
        '--json',
      ],
      {
        ...DEFAULT_COMMANDS,
        'benchmark-matrix': async () => {
          reads += 1;
          return commandResult({
            command: 'benchmark-matrix',
            exitCode: EXIT_CODES.ok,
            data: { historicalEvidenceReadable: true },
          });
        },
      },
    );

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.stderr, '');
    assert.equal(reads, 1);
    const envelope = JSON.parse(result.stdout) as { data: { historicalEvidenceReadable: boolean } };
    assert.equal(envelope.data.historicalEvidenceReadable, true);
  });
});
