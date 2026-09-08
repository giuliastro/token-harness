import {
  EXIT_CODES,
  TASK_CLASSES,
  allocateMixedWorkload,
  commandResult,
  diagnostic,
  estimateAcceptedTaskCapacity,
  harnessId,
  hydrateCandidateQualityFromBenchmarkReceipts,
  isTaskClass,
  serializeEnvelope,
  toEnvelope,
  type AcceptedTaskCapacityEstimate,
  type BudgetReport,
  type Diagnostic,
  type MixedWorkloadDemand,
  type MixedWorkloadQualityEvidence,
  type TaskBenchmarkReceipt,
  type TaskClass,
} from '@token-harness/core';

import type { ScheduleRuntime } from './schedule-main.js';
import { TOOL_VERSION } from './version.js';

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

interface MixedArgs {
  current: 'claude' | 'codex' | null;
  candidate: 'claude' | 'codex' | null;
  workload: MixedWorkloadDemand[] | null;
  candidateAvailable: boolean;
  json: boolean;
}

interface MixedScheduleReport {
  mode: 'mixed-workload';
  observedAt: string | null;
  workload: MixedWorkloadDemand[];
  decision: ReturnType<typeof allocateMixedWorkload>['decision'];
  requestedTasks: number;
  allocatedTasks: number;
  currentHarness: string;
  candidateHarness: string;
  allocations: ReturnType<typeof allocateMixedWorkload>['allocations'];
  currentUsage: ReturnType<typeof allocateMixedWorkload>['currentUsage'];
  candidateUsage: ReturnType<typeof allocateMixedWorkload>['candidateUsage'];
  reasons: ReturnType<typeof allocateMixedWorkload>['reasons'];
  evidence: {
    budget: 'observed' | 'unavailable' | 'failed' | 'not-configured';
    receipts: 'observed' | 'unavailable' | 'failed' | 'not-configured';
    currentCapacity: Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>>;
    candidateCapacity: Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>>;
    candidateQuality: Partial<Record<TaskClass, MixedWorkloadQualityEvidence>>;
  };
}

const MIXED_CONFLICT_FLAGS = new Set([
  '--task-class',
  '--tasks-left',
  '--current-five-hour',
  '--current-weekly',
  '--candidate-five-hour',
  '--candidate-weekly',
  '--candidate-quality',
  '--candidate-quality-task',
  '--candidate-quality-samples',
  '--handoff-file',
  '--handoff-bytes',
  '--max-handoff-bytes',
  '--transfer-benefit',
]);

function valueAt(
  argv: readonly string[],
  index: number,
): { value: string | null; consumed: number } {
  const token = argv[index] as string;
  const equals = token.indexOf('=');
  if (equals >= 0) {
    const value = token.slice(equals + 1);
    return { value: value.length > 0 ? value : null, consumed: 0 };
  }
  const next = argv[index + 1];
  if (next === undefined || next.startsWith('-')) return { value: null, consumed: 0 };
  return { value: next, consumed: 1 };
}

export function hasMixedWorkloadFlag(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--workload' || token.startsWith('--workload='));
}

export function parseMixedWorkloadSpec(value: string): MixedWorkloadDemand[] | null {
  if (value.trim() === '') return null;
  const demand: MixedWorkloadDemand[] = [];
  const seen = new Set<TaskClass>();
  let total = 0;
  for (const raw of value.split(',')) {
    const part = raw.trim();
    const equals = part.indexOf('=');
    if (equals <= 0 || part.indexOf('=', equals + 1) !== -1) return null;
    const taskClass = part.slice(0, equals).trim();
    const countText = part.slice(equals + 1).trim();
    if (!isTaskClass(taskClass) || seen.has(taskClass) || countText === '') return null;
    const count = Number(countText);
    if (!Number.isSafeInteger(count) || count <= 0) return null;
    total += count;
    if (!Number.isSafeInteger(total) || total > 10_000) return null;
    seen.add(taskClass);
    demand.push({ taskClass, count });
  }
  return demand.length > 0 ? demand : null;
}

function parse(argv: readonly string[]): { args: MixedArgs; diagnostics: Diagnostic[] } {
  const args: MixedArgs = {
    current: null,
    candidate: null,
    workload: null,
    candidateAvailable: true,
    json: argv.some((token) => token === '--json'),
  };
  const diagnostics: Diagnostic[] = [];
  let workloadSeen = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;

    if (name === '--json') continue;
    if (name === '--candidate-unavailable') {
      args.candidateAvailable = false;
      continue;
    }
    if (MIXED_CONFLICT_FLAGS.has(name)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'mixed-workload-conflicting-flag',
          message: `${name} cannot be combined with --workload`,
          remediation:
            'Use --workload for queued new-task allocation, or use the single-task schedule flags without --workload',
        }),
      );
      const parsed = valueAt(argv, index);
      index += parsed.consumed;
      continue;
    }
    if (name !== '--current' && name !== '--candidate' && name !== '--workload') {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'unknown-flag',
          message: `Unknown mixed-workload schedule flag ${JSON.stringify(name)}`,
          remediation: 'Run `token-harness schedule --help`',
        }),
      );
      continue;
    }

    const parsed = valueAt(argv, index);
    if (parsed.value === null) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'flag-missing-value',
          message: `The flag \`${name}\` requires a value`,
          remediation: `Pass a value after ${name}`,
        }),
      );
      continue;
    }
    index += parsed.consumed;

    if (name === '--current' || name === '--candidate') {
      if (parsed.value !== 'claude' && parsed.value !== 'codex') {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'invalid-schedule-harness',
            message: `${name} must be claude or codex`,
            remediation: `Use ${name} claude or ${name} codex`,
          }),
        );
      } else if (name === '--current') {
        args.current = parsed.value;
      } else {
        args.candidate = parsed.value;
      }
      continue;
    }

    if (workloadSeen) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'duplicate-workload',
          message: '--workload may be supplied only once',
          remediation: 'Put all task classes in one comma-separated --workload value',
        }),
      );
      continue;
    }
    workloadSeen = true;
    args.workload = parseMixedWorkloadSpec(parsed.value);
    if (args.workload === null) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'invalid-mixed-workload',
          message: `Workload ${JSON.stringify(parsed.value)} is not a valid class=count list`,
          remediation:
            'Use unique mechanical, standard, hard, or critical entries such as --workload mechanical=2,standard=3,hard=1 (maximum 10000 tasks)',
        }),
      );
    }
  }

  if (args.current === null || args.candidate === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'schedule-harnesses-required',
        message: 'Both --current and --candidate are required',
        remediation: 'Name Claude and Codex explicitly',
      }),
    );
  }
  if (!workloadSeen || args.workload === null) {
    if (!diagnostics.some((entry) => entry.code === 'invalid-mixed-workload')) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'mixed-workload-required',
          message: 'Mixed workload mode requires --workload',
          remediation: 'Use --workload mechanical=2,standard=3,hard=1',
        }),
      );
    }
  }
  return { args, diagnostics };
}

function capacityByClass(input: {
  report: BudgetReport;
  receipts: readonly TaskBenchmarkReceipt[];
  harness: 'claude' | 'codex';
  workload: readonly MixedWorkloadDemand[];
}): Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>> {
  const result: Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>> = {};
  for (const item of input.workload) {
    result[item.taskClass] = estimateAcceptedTaskCapacity({
      report: input.report,
      receipts: input.receipts,
      harnessId: harnessId(input.harness),
      taskClass: item.taskClass,
    });
  }
  return result;
}

function candidateQualityByClass(input: {
  current: 'claude' | 'codex';
  candidate: 'claude' | 'codex';
  workload: readonly MixedWorkloadDemand[];
  receipts: readonly TaskBenchmarkReceipt[];
}): Partial<Record<TaskClass, MixedWorkloadQualityEvidence>> {
  const result: Partial<Record<TaskClass, MixedWorkloadQualityEvidence>> = {};
  for (const item of input.workload) {
    const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(
      {
        taskClass: item.taskClass,
        current: {
          harnessId: harnessId(input.current),
          available: true,
          fiveHourPace: 'unknown',
          weeklyPace: 'unknown',
          quality: 'unknown',
          qualityTaskClass: null,
          qualitySamples: 0,
        },
        candidate: {
          harnessId: harnessId(input.candidate),
          available: true,
          fiveHourPace: 'unknown',
          weeklyPace: 'unknown',
          quality: 'unknown',
          qualityTaskClass: null,
          qualitySamples: 0,
        },
        transfer: { handoffBytes: 0, maxHandoffBytes: 1, benefit: 'unknown' },
      },
      input.receipts,
    );
    result[item.taskClass] = {
      state: hydrated.input.candidate.quality,
      samples: hydrated.input.candidate.qualitySamples,
    };
  }
  return result;
}

function render(report: MixedScheduleReport): string {
  const lines = [
    `Mixed-workload recommendation: ${report.decision}`,
    `Current: ${report.currentHarness}`,
    `Candidate: ${report.candidateHarness}`,
    `Requested: ${String(report.requestedTasks)} task(s)`,
    `Allocated: ${String(report.allocatedTasks)} task(s)`,
    `Budget evidence: ${report.evidence.budget}`,
    `Benchmark evidence: ${report.evidence.receipts}`,
    'Allocation:',
    ...report.allocations.map(
      (row) =>
        `- ${row.taskClass}: requested ${String(row.requested)}, current ${String(row.current)}, candidate ${String(row.candidate)}, unallocated ${String(row.unallocated)}`,
    ),
    'Shared allowance used by this allocation:',
    `- current: five-hour ${report.currentUsage.fiveHourUsedPercent.toFixed(2)}%, weekly ${report.currentUsage.weeklyUsedPercent.toFixed(2)}%`,
    `- candidate: five-hour ${report.candidateUsage.fiveHourUsedPercent.toFixed(2)}%, weekly ${report.candidateUsage.weeklyUsedPercent.toFixed(2)}%`,
    'Reasons:',
    ...report.reasons.map((entry) => `- ${entry.code}: ${entry.summary}`),
  ];
  return `${lines.join('\n')}\n`;
}

function emitUsageError(diagnostics: Diagnostic[], json: boolean, streams: Streams): number {
  const result = commandResult({
    command: 'schedule',
    exitCode: EXIT_CODES['usage-error'],
    diagnostics,
  });
  if (json) streams.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else for (const entry of diagnostics) streams.err(`${entry.code}: ${entry.message}\n`);
  return EXIT_CODES['usage-error'];
}

export async function scheduleMixedWorkloadMain(
  argv: readonly string[],
  streams?: Streams,
  runtime?: ScheduleRuntime,
): Promise<number> {
  const output =
    streams ??
    ({
      out: (text: string) => process.stdout.write(text),
      err: (text: string) => process.stderr.write(text),
    } satisfies Streams);
  const parsed = parse(argv);
  if (parsed.diagnostics.length > 0) {
    return emitUsageError(parsed.diagnostics, parsed.args.json, output);
  }

  const workload = parsed.args.workload!;
  let budget: BudgetReport | null = null;
  let receipts: readonly TaskBenchmarkReceipt[] | null = null;
  let budgetState: MixedScheduleReport['evidence']['budget'] =
    runtime?.observeBudget === undefined ? 'not-configured' : 'unavailable';
  let receiptsState: MixedScheduleReport['evidence']['receipts'] =
    runtime?.observeQualityReceipts === undefined ? 'not-configured' : 'unavailable';

  if (runtime?.observeBudget !== undefined) {
    try {
      budget = await runtime.observeBudget();
      budgetState = budget === null ? 'unavailable' : 'observed';
    } catch {
      budgetState = 'failed';
    }
  }
  if (runtime?.observeQualityReceipts !== undefined) {
    try {
      receipts = await runtime.observeQualityReceipts();
      receiptsState = receipts === null ? 'unavailable' : 'observed';
    } catch {
      receiptsState = 'failed';
    }
  }

  const currentCapacity =
    budget !== null && receipts !== null
      ? capacityByClass({
          report: budget,
          receipts,
          harness: parsed.args.current!,
          workload,
        })
      : {};
  const candidateCapacity =
    budget !== null && receipts !== null
      ? capacityByClass({
          report: budget,
          receipts,
          harness: parsed.args.candidate!,
          workload,
        })
      : {};
  const candidateQuality =
    receipts === null
      ? {}
      : candidateQualityByClass({
          current: parsed.args.current!,
          candidate: parsed.args.candidate!,
          workload,
          receipts,
        });

  const decision = allocateMixedWorkload({
    demand: workload,
    current: {
      harnessId: harnessId(parsed.args.current!),
      available: true,
      capacities: currentCapacity,
    },
    candidate: {
      harnessId: harnessId(parsed.args.candidate!),
      available: parsed.args.candidateAvailable,
      capacities: candidateCapacity,
      quality: candidateQuality,
    },
  });
  const report: MixedScheduleReport = {
    mode: 'mixed-workload',
    observedAt: budget?.observedAt ?? null,
    workload,
    ...decision,
    evidence: {
      budget: budgetState,
      receipts: receiptsState,
      currentCapacity,
      candidateCapacity,
      candidateQuality,
    },
  };
  const result = commandResult({ command: 'schedule', exitCode: EXIT_CODES.ok, data: report });
  if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else output.out(render(report));
  return EXIT_CODES.ok;
}
