import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  EXIT_CODES,
  type FileStat,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';

import { runBenchmarkFactorial } from '../src/commands/benchmark-factorial.js';
import { runBenchmarkMatrix } from '../src/commands/benchmark-matrix.js';
import { parseArgv } from '../src/argv.js';
import { runBenchmarkFinish, runBenchmarkStart } from '../src/commands/benchmark-capture.js';
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
  let checkResult: Partial<ProcessOutcome> = {};
  const checkRequests: ProcessRequest[] = [];
  let localSession = {
    inputTokens: 800,
    cacheCreationTokens: 0,
    cacheReadTokens: 100,
    outputTokens: 100,
    totalTokens: 1000,
    lastActivity: '2026-09-02T09:59:00.000Z',
  };

  const stat = async (path: string): Promise<FileStat | null> => {
    if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
    const bytes = files.get(path);
    return bytes === undefined ? null : { kind: 'file', byteLength: bytes.byteLength, mode: null };
  };

  const runner = {
    run: async (request: ProcessRequest): Promise<ProcessOutcome> => {
      if (request.executable === 'test-check') {
        checkRequests.push(request);
        return {
          ...outcome(request, 'passed'),
          outputEvidence: {
            stdout: { sha256: 'a'.repeat(64), bytes: 6, tail: 'passed' },
            stderr: { sha256: 'b'.repeat(64), bytes: 0, tail: '' },
          },
          ...checkResult,
        };
      }
      if (request.executable === 'ccusage' && request.args[0] === '--version') {
        return outcome(request, 'ccusage 20.0.20');
      }
      if (request.executable === 'ccusage' && request.args[0] === 'daily') {
        return outcome(
          request,
          JSON.stringify({
            daily: [],
            session: [
              {
                agent: 'codex',
                period: 'codex-session-1',
                inputTokens: localSession.inputTokens,
                cacheCreationTokens: localSession.cacheCreationTokens,
                cacheReadTokens: localSession.cacheReadTokens,
                outputTokens: localSession.outputTokens,
                totalTokens: localSession.totalTokens,
                modelsUsed: ['gpt-5.6-codex'],
                metadata: {
                  firstActivity: '2026-09-02T09:30:00.000Z',
                  lastActivity: localSession.lastActivity,
                },
              },
            ],
          }),
        );
      }
      if (request.executable === 'codex' && request.args[0] === '--version') {
        return outcome(request, 'codex-cli 0.146.0');
      }

      const stdin = request.stdin ?? '';
      if (stdin.includes('account/rateLimits/read')) {
        return outcome(
          request,
          [
            JSON.stringify({ id: 1, result: {} }),
            JSON.stringify({
              id: 'token-harness-rate-limits',
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
          const parent = path.split('/').slice(0, -1).join('/');
          directories.add(parent);
          directories.add(parent.split('/').slice(0, -1).join('/'));
        },
        appendFile: async () => {
          throw new Error('not used');
        },
        createDirectory: async (path) => {
          directories.add(path);
          directories.add(path.split('/').slice(0, -1).join('/'));
        },
        remove: async (path) => {
          files.delete(path);
        },
        readDirectory: async (path) => {
          const prefix = path.endsWith('/') ? path : `${path}/`;
          return [...new Set([...files.keys(), ...directories])]
            .filter((candidate) => candidate.startsWith(prefix))
            .map((candidate) => candidate.slice(prefix.length))
            .filter((name) => name !== '' && !name.includes('/'));
        },
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
    checkRequests,
    setCheckResult(value: Partial<ProcessOutcome>) {
      checkResult = value;
    },
    setFile(path: string, value: unknown) {
      files.set(path, new TextEncoder().encode(JSON.stringify(value)));
    },
    setUsedPercent(value: number) {
      usedPercent = value;
    },
    setNow(value: string) {
      now = value;
    },
    setProjectId(value: string) {
      projectId = value;
    },
    setLocalSession(value: typeof localSession) {
      localSession = value;
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
    world.setLocalSession({
      inputTokens: 1050,
      cacheCreationTokens: 0,
      cacheReadTokens: 150,
      outputTokens: 200,
      totalTokens: 1400,
      lastActivity: '2026-09-02T10:18:00.000Z',
    });
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
    assert.deepEqual(finished.data.receipt.localUsage, {
      inputTokens: 250,
      cacheCreationTokens: 0,
      cacheReadTokens: 50,
      outputTokens: 100,
      totalTokens: 400,
    });
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

describe('saved direct quality checks', () => {
  const check = { executable: 'test-check', args: ['run', 'verify'], timeoutMs: 120000 };
  const finish = (world: ReturnType<typeof fixture>, extra: Partial<CommandContext> = {}) => ({
    ...world.context(),
    benchmarkAttempts: 1,
    benchmarkFailedAttempts: 0,
    ...extra,
  });
  it('previews without executing or finalizing, then executes only the saved argv in the project', async () => {
    const world = fixture();
    const start = await runBenchmarkStart({ ...world.context(), benchmarkCheck: check });
    assert.ok(start.data);
    assert.equal(start.data.capture.schemaVersion, 2);
    assert.deepEqual(start.data.capture.qualityCheck, check);
    const plan = await runBenchmarkFinish(finish(world));
    assert.equal(plan.exitCode, 0);
    assert.equal(plan.data, null);
    assert.equal(plan.diagnostics[0]!.code, 'benchmark-check-plan');
    assert.equal(world.checkRequests.length, 0);
    assert.equal(world.files.has(start.data.capturePath.replace('.capture.json', '.json')), false);
    const result = await runBenchmarkFinish(finish(world, { confirmed: true }));
    assert.ok(result.data);
    assert.equal(result.data.receipt.outcome.qualityGate, 'passed');
    assert.equal(world.checkRequests.length, 1);
    assert.deepEqual(world.checkRequests[0], {
      executable: 'test-check',
      args: ['run', 'verify'],
      cwd: '/home/dev/project',
      timeoutMs: 120000,
      maxOutputBytes: 8192,
      captureOutputEvidence: true,
    });
    assert.equal(result.data.receipt.outcome.qualityEvidence?.source, 'check-command');
    assert.equal(
      world.files.has(result.data.receiptPath.replace('.json', '.check-output.json')),
      true,
    );
    assert.doesNotMatch(world.text(result.data.receiptPath), /"tail"/);
  });
  it('uses a nonzero exit despite truncated passing output and contradicting recorded quality', async () => {
    const world = fixture();
    await runBenchmarkStart({ ...world.context(), benchmarkCheck: check });
    world.setCheckResult({
      exitCode: 1,
      stdout: 'passing output only',
      stdoutTruncated: true,
      outputEvidence: {
        stdout: { sha256: 'c'.repeat(64), bytes: 50000, tail: 'LAST TEST FAILED' },
        stderr: { sha256: 'd'.repeat(64), bytes: 0, tail: '' },
      },
    });
    const result = await runBenchmarkFinish(
      finish(world, { confirmed: true, benchmarkQuality: 'passed' }),
    );
    assert.ok(result.data);
    assert.equal(result.data.receipt.outcome.qualityGate, 'failed');
    assert.ok(result.diagnostics.some((d) => d.code === 'benchmark-check-quality-mismatch'));
    const e = result.data.receipt.outcome.qualityEvidence;
    assert.ok(e?.source === 'check-command');
    assert.equal(e.output!.stdout.bytes, 50000);
    assert.equal(e.output!.stdout.sha256, 'c'.repeat(64));
    assert.equal(e.userRecordedQuality, 'passed');
    assert.match(
      world.text(result.data.receiptPath.replace('.json', '.check-output.json')),
      /LAST TEST FAILED/,
    );
  });
  it('records timeout, start failure or signal as unknown', async () => {
    for (const overrides of [
      {
        timedOut: true,
        exitCode: 0,
        failure: { reason: 'timed-out' as const, message: 'fixture' },
      },
      { exitCode: null, failure: { reason: 'executable-not-found' as const, message: 'fixture' } },
      { signal: 'SIGTERM', exitCode: 0 },
    ]) {
      const world = fixture();
      await runBenchmarkStart({ ...world.context(), benchmarkCheck: check });
      world.setCheckResult(overrides);
      const result = await runBenchmarkFinish(finish(world, { confirmed: true }));
      assert.ok(result.data);
      assert.equal(result.data.receipt.outcome.qualityGate, 'unknown');
    }
  });
  it('freezes the check and blocks a changed counterpart without executing it', async () => {
    const world = fixture();
    await runBenchmarkStart({ ...world.context(), benchmarkCheck: check });
    const changed = await runBenchmarkStart({
      ...world.context(),
      benchmarkVariant: 'optimized',
      benchmarkCheck: { ...check, args: ['other'] },
    });
    assert.equal(changed.exitCode, EXIT_CODES['precondition-drift']);
    assert.equal(changed.diagnostics[0]!.code, 'benchmark-arm-identity-mismatch');
    const finishChanged = await runBenchmarkFinish(
      finish(world, { confirmed: true, benchmarkCheck: { ...check, args: ['other'] } }),
    );
    assert.equal(finishChanged.exitCode, 2);
    assert.equal(world.checkRequests.length, 0);
  });
  it('validates JSON argv, timeout ranges and start-only options at the public parser', () => {
    const args = [
      'benchmark-start',
      '--check-command',
      '["npm","run","verify"]',
      '--check-timeout',
      '120000',
    ];
    const parsed = parseArgv(args);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind === 'command') assert.equal(parsed.options.benchmarkCheck!.timeoutMs, 120000);
    for (const argv of [
      ['benchmark-start', '--check-command', 'npm test'],
      ['benchmark-start', '--check-command', '[]'],
      ['benchmark-start', '--check-timeout', '0'],
      ['benchmark-start', '--check-timeout', '1000'],
      ['benchmark-finish', '--check-command', '["npm","test"]'],
    ])
      assert.equal(parseArgv(argv).kind, 'usage-error');
  });
});

describe('factorial capture/report integration', () => {
  it('keeps a four-arm set out of paired matrix history and exposes its incomplete report', async () => {
    const world = fixture();
    const start = await runBenchmarkStart({
      ...world.context(),
      benchmarkStartingState: 'initial-commit',
    });
    assert.equal(start.exitCode, 0);
    const report = await runBenchmarkFactorial(world.context());
    assert.ok(report.data);
    assert.equal(report.data.status, 'incomplete');
    const matrix = await runBenchmarkMatrix(world.context());
    assert.ok(matrix.data);
    assert.equal(matrix.data.entries.length, 0);
    assert.equal(matrix.data.factorial!.length, 1);
    assert.equal(matrix.data.selection.incomplete, 0);
  });
  it('records all four arms with identical checks, then reports routing evidence as unverified', async () => {
    const world = fixture();
    const check = { executable: 'test-check', args: [], timeoutMs: 120000 };
    for (const arm of ['baseline', 'compression-only', 'routing-only', 'combined'] as const) {
      const ctx = {
        ...world.context(),
        benchmarkVariant: arm,
        benchmarkStartingState: 'initial-commit',
        benchmarkCheck: check,
      };
      assert.equal((await runBenchmarkStart(ctx)).exitCode, 0);
      const result = await runBenchmarkFinish({
        ...world.context(),
        benchmarkVariant: arm,
        benchmarkAttempts: 1,
        benchmarkFailedAttempts: 0,
        confirmed: true,
      });
      assert.equal(result.exitCode, 0);
    }
    const result = await runBenchmarkFactorial(world.context());
    assert.ok(result.data);
    assert.equal(result.data.status, 'routing-unverified');
    assert.equal(result.data.missingArms.length, 0);
    const matrix = await runBenchmarkMatrix(world.context());
    assert.ok(matrix.data);
    assert.equal(matrix.data.overall.pairs, 0);
    assert.equal(matrix.data.factorial![0]!.status, 'routing-unverified');
  });
  it('rejects missing state ids, changed initial states and cross-project access', async () => {
    const world = fixture();
    assert.equal(
      (await runBenchmarkStart({ ...world.context(), benchmarkVariant: 'combined' })).exitCode,
      2,
    );
    await runBenchmarkStart({ ...world.context(), benchmarkStartingState: 'initial-commit' });
    assert.equal(
      (
        await runBenchmarkStart({
          ...world.context(),
          benchmarkVariant: 'compression-only',
          benchmarkStartingState: 'different',
        })
      ).exitCode,
      EXIT_CODES['precondition-drift'],
    );
    world.setProjectId('other');
    assert.equal((await runBenchmarkFactorial(world.context())).exitCode, 2);
  });
});
