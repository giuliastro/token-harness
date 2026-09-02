/**
 * Two-phase benchmark receipt capture.
 *
 * These commands never execute a coding task and never mutate harness configuration. They only
 * persist measurement state under Token Harness's own state root: start snapshots current
 * quota/policy; finish snapshots quota again and closes a quality-gated receipt.
 */

import {
  EXIT_CODES,
  TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
  commandResult,
  completeTaskBenchmarkCapture,
  deriveTaskLocalUsage,
  diagnostic,
  harnessId,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  snapshotTaskLocalSessions,
  type CommandResult,
  type HarnessId,
  type TaskBenchmarkCapture,
  type TaskBenchmarkCaptureFinishReport,
  type TaskBenchmarkCaptureStartReport,
} from '@token-harness/core';

import { runBudget } from './budget.js';
import type { CommandContext } from './context.js';
import { runContext } from './context-cost.js';
import { runHistory } from './history.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const CAPTURE_HARNESSES = new Set<HarnessId>([CLAUDE, CODEX]);

function statePaths(
  context: CommandContext,
  benchmarkId: string,
  variant: 'baseline' | 'optimized',
): { capturePath: string; receiptPath: string } | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  const directory = context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId);
  return {
    capturePath: context.adapters.fs.join(directory, `${variant}.capture.json`),
    receiptPath: context.adapters.fs.join(directory, `${variant}.json`),
  };
}

function fixedContext(
  context: CommandContext,
  harness: HarnessId,
  observedAt: string,
): CommandContext {
  return {
    ...context,
    harness,
    now: () => observedAt,
  };
}

async function writeJson(context: CommandContext, path: string, value: unknown): Promise<boolean> {
  if (context.adapters === null) return false;
  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
    );
    return true;
  } catch {
    return false;
  }
}

async function readJson(context: CommandContext, path: string): Promise<unknown | null> {
  if (context.adapters === null) return null;
  try {
    const bytes = await context.adapters.fs.readFile(path);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return null;
  }
}

export async function runBenchmarkStart(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCaptureStartReport | null>> {
  const benchmarkId = context.benchmarkId ?? null;
  const variant = context.benchmarkVariant ?? null;
  const taskClass = context.taskClass ?? null;
  const harness = context.harness;

  if (benchmarkId === null || variant === null || taskClass === null || harness === null) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-start-inputs-required',
          message: 'Benchmark start requires --benchmark-id, --variant, --task and --harness',
          remediation:
            'Pass an id, baseline|optimized, task class, and either --harness claude or codex',
        }),
      ],
    });
  }

  if (!isTaskBenchmarkId(benchmarkId)) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'invalid-benchmark-id',
          message: 'Benchmark id is not a safe local state identifier',
          remediation: 'Use 1-64 lowercase letters, digits, dot, underscore, or hyphen',
        }),
      ],
    });
  }

  if (!CAPTURE_HARNESSES.has(harness)) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-harness-unsupported',
          subject: harness,
          message: 'Benchmark receipt capture currently targets Claude Code and Codex',
          remediation: 'Use --harness claude or --harness codex',
        }),
      ],
    });
  }

  const paths = statePaths(context, benchmarkId, variant);
  if (paths === null || context.adapters === null) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-state-unavailable',
          message: 'Token Harness state storage is unavailable for benchmark capture',
          remediation: 'Run in a supported local environment with a resolved state directory',
        }),
      ],
    });
  }

  if (
    (await context.adapters.fs.stat(paths.capturePath)) !== null ||
    (await context.adapters.fs.stat(paths.receiptPath)) !== null
  ) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-capture-exists',
          message: `A ${variant} capture or receipt already exists for benchmark ${benchmarkId}`,
          path: paths.capturePath,
          remediation: 'Use a new benchmark id instead of overwriting existing measurement state',
        }),
      ],
    });
  }

  const projectId = context.adapters.projectIdFor(context.projectRoot);
  if (projectId === 'p_unattributed') {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-project-unattributed',
          message: 'Benchmark capture cannot bind this task to a stable local project id',
          remediation: 'Repair Token Harness state/project-id initialization before benchmarking',
        }),
      ],
    });
  }

  const startedAt = context.now();
  const observedContext = fixedContext(context, harness, startedAt);
  const [budgetResult, contextResult, historyResult] = await Promise.all([
    runBudget(observedContext),
    runContext(observedContext),
    runHistory({ ...observedContext, since: '1d', until: null }),
  ]);
  const budget = budgetResult.data?.harnesses.find((item) => item.harnessId === harness);
  const policy = contextResult.data?.harnesses.find((item) => item.harnessId === harness);
  const localSessionsBefore =
    historyResult.data?.source.state === 'available'
      ? snapshotTaskLocalSessions(historyResult.data.sessions)
      : null;

  const capture: TaskBenchmarkCapture = {
    schemaVersion: TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
    benchmarkId,
    variant,
    taskClass,
    harnessId: harness,
    projectId,
    model: policy?.model ?? null,
    reasoningEffort: policy?.reasoningEffort ?? null,
    verbosity: policy?.verbosity ?? null,
    startedAt,
    usageBefore: budget?.windows ?? [],
    localSessionsBefore,
  };

  if (!(await writeJson(context, paths.capturePath, capture))) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-capture-write-failed',
          message: 'The benchmark capture could not be written to Token Harness state',
          path: paths.capturePath,
          remediation: 'Check state-directory permissions and retry with a new benchmark id',
        }),
      ],
    });
  }

  return commandResult({
    command: 'benchmark-start',
    exitCode: EXIT_CODES.ok,
    data: { capture, capturePath: paths.capturePath },
    diagnostics: [...budgetResult.diagnostics, ...contextResult.diagnostics, ...historyResult.diagnostics],
  });
}

export async function runBenchmarkFinish(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCaptureFinishReport | null>> {
  const benchmarkId = context.benchmarkId ?? null;
  const variant = context.benchmarkVariant ?? null;
  const qualityGate = context.benchmarkQuality ?? null;
  const attempts = context.benchmarkAttempts ?? null;
  const failedAttempts = context.benchmarkFailedAttempts ?? null;

  if (
    benchmarkId === null ||
    variant === null ||
    qualityGate === null ||
    attempts === null ||
    failedAttempts === null
  ) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-finish-inputs-required',
          message:
            'Benchmark finish requires --benchmark-id, --variant, --quality, --attempts and --failed-attempts',
          remediation:
            'Finish the same baseline|optimized capture with an explicit passed|failed quality gate and attempt counts',
        }),
      ],
    });
  }

  if (!isTaskBenchmarkId(benchmarkId) || qualityGate === 'unknown') {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: !isTaskBenchmarkId(benchmarkId)
            ? 'invalid-benchmark-id'
            : 'invalid-benchmark-quality',
          message: !isTaskBenchmarkId(benchmarkId)
            ? 'Benchmark id is not a safe local state identifier'
            : 'Benchmark finish requires a passed or failed quality gate',
          remediation: !isTaskBenchmarkId(benchmarkId)
            ? 'Use the same safe benchmark id passed to benchmark-start'
            : 'Apply the benchmark quality gate and pass --quality passed or --quality failed',
        }),
      ],
    });
  }

  if (failedAttempts > attempts) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-failed-attempts-exceed-attempts',
          message: 'Failed attempts cannot exceed total attempts',
          remediation: 'Correct --attempts or --failed-attempts and retry',
        }),
      ],
    });
  }

  const paths = statePaths(context, benchmarkId, variant);
  if (paths === null || context.adapters === null) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-state-unavailable',
          message: 'Token Harness state storage is unavailable for benchmark capture',
          remediation: 'Run in the same supported local environment used for benchmark-start',
        }),
      ],
    });
  }

  if ((await context.adapters.fs.stat(paths.receiptPath)) !== null) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-receipt-exists',
          message: `The ${variant} receipt for benchmark ${benchmarkId} already exists`,
          path: paths.receiptPath,
          remediation: 'Keep the existing receipt immutable and use a new benchmark id for a rerun',
        }),
      ],
    });
  }

  const captureStat = await context.adapters.fs.stat(paths.capturePath);
  if (captureStat === null || captureStat.kind !== 'file') {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-capture-missing',
          message: `No ${variant} benchmark capture exists for ${benchmarkId}`,
          path: paths.capturePath,
          remediation: 'Run benchmark-start before finishing this variant',
        }),
      ],
    });
  }

  const rawCapture = await readJson(context, paths.capturePath);
  const parsed = parseTaskBenchmarkCapture(rawCapture);
  if (!parsed.ok) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-capture-invalid',
          message: `The saved benchmark capture is invalid: ${parsed.message}`,
          path: paths.capturePath,
          remediation: 'Keep the invalid capture for inspection and start a new benchmark id',
        }),
      ],
    });
  }

  const projectId = context.adapters.projectIdFor(context.projectRoot);
  if (parsed.capture.projectId !== projectId) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-project-changed',
          message: 'Benchmark finish is running against a different project than benchmark-start',
          remediation: 'Return to the original project or start a new benchmark id',
        }),
      ],
    });
  }

  const completedAt = context.now();
  const completedContext = fixedContext(context, parsed.capture.harnessId, completedAt);
  const [budgetResult, historyResult] = await Promise.all([
    runBudget(completedContext),
    runHistory({ ...completedContext, since: '1d', until: null }),
  ]);
  const budget = budgetResult.data?.harnesses.find(
    (item) => item.harnessId === parsed.capture.harnessId,
  );
  const localUsage =
    parsed.capture.localSessionsBefore !== null &&
    historyResult.data?.source.state === 'available'
      ? deriveTaskLocalUsage(
          parsed.capture.localSessionsBefore,
          snapshotTaskLocalSessions(historyResult.data.sessions),
          parsed.capture.startedAt,
          completedAt,
        )
      : null;

  const completed = completeTaskBenchmarkCapture(parsed.capture, {
    completedAt,
    usageAfter: budget?.windows ?? [],
    qualityGate,
    attempts,
    failedAttempts,
    localUsage,
  });
  if (!completed.ok) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['precondition-drift'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-receipt-invalid',
          message: `The benchmark receipt could not be finalized: ${completed.message}`,
          path: paths.capturePath,
          remediation: 'Inspect the capture timing and attempt counts before retrying',
        }),
      ],
    });
  }

  if (!(await writeJson(context, paths.receiptPath, completed.receipt))) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-receipt-write-failed',
          message: 'The completed benchmark receipt could not be written to Token Harness state',
          path: paths.receiptPath,
          remediation: 'Check state-directory permissions; the start capture remains intact',
        }),
      ],
    });
  }

  return commandResult({
    command: 'benchmark-finish',
    exitCode: EXIT_CODES.ok,
    data: {
      receipt: completed.receipt,
      capturePath: paths.capturePath,
      receiptPath: paths.receiptPath,
    },
    diagnostics: [...budgetResult.diagnostics, ...historyResult.diagnostics],
  });
}
