/**
 * Platform facts.
 *
 * These are *facts*, not a platform abstraction: the domain layer describes what
 * was observed and never observes it itself. Detection lands in Phase 2 (PLAN
 * §2.1); the shape is fixed now because the doctor report renders it.
 *
 * RFC 0001 §Configuration and state and PLAN §2.1 both require that native
 * Windows and WSL stay distinct, so `os` and `isWsl` are separate fields rather
 * than a single fused enum.
 */

export type OperatingSystem = 'windows' | 'macos' | 'linux';

export type Architecture = 'x64' | 'arm64' | 'ia32' | 'arm' | 'unknown';

export interface PlatformFacts {
  os: OperatingSystem;
  /** Human-readable OS release, e.g. "Windows 11", "macOS 15.2", "Ubuntu 24.04". */
  osDisplayName: string;
  arch: Architecture;
  /** The Node.js runtime version, without a leading "v". */
  nodeVersion: string;
  /** True only when running inside the Windows Subsystem for Linux. */
  isWsl: boolean;
}

/** RFC 0001 §Decisions: the runtime floor is 22.13.0, not 22.0.0. */
export const MINIMUM_NODE_VERSION = '22.13.0';

export function renderPlatformSummary(facts: PlatformFacts): string {
  const base = `${facts.osDisplayName} (${facts.arch})`;
  return facts.isWsl ? `${base} on WSL` : base;
}

/**
 * Resolved machine-local directories.
 *
 * RFC 0001 §Configuration and state fixes the *state* root per platform and says
 * nothing about the other four, so their derivation is documented in
 * `@token-harness/platform`. The casing difference between platforms —
 * `TokenHarness` on Windows and macOS, `token-harness` on Linux — is the RFC's,
 * and it is deliberate: each follows its platform's convention.
 */
export interface PlatformPaths {
  home: string;
  config: string;
  data: string;
  /** The RFC 0001 state root. The only one whose location is normative. */
  state: string;
  cache: string;
}

/**
 * What kind of thing an executable name resolved to.
 *
 * The two `-not-startable` members are not defensive padding: each is a real
 * failure this layer exists to name rather than to let surface as a confused
 * `EINVAL` or `ENOEXEC` from deep inside a provider adapter.
 */
export type ExecutableKind =
  /** A PE image, ELF binary, or Mach-O binary. Started directly. */
  | 'native'
  /** A POSIX file beginning with `#!`. Started directly; the kernel resolves the interpreter. */
  | 'posix-script'
  /** A `.cmd` or `.bat` shim, which is how npm and pnpm install `bin` entries on Windows. */
  | 'windows-batch-shim'
  /** On `PATHEXT` but not something Token Harness will launch: `.ps1`, `.vbs`, `.js`, `.wsf`. */
  | 'windows-unsupported-extension'
  /** A POSIX text file with the execute bit and no shebang, which `execve` rejects. */
  | 'posix-script-without-shebang';

export interface ResolvedExecutable {
  /** The name as asked for, before `PATH` and `PATHEXT` expansion. */
  requested: string;
  /** Absolute path to the file that would be started. */
  path: string;
  kind: ExecutableKind;
}

export function isStartableExecutable(resolved: ResolvedExecutable): boolean {
  return (
    resolved.kind === 'native' ||
    resolved.kind === 'posix-script' ||
    resolved.kind === 'windows-batch-shim'
  );
}

/**
 * Package managers Token Harness can be asked to install a provider through.
 *
 * The list is the union of the channels RFC 0002 §Installation channels names,
 * plus the two Windows-native managers, because "installation channel selection
 * per OS" (PLAN §10) cannot pick a channel it cannot see.
 */
export type PackageManagerId =
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'bun'
  | 'cargo'
  | 'homebrew'
  | 'uv'
  | 'pipx'
  | 'scoop'
  | 'winget';

export interface DiscoveredPackageManager {
  id: PackageManagerId;
  executable: ResolvedExecutable;
}

/**
 * The result of asserting the RFC 0004 §State directory permissions invariant.
 *
 * The invariant is "no principal other than the owning user, the local system,
 * and local administrators can read the state directory" — not owner-only, which
 * would be false on both platforms.
 */
export type StateRootVerdict =
  /** The property holds. */
  | 'ok'
  /** The directory does not exist, and creation was not requested. Nothing to protect yet. */
  | 'absent'
  /** A principal outside the permitted set holds read access. */
  | 'permissions-unexpected'
  /** The mode or ACL could not be read, so the property is unproven. */
  | 'unverifiable';

export interface StateRootStatus {
  path: string;
  verdict: StateRootVerdict;
  /**
   * POSIX permission bits as a four-digit octal string, e.g. `"0700"`. Null on
   * native Windows, where the mode carries no access information at all.
   */
  posixMode: string | null;
  /**
   * Windows: SIDs, or SDDL aliases when the descriptor used one, that hold read
   * access outside the permitted set. Empty on POSIX and when the property holds.
   */
  unexpectedPrincipals: readonly string[];
  /**
   * Windows: whether the DACL blocks inheritance. A protected DACL is what keeps
   * a later widening of the parent from propagating in.
   */
  inheritanceBlocked: boolean | null;
}
