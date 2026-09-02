import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import type { CommandContext } from '../src/commands/context.js';
import { computePlan } from '../src/commands/plan.js';

const HOME = '/home/dev';
const PROJECT = HOME + '/project';
const CONFIG = HOME + '/.codex/config.toml';
const CODEX = harnessId('codex');
const FACTS: PlatformFacts = {
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
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: null,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: { reason: 'executable-not-found', message: 'missing' },
  };
}

function context(input: {
  effortOrigin: Record<string, unknown> | null;
  verbosityOrigin: Record<string, unknown> | null;
  effort?: string;
  secondEffort?: string;
  verbosity?: string;
}): CommandContext {
  const files = new Map<string, string>([[CONFIG, 'model_reasoning_effort = "medium"\n']]);
  let configReadCount = 0;
  const encoder = new TextEncoder();

  return {
    platform: FACTS,
    projectRoot: PROJECT,
    home: HOME,
    stateRoot: HOME + '/.local/state/token-harness',
    harness: CODEX,
    // Select no provider adapter: this test isolates native policy from provider installation.
    provider: providerId('none'),
    taskClass: 'mechanical',
    budgetProfile: 'economy',
    reservePercent: 20,
    nativePolicy: true,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-01T18:00:00.000Z',
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat: async (path): Promise<FileStat | null> =>
          files.has(path)
            ? { kind: 'file', byteLength: files.get(path)?.length ?? 0, mode: null }
            : null,
        readFile: async (path) => encoder.encode(files.get(path) ?? ''),
        writeFile: async () => {
          throw new Error('plan is read-only');
        },
        appendFile: async () => {
          throw new Error('plan is read-only');
        },
        createDirectory: async () => {
          throw new Error('plan is read-only');
        },
        remove: async () => {
          throw new Error('plan is read-only');
        },
        readDirectory: async () => [],
      },
      runner: {
        run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
          if (request.executable === 'codex' && request.args[0] === '--version') {
            return outcome(request, 'codex-cli 0.146.0');
          }
          if (request.executable !== 'codex' || request.args[0] !== 'app-server') {
            return missing(request);
          }

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
                        usedPercent: 20,
                        windowDurationMins: 300,
                        resetsAt: 1788292800,
                      },
                      secondary: null,
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
            const currentEffort =
              configReadCount === 0
                ? (input.effort ?? 'medium')
                : (input.secondEffort ?? input.effort ?? 'medium');
            configReadCount += 1;
            const origins: Record<string, unknown> = {};
            if (input.effortOrigin !== null) {
              origins['model_reasoning_effort'] = input.effortOrigin;
            }
            if (input.verbosityOrigin !== null) {
              origins['model_verbosity'] = input.verbosityOrigin;
            }
            return outcome(
              request,
              [
                JSON.stringify({ id: 1, result: {} }),
                JSON.stringify({
                  id: 2,
                  result: {
                    config: {
                      model: 'gpt-5.6-codex',
                      model_reasoning_effort: currentEffort,
                      model_verbosity: input.verbosity ?? 'medium',
                      project_root_markers: ['.git'],
                      project_doc_fallback_filenames: [],
                    },
                    origins,
                    layers: [
                      {
                        name: { type: 'user', file: CONFIG, profile: null },
                        version: 'user-v9',
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
                        supportedReasoningEfforts: [
                          { reasoningEffort: 'low', description: 'Low' },
                          { reasoningEffort: 'medium', description: 'Medium' },
                          { reasoningEffort: 'high', description: 'High' },
                        ],
                        defaultReasoningEffort: 'medium',
                        isDefault: true,
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
        home: HOME,
        config: HOME + '/.config/token-harness',
        data: HOME + '/.local/share/token-harness',
        state: HOME + '/.local/state/token-harness',
        cache: HOME + '/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => 'p_native',
    },
  };
}

const USER_EFFORT = {
  name: { type: 'user', file: CONFIG, profile: null },
  version: 'user-v9',
};

describe('Codex native policy planning', () => {
  it('turns reviewed optimizer deltas into one versioned atomic Codex batch', async () => {
    const computed = await computePlan(
      context({
        effortOrigin: USER_EFFORT,
        verbosityOrigin: {
          name: { type: 'user', file: CONFIG, profile: null },
          version: 'user-v9',
        },
      }),
    );

    const action = computed.report.actions.find(
      (candidate) => candidate.kind === 'codex-config-batch-write',
    );
    assert.ok(action);
    assert.equal(action.path, CONFIG);
    assert.equal(action.expectedVersion, 'user-v9');
    assert.equal(action.reloadUserConfig, true);
    assert.deepEqual(action.edits, [
      { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' },
      { keyPath: 'model_verbosity', value: 'low', mergeStrategy: 'replace' },
    ]);
    assert.equal(action.riskClass, 'reversible');
    assert.deepEqual(action.affectedPaths, [CONFIG]);
  });

  it('allows an absent field origin only when the native origins object was observed', async () => {
    const computed = await computePlan(
      context({
        effortOrigin: null,
        verbosityOrigin: null,
        verbosity: 'low',
      }),
    );
    const action = computed.report.actions.find(
      (candidate) => candidate.kind === 'codex-config-batch-write',
    );
    assert.ok(action);
    assert.deepEqual(action.edits, [
      { keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' },
    ]);
  });

  it('refuses a field when optimizer and native-plan observations diverge', async () => {
    const computed = await computePlan(
      context({
        effortOrigin: USER_EFFORT,
        verbosityOrigin: null,
        effort: 'medium',
        secondEffort: 'high',
        verbosity: 'low',
      }),
    );
    assert.equal(
      computed.report.actions.some((candidate) => candidate.kind === 'codex-config-batch-write'),
      false,
    );
    assert.equal(
      computed.diagnostics.some((entry) => entry.code === 'codex-native-policy-observation-drift'),
      true,
    );
  });

  it('leaves a selected-profile value untouched', async () => {
    const computed = await computePlan(
      context({
        effortOrigin: {
          name: { type: 'user', file: CONFIG, profile: 'economy' },
          version: 'profile-v3',
        },
        verbosityOrigin: null,
        verbosity: 'low',
      }),
    );
    assert.equal(
      computed.report.actions.some((candidate) => candidate.kind === 'codex-config-batch-write'),
      false,
    );
    assert.equal(
      computed.diagnostics.some((entry) => entry.code === 'codex-native-policy-shadowed'),
      true,
    );
  });

  it('leaves a project-owned effective setting untouched', async () => {
    const computed = await computePlan(
      context({
        effortOrigin: {
          name: { type: 'project', file: PROJECT + '/.codex/config.toml', profile: null },
          version: 'project-v2',
        },
        verbosityOrigin: null,
        verbosity: 'low',
      }),
    );
    assert.equal(
      computed.report.actions.some((candidate) => candidate.kind === 'codex-config-batch-write'),
      false,
    );
    assert.equal(
      computed.diagnostics.some((entry) => entry.code === 'codex-native-policy-shadowed'),
      true,
    );
  });
});
