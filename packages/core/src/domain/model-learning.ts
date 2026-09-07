import {
  comparableQuotaDeltas,
  isTaskBenchmarkId,
  parseTaskBenchmarkReceipt,
  type TaskBenchmarkReceipt,
} from './benchmark.js';
import type { HarnessId } from './ids.js';
import type { RecommendationEvidence, TaskClass } from './optimizer.js';

export const MODEL_LEARNING_MIN_PAIRS = 3;
export const MODEL_LEARNING_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
export const MODEL_LEARNING_MAX_RECEIPTS = 400;

export type ModelLearningBasis = 'quality' | 'attempts' | 'backend-quota' | 'local-tokens';
export type ModelLearningIntent = 'allowance-efficiency' | 'quality-recovery';

export interface ModelCandidateEvidence {
  model: string;
  wins: number;
  losses: number;
  ties: number;
  inconclusive: number;
  qualityFailures: number;
  bases: Record<ModelLearningBasis, number>;
}

export interface ModelLearningDecision {
  harnessId: HarnessId;
  state: 'unavailable' | 'insufficient-evidence' | 'learned' | 'deferred';
  verification: 'config-only';
  policy: { reasoningEffort: string | null; verbosity: string | null };
  baseModel: string | null;
  recommendedModel: string | null;
  candidateModel: string | null;
  intent: ModelLearningIntent | null;
  minimumPairs: number;
  matchedReceipts: number;
  ignoredReceipts: number;
  candidates: ModelCandidateEvidence[];
  reasons: RecommendationEvidence[];
}

export interface ModelLearningInput {
  harnessId: HarnessId;
  baseModel: string | null;
  reasoningEffort: string | null;
  verbosity: string | null;
  taskClass: TaskClass;
  /** Exact model ids returned by the current native catalog. */
  availableModels: readonly string[];
  now: string;
  /** Already bounded and project-attributed by the optimization-history reader. */
  receipts: readonly TaskBenchmarkReceipt[] | null;
}

function usableOutcome(row: TaskBenchmarkReceipt): boolean {
  const outcome = row.outcome;
  return (
    Number.isSafeInteger(outcome.attempts) &&
    Number.isSafeInteger(outcome.failedAttempts) &&
    outcome.attempts > 0 &&
    outcome.failedAttempts >= 0 &&
    outcome.failedAttempts <= outcome.attempts &&
    (outcome.qualityGate !== 'passed' || outcome.failedAttempts < outcome.attempts)
  );
}

function stablePolicy(row: TaskBenchmarkReceipt): boolean {
  const end = row.policyAtFinish;
  return (
    end != null &&
    end.verification === 'config-only' &&
    row.model !== null &&
    row.model !== '' &&
    row.reasoningEffort !== null &&
    row.verbosity !== null &&
    end.model === row.model &&
    end.reasoningEffort === row.reasoningEffort &&
    end.verbosity === row.verbosity
  );
}

function runKey(row: TaskBenchmarkReceipt): string {
  return JSON.stringify([
    row.harnessId,
    row.model,
    row.reasoningEffort,
    row.verbosity,
    row.startedAt,
    row.completedAt,
  ]);
}

function overlaps(a: TaskBenchmarkReceipt, b: TaskBenchmarkReceipt): boolean {
  return (
    Date.parse(a.startedAt) < Date.parse(b.completedAt) &&
    Date.parse(b.startedAt) < Date.parse(a.completedAt)
  );
}

function tokenVolume(row: TaskBenchmarkReceipt): number | null {
  const usage = row.localUsage;
  if (
    usage === null ||
    !Object.values(usage).every((value) => Number.isSafeInteger(value) && value >= 0)
  ) {
    return null;
  }
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return total === usage.totalTokens && Number.isSafeInteger(total) ? total : null;
}

type PairVerdict = {
  verdict: 'win' | 'loss' | 'tie' | 'unknown';
  basis: ModelLearningBasis | null;
};

function compare(base: TaskBenchmarkReceipt, candidate: TaskBenchmarkReceipt): PairVerdict {
  const verdict = (
    value: PairVerdict['verdict'],
    basis: ModelLearningBasis | null = null,
  ): PairVerdict => ({ verdict: value, basis });

  if (base.outcome.errorCodes.length > 0 || candidate.outcome.errorCodes.length > 0) {
    return verdict('unknown');
  }
  if (candidate.outcome.qualityGate === 'failed') return verdict('loss');
  if (candidate.outcome.qualityGate !== 'passed' || base.outcome.qualityGate === 'unknown') {
    return verdict('unknown');
  }
  if (base.outcome.qualityGate === 'failed') return verdict('win', 'quality');
  if (
    candidate.outcome.failedAttempts > base.outcome.failedAttempts ||
    candidate.outcome.attempts > base.outcome.attempts
  ) {
    return verdict('loss');
  }

  const candidateQuota = new Map(
    comparableQuotaDeltas(candidate)
      .filter((delta) => delta.scope === 'five-hour' || delta.scope === 'weekly')
      .map((delta) => [delta.key, delta]),
  );
  let quotaImproved = false;
  for (const baseDelta of comparableQuotaDeltas(base).filter(
    (delta) => delta.scope === 'five-hour' || delta.scope === 'weekly',
  )) {
    const candidateDelta = candidateQuota.get(baseDelta.key);
    if (candidateDelta === undefined || candidateDelta.resetsAt !== baseDelta.resetsAt) continue;
    if (candidateDelta.usedPercentDelta > baseDelta.usedPercentDelta + 1e-9) return verdict('loss');
    if (baseDelta.usedPercentDelta - candidateDelta.usedPercentDelta >= 1) quotaImproved = true;
  }

  if (
    candidate.outcome.failedAttempts < base.outcome.failedAttempts ||
    candidate.outcome.attempts < base.outcome.attempts
  ) {
    return verdict('win', 'attempts');
  }
  if (quotaImproved) return verdict('win', 'backend-quota');

  const baseTokens = tokenVolume(base);
  const candidateTokens = tokenVolume(candidate);
  if (baseTokens !== null && baseTokens > 0 && candidateTokens !== null) {
    if (candidateTokens > baseTokens) return verdict('loss');
    if ((baseTokens - candidateTokens) / baseTokens >= 0.05) return verdict('win', 'local-tokens');
    return verdict('tie');
  }
  return verdict('unknown');
}

/**
 * Find one outcome-safe model alternative while reasoning effort and verbosity remain fixed.
 *
 * This stage deliberately does not infer model tiers from names and does not make an allowance
 * claim. `refineModelForAllowance` must separately prove exact-policy subscription benefit before
 * an efficiency-driven switch can become actionable.
 */
export function refineModelWithOutcomes(input: ModelLearningInput): ModelLearningDecision {
  const decision: ModelLearningDecision = {
    harnessId: input.harnessId,
    state: 'insufficient-evidence',
    verification: 'config-only',
    policy: { reasoningEffort: input.reasoningEffort, verbosity: input.verbosity },
    baseModel: input.baseModel,
    recommendedModel: input.baseModel,
    candidateModel: null,
    intent: null,
    minimumPairs: MODEL_LEARNING_MIN_PAIRS,
    matchedReceipts: 0,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [],
  };
  const finish = (
    state: ModelLearningDecision['state'],
    code: string,
    summary: string,
  ): ModelLearningDecision => {
    decision.state = state;
    decision.reasons.push({ code, summary });
    return decision;
  };

  const now = Date.parse(input.now);
  if (
    input.receipts === null ||
    input.receipts.length > MODEL_LEARNING_MAX_RECEIPTS ||
    !Number.isFinite(now)
  ) {
    return finish(
      'unavailable',
      'model-outcome-history-unavailable',
      'Complete bounded project history is unavailable; no learned model is applied',
    );
  }

  const catalog = [...new Set(input.availableModels)].filter((model) => model !== '');
  if (
    input.baseModel === null ||
    input.baseModel === '' ||
    input.reasoningEffort === null ||
    input.reasoningEffort === '' ||
    input.verbosity === null ||
    input.verbosity === '' ||
    !catalog.includes(input.baseModel)
  ) {
    return finish(
      'insufficient-evidence',
      'model-policy-identity-unknown',
      'A catalogued current model with fixed reasoning effort and verbosity is required for learning',
    );
  }

  const rowsById = new Map<string, TaskBenchmarkReceipt>();
  const runs = new Map<string, Set<string>>();
  for (const raw of input.receipts) {
    const parsed = parseTaskBenchmarkReceipt(raw);
    if (!parsed.ok) {
      return finish(
        'unavailable',
        'model-receipt-invalid',
        'Malformed history cannot be silently dropped while learning model choice',
      );
    }
    const row = parsed.receipt;
    if (
      row.harnessId !== input.harnessId ||
      row.taskClass !== input.taskClass ||
      row.reasoningEffort !== input.reasoningEffort ||
      row.verbosity !== input.verbosity ||
      row.model === null ||
      !catalog.includes(row.model) ||
      Date.parse(row.completedAt) > now ||
      Date.parse(row.startedAt) < now - MODEL_LEARNING_MAX_AGE_MS ||
      Date.parse(row.completedAt) <= Date.parse(row.startedAt) ||
      !isTaskBenchmarkId(row.benchmarkId)
    ) {
      decision.ignoredReceipts += 1;
      continue;
    }
    if (!usableOutcome(row)) {
      return finish(
        'unavailable',
        'model-outcome-counts-invalid',
        'Invalid outcome counts prevent a learned model change',
      );
    }
    if (!stablePolicy(row)) {
      decision.ignoredReceipts += 1;
      continue;
    }
    const identity = JSON.stringify([row.benchmarkId, row.variant]);
    const previous = rowsById.get(identity);
    if (previous !== undefined) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) {
        return finish(
          'unavailable',
          'model-receipt-conflict',
          'Conflicting copies of one task receipt prevent learned model changes',
        );
      }
      decision.ignoredReceipts += 1;
      continue;
    }
    rowsById.set(identity, row);
    const owners = runs.get(runKey(row)) ?? new Set<string>();
    owners.add(row.benchmarkId);
    runs.set(runKey(row), owners);
  }

  const rows = [...rowsById.values()].sort(
    (a, b) =>
      a.startedAt.localeCompare(b.startedAt) ||
      a.benchmarkId.localeCompare(b.benchmarkId) ||
      a.variant.localeCompare(b.variant),
  );
  decision.matchedReceipts = rows.length;
  const baseRows = rows.filter((row) => row.model === input.baseModel);
  const uniqueBaseFailures = new Set(
    baseRows
      .filter((row) => row.outcome.qualityGate === 'failed' && row.outcome.errorCodes.length === 0)
      .map(runKey),
  ).size;
  const basePassed = baseRows.some((row) => row.outcome.qualityGate === 'passed');

  for (const model of catalog.filter((candidate) => candidate !== input.baseModel).sort()) {
    const evidence: ModelCandidateEvidence = {
      model,
      wins: 0,
      losses: 0,
      ties: 0,
      inconclusive: 0,
      qualityFailures: rows.filter(
        (row) => row.model === model && row.outcome.qualityGate === 'failed',
      ).length,
      bases: { quality: 0, attempts: 0, 'backend-quota': 0, 'local-tokens': 0 },
    };
    const pairs: Array<{ base: TaskBenchmarkReceipt; candidate: TaskBenchmarkReceipt }> = [];
    for (const base of baseRows) {
      const otherVariant = base.variant === 'baseline' ? 'optimized' : 'baseline';
      const candidate = rowsById.get(JSON.stringify([base.benchmarkId, otherVariant]));
      if (candidate?.model !== model) continue;
      pairs.push({ base, candidate });
    }
    for (const pair of pairs) {
      const reused =
        runs.get(runKey(pair.base))!.size > 1 || runs.get(runKey(pair.candidate))!.size > 1;
      const concurrent =
        overlaps(pair.base, pair.candidate) ||
        pairs.some(
          (other) =>
            other !== pair &&
            [pair.base, pair.candidate].some((a) =>
              [other.base, other.candidate].some((b) => overlaps(a, b)),
            ),
        );
      if (reused || concurrent) {
        evidence.inconclusive += 1;
        continue;
      }
      const comparison = compare(pair.base, pair.candidate);
      if (comparison.verdict === 'win') {
        evidence.wins += 1;
        evidence.bases[comparison.basis!] += 1;
      } else if (comparison.verdict === 'loss') evidence.losses += 1;
      else if (comparison.verdict === 'tie') evidence.ties += 1;
      else evidence.inconclusive += 1;
    }
    if (pairs.length > 0 || evidence.qualityFailures > 0) decision.candidates.push(evidence);
  }

  const eligible = decision.candidates
    .filter(
      (candidate) =>
        candidate.wins >= MODEL_LEARNING_MIN_PAIRS &&
        candidate.losses === 0 &&
        candidate.inconclusive === 0 &&
        candidate.qualityFailures === 0,
    )
    .sort(
      (a, b) =>
        b.bases.quality + b.bases.attempts - (a.bases.quality + a.bases.attempts) ||
        b.wins - a.wins ||
        a.model.localeCompare(b.model),
    );

  const best = eligible[0];
  if (best === undefined) {
    if (uniqueBaseFailures >= 2 && !basePassed) {
      decision.recommendedModel = null;
      return finish(
        'deferred',
        'model-repeated-failure',
        'The current model repeatedly failed this task class and no proven catalog alternative is ready',
      );
    }
    return finish(
      'insufficient-evidence',
      'model-more-pairs-needed',
      'Keep the current model until three distinct paired comparisons support a catalog alternative without contrary or unknown outcomes',
    );
  }

  decision.candidateModel = best.model;
  decision.recommendedModel = best.model;
  decision.intent =
    uniqueBaseFailures >= 2 &&
    !basePassed &&
    best.bases.quality + best.bases.attempts >= MODEL_LEARNING_MIN_PAIRS
      ? 'quality-recovery'
      : 'allowance-efficiency';
  return finish(
    'learned',
    decision.intent === 'quality-recovery'
      ? 'model-quality-recovery-candidate'
      : 'model-outcome-safe-candidate',
    decision.intent === 'quality-recovery'
      ? `Repeated outcomes support ${best.model} as a quality-recovery candidate at fixed effort and verbosity`
      : `Repeated outcomes support ${best.model} as an outcome-safe candidate; allowance benefit still requires exact-policy proof`,
  );
}
