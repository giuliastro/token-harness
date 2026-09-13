import {
  COMPATIBILITY_ROWS,
  admitManagedMutation,
  diagnostic,
  providerId,
  type Diagnostic,
  type HarnessId,
  type OptimizationCandidateId,
  type PlatformFacts,
} from '@token-harness/core';
import { MCPTOON_REVIEWED_INSTALL_VERSION, parseMcptoonVersion } from '@token-harness/adapters';

import type { CommandContext } from './context.js';

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

function parseObservedVersion(output: string): string | null {
  return output.match(/(?:^|\D)(\d+\.\d+\.\d+)(?:\D|$)/)?.[1] ?? null;
}

async function readExecutableVersion(
  context: CommandContext,
  executable: string,
): Promise<string | null> {
  if (context.adapters === null) return null;
  const outcome = await context.adapters.runner.run({
    executable,
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (outcome.failure !== null || outcome.exitCode !== 0) return null;
  return parseObservedVersion(`${outcome.stdout}\n${outcome.stderr}`);
}

/**
 * Require the exact reviewed harness row before creating or guiding mcptoon selection evidence.
 * The provider binary is required only for an optimized start: a baseline is allowed before
 * mcptoon is enabled, but it still has to run on the exact reviewed harness/platform row.
 */
export async function validateCandidateCampaignRuntimeSurface(
  context: CommandContext,
  requireProviderVersion: boolean,
): Promise<Diagnostic | null> {
  const candidateId = context.optimizationCandidate ?? null;
  const harnessId = context.harness;
  if (candidateId !== 'mcptoon' || harnessId === null) return null;

  const surfaceProblem = validateCandidateCampaignSurface(candidateId, harnessId, context.platform);
  if (surfaceProblem !== null) return surfaceProblem;

  if (context.adapters === null) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-version-unavailable',
      subject: 'mcptoon',
      message: 'The exact harness version cannot be established for this mcptoon campaign',
      remediation: 'Run the campaign from the normal CLI host so the reviewed compatibility row can be verified',
    });
  }

  const harnessVersion = await readExecutableVersion(context, harnessId);
  const admission = admitManagedMutation(context.compatibilityRows ?? COMPATIBILITY_ROWS, {
    provider: providerId('mcptoon'),
    providerVersion: MCPTOON_REVIEWED_INSTALL_VERSION,
    harness: harnessId,
    harnessVersion,
    os: context.platform.os,
    wsl: context.platform.isWsl,
  });
  if (admission.state !== 'admitted') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-row-unreviewed',
      subject: 'mcptoon',
      message: `The installed ${harnessId} version ${harnessVersion ?? 'unknown'} is outside the exact reviewed mcptoon compatibility row`,
      remediation: admission.missing,
    });
  }

  if (!requireProviderVersion) return null;

  const outcome = await context.adapters.runner.run({
    executable: 'mcptoon',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const mcptoonVersion =
    outcome.failure === null && outcome.exitCode === 0
      ? parseMcptoonVersion(`${outcome.stdout}\n${outcome.stderr}`)
      : null;
  if (mcptoonVersion !== MCPTOON_REVIEWED_INSTALL_VERSION) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-provider-version-unreviewed',
      subject: 'mcptoon',
      message: `The optimized campaign requires mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION}; observed ${mcptoonVersion ?? 'unavailable'}`,
      remediation: `Install the exact reviewed mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION} build before starting the optimized pair`,
    });
  }

  return null;
}
