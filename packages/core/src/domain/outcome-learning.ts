/** RFC 0015. Pure project-local outcome learning, with no token-to-quota conversion. */
import {
  isTaskBenchmarkId,
  parseTaskBenchmarkReceipt,
  type TaskBenchmarkReceipt,
} from './benchmark.js';
import type { BudgetDecision } from './budget-policy.js';
import type { HarnessId } from './ids.js';
import {
  assessWindowPace,
  effortRank,
  taskEffortFloor,
  type BudgetProfile,
  type ContextPressure,
  type RecommendationEvidence,
  type TaskClass,
} from './optimizer.js';

export const EFFORT_LEARNING_MIN_PAIRS = 3;
export const EFFORT_LEARNING_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
export const EFFORT_LEARNING_MAX_RECEIPTS = 400;
export type EffortLearningBasis = 'quality' | 'attempts' | 'backend-quota' | 'local-tokens';
export interface EffortCandidateEvidence {
  effort: string;
  wins: number;
  losses: number;
  ties: number;
  inconclusive: number;
  qualityFailures: number;
  bases: Record<EffortLearningBasis, number>;
}
export interface EffortLearningDecision {
  state: 'unavailable' | 'insufficient-evidence' | 'kept' | 'learned' | 'deferred';
  verification: 'config-only';
  policy: { model: string | null; verbosity: string | null };
  baseEffort: string | null;
  recommendedEffort: string | null;
  candidateEffort: string | null;
  minimumPairs: number;
  matchedReceipts: number;
  ignoredReceipts: number;
  candidates: EffortCandidateEvidence[];
  reasons: RecommendationEvidence[];
}
export interface EffortLearningInput {
  harnessId: HarnessId;
  model: string | null;
  verbosity: string | null;
  taskClass: TaskClass;
  profile: BudgetProfile;
  supported: readonly string[];
  baseEffort: string | null;
  budget: BudgetDecision;
  contextPressure: ContextPressure;
  now: string;
  /** Already project-attributed by the reader. Null means incomplete/unavailable evidence. */
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
  if (usage === null || !Object.values(usage).every((n) => Number.isSafeInteger(n) && n >= 0))
    return null;
  const total =
    usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheCreationTokens;
  return total === usage.totalTokens && Number.isSafeInteger(total) ? total : null;
}

/** Every quota coordinate is validated at its task boundary; duplicate identities are unusable. */
function quotaDeltas(row: TaskBenchmarkReceipt): Map<string, number> {
  const key = (w: TaskBenchmarkReceipt['usageBefore'][number]) =>
    JSON.stringify([
      w.harnessId,
      w.bucketId,
      w.bucketName,
      w.scope,
      w.window,
      w.source,
      w.windowDurationMinutes,
      w.resetsAt,
    ]);
  const deltas = new Map<string, number>();
  for (const before of row.usageBefore) {
    if (before.harnessId !== row.harnessId || !['five-hour', 'weekly'].includes(before.scope))
      continue;
    const identity = key(before);
    const matches = row.usageAfter.filter((w) => key(w) === identity);
    if (matches.length !== 1 || row.usageBefore.filter((w) => key(w) === identity).length !== 1)
      continue;
    const after = matches[0]!;
    const start = assessWindowPace(before, row.startedAt, 0);
    const end = assessWindowPace(after, row.completedAt, 0);
    if (
      start.state === 'unknown' ||
      end.state === 'unknown' ||
      Date.parse(after.observedAt) < Date.parse(before.observedAt)
    )
      continue;
    const delta = end.usedPercent! - start.usedPercent!;
    if (delta >= 0) deltas.set(identity, delta);
  }
  return deltas;
}

type PairVerdict = {
  verdict: 'win' | 'loss' | 'tie' | 'unknown';
  basis: EffortLearningBasis | null;
};
function compare(base: TaskBenchmarkReceipt, candidate: TaskBenchmarkReceipt): PairVerdict {
  const verdict = (
    value: PairVerdict['verdict'],
    basis: EffortLearningBasis | null = null,
  ): PairVerdict => ({ verdict: value, basis });
  if (base.outcome.errorCodes.length > 0 || candidate.outcome.errorCodes.length > 0)
    return verdict('unknown');
  if (candidate.outcome.qualityGate === 'failed') return verdict('loss');
  if (candidate.outcome.qualityGate !== 'passed' || base.outcome.qualityGate === 'unknown')
    return verdict('unknown');
  if (base.outcome.qualityGate === 'failed') return verdict('win', 'quality');
  if (
    candidate.outcome.failedAttempts > base.outcome.failedAttempts ||
    candidate.outcome.attempts > base.outcome.attempts
  )
    return verdict('loss');
  const baseQuota = quotaDeltas(base);
  const candidateQuota = quotaDeltas(candidate);
  let quotaImproved = false;
  for (const [key, baseDelta] of baseQuota) {
    const candidateDelta = candidateQuota.get(key);
    if (candidateDelta === undefined) continue;
    // Do not cherry-pick the five-hour bucket when the week regressed, or vice versa.
    if (candidateDelta > baseDelta + 1e-9) return verdict('loss');
    if (baseDelta - candidateDelta >= 1) quotaImproved = true;
  }
  if (
    candidate.outcome.failedAttempts < base.outcome.failedAttempts ||
    candidate.outcome.attempts < base.outcome.attempts
  )
    return verdict('win', 'attempts');
  if (quotaImproved) return verdict('win', 'backend-quota');
  const beforeTokens = tokenVolume(base);
  const afterTokens = tokenVolume(candidate);
  if (beforeTokens !== null && beforeTokens > 0 && afterTokens !== null) {
    if (afterTokens > beforeTokens) return verdict('loss');
    if ((beforeTokens - afterTokens) / beforeTokens >= 0.05) return verdict('win', 'local-tokens');
    return verdict('tie');
  }
  // No comparable efficiency evidence is not proof of equivalent efficiency.
  return verdict('unknown');
}

/** Refine one native effort only after repeated, quality-gated, non-conflicting experiments. */
export function refineEffortWithOutcomes(input: EffortLearningInput): EffortLearningDecision {
  const decision: EffortLearningDecision = {
    state: 'insufficient-evidence',
    verification: 'config-only',
    policy: { model: input.model, verbosity: input.verbosity },
    baseEffort: input.baseEffort,
    recommendedEffort: input.baseEffort,
    candidateEffort: null,
    minimumPairs: EFFORT_LEARNING_MIN_PAIRS,
    matchedReceipts: 0,
    ignoredReceipts: 0,
    candidates: [],
    reasons: [],
  };
  const finish = (
    state: EffortLearningDecision['state'],
    code: string,
    summary: string,
  ): EffortLearningDecision => {
    decision.state = state;
    decision.reasons.push({ code, summary });
    return decision;
  };
  const now = Date.parse(input.now);
  if (
    input.receipts === null ||
    input.receipts.length > EFFORT_LEARNING_MAX_RECEIPTS ||
    !Number.isFinite(now)
  ) {
    return finish(
      'unavailable',
      'outcome-history-unavailable',
      'Complete bounded project history is unavailable; no learned policy is applied',
    );
  }
  const baseRank = effortRank(input.baseEffort);
  const floor = effortRank(taskEffortFloor(input.taskClass))!;
  if (
    input.baseEffort !== null &&
    (!input.supported.includes(input.baseEffort) || (baseRank !== null && baseRank < floor))
  ) {
    decision.recommendedEffort = null;
    return finish(
      'insufficient-evidence',
      'outcome-base-effort-unsupported',
      'No supported task-quality base effort is available',
    );
  }
  if (
    input.model === null ||
    input.model === '' ||
    baseRank === null ||
    input.baseEffort === null ||
    !input.supported.includes(input.baseEffort) ||
    baseRank < floor
  ) {
    return finish(
      'insufficient-evidence',
      'outcome-policy-identity-unknown',
      'A known configured model and supported task-quality effort are required for learning',
    );
  }
  const rowsById = new Map<string, TaskBenchmarkReceipt>();
  const runs = new Map<string, Set<string>>();
  for (const raw of input.receipts) {
    const parsed = parseTaskBenchmarkReceipt(raw);
    if (!parsed.ok) {
      return finish(
        'unavailable',
        'outcome-receipt-invalid',
        'Malformed history cannot be silently dropped while learning a policy',
      );
    }
    const row = parsed.receipt;
    if (
      row.harnessId !== input.harnessId ||
      row.taskClass !== input.taskClass ||
      row.model !== input.model ||
      row.verbosity !== input.verbosity ||
      Date.parse(row.completedAt) > now ||
      Date.parse(row.startedAt) < now - EFFORT_LEARNING_MAX_AGE_MS ||
      Date.parse(row.completedAt) <= Date.parse(row.startedAt) ||
      !isTaskBenchmarkId(row.benchmarkId)
    ) {
      decision.ignoredReceipts += 1;
      continue;
    }
    if (!usableOutcome(row)) {
      return finish(
        'unavailable',
        'outcome-counts-invalid',
        'Invalid outcome counts prevent a learned policy change',
      );
    }
    if (!stablePolicy(row)) {
      decision.ignoredReceipts += 1;
      continue;
    }
    const identity = JSON.stringify([row.benchmarkId, row.variant]);
    const previous = rowsById.get(identity);
    if (previous !== undefined) {
      if (JSON.stringify(previous) !== JSON.stringify(row))
        return finish(
          'unavailable',
          'outcome-receipt-conflict',
          'Conflicting copies of one task receipt prevent learned policy changes',
        );
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
  const baseRows = rows.filter((row) => row.reasoningEffort === input.baseEffort);
  const baseFailed = baseRows.filter(
    (row) => row.outcome.qualityGate === 'failed' && row.outcome.errorCodes.length === 0,
  );
  const uniqueBaseFailures = new Set(baseFailed.map(runKey)).size;
  const basePassed = baseRows.some((row) => row.outcome.qualityGate === 'passed');
  const options = [...new Set(input.supported)]
    .filter((effort) => {
      const rank = effortRank(effort);
      return effort !== input.baseEffort && rank !== null && rank >= floor;
    })
    .sort((a, b) => effortRank(a)! - effortRank(b)!);
  for (const effort of options) {
    const evidence: EffortCandidateEvidence = {
      effort,
      wins: 0,
      losses: 0,
      ties: 0,
      inconclusive: 0,
      qualityFailures: rows.filter(
        (row) => row.reasoningEffort === effort && row.outcome.qualityGate === 'failed',
      ).length,
      bases: { quality: 0, attempts: 0, 'backend-quota': 0, 'local-tokens': 0 },
    };
    const pairs: Array<{ base: TaskBenchmarkReceipt; candidate: TaskBenchmarkReceipt }> = [];
    for (const base of baseRows) {
      const otherVariant = base.variant === 'baseline' ? 'optimized' : 'baseline';
      const candidate = rowsById.get(JSON.stringify([base.benchmarkId, otherVariant]));
      if (candidate?.reasoningEffort !== effort) continue;
      pairs.push({ base, candidate });
    }
    evidence.inconclusive += rows.filter(
      (row) =>
        row.reasoningEffort === effort &&
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
      const result = compare(pair.base, pair.candidate);
      if (result.verdict === 'win') {
        evidence.wins += 1;
        evidence.bases[result.basis!] += 1;
      } else if (result.verdict === 'loss') evidence.losses += 1;
      else if (result.verdict === 'tie') evidence.ties += 1;
      else evidence.inconclusive += 1;
    }
    if (pairs.length > 0 || evidence.qualityFailures > 0) decision.candidates.push(evidence);
  }
  const eligible = decision.candidates
    .filter(
      (candidate) =>
        candidate.wins >= EFFORT_LEARNING_MIN_PAIRS &&
        candidate.losses === 0 &&
        candidate.inconclusive === 0 &&
        candidate.qualityFailures === 0 &&
        (effortRank(candidate.effort)! < baseRank ||
          candidate.bases.quality + candidate.bases.attempts >= EFFORT_LEARNING_MIN_PAIRS),
    )
    .sort(
      (a, b) =>
        Math.abs(effortRank(a.effort)! - baseRank) - Math.abs(effortRank(b.effort)! - baseRank) ||
        effortRank(a.effort)! - effortRank(b.effort)!,
    );
  const best = eligible[0];
  if (best === undefined) {
    if (uniqueBaseFailures >= 2 && !basePassed) {
      decision.recommendedEffort = null;
      return finish(
        'deferred',
        'outcome-repeated-failure',
        'The proposed effort repeatedly failed this task class; review context and validation before another attempt or policy change',
      );
    }
    return finish(
      'insufficient-evidence',
      'outcome-more-pairs-needed',
      'Keep the task/budget policy until three distinct comparisons support an alternative without contrary or unknown outcomes',
    );
  }
  decision.candidateEffort = best.effort;
  const higher = effortRank(best.effort)! > baseRank;
  if (!higher && input.profile === 'quality')
    return finish(
      'kept',
      'outcome-quality-profile-kept',
      'The quality profile keeps its requested effort rather than adopting an efficiency-only downgrade',
    );
  if (
    input.budget.state === 'wait-for-reset' ||
    (higher && !['balanced', 'use-headroom'].includes(input.budget.state))
  ) {
    decision.recommendedEffort = null;
    return finish(
      'deferred',
      'outcome-budget-veto',
      'Historical outcomes suggest another effort, but allowance is unknown or constrained; checkpoint and re-observe rather than bypass the reserve',
    );
  }
  if (higher && input.contextPressure === 'high') {
    decision.recommendedEffort = null;
    return finish(
      'deferred',
      'outcome-context-veto',
      'Review high context pressure before the historically supported effort increase',
    );
  }
  decision.recommendedEffort = best.effort;
  decision.reasons.push({
    code: 'outcome-measurement-boundary',
    summary:
      'User quality gates and configuration boundaries support this advice; local tokens and attempts are not subscription savings or runtime-policy proof',
  });
  return finish(
    'learned',
    higher ? 'outcome-retry-recovery' : 'outcome-validated-efficiency',
    String(best.wins) +
      ' recent paired experiments support ' +
      best.effort +
      ' for the same configured model and task class without quality or retry regression',
  );
}
