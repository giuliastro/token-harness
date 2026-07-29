/**
 * Process entry point.
 *
 * This file is the only place that reads `process` and `node:os`. Everything
 * below it takes injected values, which is what lets the whole CLI contract be
 * tested without touching the real machine.
 */

import { homedir, release } from 'node:os';
import process from 'node:process';

import type { Architecture, OperatingSystem, PlatformFacts } from '@token-harness/core';

import { run } from './run.js';

function operatingSystem(platform: NodeJS.Platform): OperatingSystem | null {
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
 * A provisional stand-in for the platform abstraction, which is Phase 2 (PLAN
 * §2.1). It reports only what `node:os` states plainly: it does not resolve
 * config, data, state, or cache paths, does not resolve executables, and does
 * not translate a kernel release into a marketing name. `osDisplayName` is
 * therefore "Windows 10.0.26100" rather than "Windows 11" until the real
 * detector exists.
 */
function observePlatform(): PlatformFacts {
  const os = operatingSystem(process.platform);
  const label = os === 'windows' ? 'Windows' : os === 'macos' ? 'macOS' : 'Linux';
  return {
    // An unsupported platform still produces facts; `run` turns it into the
    // unsupported-environment exit code rather than crashing here.
    os: os ?? 'linux',
    osDisplayName: `${label} ${release()}`,
    arch: architecture(process.arch),
    nodeVersion: process.versions.node,
    // Provisional: the authoritative WSL check belongs to Phase 2, which must
    // keep WSL and native Windows distinct for path and permission semantics.
    isWsl: process.platform === 'linux' && process.env['WSL_DISTRO_NAME'] !== undefined,
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  let home: string | null = null;
  try {
    home = homedir();
  } catch {
    home = null;
  }

  const exitCode = await run({
    argv,
    streams: {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
    platform: observePlatform(),
    cwd: process.cwd(),
    home,
    stateRoot: null,
    env: process.env,
    stdoutIsTty: process.stdout.isTTY === true,
  });

  process.exitCode = exitCode;
}
