/**
 * Platform detection — PLAN §2.1, "Windows/macOS/Linux/WSL detection".
 *
 * Pure over a {@link SystemProbe}, so every branch below is reachable from every
 * CI job rather than only from the one job running that operating system.
 *
 * RFC 0001 §Configuration and state requires that native Windows and WSL stay
 * distinct. They are distinct in two directions here, and both matter:
 *
 * - WSL is `os: 'linux'`, because its paths, permissions, and executables are
 *   Linux ones. Treating it as Windows would send the state root to
 *   `%LOCALAPPDATA%` and try to set an ACL on an ext4 directory.
 * - WSL is `isWsl: true`, because it is not interchangeable with a Linux VM
 *   either: `/mnt/c` has no POSIX mode enforcement, and Windows executables are
 *   reachable through interop.
 */

import {
  diagnostic,
  type Architecture,
  type Diagnostic,
  type OperatingSystem,
  type PlatformFacts,
} from '@token-harness/core';

import type { SystemProbe } from './probe.js';

export type PlatformDetection =
  | { readonly ok: true; readonly facts: PlatformFacts }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function operatingSystem(platform: string): OperatingSystem | null {
  switch (platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    case 'linux':
      return 'linux';
    default:
      return null;
  }
}

function architecture(arch: string): Architecture {
  switch (arch) {
    case 'x64':
    case 'arm64':
    case 'ia32':
    case 'arm':
      return arch;
    default:
      return 'unknown';
  }
}

/**
 * Windows client releases share `10.0.x`; only the build number separates 10 from
 * 11, and the registry `ProductName` famously still says "Windows 10" on many
 * Windows 11 machines. `os.version()` is preferred because libuv reads the product
 * name and corrects for that; this table is the fallback when it is unavailable.
 *
 * The fallback cannot distinguish a Server SKU from its client sibling, since they
 * share build numbers. A machine reported as "Windows 11" may be Windows Server
 * 2025. Nothing in Token Harness branches on the display name — it is a label in
 * the `doctor` header — so the imprecision is confined to that line.
 */
function windowsDisplayName(probe: SystemProbe): string {
  const product = probe.version.trim();
  if (product.toLowerCase().startsWith('windows')) return product;

  const parts = probe.release.split('.').map((value) => Number.parseInt(value, 10));
  const [major, minor, build] = [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
  if (major === 10 && minor === 0) return build >= 22000 ? 'Windows 11' : 'Windows 10';
  if (major === 6 && minor === 3) return 'Windows 8.1';
  if (major === 6 && minor === 2) return 'Windows 8';
  if (major === 6 && minor === 1) return 'Windows 7';
  return probe.release === '' ? 'Windows' : `Windows (NT ${probe.release})`;
}

/**
 * Darwin kernel major to macOS marketing major. The sequence is `+9` until Apple
 * renumbered from 15 to 26, which is exactly why this is a table and not
 * arithmetic.
 */
const DARWIN_TO_MACOS: Readonly<Record<number, string>> = {
  19: '10.15',
  20: '11',
  21: '12',
  22: '13',
  23: '14',
  24: '15',
  25: '26',
};

function macosDisplayName(probe: SystemProbe): string {
  const major = Number.parseInt(probe.release.split('.')[0] ?? '', 10);
  const marketing = Number.isNaN(major) ? undefined : DARWIN_TO_MACOS[major];
  if (marketing !== undefined) return `macOS ${marketing}`;
  return probe.release === '' ? 'macOS' : `macOS (Darwin ${probe.release})`;
}

/** `PRETTY_NAME="Ubuntu 24.04.1 LTS"` from the freedesktop `os-release` format. */
function parsePrettyName(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const match = /^PRETTY_NAME=(.*)$/.exec(line.trim());
    const raw = match?.[1];
    if (raw === undefined) continue;
    const value = raw
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')
      .trim();
    if (value !== '') return value;
  }
  return null;
}

function linuxDisplayName(probe: SystemProbe): string {
  for (const path of ['/etc/os-release', '/usr/lib/os-release']) {
    const text = probe.readTextFile(path);
    if (text === null) continue;
    const pretty = parsePrettyName(text);
    if (pretty !== null) return pretty;
  }
  return probe.release === '' ? 'Linux' : `Linux ${probe.release}`;
}

/**
 * WSL detection prefers `/proc/sys/kernel/osrelease` over the environment.
 *
 * `WSL_DISTRO_NAME` is set by the interop shell, so it is absent in a systemd
 * service, a cron job, or anything started without that shell in its ancestry —
 * all of which are still WSL. The kernel string is not optional in the same way.
 * The environment stays as a fallback for a kernel that was rebuilt without the
 * marker.
 */
function detectWsl(probe: SystemProbe): boolean {
  for (const path of ['/proc/sys/kernel/osrelease', '/proc/version']) {
    const text = probe.readTextFile(path);
    if (text === null) continue;
    if (/microsoft|wsl/i.test(text)) return true;
  }
  return (
    probe.env['WSL_DISTRO_NAME'] !== undefined ||
    probe.env['WSL_INTEROP'] !== undefined ||
    probe.env['WSLENV'] !== undefined
  );
}

export function detectPlatform(probe: SystemProbe): PlatformDetection {
  const os = operatingSystem(probe.platform);
  if (os === null) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'unsupported-operating-system',
          message: `Token Harness supports Windows, macOS, and Linux, but this process is running on ${JSON.stringify(probe.platform)}`,
          remediation: 'Run Token Harness on Windows, macOS, Linux, or WSL',
        }),
      ],
    };
  }

  const isWsl = os === 'linux' && detectWsl(probe);
  const osDisplayName =
    os === 'windows'
      ? windowsDisplayName(probe)
      : os === 'macos'
        ? macosDisplayName(probe)
        : linuxDisplayName(probe);

  return {
    ok: true,
    facts: {
      os,
      osDisplayName,
      arch: architecture(probe.arch),
      nodeVersion: probe.nodeVersion,
      isWsl,
    },
  };
}
