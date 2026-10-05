import {
  EXIT_CODES,
  UNATTRIBUTED_PROJECT_ID,
  FACTORIAL_BENCHMARK_ARMS,
  buildTaskBenchmarkFactorialReport,
  commandResult,
  diagnostic,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  sameQualityGateEvidence,
  type TaskBenchmarkFactorialArm,
  type TaskBenchmarkFactorialReport,
  type TaskBenchmarkReceipt,
  type CommandResult,
} from '@token-harness/core';
import type { CommandContext } from './context.js';

async function read(context: CommandContext, path: string): Promise<unknown | null> {
  if (context.adapters === null) return null;
  try {
    const stat = await context.adapters.fs.stat(path);
    if (stat?.kind !== 'file') return null;
    return JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
  } catch {
    return null;
  }
}

/** Project-local only. Factorial state never enters legacy paired policy learning. */
export async function readFactorialBenchmark(
  context: CommandContext,
  id: string,
): Promise<TaskBenchmarkFactorialReport | null> {
  if (context.adapters === null || context.stateRoot === null || !isTaskBenchmarkId(id))
    return null;
  const { fs } = context.adapters;
  const directory = fs.join(context.stateRoot, 'benchmarks', id);
  const artifacts = await Promise.all(
    FACTORIAL_BENCHMARK_ARMS.map(async (arm) => ({
      arm,
      capture: await read(context, fs.join(directory, `${arm}.capture.json`)),
      receipt: await read(context, fs.join(directory, `${arm}.json`)),
    })),
  );
  if (
    !artifacts.some(
      ({ capture }) => capture !== null && typeof capture === 'object' && 'experiment' in capture,
    )
  )
    return null;
  const receipts: Partial<Record<TaskBenchmarkFactorialArm, TaskBenchmarkReceipt>> = {};
  const invalid: string[] = [];
  for (const artifact of artifacts) {
    if (artifact.capture === null) {
      if (artifact.receipt !== null)
        invalid.push(`${artifact.arm} receipt has no project-bound capture`);
      continue;
    }
    const capture = parseTaskBenchmarkCapture(artifact.capture);
    if (
      !capture.ok ||
      capture.capture.experiment === undefined ||
      capture.capture.variant !== artifact.arm ||
      capture.capture.benchmarkId !== id
    ) {
      invalid.push(`${artifact.arm} capture is malformed or has a conflicting experiment identity`);
      continue;
    }
    const c = capture.capture;
    if (
      c.projectId !== context.adapters.projectIdFor(context.projectRoot) ||
      (context.harness !== null && c.harnessId !== context.harness) ||
      (context.taskClass != null && c.taskClass !== context.taskClass)
    )
      return null;
    if (artifact.receipt === null) continue;
    const parsed = parseTaskBenchmarkReceipt(artifact.receipt);
    if (!parsed.ok) {
      invalid.push(`${artifact.arm} receipt is malformed`);
      continue;
    }
    const r = parsed.receipt;
    const expectedGate =
      c.qualityCheck === undefined
        ? undefined
        : {
            source: 'check-command' as const,
            check: c.qualityCheck,
            exitCode: null,
            signal: null,
            failureReason: null,
            durationMs: 0,
            output: null,
            userRecordedQuality: null,
          };
    if (
      r.variant !== artifact.arm ||
      r.benchmarkId !== id ||
      r.harnessId !== c.harnessId ||
      r.taskClass !== c.taskClass ||
      r.startedAt !== c.startedAt ||
      r.model !== c.model ||
      r.reasoningEffort !== c.reasoningEffort ||
      r.verbosity !== c.verbosity ||
      JSON.stringify(r.experiment) !== JSON.stringify(c.experiment) ||
      !sameQualityGateEvidence(expectedGate, r.outcome.qualityEvidence)
    ) {
      invalid.push(`${artifact.arm} receipt does not match its saved capture`);
      continue;
    }
    receipts[artifact.arm] = r;
  }
  const report = buildTaskBenchmarkFactorialReport(id, receipts);
  if (
    artifacts.some((a) => {
      const c = parseTaskBenchmarkCapture(a.capture);
      return c.ok && c.capture.experiment?.configuration !== undefined;
    })
  ) {
    report.configurationEvidence = 'managed-config-only';
    report.reasons[0] =
      'Prepared arms carry config-only evidence; runtime compression and the task starting tree remain unverified.';
  }
  if (invalid.length > 0) {
    report.status = 'incomparable';
    report.effects = [];
    report.reasons.push(...invalid);
  }
  return report;
}

export async function runBenchmarkFactorial(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkFactorialReport | null>> {
  if (context.adapters === null || context.stateRoot === null)
    return commandResult({
      command: 'benchmark-factorial',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-factorial-state-unavailable',
          message: 'Local benchmark state is unavailable',
          remediation: 'Run in a supported local environment',
        }),
      ],
    });
  if (context.adapters.projectIdFor(context.projectRoot) === UNATTRIBUTED_PROJECT_ID)
    return commandResult({
      command: 'benchmark-factorial',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-factorial-project-unattributed',
          message: 'The current project lacks a stable local identity',
          remediation: 'Repair project-id initialization before reporting experiments',
        }),
      ],
    });
  const id = context.benchmarkId;
  if (id == null || !isTaskBenchmarkId(id))
    return commandResult({
      command: 'benchmark-factorial',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-factorial-id-required',
          message: 'A safe benchmark id is required',
          remediation: 'Use benchmark-factorial --benchmark-id <id>',
        }),
      ],
    });
  const report = await readFactorialBenchmark(context, id);
  if (report === null)
    return commandResult({
      command: 'benchmark-factorial',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-factorial-not-found',
          message: 'No matching factorial capture belongs to this project and selection',
          remediation: 'Start four arms with the same --benchmark-id and --starting-state',
        }),
      ],
    });
  return commandResult({ command: 'benchmark-factorial', exitCode: EXIT_CODES.ok, data: report });
}
