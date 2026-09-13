import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { validateCandidateCampaignRuntimeSurface } from '../src/commands/candidate-campaign-surface.js';
import type { CommandContext } from '../src/commands/context.js';

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable,
    interpreter: 'direct',
    executablePath: request.executable,
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: null,
  };
}

function context(options: {
  harness: 'codex' | 'claude';
  harnessVersion: string;
  mcptoonVersion?: string;
}): CommandContext {
  const harness = harnessId(options.harness);
  return {
    platform: LINUX,
    projectRoot: '/repo',
    home: '/home/test',
    stateRoot: '/state',
    harness,
    provider: null,
    optimizationCandidate: 'mcptoon',
    taskClass: null,
    budgetProfile: null,
    reservePercent: null,
    nativePolicy: false,
    agentSkill: false,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-13T12:00:00.000Z',
    adapters: {
      runner: {
        run: async (request: ProcessRequest) => {
          if (request.executable === options.harness) {
            return outcome(request, `${options.harness} ${options.harnessVersion}`);
          }
          if (request.executable === 'mcptoon') {
            return outcome(request, `mcptoon ${options.mcptoonVersion ?? '0.7.10'}`);
          }
          throw new Error(`unexpected executable ${request.executable}`);
        },
      },
    } as unknown as CommandContext['adapters'],
  };
}

describe('mcptoon campaign exact-version admission', () => {
  it('admits the exact reviewed Codex row without requiring mcptoon for a baseline', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.152.1' }),
      false,
    );
    assert.equal(diagnostic, null);
  });

  it('admits the exact reviewed Claude Code row', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'claude', harnessVersion: '2.1.269' }),
      false,
    );
    assert.equal(diagnostic, null);
  });

  it('rejects a newer unreviewed harness version', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.153.0' }),
      false,
    );
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
  });

  it('requires exact mcptoon 0.7.10 before an optimized start', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.152.1', mcptoonVersion: '0.8.0' }),
      true,
    );
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-provider-version-unreviewed');
  });

  it('admits optimized start only with the exact reviewed provider version', async () => {
    const diagnostic = await validateCandidateCampaignRuntimeSurface(
      context({ harness: 'codex', harnessVersion: '0.152.1', mcptoonVersion: '0.7.10' }),
      true,
    );
    assert.equal(diagnostic, null);
  });
});
