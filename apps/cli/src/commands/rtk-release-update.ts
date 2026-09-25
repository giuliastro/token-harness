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
        message: 'The verified GitHub release update was not planned because no concrete RTK executable path could be resolved',
        remediation:
          'Make the intended RTK executable available on PATH, then re-run Check for updates',
      }),
    ]);
  }

  // PATH order already decides which RTK the process runner and provider detector execute.
  // A second, shadowed RTK later on PATH does not make the active executable ambiguous: updating
  // the first resolved path and verifying that same path is safer and more useful than refusing
  // every real machine that happens to retain an older Cargo or ~/.local/bin copy.
  const executable = input.executables[0];
  const shadowedDiagnostics =
    input.executables.length > 1
      ? [
          diagnostic({
            severity: 'info',
            code: 'rtk-release-shadowed-executables',
            subject: input.providerId,
            path: executable?.path ?? null,
            message: `RTK update will target the active PATH executable ${executable?.path ?? 'unknown'}; ${String(input.executables.length - 1)} shadowed RTK executable${input.executables.length === 2 ? '' : 's'} will be left unchanged: ${input.executables
              .slice(1)
              .map((entry) => entry.path)
              .join(', ')}`,
            remediation: null,
          }),
        ]
      : [];
  if (executable === undefined || executable.kind !== 'native') {
    return empty('unavailable', [
      ...shadowedDiagnostics,
      diagnostic({
        severity: 'warning',
        code: 'rtk-release-target-not-native',
        subject: input.providerId,
        message:
          'The resolved RTK path is not a native executable, so its file will not be replaced',
        remediation: 'Install RTK as a native binary, then retry the update check',
      }),
    ]);
  }

  const canonicalPath = input.fs.canonicalPath;
  if (canonicalPath === undefined) return empty('unavailable');
  const targetPath = await canonicalPath.call(input.fs, executable.path);
  if (targetPath === null) {
    return empty('unavailable', [
      ...shadowedDiagnostics,
      diagnostic({
        severity: 'warning',
        code: 'rtk-release-target-unresolved',
        subject: input.providerId,
        path: executable.path,
        message: 'The resolved RTK executable path could not be canonicalized',
        remediation: 'Check PATH and filesystem access, then retry the update check',
      }),
    ]);
  }

  const runtime = rtkReleaseRuntimeFor(input.fs, input.runner, input.releaseFetch);
  if (runtime === null) return empty('unavailable');
  const queried = await runtime.query(targetText, input.platform);
  if (queried.status !== 'found') {
    return {
      ...empty('unavailable', [
        ...shadowedDiagnostics,
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
    diagnostics: shadowedDiagnostics,
    destinations: [RTK_RELEASE_METADATA_DESTINATION],
  };
}
