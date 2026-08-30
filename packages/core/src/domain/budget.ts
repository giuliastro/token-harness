/**
 * Subscription-usage observability — RFC 0011.
 *
 * These types deliberately keep backend quota separate from local token metrics. A percentage
 * reported by a harness is authoritative for that window; a reducer's token count is not.
 */

import type { Diagnostic } from './diagnostics.js';
import type { HarnessId } from './ids.js';
import type { PlatformFacts } from './platform.js';

export type UsageWindowScope = 'five-hour' | 'weekly' | 'monthly' | 'model' | 'credit' | 'unknown';

export type UsageWindowSource =
  | 'native-rpc'
  | 'native-cli'
  | 'companion-cli'
  | 'local-history'
  | 'unknown';
export type UsageConfidence = 'authoritative' | 'reported' | 'cached' | 'estimated';

export interface UsageWindowSnapshot {
  harnessId: HarnessId;
  /** Backend bucket identity when the harness exposes one. Never inferred from a model name. */
  bucketId: string | null;
  /** Human-readable backend label when available. */
  bucketName: string | null;
  /** Some providers expose a primary and secondary window for the same metered bucket. */
  window: 'primary' | 'secondary' | null;
  scope: UsageWindowScope;
  usedPercent: number | null;
  remainingPercent: number | null;
  windowDurationMinutes: number | null;
  resetsAt: string | null;
  observedAt: string;
  source: UsageWindowSource;
  confidence: UsageConfidence;
}

export type HarnessBudgetState = 'observed' | 'unavailable' | 'absent' | 'error';

export interface HarnessBudgetObservation {
  harnessId: HarnessId;
  state: HarnessBudgetState;
  windows: UsageWindowSnapshot[];
  /** Backend plan name when the harness returns one. Informational only. */
  planType: string | null;
  /** Backend reason a limit is reached, when present. */
  rateLimitReachedType: string | null;
  /** Read-only reset-credit inventory. Token Harness never consumes credits from this command. */
  resetCreditsAvailable: number | null;
  diagnostics: Diagnostic[];
}

export interface BudgetReport {
  platform: PlatformFacts;
  observedAt: string;
  harnesses: HarnessBudgetObservation[];
}
