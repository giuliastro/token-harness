import {
  compareVersions,
  diagnostic,
  digestText,
  parseSemanticVersion,
  type Diagnostic,
  type FileSystemPort,
  type PlatformFacts,
  type ProcessRunner,
  type ProviderId,
} from '@token-harness/core';
import {
  admitProviderPackageUpdate,
  reviewedProviderPackageMaximum,
} from '@token-harness/adapters';
import {
  RTK_RELEASE_METADATA_DESTINATION,
  rtkWindowsReleaseRuntimeFor,
  type NodeRtkWindowsReleaseRuntime,
  type RtkWindowsReleaseAsset,
} from '@token-harness/platform';

export interface DirectRtkWindowsReleasePlan {
  id: string;
  providerId: ProviderId;
  installed: string;
  target: string;
  targetPath: string;
  asset: RtkWindowsReleaseAsset;
  runtime: NodeRtkWindowsReleaseRuntime;
}

export interface DirectRtkWindowsReleasePlanningResult {
  plan: DirectRtkWindowsReleasePlan | null;
  diagnostics: Diagnostic[];
  destinations: string[];
}

/**
 * Prefer the reviewed RTK GitHub release only when native Windows' package channel cannot reach it.
 *
 * This is package replacement policy, not harness mutation policy. The target still has to pass the
 * provider-only package admission gate; nothing here authorizes a Claude/Codex/OpenCode write.
 *
 * The direct replacement is deliberately stricter than normal command discovery: exactly one
 * `rtk.exe` may resolve. `--yes` can explicitly adopt one existing binary for this transaction, but
 * it must never mean "pick the first of several PATH entries and overwrite it".
 */
export async function planDirectRtkWindowsRelease(input: {
  providerId: ProviderId;
  installedVersion: string | null;
  executablePaths: readonly string[];
  channelAvailableVersion: string | null;
  platform: PlatformFacts;
  fs: FileSystemPort;
  runner: ProcessRunner;
}): Promise<DirectRtkWindowsReleasePlanningResult> {
  const empty = (): DirectRtkWindowsReleasePlanningResult => ({
    plan: null,
    diagnostics: [],
    destinations: [],
  });
  if (input.providerId !== 'rtk') return empty();
  if (input.platform.os !== 'windows' || input.platform.isWsl) return empty();
  if (input.installedVersion === null) return empty();

  const installed = parseSemanticVersion(input.installedVersion);
  const targetText = reviewedProviderPackageMaximum(input.providerId);
  const target = targetText === null ? null : parseSemanticVersion(targetText);
  if (installed === null || target === null || targetText === null) return empty();
  if (compareVersions(target, installed) <= 0) return empty();

  const channel =
    input.channelAvailableVersion === null
      ? null
      : parseSemanticVersion(input.channelAvailableVersion);
  if (channel !== null && compareVersions(channel, target) >= 0) return empty();

  const admission = admitProviderPackageUpdate(input.providerId, targetText);
  if (admission.state !== 'admitted') return empty();

  if (input.executablePaths.length !== 1) {
    const detail =
      input.executablePaths.length === 0
        ? 'no concrete rtk.exe path could be resolved'
        : `${String(input.executablePaths.length)} different rtk.exe paths resolve: ${input.executablePaths.join(', ')}`;
    return {
      plan: null,
      destinations: [],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'rtk-release-target-ambiguous',
          subject: input.providerId,
          message: `The verified GitHub release fallback was not planned because ${detail}`,
          remediation:
            'Make exactly one intended RTK executable resolve on PATH, then re-run update; Token Harness will not choose an arbitrary binary to overwrite',
        }),
      ],
    };
  }
  const executablePath = input.executablePaths[0];
  if (executablePath === undefined) return empty();

  const runtime = rtkWindowsReleaseRuntimeFor(input.fs, input.runner);
  if (runtime === null) return empty();
  const queried = await runtime.query(targetText);
  if (queried.status !== 'found') {
    return {
      plan: null,
      destinations: [RTK_RELEASE_METADATA_DESTINATION],
      diagnostics: [
        diagnostic({
          severity: 'warning',
          code: 'rtk-release-fallback-unavailable',
          subject: input.providerId,
          message: `RTK ${targetText} is reviewed but its verified Windows GitHub release could not be selected: ${queried.message}`,
          remediation:
            'Token Harness will keep using the ordinary package channel; retry after checking GitHub connectivity or release metadata',
        }),
      ],
    };
  }

  const digest = digestText(
    `${input.providerId} github-release ${input.installedVersion} ${targetText} ${executablePath}`,
  );
  return {
    plan: {
      id: digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 9),
      providerId: input.providerId,
      installed: input.installedVersion,
      target: targetText,
      targetPath: executablePath,
      asset: queried.asset,
      runtime,
    },
    diagnostics: [],
    destinations: [RTK_RELEASE_METADATA_DESTINATION],
  };
}
