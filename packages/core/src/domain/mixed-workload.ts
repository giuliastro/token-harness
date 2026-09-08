import type { QualityEvidenceState } from './cross-harness-scheduler.js';
import type { HarnessId } from './ids.js';
import { TASK_CLASSES, type TaskClass } from './optimizer.js';
import type { AcceptedTaskCapacityEstimate } from './task-capacity.js';

export interface MixedWorkloadDemand {
  taskClass: TaskClass;
  count: number;
}

export interface MixedWorkloadQualityEvidence {
  state: QualityEvidenceState;
  samples: number;
}

export interface MixedWorkloadHarnessEvidence {
  harnessId: HarnessId;
  available: boolean;
  capacities: Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>>;
  /** Candidate-only quality evidence. Current-harness capacity is already quality-passed evidence. */
  quality?: Partial<Record<TaskClass, MixedWorkloadQualityEvidence>>;
}

export interface MixedWorkloadClassAllocation {
  taskClass: TaskClass;
  requested: number;
  current: number;
  candidate: number;
  unallocated: number;
}

export interface MixedWorkloadHarnessUsage {
  harnessId: HarnessId;
  fiveHourSpendablePercent: number | null;
  weeklySpendablePercent: number | null;
  fiveHourUsedPercent: number;
  weeklyUsedPercent: number;
}

export type MixedWorkloadAllocationKind =
  | 'stay'
  | 'split'
  | 'switch'
  | 'shortfall'
  | 'insufficient-evidence';

export interface MixedWorkloadAllocationReason {
  code: string;
  summary: string;
}

export interface MixedWorkloadAllocationDecision {
  decision: MixedWorkloadAllocationKind;
  requestedTasks: number;
  allocatedTasks: number;
  currentHarness: HarnessId;
  candidateHarness: HarnessId;
  allocations: MixedWorkloadClassAllocation[];
  currentUsage: MixedWorkloadHarnessUsage;
  candidateUsage: MixedWorkloadHarnessUsage;
  reasons: MixedWorkloadAllocationReason[];
}

interface Placement {
  harness: 'current' | 'candidate';
  harnessId: HarnessId;
  taskClass: TaskClass;
  fiveHourCost: number;
  weeklyCost: number;
  fiveHourSpendable: number;
  weeklySpendable: number;
}

interface MutableUsage {
  fiveHour: number;
  weekly: number;
}

const EPSILON = 1e-9;

function reason(code: string, summary: string): MixedWorkloadAllocationReason {
  return { code, summary };
}

function validDemand(demand: readonly MixedWorkloadDemand[]): boolean {
  if (demand.length === 0) return false;
  const seen = new Set<TaskClass>();
  for (const item of demand) {
    if (!TASK_CLASSES.includes(item.taskClass) || !Number.isSafeInteger(item.count) || item.count <= 0) {
      return false;
    }
    if (seen.has(item.taskClass)) return false;
    seen.add(item.taskClass);
  }
  return true;
}

function placementFromCapacity(
  harness: 'current' | 'candidate',
  harnessId: HarnessId,
  taskClass: TaskClass,
  capacity: AcceptedTaskCapacityEstimate | undefined,
): Placement | null {
  if (
    capacity === undefined ||
    capacity.harnessId !== harnessId ||
    capacity.taskClass !== taskClass ||
    capacity.status !== 'estimated' ||
    capacity.fiveHour.p75UsedPercentPerAcceptedTask === null ||
    capacity.weekly.p75UsedPercentPerAcceptedTask === null ||
    capacity.fiveHour.spendableRemainingPercent === null ||
    capacity.weekly.spendableRemainingPercent === null
  ) {
    return null;
  }
  const fiveHourCost = capacity.fiveHour.p75UsedPercentPerAcceptedTask;
  const weeklyCost = capacity.weekly.p75UsedPercentPerAcceptedTask;
  const fiveHourSpendable = capacity.fiveHour.spendableRemainingPercent;
  const weeklySpendable = capacity.weekly.spendableRemainingPercent;
  if (
    !Number.isFinite(fiveHourCost) ||
    !Number.isFinite(weeklyCost) ||
    !Number.isFinite(fiveHourSpendable) ||
    !Number.isFinite(weeklySpendable) ||
    fiveHourCost <= 0 ||
    weeklyCost <= 0 ||
    fiveHourSpendable < 0 ||
    weeklySpendable < 0
  ) {
    return null;
  }
  return {
    harness,
    harnessId,
    taskClass,
    fiveHourCost,
    weeklyCost,
    fiveHourSpendable,
    weeklySpendable,
  };
}

function candidatePlacementKnown(
  evidence: MixedWorkloadHarnessEvidence,
  taskClass: TaskClass,
): { placement: Placement | null; unknown: boolean } {
  if (!evidence.available) return { placement: null, unknown: false };
  const quality = evidence.quality?.[taskClass];
  if (quality === undefined || quality.state === 'unknown' || quality.samples < 3) {
    return { placement: null, unknown: true };
  }
  if (quality.state === 'failed') return { placement: null, unknown: false };
  const placement = placementFromCapacity(
    'candidate',
    evidence.harnessId,
    taskClass,
    evidence.capacities[taskClass],
  );
  return { placement, unknown: placement === null };
}

function currentPlacementKnown(
  evidence: MixedWorkloadHarnessEvidence,
  taskClass: TaskClass,
): { placement: Placement | null; unknown: boolean } {
  if (!evidence.available) return { placement: null, unknown: false };
  const placement = placementFromCapacity(
    'current',
    evidence.harnessId,
    taskClass,
    evidence.capacities[taskClass],
  );
  return { placement, unknown: placement === null };
}

function fits(placement: Placement, usage: MutableUsage): boolean {
  return (
    usage.fiveHour + placement.fiveHourCost <= placement.fiveHourSpendable + EPSILON &&
    usage.weekly + placement.weeklyCost <= placement.weeklySpendable + EPSILON
  );
}

function prospectiveScore(placement: Placement, usage: MutableUsage): [number, number] {
  const five =
    placement.fiveHourSpendable <= 0
      ? Number.POSITIVE_INFINITY
      : (usage.fiveHour + placement.fiveHourCost) / placement.fiveHourSpendable;
  const weekly =
    placement.weeklySpendable <= 0
      ? Number.POSITIVE_INFINITY
      : (usage.weekly + placement.weeklyCost) / placement.weeklySpendable;
  return [Math.max(five, weekly), five + weekly];
}

function normalizedTaskCost(placement: Placement): number {
  const five =
    placement.fiveHourSpendable <= 0
      ? Number.POSITIVE_INFINITY
      : placement.fiveHourCost / placement.fiveHourSpendable;
  const weekly =
    placement.weeklySpendable <= 0
      ? Number.POSITIVE_INFINITY
      : placement.weeklyCost / placement.weeklySpendable;
  return Math.max(five, weekly);
}

function choosePlacement(
  placements: readonly Placement[],
  currentUsage: MutableUsage,
  candidateUsage: MutableUsage,
): Placement | null {
  const feasible = placements.filter((placement) =>
    fits(placement, placement.harness === 'current' ? currentUsage : candidateUsage),
  );
  if (feasible.length === 0) return null;
  return [...feasible].sort((left, right) => {
    const leftScore = prospectiveScore(
      left,
      left.harness === 'current' ? currentUsage : candidateUsage,
    );
    const rightScore = prospectiveScore(
      right,
      right.harness === 'current' ? currentUsage : candidateUsage,
    );
    if (Math.abs(leftScore[0] - rightScore[0]) > EPSILON) return leftScore[0] - rightScore[0];
    if (Math.abs(leftScore[1] - rightScore[1]) > EPSILON) return leftScore[1] - rightScore[1];
    // Avoid a gratuitous harness switch when both placements consume the same normalized headroom.
    if (left.harness !== right.harness) return left.harness === 'current' ? -1 : 1;
    return 0;
  })[0]!;
}

function usageReport(
  harnessId: HarnessId,
  capacities: Partial<Record<TaskClass, AcceptedTaskCapacityEstimate>>,
  usage: MutableUsage,
): MixedWorkloadHarnessUsage {
  const estimated = TASK_CLASSES.map((taskClass) => capacities[taskClass]).filter(
    (entry): entry is AcceptedTaskCapacityEstimate => entry?.status === 'estimated',
  );
  const five = [...new Set(estimated.map((entry) => entry.fiveHour.spendableRemainingPercent))];
  const weekly = [...new Set(estimated.map((entry) => entry.weekly.spendableRemainingPercent))];
  return {
    harnessId,
    fiveHourSpendablePercent: five.length === 1 ? (five[0] ?? null) : null,
    weeklySpendablePercent: weekly.length === 1 ? (weekly[0] ?? null) : null,
    fiveHourUsedPercent: usage.fiveHour,
    weeklyUsedPercent: usage.weekly,
  };
}

/**
 * Deterministic conservative allocator for an explicit mixed-class backlog.
 *
 * It never compares raw Claude and Codex percentages. Each placement is expressed as the fraction
 * of that harness's own spendable five-hour and weekly allowance consumed by one quality-passed
 * task of the same class. Candidate placements additionally require at least three coherent
 * quality observations. The greedy policy places the most constrained/highest-cost class first and
 * then chooses the harness that produces the lowest prospective peak utilization. It is intentionally
 * conservative rather than a claim of globally optimal bin packing.
 */
export function allocateMixedWorkload(input: {
  demand: readonly MixedWorkloadDemand[];
  current: MixedWorkloadHarnessEvidence;
  candidate: MixedWorkloadHarnessEvidence;
}): MixedWorkloadAllocationDecision {
  const requestedTasks = input.demand.reduce((sum, item) => sum + item.count, 0);
  const base = {
    requestedTasks,
    allocatedTasks: 0,
    currentHarness: input.current.harnessId,
    candidateHarness: input.candidate.harnessId,
  };
  const emptyAllocations = input.demand.map((item) => ({
    taskClass: item.taskClass,
    requested: item.count,
    current: 0,
    candidate: 0,
    unallocated: item.count,
  }));
  const zero: MutableUsage = { fiveHour: 0, weekly: 0 };

  if (!validDemand(input.demand)) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      allocations: emptyAllocations,
      currentUsage: usageReport(input.current.harnessId, input.current.capacities, zero),
      candidateUsage: usageReport(input.candidate.harnessId, input.candidate.capacities, zero),
      reasons: [reason('mixed-workload-invalid', 'mixed workload must contain unique task classes with positive whole-number counts')],
    };
  }
  if (input.current.harnessId === input.candidate.harnessId) {
    return {
      ...base,
      decision: 'insufficient-evidence',
      allocations: emptyAllocations,
      currentUsage: usageReport(input.current.harnessId, input.current.capacities, zero),
      candidateUsage: usageReport(input.candidate.harnessId, input.candidate.capacities, zero),
      reasons: [reason('mixed-workload-same-harness', 'mixed workload allocation requires two distinct harnesses')],
    };
  }

  const currentUsage: MutableUsage = { fiveHour: 0, weekly: 0 };
  const candidateUsage: MutableUsage = { fiveHour: 0, weekly: 0 };
  const remaining = new Map<TaskClass, number>(input.demand.map((item) => [item.taskClass, item.count]));
  const allocations = new Map<TaskClass, { current: number; candidate: number; unallocated: number }>(
    input.demand.map((item) => [item.taskClass, { current: 0, candidate: 0, unallocated: 0 }]),
  );
  const evidenceUnknown = new Set<TaskClass>();

  while ([...remaining.values()].some((count) => count > 0)) {
    const choices = input.demand
      .filter((item) => (remaining.get(item.taskClass) ?? 0) > 0)
      .map((item) => {
        const current = currentPlacementKnown(input.current, item.taskClass);
        const candidate = candidatePlacementKnown(input.candidate, item.taskClass);
        if (current.unknown || candidate.unknown) evidenceUnknown.add(item.taskClass);
        const placements = [current.placement, candidate.placement].filter(
          (entry): entry is Placement => entry !== null,
        );
        const feasibleCount = placements.filter((placement) =>
          fits(placement, placement.harness === 'current' ? currentUsage : candidateUsage),
        ).length;
        const minCost = placements.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...placements.map(normalizedTaskCost));
        return { taskClass: item.taskClass, placements, feasibleCount, minCost };
      })
      .sort((left, right) => {
        // One-harness-only classes are easiest to strand; place them first. Among equally
        // constrained classes, place the more expensive task first so cheap work cannot consume
        // the only headroom that could have admitted it.
        if (left.feasibleCount !== right.feasibleCount) return left.feasibleCount - right.feasibleCount;
        if (left.minCost !== right.minCost) return right.minCost - left.minCost;
        return TASK_CLASSES.indexOf(right.taskClass) - TASK_CLASSES.indexOf(left.taskClass);
      });

    const choice = choices[0];
    if (choice === undefined) break;
    const placement = choosePlacement(choice.placements, currentUsage, candidateUsage);
    if (placement === null) {
      const left = remaining.get(choice.taskClass) ?? 0;
      allocations.get(choice.taskClass)!.unallocated += left;
      remaining.set(choice.taskClass, 0);
      continue;
    }

    const usage = placement.harness === 'current' ? currentUsage : candidateUsage;
    usage.fiveHour += placement.fiveHourCost;
    usage.weekly += placement.weeklyCost;
    allocations.get(choice.taskClass)![placement.harness] += 1;
    remaining.set(choice.taskClass, (remaining.get(choice.taskClass) ?? 1) - 1);
  }

  const allocationRows = input.demand.map((item) => {
    const row = allocations.get(item.taskClass)!;
    const remainingCount = remaining.get(item.taskClass) ?? 0;
    return {
      taskClass: item.taskClass,
      requested: item.count,
      current: row.current,
      candidate: row.candidate,
      unallocated: row.unallocated + remainingCount,
    };
  });
  const allocatedTasks = allocationRows.reduce((sum, row) => sum + row.current + row.candidate, 0);
  const unallocated = requestedTasks - allocatedTasks;
  const candidateTasks = allocationRows.reduce((sum, row) => sum + row.candidate, 0);
  const currentTasks = allocationRows.reduce((sum, row) => sum + row.current, 0);

  let decision: MixedWorkloadAllocationKind;
  const reasons: MixedWorkloadAllocationReason[] = [];
  if (unallocated > 0) {
    const unknownClasses = allocationRows
      .filter((row) => row.unallocated > 0 && evidenceUnknown.has(row.taskClass))
      .map((row) => row.taskClass);
    if (unknownClasses.length > 0) {
      decision = 'insufficient-evidence';
      reasons.push(
        reason(
          'mixed-workload-capacity-unproven',
          `Could not allocate ${String(unallocated)} task(s); evidence is incomplete for ${unknownClasses.join(', ')}`,
        ),
      );
    } else {
      decision = 'shortfall';
      reasons.push(
        reason(
          'mixed-workload-capacity-shortfall',
          `Conservative five-hour/weekly capacity leaves ${String(unallocated)} of ${String(requestedTasks)} requested task(s) unallocated`,
        ),
      );
    }
  } else if (candidateTasks === 0) {
    decision = 'stay';
    reasons.push(reason('mixed-workload-current-covers', 'The current harness can cover the full evidenced workload'));
  } else if (currentTasks === 0) {
    decision = 'switch';
    reasons.push(reason('mixed-workload-candidate-covers', 'The candidate harness can cover the full evidenced workload with quality-gated capacity'));
  } else {
    decision = 'split';
    reasons.push(
      reason(
        'mixed-workload-split',
        `A conservative split covers all ${String(requestedTasks)} task(s): ${String(currentTasks)} current and ${String(candidateTasks)} candidate`,
      ),
    );
  }

  return {
    ...base,
    allocatedTasks,
    decision,
    allocations: allocationRows,
    currentUsage: usageReport(input.current.harnessId, input.current.capacities, currentUsage),
    candidateUsage: usageReport(input.candidate.harnessId, input.candidate.capacities, candidateUsage),
    reasons,
  };
}
