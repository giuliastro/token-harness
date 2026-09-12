/**
 * Optimization-stack projection — RFC 0027.
 *
 * This module does not discover, install, verify, measure, update, or remove providers. Those
 * responsibilities remain with the existing adapter and transactional command contracts. It only
 * projects their already-observed evidence into one lifecycle snapshot suitable for a CLI or UI.
 *
 * The important constraint is negative: unlike a dashboard convenience layer, this projection is
 * not allowed to manufacture equivalences. Local token/character reductions remain provider
 * measurement rows; subscription allowance, billed API cost, and task quality need their own
 * evidence elsewhere. Nothing here turns one into another or adds unlike rows together.
 */

import type { ProviderDetection } from '../domain/detection.js';
import type { DriftFinding, ProviderUpdateRow } from '../domain/reports.js';
import type { HarnessId, ProviderId } from '../domain/ids.js';
import type { Diagnostic } from '../domain/diagnostics.js';
import type { VerifyReport } from '../domain/verification.js';
import type { MetricsReport, ProviderSavingsRow } from './report.js';

export const OPTIMIZATION_CATEGORIES = [
  'command-output-reduction',
  'context-minimization',
  'repository-retrieval',
  'mcp-discovery',
  'result-compression',
  'native-policy',
  'other',
] as const;
export type OptimizationCategory = (typeof OPTIMIZATION_CATEGORIES)[number];

export interface OptimizationComponentDescriptor {
  providerId: ProviderId;
  displayName: string;
  category: OptimizationCategory;
}

export type StackVerificationState =
  | 'not-checked'
  | 'verified'
  | 'degraded'
  | 'not-exercised'
  | 'not-applicable';

export type StackHealthState = 'healthy' | 'attention' | 'unknown';

export type StackUpdateState =
  | 'not-checked'
  | 'current'
  | 'available'
  | 'blocked'
  | 'pinned'
  | 'unknown'
  | 'unavailable'
  | 'not-installed'
  | 'no-channel';

export type StackQualityState = 'preserved' | 'regressed' | 'not-measured' | 'not-attributed';
export type StackQualityConfidence = 'none' | 'low' | 'medium' | 'high';

export interface StackQualityEvidence {
  state: StackQualityState;
  confidence: StackQualityConfidence;
  detail: string;
}

export interface StackConflict {
  code: string;
  detail: string;
  remediation: string | null;
}

export type StackNextActionKind =
  | 'install-configure'
  | 'configure'
  | 'verify'
  | 'review-health'
  | 'review-update'
  | 'measure';

export interface StackNextAction {
  kind: StackNextActionKind;
  reason: string;
}

export interface OptimizationStackComponent {
  providerId: ProviderId;
  displayName: string;
  category: OptimizationCategory;
  /** Raw adapter state is retained so consumers never have to reverse-engineer a boolean. */
  detectedState: ProviderDetection['state'];
  version: string | null;
  installed: boolean;
  configured: boolean;
  configuredHarnesses: HarnessId[];
  managedByTokenHarness: boolean;
  verification: StackVerificationState;
  health: StackHealthState;
  /** Provider rows are intentionally not combined across class or unit. */
  savings: ProviderSavingsRow[];
  quality: StackQualityEvidence;
  conflicts: StackConflict[];
  update: StackUpdateState;
  updateAvailableVersion: string | null;
  warnings: Diagnostic[];
  /** Exactly zero or one recommended lifecycle action. Healthy steady state is null. */
  nextAction: StackNextAction | null;
}

export type StackCombinationReviewState =
  | 'not-applicable'
  | 'not-recorded'
  | 'reviewed'
  | 'incompatible';

/** Explicit evidence that one exact provider set was reviewed together. */
export interface StackCombinationReviewEvidence {
  state: 'reviewed' | 'incompatible';
  providerIds: ProviderId[];
  detail: string;
  evidence: string[];
}

/** Product-facing projection. Individual compatibility or verification never fills this by inference. */
export interface StackCombinationReview {
  state: StackCombinationReviewState;
  providerIds: ProviderId[];
  detail: string;
  evidence: string[];
}

export interface OptimizationStackSnapshot {
  components: OptimizationStackComponent[];
  /** Drift that the existing report cannot truthfully attribute to one provider stays here. */
  unattributedDrift: DriftFinding[];
  /** Exact multi-component review state. Missing evidence is represented as not-recorded. */
  combinationReview: StackCombinationReview;
  state: 'empty' | 'incomplete' | 'attention' | 'healthy';
}

export interface BuildOptimizationStackInput {
  components: readonly OptimizationComponentDescriptor[];
  detections: readonly ProviderDetection[];
  verification?: VerifyReport | null;
  metrics?: MetricsReport | null;
  updates?: readonly ProviderUpdateRow[] | null;
  /** Only pass provider-attributed quality when the evidence really supports that attribution. */
  qualityByProvider?: ReadonlyMap<ProviderId, StackQualityEvidence>;
  /** Same rule for conflicts. Status drift without provider identity belongs in unattributedDrift. */
  conflictsByProvider?: ReadonlyMap<ProviderId, readonly StackConflict[]>;
  unattributedDrift?: readonly DriftFinding[];
  /** Exact-set evidence only. Individual compatibility rows must never imply a combined review. */
  combinationReview?: StackCombinationReviewEvidence | null;
}

function installed(state: ProviderDetection['state']): boolean {
  // `available` means the adapter can see a candidate but has not established an installed build.
  return state === 'installed' || state === 'configured' || state === 'broken';
}

function verificationState(
  detection: ProviderDetection,
  report: VerifyReport | null | undefined,
): StackVerificationState {
  if (report === undefined || report === null) return 'not-checked';
  const rows = report.results.filter((row) => row.providerId === detection.providerId);
  if (rows.length === 0) return detection.state === 'absent' ? 'not-applicable' : 'not-checked';
  if (rows.some((row) => row.status === 'degraded' || row.status === 'failed')) return 'degraded';
  if (rows.every((row) => row.status === 'healthy')) return 'verified';
  if (rows.some((row) => row.status === 'not-applicable')) return 'not-exercised';
  return 'not-checked';
}

function updateState(row: ProviderUpdateRow | undefined): StackUpdateState {
  if (row === undefined) return 'not-checked';
  switch (row.verdict) {
    case 'current':
      return 'current';
    case 'upgradable':
      return 'available';
    case 'blocked-unreviewed':
      return 'blocked';
    case 'pinned':
      return 'pinned';
    case 'unknown':
      return 'unknown';
    case 'unavailable':
      return 'unavailable';
    case 'not-installed':
      return 'not-installed';
    case 'no-channel':
      return 'no-channel';
  }
}

function healthState(input: {
  detection: ProviderDetection;
  verification: StackVerificationState;
  quality: StackQualityEvidence;
  conflicts: readonly StackConflict[];
}): StackHealthState {
  if (
    input.detection.state === 'broken' ||
    input.detection.versionVerdict === 'unknown-newer' ||
    input.verification === 'degraded' ||
    input.quality.state === 'regressed' ||
    input.conflicts.length > 0 ||
    input.detection.warnings.some((warning) => warning.severity === 'error')
  ) {
    return 'attention';
  }
  if (input.detection.state === 'configured' && input.verification === 'verified') return 'healthy';
  return 'unknown';
}

function nextAction(input: {
  detection: ProviderDetection;
  verification: StackVerificationState;
  health: StackHealthState;
  update: StackUpdateState;
  savings: readonly ProviderSavingsRow[];
}): StackNextAction | null {
  if (input.health === 'attention') {
    return {
      kind: 'review-health',
      reason: 'The current evidence reports a broken, degraded, conflicting, or unsafe state.',
    };
  }
  if (input.detection.state === 'absent' || input.detection.state === 'available') {
    return {
      kind: 'install-configure',
      reason: 'This optimization component is not installed and configured yet.',
    };
  }
  if (input.detection.state === 'installed') {
    return {
      kind: 'configure',
      reason: 'The component is installed but not configured for an agent.',
    };
  }
  if (input.detection.state === 'configured' && input.verification === 'not-checked') {
    return {
      kind: 'verify',
      reason: 'Configuration was found, but runtime verification has not been checked.',
    };
  }
  if (input.detection.state === 'configured' && input.verification === 'not-exercised') {
    return {
      kind: 'verify',
      reason: 'The integration is configured but has not produced enough execution evidence yet.',
    };
  }
  if (input.update === 'available' || input.update === 'blocked') {
    return {
      kind: 'review-update',
      reason:
        input.update === 'available'
          ? 'A newer provider version is available for review.'
          : 'A newer version exists but is outside the currently reviewed compatibility range.',
    };
  }
  if (input.health === 'healthy' && input.savings.length === 0) {
    return {
      kind: 'measure',
      reason:
        'The integration is healthy; keep using it normally so measured savings evidence can accumulate.',
    };
  }
  return null;
}

function defaultQuality(): StackQualityEvidence {
  return {
    state: 'not-attributed',
    confidence: 'none',
    detail:
      'No provider-attributed quality evidence was supplied. Quality must not be inferred from local savings.',
  };
}

function savingsForProvider(report: MetricsReport | null | undefined, providerId: ProviderId) {
  return (report?.providers ?? [])
    .filter((row) => row.providerId === providerId)
    .map((row) => ({ ...row, harnesses: [...row.harnesses] }));
}

function sameProviderSet(left: readonly ProviderId[], right: readonly ProviderId[]): boolean {
  const normalize = (values: readonly ProviderId[]) => [...new Set(values)].sort();
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function combinationReview(
  components: readonly OptimizationStackComponent[],
  evidence: StackCombinationReviewEvidence | null | undefined,
): StackCombinationReview {
  const providerIds = components
    .filter((component) => component.configured)
    .map((component) => component.providerId)
    .sort();
  if (providerIds.length < 2) {
    return {
      state: 'not-applicable',
      providerIds,
      detail:
        'A combined-stack review is required only when two or more managed components are configured.',
      evidence: [],
    };
  }
  if (
    evidence === null ||
    evidence === undefined ||
    !sameProviderSet(providerIds, evidence.providerIds)
  ) {
    return {
      state: 'not-recorded',
      providerIds,
      detail:
        evidence === null || evidence === undefined
          ? 'No exact combined-stack review is recorded. Individual compatibility rows and runtime verification do not prove these components were reviewed together.'
          : 'The supplied combined-stack review does not match the exact configured provider set, so it is not used.',
      evidence: [],
    };
  }
  return {
    state: evidence.state,
    providerIds,
    detail: evidence.detail,
    evidence: [...evidence.evidence],
  };
}

/**
 * Build the product-facing stack state from already-observed lifecycle evidence.
 *
 * This function is intentionally pure. In particular it does not run update checks, active
 * canaries, network calls, or background refreshes. A caller that has not explicitly collected
 * one of those facts gets `not-checked`, not a reassuring guess.
 */
export function buildOptimizationStack(
  input: BuildOptimizationStackInput,
): OptimizationStackSnapshot {
  const detections = new Map(input.detections.map((row) => [row.providerId, row]));
  const updates = new Map((input.updates ?? []).map((row) => [row.providerId, row]));
  const components: OptimizationStackComponent[] = [];

  for (const descriptor of input.components) {
    const detection = detections.get(descriptor.providerId);
    if (detection === undefined) continue;
    const verification = verificationState(detection, input.verification);
    const quality = input.qualityByProvider?.get(descriptor.providerId) ?? defaultQuality();
    const conflicts = [...(input.conflictsByProvider?.get(descriptor.providerId) ?? [])];
    const health = healthState({ detection, verification, quality, conflicts });
    const updateRow = updates.get(descriptor.providerId);
    const update = updateState(updateRow);
    const savings = savingsForProvider(input.metrics, descriptor.providerId);

    components.push({
      providerId: descriptor.providerId,
      displayName: descriptor.displayName,
      category: descriptor.category,
      detectedState: detection.state,
      version: detection.version,
      installed: installed(detection.state),
      configured: detection.state === 'configured',
      configuredHarnesses: [...detection.configuredHarnesses],
      managedByTokenHarness: detection.managedByTokenHarness,
      verification,
      health,
      savings,
      quality,
      conflicts,
      update,
      updateAvailableVersion:
        updateRow?.verdict === 'upgradable' || updateRow?.verdict === 'blocked-unreviewed'
          ? updateRow.available
          : null,
      warnings: [...detection.warnings],
      nextAction: nextAction({ detection, verification, health, update, savings }),
    });
  }

  const unattributedDrift = [...(input.unattributedDrift ?? [])];
  const combined = combinationReview(components, input.combinationReview);
  const present = components.filter((component) => component.detectedState !== 'absent');
  const state: OptimizationStackSnapshot['state'] =
    present.length === 0
      ? 'empty'
      : present.some((component) => component.health === 'attention') ||
          unattributedDrift.length > 0 ||
          combined.state === 'incompatible'
        ? 'attention'
        : present.every(
              (component) =>
                component.health === 'healthy' &&
                component.nextAction === null &&
                (component.update === 'current' || component.update === 'pinned'),
            ) && combined.state !== 'not-recorded'
          ? 'healthy'
          : 'incomplete';

  return { components, unattributedDrift, combinationReview: combined, state };
}
