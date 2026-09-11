/** Candidate attribution layered over the existing paired benchmark engine. */
import {
  EXIT_CODES,
  diagnostic,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type CommandResult,
  type Diagnostic,
  type HarnessId,
  type OptimizationCandidateId,
  type TaskBenchmarkCapture,
  type TaskBenchmarkCaptureStartReport,
  type TaskBenchmarkContextMatrixReport,
  type TaskBenchmarkMatrixEntry,
  type TaskBenchmarkReceipt,
  type TaskBenchmarkVariant,
  type TaskClass,
} from '@token-harness/core';

import { runBenchmarkStart } from './benchmark-capture.js';
import { runBenchmarkMatrix } from './benchmark-matrix.js';
import {
  OPTIMIZATION_CANDIDATES,
  readCandidateBenchmarkAttribution,
  writeCandidateBenchmarkAttribution,
} from './candidate-benchmark-attribution.js';
import type { CommandContext } from './context.js';

export type CandidateAwareTaskBenchmarkCaptureStartReport = TaskBenchmarkCaptureStartReport & {
  /** Experiment target only. This is not proof that the candidate was active. */
  candidateId?: OptimizationCandidateId;
};

export interface CandidateBenchmarkTimingEvidence {
  baselineWallClockMs: number | null;
  optimizedWallClockMs: number | null;
  wallClockSavingPercent: number | null;
}

export type CandidateBenchmarkEvidenceEntry = TaskBenchmarkMatrixEntry &
  Partial<CandidateBenchmarkTimingEvidence>;

export interface CandidateBenchmarkEvidence {
  candidateId: OptimizationCandidateId;
  pairs: number;
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  inconclusive: number;
  incomparable: number;
  quotaBacked: number;
  localEvidence: number;
  qualityOnly: number;
  evidencePairs: number;
  evidenceCoveragePercent: number | null;
  localComparablePairs: number;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
  wallClockComparablePairs: number;
  baselineWallClockMs: number | null;
  optimizedWallClockMs: number | null;
  wallClockSavingPercent: number | null;
}

export type CandidateBenchmarkCampaignSlotState =
  | 'baseline-not-started'
  | 'baseline-running'
  | 'optimized-not-started'
  | 'optimized-running'
  | 'complete'
  | 'invalid';

export interface CandidateBenchmarkCampaignSlot {
  benchmarkId: string;
  taskClass: TaskClass;
  run: number;
  state: CandidateBenchmarkCampaignSlotState;
}

export interface CandidateBenchmarkCampaignReport {
  campaignId: string;
  candidateId: OptimizationCandidateId;
  harnessId: HarnessId;
  runsPerTask: number;
  totalPairs: number;
  completedPairs: number;
  invalidPairs: number;
  slots: CandidateBenchmarkCampaignSlot[];
  nextCommand: string | null;
  nextInstruction: string;
  evidence: CandidateBenchmarkEvidence;
}

export type CandidateAwareBenchmarkMatrixReport = TaskBenchmarkContextMatrixReport & {
  candidateEvidence: CandidateBenchmarkEvidence[];
  campaign?: CandidateBenchmarkCampaignReport;
};

const CAMPAIGN_RUNS_PER_TASK = 2;
const CAMPAIGN_TASKS: readonly TaskClass[] = ['mechanical', 'standard', 'hard', 'critical'];
const CAMPAIGN_TASK_SUFFIX: Readonly<Record<TaskClass, string>> = {
  mechanical: 'm',
  standard: 's',
  hard: 'h',
  critical: 'c',
};

type CampaignArtifact<T> = 'absent' | 'invalid' | T;

interface CampaignDefinition {
  campaignId: string;
  candidateId: OptimizationCandidateId;
  harnessId: HarnessId;
  slots: CandidateBenchmarkCampaignSlot[];
}

function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

export function summarizeCandidateBenchmarkEntries(
  candidateId: OptimizationCandidateId,
  entries: readonly CandidateBenchmarkEvidenceEntry[],
): CandidateBenchmarkEvidence {
  const local = entries.filter(
    (entry) =>
      entry.localTokenSavingPercent !== null &&
      entry.baselineLocalTokens !== null &&
      entry.optimizedLocalTokens !== null,
  );
  const baselineLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.baselineLocalTokens ?? 0), 0);
  const optimizedLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.optimizedLocalTokens ?? 0), 0);
  const timing = entries.filter(
    (entry) =>
      entry.baselineWallClockMs !== undefined &&
      entry.baselineWallClockMs !== null &&
      entry.optimizedWallClockMs !== undefined &&
      entry.optimizedWallClockMs !== null &&
      entry.wallClockSavingPercent !== undefined &&
      entry.wallClockSavingPercent !== null,
  );
  const baselineWallClockMs =
    timing.length === 0
      ? null
      : timing.reduce((total, entry) => total + (entry.baselineWallClockMs ?? 0), 0);
  const optimizedWallClockMs =
    timing.length === 0
      ? null
      : timing.reduce((total, entry) => total + (entry.optimizedWallClockMs ?? 0), 0);
  const evidencePairs = entries.filter((entry) => entry.evidenceLevel !== 'none').length;

  return {
    candidateId,
    pairs: entries.length,
    optimizedBetter: entries.filter((entry) => entry.verdict === 'optimized-better').length,
    baselineBetter: entries.filter((entry) => entry.verdict === 'baseline-better').length,
    equivalent: entries.filter((entry) => entry.verdict === 'equivalent').length,
    inconclusive: entries.filter((entry) => entry.verdict === 'inconclusive').length,
    incomparable: entries.filter((entry) => entry.verdict === 'incomparable').length,
    quotaBacked: entries.filter((entry) => entry.evidenceLevel === 'quota-backed').length,
    localEvidence: entries.filter((entry) => entry.evidenceLevel === 'local-evidence').length,
    qualityOnly: entries.filter((entry) => entry.evidenceLevel === 'quality-only').length,
    evidencePairs,
    evidenceCoveragePercent: roundedPercent(evidencePairs, entries.length),
    localComparablePairs: local.length,
    baselineLocalTokens,
    optimizedLocalTokens,
    localTokenSavingPercent:
      baselineLocalTokens === null || optimizedLocalTokens === null
        ? null
        : roundedPercent(baselineLocalTokens - optimizedLocalTokens, baselineLocalTokens),
    wallClockComparablePairs: timing.length,
    baselineWallClockMs,
    optimizedWallClockMs,
    wallClockSavingPercent:
      baselineWallClockMs === null || optimizedWallClockMs === null
        ? null
        : roundedPercent(baselineWallClockMs - optimizedWallClockMs, baselineWallClockMs),
  };
}

export function buildCandidateBenchmarkEvidence(
  entries: ReadonlyMap<OptimizationCandidateId, readonly CandidateBenchmarkEvidenceEntry[]>,
): CandidateBenchmarkEvidence[] {
  return OPTIMIZATION_CANDIDATES.map((candidate) =>
    summarizeCandidateBenchmarkEntries(candidate, entries.get(candidate) ?? []),
  );
}

export function candidateBenchmarkCampaignBenchmarkId(
  campaignId: string,
  taskClass: TaskClass,
  run: number,
): string | null {
  const id = `${campaignId}-${CAMPAIGN_TASK_SUFFIX[taskClass]}-${String(run)}`;
  return isTaskBenchmarkId(id) ? id : null;
}

export function planCandidateBenchmarkCampaign(
  campaignId: string,
  taskClass: TaskClass | null = null,
): CandidateBenchmarkCampaignSlot[] | null {
  const tasks = taskClass === null ? CAMPAIGN_TASKS : [taskClass];
  const slots: CandidateBenchmarkCampaignSlot[] = [];
  for (const task of tasks) {
    for (let run = 1; run <= CAMPAIGN_RUNS_PER_TASK; run += 1) {
      const benchmarkId = candidateBenchmarkCampaignBenchmarkId(campaignId, task, run);
      if (benchmarkId === null) return null;
      slots.push({ benchmarkId, taskClass: task, run, state: 'baseline-not-started' });
    }
  }
  return slots;
}

function benchmarkArtifactPath(
  context: CommandContext,
  benchmarkId: string,
  filename: string,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, filename);
}

function receiptPath(
  context: CommandContext,
  benchmarkId: string,
  variant: TaskBenchmarkVariant,
): string | null {
  return benchmarkArtifactPath(context, benchmarkId, `${variant}.json`);
}

async function readCaptureArtifact(
  context: CommandContext,
  benchmarkId: string,
  variant: TaskBenchmarkVariant,
): Promise<CampaignArtifact<TaskBenchmarkCapture>> {
  const path = benchmarkArtifactPath(context, benchmarkId, `${variant}.capture.json`);
  if (path === null || context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';
  try {
    const raw = JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
    const parsed = parseTaskBenchmarkCapture(raw);
    return parsed.ok ? parsed.capture : 'invalid';
  } catch {
    return 'invalid';
  }
}

async function readReceiptArtifact(
  context: CommandContext,
  benchmarkId: string,
  variant: TaskBenchmarkVariant,
): Promise<CampaignArtifact<TaskBenchmarkReceipt>> {
  const path = receiptPath(context, benchmarkId, variant);
  if (path === null || context.adapters === null) return 'absent';
  const stat = await context.adapters.fs.stat(path);
  if (stat === null) return 'absent';
  if (stat.kind !== 'file') return 'invalid';
  try {
    const raw = JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
    const parsed = parseTaskBenchmarkReceipt(raw);
    return parsed.ok ? parsed.receipt : 'invalid';
  } catch {
    return 'invalid';
  }
}

function captureMatchesCampaign(
  capture: TaskBenchmarkCapture,
  slot: CandidateBenchmarkCampaignSlot,
  variant: TaskBenchmarkVariant,
  harnessId: HarnessId,
  projectId: string,
): boolean {
  return (
    capture.benchmarkId === slot.benchmarkId &&
    capture.variant === variant &&
    capture.taskClass === slot.taskClass &&
    capture.harnessId === harnessId &&
    capture.projectId === projectId
  );
}

function receiptMatchesCampaign(
  receipt: TaskBenchmarkReceipt,
  slot: CandidateBenchmarkCampaignSlot,
  variant: TaskBenchmarkVariant,
  harnessId: HarnessId,
): boolean {
  return (
    receipt.benchmarkId === slot.benchmarkId &&
    receipt.variant === variant &&
    receipt.taskClass === slot.taskClass &&
    receipt.harnessId === harnessId
  );
}

async function readCampaignSlotState(
  context: CommandContext,
  definition: CampaignDefinition,
  slot: CandidateBenchmarkCampaignSlot,
  projectId: string,
): Promise<CandidateBenchmarkCampaignSlotState> {
  const [attribution, baselineCapture, baselineReceipt, optimizedCapture, optimizedReceipt] =
    await Promise.all([
      readCandidateBenchmarkAttribution(context, slot.benchmarkId),
      readCaptureArtifact(context, slot.benchmarkId, 'baseline'),
      readReceiptArtifact(context, slot.benchmarkId, 'baseline'),
      readCaptureArtifact(context, slot.benchmarkId, 'optimized'),
      readReceiptArtifact(context, slot.benchmarkId, 'optimized'),
    ]);

  if (
    baselineCapture === 'invalid' ||
    baselineReceipt === 'invalid' ||
    optimizedCapture === 'invalid' ||
    optimizedReceipt === 'invalid' ||
    attribution === 'invalid'
  ) {
    return 'invalid';
  }

  const baselineCapturePresent = baselineCapture !== 'absent';
  const baselineReceiptPresent = baselineReceipt !== 'absent';
  const optimizedCapturePresent = optimizedCapture !== 'absent';
  const optimizedReceiptPresent = optimizedReceipt !== 'absent';
  const untouched =
    !baselineCapturePresent &&
    !baselineReceiptPresent &&
    !optimizedCapturePresent &&
    !optimizedReceiptPresent &&
    attribution === 'absent';
  if (untouched) return 'baseline-not-started';

  if (
    attribution === 'absent' ||
    attribution.benchmarkId !== slot.benchmarkId ||
    attribution.candidateId !== definition.candidateId ||
    attribution.projectId !== projectId
  ) {
    return 'invalid';
  }

  if (
    baselineCapture === 'absent' ||
    !captureMatchesCampaign(
      baselineCapture,
      slot,
      'baseline',
      definition.harnessId,
      projectId,
    )
  ) {
    return 'invalid';
  }

  if (baselineReceipt === 'absent') {
    return optimizedCapturePresent || optimizedReceiptPresent ? 'invalid' : 'baseline-running';
  }
  if (!receiptMatchesCampaign(baselineReceipt, slot, 'baseline', definition.harnessId)) {
    return 'invalid';
  }

  if (optimizedCapture === 'absent') {
    return optimizedReceiptPresent ? 'invalid' : 'optimized-not-started';
  }
  if (
    !captureMatchesCampaign(
      optimizedCapture,
      slot,
      'optimized',
      definition.harnessId,
      projectId,
    )
  ) {
    return 'invalid';
  }

  if (optimizedReceipt === 'absent') return 'optimized-running';
  return receiptMatchesCampaign(optimizedReceipt, slot, 'optimized', definition.harnessId)
    ? 'complete'
    : 'invalid';
}

function campaignNextStep(
  definition: CampaignDefinition,
  slots: readonly CandidateBenchmarkCampaignSlot[],
): { command: string | null; instruction: string } {
  const next = slots.find((slot) => slot.state !== 'complete');
  if (next === undefined) {
    return {
      command: null,
      instruction:
        'Campaign complete. Review the campaign evidence below before deciding whether the candidate deserves a broader rollout.',
    };
  }

  if (next.state === 'invalid') {
    return {
      command: null,
      instruction: `Campaign paused because ${next.benchmarkId} contains ambiguous or incompatible benchmark state. Use a new campaign id rather than overwriting evidence.`,
    };
  }

  if (next.state === 'baseline-not-started') {
    return {
      command:
        `token-harness benchmark-start --benchmark-id ${next.benchmarkId} ` +
        `--candidate ${definition.candidateId} --variant baseline --task ${next.taskClass} ` +
        `--harness ${definition.harnessId}`,
      instruction: `Start baseline ${String(next.run)} for ${next.taskClass} with the current production stack unchanged.`,
    };
  }

  if (next.state === 'baseline-running') {
    return {
      command:
        `token-harness benchmark-finish --benchmark-id ${next.benchmarkId} --variant baseline ` +
        '--quality passed --attempts 1 --failed-attempts 0',
      instruction:
        'Finish the baseline after the task. Change quality/attempt counts if the observed outcome differs from the default command.',
    };
  }

  if (next.state === 'optimized-not-started') {
    return {
      command:
        `token-harness benchmark-start --benchmark-id ${next.benchmarkId} ` +
        `--candidate ${definition.candidateId} --variant optimized --task ${next.taskClass} ` +
        `--harness ${definition.harnessId}`,
      instruction: `Enable ${definition.candidateId} through its own documented workflow first, then start the optimized capture. Token Harness does not claim activation itself.`,
    };
  }

  return {
    command:
      `token-harness benchmark-finish --benchmark-id ${next.benchmarkId} --variant optimized ` +
      '--quality passed --attempts 1 --failed-attempts 0',
    instruction:
      'Finish the optimized task. Change quality/attempt counts if the observed outcome differs from the default command.',
  };
}

async function buildCampaignReport(
  context: CommandContext,
  definition: CampaignDefinition,
  matrix: TaskBenchmarkContextMatrixReport,
  projectId: string,
): Promise<CandidateBenchmarkCampaignReport> {
  const slots: CandidateBenchmarkCampaignSlot[] = [];
  for (const slot of definition.slots) {
    slots.push({
      ...slot,
      state: await readCampaignSlotState(context, definition, slot, projectId),
    });
  }

  const completeIds = new Set(
    slots.filter((slot) => slot.state === 'complete').map((slot) => slot.benchmarkId),
  );
  const evidenceEntries: CandidateBenchmarkEvidenceEntry[] = [];
  for (const entry of matrix.entries) {
    if (!completeIds.has(entry.benchmarkId)) continue;
    const timing = await readTimingEvidence(context, entry.benchmarkId);
    evidenceEntries.push({ ...entry, ...timing });
  }

  const next = campaignNextStep(definition, slots);
  return {
    campaignId: definition.campaignId,
    candidateId: definition.candidateId,
    harnessId: definition.harnessId,
    runsPerTask: CAMPAIGN_RUNS_PER_TASK,
    totalPairs: slots.length,
    completedPairs: slots.filter((slot) => slot.state === 'complete').length,
    invalidPairs: slots.filter((slot) => slot.state === 'invalid').length,
    slots,
    nextCommand: next.command,
    nextInstruction: next.instruction,
    evidence: summarizeCandidateBenchmarkEntries(definition.candidateId, evidenceEntries),
  };
}

function resolveCampaignDefinition(
  context: CommandContext,
): { definition: CampaignDefinition | null; diagnostic: Diagnostic | null } {
  const campaignId = context.benchmarkId ?? null;
  const candidateId = context.optimizationCandidate ?? null;
  if (campaignId === null || candidateId === null) return { definition: null, diagnostic: null };

  if (context.harness === null) {
    return {
      definition: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'candidate-benchmark-campaign-harness-required',
        message: 'A candidate benchmark campaign needs an explicit harness',
        remediation: 'Add --harness claude or --harness codex',
      }),
    };
  }

  const slots = planCandidateBenchmarkCampaign(campaignId, context.taskClass ?? null);
  if (slots === null) {
    return {
      definition: null,
      diagnostic: diagnostic({
        severity: 'error',
        code: 'candidate-benchmark-campaign-id-too-long',
        message: `Campaign id ${JSON.stringify(campaignId)} cannot produce safe benchmark ids`,
        remediation: 'Use a shorter campaign id, normally 60 characters or fewer',
      }),
    };
  }

  return {
    definition: {
      campaignId,
      candidateId,
      harnessId: context.harness,
      slots,
    },
    diagnostic: null,
  };
}

async function readTimingEvidence(
  context: CommandContext,
  benchmarkId: string,
): Promise<CandidateBenchmarkTimingEvidence> {
  const empty: CandidateBenchmarkTimingEvidence = {
    baselineWallClockMs: null,
    optimizedWallClockMs: null,
    wallClockSavingPercent: null,
  };
  if (context.adapters === null) return empty;

  const readReceipt = async (variant: TaskBenchmarkVariant) => {
    const path = receiptPath(context, benchmarkId, variant);
    if (path === null) return null;
    const stat = await context.adapters?.fs.stat(path);
    if (stat === null || stat === undefined || stat.kind !== 'file') return null;
    try {
      const raw = JSON.parse(
        new TextDecoder().decode(await context.adapters?.fs.readFile(path)),
      ) as unknown;
      const parsed = parseTaskBenchmarkReceipt(raw);
      return parsed.ok ? parsed.receipt : null;
    } catch {
      return null;
    }
  };

  const baseline = await readReceipt('baseline');
  const optimized = await readReceipt('optimized');
  if (
    baseline === null ||
    optimized === null ||
    baseline.benchmarkId !== benchmarkId ||
    optimized.benchmarkId !== benchmarkId ||
    baseline.outcome.qualityGate !== 'passed' ||
    optimized.outcome.qualityGate !== 'passed'
  ) {
    return empty;
  }

  const baselineWallClockMs = Date.parse(baseline.completedAt) - Date.parse(baseline.startedAt);
  const optimizedWallClockMs = Date.parse(optimized.completedAt) - Date.parse(optimized.startedAt);
  if (
    !Number.isFinite(baselineWallClockMs) ||
    !Number.isFinite(optimizedWallClockMs) ||
    baselineWallClockMs < 0 ||
    optimizedWallClockMs < 0
  ) {
    return empty;
  }

  return {
    baselineWallClockMs,
    optimizedWallClockMs,
    wallClockSavingPercent: roundedPercent(
      baselineWallClockMs - optimizedWallClockMs,
      baselineWallClockMs,
    ),
  };
}

/**
 * Start the normal benchmark capture, then persist only candidate identity beside it.
 * The receipt schema and comparator remain unchanged. Candidate identity means experiment target,
 * not proof that the candidate was active in either run.
 */
export async function runCandidateBenchmarkStart(
  context: CommandContext,
): Promise<CommandResult<CandidateAwareTaskBenchmarkCaptureStartReport | null>> {
  const requestedCandidate = context.optimizationCandidate ?? null;
  const benchmarkId = context.benchmarkId ?? null;
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;
  const existing =
    benchmarkId === null ? 'absent' : await readCandidateBenchmarkAttribution(context, benchmarkId);

  if (requestedCandidate !== null && benchmarkId !== null) {
    if (
      existing === 'invalid' ||
      (existing !== 'absent' &&
        (existing.candidateId !== requestedCandidate ||
          (projectId !== null && existing.projectId !== projectId)))
    ) {
      return {
        command: 'benchmark-start',
        exitCode: EXIT_CODES['precondition-drift'],
        data: null,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'candidate-benchmark-attribution-conflict',
            message: `Benchmark ${benchmarkId} already has incompatible candidate attribution`,
            remediation: 'Use a new benchmark id instead of reusing ambiguous experiment state',
          }),
        ],
      };
    }
  }

  const result = await runBenchmarkStart(context);
  if (result.data === null || result.exitCode !== EXIT_CODES.ok) return result;

  if (
    existing !== 'absent' &&
    existing !== 'invalid' &&
    existing.benchmarkId === result.data.capture.benchmarkId &&
    existing.projectId === result.data.capture.projectId
  ) {
    return {
      ...result,
      data: { ...result.data, candidateId: existing.candidateId },
    };
  }

  if (requestedCandidate === null) return result;

  const written = await writeCandidateBenchmarkAttribution(context, {
    schemaVersion: 1,
    benchmarkId: result.data.capture.benchmarkId,
    candidateId: requestedCandidate,
    projectId: result.data.capture.projectId,
  });
  if (written) {
    return {
      ...result,
      data: { ...result.data, candidateId: requestedCandidate },
    };
  }

  return {
    ...result,
    diagnostics: [
      ...result.diagnostics,
      diagnostic({
        severity: 'warning',
        code: 'candidate-benchmark-attribution-write-failed',
        message:
          'The benchmark capture was created, but its optional candidate attribution could not be saved',
        remediation:
          'Keep the capture as ordinary benchmark evidence and use a new id for candidate-specific evidence',
      }),
    ],
  };
}

/** Add candidate-specific summaries without changing the deterministic matrix verdicts. */
export async function runCandidateBenchmarkMatrix(
  context: CommandContext,
): Promise<CommandResult<CandidateAwareBenchmarkMatrixReport | null>> {
  const campaignResolution = resolveCampaignDefinition(context);
  if (campaignResolution.diagnostic !== null) {
    return {
      command: 'benchmark-matrix',
      exitCode: EXIT_CODES['usage-error'],
      data: null,
      diagnostics: [campaignResolution.diagnostic],
    };
  }

  const result = await runBenchmarkMatrix(context);
  if (result.data === null) return { ...result, data: null };

  const entries = new Map<OptimizationCandidateId, CandidateBenchmarkEvidenceEntry[]>(
    OPTIMIZATION_CANDIDATES.map((candidate) => [candidate, []]),
  );
  const diagnostics: Diagnostic[] = [...result.diagnostics];
  const projectId = context.adapters?.projectIdFor(context.projectRoot) ?? null;

  for (const entry of result.data.entries) {
    const attribution = await readCandidateBenchmarkAttribution(context, entry.benchmarkId);
    if (attribution === 'absent') continue;
    if (
      attribution === 'invalid' ||
      attribution.benchmarkId !== entry.benchmarkId ||
      (projectId !== null && attribution.projectId !== projectId)
    ) {
      diagnostics.push(
        diagnostic({
          severity: 'warning',
          code: 'candidate-benchmark-attribution-invalid',
          subject: entry.benchmarkId,
          message: 'Candidate attribution was ignored because it is invalid or belongs elsewhere',
          remediation:
            'Keep the benchmark pair as ordinary evidence; use a new id for a clean candidate run',
        }),
      );
      continue;
    }
    const timing = await readTimingEvidence(context, entry.benchmarkId);
    entries.get(attribution.candidateId)?.push({ ...entry, ...timing });
  }

  const campaign =
    campaignResolution.definition === null || projectId === null
      ? undefined
      : await buildCampaignReport(
          context,
          campaignResolution.definition,
          result.data,
          projectId,
        );

  if (campaign !== undefined && campaign.invalidPairs > 0) {
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'candidate-benchmark-campaign-state-invalid',
        message: `${String(campaign.invalidPairs)} campaign slot(s) contain ambiguous or incompatible state`,
        remediation: 'Use a new campaign id instead of overwriting or reusing ambiguous evidence',
      }),
    );
  }

  return {
    ...result,
    data: {
      ...result.data,
      candidateEvidence: buildCandidateBenchmarkEvidence(entries),
      ...(campaign === undefined ? {} : { campaign }),
    },
    diagnostics,
  };
}
