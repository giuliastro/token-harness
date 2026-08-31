import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { computePlan } from '../src/commands/plan.js';
import type { CommandContext } from '../src/commands/context.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

const HOME = '/home/dev';
const PROJECT = '/home/dev/project';
const CONFIG = '/home/dev/.codex/config.toml';

function success(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: '/usr/local/bin/' + request.executable,
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

function missing(request: ProcessRequest): ProcessOutcome {
  return {
    ...success(request, ''),
    executablePath: null,
    exitCode: null,
    failure: { reason: 'executable-not-found', message: request.executable + ' missing' },
  };
}

function commandContext(version = '0.146.0'): CommandContext {
  const files = new Map<string, FileStat>([
    [CONFIG, { kind: 'file', byteLength: 72, mode: '0600' }],
    [PROJECT + '/.git', { kind: 'directory', byteLength: 0, mode: null }],
  ]);
  return {
    platform: PLATFORM,
    projectRoot: PROJECT,
    home: HOME,
    stateRoot: null,
    harness: harnessId('codex'),
    provider: null,
    taskClass: 'standard',
    budgetProfile: 'balanced',
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
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (path) => files.get(path) ?? null,
        readFile: async () => new TextEncoder().encode('model_reasoning_effort = "high"\n'),
        writeFile: async () => {
          throw new Error('plan must remain read-only');
        },
        appendFile: async () => {
          throw new Error('plan must remain read-only');
        },
        createDirectory: async () => {
          throw new Error('plan must remain read-only');
        },
        remove: async () => {
          throw new Error('plan must remain read-only');
        },
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
          if (request.executable === 'ccusage') return missing(request);
          if (request.executable !== 'codex') return missing(request);
          if (request.args[0] === '--version') {
            return success(request, 'codex-cli ' + version);
          }

          const stdin = request.stdin ?? '';
          if (stdin.includes('account/rateLimits/read')) {
            return success(
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
            return success(
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
                    origins: {
                      model_reasoning_effort: {
                        name: { type: 'user', file: CONFIG, profile: null },
                        version: 'sha256:user-v1',
                      },
                      model_verbosity: {
                        name: { type: 'user', file: CONFIG, profile: null },
                        version: 'sha256:user-v1',
                      },
                    },
                    layers: [
                      {
                        name: { type: 'user', file: CONFIG, profile: null },
                        version: 'sha256:user-v1',
                        config: {},
                      },
                    ],
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
                        description: 'fixture',
                      },
                    ],
                    nextCursor: null,
                  },
                }),
              ].join('\n'),
            );
          }

          return success(request, '');
        },
      },
      paths: {
        home: HOME,
        config: HOME + '/.config/token-harness',
        data: HOME + '/.local/share/token-harness',
        state: HOME + '/.local/state/token-harness',
        cache: HOME + '/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
  };
}

describe('Codex managed native policy planning', () => {
  it('turns the explicit optimizer profile into a versioned reasoning/verbosity action only', async () => {
    const computed = await computePlan(commandContext());
    const native = computed.report.actions.find(
      (action) => action.kind === 'codex-config-batch-write',
    );

    assert.ok(native);
    assert.equal(native.filePath, CONFIG);
    assert.equal(native.expectedVersion, 'sha256:user-v1');
    assert.equal(native.reloadUserConfig, false);
    assert.deepEqual(native.edits, [
      {
        keyPath: 'model_reasoning_effort',
        value: 'low',
        mergeStrategy: 'replace',
      },
      {
        keyPath: 'model_verbosity',
        value: 'low',
        mergeStrategy: 'replace',
      },
    ]);
    assert.equal(
      computed.report.actions.some(
        (action) =>
          action.kind === 'codex-config-batch-write' &&
          action.edits.some((edit) => edit.keyPath === ('model' as never)),
      ),
      false,
    );
    assert.equal(
      computed.diagnostics.some((item) => item.code === 'codex-native-policy-planned'),
      true,
    );
  });

  it('refuses to plan the native write outside the fixture-proven Codex version', async () => {
    const computed = await computePlan(commandContext('0.147.0'));
    assert.equal(
      computed.report.actions.some((action) => action.kind === 'codex-config-batch-write'),
      false,
    );
    assert.equal(
      computed.diagnostics.some((item) => item.code === 'codex-native-policy-version-unproven'),
      true,
    );
  });
});
