import {
  comparableQuotaDeltas,
  isTaskBenchmarkId,
  parseTaskBenchmarkReceipt,
  type TaskBenchmarkReceipt,
} from './benchmark.js';
import type { BudgetDecision } from './budget-policy.js';
import type { HarnessId } from './ids.js';
import type { ContextPressure, RecommendationEvidence, TaskClass } from './optimizer.js';

export const VERBOSITY_LEVELS = ['low', 'medium', 'high'] as const;
export const VERBOSITY_LEARNING_MIN_PAIRS = 3;
export const VERBOSITY_LEARNING_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
export const VERBOSITY_LEARNING_MAX_RECEIPTS = 400;

export type VerbosityLearningBasis = 'quality' | 'attempts' | 'backend-quota' | 'local-tokens';

export interface VerbosityCandidateEvidence {
  verbosity: string;
  wins: number;
  losses: number;
  ties: number;
  inconclusive: number;
  qualityFailures: number;
  bases: Record<VerbosityLearningBasis, number>;
}

export interface VerbosityLearningDecision {
  state: 'unavailable' | 'insufficient-evidence' | 'kept' | 'learned' | 'deferred';
  verification: 'config-only';
  policy: { model: string | null; reasoningEffort: string | null };
  baseVerbosity: string | null;
  recommendedVerbosity: string | null;
  candidateVerbosity: string | null;
  minimumPairs: number;
  matchedReceipts: number;
  ignoredReceipts: number;
  candidates: VerbosityCandidateEvidence[];
  reasons: RecommendationEvidence[];
}

export interface VerbosityLearningInput {
  harnessId: HarnessId;
  model: string | null;
  reasoningEffort: string | null;
  taskClass: TaskClass;
  supported: readonly string[];
  baseVerbosity: string | null;
  budget: BudgetDecision;
  contextPressure: ContextPressure;
  now: string;
  /** Already project-attributed by the bounded optimization-history reader. */
  receipts: readonly TaskBenchmarkReceipt[] | null;
}

export function verbosityRank(value: string | null): number | null {
  if (value === null) return null;
  const rank = (VERBOSITY_LEVELS as readonly string[]).indexOf(value);
  return rank === -1 ? null : rank;
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
  if (usage === null || !Object.values(usage).every((value) => Number.isSafeInteger(value) && value >= 0)) {
    return null;
  }
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return total === usage.totalTokens && Number.isSafeInteger(total) ? total : null;
}

type PairVerdict = {
  verdict: 'win' | 'loss' | 'tie' | 'unknown';
  basis: VerbosityLearningBasis | null;
};

function compare(base: TaskBenchmarkReceipt, candidate: TaskBenchmarkReceipt): PairVerdict {
  const verdict = (
    value: PairVerdict['verdict'],
    basis: VerbosityLearningBasis | null = null,
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
 * Learn one verbosity change while model and reasoning effort remain fixed.
 *
 * This learner only establishes an outcome-safe candidate. A lower verbosity is not actionable
 * until the quality-per-allowance refiner separately proves exact-policy backend quota benefit.
 */
export function refineVerbosityWithOutcomes(
  input: VerbosityLearningInput,
): VerbosityLearningDecision {
  const decision: VerbosityLearningDecision = {
    state: 'insufficient-evidence',
    verification: 'config-only',
    policy: { model: input.model, reasoningEffort: input.reasoningEffort },
    baseVerbosity: input.baseVerbosity,
    recommendedVerbosity: input.baseVerbosity,
    candidateVerbosity: null,
    minimumPairs: VERBOSITY_LEARNING_MIN_PAIRS,
    matchedReceipts: 0,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [],
  };
  const finish = (
    state: VerbosityLearningDecision['state'],
    code: string,
    summary: string,
  ): VerbosityLearningDecision => {
    decision.state = state;
    decision.reasons.push({ code, summary });
    return decision;
  };

  const now = Date.parse(input.now);
  if (
    input.receipts === null ||
    input.receipts.length > VERBOSITY_LEARNING_MAX_RECEIPTS ||
    !Number.isFinite(now)
  ) {
    return finish(
      'unavailable',
      'verbosity-outcome-history-unavailable',
      'Complete bounded project history is unavailable; no learned verbosity is applied',
    );
  }

  const baseRank = verbosityRank(input.baseVerbosity);
  if (
    input.model === null ||
    input.model === '' ||
    input.reasoningEffort === null ||
    input.reasoningEffort === '' ||
    input.baseVerbosity === null ||
    baseRank === null ||
    !input.supported.includes(input.baseVerbosity)
  ) {
    return finish(
      'insufficient-evidence',
      'verbosity-policy-identity-unknown',
      'A known model, fixed reasoning effort and supported configured verbosity are required for learning',
    );
  }

  const rowsById = new Map<string, TaskBenchmarkReceipt>();
  const runs = new Map<string, Set<string>>();
  for (const raw of input.receipts) {
    const parsed = parseTaskBenchmarkReceipt(raw);
    if (!parsed.ok) {
      return finish(
        'unavailable',
        'verbosity-receipt-invalid',
        'Malformed history cannot be silently dropped while learning verbosity',
      );
    }
    const row = parsed.receipt;
    if (
      row.harnessId !== input.harnessId ||
      row.taskClass !== input.taskClass ||
      row.model !== input.model ||
      row.reasoningEffort !== input.reasoningEffort ||
      Date.parse(row.completedAt) > now ||
      Date.parse(row.startedAt) < now - VERBOSITY_LEARNING_MAX_AGE_MS ||
      Date.parse(row.completedAt) <= Date.parse(row.startedAt) ||
      !isTaskBenchmarkId(row.benchmarkId)
    ) {
      decision.ignoredReceipts += 1;
      continue;
    }
    if (!usableOutcome(row)) {
      return finish(
        'unavailable',
        'verbosity-outcome-counts-invalid',
        'Invalid outcome counts prevent a learned verbosity change',
      );
    }
    if (!stablePolicy(row) || verbosityRank(row.verbosity) === null || !input.supported.includes(row.verbosity!)) {
      decision.ignoredReceipts += 1;
      continue;
    }
    const identity = JSON.stringify([row.benchmarkId, row.variant]);
    const previous = rowsById.get(identity);
    if (previous !== undefined) {
      if (JSON.stringify(previous) !== JSON.stringify(row)) {
        return finish(
          'unavailable',
          'verbosity-receipt-conflict',
          'Conflicting copies of one task receipt prevent learned verbosity changes',
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
  const baseRows = rows.filter((row) => row.verbosity === input.baseVerbosity);
  const baseFailures = baseRows.filter(
    (row) => row.outcome.qualityGate === 'failed' && row.outcome.errorCodes.length === 0,
  );
  const uniqueBaseFailures = new Set(baseFailures.map(runKey)).size;
  const basePassed = baseRows.some((row) => row.outcome.qualityGate === 'passed');

  const options = [...new Set(input.supported)]
    .filter((verbosity) => verbosity !== input.baseVerbosity && verbosityRank(verbosity) !== null)
    .sort((a, b) => verbosityRank(a)! - verbosityRank(b)!);

  for (const verbosity of options) {
    const evidence: VerbosityCandidateEvidence = {
      verbosity,
      wins: 0,
      losses: 0,
      ties: 0,
      inconclusive: 0,
      qualityFailures: rows.filter(
        (row) => row.verbosity === verbosity && row.outcome.qualityGate === 'failed',
      ).length,
      bases: { quality: 0, attempts: 0, 'backend-quota': 0, 'local-tokens': 0 },
    };
    const pairs: Array<{ base: TaskBenchmarkReceipt; candidate: TaskBenchmarkReceipt }> = [];
    for (const base of baseRows) {
      const otherVariant = base.variant === 'baseline' ? 'optimized' : 'baseline';
      const candidate = rowsById.get(JSON.stringify([base.benchmarkId, otherVariant]));
      if (candidate?.verbosity !== verbosity) continue;
      pairs.push({ base, candidate });
    }
    evidence.inconclusive += rows.filter(
      (row) =>
        row.verbosity === verbosity &&
        (row.outcome.qualityGate === 'unknown' || row.outcome.errorCodes.length > 0) &&
        !pairs.some((pair) => pair.candidate === row),
    ).length;

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
    .filter((candidate) => {
      const rank = verbosityRank(candidate.verbosity)!;
      const higher = rank > baseRank;
      return (
        candidate.wins >= VERBOSITY_LEARNING_MIN_PAIRS &&
        candidate.losses === 0 &&
        candidate.inconclusive === 0 &&
        candidate.qualityFailures === 0 &&
        (!higher || candidate.bases.quality + candidate.bases.attempts >= VERBOSITY_LEARNING_MIN_PAIRS)
      );
    })
    .sort(
      (a, b) =>
        Math.abs(verbosityRank(a.verbosity)! - baseRank) -
          Math.abs(verbosityRank(b.verbosity)! - baseRank) ||
        verbosityRank(a.verbosity)! - verbosityRank(b.verbosity)!,
    );

  const best = eligible[0];
  if (best === undefined) {
    if (uniqueBaseFailures >= 2 && !basePassed) {
      decision.recommendedVerbosity = null;
      return finish(
        'deferred',
        'verbosity-repeated-failure',
        'The current verbosity repeatedly failed this task class; review context and validation before another policy change',
      );
    }
    return finish(
      'insufficient-evidence',
      'verbosity-more-pairs-needed',
      'Keep current verbosity until three distinct comparisons support an alternative without contrary or unknown outcomes',
    );
  }

  decision.candidateVerbosity = best.verbosity;
  const higher = verbosityRank(best.verbosity)! > baseRank;
  if (
    input.budget.state === 'wait-for-reset' ||
    (higher && !['balanced', 'use-headroom'].includes(input.budget.state))
  ) {
    decision.recommendedVerbosity = null;
    return finish(
      'deferred',
      'verbosity-budget-veto',
      'Historical outcomes suggest another verbosity, but allowance is unknown or constrained; checkpoint and re-observe first',
    );
  }
  if (higher && input.contextPressure === 'high') {
    decision.recommendedVerbosity = null;
    return finish(
      'deferred',
      'verbosity-context-veto',
      'Review high context pressure before a historically supported verbosity increase',
    );
  }

  decision.recommendedVerbosity = best.verbosity;
  decision.reasons.push({
    code: 'verbosity-measurement-boundary',
    summary:
      'User quality gates and stable model/effort boundaries support this candidate; local tokens are not subscription savings',
  });
  return finish(
    'learned',
    higher ? 'verbosity-quality-recovery' : 'verbosity-validated-efficiency',
    String(best.wins) +
      ' recent paired experiments support ' +
      best.verbosity +
      ' verbosity with the same configured model and reasoning effort without quality or retry regression',
  );
}
