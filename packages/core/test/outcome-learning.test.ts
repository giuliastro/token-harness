import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  EFFORT_LEARNING_MIN_PAIRS,
  parseTaskBenchmarkReceipt,
  refineEffortWithOutcomes,
  harnessId,
  effortRank,
  taskEffortFloor,
  type EffortLearningInput,
  type TaskBenchmarkReceipt,
  type UsageWindowSnapshot,
} from '../src/index.js';

const NOW = '2026-09-06T12:00:00.000Z';
const MODEL = 'fixture-model';
function receipt(
  index: number,
  variant: 'baseline' | 'optimized',
  patch: Partial<TaskBenchmarkReceipt> = {},
): TaskBenchmarkReceipt {
  const start =
    Date.parse('2026-09-06T08:00:00Z') + (index * 60 + (variant === 'optimized' ? 15 : 0)) * 60_000;
  const effort = variant === 'baseline' ? 'high' : 'medium';
  const total = variant === 'baseline' ? 1000 : 700;
  return {
    schemaVersion: 1,
    benchmarkId: 'trial-' + String(index),
    variant,
    taskClass: 'hard',
    harnessId: harnessId('codex'),
    model: MODEL,
    reasoningEffort: effort,
    verbosity: 'low',
    startedAt: new Date(start).toISOString(),
    completedAt: new Date(start + 10 * 60_000).toISOString(),
    usageBefore: [],
    usageAfter: [],
    localUsage: {
      inputTokens: total - 100,
      outputTokens: 100,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: total,
    },
    outcome: { qualityGate: 'passed', attempts: 1, failedAttempts: 0, errorCodes: [] },
    policyAtFinish: {
      model: MODEL,
      reasoningEffort: effort,
      verbosity: 'low',
      verification: 'config-only',
    },
    ...patch,
  };
}
function input(receipts: TaskBenchmarkReceipt[] = pairs()): EffortLearningInput {
  return {
    harnessId: harnessId('codex'),
    model: MODEL,
    verbosity: 'low',
    taskClass: 'hard',
    profile: 'balanced',
    supported: ['low', 'medium', 'high', 'xhigh'],
    baseEffort: 'high',
    budget: {
      state: 'balanced',
      allowEffortIncrease: false,
      pressuredScopes: [],
      missingScopes: [],
      recheckAt: null,
      reasons: [],
    },
    contextPressure: 'low',
    now: NOW,
    receipts,
  };
}
function pairs(count = 3): TaskBenchmarkReceipt[] {
  return Array.from({ length: count }, (_, i) => [
    receipt(i, 'baseline'),
    receipt(i, 'optimized'),
  ]).flat();
}
function withEffort(row: TaskBenchmarkReceipt, effort: string): TaskBenchmarkReceipt {
  return {
    ...row,
    reasoningEffort: effort,
    policyAtFinish: {
      model: row.model,
      verbosity: row.verbosity,
      reasoningEffort: effort,
      verification: 'config-only',
    },
  };
}
function retryPairs(): TaskBenchmarkReceipt[] {
  return pairs().map((row) =>
    row.variant === 'baseline'
      ? {
          ...withEffort(row, 'medium'),
          outcome: { qualityGate: 'passed', attempts: 3, failedAttempts: 2, errorCodes: [] },
        }
      : withEffort(row, 'high'),
  );
}
function withQuota(
  row: TaskBenchmarkReceipt,
  fiveDelta: number,
  weeklyDelta: number,
): TaskBenchmarkReceipt {
  const window = (
    scope: 'five-hour' | 'weekly',
    after: boolean,
    delta: number,
  ): UsageWindowSnapshot => ({
    harnessId: row.harnessId,
    bucketId: 'included',
    bucketName: 'Included',
    window: scope === 'five-hour' ? 'primary' : 'secondary',
    scope,
    usedPercent: 20 + (after ? delta : 0),
    remainingPercent: 80 - (after ? delta : 0),
    windowDurationMinutes: scope === 'five-hour' ? 300 : 10080,
    resetsAt: scope === 'five-hour' ? '2026-09-06T13:00:00.000Z' : '2026-09-10T12:00:00.000Z',
    observedAt: after ? row.completedAt : row.startedAt,
    source: 'native-rpc',
    confidence: 'authoritative',
  });
  return {
    ...row,
    localUsage: null,
    usageBefore: [window('five-hour', false, fiveDelta), window('weekly', false, weeklyDelta)],
    usageAfter: [window('five-hour', true, fiveDelta), window('weekly', true, weeklyDelta)],
  };
}

describe('outcome-aware effort', () => {
  it('adopts a lower supported effort only after three quality-passed comparisons', () => {
    const decision = refineEffortWithOutcomes(input());
    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedEffort, 'medium');
    assert.equal(decision.candidates[0]?.bases['local-tokens'], 3);
    assert.equal(decision.verification, 'config-only');
    assert.match(decision.reasons[0]!.summary, /not subscription savings/);
  });
  it('needs the minimum number of distinct paired experiments', () => {
    assert.equal(EFFORT_LEARNING_MIN_PAIRS, 3);
    for (const n of [0, 1, 2])
      assert.equal(refineEffortWithOutcomes(input(pairs(n))).state, 'insufficient-evidence');
  });
  it('can recover from repeated cheap retries when both allowances are healthy', () => {
    const data = { ...input(retryPairs()), baseEffort: 'medium' };
    const decision = refineEffortWithOutcomes(data);
    assert.equal(decision.state, 'learned');
    assert.equal(decision.recommendedEffort, 'high');
    assert.equal(decision.candidates.find((row) => row.effort === 'high')?.bases.attempts, 3);
  });
  it('can recover quality even when the successful run needed more work', () => {
    const rows = retryPairs().map((row) =>
      row.variant === 'baseline'
        ? {
            ...row,
            outcome: {
              qualityGate: 'failed' as const,
              attempts: 1,
              failedAttempts: 1,
              errorCodes: [],
            },
          }
        : {
            ...row,
            outcome: {
              qualityGate: 'passed' as const,
              attempts: 2,
              failedAttempts: 1,
              errorCodes: [],
            },
          },
    );
    const decision = refineEffortWithOutcomes({ ...input(rows), baseEffort: 'medium' });
    assert.equal(decision.state, 'learned');
    assert.equal(decision.candidates.find((row) => row.effort === 'high')?.bases.quality, 3);
  });
  for (const state of ['conserve', 'unknown', 'wait-for-reset'] as const) {
    it(`does not let learned recovery bypass ${state} quota`, () => {
      const data = { ...input(retryPairs()), baseEffort: 'medium' };
      data.budget.state = state;
      const decision = refineEffortWithOutcomes(data);
      assert.equal(decision.state, 'deferred');
      assert.equal(decision.recommendedEffort, null);
      assert.equal(decision.candidateEffort, 'high');
    });
  }
  it('keeps the quality profile rather than applying an efficiency-only downgrade', () => {
    assert.equal(refineEffortWithOutcomes({ ...input(), profile: 'quality' }).state, 'kept');
    assert.equal(
      refineEffortWithOutcomes({ ...input(), profile: 'quality' }).recommendedEffort,
      'high',
    );
  });
  it('blocks upward refinement under high context pressure, but not validated reductions', () => {
    assert.equal(
      refineEffortWithOutcomes({
        ...input(retryPairs()),
        baseEffort: 'medium',
        contextPressure: 'high',
      }).state,
      'deferred',
    );
    assert.equal(
      refineEffortWithOutcomes({ ...input(), contextPressure: 'high' }).recommendedEffort,
      'medium',
    );
  });
  it('never raises effort just because local token volume was lower', () => {
    const rows = pairs().map((row) =>
      withEffort(row, row.variant === 'baseline' ? 'medium' : 'high'),
    );
    assert.equal(
      refineEffortWithOutcomes({ ...input(rows), baseEffort: 'medium' }).state,
      'insufficient-evidence',
    );
  });
  it('lets an unpaired failed candidate veto three attractive wins', () => {
    const failure = receipt(3, 'optimized', {
      outcome: { qualityGate: 'failed', attempts: 1, failedAttempts: 1, errorCodes: [] },
    });
    assert.equal(
      refineEffortWithOutcomes(input([...pairs(), failure])).state,
      'insufficient-evidence',
    );
  });
  it('does not hide an unpaired unknown candidate outcome', () => {
    const unknown = receipt(3, 'optimized', {
      outcome: { qualityGate: 'unknown', attempts: 1, failedAttempts: 0, errorCodes: [] },
    });
    assert.equal(
      refineEffortWithOutcomes(input([...pairs(), unknown])).state,
      'insufficient-evidence',
    );
  });
  it('does not endorse more retries even with a lower observed quota delta', () => {
    const rows = pairs().map((row) =>
      withQuota(row, row.variant === 'baseline' ? 10 : 5, row.variant === 'baseline' ? 5 : 2),
    );
    rows[1]!.outcome.attempts = 2;
    rows[1]!.outcome.failedAttempts = 1;
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
  });
  it('checks the weekly delta rather than cherry-picking a five-hour improvement', () => {
    const rows = pairs().map((row) =>
      withQuota(row, row.variant === 'baseline' ? 10 : 5, row.variant === 'baseline' ? 2 : 4),
    );
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
  });
  it('recognizes independently consistent backend improvements without local counts', () => {
    const rows = pairs().map((row) =>
      withQuota(row, row.variant === 'baseline' ? 10 : 5, row.variant === 'baseline' ? 4 : 2),
    );
    const result = refineEffortWithOutcomes(input(rows));
    assert.equal(result.state, 'learned');
    assert.equal(result.candidates[0]?.bases['backend-quota'], 3);
  });
  for (const kind of [
    'cached',
    'duplicate',
    'other-harness',
    'cross-reset',
    'stale',
    'history-source',
  ] as const) {
    it(`does not learn from ${kind} quota as backend evidence`, () => {
      const rows = pairs().map((row) =>
        withQuota(row, row.variant === 'baseline' ? 10 : 5, row.variant === 'baseline' ? 4 : 2),
      );
      for (const row of rows) {
        if (kind === 'duplicate') row.usageBefore.push(...row.usageBefore);
        for (const w of [...row.usageBefore, ...row.usageAfter]) {
          if (kind === 'cached') w.confidence = 'cached';
          if (kind === 'other-harness') w.harnessId = harnessId('claude');
          if (kind === 'stale') w.observedAt = '2026-09-05T08:00:00.000Z';
          if (kind === 'history-source') w.source = 'local-history';
        }
        if (kind === 'cross-reset')
          for (const w of row.usageAfter) w.resetsAt = '2026-09-07T13:00:00.000Z';
      }
      assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
    });
  }
  it('requires a material local-volume improvement and consistent local counters', () => {
    const rows = pairs();
    for (const row of rows.filter((r) => r.variant === 'optimized')) {
      row.localUsage!.inputTokens = 875;
      row.localUsage!.totalTokens = 975;
    }
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
    rows[1]!.localUsage!.totalTokens = 1;
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
  });
  it('does not infer that more effort repairs runtime/provider errors', () => {
    const rows = retryPairs();
    rows[0]!.outcome.errorCodes = ['provider-timeout'];
    assert.equal(
      refineEffortWithOutcomes({ ...input(rows), baseEffort: 'medium' }).state,
      'insufficient-evidence',
    );
  });
  it('suppresses a repeatedly failed proposal without inventing an alternative', () => {
    const rows = [0, 1].map((i) =>
      receipt(i, 'baseline', {
        outcome: { qualityGate: 'failed', attempts: 1, failedAttempts: 1, errorCodes: [] },
      }),
    );
    const result = refineEffortWithOutcomes(input(rows));
    assert.equal(result.state, 'deferred');
    assert.equal(result.recommendedEffort, null);
    assert.equal(result.candidateEffort, null);
  });
  for (const field of ['model', 'reasoningEffort', 'verbosity'] as const) {
    it(`does not attribute a task whose ${field} changed at the boundary`, () => {
      const rows = pairs();
      rows[1]!.policyAtFinish![field] = 'changed';
      assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
    });
  }
  it('keeps legacy receipts valid but out of learned policy', () => {
    const rows = pairs();
    for (const row of rows) delete row.policyAtFinish;
    assert.equal(refineEffortWithOutcomes(input(rows)).matchedReceipts, 0);
  });
  it('does not learn across configured model, task class, harness, or verbosity', () => {
    const base = input();
    for (const patch of [
      { model: 'different' },
      { taskClass: 'critical' as const },
      { harnessId: harnessId('claude') },
      { verbosity: 'high' },
    ]) {
      assert.equal(refineEffortWithOutcomes({ ...base, ...patch }).matchedReceipts, 0);
    }
    assert.equal(refineEffortWithOutcomes({ ...base, model: null }).state, 'insufficient-evidence');
  });
  it('ignores evidence outside the rolling history horizon or in the future', () => {
    const rows = pairs().map((row) => ({
      ...row,
      startedAt: '2026-08-01T08:00:00Z',
      completedAt: '2026-08-01T08:10:00Z',
    }));
    assert.equal(refineEffortWithOutcomes(input(rows)).matchedReceipts, 0);
    assert.equal(
      refineEffortWithOutcomes({ ...input(), now: '2026-09-01T12:00:00Z' }).matchedReceipts,
      0,
    );
  });
  it('never counts a copied run as another experiment', () => {
    const one = pairs(1);
    const copied = [0, 1, 2].flatMap((i) =>
      one.map((row) => ({ ...row, benchmarkId: 'copy-' + String(i) })),
    );
    assert.equal(refineEffortWithOutcomes(input(copied)).state, 'insufficient-evidence');
    assert.equal(refineEffortWithOutcomes(input([...one, ...one, ...one])).matchedReceipts, 2);
  });
  it('fails closed on conflicting copies of a receipt or malformed outcome counts', () => {
    const rows = pairs();
    const changed = { ...rows[0]!, localUsage: null };
    assert.equal(refineEffortWithOutcomes(input([...rows, changed])).state, 'unavailable');
    rows[0]!.outcome.failedAttempts = rows[0]!.outcome.attempts;
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'unavailable');
  });
  it('does not count overlapping task experiments', () => {
    const rows = pairs();
    rows[1]!.startedAt = rows[0]!.startedAt;
    assert.equal(refineEffortWithOutcomes(input(rows)).state, 'insufficient-evidence');
  });
  it('does not widen native catalogs or let a hard task fall below its floor', () => {
    assert.equal(
      refineEffortWithOutcomes({ ...input(), supported: ['high', 'xhigh'] }).recommendedEffort,
      'high',
    );
    assert.equal(
      refineEffortWithOutcomes({ ...input(), baseEffort: 'low' }).recommendedEffort,
      null,
    );
    assert.equal(
      refineEffortWithOutcomes({ ...input(), baseEffort: 'made-up' }).recommendedEffort,
      null,
    );
  });
  it('bounds input history and keeps missing evidence explicit', () => {
    assert.equal(refineEffortWithOutcomes({ ...input(), receipts: null }).state, 'unavailable');
    assert.equal(
      refineEffortWithOutcomes({
        ...input(),
        receipts: Array.from({ length: 401 }, () => receipt(0, 'baseline')),
      }).state,
      'unavailable',
    );
  });
  it('is deterministic, order independent, catalog bound and quality-floor safe across profiles and budgets', () => {
    let checked = 0;
    for (const taskClass of ['mechanical', 'standard', 'hard', 'critical'] as const) {
      for (const profile of ['economy', 'balanced', 'quality', 'custom'] as const) {
        for (const state of [
          'balanced',
          'use-headroom',
          'conserve',
          'unknown',
          'wait-for-reset',
        ] as const) {
          for (const contextPressure of ['low', 'high', 'unknown'] as const) {
            const data = input(pairs().map((row) => ({ ...row, taskClass })));
            Object.assign(data, { taskClass, profile, contextPressure });
            data.budget.state = state;
            const result = refineEffortWithOutcomes(data);
            assert.deepEqual(
              result,
              refineEffortWithOutcomes({ ...data, receipts: [...data.receipts!].reverse() }),
            );
            if (result.recommendedEffort !== null) {
              assert.ok(data.supported.includes(result.recommendedEffort));
              assert.ok(
                effortRank(result.recommendedEffort)! >= effortRank(taskEffortFloor(taskClass))!,
              );
            }
            checked += 1;
          }
        }
      }
    }
    assert.equal(checked, 240);
  });
});

describe('additive benchmark end-policy contract', () => {
  it('preserves legacy receipts without fabricating a witness', () => {
    const row = receipt(0, 'baseline');
    delete row.policyAtFinish;
    const parsed = parseTaskBenchmarkReceipt(row);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.deepEqual(parsed.receipt, row);
  });
  it('preserves explicit unavailable end policy as null', () => {
    const row = receipt(0, 'baseline', { policyAtFinish: null });
    const parsed = parseTaskBenchmarkReceipt(row);
    assert.equal(parsed.ok, true);
    if (parsed.ok) assert.equal(parsed.receipt.policyAtFinish, null);
  });
  for (const policy of [
    { verification: 'runtime' },
    { verification: 'config-only', model: 42 },
    'injected',
    [],
    { verification: 'config-only', model: 'fixture-model', reasoningEffort: {}, verbosity: 'low' },
  ]) {
    it('rejects malformed boundary policy ' + JSON.stringify(policy), () => {
      assert.equal(
        parseTaskBenchmarkReceipt({ ...receipt(0, 'baseline'), policyAtFinish: policy }).ok,
        false,
      );
    });
  }
});
