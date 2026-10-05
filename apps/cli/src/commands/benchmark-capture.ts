/**
 * Two-phase benchmark receipt capture.
 *
 * Start snapshots current quota/policy; finish runs an explicitly approved saved check and
 * closes a quality-gated receipt. Manually controlled captures leave harness configuration alone.
 * A prepared arm is measured first, then its approved temporary configuration is restored through
 * the guarded recovery controller. Neither command runs the coding task itself.
 */

import {
  EXIT_CODES,
  FACTORIAL_BENCHMARK_ARMS,
  factorialExperimentForArm,
  parseTaskBenchmarkCheck,
  qualityFromCheckOutcome,
  sameQualityGateEvidence,
  mutationLeaseDiagnostics,
  readMutationLease,
  type ProcessOutcome,
  type TaskBenchmarkVariant,
  type TaskBenchmarkQualityEvidence,
  type TaskQualityGate,
  TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
  commandResult,
  benchmarkPolicySnapshot,
  completeTaskBenchmarkCapture,
  deriveTaskLocalUsage,
  diagnostic,
  harnessId,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  snapshotTaskLocalSessions,
  taskBenchmarkContextSnapshot,
  type CommandResult,
  type HarnessId,
  type TaskBenchmarkCapture,
  type TaskBenchmarkCaptureFinishResult,
  type TaskBenchmarkCaptureStartReport,
} from '@token-harness/core';

import { runBudget } from './budget.js';
import type { CommandContext } from './context.js';
import { runContext } from './context-cost.js';
import { runHistory } from './history.js';
import { nativeRoutingObservationForBenchmark } from '../prompt-router.js';
import { readBenchmarkSession, restoreBenchmarkSession } from './benchmark-session.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');
const CAPTURE_HARNESSES = new Set<HarnessId>([CLAUDE, CODEX]);

function statePaths(
  context: CommandContext,
  benchmarkId: string,
  variant: TaskBenchmarkVariant,
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

async function writeImmutableJson(
  context: CommandContext,
  path: string,
  value: unknown,
): Promise<'written' | 'exists' | 'failed'> {
  if (context.adapters === null) return 'failed';
  try {
    const fs = context.adapters.fs;
    if (fs.writeFileExclusive !== undefined)
      return (await fs.writeFileExclusive(
        path,
        new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
      ))
        ? 'written'
        : 'exists';
    // Older injected ports retain compatibility; the shipped local port supplies exclusive creation.
    if ((await fs.stat(path)) !== null) return 'exists';
    return (await writeJson(context, path, value)) ? 'written' : 'failed';
  } catch {
    return 'failed';
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

  const startingState = context.benchmarkStartingState ?? null;
  const experiment =
    startingState === null ? null : factorialExperimentForArm(variant, startingState);
  if (experiment !== null && context.benchmarkPreparedConfiguration !== undefined)
    experiment.configuration = context.benchmarkPreparedConfiguration;
  const qualityCheck =
    context.benchmarkCheck == null ? null : parseTaskBenchmarkCheck(context.benchmarkCheck);
  if (
    (startingState !== null && experiment === null) ||
    (variant !== 'baseline' && variant !== 'optimized' && experiment === null) ||
    (experiment !== null && context.optimizationCandidate != null) ||
    (context.benchmarkCheck != null && qualityCheck === null)
  ) {
    return commandResult({
      command: 'benchmark-start',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'invalid-benchmark-experiment',
          message:
            'Factorial arms require --starting-state and cannot use a candidate campaign; check commands must be valid argv arrays',
          remediation:
            'Use baseline/compression-only/routing-only/combined with the same starting-state id, or baseline/optimized without it',
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

  const leaseDiagnostics = await mutationLeaseDiagnostics(
    context.adapters.fs,
    context.stateRoot!,
    context.benchmarkPreparedConfiguration?.transactionId ?? 'manual-benchmark',
  );
  if (leaseDiagnostics.length > 0)
    return commandResult({
      command: 'benchmark-start',
      exitCode: 5,
      data: null,
      diagnostics: leaseDiagnostics,
    });

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

  // Fix quality and design across every arm before observing or writing a new capture.
  for (const sibling of [...FACTORIAL_BENCHMARK_ARMS, 'optimized'] as const) {
    if (sibling === variant) continue;
    const siblingPath = statePaths(context, benchmarkId, sibling)!;
    const raw = await readJson(context, siblingPath.capturePath);
    if (raw === null) continue;
    const previous = parseTaskBenchmarkCapture(raw);
    const gate = (check: typeof qualityCheck) =>
      check == null
        ? undefined
        : {
            source: 'check-command' as const,
            check,
            exitCode: null,
            signal: null,
            failureReason: null,
            durationMs: 0,
            output: null,
            userRecordedQuality: null,
          };
    if (
      !previous.ok ||
      previous.capture.projectId !== projectId ||
      !sameQualityGateEvidence(gate(qualityCheck), gate(previous.capture.qualityCheck ?? null)) ||
      previous.capture.experiment?.startingState !== experiment?.startingState ||
      previous.capture.experiment?.configuration?.initialConfigurationId !==
        experiment?.configuration?.initialConfigurationId ||
      JSON.stringify(previous.capture.experiment?.configuration?.providers) !==
        JSON.stringify(experiment?.configuration?.providers) ||
      (experiment !== null &&
        (previous.capture.harnessId !== harness || previous.capture.taskClass !== taskClass)) ||
      (previous.capture.experiment === undefined) !== (experiment === null)
    ) {
      return commandResult({
        command: 'benchmark-start',
        exitCode: EXIT_CODES['precondition-drift'],
        data: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'benchmark-arm-identity-mismatch',
            message:
              'Existing arms use a different project, quality check or experiment design/starting state',
            remediation:
              'Use the same check and starting-state identity, or create a new benchmark id',
          }),
        ],
      });
    }
  }

  const startedAt = context.now();
  if (context.benchmarkValidateOnly)
    return commandResult({ command: 'benchmark-start', exitCode: 0, data: null });
  const observedContext = fixedContext(context, harness, startedAt);
  const [budgetResult, contextResult, historyResult] = await Promise.all([
    runBudget(observedContext),
    runContext(observedContext),
    runHistory({ ...observedContext, since: '1d', until: null }),
  ]);
  const nativeRoutingAtStart =
    context.adapters === null
      ? null
      : await nativeRoutingObservationForBenchmark({
          fs: context.adapters.fs,
          home: context.home,
          stateRoot: context.stateRoot,
          harness,
          version: null,
          runner: context.adapters.runner,
          facts: context.platform,
          paths: context.adapters.paths,
          projectRoot: context.projectRoot,
          projectId,
        });
  const budget = budgetResult.data?.harnesses.find((item) => item.harnessId === harness);
  const contextObservation = contextResult.data?.harnesses.find(
    (item) => item.harnessId === harness,
  );
  const policy = benchmarkPolicySnapshot(contextObservation);
  const contextAtStart = taskBenchmarkContextSnapshot(contextObservation);
  const localSessionsBefore =
    historyResult.data?.source.state === 'available'
      ? snapshotTaskLocalSessions(historyResult.data.sessions)
      : null;

  const capture: TaskBenchmarkCapture = {
    schemaVersion: TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
    ...(qualityCheck !== null ? { qualityCheck } : {}),
    ...(experiment !== null ? { experiment } : {}),
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
    contextAtStart,
    localSessionsBefore,
    nativeRoutingAtStart,
  };

  const captureWrite = await writeImmutableJson(context, paths.capturePath, capture);
  if (captureWrite !== 'written') {
    return commandResult({
      command: 'benchmark-start',
      exitCode:
        captureWrite === 'exists'
          ? EXIT_CODES['precondition-drift']
          : EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code:
            captureWrite === 'exists'
              ? 'benchmark-capture-exists'
              : 'benchmark-capture-write-failed',
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
    diagnostics: [
      ...budgetResult.diagnostics,
      ...contextResult.diagnostics,
      ...historyResult.diagnostics,
    ],
  });
}

async function recordBenchmarkFinish(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCaptureFinishResult | null>> {
  const benchmarkId = context.benchmarkId ?? null;
  const variant = context.benchmarkVariant ?? null;
  const qualityGate = context.benchmarkQuality ?? null;
  const attempts = context.benchmarkAttempts ?? null;
  const failedAttempts = context.benchmarkFailedAttempts ?? null;

  if (benchmarkId === null || variant === null || attempts === null || failedAttempts === null) {
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

  if (
    !Number.isSafeInteger(attempts) ||
    attempts < 1 ||
    !Number.isSafeInteger(failedAttempts) ||
    failedAttempts < 0 ||
    failedAttempts > attempts
  ) {
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

  if (qualityGate === 'passed' && failedAttempts === attempts) {
    const savedPaths = statePaths(context, benchmarkId, variant);
    const saved = parseTaskBenchmarkCapture(
      savedPaths === null ? null : await readJson(context, savedPaths.capturePath),
    );
    if (!saved.ok || saved.capture.qualityCheck === undefined)
      return commandResult({
        command: 'benchmark-finish',
        exitCode: EXIT_CODES['usage-error'],
        data: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'benchmark-passed-without-successful-attempt',
            message: 'A passed task must include at least one successful attempt',
            remediation: 'Correct the quality gate or attempt counts before finishing this capture',
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

  if (context.benchmarkCheck != null || context.benchmarkStartingState != null) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-check-fixed',
          message: 'The saved capture fixes the check and experiment identity',
          remediation: 'Do not supply start-only options to benchmark-finish',
        }),
      ],
    });
  }
  const check = parsed.capture.qualityCheck;
  if (check === undefined && qualityGate === null) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-finish-inputs-required',
          message: 'A manual capture requires --quality passed or failed',
          remediation: 'Apply the chosen acceptance checks and record their actual result',
        }),
      ],
    });
  }
  if (check !== undefined && !context.confirmed) {
    const nextCommand = `token-harness benchmark-finish --benchmark-id ${benchmarkId} --variant ${variant} --attempts ${attempts} --failed-attempts ${failedAttempts}${qualityGate === null ? '' : ` --quality ${qualityGate}`} --yes`;
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES.ok,
      data: {
        status: 'check-planned',
        benchmarkId,
        variant,
        check,
        cwd: context.projectRoot,
        checkExecuted: false,
        receiptFinalized: false,
        nextCommand,
      },
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'benchmark-check-plan',
          message: `Check plan: ${JSON.stringify(check)} in ${context.projectRoot}. No check was executed and no receipt was finalized.`,
          remediation: `Review this command, then run ${nextCommand}`,
        }),
      ],
    });
  }
  let effectiveQuality: TaskQualityGate = qualityGate ?? 'unknown';
  let qualityEvidence: TaskBenchmarkQualityEvidence = { source: 'user-recorded' };
  const checkDiagnostics = [];
  let checkOutputTail: { stdout: string; stderr: string } | null = null;
  if (check !== undefined) {
    let result: Pick<
      ProcessOutcome,
      'exitCode' | 'signal' | 'timedOut' | 'failure' | 'durationMs' | 'outputEvidence'
    >;
    try {
      result = await context.adapters.runner.run({
        executable: check.executable,
        args: check.args,
        cwd: context.projectRoot,
        timeoutMs: check.timeoutMs,
        maxOutputBytes: 8192,
        captureOutputEvidence: true,
      });
    } catch {
      // A throwing runner is a failed start, never a successful gate. Do not persist its raw exception.
      result = {
        exitCode: null,
        signal: null,
        timedOut: false,
        failure: { reason: 'spawn-failed' as const, message: 'Check runner failed' },
        durationMs: 0,
      };
    }
    effectiveQuality = qualityFromCheckOutcome(result);
    const output = result.outputEvidence;
    qualityEvidence = {
      source: 'check-command',
      check,
      exitCode: result.exitCode,
      signal: result.signal,
      failureReason: result.failure?.reason ?? null,
      durationMs: result.durationMs,
      userRecordedQuality: qualityGate,
      output:
        output === undefined
          ? null
          : {
              stdout: { sha256: output.stdout.sha256, bytes: output.stdout.bytes },
              stderr: { sha256: output.stderr.sha256, bytes: output.stderr.bytes },
            },
    };
    if (output !== undefined) {
      checkOutputTail = { stdout: output.stdout.tail, stderr: output.stderr.tail };
    } else if (result.failure === null) {
      checkDiagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'benchmark-check-output-witness-unavailable',
          message: 'The check exit result is known but its full-output hash is unavailable',
          remediation: 'Use a process runner with full-output evidence support',
        }),
      );
    }
    if (qualityGate !== null && qualityGate !== effectiveQuality)
      checkDiagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'benchmark-check-quality-mismatch',
          message: `User recorded ${qualityGate}; the direct check produced ${effectiveQuality}. The check result wins.`,
          remediation: 'Inspect the saved check and local output tail',
        }),
      );
  }
  if (effectiveQuality === 'passed' && failedAttempts === attempts) {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-passed-without-successful-attempt',
          message: 'A passed task must include at least one successful coding attempt',
          remediation: 'Correct the attempt counts',
        }),
      ],
    });
  }

  const completedAt = context.now();
  const completedContext = fixedContext(context, parsed.capture.harnessId, completedAt);
  const [budgetResult, contextResult, historyResult] = await Promise.all([
    runBudget(completedContext),
    runContext(completedContext),
    runHistory({ ...completedContext, since: '1d', until: null }),
  ]);
  const nativeRoutingAtFinish =
    context.adapters === null
      ? null
      : await nativeRoutingObservationForBenchmark({
          fs: context.adapters.fs,
          home: context.home,
          stateRoot: context.stateRoot,
          harness: parsed.capture.harnessId,
          version: null,
          runner: context.adapters.runner,
          facts: context.platform,
          paths: context.adapters.paths,
          projectRoot: context.projectRoot,
          projectId,
          startedAt: parsed.capture.startedAt,
        });
  const budget = budgetResult.data?.harnesses.find(
    (item) => item.harnessId === parsed.capture.harnessId,
  );
  const localUsage =
    parsed.capture.localSessionsBefore !== null && historyResult.data?.source.state === 'available'
      ? deriveTaskLocalUsage(
          parsed.capture.localSessionsBefore,
          snapshotTaskLocalSessions(historyResult.data.sessions),
          parsed.capture.startedAt,
          completedAt,
        )
      : null;

  const finishContextObservation = contextResult.data?.harnesses.find(
    (item) => item.harnessId === parsed.capture.harnessId,
  );
  const completed = completeTaskBenchmarkCapture(parsed.capture, {
    completedAt,
    usageAfter: budget?.windows ?? [],
    qualityGate: effectiveQuality,
    qualityEvidence,
    attempts,
    failedAttempts,
    localUsage,
    contextAtFinish: taskBenchmarkContextSnapshot(finishContextObservation),
    policyAtFinish: benchmarkPolicySnapshot(finishContextObservation),
    nativeRoutingAtFinish,
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

  const receiptWrite = await writeImmutableJson(context, paths.receiptPath, completed.receipt);
  if (receiptWrite !== 'written') {
    return commandResult({
      command: 'benchmark-finish',
      exitCode:
        receiptWrite === 'exists'
          ? EXIT_CODES['precondition-drift']
          : EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code:
            receiptWrite === 'exists'
              ? 'benchmark-receipt-exists'
              : 'benchmark-receipt-write-failed',
          message: 'The completed benchmark receipt could not be written to Token Harness state',
          path: paths.receiptPath,
          remediation: 'Check state-directory permissions; the start capture remains intact',
        }),
      ],
    });
  }

  if (checkOutputTail !== null) {
    const sidecarPath = context.adapters.fs.join(
      context.adapters.fs.dirname(paths.receiptPath),
      `${variant}.check-output.json`,
    );
    if (
      !(await writeJson(context, sidecarPath, {
        schemaVersion: 1,
        stdout: checkOutputTail.stdout,
        stderr: checkOutputTail.stderr,
      }))
    )
      checkDiagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'benchmark-check-tail-unavailable',
          message: 'The check result was recorded but its local output tail could not be saved',
          remediation: 'Inspect check output locally if needed',
        }),
      );
  }

  return commandResult({
    command: 'benchmark-finish',
    exitCode: EXIT_CODES.ok,
    data: {
      receipt: completed.receipt,
      capturePath: paths.capturePath,
      receiptPath: paths.receiptPath,
    },
    diagnostics: [
      ...checkDiagnostics,
      ...budgetResult.diagnostics,
      ...historyResult.diagnostics,
      ...contextResult.diagnostics,
    ],
  });
}

/** A prepared arm approves cleanup at prepare time; measure before restoring it. */
export async function runBenchmarkFinish(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkCaptureFinishResult | null>> {
  if (context.adapters === null || context.stateRoot === null)
    return recordBenchmarkFinish(context);
  let session: Awaited<ReturnType<typeof readBenchmarkSession>> = null;
  try {
    const lease = await readMutationLease(context.adapters.fs, context.stateRoot);
    if (lease !== null) {
      if (
        lease.benchmarkId !== context.benchmarkId ||
        lease.variant !== context.benchmarkVariant ||
        lease.projectId !== context.adapters.projectIdFor(context.projectRoot)
      )
        return commandResult({
          command: 'benchmark-finish',
          exitCode: 5,
          data: null,
          diagnostics: await mutationLeaseDiagnostics(
            context.adapters.fs,
            context.stateRoot,
            'other-benchmark',
          ),
        });
      session = await readBenchmarkSession(context, lease.benchmarkId, lease.variant);
      if (
        session === null ||
        session.transactionId !== lease.transactionId ||
        session.status !== 'ready'
      )
        throw new Error('The prepared arm is not ready');
    } else if (
      context.benchmarkId != null &&
      isTaskBenchmarkId(context.benchmarkId) &&
      context.benchmarkVariant != null &&
      (FACTORIAL_BENCHMARK_ARMS as readonly string[]).includes(context.benchmarkVariant)
    ) {
      const saved = await readBenchmarkSession(
        context,
        context.benchmarkId,
        context.benchmarkVariant,
      );
      if (saved !== null && saved.status !== 'restored')
        throw new Error('The prepared arm lost its lease');
      if (
        saved?.status === 'restored' &&
        (await context.adapters.fs.stat(
          statePaths(context, context.benchmarkId, context.benchmarkVariant)!.receiptPath,
        )) === null
      )
        throw new Error('This arm was cancelled and restored before a receipt was recorded');
    }
  } catch {
    return commandResult({
      command: 'benchmark-finish',
      exitCode: 5,
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-session-not-ready',
          message: 'The prepared configuration cannot be measured safely',
          remediation: 'Inspect the checkpoint and use benchmark-restore before another arm',
        }),
      ],
    });
  }
  let result: CommandResult<TaskBenchmarkCaptureFinishResult | null>;
  if (session !== null) {
    const safety = await restoreBenchmarkSession({ ...context, confirmed: false }, session);
    if (safety.exitCode !== 0)
      return commandResult({
        command: 'benchmark-finish',
        exitCode: 5,
        data: null,
        diagnostics: safety.diagnostics,
      });
  }
  try {
    result = await recordBenchmarkFinish(context);
  } catch {
    result = commandResult({
      command: 'benchmark-finish',
      exitCode: 1,
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-finish-failed',
          message: 'Benchmark recording failed',
          remediation: 'Inspect the preserved capture and diagnostics',
        }),
      ],
    });
  }
  if (session === null || result.diagnostics.some((d) => d.code === 'benchmark-check-plan'))
    return result;
  // Only the invocation that creates the immutable receipt owns finish-time cleanup. A concurrent
  // loser must not race its configuration restoration; interrupted cleanup has an explicit command.
  if (result.diagnostics.some((d) => d.code === 'benchmark-receipt-exists'))
    return {
      ...result,
      diagnostics: [
        ...result.diagnostics,
        diagnostic({
          severity: 'info',
          code: 'benchmark-restoration-pending',
          message:
            'The receipt is already finalized; recover separately if configuration restoration is still pending',
          remediation: `Run benchmark-restore --benchmark-id ${session.benchmarkId} --variant ${session.variant} --yes`,
        }),
      ],
    };
  const restoration = await restoreBenchmarkSession({ ...context, confirmed: true }, session);
  if (restoration.exitCode !== 0)
    return commandResult({
      command: 'benchmark-finish',
      exitCode: 7,
      data: null,
      diagnostics: [
        ...result.diagnostics,
        ...restoration.diagnostics,
        diagnostic({
          severity: 'error',
          code: 'benchmark-recovery-required',
          message: `Temporary configuration for ${session.transactionId} remains; a recorded receipt, if present, is preserved`,
          path: statePaths(context, session.benchmarkId, session.variant as TaskBenchmarkVariant)!
            .receiptPath,
          remediation: `Run benchmark-restore --benchmark-id ${session.benchmarkId} --variant ${session.variant} --yes after resolving configuration drift`,
        }),
      ],
    });
  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      diagnostic({
        severity: 'info',
        code: 'benchmark-configuration-restored',
        message: 'Original configuration and file absence were verified after restoration',
        remediation: null,
      }),
    ],
  };
}
