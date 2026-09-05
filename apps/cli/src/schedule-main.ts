import {
  EXIT_CODES,
  commandResult,
  diagnostic,
  harnessId,
  hydrateCandidateQualityFromBenchmarkReceipts,
  hydrateCrossHarnessPaceFromBudget,
  hydrateTransferBenefitFromReceipts,
  isTaskClass,
  scheduleCrossHarness,
  serializeEnvelope,
  toEnvelope,
  type BudgetReport,
  type CrossHarnessSchedulerDecision,
  type CrossHarnessSchedulerInput,
  type CrossHarnessTransferReceipt,
  type Diagnostic,
  type PaceState,
  type QualityEvidenceState,
  type SchedulerPaceEvidenceNote,
  type SchedulerQualityEvidenceNote,
  type SchedulerTransferEvidenceNote,
  type TaskBenchmarkReceipt,
  type TransferBenefitState,
} from '@token-harness/core';

import { TOOL_VERSION } from './version.js';

const DEFAULT_MAX_HANDOFF_BYTES = 2048;
const PACE_STATES = new Set<PaceState>(['under-pace', 'on-pace', 'over-pace', 'unknown']);
const QUALITY_STATES = new Set<QualityEvidenceState>(['passed', 'failed', 'unknown']);
const BENEFIT_STATES = new Set<TransferBenefitState>([
  'proven-positive',
  'non-positive',
  'unknown',
]);

const HELP = `token-harness schedule — evaluate a Claude Code ↔ Codex switch conservatively

Usage
  token-harness schedule --current <claude|codex> --candidate <claude|codex> --task-class <class> [evidence flags]

Evidence flags
  --current-five-hour <under-pace|on-pace|over-pace|unknown>    default: unknown
  --current-weekly <under-pace|on-pace|over-pace|unknown>       default: unknown
  --candidate-five-hour <under-pace|on-pace|over-pace|unknown>  default: unknown
  --candidate-weekly <under-pace|on-pace|over-pace|unknown>     default: unknown
  --candidate-quality <passed|failed|unknown>                   default: unknown
  --candidate-quality-task <mechanical|standard|hard|critical>
  --candidate-quality-samples <n>                               default: 0
  --candidate-unavailable                                      mark candidate unusable
  --handoff-bytes <n>                                          current handoff size, default: 0
  --max-handoff-bytes <n>                                      current handoff budget, default: 2048
  --transfer-benefit <proven-positive|non-positive|unknown>     default: unknown
  --json                                                       RFC 0006 JSON envelope
  --version                                                    print version and exit 0
  --help                                                       print help and exit 0

In the installed CLI, unknown five-hour/weekly pace fields are hydrated from the same live budget
observer used by token-harness budget. When candidate quality is not supplied, quality-gated local
benchmark receipts for the current project and exact task class are used conservatively. When
transfer benefit is not supplied, immutable transfer receipts for the current project, exact route,
and exact task class are used only when every attributable receipt agrees on one non-unknown verdict.
Any conflict or unknown receipt keeps transfer benefit unknown. Explicit evidence flags always win,
including an explicit unknown. Historical transfer receipts never overwrite the current handoff byte
estimate or budget. Transfer benefit is never inferred from tokens or raw provider quota percentages.
This command never launches a harness and never switches automatically. Missing evidence produces
insufficient-evidence rather than a guessed recommendation.`;

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

export interface ScheduleRuntime {
  observeBudget?: () => Promise<BudgetReport | null>;
  observeQualityReceipts?: () => Promise<readonly TaskBenchmarkReceipt[] | null>;
  observeTransferReceipts?: () => Promise<readonly CrossHarnessTransferReceipt[] | null>;
}

type BudgetEvidenceStatus =
  | 'not-configured'
  | 'not-needed'
  | 'observed'
  | 'no-usable-pace'
  | 'unavailable'
  | 'failed';

type QualityEvidenceStatus =
  | 'not-configured'
  | 'not-needed'
  | 'observed'
  | 'conflicting'
  | 'no-evidence'
  | 'unavailable'
  | 'failed';

type TransferEvidenceStatus =
  | 'not-configured'
  | 'not-needed'
  | 'observed'
  | 'conflicting'
  | 'inconclusive'
  | 'no-evidence'
  | 'unavailable'
  | 'failed';

interface ScheduleReport extends CrossHarnessSchedulerDecision {
  evidence: {
    current: { fiveHourPace: PaceState; weeklyPace: PaceState };
    candidate: {
      fiveHourPace: PaceState;
      weeklyPace: PaceState;
      quality: QualityEvidenceState;
      qualityTaskClass: string | null;
      qualitySamples: number;
    };
    transfer: {
      handoffBytes: number;
      maxHandoffBytes: number;
      benefit: TransferBenefitState;
    };
  };
  budgetEvidence: {
    status: BudgetEvidenceStatus;
    notes: SchedulerPaceEvidenceNote[];
  };
  qualityEvidence: {
    status: QualityEvidenceStatus;
    notes: SchedulerQualityEvidenceNote[];
  };
  transferEvidence: {
    status: TransferEvidenceStatus;
    notes: SchedulerTransferEvidenceNote[];
  };
}

interface Args {
  current: 'claude' | 'codex' | null;
  candidate: 'claude' | 'codex' | null;
  taskClass: string | null;
  currentFiveHour: PaceState;
  currentWeekly: PaceState;
  candidateFiveHour: PaceState;
  candidateWeekly: PaceState;
  candidateQuality: QualityEvidenceState;
  candidateQualityTask: string | null;
  candidateQualitySamples: number;
  qualityExplicit: boolean;
  candidateAvailable: boolean;
  handoffBytes: number;
  maxHandoffBytes: number;
  transferBenefit: TransferBenefitState;
  transferExplicit: boolean;
  json: boolean;
  help: boolean;
  version: boolean;
}

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

function parseInteger(
  name: string,
  value: string,
  minimum: number,
  diagnostics: Diagnostic[],
): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'invalid-schedule-number',
        message: `${name} must be an integer >= ${minimum}`,
        remediation: `Pass ${name} with a valid integer`,
      }),
    );
    return null;
  }
  return parsed;
}

function parse(argv: readonly string[]): { args: Args; diagnostics: Diagnostic[] } {
  const args: Args = {
    current: null,
    candidate: null,
    taskClass: null,
    currentFiveHour: 'unknown',
    currentWeekly: 'unknown',
    candidateFiveHour: 'unknown',
    candidateWeekly: 'unknown',
    candidateQuality: 'unknown',
    candidateQualityTask: null,
    candidateQualitySamples: 0,
    qualityExplicit: false,
    candidateAvailable: true,
    handoffBytes: 0,
    maxHandoffBytes: DEFAULT_MAX_HANDOFF_BYTES,
    transferBenefit: 'unknown',
    transferExplicit: false,
    json: false,
    help: false,
    version: false,
  };
  const diagnostics: Diagnostic[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;
    const equals = token.indexOf('=');
    const name = equals >= 0 ? token.slice(0, equals) : token;

    if (name === '--help') {
      args.help = true;
      continue;
    }
    if (name === '--version') {
      args.version = true;
      continue;
    }
    if (name === '--json') {
      args.json = true;
      continue;
    }
    if (name === '--candidate-unavailable') {
      args.candidateAvailable = false;
      continue;
    }

    const accepted = new Set([
      '--current',
      '--candidate',
      '--task-class',
      '--current-five-hour',
      '--current-weekly',
      '--candidate-five-hour',
      '--candidate-weekly',
      '--candidate-quality',
      '--candidate-quality-task',
      '--candidate-quality-samples',
      '--handoff-bytes',
      '--max-handoff-bytes',
      '--transfer-benefit',
    ]);
    if (!accepted.has(name)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'unknown-flag',
          message: `Unknown schedule flag ${JSON.stringify(name)}`,
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
    const value = parsed.value;

    switch (name) {
      case '--current':
      case '--candidate': {
        if (value !== 'claude' && value !== 'codex') {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-schedule-harness',
              message: `${name} must be claude or codex`,
              remediation: `Use ${name} claude or ${name} codex`,
            }),
          );
        } else if (name === '--current') args.current = value;
        else args.candidate = value;
        break;
      }
      case '--task-class':
        args.taskClass = value;
        break;
      case '--current-five-hour':
      case '--current-weekly':
      case '--candidate-five-hour':
      case '--candidate-weekly': {
        if (!PACE_STATES.has(value as PaceState)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-schedule-pace',
              message: `${name} has unsupported pace state ${JSON.stringify(value)}`,
              remediation: 'Use under-pace, on-pace, over-pace, or unknown',
            }),
          );
          break;
        }
        const pace = value as PaceState;
        if (name === '--current-five-hour') args.currentFiveHour = pace;
        else if (name === '--current-weekly') args.currentWeekly = pace;
        else if (name === '--candidate-five-hour') args.candidateFiveHour = pace;
        else args.candidateWeekly = pace;
        break;
      }
      case '--candidate-quality':
        args.qualityExplicit = true;
        if (!QUALITY_STATES.has(value as QualityEvidenceState)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-schedule-quality',
              message: `Unsupported candidate quality state ${JSON.stringify(value)}`,
              remediation: 'Use passed, failed, or unknown',
            }),
          );
        } else args.candidateQuality = value as QualityEvidenceState;
        break;
      case '--candidate-quality-task':
        args.qualityExplicit = true;
        args.candidateQualityTask = value;
        break;
      case '--candidate-quality-samples': {
        args.qualityExplicit = true;
        const n = parseInteger(name, value, 0, diagnostics);
        if (n !== null) args.candidateQualitySamples = n;
        break;
      }
      case '--handoff-bytes': {
        const n = parseInteger(name, value, 0, diagnostics);
        if (n !== null) args.handoffBytes = n;
        break;
      }
      case '--max-handoff-bytes': {
        const n = parseInteger(name, value, 1, diagnostics);
        if (n !== null) args.maxHandoffBytes = n;
        break;
      }
      case '--transfer-benefit':
        args.transferExplicit = true;
        if (!BENEFIT_STATES.has(value as TransferBenefitState)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-transfer-benefit',
              message: `Unsupported transfer benefit state ${JSON.stringify(value)}`,
              remediation: 'Use proven-positive, non-positive, or unknown',
            }),
          );
        } else args.transferBenefit = value as TransferBenefitState;
        break;
      default:
        break;
    }
  }

  if (!args.help && !args.version) {
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
    if (args.taskClass === null || !isTaskClass(args.taskClass)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'schedule-task-class-required',
          message: 'A valid --task-class is required',
          remediation: 'Use mechanical, standard, hard, or critical',
        }),
      );
    }
    if (args.candidateQualityTask !== null && !isTaskClass(args.candidateQualityTask)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'invalid-quality-task-class',
          message: 'Candidate quality task class is invalid',
          remediation: 'Use mechanical, standard, hard, or critical',
        }),
      );
    }
  }

  return { args, diagnostics };
}

function needsBudgetHydration(input: CrossHarnessSchedulerInput): boolean {
  return [
    input.current.fiveHourPace,
    input.current.weeklyPace,
    input.candidate.fiveHourPace,
    input.candidate.weeklyPace,
  ].some((pace) => pace === 'unknown');
}

async function applyBudgetEvidence(
  input: CrossHarnessSchedulerInput,
  runtime: ScheduleRuntime | undefined,
): Promise<{
  input: CrossHarnessSchedulerInput;
  status: BudgetEvidenceStatus;
  notes: SchedulerPaceEvidenceNote[];
}> {
  if (!needsBudgetHydration(input)) return { input, status: 'not-needed', notes: [] };
  if (runtime?.observeBudget === undefined) {
    return { input, status: 'not-configured', notes: [] };
  }

  try {
    const report = await runtime.observeBudget();
    if (report === null) return { input, status: 'unavailable', notes: [] };
    const hydrated = hydrateCrossHarnessPaceFromBudget(input, report);
    return {
      input: hydrated.input,
      status: hydrated.notes.some((entry) => entry.code === 'budget-pace-observed')
        ? 'observed'
        : 'no-usable-pace',
      notes: hydrated.notes,
    };
  } catch {
    return { input, status: 'failed', notes: [] };
  }
}

async function applyQualityEvidence(
  input: CrossHarnessSchedulerInput,
  runtime: ScheduleRuntime | undefined,
  explicit: boolean,
): Promise<{
  input: CrossHarnessSchedulerInput;
  status: QualityEvidenceStatus;
  notes: SchedulerQualityEvidenceNote[];
}> {
  if (explicit) return { input, status: 'not-needed', notes: [] };
  if (runtime?.observeQualityReceipts === undefined) {
    return { input, status: 'not-configured', notes: [] };
  }

  try {
    const receipts = await runtime.observeQualityReceipts();
    if (receipts === null) return { input, status: 'unavailable', notes: [] };
    const hydrated = hydrateCandidateQualityFromBenchmarkReceipts(input, receipts);
    const code = hydrated.notes[0]?.code;
    const status: QualityEvidenceStatus =
      code === 'benchmark-quality-conflicting'
        ? 'conflicting'
        : code === 'benchmark-quality-unavailable'
          ? 'no-evidence'
          : code === 'benchmark-quality-passed' || code === 'benchmark-quality-failed'
            ? 'observed'
            : 'no-evidence';
    return { input: hydrated.input, status, notes: hydrated.notes };
  } catch {
    return { input, status: 'failed', notes: [] };
  }
}

async function applyTransferEvidence(
  input: CrossHarnessSchedulerInput,
  runtime: ScheduleRuntime | undefined,
  explicit: boolean,
): Promise<{
  input: CrossHarnessSchedulerInput;
  status: TransferEvidenceStatus;
  notes: SchedulerTransferEvidenceNote[];
}> {
  if (explicit) return { input, status: 'not-needed', notes: [] };
  if (runtime?.observeTransferReceipts === undefined) {
    return { input, status: 'not-configured', notes: [] };
  }

  try {
    const receipts = await runtime.observeTransferReceipts();
    if (receipts === null) return { input, status: 'unavailable', notes: [] };
    const hydrated = hydrateTransferBenefitFromReceipts(input, receipts);
    const code = hydrated.notes[0]?.code;
    const status: TransferEvidenceStatus =
      code === 'transfer-evidence-positive' || code === 'transfer-evidence-non-positive'
        ? 'observed'
        : code === 'transfer-evidence-conflicting'
          ? 'conflicting'
          : code === 'transfer-evidence-inconclusive'
            ? 'inconclusive'
            : code === 'transfer-evidence-unavailable'
              ? 'no-evidence'
              : 'no-evidence';
    return { input: hydrated.input, status, notes: hydrated.notes };
  } catch {
    return { input, status: 'failed', notes: [] };
  }
}

function render(report: ScheduleReport): string {
  const lines = [
    `Cross-harness recommendation: ${report.decision}`,
    `Current: ${report.currentHarness}`,
    `Candidate: ${report.candidateHarness}`,
    `Task class: ${report.taskClass}`,
    `Budget evidence: ${report.budgetEvidence.status}`,
    `Quality evidence: ${report.qualityEvidence.status}`,
    `Transfer evidence: ${report.transferEvidence.status}`,
    'Pace evidence:',
    `- current five-hour: ${report.evidence.current.fiveHourPace}`,
    `- current weekly: ${report.evidence.current.weeklyPace}`,
    `- candidate five-hour: ${report.evidence.candidate.fiveHourPace}`,
    `- candidate weekly: ${report.evidence.candidate.weeklyPace}`,
    'Candidate quality:',
    `- state: ${report.evidence.candidate.quality}`,
    `- task class: ${report.evidence.candidate.qualityTaskClass ?? 'unknown'}`,
    `- samples: ${String(report.evidence.candidate.qualitySamples)}`,
    'Transfer:',
    `- benefit: ${report.evidence.transfer.benefit}`,
    `- handoff bytes: ${String(report.evidence.transfer.handoffBytes)}`,
    `- max handoff bytes: ${String(report.evidence.transfer.maxHandoffBytes)}`,
  ];
  if (report.budgetEvidence.notes.length > 0) {
    lines.push(
      'Budget notes:',
      ...report.budgetEvidence.notes.map(
        (entry) => `- ${entry.harnessId}/${entry.scope}: ${entry.code}: ${entry.summary}`,
      ),
    );
  }
  if (report.qualityEvidence.notes.length > 0) {
    lines.push(
      'Quality notes:',
      ...report.qualityEvidence.notes.map(
        (entry) => `- ${entry.harnessId}/${entry.taskClass}: ${entry.code}: ${entry.summary}`,
      ),
    );
  }
  if (report.transferEvidence.notes.length > 0) {
    lines.push(
      'Transfer notes:',
      ...report.transferEvidence.notes.map(
        (entry) =>
          `- ${entry.currentHarness}->${entry.candidateHarness}/${entry.taskClass}: ${entry.code}: ${entry.summary}`,
      ),
    );
  }
  lines.push('Reasons:', ...report.reasons.map((entry) => `- ${entry.code}: ${entry.summary}`));
  return `${lines.join('\n')}\n`;
}

function emitSpecial(kind: 'help' | 'version', json: boolean, streams: Streams): void {
  const data = kind === 'help' ? { usage: HELP } : { version: TOOL_VERSION };
  if (json) {
    streams.out(
      serializeEnvelope(
        toEnvelope(commandResult({ command: kind, exitCode: EXIT_CODES.ok, data }), TOOL_VERSION),
      ),
    );
  } else {
    streams.out(kind === 'help' ? `${HELP}\n` : `${TOOL_VERSION}\n`);
  }
}

export async function scheduleMain(
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

  if (parsed.args.help) {
    emitSpecial('help', parsed.args.json, output);
    return EXIT_CODES.ok;
  }
  if (parsed.args.version) {
    emitSpecial('version', parsed.args.json, output);
    return EXIT_CODES.ok;
  }
  if (parsed.diagnostics.length > 0) {
    const result = commandResult({
      command: 'schedule',
      exitCode: EXIT_CODES['usage-error'],
      diagnostics: parsed.diagnostics,
    });
    if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
    else for (const entry of parsed.diagnostics) output.err(`${entry.code}: ${entry.message}\n`);
    return EXIT_CODES['usage-error'];
  }

  const taskClass = parsed.args.taskClass!;
  if (!isTaskClass(taskClass)) return EXIT_CODES['usage-error'];
  const qualityTask = parsed.args.candidateQualityTask;
  const initialInput: CrossHarnessSchedulerInput = {
    taskClass,
    current: {
      harnessId: harnessId(parsed.args.current!),
      available: true,
      fiveHourPace: parsed.args.currentFiveHour,
      weeklyPace: parsed.args.currentWeekly,
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    candidate: {
      harnessId: harnessId(parsed.args.candidate!),
      available: parsed.args.candidateAvailable,
      fiveHourPace: parsed.args.candidateFiveHour,
      weeklyPace: parsed.args.candidateWeekly,
      quality: parsed.args.candidateQuality,
      qualityTaskClass: qualityTask !== null && isTaskClass(qualityTask) ? qualityTask : null,
      qualitySamples: parsed.args.candidateQualitySamples,
    },
    transfer: {
      handoffBytes: parsed.args.handoffBytes,
      maxHandoffBytes: parsed.args.maxHandoffBytes,
      benefit: parsed.args.transferBenefit,
    },
  };

  const budget = await applyBudgetEvidence(initialInput, runtime);
  const quality = await applyQualityEvidence(budget.input, runtime, parsed.args.qualityExplicit);
  const transfer = await applyTransferEvidence(
    quality.input,
    runtime,
    parsed.args.transferExplicit,
  );
  const decision = scheduleCrossHarness(transfer.input);
  const report: ScheduleReport = {
    ...decision,
    evidence: {
      current: {
        fiveHourPace: transfer.input.current.fiveHourPace,
        weeklyPace: transfer.input.current.weeklyPace,
      },
      candidate: {
        fiveHourPace: transfer.input.candidate.fiveHourPace,
        weeklyPace: transfer.input.candidate.weeklyPace,
        quality: transfer.input.candidate.quality,
        qualityTaskClass: transfer.input.candidate.qualityTaskClass,
        qualitySamples: transfer.input.candidate.qualitySamples,
      },
      transfer: {
        handoffBytes: transfer.input.transfer.handoffBytes,
        maxHandoffBytes: transfer.input.transfer.maxHandoffBytes,
        benefit: transfer.input.transfer.benefit,
      },
    },
    budgetEvidence: { status: budget.status, notes: budget.notes },
    qualityEvidence: { status: quality.status, notes: quality.notes },
    transferEvidence: { status: transfer.status, notes: transfer.notes },
  };

  const result = commandResult({ command: 'schedule', exitCode: EXIT_CODES.ok, data: report });
  if (parsed.args.json) output.out(serializeEnvelope(toEnvelope(result, TOOL_VERSION)));
  else output.out(render(report));
  return EXIT_CODES.ok;
}
