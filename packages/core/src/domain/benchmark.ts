/**
 * Paired task benchmark receipts — RFC 0011 measurement foundation.
 *
 * The comparator is deliberately conservative. Quality must be known before efficiency can win,
 * backend quota is compared only when the same non-reset window is observed through the same
 * supported source, and local token volume is never promoted into subscription quota.
 */

import type { UsageConfidence, UsageWindowSnapshot } from './budget.js';
import type { SessionHistoryRow } from './history.js';
import { isHarnessId, type HarnessId } from './ids.js';
import { isTaskClass, type TaskClass } from './optimizer.js';

export const TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION = 1;
export const TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION = 1;

export type TaskBenchmarkVariant = 'baseline' | 'optimized';
export type TaskQualityGate = 'passed' | 'failed' | 'unknown';

const BENCHMARK_ID = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/;

export function isTaskBenchmarkId(value: string): boolean {
  return BENCHMARK_ID.test(value);
}

export function isTaskBenchmarkVariant(value: string): value is TaskBenchmarkVariant {
  return value === 'baseline' || value === 'optimized';
}

export function isTaskQualityGate(value: string): value is TaskQualityGate {
  return value === 'passed' || value === 'failed' || value === 'unknown';
}

export interface TaskLocalUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Minimal per-session local usage snapshot persisted only in the in-progress capture.
 *
 * The session id never reaches the completed receipt. It exists solely to subtract cumulative
 * ccusage counters across the task boundary without pretending a whole-day total belongs to one
 * benchmark run.
 */
export interface TaskBenchmarkLocalSessionSnapshot extends TaskLocalUsage {
  sessionId: string;
  firstActivity: string | null;
  lastActivity: string | null;
}

export interface TaskBenchmarkOutcome {
  /** The benchmark's explicit task-quality gate; never inferred from token counts. */
  qualityGate: TaskQualityGate;
  /** Number of attempts made to reach the final outcome. */
  attempts: number;
  /** Attempts that failed before the final outcome. */
  failedAttempts: number;
  /** Normalized runtime/provider error identities observed during the task. */
  errorCodes: string[];
}

export interface TaskBenchmarkReceipt {
  schemaVersion: typeof TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION;
  benchmarkId: string;
  variant: TaskBenchmarkVariant;
  taskClass: TaskClass;
  harnessId: HarnessId;
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  startedAt: string;
  completedAt: string;
  usageBefore: UsageWindowSnapshot[];
  usageAfter: UsageWindowSnapshot[];
  /** Local token volume is evidence about workload, not backend subscription quota. */
  localUsage: TaskLocalUsage | null;
  outcome: TaskBenchmarkOutcome;
}

export interface TaskBenchmarkCapture {
  schemaVersion: typeof TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION;
  benchmarkId: string;
  variant: TaskBenchmarkVariant;
  taskClass: TaskClass;
  harnessId: HarnessId;
  /** Machine-local stable project id; raw project paths are deliberately not persisted. */
  projectId: string;
  model: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  startedAt: string;
  usageBefore: UsageWindowSnapshot[];
  /**
   * Cumulative ccusage session counters at start, or null when local history was unavailable.
   *
   * Additive within schema 1: old captures without the field parse as null.
   */
  localSessionsBefore: TaskBenchmarkLocalSessionSnapshot[] | null;
}

export interface TaskBenchmarkCaptureStartReport {
  capture: TaskBenchmarkCapture;
  capturePath: string;
}

export interface TaskBenchmarkCaptureFinishReport {
  receipt: TaskBenchmarkReceipt;
  capturePath: string;
  receiptPath: string;
}

export type TaskBenchmarkCaptureParseResult =
  | { ok: true; capture: TaskBenchmarkCapture }
  | { ok: false; reason: 'unsupported-schema' | 'invalid-shape'; message: string };

export type TaskBenchmarkReceiptParseResult =
  | { ok: true; receipt: TaskBenchmarkReceipt }
  | { ok: false; reason: 'unsupported-schema' | 'invalid-shape'; message: string };

const WINDOW_SCOPES = new Set(['five-hour', 'weekly', 'monthly', 'model', 'credit', 'unknown']);
const WINDOW_SOURCES = new Set([
  'native-rpc',
  'native-cli',
  'companion-cli',
  'local-history',
  'unknown',
]);
const WINDOW_CONFIDENCES = new Set(['authoritative', 'reported', 'cached', 'estimated']);
const WINDOW_KINDS = new Set(['primary', 'secondary']);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === 'string' ? value : undefined;
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableFiniteNonNegative(value: unknown): number | null | undefined {
  return value === null ? null : (finiteNonNegative(value) ?? undefined);
}

function nullablePercent(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : undefined;
}

function validInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function parseUsageWindow(value: unknown): UsageWindowSnapshot | null {
  const row = record(value);
  if (row === null) return null;
  const harnessId = row['harnessId'];
  const bucketId = optionalText(row['bucketId']);
  const bucketName = optionalText(row['bucketName']);
  const window = row['window'];
  const scope = row['scope'];
  const usedPercent = nullablePercent(row['usedPercent']);
  const remainingPercent = nullablePercent(row['remainingPercent']);
  const duration = nullableFiniteNonNegative(row['windowDurationMinutes']);
  const resetsAt = optionalText(row['resetsAt']);
  const observedAt = row['observedAt'];
  const source = row['source'];
  const confidence = row['confidence'];

  if (
    typeof harnessId !== 'string' ||
    !isHarnessId(harnessId) ||
    bucketId === undefined ||
    bucketName === undefined ||
    !(window === null || (typeof window === 'string' && WINDOW_KINDS.has(window))) ||
    typeof scope !== 'string' ||
    !WINDOW_SCOPES.has(scope) ||
    usedPercent === undefined ||
    remainingPercent === undefined ||
    duration === undefined ||
    resetsAt === undefined ||
    (resetsAt !== null && !validInstant(resetsAt)) ||
    !validInstant(observedAt) ||
    typeof source !== 'string' ||
    !WINDOW_SOURCES.has(source) ||
    typeof confidence !== 'string' ||
    !WINDOW_CONFIDENCES.has(confidence)
  ) {
    return null;
  }

  return {
    harnessId,
    bucketId,
    bucketName,
    window: window as UsageWindowSnapshot['window'],
    scope: scope as UsageWindowSnapshot['scope'],
    usedPercent,
    remainingPercent,
    windowDurationMinutes: duration,
    resetsAt,
    observedAt,
    source: source as UsageWindowSnapshot['source'],
    confidence: confidence as UsageWindowSnapshot['confidence'],
  };
}

function parseUsageWindows(value: unknown): UsageWindowSnapshot[] | null {
  if (!Array.isArray(value)) return null;
  const rows: UsageWindowSnapshot[] = [];
  for (const item of value) {
    const parsed = parseUsageWindow(item);
    if (parsed === null) return null;
    rows.push(parsed);
  }
  return rows;
}

function parseLocalUsage(value: unknown): TaskLocalUsage | null | undefined {
  if (value === null) return null;
  const row = record(value);
  if (row === null) return undefined;
  const inputTokens = finiteNonNegative(row['inputTokens']);
  const cacheCreationTokens = finiteNonNegative(row['cacheCreationTokens']);
  const cacheReadTokens = finiteNonNegative(row['cacheReadTokens']);
  const outputTokens = finiteNonNegative(row['outputTokens']);
  const totalTokens = finiteNonNegative(row['totalTokens']);
  if (
    inputTokens === null ||
    cacheCreationTokens === null ||
    cacheReadTokens === null ||
    outputTokens === null ||
    totalTokens === null
  ) {
    return undefined;
  }
  return { inputTokens, cacheCreationTokens, cacheReadTokens, outputTokens, totalTokens };
}

function parseLocalSessionSnapshot(value: unknown): TaskBenchmarkLocalSessionSnapshot | null {
  const row = record(value);
  if (row === null) return null;
  const usage = parseLocalUsage(row);
  const sessionId = row['sessionId'];
  const firstActivity = optionalText(row['firstActivity']);
  const lastActivity = optionalText(row['lastActivity']);
  if (
    usage === null ||
    usage === undefined ||
    typeof sessionId !== 'string' ||
    sessionId === '' ||
    firstActivity === undefined ||
    lastActivity === undefined ||
    (firstActivity !== null && !validInstant(firstActivity)) ||
    (lastActivity !== null && !validInstant(lastActivity))
  ) {
    return null;
  }
  return { sessionId, firstActivity, lastActivity, ...usage };
}

function parseLocalSessionSnapshots(
  value: unknown,
): TaskBenchmarkLocalSessionSnapshot[] | null | undefined {
  // Additive schema-1 compatibility: captures written before this field existed remain readable.
  if (value === undefined || value === null) return value === null ? null : undefined;
  if (!Array.isArray(value)) return undefined;
  const rows: TaskBenchmarkLocalSessionSnapshot[] = [];
  for (const item of value) {
    const parsed = parseLocalSessionSnapshot(item);
    if (parsed === null) return undefined;
    rows.push(parsed);
  }
  return rows;
}

/** Strip ccusage's extra fields before persisting an in-progress benchmark capture. */
export function snapshotTaskLocalSessions(
  sessions: readonly SessionHistoryRow[],
): TaskBenchmarkLocalSessionSnapshot[] {
  return sessions.map((session) => ({
    sessionId: session.sessionId,
    firstActivity: session.firstActivity,
    lastActivity: session.lastActivity,
    inputTokens: session.inputTokens,
    cacheCreationTokens: session.cacheCreationTokens,
    cacheReadTokens: session.cacheReadTokens,
    outputTokens: session.outputTokens,
    totalTokens: session.totalTokens,
  }));
}

/**
 * Derive one task's local usage from cumulative ccusage session counters.
 *
 * Deliberately conservative: exactly one session must show a positive counter delta and its latest
 * activity must fall inside the benchmark boundary. Parallel changed sessions are ambiguous and
 * return null rather than assigning somebody else's work to this task.
 */
export function deriveTaskLocalUsage(
  before: readonly TaskBenchmarkLocalSessionSnapshot[],
  after: readonly TaskBenchmarkLocalSessionSnapshot[],
  startedAt: string,
  completedAt: string,
): TaskLocalUsage | null {
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const beforeById = new Map(before.map((session) => [session.sessionId, session]));
  const changed: TaskLocalUsage[] = [];

  for (const current of after) {
    const last = current.lastActivity === null ? Number.NaN : Date.parse(current.lastActivity);
    if (!Number.isFinite(last) || last < start || last > end) continue;

    const previous = beforeById.get(current.sessionId);
    const base: TaskLocalUsage = previous ?? {
      inputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    };
    const delta: TaskLocalUsage = {
      inputTokens: current.inputTokens - base.inputTokens,
      cacheCreationTokens: current.cacheCreationTokens - base.cacheCreationTokens,
      cacheReadTokens: current.cacheReadTokens - base.cacheReadTokens,
      outputTokens: current.outputTokens - base.outputTokens,
      totalTokens: current.totalTokens - base.totalTokens,
    };
    if (Object.values(delta).some((value) => value < 0)) return null;
    if (delta.totalTokens > 0) changed.push(delta);
  }

  return changed.length === 1 ? (changed[0] ?? null) : null;
}

function parseOutcome(value: unknown): TaskBenchmarkOutcome | null {
  const row = record(value);
  if (row === null) return null;
  const qualityGate = row['qualityGate'];
  const attempts = row['attempts'];
  const failedAttempts = row['failedAttempts'];
  const errorCodes = row['errorCodes'];
  if (
    typeof qualityGate !== 'string' ||
    !isTaskQualityGate(qualityGate) ||
    typeof attempts !== 'number' ||
    !Number.isInteger(attempts) ||
    attempts < 1 ||
    typeof failedAttempts !== 'number' ||
    !Number.isInteger(failedAttempts) ||
    failedAttempts < 0 ||
    failedAttempts > attempts ||
    !Array.isArray(errorCodes) ||
    !errorCodes.every((code) => typeof code === 'string')
  ) {
    return null;
  }
  return {
    qualityGate,
    attempts,
    failedAttempts,
    errorCodes: [...errorCodes] as string[],
  };
}

/** Runtime parser for a locally persisted in-progress benchmark capture. */
export function parseTaskBenchmarkCapture(value: unknown): TaskBenchmarkCaptureParseResult {
  const row = record(value);
  if (row === null) {
    return { ok: false, reason: 'invalid-shape', message: 'capture must be a JSON object' };
  }
  if (row['schemaVersion'] !== TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      message: `capture schemaVersion must be ${String(TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION)}`,
    };
  }

  const benchmarkId = row['benchmarkId'];
  const variant = row['variant'];
  const taskClass = row['taskClass'];
  const harnessId = row['harnessId'];
  const projectId = row['projectId'];
  const model = optionalText(row['model']);
  const reasoningEffort = optionalText(row['reasoningEffort']);
  const verbosity = optionalText(row['verbosity']);
  const startedAt = row['startedAt'];
  const usageBefore = parseUsageWindows(row['usageBefore']);
  const parsedLocalSessions = parseLocalSessionSnapshots(row['localSessionsBefore']);
  const localSessionsBefore = parsedLocalSessions === undefined ? null : parsedLocalSessions;

  if (
    typeof benchmarkId !== 'string' ||
    !isTaskBenchmarkId(benchmarkId) ||
    typeof variant !== 'string' ||
    !isTaskBenchmarkVariant(variant) ||
    typeof taskClass !== 'string' ||
    !isTaskClass(taskClass) ||
    typeof harnessId !== 'string' ||
    !isHarnessId(harnessId) ||
    typeof projectId !== 'string' ||
    projectId === '' ||
    model === undefined ||
    reasoningEffort === undefined ||
    verbosity === undefined ||
    !validInstant(startedAt) ||
    usageBefore === null ||
    parsedLocalSessions === undefined
  ) {
    return {
      ok: false,
      reason: 'invalid-shape',
      message: 'capture fields do not match the paired task benchmark capture contract',
    };
  }

  return {
    ok: true,
    capture: {
      schemaVersion: TASK_BENCHMARK_CAPTURE_SCHEMA_VERSION,
      benchmarkId,
      variant,
      taskClass,
      harnessId,
      projectId,
      model,
      reasoningEffort,
      verbosity,
      startedAt,
      usageBefore,
      localSessionsBefore,
    },
  };
}

/** Runtime parser for user-supplied or fixture task receipts. */
export function parseTaskBenchmarkReceipt(value: unknown): TaskBenchmarkReceiptParseResult {
  const row = record(value);
  if (row === null) {
    return { ok: false, reason: 'invalid-shape', message: 'receipt must be a JSON object' };
  }
  if (row['schemaVersion'] !== TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: 'unsupported-schema',
      message: `receipt schemaVersion must be ${String(TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION)}`,
    };
  }

  const benchmarkId = row['benchmarkId'];
  const variant = row['variant'];
  const taskClass = row['taskClass'];
  const harnessId = row['harnessId'];
  const model = optionalText(row['model']);
  const reasoningEffort = optionalText(row['reasoningEffort']);
  const verbosity = optionalText(row['verbosity']);
  const startedAt = row['startedAt'];
  const completedAt = row['completedAt'];
  const usageBefore = parseUsageWindows(row['usageBefore']);
  const usageAfter = parseUsageWindows(row['usageAfter']);
  const localUsage = parseLocalUsage(row['localUsage']);
  const outcome = parseOutcome(row['outcome']);

  if (
    typeof benchmarkId !== 'string' ||
    benchmarkId === '' ||
    typeof variant !== 'string' ||
    !isTaskBenchmarkVariant(variant) ||
    typeof taskClass !== 'string' ||
    !isTaskClass(taskClass) ||
    typeof harnessId !== 'string' ||
    !isHarnessId(harnessId) ||
    model === undefined ||
    reasoningEffort === undefined ||
    verbosity === undefined ||
    !validInstant(startedAt) ||
    !validInstant(completedAt) ||
    Date.parse(completedAt) < Date.parse(startedAt) ||
    usageBefore === null ||
    usageAfter === null ||
    localUsage === undefined ||
    outcome === null
  ) {
    return {
      ok: false,
      reason: 'invalid-shape',
      message: 'receipt fields do not match the paired task benchmark contract',
    };
  }

  return {
    ok: true,
    receipt: {
      schemaVersion: TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION,
      benchmarkId,
      variant,
      taskClass,
      harnessId,
      model,
      reasoningEffort,
      verbosity,
      startedAt,
      completedAt,
      usageBefore,
      usageAfter,
      localUsage,
      outcome,
    },
  };
}

export interface CompleteTaskBenchmarkCaptureInput {
  completedAt: string;
  usageAfter: UsageWindowSnapshot[];
  qualityGate: TaskQualityGate;
  attempts: number;
  failedAttempts: number;
  errorCodes?: string[];
  localUsage?: TaskLocalUsage | null;
}

export function completeTaskBenchmarkCapture(
  capture: TaskBenchmarkCapture,
  input: CompleteTaskBenchmarkCaptureInput,
): TaskBenchmarkReceiptParseResult {
  return parseTaskBenchmarkReceipt({
    schemaVersion: TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION,
    benchmarkId: capture.benchmarkId,
    variant: capture.variant,
    taskClass: capture.taskClass,
    harnessId: capture.harnessId,
    model: capture.model,
    reasoningEffort: capture.reasoningEffort,
    verbosity: capture.verbosity,
    startedAt: capture.startedAt,
    completedAt: input.completedAt,
    usageBefore: capture.usageBefore,
    usageAfter: input.usageAfter,
    localUsage: input.localUsage ?? null,
    outcome: {
      qualityGate: input.qualityGate,
      attempts: input.attempts,
      failedAttempts: input.failedAttempts,
      errorCodes: input.errorCodes ?? [],
    },
  });
}

export interface ComparableQuotaDelta {
  key: string;
  scope: UsageWindowSnapshot['scope'];
  window: UsageWindowSnapshot['window'];
  bucketId: string | null;
  bucketName: string | null;
  source: UsageWindowSnapshot['source'];
  confidence: Extract<UsageConfidence, 'authoritative' | 'reported'>;
  beforeUsedPercent: number;
  afterUsedPercent: number;
  usedPercentDelta: number;
  resetsAt: string;
}

export type TaskBenchmarkVerdict =
  | 'optimized-better'
  | 'baseline-better'
  | 'equivalent'
  | 'inconclusive'
  | 'incomparable';

export type TaskBenchmarkBasis =
  | 'quality'
  | 'backend-quota'
  | 'failed-attempts'
  | 'runtime-errors'
  | 'attempts'
  | 'local-usage'
  | 'none';

export type TaskBenchmarkEvidenceLevel =
  | 'quota-backed'
  | 'local-evidence'
  | 'quality-only'
  | 'none';

export interface TaskBenchmarkQuotaComparison {
  key: string;
  scope: UsageWindowSnapshot['scope'];
  baselineDeltaUsedPercent: number;
  optimizedDeltaUsedPercent: number;
  confidence: Extract<UsageConfidence, 'authoritative' | 'reported'>;
}

export interface TaskBenchmarkComparison {
  benchmarkId: string;
  verdict: TaskBenchmarkVerdict;
  basis: TaskBenchmarkBasis;
  evidenceLevel: TaskBenchmarkEvidenceLevel;
  quota: TaskBenchmarkQuotaComparison | null;
  reasons: string[];
}

export interface TaskBenchmarkCompareReport {
  baseline: TaskBenchmarkReceipt;
  optimized: TaskBenchmarkReceipt;
  comparison: TaskBenchmarkComparison;
}

const QUOTA_SCOPE_PRIORITY: Readonly<Record<UsageWindowSnapshot['scope'], number>> = {
  'five-hour': 0,
  weekly: 1,
  model: 2,
  monthly: 3,
  credit: 4,
  unknown: 5,
};

function finitePercent(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 100;
}

function trustworthyConfidence(
  value: UsageConfidence,
): value is Extract<UsageConfidence, 'authoritative' | 'reported'> {
  return value === 'authoritative' || value === 'reported';
}

function snapshotIdentity(window: UsageWindowSnapshot): string {
  const bucket =
    window.bucketId !== null
      ? `id:${window.bucketId}`
      : window.bucketName !== null
        ? `name:${window.bucketName}`
        : 'anonymous';
  return [window.harnessId, bucket, window.scope, window.window ?? 'none', window.source].join('|');
}

function validTimeOrder(before: UsageWindowSnapshot, after: UsageWindowSnapshot): boolean {
  const beforeAt = Date.parse(before.observedAt);
  const afterAt = Date.parse(after.observedAt);
  const resetAt = after.resetsAt === null ? Number.NaN : Date.parse(after.resetsAt);
  return (
    Number.isFinite(beforeAt) &&
    Number.isFinite(afterAt) &&
    Number.isFinite(resetAt) &&
    afterAt >= beforeAt &&
    beforeAt <= resetAt &&
    afterAt <= resetAt
  );
}

/**
 * Extract backend quota deltas that are safe to compare within one task receipt.
 *
 * A delta is rejected when the window identity/source changed, either observation is
 * cached/estimated, reset timing is unknown/different, timestamps cross the reset, or the used
 * percentage moves backwards.
 */
export function comparableQuotaDeltas(receipt: TaskBenchmarkReceipt): ComparableQuotaDelta[] {
  const afterByIdentity = new Map<string, UsageWindowSnapshot[]>();
  for (const snapshot of receipt.usageAfter) {
    const key = snapshotIdentity(snapshot);
    const rows = afterByIdentity.get(key) ?? [];
    rows.push(snapshot);
    afterByIdentity.set(key, rows);
  }

  const deltas: ComparableQuotaDelta[] = [];
  for (const before of receipt.usageBefore) {
    const key = snapshotIdentity(before);
    const matches = afterByIdentity.get(key) ?? [];
    // Ambiguous identity means the backend did not give us enough coordinates to choose safely.
    if (matches.length !== 1) continue;
    const after = matches[0];
    if (after === undefined) continue;
    if (
      !finitePercent(before.usedPercent) ||
      !finitePercent(after.usedPercent) ||
      !trustworthyConfidence(before.confidence) ||
      !trustworthyConfidence(after.confidence) ||
      before.resetsAt === null ||
      after.resetsAt === null ||
      before.resetsAt !== after.resetsAt ||
      !validTimeOrder(before, after)
    ) {
      continue;
    }
    const delta = after.usedPercent - before.usedPercent;
    if (delta < 0) continue;

    deltas.push({
      key,
      scope: before.scope,
      window: before.window,
      bucketId: before.bucketId,
      bucketName: before.bucketName,
      source: before.source,
      confidence:
        before.confidence === 'authoritative' && after.confidence === 'authoritative'
          ? 'authoritative'
          : 'reported',
      beforeUsedPercent: before.usedPercent,
      afterUsedPercent: after.usedPercent,
      usedPercentDelta: delta,
      resetsAt: before.resetsAt,
    });
  }

  return deltas.sort(
    (left, right) =>
      QUOTA_SCOPE_PRIORITY[left.scope] - QUOTA_SCOPE_PRIORITY[right.scope] ||
      left.key.localeCompare(right.key),
  );
}

function pairedQuota(
  baseline: TaskBenchmarkReceipt,
  optimized: TaskBenchmarkReceipt,
): TaskBenchmarkQuotaComparison | null {
  const baselineDeltas = comparableQuotaDeltas(baseline);
  const optimizedByKey = new Map(
    comparableQuotaDeltas(optimized).map((delta) => [delta.key, delta]),
  );

  for (const base of baselineDeltas) {
    const optimizedDelta = optimizedByKey.get(base.key);
    if (optimizedDelta === undefined) continue;
    return {
      key: base.key,
      scope: base.scope,
      baselineDeltaUsedPercent: base.usedPercentDelta,
      optimizedDeltaUsedPercent: optimizedDelta.usedPercentDelta,
      confidence:
        base.confidence === 'authoritative' && optimizedDelta.confidence === 'authoritative'
          ? 'authoritative'
          : 'reported',
    };
  }
  return null;
}

function result(
  benchmarkId: string,
  verdict: TaskBenchmarkVerdict,
  basis: TaskBenchmarkBasis,
  evidenceLevel: TaskBenchmarkEvidenceLevel,
  quota: TaskBenchmarkQuotaComparison | null,
  reasons: string[],
): TaskBenchmarkComparison {
  return { benchmarkId, verdict, basis, evidenceLevel, quota, reasons };
}

/**
 * Compare one baseline/optimized pair without inventing a composite score.
 *
 * Decision order:
 * 1. task identity/class and baseline/optimized roles must match;
 * 2. a known quality regression always loses;
 * 3. both sides must pass the quality gate before efficiency can decide;
 * 4. comparable backend quota delta is the primary efficiency evidence;
 * 5. failed attempts, runtime errors, total attempts and local token volume are secondary evidence.
 */
export function compareTaskBenchmarkReceipts(
  baseline: TaskBenchmarkReceipt,
  optimized: TaskBenchmarkReceipt,
): TaskBenchmarkComparison {
  const reasons: string[] = [];
  if (
    baseline.benchmarkId !== optimized.benchmarkId ||
    baseline.taskClass !== optimized.taskClass ||
    baseline.harnessId !== optimized.harnessId ||
    baseline.variant !== 'baseline' ||
    optimized.variant !== 'optimized'
  ) {
    return result(baseline.benchmarkId, 'incomparable', 'none', 'none', null, [
      'receipts do not describe the same benchmark task/class and baseline/optimized roles',
    ]);
  }

  const baselineQuality = baseline.outcome.qualityGate;
  const optimizedQuality = optimized.outcome.qualityGate;
  if (baselineQuality === 'passed' && optimizedQuality === 'failed') {
    return result(baseline.benchmarkId, 'baseline-better', 'quality', 'quality-only', null, [
      'optimized receipt failed a quality gate that baseline passed',
    ]);
  }
  if (baselineQuality === 'failed' && optimizedQuality === 'passed') {
    return result(baseline.benchmarkId, 'optimized-better', 'quality', 'quality-only', null, [
      'optimized receipt passed a quality gate that baseline failed',
    ]);
  }
  if (baselineQuality !== 'passed' || optimizedQuality !== 'passed') {
    return result(baseline.benchmarkId, 'inconclusive', 'quality', 'none', null, [
      'both receipts must pass an explicit quality gate before efficiency can be compared',
    ]);
  }

  const quota = pairedQuota(baseline, optimized);
  if (quota !== null) {
    if (optimized.outcome.failedAttempts > baseline.outcome.failedAttempts) {
      reasons.push('optimized run had more failed attempts');
    }
    if (optimized.outcome.errorCodes.length > baseline.outcome.errorCodes.length) {
      reasons.push('optimized run recorded more runtime/provider errors');
    }

    if (quota.optimizedDeltaUsedPercent < quota.baselineDeltaUsedPercent) {
      return result(
        baseline.benchmarkId,
        'optimized-better',
        'backend-quota',
        'quota-backed',
        quota,
        [
          ...reasons,
          'both quality gates passed and optimized consumed a smaller comparable backend quota delta',
        ],
      );
    }
    if (quota.optimizedDeltaUsedPercent > quota.baselineDeltaUsedPercent) {
      return result(
        baseline.benchmarkId,
        'baseline-better',
        'backend-quota',
        'quota-backed',
        quota,
        [
          ...reasons,
          'both quality gates passed and baseline consumed a smaller comparable backend quota delta',
        ],
      );
    }
    reasons.push('comparable backend quota delta was equal');
  } else {
    reasons.push('no comparable authoritative/reported backend quota window was available');
  }

  if (optimized.outcome.failedAttempts !== baseline.outcome.failedAttempts) {
    return result(
      baseline.benchmarkId,
      optimized.outcome.failedAttempts < baseline.outcome.failedAttempts
        ? 'optimized-better'
        : 'baseline-better',
      'failed-attempts',
      'local-evidence',
      quota,
      [...reasons, 'winner had fewer failed attempts'],
    );
  }

  if (optimized.outcome.errorCodes.length !== baseline.outcome.errorCodes.length) {
    return result(
      baseline.benchmarkId,
      optimized.outcome.errorCodes.length < baseline.outcome.errorCodes.length
        ? 'optimized-better'
        : 'baseline-better',
      'runtime-errors',
      'local-evidence',
      quota,
      [...reasons, 'winner recorded fewer runtime/provider errors'],
    );
  }

  if (optimized.outcome.attempts !== baseline.outcome.attempts) {
    return result(
      baseline.benchmarkId,
      optimized.outcome.attempts < baseline.outcome.attempts
        ? 'optimized-better'
        : 'baseline-better',
      'attempts',
      'local-evidence',
      quota,
      [...reasons, 'winner completed the quality-gated task in fewer attempts'],
    );
  }

  if (
    baseline.localUsage !== null &&
    optimized.localUsage !== null &&
    baseline.localUsage.totalTokens !== optimized.localUsage.totalTokens
  ) {
    return result(
      baseline.benchmarkId,
      optimized.localUsage.totalTokens < baseline.localUsage.totalTokens
        ? 'optimized-better'
        : 'baseline-better',
      'local-usage',
      'local-evidence',
      quota,
      [...reasons, 'winner used fewer locally observed tokens; this is not a backend quota claim'],
    );
  }

  if (quota !== null) {
    return result(baseline.benchmarkId, 'equivalent', 'backend-quota', 'quota-backed', quota, [
      ...reasons,
      'quality and all available secondary costs were equal',
    ]);
  }

  return result(baseline.benchmarkId, 'inconclusive', 'none', 'none', null, [
    ...reasons,
    'quality matched but no efficiency evidence separated the receipts',
  ]);
}

export interface TaskBenchmarkMatrixPair {
  baseline: TaskBenchmarkReceipt;
  optimized: TaskBenchmarkReceipt;
}

export interface TaskBenchmarkMatrixEntry {
  benchmarkId: string;
  taskClass: TaskClass;
  harnessId: HarnessId;
  verdict: TaskBenchmarkVerdict;
  basis: TaskBenchmarkBasis;
  evidenceLevel: TaskBenchmarkEvidenceLevel;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
  quota: TaskBenchmarkQuotaComparison | null;
}

export interface TaskBenchmarkMatrixSummary {
  taskClass: TaskClass | null;
  pairs: number;
  optimizedBetter: number;
  baselineBetter: number;
  equivalent: number;
  inconclusive: number;
  incomparable: number;
  quotaBacked: number;
  localEvidence: number;
  qualityOnly: number;
  localComparablePairs: number;
  baselineLocalTokens: number | null;
  optimizedLocalTokens: number | null;
  localTokenSavingPercent: number | null;
}

export interface TaskBenchmarkMatrixReport {
  entries: TaskBenchmarkMatrixEntry[];
  byTaskClass: TaskBenchmarkMatrixSummary[];
  overall: TaskBenchmarkMatrixSummary;
}

const TASK_CLASS_ORDER: readonly TaskClass[] = ['mechanical', 'standard', 'hard', 'critical'];

function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function summarizeMatrixEntries(
  entries: readonly TaskBenchmarkMatrixEntry[],
  taskClass: TaskClass | null,
): TaskBenchmarkMatrixSummary {
  const local = entries.filter(
    (entry) => entry.baselineLocalTokens !== null && entry.optimizedLocalTokens !== null,
  );
  const baselineLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.baselineLocalTokens ?? 0), 0);
  const optimizedLocalTokens =
    local.length === 0
      ? null
      : local.reduce((total, entry) => total + (entry.optimizedLocalTokens ?? 0), 0);

  return {
    taskClass,
    pairs: entries.length,
    optimizedBetter: entries.filter((entry) => entry.verdict === 'optimized-better').length,
    baselineBetter: entries.filter((entry) => entry.verdict === 'baseline-better').length,
    equivalent: entries.filter((entry) => entry.verdict === 'equivalent').length,
    inconclusive: entries.filter((entry) => entry.verdict === 'inconclusive').length,
    incomparable: entries.filter((entry) => entry.verdict === 'incomparable').length,
    quotaBacked: entries.filter((entry) => entry.evidenceLevel === 'quota-backed').length,
    localEvidence: entries.filter((entry) => entry.evidenceLevel === 'local-evidence').length,
    qualityOnly: entries.filter((entry) => entry.evidenceLevel === 'quality-only').length,
    localComparablePairs: local.length,
    baselineLocalTokens,
    optimizedLocalTokens,
    localTokenSavingPercent:
      baselineLocalTokens === null || optimizedLocalTokens === null
        ? null
        : roundedPercent(baselineLocalTokens - optimizedLocalTokens, baselineLocalTokens),
  };
}

/**
 * Aggregate already-paired empirical receipts without inventing a composite efficiency score.
 *
 * Each row keeps the deterministic pair verdict. Summary counts say how often optimized won or
 * lost and how strong the evidence was; local token totals are aggregated only across pairs where
 * both variants have attributable local usage. Backend quota percentages are deliberately not
 * summed across different windows/resets.
 */
export function buildTaskBenchmarkMatrix(
  pairs: readonly TaskBenchmarkMatrixPair[],
): TaskBenchmarkMatrixReport {
  const entries = pairs
    .map(({ baseline, optimized }): TaskBenchmarkMatrixEntry => {
      const comparison = compareTaskBenchmarkReceipts(baseline, optimized);
      const baselineLocalTokens = baseline.localUsage?.totalTokens ?? null;
      const optimizedLocalTokens = optimized.localUsage?.totalTokens ?? null;
      return {
        benchmarkId: baseline.benchmarkId,
        taskClass: baseline.taskClass,
        harnessId: baseline.harnessId,
        verdict: comparison.verdict,
        basis: comparison.basis,
        evidenceLevel: comparison.evidenceLevel,
        baselineLocalTokens,
        optimizedLocalTokens,
        localTokenSavingPercent:
          baselineLocalTokens === null || optimizedLocalTokens === null
            ? null
            : roundedPercent(baselineLocalTokens - optimizedLocalTokens, baselineLocalTokens),
        quota: comparison.quota,
      };
    })
    .sort(
      (left, right) =>
        TASK_CLASS_ORDER.indexOf(left.taskClass) - TASK_CLASS_ORDER.indexOf(right.taskClass) ||
        left.benchmarkId.localeCompare(right.benchmarkId),
    );

  const byTaskClass = TASK_CLASS_ORDER.map((taskClass) => ({
    taskClass,
    rows: entries.filter((entry) => entry.taskClass === taskClass),
  }))
    .filter(({ rows }) => rows.length > 0)
    .map(({ taskClass, rows }) => summarizeMatrixEntries(rows, taskClass));

  return {
    entries,
    byTaskClass,
    overall: summarizeMatrixEntries(entries, null),
  };
}

