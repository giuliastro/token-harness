import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  decideEfficiency,
  harnessId,
  type AcceptedTaskCapacityEstimate,
  type CrossHarnessSchedulerDecision,
  type HarnessOptimizationAdvice,
} from '../src/index.js';

const CODEX = harnessId('codex');
const CLAUDE = harnessId('claude');

function advice(
  harnessId: typeof CODEX | typeof CLAUDE,
  patch: Partial<HarnessOptimizationAdvice> = {},
): HarnessOptimizationAdvice {
  return {
    harnessId,
    state: 'advised',
    currentModel: `${harnessId}-model-a`,
    recommendedModel: `${harnessId}-model-a`,
    currentEffort: 'medium',
    recommendedEffort: 'medium',
    currentVerbosity: 'medium',
    recommendedVerbosity: 'medium',
    contextPressure: 'low',
    localBurnTrend: null,
    recentSession: null,
    pace: [],
    budgetDecision: {
      state: 'balanced',
      allowEffortIncrease: false,
      pressuredScopes: [],
      missingScopes: [],
      recheckAt: null,
      reasons: [{ code: 'joint-budget-balanced', summary: 'both windows are safe' }],
    },
    recommendations: [],
    diagnostics: [],
    ...patch,
  };
}

function capacity(
  harnessId: typeof CODEX | typeof CLAUDE,
  patch: Partial<AcceptedTaskCapacityEstimate> = {},
): AcceptedTaskCapacityEstimate {
  return {
    harnessId,
    taskClass: 'standard',
    policy: {
      model: `${harnessId}-model-a`,
      reasoningEffort: 'medium',
      verbosity: 'medium',
    },
    status: 'estimated',
    acceptedTasksRemaining: 4,
    eligibleReceipts: 3,
    fiveHour: {
      scope: 'five-hour',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: 4,
      spendableRemainingPercent: 24,
      taskEquivalents: 6,
    },
    weekly: {
      scope: 'weekly',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: 6,
      spendableRemainingPercent: 30,
      taskEquivalents: 5,
    },
    reasons: ['five-hour and weekly estimates are complete'],
    ...patch,
  };
}

function scheduler(
  decision: CrossHarnessSchedulerDecision['decision'],
): CrossHarnessSchedulerDecision {
  return {
    decision,
    tasksRemaining: null,
    currentHarness: CODEX,
    candidateHarness: CLAUDE,
    taskClass: 'standard',
    reasons: [{ code: `scheduler-${decision}`, summary: `scheduler says ${decision}` }],
  };
}

describe('unified efficiency decision', () => {
  it('composes one exact-policy decision without recalculating allowance evidence', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX)],
      capacities: [capacity(CODEX)],
      attemptBudget: {
        maxAttempts: 2,
        premiumEscalations: 1,
        evidence: [
          { code: 'reviewed-attempt-budget', summary: 'reviewed policy permits one retry' },
        ],
      },
    });

    assert.equal(decision.harness, 'codex');
    assert.equal(decision.model, 'codex-model-a');
    assert.equal(decision.reasoningEffort, 'medium');
    assert.equal(decision.verbosity, 'medium');
    assert.equal(decision.contextAction, 'keep');
    assert.deepEqual(decision.allowanceBudget, {
      fiveHourPercent: 4,
      weeklyPercent: 6,
    });
    assert.equal(decision.maxAttempts, 2);
    assert.equal(decision.premiumEscalationBudget, 1);
    assert.ok(decision.evidence.some((item) => item.code === 'exact-policy-task-cost'));
  });

  it('keeps every unsupported budget unknown instead of manufacturing a value', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX, { contextPressure: 'unknown' })],
    });

    assert.deepEqual(decision.allowanceBudget, {
      fiveHourPercent: null,
      weeklyPercent: null,
    });
    assert.equal(decision.maxAttempts, null);
    assert.equal(decision.premiumEscalationBudget, null);
    assert.equal(decision.contextAction, 'unknown');
  });

  it('does not promote unavailable optimizer observations into a policy', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX, { state: 'unavailable' })],
      capacities: [capacity(CODEX)],
    });

    assert.equal(decision.model, null);
    assert.equal(decision.reasoningEffort, null);
    assert.equal(decision.verbosity, null);
    assert.deepEqual(decision.allowanceBudget, {
      fiveHourPercent: null,
      weeklyPercent: null,
    });
  });

  it('does not infer maskable material from context pressure alone', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [
        advice(CODEX, {
          contextPressure: 'high',
          recommendations: [
            {
              area: 'context',
              priority: 'first',
              action: 'review context',
              target: null,
              evidence: [{ code: 'instruction-budget', summary: 'instruction bytes are high' }],
            },
          ],
        }),
      ],
    });

    assert.equal(decision.contextAction, 'unknown');
  });

  it('uses direct context-governor evidence even when optimizer advice is unavailable', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [],
      contextGovernor: {
        harnessId: CODEX,
        pressure: 'unknown',
        taskBoundary: 'continuing',
        validation: 'passing',
        quality: 'passed',
        reuse: 'efficient',
        materials: [
          { kind: 'tool-output', state: 'superseded', byteLength: 768, reduction: 'none' },
        ],
      },
    });

    assert.equal(decision.contextAction, 'mask');
    assert.equal(decision.contextGovernor?.action, 'mask');
    assert.ok(decision.evidence.some((item) => item.code === 'context-superseded-material'));
    assert.equal(decision.model, null);
  });

  it('ignores a context snapshot for a different selected harness', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX)],
      contextGovernor: {
        harnessId: CLAUDE,
        pressure: 'high',
        taskBoundary: 'continuing',
        validation: 'passing',
        quality: 'passed',
        reuse: 'efficient',
        materials: [
          { kind: 'tool-output', state: 'superseded', byteLength: 768, reduction: 'none' },
        ],
      },
    });

    assert.equal(decision.contextGovernor, null);
    assert.equal(decision.contextAction, 'keep');
    assert.ok(
      decision.reasons.some((item) => item.code === 'efficiency-context-governor-harness-mismatch'),
    );
  });

  it('uses the existing scheduler recommendation without performing a harness switch', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX), advice(CLAUDE)],
      capacities: [capacity(CLAUDE)],
      scheduler: scheduler('switch'),
    });

    assert.equal(decision.harness, 'claude');
    assert.equal(decision.model, 'claude-model-a');
    assert.ok(decision.reasons.some((item) => item.code === 'efficiency-scheduler-switch-advised'));
    assert.ok(decision.evidence.some((item) => item.source === 'scheduler'));
  });

  it('fails closed when the scheduler snapshot or candidate policy does not match', () => {
    const mismatched = scheduler('switch');
    mismatched.taskClass = 'hard';
    const wrongTask = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX), advice(CLAUDE)],
      scheduler: mismatched,
    });
    assert.equal(wrongTask.harness, 'codex');

    const missingCandidate = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX)],
      scheduler: scheduler('switch'),
    });
    assert.equal(missingCandidate.harness, 'codex');
  });

  it('preserves single-control learning and the reasoning quality floor', () => {
    const twoChanges = advice(CODEX, {
      recommendedEffort: 'high',
      recommendedVerbosity: 'low',
      recommendations: [
        {
          area: 'reasoning',
          priority: 'first',
          action: 'change effort',
          target: 'high',
          evidence: [{ code: 'effort-proof', summary: 'effort evidence' }],
        },
        {
          area: 'verbosity',
          priority: 'next',
          action: 'change verbosity',
          target: 'low',
          evidence: [{ code: 'verbosity-proof', summary: 'verbosity evidence' }],
        },
      ],
    });
    const guarded = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [twoChanges],
    });
    assert.equal(guarded.reasoningEffort, 'medium');
    assert.equal(guarded.verbosity, 'medium');

    const belowFloor = advice(CODEX, {
      currentEffort: 'high',
      recommendedEffort: 'low',
      recommendations: [
        {
          area: 'reasoning',
          priority: 'first',
          action: 'change effort',
          target: 'low',
          evidence: [{ code: 'bad-floor-proof', summary: 'must still respect the floor' }],
        },
      ],
    });
    const critical = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'critical',
      optimization: [belowFloor],
    });
    assert.equal(critical.reasoningEffort, 'high');
    assert.ok(critical.reasons.some((item) => item.code === 'efficiency-quality-floor-protected'));
  });

  it('does not adopt a model change from generic recommendation evidence', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [
        advice(CODEX, {
          recommendedModel: 'codex-model-b',
          recommendations: [
            {
              area: 'model',
              priority: 'next',
              action: 'choose another model',
              target: 'codex-model-b',
              evidence: [{ code: 'model-catalog', summary: 'candidate is in catalog' }],
            },
          ],
        }),
      ],
    });

    assert.equal(decision.model, 'codex-model-a');
    assert.ok(decision.reasons.some((item) => item.code === 'efficiency-model-learning-unproven'));
  });

  it('adopts only the exact learned model after the allowance gate', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [
        advice(CODEX, {
          recommendedModel: 'codex-model-b',
          modelLearning: {
            harnessId: CODEX,
            state: 'learned',
            verification: 'config-only',
            policy: { reasoningEffort: 'medium', verbosity: 'medium' },
            baseModel: 'codex-model-a',
            recommendedModel: 'codex-model-b',
            candidateModel: 'codex-model-b',
            intent: 'allowance-efficiency',
            minimumPairs: 3,
            matchedReceipts: 6,
            ignoredReceipts: 0,
            candidates: [],
            reasons: [],
          },
          recommendations: [
            {
              area: 'model',
              priority: 'next',
              action: 'choose another model',
              target: 'codex-model-b',
              evidence: [
                {
                  code: 'model-allowance-throughput-improved',
                  summary: 'both windows support the candidate',
                },
              ],
            },
          ],
        }),
      ],
    });

    assert.equal(decision.model, 'codex-model-b');
    assert.equal(decision.reasoningEffort, 'medium');
    assert.equal(decision.verbosity, 'medium');
  });

  it('does not endorse an observed effort below the task quality floor', () => {
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'critical',
      optimization: [advice(CODEX, { currentEffort: 'low', recommendedEffort: null })],
    });

    assert.equal(decision.reasoningEffort, null);
    assert.ok(
      decision.reasons.some((item) => item.code === 'efficiency-observed-effort-below-floor'),
    );
  });

  it('requires context cleanup before a quota-derived effort increase', () => {
    const constrained = advice(CODEX, {
      contextPressure: 'high',
      currentEffort: 'medium',
      recommendedEffort: 'high',
      budgetDecision: {
        state: 'use-headroom',
        allowEffortIncrease: true,
        pressuredScopes: [],
        missingScopes: [],
        recheckAt: null,
        reasons: [{ code: 'joint-headroom-available', summary: 'both windows have headroom' }],
      },
      recommendations: [
        {
          area: 'context',
          priority: 'first',
          action: 'reduce context',
          target: null,
          evidence: [{ code: 'instruction-budget', summary: 'instructions are near budget' }],
        },
        {
          area: 'reasoning',
          priority: 'next',
          action: 'increase effort',
          target: 'high',
          evidence: [{ code: 'quota-five-hour', summary: 'five-hour headroom' }],
        },
      ],
    });
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'hard',
      optimization: [constrained],
    });

    assert.equal(decision.contextAction, 'unknown');
    assert.equal(decision.reasoningEffort, 'medium');
    assert.ok(
      decision.reasons.some((item) => item.code === 'efficiency-context-before-quota-escalation'),
    );
  });

  it('requires exact model, effort and verbosity identity for task budgets', () => {
    const mismatched = capacity(CODEX, {
      policy: { model: 'codex-model-a', reasoningEffort: 'high', verbosity: 'medium' },
    });
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX)],
      capacities: [mismatched],
    });

    assert.deepEqual(decision.allowanceBudget, {
      fiveHourPercent: null,
      weeklyPercent: null,
    });
  });

  it("does not assign a task cost above either window's spendable allowance", () => {
    const constrained = capacity(CODEX);
    constrained.weekly.spendableRemainingPercent = 5;
    const decision = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [advice(CODEX)],
      capacities: [constrained],
    });

    assert.deepEqual(decision.allowanceBudget, {
      fiveHourPercent: null,
      weeklyPercent: null,
    });
  });

  it('is deterministic across evidence input order', () => {
    const codex = advice(CODEX);
    const claude = advice(CLAUDE);
    const first = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [codex, claude],
      capacities: [capacity(CODEX), capacity(CLAUDE)],
    });
    const second = decideEfficiency({
      currentHarness: 'codex',
      taskClass: 'standard',
      optimization: [claude, codex],
      capacities: [capacity(CLAUDE), capacity(CODEX)],
    });
    assert.deepEqual(second, first);
  });
});
