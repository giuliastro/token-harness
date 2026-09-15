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
  nodeVersion: '22.13.1',
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

function world(
  claudeVersion: string,
  indexStatus = JSON.stringify({ schemaVersion: 1, status: 'up-to-date' }),
) {
  const probes: string[] = [];
  const context: CommandContext = {
    platform: LINUX,
    projectRoot: '/repo',
    home: '/home/test',
    stateRoot: '/state',
    harness: harnessId('claude'),
    provider: null,
    benchmarkId: 'gitnexus-standard-1',
    benchmarkVariant: 'baseline',
    optimizationCandidate: 'gitnexus',
    taskClass: 'standard',
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
    now: () => '2026-09-14T18:10:00.000Z',
    adapters: {
      runner: {
        run: async (request: ProcessRequest) => {
          probes.push(`${request.executable} ${request.args.join(' ')}`);
          if (request.executable === 'claude' && request.args.join(' ') === '--version') {
            return outcome(request, claudeVersion);
          }
          if (request.executable === 'gitnexus' && request.args.join(' ') === '--version') {
            return outcome(request, 'gitnexus 1.6.12');
          }
          if (request.executable === 'gitnexus' && request.args.join(' ') === 'status --json') {
            return outcome(request, indexStatus);
          }
          throw new Error(`unexpected probe ${request.executable} ${request.args.join(' ')}`);
        },
      },
    } as unknown as CommandContext['adapters'],
  };
  return { context, probes };
}

describe('GitNexus production campaign row', () => {
  it('admits the exact recorded Claude 2.1.269 × Linux row before probing GitNexus 1.6.12', async () => {
    const exact = world('2.1.269 (Claude Code)');
    assert.equal(await validateCandidateCampaignRuntimeSurface(exact.context, false), null);
    assert.deepEqual(exact.probes, [
      'claude --version',
      'gitnexus --version',
      'gitnexus status --json',
    ]);
  });

  it('fails closed when the repository has no usable GitNexus index', async () => {
    const unindexed = world(
      '2.1.269 (Claude Code)',
      JSON.stringify({ schemaVersion: 1, error: 'not-indexed' }),
    );
    const diagnostic = await validateCandidateCampaignRuntimeSurface(unindexed.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-index-not-ready');
    assert.match(diagnostic?.remediation ?? '', /gitnexus analyze --index-only/);
    assert.deepEqual(unindexed.probes, [
      'claude --version',
      'gitnexus --version',
      'gitnexus status --json',
    ]);
  });

  it('fails closed when the GitNexus index is stale', async () => {
    const stale = world(
      '2.1.269 (Claude Code)',
      JSON.stringify({ schemaVersion: 1, status: 'stale' }),
    );
    const diagnostic = await validateCandidateCampaignRuntimeSurface(stale.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-index-not-ready');
    assert.match(diagnostic?.message ?? '', /stale/);
  });

  it('fails closed on malformed GitNexus status JSON', async () => {
    const malformed = world('2.1.269 (Claude Code)', '{not-json');
    const diagnostic = await validateCandidateCampaignRuntimeSurface(malformed.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-index-status-unavailable');
  });

  it('keeps matrix/report reads passive and does not inspect the index', async () => {
    const passive = world('2.1.269 (Claude Code)');
    passive.context.benchmarkVariant = null;
    assert.equal(await validateCandidateCampaignRuntimeSurface(passive.context, false), null);
    assert.deepEqual(passive.probes, []);
  });

  it('refuses an adjacent Claude version before probing GitNexus', async () => {
    const adjacent = world('2.1.270 (Claude Code)');
    const diagnostic = await validateCandidateCampaignRuntimeSurface(adjacent.context, false);
    assert.equal(diagnostic?.code, 'candidate-benchmark-campaign-row-unreviewed');
    assert.equal(diagnostic?.subject, 'gitnexus');
    assert.deepEqual(adjacent.probes, ['claude --version']);
  });
});
