/**
 * The seam between the platform layer and the actual machine.
 *
 * Every fact the layer needs arrives through this interface, which is what makes
 * `detectPlatform` and `resolvePlatformPaths` table-driven: a Windows path
 * resolution can be asserted on Linux, and a WSL kernel can be asserted on
 * Windows. Without it, "table-driven platform tests" (PLAN §2.1 acceptance) would
 * mean three suites each of which only ever runs on one of the three CI jobs.
 */

import { homedir, release, tmpdir, version } from 'node:os';
import { readFileSync } from 'node:fs';
import process from 'node:process';

export interface SystemProbe {
  /** `process.platform`. */
  platform: string;
  /** `process.arch`. */
  arch: string;
  /** `os.release()` — the kernel version. */
  release: string;
  /** `os.version()`. On Windows this is the product name; elsewhere it is kernel build text. */
  version: string;
  /** `process.versions.node`, without a leading `v`. */
  nodeVersion: string;
  env: Readonly<Record<string, string | undefined>>;
  /** `os.homedir()`, or null when it cannot be determined. */
  homeDirectory: string | null;
  /** `os.tmpdir()`, used only to *reject* a state root that would land inside it. */
  temporaryDirectory: string | null;
  /** Reads a small text file. Returns null for any failure — absence is an answer here. */
  readTextFile(path: string): string | null;
}

function safe<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function nodeSystemProbe(): SystemProbe {
  return {
    platform: process.platform,
    arch: process.arch,
    release: safe(release) ?? '',
    version: safe(version) ?? '',
    nodeVersion: process.versions.node,
    env: process.env,
    homeDirectory: safe(homedir),
    temporaryDirectory: safe(tmpdir),
    readTextFile: (path) => safe(() => readFileSync(path, 'utf8')),
  };
}
