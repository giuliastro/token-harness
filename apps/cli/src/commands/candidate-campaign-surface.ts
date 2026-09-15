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
import {
  GITNEXUS_REVIEWED_BENCHMARK_VERSION,
  MCPTOON_REVIEWED_INSTALL_VERSION,
  parseGitNexusVersion,
  parseMcptoonVersion,
} from '@token-harness/adapters';

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

type GitNexusIndexReadiness =
  | { state: 'up-to-date'; detail: null }
  | { state: 'not-ready'; detail: string | null }
  | { state: 'invalid'; detail: null };

function safeGitNexusStatusLabel(value: unknown): string | null {
  return typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value) ? value : null;
}

function parseGitNexusIndexReadiness(output: string): GitNexusIndexReadiness {
  try {
    const parsed = JSON.parse(output) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { state: 'invalid', detail: null };
    }
    const receipt = parsed as Record<string, unknown>;
    if (receipt.schemaVersion !== 1) return { state: 'invalid', detail: null };

    const status = safeGitNexusStatusLabel(receipt.status);
    const error = safeGitNexusStatusLabel(receipt.error);
    if (status === 'up-to-date' && receipt.error === undefined) {
      return { state: 'up-to-date', detail: null };
    }
    if (receipt.error !== undefined) return { state: 'not-ready', detail: error };
    if (receipt.status !== undefined) return { state: 'not-ready', detail: status };
    return { state: 'invalid', detail: null };
  } catch {
    return { state: 'invalid', detail: null };
  }
}

async function validateGitNexusBenchmarkStart(context: CommandContext): Promise<Diagnostic | null> {
  // Matrix/report reads must remain possible even when the exact campaign environment is no longer
  // installed. New captures, however, need both an RFC 0009 compatibility row and the exact reviewed
  // GitNexus build. The production row table intentionally contains no GitNexus row until a real
  // harness/platform lifecycle recording has been reviewed.
  if (context.benchmarkVariant === null) return null;
  const harnessId = context.harness;
  if (context.adapters === null || harnessId === null) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-version-unavailable',
      subject: 'gitnexus',
      message:
        'The exact harness and GitNexus versions cannot be established before this benchmark start',
      remediation:
        'Run the campaign from the normal CLI host with an explicit harness after its exact GitNexus compatibility row has been reviewed',
    });
  }

  const harnessVersion = await readExecutableVersion(context, harnessId);
  const admission = admitManagedMutation(context.compatibilityRows ?? COMPATIBILITY_ROWS, {
    provider: providerId('gitnexus'),
    providerVersion: GITNEXUS_REVIEWED_BENCHMARK_VERSION,
    harness: harnessId,
    harnessVersion,
    os: context.platform.os,
    wsl: context.platform.isWsl,
  });
  if (admission.state !== 'admitted') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-row-unreviewed',
      subject: 'gitnexus',
      message: `The installed ${harnessId} version ${harnessVersion ?? 'unknown'} is outside any exact reviewed GitNexus campaign compatibility row`,
      remediation: admission.missing,
    });
  }

  const outcome = await context.adapters.runner.run({
    executable: 'gitnexus',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  const version =
    outcome.failure === null && outcome.exitCode === 0
      ? parseGitNexusVersion(`${outcome.stdout}\n${outcome.stderr}`)
      : null;
  if (version !== GITNEXUS_REVIEWED_BENCHMARK_VERSION) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-provider-version-unreviewed',
      subject: 'gitnexus',
      message: `GitNexus benchmark starts require exact reviewed build ${GITNEXUS_REVIEWED_BENCHMARK_VERSION}; observed ${version ?? 'unavailable'}`,
      remediation: `Install or select GitNexus ${GITNEXUS_REVIEWED_BENCHMARK_VERSION} before starting this pair; Token Harness does not install GitNexus automatically`,
    });
  }

  const statusOutcome = await context.adapters.runner.run({
    executable: 'gitnexus',
    args: ['status', '--json'],
    cwd: context.projectRoot,
    timeoutMs: 30_000,
  });
  if (
    statusOutcome.failure !== null ||
    statusOutcome.exitCode !== 0 ||
    statusOutcome.stdoutTruncated
  ) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-index-status-unavailable',
      subject: 'gitnexus',
      message: 'GitNexus index readiness could not be established before this benchmark start',
      remediation:
        'Run gitnexus status --json from this repository. If needed, prepare the index with gitnexus analyze --index-only, then retry. Token Harness does not create or refresh GitNexus indexes automatically.',
    });
  }

  const readiness = parseGitNexusIndexReadiness(statusOutcome.stdout);
  if (readiness.state === 'invalid') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-index-status-unavailable',
      subject: 'gitnexus',
      message:
        'GitNexus returned an invalid machine-readable index status before this benchmark start',
      remediation:
        'Run gitnexus status --json from this repository. If needed, prepare the index with gitnexus analyze --index-only, then retry. Token Harness does not create or refresh GitNexus indexes automatically.',
    });
  }
  if (readiness.state === 'not-ready') {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-index-not-ready',
      subject: 'gitnexus',
      message: `GitNexus index is not ready for candidate benchmarking${readiness.detail === null ? '' : ` (${readiness.detail})`}`,
      remediation:
        'Run gitnexus analyze --index-only from this repository, confirm gitnexus status --json reports up-to-date, then retry. Token Harness does not create or refresh the index automatically.',
    });
  }

  return null;
}

/**
 * Require the exact reviewed runtime surface before creating candidate selection evidence.
 * mcptoon requires its exact harness row and the provider build only for optimized starts.
 * GitNexus requires an exact RFC 0009 harness/platform row plus its reviewed build for both
 * baseline and optimized starts. This keeps compatibility evidence independent from version
 * discovery and does not imply that the baseline activates GitNexus.
 */
export async function validateCandidateCampaignRuntimeSurface(
  context: CommandContext,
  requireProviderVersion: boolean,
): Promise<Diagnostic | null> {
  const candidateId = context.optimizationCandidate ?? null;
  const harnessId = context.harness;

  if (candidateId === 'gitnexus') {
    return validateGitNexusBenchmarkStart(context);
  }
  if (candidateId !== 'mcptoon' || harnessId === null) return null;

  const surfaceProblem = validateCandidateCampaignSurface(candidateId, harnessId, context.platform);
  if (surfaceProblem !== null) return surfaceProblem;

  if (context.adapters === null) {
    return diagnostic({
      severity: 'error',
      code: 'candidate-benchmark-campaign-version-unavailable',
      subject: 'mcptoon',
      message: 'The exact harness version cannot be established for this mcptoon campaign',
      remediation:
        'Run the campaign from the normal CLI host so the reviewed compatibility row can be verified',
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
