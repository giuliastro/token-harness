/**
 * Paired task benchmark receipts — RFC 0011 measurement foundation.
 *
 * The comparator is deliberately conservative. Quality must be known before efficiency can win,
 * backend quota is compared only when the same non-reset window is observed through the same
 * supported source, and local token volume is never promoted into subscription quota.
 */

import type { UsageConfidence, UsageWindowSnapshot } from './budget.js';
import { isHarnessId, type HarnessId } from './ids.js';
import { isTaskClass, type TaskClass } from './optimizer.js';

export const TASK_BENCHMARK_RECEIPT_SCHEMA_VERSION = 1;

export type TaskBenchmarkVariant = 'baseline' | 'optimized';
export type TaskQualityGate = 'passed' | 'failed' | 'unknown';

export interface TaskLocalUsage {
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalTokens: number;
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
const QUALITY_GATES = new Set(['passed', 'failed', 'unknown']);

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
  return value === null ? null : finiteNonNegative(value) ?? undefined;
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

function parseOutcome(value: unknown): TaskBenchmarkOutcome | null {
  const row = record(value);
  if (row === null) return null;
  const qualityGate = row['qualityGate'];
  const attempts = row['attempts'];
  const failedAttempts = row['failedAttempts'];
  const errorCodes = row['errorCodes'];
  if (
    typeof qualityGate !== 'string' ||
    !QUALITY_GATES.has(qualityGate) ||
    !Number.isInteger(attempts) ||
    typeof attempts !== 'number' ||
    attempts < 1 ||
    !Number.isInteger(failedAttempts) ||
    typeof failedAttempts !== 'number' ||
    failedAttempts < 0 ||
    failedAttempts > attempts ||
    !Array.isArray(errorCodes) ||
    !errorCodes.every((code) => typeof code === 'string')
  ) {
    return null;
  }
  return {
    qualityGate: qualityGate as TaskQualityGate,
    attempts,
    failedAttempts,
    errorCodes: [...errorCodes] as string[],
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
    !(variant === 'baseline' || variant === 'optimized') ||
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
