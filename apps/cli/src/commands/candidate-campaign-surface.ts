import {
  diagnostic,
  type Diagnostic,
  type HarnessId,
  type OptimizationCandidateId,
  type PlatformFacts,
} from '@token-harness/core';

/**
 * Candidate campaign admission must never widen reviewed compatibility evidence.
 *
 * mcptoon currently has reviewed compatibility rows only for Codex and Claude Code
 * on native Linux. Windows, macOS, WSL and other harness families remain unreviewed
 * for candidate selection evidence and therefore fail closed.
 */
export function validateCandidateCampaignSurface(
  candidateId: OptimizationCandidateId,
  harnessId: HarnessId,
  platform: PlatformFacts,
): Diagnostic | null {
  if (candidateId !== 'mcptoon') return null;

  const reviewedHarnessFamily = harnessId === 'codex' || harnessId === 'claude';
  const reviewedPlatform = platform.os === 'linux' && !platform.isWsl;
  if (reviewedHarnessFamily && reviewedPlatform) return null;

  return diagnostic({
    severity: 'error',
    code: 'candidate-benchmark-campaign-surface-unreviewed',
    subject: 'mcptoon',
    message:
      'mcptoon selection campaigns are reviewed only on native Linux with Codex or Claude Code',
    remediation:
      'Run this campaign on an exact reviewed native-Linux compatibility row; Windows, macOS and WSL evidence cannot close the mcptoon selection gate',
  });
}
