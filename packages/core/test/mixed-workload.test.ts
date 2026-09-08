import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  allocateMixedWorkload,
  harnessId,
  type AcceptedTaskCapacityEstimate,
  type TaskClass,
} from '../src/index.js';

const CLAUDE = harnessId('claude');
const CODEX = harnessId('codex');

function capacity(input: {
  harness: typeof CLAUDE | typeof CODEX;
  taskClass: TaskClass;
  fiveHourCost: number;
  weeklyCost: number;
  fiveHourSpendable?: number;
  weeklySpendable?: number;
}): AcceptedTaskCapacityEstimate {
  const fiveHourSpendable = input.fiveHourSpendable ?? 20;
  const weeklySpendable = input.weeklySpendable ?? 20;
  return {
    harnessId: input.harness,
    taskClass: input.taskClass,
    status: 'estimated',
    acceptedTasksRemaining: Math.floor(
      Math.min(fiveHourSpendable / input.fiveHourCost, weeklySpendable / input.weeklyCost),
    ),
    eligibleReceipts: 3,
    fiveHour: {
      scope: 'five-hour',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: input.fiveHourCost,
      spendableRemainingPercent: fiveHourSpendable,
      taskEquivalents: fiveHourSpendable / input.fiveHourCost,
    },
    weekly: {
      scope: 'weekly',
      sampleCount: 3,
      p75UsedPercentPerAcceptedTask: input.weeklyCost,
      spendableRemainingPercent: weeklySpendable,
      taskEquivalents: weeklySpendable / input.weeklyCost,
    },
    reasons: [],
  };
}

function passed(samples = 3) {
  return { state: 'passed' as const, samples };
}

describe('mixed workload allocation', () => {
  it('stays when the current harness covers the complete mixed workload', () => {
    const decision = allocateMixedWorkload({
      demand: [
        { taskClass: 'mechanical', count: 2 },
        { taskClass: 'hard', count: 1 },
      ],
      current: {
        harnessId: CLAUDE,
        available: true,
        capacities: {
          mechanical: capacity({
            harness: CLAUDE,
            taskClass: 'mechanical',
            fiveHourCost: 2,
            weeklyCost: 2,
          }),
          hard: capacity({
            harness: CLAUDE,
            taskClass: 'hard',
            fiveHourCost: 4,
            weeklyCost: 4,
          }),
        },
      },
      candidate: { harnessId: CODEX, available: false, capacities: {} },
    });

    assert.equal(decision.decision, 'stay');
    assert.equal(decision.allocatedTasks, 3);
    assert.equal(decision.allocations.find((row) => row.taskClass === 'mechanical')?.current, 2);
    assert.equal(decision.allocations.find((row) => row.taskClass === 'hard')?.current, 1);
  });

  it('splits workload when the shared windows require both harnesses', () => {
    const decision = allocateMixedWorkload({
      demand: [
        { taskClass: 'mechanical', count: 2 },
        { taskClass: 'hard', count: 2 },
      ],
      current: {
        harnessId: CLAUDE,
        available: true,
        capacities: {
          mechanical: capacity({
            harness: CLAUDE,
            taskClass: 'mechanical',
            fiveHourCost: 4,
            weeklyCost: 4,
            fiveHourSpendable: 12,
            weeklySpendable: 12,
          }),
          hard: capacity({
            harness: CLAUDE,
            taskClass: 'hard',
            fiveHourCost: 8,
            weeklyCost: 8,
            fiveHourSpendable: 12,
            weeklySpendable: 12,
          }),
        },
      },
      candidate: {
        harnessId: CODEX,
        available: true,
        capacities: {
          mechanical: capacity({
            harness: CODEX,
            taskClass: 'mechanical',
            fiveHourCost: 3,
            weeklyCost: 3,
            fiveHourSpendable: 12,
            weeklySpendable: 12,
          }),
          hard: capacity({
            harness: CODEX,
            taskClass: 'hard',
            fiveHourCost: 7,
            weeklyCost: 7,
            fiveHourSpendable: 12,
            weeklySpendable: 12,
          }),
        },
        quality: { mechanical: passed(), hard: passed() },
      },
    });

    assert.equal(decision.decision, 'split');
    assert.equal(decision.allocatedTasks, 4);
    assert.equal(
      decision.allocations.reduce((sum, row) => sum + row.unallocated, 0),
      0,
    );
    assert.ok(decision.allocations.some((row) => row.current > 0));
    assert.ok(decision.allocations.some((row) => row.candidate > 0));
  });

  it('switches when only the quality-gated candidate can cover the workload', () => {
    const decision = allocateMixedWorkload({
      demand: [{ taskClass: 'standard', count: 2 }],
      current: { harnessId: CLAUDE, available: true, capacities: {} },
      candidate: {
        harnessId: CODEX,
        available: true,
        capacities: {
          standard: capacity({
            harness: CODEX,
            taskClass: 'standard',
            fiveHourCost: 4,
            weeklyCost: 4,
          }),
        },
        quality: { standard: passed() },
      },
    });

    assert.equal(decision.decision, 'switch');
    assert.equal(decision.allocations[0]?.candidate, 2);
  });

  it('fails closed when candidate quality has fewer than three observations', () => {
    const decision = allocateMixedWorkload({
      demand: [{ taskClass: 'hard', count: 2 }],
      current: {
        harnessId: CLAUDE,
        available: true,
        capacities: {
          hard: capacity({
            harness: CLAUDE,
            taskClass: 'hard',
            fiveHourCost: 8,
            weeklyCost: 8,
            fiveHourSpendable: 8,
            weeklySpendable: 8,
          }),
        },
      },
      candidate: {
        harnessId: CODEX,
        available: true,
        capacities: {
          hard: capacity({
            harness: CODEX,
            taskClass: 'hard',
            fiveHourCost: 4,
            weeklyCost: 4,
          }),
        },
        quality: { hard: passed(2) },
      },
    });

    assert.equal(decision.decision, 'insufficient-evidence');
    assert.equal(decision.allocatedTasks, 1);
    assert.equal(decision.allocations[0]?.unallocated, 1);
    assert.match(decision.reasons[0]?.code ?? '', /capacity-unproven/);
  });

  it('respects weekly capacity even when five-hour headroom is abundant', () => {
    const decision = allocateMixedWorkload({
      demand: [{ taskClass: 'standard', count: 3 }],
      current: { harnessId: CLAUDE, available: false, capacities: {} },
      candidate: {
        harnessId: CODEX,
        available: true,
        capacities: {
          standard: capacity({
            harness: CODEX,
            taskClass: 'standard',
            fiveHourCost: 1,
            weeklyCost: 6,
            fiveHourSpendable: 50,
            weeklySpendable: 12,
          }),
        },
        quality: { standard: passed() },
      },
    });

    assert.equal(decision.decision, 'shortfall');
    assert.equal(decision.allocatedTasks, 2);
    assert.equal(decision.allocations[0]?.unallocated, 1);
    assert.equal(decision.candidateUsage.weeklyUsedPercent, 12);
  });

  it('reports a proven shortfall when both harnesses have known but insufficient capacity', () => {
    const decision = allocateMixedWorkload({
      demand: [{ taskClass: 'critical', count: 3 }],
      current: {
        harnessId: CLAUDE,
        available: true,
        capacities: {
          critical: capacity({
            harness: CLAUDE,
            taskClass: 'critical',
            fiveHourCost: 10,
            weeklyCost: 10,
            fiveHourSpendable: 10,
            weeklySpendable: 10,
          }),
        },
      },
      candidate: {
        harnessId: CODEX,
        available: true,
        capacities: {
          critical: capacity({
            harness: CODEX,
            taskClass: 'critical',
            fiveHourCost: 10,
            weeklyCost: 10,
            fiveHourSpendable: 10,
            weeklySpendable: 10,
          }),
        },
        quality: { critical: passed() },
      },
    });

    assert.equal(decision.decision, 'shortfall');
    assert.equal(decision.allocatedTasks, 2);
    assert.equal(decision.allocations[0]?.unallocated, 1);
  });

  it('rejects duplicate or non-positive demand', () => {
    const duplicate = allocateMixedWorkload({
      demand: [
        { taskClass: 'standard', count: 1 },
        { taskClass: 'standard', count: 1 },
      ],
      current: { harnessId: CLAUDE, available: true, capacities: {} },
      candidate: { harnessId: CODEX, available: true, capacities: {} },
    });
    const zero = allocateMixedWorkload({
      demand: [{ taskClass: 'standard', count: 0 }],
      current: { harnessId: CLAUDE, available: true, capacities: {} },
      candidate: { harnessId: CODEX, available: true, capacities: {} },
    });

    assert.equal(duplicate.decision, 'insufficient-evidence');
    assert.equal(zero.decision, 'insufficient-evidence');
    assert.equal(duplicate.reasons[0]?.code, 'mixed-workload-invalid');
  });
});
