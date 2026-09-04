import type { BudgetReport, HarnessBudgetObservation, UsageWindowScope } from './budget.js';
import type {
  CrossHarnessSchedulerInput,
  HarnessSchedulingEvidence,
} from './cross-harness-scheduler.js';
import type { HarnessId } from './ids.js';
import { assessWindowPace, type PaceState } from './optimizer.js';

export interface SchedulerPaceEvidenceNote {
  code: string;
  harnessId: HarnessId;
  scope: Extract<UsageWindowScope, 'five-hour' | 'weekly'>;
  summary: string;
}

export interface CrossHarnessPaceHydration {
  input: CrossHarnessSchedulerInput;
  notes: SchedulerPaceEvidenceNote[];
}

type SchedulerScope = SchedulerPaceEvidenceNote['scope'];

function note(
  code: string,
  harnessId: HarnessId,
  scope: SchedulerScope,
  summary: string,
): SchedulerPaceEvidenceNote {
  return { code, harnessId, scope, summary };
}

function oneObservation(
  report: BudgetReport,
  harnessId: HarnessId,
): HarnessBudgetObservation | null {
  const rows = report.harnesses.filter((entry) => entry.harnessId === harnessId);
  return rows.length === 1 ? (rows[0] ?? null) : null;
}

function deriveScopePace(input: {
  report: BudgetReport;
  harnessId: HarnessId;
  scope: SchedulerScope;
  reservePercent: number;
}): { state: PaceState; note: SchedulerPaceEvidenceNote } {
  const observation = oneObservation(input.report, input.harnessId);
  if (observation === null) {
    return {
      state: 'unknown',
      note: note(
        'budget-observation-ambiguous',
        input.harnessId,
        input.scope,
        'budget report does not contain exactly one observation for this harness',
      ),
    };
  }

  if (observation.state !== 'observed') {
    return {
      state: 'unknown',
      note: note(
        'budget-not-observed',
        input.harnessId,
        input.scope,
        `budget state is ${observation.state}; live pacing is not inferred`,
      ),
    };
  }

  const windows = observation.windows.filter(
    (window) => window.harnessId === input.harnessId && window.scope === input.scope,
  );
  if (windows.length !== 1) {
    return {
      state: 'unknown',
      note: note(
        'budget-window-ambiguous',
        input.harnessId,
        input.scope,
        `expected exactly one ${input.scope} window and observed ${String(windows.length)}`,
      ),
    };
  }

  const assessment = assessWindowPace(windows[0]!, input.report.observedAt, input.reservePercent);
  return {
    state: assessment.state,
    note: note(
      assessment.state === 'unknown' ? 'budget-pace-unknown' : 'budget-pace-observed',
      input.harnessId,
      input.scope,
      assessment.reason,
    ),
  };
}

function hydrateHarness(input: {
  evidence: HarnessSchedulingEvidence;
  report: BudgetReport;
  reservePercent: number;
}): { evidence: HarnessSchedulingEvidence; notes: SchedulerPaceEvidenceNote[] } {
  const notes: SchedulerPaceEvidenceNote[] = [];
  let fiveHourPace = input.evidence.fiveHourPace;
  let weeklyPace = input.evidence.weeklyPace;

  if (fiveHourPace === 'unknown') {
    const derived = deriveScopePace({
      report: input.report,
      harnessId: input.evidence.harnessId,
      scope: 'five-hour',
      reservePercent: input.reservePercent,
    });
    fiveHourPace = derived.state;
    notes.push(derived.note);
  } else {
    notes.push(
      note(
        'explicit-pace-preserved',
        input.evidence.harnessId,
        'five-hour',
        'explicit scheduler pace evidence was preserved',
      ),
    );
  }

  if (weeklyPace === 'unknown') {
    const derived = deriveScopePace({
      report: input.report,
      harnessId: input.evidence.harnessId,
      scope: 'weekly',
      reservePercent: input.reservePercent,
    });
    weeklyPace = derived.state;
    notes.push(derived.note);
  } else {
    notes.push(
      note(
        'explicit-pace-preserved',
        input.evidence.harnessId,
        'weekly',
        'explicit scheduler pace evidence was preserved',
      ),
    );
  }

  return {
    evidence: {
      ...input.evidence,
      fiveHourPace,
      weeklyPace,
    },
    notes,
  };
}

/**
 * Fill only unknown scheduler pace fields from independently observed budget windows.
 *
 * This adapter deliberately does not derive candidate quality from `benchmark-matrix`: the current
 * matrix compares baseline vs optimized variants inside one harness and therefore does not prove
 * cross-harness task quality. It also leaves transfer benefit untouched because Token Harness has no
 * provider-neutral token-to-subscription-quota conversion.
 */
export function hydrateCrossHarnessPaceFromBudget(
  input: CrossHarnessSchedulerInput,
  report: BudgetReport,
  reservePercent = 20,
): CrossHarnessPaceHydration {
  const current = hydrateHarness({ evidence: input.current, report, reservePercent });
  const candidate = hydrateHarness({ evidence: input.candidate, report, reservePercent });

  return {
    input: {
      ...input,
      current: current.evidence,
      candidate: candidate.evidence,
      transfer: { ...input.transfer },
    },
    notes: [...current.notes, ...candidate.notes],
  };
}
