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
