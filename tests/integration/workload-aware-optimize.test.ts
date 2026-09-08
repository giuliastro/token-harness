import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  deriveProjectId,
  type CliEnvelope,
  type OptimizeReport,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};
const NOW = '2026-09-07T18:00:00.000Z';
const SALT = 'b'.repeat(64);
const MODEL = 'gpt-5.6-codex';
const EFFORT = 'medium';
const VERBOSITY = 'medium';

let sandbox = '';

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-workload-optimize-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

function success(request: ProcessRequest, stdout: string): ProcessOutcome {
  return {
    displayCommand: request.executable + ' ' + request.args.join(' '),
    interpreter: 'direct',
    executablePath: '/fake/' + request.executable,
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
    failure: { reason: 'executable-not-found', message: 'missing' },
  };
}

function epoch(instant: string): number {
  return Math.floor(Date.parse(instant) / 1000);
}

function runner(): ProcessRunner {
  return {
    async run(request) {
      if (request.executable === 'ccusage') return missing(request);
      if (request.executable !== 'codex') return missing(request);
      if (request.args[0] === '--version') return success(request, 'codex-cli 0.146.0');
      if (request.args[0] !== 'app-server') return missing(request);
      const stdin = request.stdin ?? '';

      if (stdin.includes('account/rateLimits/read')) {
        return success(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify({
              id: 'token-harness-rate-limits',
              result: {
                rateLimits: {
                  limitId: 'codex',
                  limitName: 'Codex',
                  primary: {
                    usedPercent: 30,
                    windowDurationMins: 300,
                    resetsAt: epoch('2026-09-07T21:00:00.000Z'),
                  },
                  secondary: {
                    usedPercent: 10,
                    windowDurationMins: 10_080,
                    resetsAt: epoch('2026-09-14T00:00:00.000Z'),
                  },
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
                  model: MODEL,
                  model_reasoning_effort: EFFORT,
                  model_verbosity: VERBOSITY,
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
                    id: MODEL,
                    model: MODEL,
                    displayName: MODEL,
                    modelSpecialty: null,
                    hidden: false,
                    supportedReasoningEfforts: [
                      { reasoningEffort: 'low', description: 'Low' },
                      { reasoningEffort: EFFORT, description: 'Medium' },
                      { reasoningEffort: 'high', description: 'High' },
                    ],
                    defaultReasoningEffort: EFFORT,
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

      return success(request, '');
    },
  };
}

function usageWindow(input: {
  scope: 'five-hour' | 'weekly';
  used: number;
  observedAt: string;
  resetsAt: string;
}): Record<string, unknown> {
  return {
    harnessId: 'codex',
    bucketId: input.scope === 'five-hour' ? 'codex-primary' : 'codex-secondary',
    bucketName: 'Codex subscription',
    window: input.scope === 'five-hour' ? 'primary' : 'secondary',
    scope: input.scope,
    usedPercent: input.used,
    remainingPercent: 100 - input.used,
    windowDurationMinutes: input.scope === 'five-hour' ? 300 : 10_080,
    resetsAt: input.resetsAt,
    observedAt: input.observedAt,
    source: 'native-rpc',
    confidence: 'authoritative',
  };
}

function seedReceipt(input: {
  state: string;
  projectId: string;
  benchmarkId: string;
  startedAt: string;
  completedAt: string;
  fiveDelta: number;
  weeklyDelta: number;
  fiveReset: string;
}): void {
  const root = join(input.state, 'benchmarks', input.benchmarkId);
  mkdirSync(root, { recursive: true });
  const usageBefore = [
    usageWindow({
      scope: 'five-hour',
      used: 20,
      observedAt: input.startedAt,
      resetsAt: input.fiveReset,
    }),
    usageWindow({
      scope: 'weekly',
      used: 20,
      observedAt: input.startedAt,
      resetsAt: '2026-09-14T00:00:00.000Z',
    }),
  ];
  const usageAfter = [
    usageWindow({
      scope: 'five-hour',
      used: 20 + input.fiveDelta,
      observedAt: input.completedAt,
      resetsAt: input.fiveReset,
    }),
    usageWindow({
      scope: 'weekly',
      used: 20 + input.weeklyDelta,
      observedAt: input.completedAt,
      resetsAt: '2026-09-14T00:00:00.000Z',
    }),
  ];
  const capture = {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: 'optimized',
    taskClass: 'standard',
    harnessId: 'codex',
    projectId: input.projectId,
    model: MODEL,
    reasoningEffort: EFFORT,
    verbosity: VERBOSITY,
    startedAt: input.startedAt,
    usageBefore,
    localSessionsBefore: null,
  };
  const receipt = {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: 'optimized',
    taskClass: 'standard',
    harnessId: 'codex',
    model: MODEL,
    reasoningEffort: EFFORT,
    verbosity: VERBOSITY,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    usageBefore,
    usageAfter,
    localUsage: null,
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
    policyAtFinish: {
      model: MODEL,
      reasoningEffort: EFFORT,
      verbosity: VERBOSITY,
      verification: 'config-only',
    },
  };
  writeFileSync(join(root, 'optimized.capture.json'), JSON.stringify(capture, null, 2));
  writeFileSync(join(root, 'optimized.json'), JSON.stringify(receipt, null, 2));
}

function seedBenchmarks(state: string, projectId: string): void {
  const rows = [
    { id: 'workload-a', hour: '09', five: 20, weekly: 15, reset: '12' },
    { id: 'workload-b', hour: '10', five: 25, weekly: 20, reset: '13' },
    { id: 'workload-c', hour: '11', five: 22, weekly: 18, reset: '14' },
  ];
  for (const row of rows) {
    seedReceipt({
      state,
      projectId,
      benchmarkId: row.id,
      startedAt: `2026-09-07T${row.hour}:00:00.000Z`,
      completedAt: `2026-09-07T${row.hour}:10:00.000Z`,
      fiveDelta: row.five,
      weeklyDelta: row.weekly,
      fiveReset: `2026-09-07T${row.reset}:00:00.000Z`,
    });
  }
}

describe('workload-aware optimize', () => {
  it('turns persisted exact-policy benchmark cost into a conservative backlog shortfall', async () => {
    const root = join(sandbox, 'world');
    const home = join(root, 'home');
    const state = join(root, 'state');
    const project = join(root, 'project');
    mkdirSync(join(project, '.git'), { recursive: true });
    mkdirSync(home, { recursive: true });
    mkdirSync(state, { recursive: true });
    const projectId = deriveProjectId(project, SALT, FACTS.os === 'windows');
    seedBenchmarks(state, projectId);

    let stdout = '';
    const options: RunOptions = {
      argv: [
        'optimize',
        '--json',
        '--harness',
        'codex',
        '--task',
        'standard',
        '--profile',
        'balanced',
        '--reserve',
        '20',
        '--tasks-left',
        '5',
      ],
      streams: {
        out: (text) => {
          stdout += text;
        },
        err: () => undefined,
      },
      platform: FACTS,
      cwd: project,
      home,
      stateRoot: state,
      adapters: {
        fs: new NodeFileSystem(FACTS),
        runner: runner(),
        paths: {
          home,
          config: join(home, 'config'),
          data: join(home, 'data'),
          state,
          cache: join(home, 'cache'),
        },
        localDatabase: null,
        projectIdFor: (path) => deriveProjectId(path, SALT, FACTS.os === 'windows'),
      },
      compatibilityRows: null,
      metrics: null,
      now: () => NOW,
    };

    const exitCode = await run(options);
    assert.equal(exitCode, 0);
    const envelope = JSON.parse(stdout) as CliEnvelope<OptimizeReport>;
    assert.equal(envelope.data?.tasksRemaining, 5);
    const advice = envelope.data?.harnesses[0];
    assert.ok(advice);
    assert.equal(advice.workloadCoverage?.state, 'shortfall');
    assert.equal(advice.workloadCoverage?.acceptedTasksRemaining, 2);
    assert.equal(advice.workloadCoverage?.shortfallTasks, 3);
    assert.equal(advice.workloadCoverage?.limitingScope, 'five-hour');
    assert.equal(advice.budgetDecision?.state, 'conserve');
    assert.equal(advice.budgetDecision?.allowEffortIncrease, false);
    assert.equal(advice.recommendedEffort, 'low');
    const workloadAdvice = advice.recommendations.find(
      (item) => item.area === 'quota' && item.evidence.some((row) => row.code === 'workload-capacity-shortfall'),
    );
    assert.ok(workloadAdvice);
    assert.equal(workloadAdvice.target, '3');
  });
});
