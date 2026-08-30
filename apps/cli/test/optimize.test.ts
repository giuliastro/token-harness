import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import { runOptimize } from '../src/commands/optimize.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

function outcome(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: '/usr/local/bin/codex',
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

describe('optimize command', () => {
  it('puts context first and preserves the hard-task quality floor while over pace', async () => {
    const files = new Map<string, FileStat>([
      ['/home/dev/project/.git', { kind: 'directory', byteLength: 0, mode: null }],
      ['/home/dev/project/AGENTS.md', { kind: 'file', byteLength: 25_000, mode: null }],
    ]);

    const context: CommandContext = {
      platform: PLATFORM,
      projectRoot: '/home/dev/project',
      home: '/home/dev',
      stateRoot: '/home/dev/.local/state/token-harness',
      harness: harnessId('codex'),
      provider: null,
      taskClass: 'hard',
      budgetProfile: 'economy',
      reservePercent: 20,
      since: null,
      until: null,
      planId: null,
      confirmed: false,
      metrics: null,
      compatibilityRows: null,
      now: () => '2026-08-30T14:00:00.000Z',
      adapters: {
        fs: {
          join: (...parts) => parts.join('/').replaceAll('//', '/'),
          dirname: (path) => {
            if (path === '/') return '/';
            const parts = path.split('/').filter(Boolean);
            return parts.length <= 1 ? '/' : '/' + parts.slice(0, -1).join('/');
          },
          basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
          isInside: (candidate, parent) => candidate.startsWith(parent),
          stat: async (path) => files.get(path) ?? null,
          readFile: async () => new Uint8Array(),
          writeFile: async () => {
            throw new Error('read-only');
          },
          appendFile: async () => {
            throw new Error('read-only');
          },
          createDirectory: async () => {
            throw new Error('read-only');
          },
          remove: async () => {
            throw new Error('read-only');
          },
          readDirectory: async () => [],
        },
        runner: {
          run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
            if (request.args[0] === '--version') return outcome(request, 'codex-cli 0.146.0');
            const stdin = request.stdin ?? '';
            if (stdin.includes('account/rateLimits/read')) {
              return outcome(
                request,
                [
                  JSON.stringify({ id: 1, result: {} }),
                  JSON.stringify({
                    id: 2,
                    result: {
                      rateLimits: {
                        limitId: 'codex',
                        limitName: 'Codex',
                        primary: {
                          usedPercent: 70,
                          windowDurationMins: 300,
                          resetsAt: 1788105600,
                        },
                        secondary: null,
                        credits: null,
                        individualLimit: null,
                        spendControlReached: null,
                        planType: 'pro',
                        rateLimitReachedType: null,
                      },
                      rateLimitsByLimitId: null,
                      rateLimitResetCredits: null,
                    },
                  }),
                ].join('\n'),
              );
            }
            if (stdin.includes('config/read')) {
              return outcome(
                request,
                [
                  JSON.stringify({ id: 1, result: {} }),
                  JSON.stringify({
                    id: 2,
                    result: {
                      config: {
                        model: 'gpt-5.6-codex',
                        model_reasoning_effort: 'high',
                        model_verbosity: 'medium',
                        project_doc_max_bytes: 32768,
                        project_root_markers: ['.git'],
                        project_doc_fallback_filenames: [],
                      },
                      origins: {},
                      layers: [],
                    },
                  }),
                  JSON.stringify({ id: 3, result: { data: [], nextCursor: null } }),
                  JSON.stringify({
                    id: 4,
                    result: {
                      data: [
                        {
                          id: 'gpt-5.6-codex',
                          model: 'gpt-5.6-codex',
                          displayName: 'GPT-5.6 Codex',
                          modelSpecialty: null,
                          hidden: false,
                          supportedReasoningEfforts: [
                            { reasoningEffort: 'low', description: 'Low' },
                            { reasoningEffort: 'medium', description: 'Medium' },
                            { reasoningEffort: 'high', description: 'High' },
                            { reasoningEffort: 'xhigh', description: 'Extra high' },
                          ],
                          defaultReasoningEffort: 'medium',
                          inputModalities: ['text'],
                          supportsPersonality: true,
                          multiAgentVersion: null,
                          additionalSpeedTiers: [],
                          serviceTiers: [],
                          defaultServiceTier: null,
                          isDefault: true,
                          upgrade: null,
                          upgradeInfo: null,
                          availabilityNux: null,
                          description: 'test model',
                        },
                      ],
                      nextCursor: null,
                    },
                  }),
                ].join('\n'),
              );
            }
            return outcome(request, '');
          },
        },
        paths: {
          home: '/home/dev',
          config: '/home/dev/.config/token-harness',
          data: '/home/dev/.local/share/token-harness',
          state: '/home/dev/.local/state/token-harness',
          cache: '/home/dev/.cache/token-harness',
        },
        localDatabase: null,
        projectIdFor: () => 'p_test',
      },
    };

    const result = await runOptimize(context);
    assert.equal(result.exitCode, 0);
    assert.ok(result.data);
    const advice = result.data.harnesses[0];
    assert.ok(advice);
    assert.equal(advice.contextPressure, 'high');
    assert.equal(advice.pace[0]?.state, 'over-pace');
    assert.equal(advice.currentEffort, 'high');
    assert.equal(advice.recommendedEffort, 'medium');
    assert.equal(advice.recommendedModel, 'gpt-5.6-codex');
    assert.equal(advice.recommendations[0]?.area, 'context');
    assert.match(advice.recommendations[0]?.action ?? '', /static context/i);
  });

  it('requires an explicit reserve for the custom profile', async () => {
    const context: CommandContext = {
      platform: PLATFORM,
      projectRoot: '/tmp/project',
      home: '/home/dev',
      stateRoot: null,
      harness: null,
      provider: null,
      taskClass: 'standard',
      budgetProfile: 'custom',
      reservePercent: null,
      since: null,
      until: null,
      planId: null,
      confirmed: false,
      metrics: null,
      adapters: null,
      compatibilityRows: null,
      now: () => '2026-08-30T14:00:00.000Z',
    };
    const result = await runOptimize(context);
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'custom-profile-needs-reserve');
  });
});
