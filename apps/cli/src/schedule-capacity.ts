import {
  estimateAcceptedTaskCapacity,
  type AcceptedTaskCapacityEstimate,
  type BudgetReport,
  type CrossHarnessSchedulerInput,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

export interface ScheduleCapacityHydration {
  input: CrossHarnessSchedulerInput;
  current: AcceptedTaskCapacityEstimate;
  candidate: AcceptedTaskCapacityEstimate;
}

/**
 * Attach accepted-task capacity only from evidence already observed for this schedule invocation.
 * Explicit evidence paths that deliberately skipped live/local observation therefore remain
 * untouched rather than causing a second hidden observation.
 */
export function hydrateScheduleCapacity(
  input: CrossHarnessSchedulerInput,
  report: BudgetReport,
  receipts: readonly TaskBenchmarkReceipt[],
): ScheduleCapacityHydration {
  const current = estimateAcceptedTaskCapacity({
    report,
    receipts,
    harnessId: input.current.harnessId,
    taskClass: input.taskClass,
  });
  const candidate = estimateAcceptedTaskCapacity({
    report,
    receipts,
    harnessId: input.candidate.harnessId,
    taskClass: input.taskClass,
  });
  return {
    input: {
      ...input,
      current: {
        ...input.current,
        acceptedTasksRemaining:
          current.status === 'estimated' ? current.acceptedTasksRemaining : null,
      },
      candidate: {
        ...input.candidate,
        acceptedTasksRemaining:
          candidate.status === 'estimated' ? candidate.acceptedTasksRemaining : null,
      },
    },
    current,
    candidate,
  };
}
