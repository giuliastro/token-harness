import type { VerificationResult } from '@token-harness/core';

type HarnessId = VerificationResult['harnessId'];

export function harnessesForVerification(
  selected: HarnessId | null,
  configured: readonly HarnessId[],
  present: readonly HarnessId[],
): HarnessId[] {
  if (selected !== null) return present.includes(selected) ? [selected] : [];
  return configured.length > 0 ? [...configured] : [...present];
}

export function statusFor(
  achieved: VerificationResult['declaredTier'] | null,
  declared: VerificationResult['declaredTier'],
  checks: VerificationResult['checks'] = [],
): VerificationResult['status'] {
  // A passive canary has not failed merely because it has not run. Do not let a separate
  // config-only check turn that absence of evidence into a degraded result.
  const canaryNotExercised = checks.some(
    (check) =>
      (check.id === 'canary-intercepted' || check.id.startsWith('rtk-attribution-')) &&
      (check.status === 'not-exercised' ||
        (check.status === 'info' && check.achievedTier === null)),
  );
  const noObservedOutcome =
    checks.length > 0 &&
    checks.some((check) => check.status === 'not-exercised') &&
    checks.every((check) => check.status === 'not-exercised' || check.status === 'info');
  if (canaryNotExercised || noObservedOutcome) return 'not-applicable';

  const order = ['presence', 'config-only', 'canary', 'live-receipt'];
  if (achieved === null) return 'not-applicable';
  const reached = order.indexOf(achieved);
  const promised = order.indexOf(declared);
  if (reached < 0 || promised < 0) return 'not-applicable';
  return reached >= promised ? 'healthy' : 'degraded';
}

export function allResultsAtDeclaredTier(results: readonly VerificationResult[]): boolean {
  return results.every((result) => result.status === 'healthy');
}

export function verificationHasProblems(
  results: readonly VerificationResult[],
  failedCheckCount: number,
): boolean {
  return (
    failedCheckCount > 0 ||
    results.some((result) => result.status === 'degraded' || result.status === 'failed')
  );
}
