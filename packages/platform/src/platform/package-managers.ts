/**
 * Package-manager discovery — PLAN §2.1.
 *
 * Discovery is resolution only: it reports which managers exist on `PATH` and
 * where, and never runs them. PLAN §2.2 acceptance requires that "provider unit
 * tests require no installed upstream executable", and asking every manager for
 * its version would break that on the very first call — as well as costing eight
 * process spawns on a command that RFC 0004 classifies as read-only.
 *
 * Versions are a provider adapter's business, at the point where one is actually
 * about to be used.
 */

import type {
  DiscoveredPackageManager,
  PackageManagerId,
  PlatformFacts,
  ResolvedExecutable,
} from '@token-harness/core';

interface Candidate {
  id: PackageManagerId;
  /** The executable name to resolve, without a Windows extension. */
  command: string;
  /** Platforms where looking is worthwhile. */
  platforms: readonly PlatformFacts['os'][];
  /** True when the manager exists only on native Windows, not under WSL. */
  nativeWindowsOnly?: boolean;
}

/**
 * The channels RFC 0002 §Installation channels names, plus `scoop` and `winget`.
 *
 * The two Windows managers are here because "official installation channel
 * selection per OS" (PLAN §10) cannot select a channel it cannot see, and on
 * Windows those two are frequently the only ones a user has that are not npm.
 */
const CANDIDATES: readonly Candidate[] = [
  { id: 'npm', command: 'npm', platforms: ['windows', 'macos', 'linux'] },
  { id: 'pnpm', command: 'pnpm', platforms: ['windows', 'macos', 'linux'] },
  { id: 'yarn', command: 'yarn', platforms: ['windows', 'macos', 'linux'] },
  { id: 'bun', command: 'bun', platforms: ['windows', 'macos', 'linux'] },
  { id: 'cargo', command: 'cargo', platforms: ['windows', 'macos', 'linux'] },
  { id: 'homebrew', command: 'brew', platforms: ['macos', 'linux'] },
  { id: 'uv', command: 'uv', platforms: ['windows', 'macos', 'linux'] },
  { id: 'pipx', command: 'pipx', platforms: ['windows', 'macos', 'linux'] },
  { id: 'scoop', command: 'scoop', platforms: ['windows'], nativeWindowsOnly: true },
  { id: 'winget', command: 'winget', platforms: ['windows'], nativeWindowsOnly: true },
];

export interface DiscoverPackageManagersInput {
  facts: PlatformFacts;
  resolve: (name: string) => ResolvedExecutable | null;
}

export function discoverPackageManagers(
  input: DiscoverPackageManagersInput,
): DiscoveredPackageManager[] {
  const { facts } = input;
  const nativeWindows = facts.os === 'windows' && !facts.isWsl;
  const found: DiscoveredPackageManager[] = [];
  for (const candidate of CANDIDATES) {
    if (!candidate.platforms.includes(facts.os)) continue;
    if (candidate.nativeWindowsOnly === true && !nativeWindows) continue;
    const executable = input.resolve(candidate.command);
    if (executable === null) continue;
    found.push({ id: candidate.id, executable });
  }
  return found;
}
