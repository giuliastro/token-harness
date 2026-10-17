/** Versioned external observability contract, independent of the CLI envelope. */
import type { BudgetReport } from './budget.js';
import type { HarnessId } from './ids.js';
import type { HarnessState } from './detection.js';
import type { MetricsReport } from '../metrics/report.js';

export const OBSERVE_CONTRACT_VERSION = 1 as const;

export interface ObserveAgent {
  harnessId: HarnessId;
  name: string;
  state: HarnessState | 'error';
  version: string | null;
}

/** Native quota windows and stored metrics are independent sources of evidence. */
export interface ObserveReport {
  contractVersion: typeof OBSERVE_CONTRACT_VERSION;
  observedAt: string;
  readOnly: true;
  metricsFreshness: 'stored-only';
  quotas: BudgetReport;
  agents: ObserveAgent[];
  metrics: MetricsReport;
}
