import {
  harnessId,
  scheduleCrossHarness,
  serializeEnvelope,
  type AcceptedTaskCapacityEstimate,
  type CliEnvelope,
  type CrossHarnessSchedulerInput,
  type PaceState,
  type QualityEvidenceState,
  type SchedulerPaceEvidenceNote,
  type SchedulerQualityEvidenceNote,
  type SchedulerTransferEvidenceNote,
  type TaskClass,
  type TransferBenefitState,
} from '@token-harness/core';

import { hydrateScheduleCapacity } from './schedule-capacity.js';
import { scheduleMain, type ScheduleRuntime } from './schedule-main.js';

interface Streams {
  out(text: string): void;
  err(text: string): void;
}

interface BaseScheduleData {
  decision: string;
  currentHarness: string;
  candidateHarness: string;
  taskClass: TaskClass;
  reasons: { code: string; summary: string }[];
  evidence: {
    current: { fiveHourPace: PaceState; weeklyPace: PaceState };
    candidate: {
      fiveHourPace: PaceState;
      weeklyPace: PaceState;
      quality: QualityEvidenceState;
      qualityTaskClass: TaskClass | null;
      qualitySamples: number;
    };
    transfer: {
      handoffBytes: number;
      maxHandoffBytes: number;
      benefit: TransferBenefitState;
    };
  };
  budgetEvidence: {
    status: string;
    notes: SchedulerPaceEvidenceNote[];
  };
  qualityEvidence: {
    status: string;
    notes: SchedulerQualityEvidenceNote[];
  };
  transferEvidence: {
    status: string;
    notes: SchedulerTransferEvidenceNote[];
  };
}

interface CapacityScheduleData extends BaseScheduleData {
  evidence: BaseScheduleData['evidence'] & {
    current: BaseScheduleData['evidence']['current'] & {
      acceptedTasksRemaining: number | null;
    };
    candidate: BaseScheduleData['evidence']['candidate'] & {
      acceptedTasksRemaining: number | null;
    };
  };
  capacityEvidence: {
    current: AcceptedTaskCapacityEstimate | null;
    candidate: AcceptedTaskCapacityEstimate | null;
  };
}

function requestedJson(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--json' || token.startsWith('--json='));
}

function specialInvocation(argv: readonly string[]): boolean {
  return argv.includes('--help') || argv.includes('--version');
}

function ensureJson(argv: readonly string[]): string[] {
  if (requestedJson(argv)) return [...argv];
  return [...argv, '--json'];
}

function renderCapacity(estimate: AcceptedTaskCapacityEstimate | null): string {
  if (estimate === null || estimate.status !== 'estimated') return 'unknown';
  return `${String(estimate.acceptedTasksRemaining)} accepted task(s)`;
}

function render(report: CapacityScheduleData): string {
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
    'Accepted-task capacity:',
    `- current: ${renderCapacity(report.capacityEvidence.current)}`,
    `- candidate: ${renderCapacity(report.capacityEvidence.candidate)}`,
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

/**
 * Installed schedule entry point with additive accepted-task-capacity evidence.
 *
 * The historical schedule parser remains untouched. We run it once in JSON mode using cached
 * observers, then re-run only the pure scheduler policy with the capacity evidence derived from
 * those exact same observations. Explicit flags that cause an observer to be skipped remain
 * authoritative: this layer does not perform a second hidden observation to fill the gap.
 */
export async function scheduleCapacityMain(
  argv: readonly string[],
  streams?: Streams,
  runtime?: ScheduleRuntime,
): Promise<number> {
  if (specialInvocation(argv)) return scheduleMain(argv, streams, runtime);

  const output =
    streams ??
    ({
      out: (text: string) => process.stdout.write(text),
      err: (text: string) => process.stderr.write(text),
    } satisfies Streams);
  let budgetObserved = false;
  let budgetValue: Awaited<ReturnType<NonNullable<ScheduleRuntime['observeBudget']>>> = null;
  let qualityObserved = false;
  let qualityValue: Awaited<
    ReturnType<NonNullable<ScheduleRuntime['observeQualityReceipts']>>
  > = null;

  const cachedRuntime: ScheduleRuntime = {
    ...(runtime?.observeBudget === undefined
      ? {}
      : {
          observeBudget: async () => {
            if (!budgetObserved) {
              budgetValue = await runtime.observeBudget!();
              budgetObserved = true;
            }
            return budgetValue;
          },
        }),
    ...(runtime?.observeQualityReceipts === undefined
      ? {}
      : {
          observeQualityReceipts: async () => {
            if (!qualityObserved) {
              qualityValue = await runtime.observeQualityReceipts!();
              qualityObserved = true;
            }
            return qualityValue;
          },
        }),
    ...(runtime?.observeTransferReceipts === undefined
      ? {}
      : { observeTransferReceipts: runtime.observeTransferReceipts }),
    ...(runtime?.measureHandoffBytes === undefined
      ? {}
      : { measureHandoffBytes: runtime.measureHandoffBytes }),
  };

  let stdout = '';
  let stderr = '';
  const exitCode = await scheduleMain(
    ensureJson(argv),
    {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
    cachedRuntime,
  );
  if (exitCode !== 0) {
    if (requestedJson(argv)) {
      if (stdout !== '') output.out(stdout);
      if (stderr !== '') output.err(stderr);
      return exitCode;
    }
    return scheduleMain(argv, output, cachedRuntime);
  }

  let envelope: CliEnvelope<BaseScheduleData>;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope<BaseScheduleData>;
  } catch {
    output.err(
      'internal-error: schedule capacity layer could not parse the base schedule report\n',
    );
    return 70;
  }
  if (envelope.data === null) {
    if (requestedJson(argv)) output.out(stdout);
    else output.err('schedule returned no report data\n');
    return exitCode;
  }

  const base = envelope.data;
  const schedulerInput: CrossHarnessSchedulerInput = {
    taskClass: base.taskClass,
    current: {
      harnessId: harnessId(base.currentHarness),
      available: true,
      fiveHourPace: base.evidence.current.fiveHourPace,
      weeklyPace: base.evidence.current.weeklyPace,
      quality: 'unknown',
      qualityTaskClass: null,
      qualitySamples: 0,
    },
    candidate: {
      harnessId: harnessId(base.candidateHarness),
      available: !argv.includes('--candidate-unavailable'),
      fiveHourPace: base.evidence.candidate.fiveHourPace,
      weeklyPace: base.evidence.candidate.weeklyPace,
      quality: base.evidence.candidate.quality,
      qualityTaskClass: base.evidence.candidate.qualityTaskClass,
      qualitySamples: base.evidence.candidate.qualitySamples,
    },
    transfer: { ...base.evidence.transfer },
  };

  const capacity =
    budgetObserved && budgetValue !== null && qualityObserved && qualityValue !== null
      ? hydrateScheduleCapacity(schedulerInput, budgetValue, qualityValue)
      : null;
  const enrichedInput = capacity?.input ?? schedulerInput;
  const decision = scheduleCrossHarness(enrichedInput);
  const data: CapacityScheduleData = {
    ...base,
    ...decision,
    evidence: {
      current: {
        ...base.evidence.current,
        acceptedTasksRemaining: enrichedInput.current.acceptedTasksRemaining ?? null,
      },
      candidate: {
        ...base.evidence.candidate,
        acceptedTasksRemaining: enrichedInput.candidate.acceptedTasksRemaining ?? null,
      },
      transfer: { ...base.evidence.transfer },
    },
    capacityEvidence: {
      current: capacity?.current ?? null,
      candidate: capacity?.candidate ?? null,
    },
  };
  const enrichedEnvelope: CliEnvelope<CapacityScheduleData> = { ...envelope, data };
  if (requestedJson(argv)) output.out(serializeEnvelope(enrichedEnvelope));
  else output.out(render(data));
  return exitCode;
}
