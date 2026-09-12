import type { ProviderDetection } from '../domain/detection.js';
import type { HarnessId, ProviderId } from '../domain/ids.js';
import type { VerificationResult } from '../domain/verification.js';
import type { StackCombinationReviewEvidence } from './optimization-stack.js';

/** Exact machine-observed identity of a configured multi-provider stack. */
export interface StackCombinationFingerprint {
  providerIds: ProviderId[];
  versions: Readonly<Record<string, string>>;
  configuredHarnesses: Readonly<Record<string, HarnessId[]>>;
}

export type StackCombinationRuntimeEvidenceState =
  | 'observed'
  | 'not-exercised'
  | 'failed'
  | 'unavailable';

/** Passive verification evidence for one exact configured provider × harness pair. */
export interface StackCombinationVerificationEvidence {
  providerId: ProviderId;
  harnessId: HarnessId;
  declaredTier: VerificationResult['declaredTier'] | null;
  verificationStatus: VerificationResult['status'] | null;
  runtimeEvidence: StackCombinationRuntimeEvidenceState;
  detail: string;
}

/** Read-only capture handed to a human/reviewer before any compatibility decision exists. */
export interface StackCombinationReviewCaptureReport {
  capturedAt: string;
  ready: boolean;
  fingerprint: StackCombinationFingerprint | null;
  verificationEvidence: StackCombinationVerificationEvidence[];
  reviewState: 'pending-manual-decision';
  instructions: string[];
}

/**
 * Deliberately reviewed evidence for one exact provider/version/harness combination.
 *
 * There are no wildcards. A provider update or configuration change makes an old
 * record stop matching until that new combination is reviewed on its own evidence.
 */
export interface StackCombinationReviewRecord extends StackCombinationFingerprint {
  state: 'reviewed' | 'incompatible';
  detail: string;
  evidence: string[];
}

function normalizeProviders(values: readonly ProviderId[]): ProviderId[] {
  return [...new Set(values)].sort();
}

function normalizeHarnesses(values: readonly HarnessId[]): HarnessId[] {
  return [...new Set(values)].sort();
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Capture only providers that are actually configured. Installed-but-unused providers
 * are not part of the combined runtime surface that RFC 0027 requires us to review.
 * Duplicate provider detections and unknown provider versions fail closed because
 * neither can identify one exact reproducible combination.
 */
export function fingerprintConfiguredStack(
  detections: readonly ProviderDetection[],
): StackCombinationFingerprint | null {
  const configured = detections.filter((row) => row.state === 'configured');
  if (configured.length < 2 || configured.some((row) => row.version === null)) return null;

  const providerIds = normalizeProviders(configured.map((row) => row.providerId));
  if (providerIds.length !== configured.length) return null;

  const versions: Record<string, string> = {};
  const configuredHarnesses: Record<string, HarnessId[]> = {};
  for (const provider of configured) {
    // The null case was rejected above. Keep the local guard so this remains fail-closed
    // even if the loop is refactored independently of the precondition later.
    if (provider.version === null) return null;
    versions[provider.providerId] = provider.version;
    configuredHarnesses[provider.providerId] = normalizeHarnesses(provider.configuredHarnesses);
  }

  return { providerIds, versions, configuredHarnesses };
}

function runtimeEvidenceFor(
  result: VerificationResult | undefined,
): Pick<StackCombinationVerificationEvidence, 'runtimeEvidence' | 'detail'> {
  if (result === undefined) {
    return {
      runtimeEvidence: 'unavailable',
      detail: 'No passive verification result was available for this configured integration.',
    };
  }

  const failed = result.checks.find((check) => check.status === 'fail');
  if (result.status === 'failed' || failed !== undefined) {
    return {
      runtimeEvidence: 'failed',
      detail: failed?.summary ?? `Verification status is ${result.status}.`,
    };
  }

  const observed = result.checks.find(
    (check) => check.status === 'pass' && check.achievedTier === 'canary',
  );
  if (observed !== undefined) {
    return { runtimeEvidence: 'observed', detail: observed.summary };
  }

  const notExercised = result.checks.find((check) => check.status === 'not-exercised');
  if (notExercised !== undefined) {
    return { runtimeEvidence: 'not-exercised', detail: notExercised.summary };
  }

  const unattributed = result.checks.find(
    (check) => check.id === 'canary-intercepted' && check.status === 'info',
  );
  if (unattributed !== undefined) {
    return { runtimeEvidence: 'unavailable', detail: unattributed.summary };
  }

  return {
    runtimeEvidence: 'unavailable',
    detail:
      result.status === 'degraded'
        ? 'The declared runtime tier was not reached with evidence attributable to this exact harness.'
        : 'The integration is healthy at its declared tier, but no passive runtime canary is available.',
  };
}

/**
 * Project passive verification onto the exact configured provider × harness pairs in a captured
 * fingerprint. This is review evidence only: it never upgrades the combination to reviewed and it
 * never turns `not-exercised` into an ordinary verification failure.
 */
export function summarizeStackCombinationVerification(
  fingerprint: StackCombinationFingerprint | null,
  results: readonly VerificationResult[],
): StackCombinationVerificationEvidence[] {
  if (fingerprint === null) return [];

  const evidence: StackCombinationVerificationEvidence[] = [];
  for (const providerId of fingerprint.providerIds) {
    for (const harnessId of fingerprint.configuredHarnesses[providerId] ?? []) {
      const result = results.find(
        (row) => row.providerId === providerId && row.harnessId === harnessId,
      );
      const runtime = runtimeEvidenceFor(result);
      evidence.push({
        providerId,
        harnessId,
        declaredTier: result?.declaredTier ?? null,
        verificationStatus: result?.status ?? null,
        ...runtime,
      });
    }
  }
  return evidence;
}

function recordMatches(
  record: StackCombinationReviewRecord,
  fingerprint: StackCombinationFingerprint,
): boolean {
  const recordProviders = normalizeProviders(record.providerIds);
  if (
    recordProviders.length !== record.providerIds.length ||
    !sameStrings(recordProviders, fingerprint.providerIds)
  ) {
    return false;
  }

  for (const providerId of fingerprint.providerIds) {
    if (
      !(providerId in record.versions) ||
      record.versions[providerId] !== fingerprint.versions[providerId]
    ) {
      return false;
    }
    const expected = normalizeHarnesses(record.configuredHarnesses[providerId] ?? []);
    const observed = fingerprint.configuredHarnesses[providerId] ?? [];
    if (!sameStrings(expected, observed)) return false;
  }

  // Extra per-provider keys are rejected too. A review artifact must describe only
  // the exact provider set it claims to cover, never a superset that happens to match.
  const versionKeys = Object.keys(record.versions).sort();
  const harnessKeys = Object.keys(record.configuredHarnesses).sort();
  return (
    sameStrings(versionKeys, fingerprint.providerIds) &&
    sameStrings(harnessKeys, fingerprint.providerIds)
  );
}

/** Return explicit review evidence only for an exact configured-stack match. */
export function selectStackCombinationReview(
  records: readonly StackCombinationReviewRecord[],
  detections: readonly ProviderDetection[],
): StackCombinationReviewEvidence | null {
  const fingerprint = fingerprintConfiguredStack(detections);
  if (fingerprint === null) return null;

  const match = records.find((record) => recordMatches(record, fingerprint));
  if (match === undefined) return null;

  return {
    state: match.state,
    providerIds: [...fingerprint.providerIds],
    detail: match.detail,
    evidence: [...match.evidence],
  };
}
