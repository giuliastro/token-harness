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
  type ResolvedExecutable,
} from '@token-harness/core';
import {
  admitProviderPackageUpdate,
  reviewedProviderPackageMaximum,
} from '@token-harness/adapters';
import {
  RTK_RELEASE_METADATA_DESTINATION,
  rtkReleaseAssetForPlatform,
  rtkReleaseRuntimeFor,
  type NodeRtkReleaseRuntime,
  type ReleaseFetch,
  type RtkReleaseAsset,
} from '@token-harness/platform';

export interface DirectRtkReleasePlan {
  id: string;
  providerId: ProviderId;
  installed: string;
  target: string;
  targetPath: string;
  asset: RtkReleaseAsset;
  runtime: NodeRtkReleaseRuntime;
}

export interface DirectRtkReleasePlanningResult {
  plan: DirectRtkReleasePlan | null;
  /** The reviewed RTK version when it can be reported without ambiguity. */
  availableVersion: string | null;
  verdict: 'defer' | 'current' | 'upgradable' | 'unavailable' | 'unsupported';
  diagnostics: Diagnostic[];
  destinations: string[];
}

/**
 * Resolve RTK's official GitHub release on Linux/macOS, where Cargo's `rtk` registry name is a
 * different project. Native Windows keeps WinGet when it is current and falls back to the same
 * verified release artifact when WinGet lags.
 */
export async function planDirectRtkRelease(input: {
  providerId: ProviderId;
  installedVersion: string | null;
  executables: readonly ResolvedExecutable[];
  channelAvailableVersion: string | null;
  platform: PlatformFacts;
  fs: FileSystemPort;
  runner: ProcessRunner;
  releaseFetch?: ReleaseFetch;
}): Promise<DirectRtkReleasePlanningResult> {
  const empty = (
    verdict: DirectRtkReleasePlanningResult['verdict'] = 'unsupported',
    diagnostics: Diagnostic[] = [],
  ): DirectRtkReleasePlanningResult => ({
    plan: null,
    availableVersion: null,
    verdict,
    diagnostics,
    destinations: [],
  });

  if (input.providerId !== 'rtk') return empty();
  const targetText = reviewedProviderPackageMaximum(input.providerId);
  if (targetText === null) return empty();
  const windows = input.platform.os === 'windows' && !input.platform.isWsl;
  if (rtkReleaseAssetForPlatform(input.platform) === null) {
    return windows
      ? empty('defer')
      : empty('unavailable', [
          diagnostic({
            severity: 'warning',
            code: 'rtk-release-platform-unsupported',
            subject: input.providerId,
            message: `The RTK GitHub release has no managed artifact for ${input.platform.os}/${input.platform.arch}`,
            remediation: 'Update RTK manually from its official installation instructions',
          }),
        ]);
  }

  const installedText = input.installedVersion;
  if (installedText === null) return empty('unavailable');
  const installed = parseSemanticVersion(installedText);
  const target = parseSemanticVersion(targetText);
  if (installed === null || target === null) return empty('unavailable');

  if (windows) {
    const channel =
      input.channelAvailableVersion === null
        ? null
        : parseSemanticVersion(input.channelAvailableVersion);
    if (channel !== null && compareVersions(channel, target) >= 0) return empty('defer');
  }

  if (compareVersions(target, installed) <= 0) {
    return {
      ...empty('current'),
      availableVersion: targetText,
    };
  }

  const admission = admitProviderPackageUpdate(input.providerId, targetText);
  if (admission.state !== 'admitted') return empty('unavailable');

  if (input.executables.length === 0) {
    return empty('unavailable', [
      diagnostic({
        severity: 'warning',
        code: 'rtk-release-target-unresolved',
        subject: input.providerId,
        message:
          'The verified GitHub release update was not planned because no concrete RTK executable path could be resolved',
        remediation: 'Check PATH, then re-run Check for updates',
      }),
    ]);
  }

  const canonicalPath = input.fs.canonicalPath;
  if (canonicalPath === undefined) return empty('unavailable');

  const canonicalExecutables: Array<{ executable: ResolvedExecutable; path: string }> = [];
  for (const executable of input.executables) {
    if (executable.kind !== 'native') {
      return empty('unavailable', [
        diagnostic({
          severity: 'warning',
          code: 'rtk-release-target-not-native',
          subject: input.providerId,
          path: executable.path,
          message:
            'A resolved RTK path is not a native executable, so Token Harness will not replace it',
          remediation:
            'Remove the non-native RTK shim from PATH or install RTK as a native binary, then retry the update check',
        }),
      ]);
    }
    const path = await canonicalPath.call(input.fs, executable.path);
    if (path === null) {
      return empty('unavailable', [
        diagnostic({
          severity: 'warning',
          code: 'rtk-release-target-unresolved',
          subject: input.providerId,
          path: executable.path,
          message: 'A resolved RTK executable path could not be canonicalized',
          remediation: 'Check PATH and filesystem access, then retry the update check',
        }),
      ]);
    }
    canonicalExecutables.push({ executable, path });
  }

  const canonicalKey = (path: string): string => (windows ? path.toLowerCase() : path);
  const uniqueTargets = new Map<string, { executable: ResolvedExecutable; path: string }>();
  for (const candidate of canonicalExecutables) {
    if (!uniqueTargets.has(canonicalKey(candidate.path))) {
      uniqueTargets.set(canonicalKey(candidate.path), candidate);
    }
  }

  if (uniqueTargets.size !== 1) {
    const aliases = canonicalExecutables
      .map(({ executable, path }) => `${executable.path} → ${path}`)
      .join(', ');
    return empty('unavailable', [
      diagnostic({
        severity: 'warning',
        code: 'rtk-release-target-ambiguous',
        subject: input.providerId,
        message:
          `The verified GitHub release update was not planned because ${String(uniqueTargets.size)} distinct RTK binaries resolve from PATH: ${aliases}`,
        remediation:
          'Keep only the intended RTK installation on PATH, then re-run Check for updates; aliases or symlinks to the same real binary are accepted',
      }),
    ]);
  }

  const selected = uniqueTargets.values().next().value as
    | { executable: ResolvedExecutable; path: string }
    | undefined;
  if (selected === undefined) return empty('unavailable');
  const targetPath = selected.path;

  const runtime = rtkReleaseRuntimeFor(input.fs, input.runner, input.releaseFetch);
  if (runtime === null) return empty('unavailable');
  const queried = await runtime.query(targetText, input.platform);
  if (queried.status !== 'found') {
    return {
      ...empty('unavailable', [
        diagnostic({
          severity: 'warning',
          code: 'rtk-release-fallback-unavailable',
          subject: input.providerId,
          message: `RTK ${targetText} is reviewed but its official GitHub release could not be selected: ${queried.message}`,
          remediation:
            'Retry after checking GitHub connectivity and confirm that the RTK release includes an asset for this platform',
        }),
      ]),
      destinations: [RTK_RELEASE_METADATA_DESTINATION],
    };
  }

  const digest = digestText(
    `${input.providerId} github-release ${installedText} ${targetText} ${targetPath}`,
  );
  return {
    plan: {
      id: digest.slice(digest.indexOf(':') + 1, digest.indexOf(':') + 9),
      providerId: input.providerId,
      installed: installedText,
      target: targetText,
      targetPath,
      asset: queried.asset,
      runtime,
    },
    availableVersion: targetText,
    verdict: 'upgradable',
    diagnostics: [],
    destinations: [RTK_RELEASE_METADATA_DESTINATION],
  };
}
