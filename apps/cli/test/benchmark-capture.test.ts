import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import {
  runBenchmarkFinish,
  runBenchmarkStart,
} from '../src/commands/benchmark-capture.js';
import type { CommandContext } from '../src/commands/context.js';

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

function fixture() {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(['/home/dev/project/.git']);
  let usedPercent = 20;
  let now = '2026-09-02T10:00:00.000Z';
  let projectId = 'p_test';

  const stat = async (path: string): Promise<FileStat | null> => {
    if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
    const bytes = files.get(path);
    return bytes === undefined ? null : { kind: 'file', byteLength: bytes.byteLength, mode: null };
  };

  const runner = {
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
                  limitId: 'codex-main',
                  limitName: 'Codex',
                  primary: {
                    usedPercent,
                    windowDurationMins: 300,
                    resetsAt: 1788357600,
                  },
                  secondary: null,
                  credits: null,
                  individualLimit: null,
                  spendControlReached: null,
                  planType: 'plus',
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
                  model_reasoning_effort: 'medium',
                  model_verbosity: 'low',
                  project_doc_max_bytes: 32768,
                  project_root_markers: ['.git'],
                  project_doc_fallback_filenames: [],
                },
                origins: {},
                layers: [],
              },
            }),
            JSON.stringify({
              id: 3,
              result: {
                data: [],
                nextCursor: null,
              },
            }),
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
                    description: 'fixture model',
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
  };

  const context = (): CommandContext => ({
    platform: PLATFORM,
    projectRoot: '/home/dev/project',
    home: '/home/dev',
    stateRoot: '/home/dev/.local/state/token-harness',
    harness: harnessId('codex'),
    provider: null,
    baselineReceipt: null,
    optimizedReceipt: null,
    benchmarkId: 'mechanical-real-1',
    benchmarkVariant: 'baseline',
    benchmarkQuality: null,
    benchmarkAttempts: null,
    benchmarkFailedAttempts: null,
    taskClass: 'mechanical',
    budgetProfile: null,
    reservePercent: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => now,
    adapters: {
      fs: {
        join: (...parts) => parts.join('/').replaceAll('//', '/'),
        dirname: (path) => path.split('/').slice(0, -1).join('/') || '/',
        basename: (path) => path.split('/').at(-1) ?? path,
        isInside: (candidate, parent) => candidate.startsWith(parent),
        stat,
        readFile: async (path) => {
          const bytes = files.get(path);
          if (bytes === undefined) throw new Error('missing');
          return bytes;
        },
        writeFile: async (path, bytes) => {
          files.set(path, new Uint8Array(bytes));
        },
        appendFile: async () => {
          throw new Error('not used');
        },
        createDirectory: async () => undefined,
        remove: async (path) => {
          files.delete(path);
        },
        readDirectory: async () => [],
      },
      runner,
      paths: {
        home: '/home/dev',
        config: '/home/dev/.config/token-harness',
        data: '/home/dev/.local/share/token-harness',
        state: '/home/dev/.local/state/token-harness',
        cache: '/home/dev/.cache/token-harness',
      },
      localDatabase: null,
      projectIdFor: () => projectId,
    },
  });

  return {
    context,
    files,
    setUsedPercent(value: number) {
      usedPercent = value;
    },
    setNow(value: string) {
      now = value;
    },
    setProjectId(value: string) {
      projectId = value;
    },
    text(path: string): string {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`missing ${path}`);
      return new TextDecoder().decode(bytes);
    },
  };
}

describe('benchmark capture commands', () => {
  it('captures policy/quota before the task and closes a receipt after it', async () => {
    const world = fixture();
    const started = await runBenchmarkStart(world.context());
    assert.equal(started.exitCode, 0);
    assert.ok(started.data);
    assert.equal(started.data.capture.model, 'gpt-5.6-codex');
    assert.equal(started.data.capture.reasoningEffort, 'medium');
    assert.equal(started.data.capture.verbosity, 'low');
    assert.equal(started.data.capture.usageBefore[0]?.usedPercent, 20);
    assert.equal(started.data.capture.projectId, 'p_test');

    const captureText = world.text(started.data.capturePath);
    assert.doesNotMatch(captureText, /\/home\/dev\/project/);
    assert.match(captureText, /"projectId": "p_test"/);

    world.setUsedPercent(26);
    world.setNow('2026-09-02T10:20:00.000Z');
    const finishContext = world.context();
    finishContext.benchmarkQuality = 'passed';
    finishContext.benchmarkAttempts = 1;
    finishContext.benchmarkFailedAttempts = 0;

    const finished = await runBenchmarkFinish(finishContext);
    assert.equal(finished.exitCode, 0);
    assert.ok(finished.data);
    assert.equal(finished.data.receipt.usageBefore[0]?.usedPercent, 20);
    assert.equal(finished.data.receipt.usageAfter[0]?.usedPercent, 26);
    assert.equal(finished.data.receipt.outcome.qualityGate, 'passed');
    assert.equal(finished.data.receipt.localUsage, null);
    assert.deepEqual(finished.data.receipt.outcome.errorCodes, []);
    assert.match(world.text(finished.data.receiptPath), /"variant": "baseline"/);
  });

  it('refuses a capture when the project cannot be stably attributed', async () => {
    const world = fixture();
    world.setProjectId('p_unattributed');
    const started = await runBenchmarkStart(world.context());
    assert.equal(started.exitCode, 9);
    assert.equal(started.diagnostics[0]?.code, 'benchmark-project-unattributed');
  });

  it('refuses to overwrite an existing capture or completed receipt', async () => {
    const world = fixture();
    const first = await runBenchmarkStart(world.context());
    assert.equal(first.exitCode, 0);

    const duplicate = await runBenchmarkStart(world.context());
    assert.equal(duplicate.exitCode, 5);
    assert.equal(duplicate.diagnostics[0]?.code, 'benchmark-capture-exists');

    world.setNow('2026-09-02T10:20:00.000Z');
    const finishContext = world.context();
    finishContext.benchmarkQuality = 'passed';
    finishContext.benchmarkAttempts = 1;
    finishContext.benchmarkFailedAttempts = 0;
    const finished = await runBenchmarkFinish(finishContext);
    assert.equal(finished.exitCode, 0);

    const duplicateFinish = await runBenchmarkFinish(finishContext);
    assert.equal(duplicateFinish.exitCode, 5);
    assert.equal(duplicateFinish.diagnostics[0]?.code, 'benchmark-receipt-exists');
  });

  it('refuses to finish from a different project', async () => {
    const world = fixture();
    assert.equal((await runBenchmarkStart(world.context())).exitCode, 0);
    world.setProjectId('p_other');
    world.setNow('2026-09-02T10:20:00.000Z');

    const finishContext = world.context();
    finishContext.benchmarkQuality = 'passed';
    finishContext.benchmarkAttempts = 1;
    finishContext.benchmarkFailedAttempts = 0;
    const finished = await runBenchmarkFinish(finishContext);
    assert.equal(finished.exitCode, 5);
    assert.equal(finished.diagnostics[0]?.code, 'benchmark-project-changed');
  });

  it('rejects impossible attempt counts before observing or writing the finish', async () => {
    const world = fixture();
    assert.equal((await runBenchmarkStart(world.context())).exitCode, 0);

    const finishContext = world.context();
    finishContext.benchmarkQuality = 'passed';
    finishContext.benchmarkAttempts = 1;
    finishContext.benchmarkFailedAttempts = 2;
    const finished = await runBenchmarkFinish(finishContext);
    assert.equal(finished.exitCode, 2);
    assert.equal(finished.diagnostics[0]?.code, 'benchmark-failed-attempts-exceed-attempts');
  });
});
