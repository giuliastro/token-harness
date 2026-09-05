/** The progressive onboarding result behind `token-harness setup`. */

import type { ApplyReport, DoctorReport } from './reports.js';
import type { BudgetReport } from './budget.js';
import type { PlanReport } from './plan.js';
import type { VerifyReport } from './verification.js';

export type SetupStage = 'needs-harness' | 'ready-to-configure' | 'ready' | 'attention';

export interface SetupNextStep {
  command: string | null;
  description: string;
}

/**
 * Setup deliberately keeps every underlying report. Human output can stay short while
 * `--json` and `--verbose` retain the evidence used to choose the single next step.
 */
export interface SetupReport {
  stage: SetupStage;
  /** True only when harness/provider configuration was committed. */
  changed: boolean;
  doctor: DoctorReport;
  plan: PlanReport | null;
  apply: ApplyReport | null;
  verify: VerifyReport | null;
  budget: BudgetReport | null;
  nextStep: SetupNextStep;
}
