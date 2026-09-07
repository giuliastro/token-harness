import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type PlanReport,
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
const SALT = 'a'.repeat(64);
const BASE_MODEL = 'gpt-5.6-codex';
const CANDIDATE_MODEL = 'gpt-5.6-codex-mini';
const EFFORT = 'medium';
const VERBOSITY = 'medium';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-managed-model-policy-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface World {
  home: string;
  state: string;
  project: string;
  config: string;
  version: string;
  model: string;
}

function world(): World {
  counter += 1;
  const root = join(sandbox, 'world-' + String(counter));
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  const codex = join(home, '.codex');
  mkdirSync(codex, { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
  const config = join(codex, 'config.toml');
  writeFileSync(
    config,
    'model = "' +
      BASE_MODEL +
      '"\nmodel_reasoning_effort = "' +
      EFFORT +
      '"\nmodel_verbosity = "' +
      VERBOSITY +
      '"\n# user comment\n',
  );
  return { home, state, project, config, version: 'user-v1', model: BASE_MODEL };
}

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

function catalog(): Array<Record<string, unknown>> {
  return [BASE_MODEL, CANDIDATE_MODEL].map((model, index) => ({
    id: model,
    model,
    displayName: model,
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
    isDefault: index === 0,
    upgrade: null,
    upgradeInfo: null,
    availabilityNux: null,
    description: 'test model',
  }));
}

function configRead(place: World, id: string | number): Record<string, unknown> {
  const origin = {
    name: { type: 'user', file: place.config, profile: null },
    version: place.version,
  };
  return {
    id,
    result: {
      config: {
        model: place.model,
        model_reasoning_effort: EFFORT,
        model_verbosity: VERBOSITY,
        project_root_markers: ['.git'],
        project_doc_fallback_filenames: [],
      },
      origins: {
        model: origin,
        model_reasoning_effort: origin,
        model_verbosity: origin,
      },
      layers: [
        {
          name: { type: 'user', file: place.config, profile: null },
          version: place.version,
          config: {},
        },
      ],
    },
  };
}

function runner(place: World): ProcessRunner {
  return {
    async run(request) {
      if (request.executable === 'ccusage') return missing(request);
      if (request.executable !== 'codex') return missing(request);
      if (request.args[0] === '--version') return success(request, 'codex-cli 0.146.0');
      if (request.args[0] !== 'app-server') return missing(request);

      const stdin = request.stdin ?? '';
      const messages = stdin
        .split(/\r?\n/)
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>);

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

      if (stdin.includes('config/batchWrite')) {
        const batch = messages.find((message) => message['method'] === 'config/batchWrite');
        const verify = messages.find((message) => message['method'] === 'config/read');
        assert.ok(batch);
        assert.ok(verify);
        const batchId = batch['id'];
        const verifyId = verify['id'];
        assert.ok(typeof batchId === 'string' || typeof batchId === 'number');
        assert.ok(typeof verifyId === 'string' || typeof verifyId === 'number');
        const params = batch['params'];
        assert.ok(typeof params === 'object' && params !== null && !Array.isArray(params));
        const record = params as Record<string, unknown>;
        assert.equal(record['filePath'], place.config);
        assert.equal(record['expectedVersion'], place.version);
        const edits = record['edits'];
        assert.ok(Array.isArray(edits));
        assert.deepEqual(edits, [
          { keyPath: 'model', value: CANDIDATE_MODEL, mergeStrategy: 'replace' },
        ]);

        place.model = CANDIDATE_MODEL;
        place.version = 'user-v2';
        writeFileSync(
          place.config,
          'model = "' +
            place.model +
            '"\nmodel_reasoning_effort = "' +
            EFFORT +
            '"\nmodel_verbosity = "' +
            VERBOSITY +
            '"\n# user comment\n',
        );
        return success(
          request,
          [
            JSON.stringify({ id: batchId, result: { version: place.version } }),
            JSON.stringify(configRead(place, verifyId)),
          ].join('\n'),
        );
      }

      if (stdin.includes('model/list') && !stdin.includes('config/read')) {
        const modelRequest = messages.find((message) => message['method'] === 'model/list');
        assert.ok(modelRequest);
        const id = modelRequest['id'];
        assert.ok(typeof id === 'string' || typeof id === 'number');
        return success(
          request,
          JSON.stringify({ id, result: { data: catalog(), nextCursor: null } }),
        );
      }

      if (stdin.includes('config/read')) {
        return success(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify(configRead(place, 2)),
            JSON.stringify({ id: 3, result: { data: [], nextCursor: null } }),
            JSON.stringify({ id: 4, result: { data: catalog(), nextCursor: null } }),
          ].join('\n'),
        );
      }

      return success(request, '');
    },
  };
}

interface Captured<T> {
  exitCode: number;
  data: T | null;
  envelope: CliEnvelope<T>;
}

async function invoke<T>(argv: readonly string[], place: World): Promise<Captured<T>> {
  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const options: RunOptions = {
    argv: [...argv, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: () => undefined,
    },
    platform: FACTS,
    cwd: place.project,
    home: place.home,
    stateRoot: place.state,
    adapters: {
      fs,
      runner: runner(place),
      paths: {
        home: place.home,
        config: join(place.home, 'config'),
        data: join(place.home, 'data'),
        state: place.state,
        cache: join(place.home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: (path) => deriveProjectId(path, SALT, FACTS.os === 'windows'),
    },
    compatibilityRows: null,
    metrics: null,
    now: () => NOW,
  };

  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, envelope };
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

function writeVariant(input: {
  place: World;
  projectId: string;
  benchmarkId: string;
  variant: 'baseline' | 'optimized';
  model: string;
  startedAt: string;
  completedAt: string;
  fiveBefore: number;
  fiveDelta: number;
  weeklyBefore: number;
  weeklyDelta: number;
  fiveReset: string;
  weeklyReset: string;
}): void {
  const root = join(input.place.state, 'benchmarks', input.benchmarkId);
  mkdirSync(root, { recursive: true });
  const usageBefore = [
    usageWindow({
      scope: 'five-hour',
      used: input.fiveBefore,
      observedAt: input.startedAt,
      resetsAt: input.fiveReset,
    }),
    usageWindow({
      scope: 'weekly',
      used: input.weeklyBefore,
      observedAt: input.startedAt,
      resetsAt: input.weeklyReset,
    }),
  ];
  const usageAfter = [
    usageWindow({
      scope: 'five-hour',
      used: input.fiveBefore + input.fiveDelta,
      observedAt: input.completedAt,
      resetsAt: input.fiveReset,
    }),
    usageWindow({
      scope: 'weekly',
      used: input.weeklyBefore + input.weeklyDelta,
      observedAt: input.completedAt,
      resetsAt: input.weeklyReset,
    }),
  ];
  const capture = {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: input.variant,
    taskClass: 'standard',
    harnessId: 'codex',
    projectId: input.projectId,
    model: input.model,
    reasoningEffort: EFFORT,
    verbosity: VERBOSITY,
    startedAt: input.startedAt,
    usageBefore,
    localSessionsBefore: null,
  };
  const receipt = {
    schemaVersion: 1,
    benchmarkId: input.benchmarkId,
    variant: input.variant,
    taskClass: 'standard',
    harnessId: 'codex',
    model: input.model,
    reasoningEffort: EFFORT,
    verbosity: VERBOSITY,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    usageBefore,
    usageAfter,
    localUsage: null,
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
    policyAtFinish: {
      model: input.model,
      reasoningEffort: EFFORT,
      verbosity: VERBOSITY,
      verification: 'config-only',
    },
  };
  writeFileSync(join(root, input.variant + '.capture.json'), JSON.stringify(capture, null, 2));
  writeFileSync(join(root, input.variant + '.json'), JSON.stringify(receipt, null, 2));
}

function seedModelBenchmarks(place: World, count: number): void {
  const projectId = deriveProjectId(place.project, SALT, FACTS.os === 'windows');
  const weeklyReset = '2026-09-08T00:00:00.000Z';
  for (let index = 0; index < count; index += 1) {
    const day = String(index + 1).padStart(2, '0');
    const benchmarkId = 'model-policy-' + String(index + 1);
    const fiveReset = '2026-09-' + day + 'T12:00:00.000Z';
    const baselineStart = '2026-09-' + day + 'T08:00:00.000Z';
    const baselineEnd = '2026-09-' + day + 'T08:10:00.000Z';
    const candidateStart = '2026-09-' + day + 'T08:20:00.000Z';
    const candidateEnd = '2026-09-' + day + 'T08:30:00.000Z';
    const weeklyBefore = 10 + index * 20;

    writeVariant({
      place,
      projectId,
      benchmarkId,
      variant: 'baseline',
      model: BASE_MODEL,
      startedAt: baselineStart,
      completedAt: baselineEnd,
      fiveBefore: 10,
      fiveDelta: 6,
      weeklyBefore,
      weeklyDelta: 9,
      fiveReset,
      weeklyReset,
    });
    writeVariant({
      place,
      projectId,
      benchmarkId,
      variant: 'optimized',
      model: CANDIDATE_MODEL,
      startedAt: candidateStart,
      completedAt: candidateEnd,
      fiveBefore: 16,
      fiveDelta: 4,
      weeklyBefore: weeklyBefore + 9,
      weeklyDelta: 7,
      fiveReset,
      weeklyReset,
    });
  }
}

async function nativePlan(place: World): Promise<Captured<PlanReport>> {
  return invoke<PlanReport>(
    [
      'plan',
      '--native-policy',
      '--harness',
      'codex',
      '--provider',
      'none',
      '--task',
      'standard',
      '--profile',
      'balanced',
    ],
    place,
  );
}

describe('learned Codex model policy', () => {
  it('persists a model-only plan from three outcome-safe allowance wins and applies it', async () => {
    const place = world();
    seedModelBenchmarks(place, 3);

    const planned = await nativePlan(place);
    assert.equal(planned.exitCode, 0);
    assert.equal(planned.data?.persisted, true);
    const planId = planned.data?.planId;
    assert.ok(planId);
    const action = planned.data?.actions.find(
      (candidate) => candidate.kind === 'codex-config-batch-write',
    );
    assert.ok(action);
    assert.equal(action.policyGuard, 'subscription-safe');
    assert.deepEqual(action.edits, [
      { keyPath: 'model', value: CANDIDATE_MODEL, mergeStrategy: 'replace' },
    ]);
    assert.deepEqual(action.modelReference, {
      requested: CANDIDATE_MODEL,
      resolution: 'native-catalog',
    });
    assert.equal(action.expectedVersion, 'user-v1');

    const applied = await invoke<ApplyReport>(['apply', '--yes', '--plan', planId], place);
    assert.equal(applied.exitCode, 0);
    assert.equal(applied.data?.outcome, 'committed');
    assert.equal(applied.data?.fromStoredPlan, true);
    assert.equal(place.model, CANDIDATE_MODEL);
    const config = readFileSync(place.config, 'utf8');
    assert.match(config, new RegExp('model = "' + CANDIDATE_MODEL + '"'));
    assert.match(config, /model_reasoning_effort = "medium"/);
    assert.match(config, /model_verbosity = "medium"/);
  });

  it('keeps model mutation advisory when fewer than three paired comparisons exist', async () => {
    const place = world();
    seedModelBenchmarks(place, 2);

    const planned = await nativePlan(place);
    assert.equal(planned.exitCode, 0);
    const modelEdits = (planned.data?.actions ?? [])
      .filter((candidate) => candidate.kind === 'codex-config-batch-write')
      .flatMap((candidate) => candidate.edits)
      .filter((edit) => edit.keyPath === 'model');
    assert.deepEqual(modelEdits, []);
    assert.equal(place.model, BASE_MODEL);
    assert.match(readFileSync(place.config, 'utf8'), new RegExp('model = "' + BASE_MODEL + '"'));
  });
});
