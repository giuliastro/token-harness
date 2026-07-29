/**
 * Path resolution — RFC 0001 §Configuration and state, PLAN §2.1.
 *
 * ## What the RFC fixes, and what it does not
 *
 * RFC 0001 specifies the *state* root on each platform and nothing else:
 *
 * | Platform | State root |
 * | --- | --- |
 * | Windows | `%LOCALAPPDATA%\TokenHarness` |
 * | macOS | `~/Library/Application Support/TokenHarness` |
 * | Linux | `${XDG_STATE_HOME:-~/.local/state}/token-harness` |
 *
 * PLAN §2.1 also requires home, config, data, and cache resolution, which no RFC
 * defines. Those four follow each platform's own convention below, and the gap is
 * reported in the PR rather than presented as if the RFC had answered it.
 *
 * The casing difference — `TokenHarness` on Windows and macOS, `token-harness` on
 * Linux — is the RFC's and is preserved exactly. It is not an inconsistency: each
 * matches the convention of the directory it sits in.
 *
 * ## Failure is not a fallback
 *
 * RFC 0004 §State directory permissions: "If `%LOCALAPPDATA%` cannot be resolved
 * ... Token Harness fails with the unsupported-environment code from RFC 0006
 * rather than continuing into a location whose protection it has not verified."
 *
 * So there is deliberately no derivation of `%USERPROFILE%\AppData\Local` when
 * `%LOCALAPPDATA%` is missing, and no temporary directory anywhere in the chain.
 * A machine that cannot say where its per-user application data lives is a machine
 * Token Harness declines to guess about.
 */

import { posix, win32 } from 'node:path';

import {
  diagnostic,
  type Diagnostic,
  type PlatformFacts,
  type PlatformPaths,
} from '@token-harness/core';

/** The directory name on Windows and macOS, per RFC 0001. */
const DIRECTORY_NAME_TITLE = 'TokenHarness';
/** The directory name on Linux, per RFC 0001. */
const DIRECTORY_NAME_SLUG = 'token-harness';

export type PathFlavor = typeof win32 | typeof posix;

/**
 * Which path grammar applies.
 *
 * WSL is Linux here. Its filesystem is Linux, its separator is `/`, and its
 * `$HOME` is an ext4 path — the only Windows thing about it is that `/mnt/c`
 * exists, and nothing Token Harness resolves goes there.
 */
export function pathFlavor(facts: PlatformFacts): PathFlavor {
  return facts.os === 'windows' && !facts.isWsl ? win32 : posix;
}

/**
 * Normalizes a path without erasing platform semantics (PLAN §2.1).
 *
 * It collapses `.`, `..`, and repeated separators, and drops a trailing
 * separator. It does *not* change the separator character, lowercase anything,
 * expand a symlink, or strip a UNC or extended-length prefix — each of those
 * would make two paths that behave differently look the same, which is the
 * failure this function exists to avoid rather than to cause.
 */
export function normalizePath(value: string, facts: PlatformFacts): string {
  const flavor = pathFlavor(facts);
  const normalized = flavor.normalize(value);
  if (normalized.length <= 1) return normalized;
  const withoutTrailing = normalized.replace(/[\\/]+$/, '');
  // A root (`C:\`, `/`) keeps its separator; stripping it would change meaning.
  return withoutTrailing === '' || /^[A-Za-z]:$/.test(withoutTrailing)
    ? normalized
    : withoutTrailing;
}

/**
 * Path comparison. Case-insensitive only on native Windows, where the filesystem
 * is; case-sensitive everywhere else, including WSL, where two paths differing in
 * case are two different files.
 */
export function pathsEqual(a: string, b: string, facts: PlatformFacts): boolean {
  const left = normalizePath(a, facts);
  const right = normalizePath(b, facts);
  return facts.os === 'windows' && !facts.isWsl
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

/**
 * Whether `candidate` is the directory `parent` or lives beneath it.
 *
 * Computed with `relative`, not with a string prefix test: `/tmpfoo` starts with
 * `/tmp` and is not inside it, and that difference is the whole point of the
 * world-writable check below.
 */
export function isInsideDirectory(
  candidate: string,
  parent: string,
  facts: PlatformFacts,
): boolean {
  const flavor = pathFlavor(facts);
  const insensitive = facts.os === 'windows' && !facts.isWsl;
  const from = insensitive ? parent.toLowerCase() : parent;
  const to = insensitive ? candidate.toLowerCase() : candidate;
  const relative = flavor.relative(flavor.resolve(from), flavor.resolve(to));
  if (relative === '') return true;
  return !relative.startsWith('..') && !flavor.isAbsolute(relative);
}

export interface PathResolutionInput {
  facts: PlatformFacts;
  env: Readonly<Record<string, string | undefined>>;
  /** `os.homedir()`, or null when it could not be determined. */
  home: string | null;
  /** `os.tmpdir()`. Used only to reject a state root that would land inside it. */
  temporaryDirectory: string | null;
}

export type PathResolution =
  | { readonly ok: true; readonly paths: PlatformPaths }
  | { readonly ok: false; readonly diagnostics: readonly Diagnostic[] };

function unresolvable(message: string, remediation: string): PathResolution {
  return {
    ok: false,
    diagnostics: [
      diagnostic({
        severity: 'error',
        code: 'state-path-unresolvable',
        message,
        remediation,
      }),
    ],
  };
}

/**
 * An environment variable is only usable when it holds an absolute path.
 *
 * The XDG base-directory specification says a relative value "must be ignored";
 * the same rule is applied to the Windows variables, because a relative
 * `%LOCALAPPDATA%` would resolve against whatever the working directory happens
 * to be — which for a CLI is the user's repository.
 */
function absoluteEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  flavor: PathFlavor,
): string | null {
  const value = env[name];
  if (value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === '' || !flavor.isAbsolute(trimmed)) return null;
  return trimmed;
}

export function resolvePlatformPaths(input: PathResolutionInput): PathResolution {
  const { facts, env } = input;
  const flavor = pathFlavor(facts);
  const nativeWindows = facts.os === 'windows' && !facts.isWsl;

  const home =
    (input.home !== null && flavor.isAbsolute(input.home) ? input.home : null) ??
    absoluteEnv(env, nativeWindows ? 'USERPROFILE' : 'HOME', flavor);

  if (home === null) {
    return unresolvable(
      'The home directory could not be resolved',
      nativeWindows ? 'Set %USERPROFILE% to an absolute path' : 'Set $HOME to an absolute path',
    );
  }

  let paths: PlatformPaths;

  if (nativeWindows) {
    const localAppData = absoluteEnv(env, 'LOCALAPPDATA', flavor);
    if (localAppData === null) {
      return unresolvable(
        '%LOCALAPPDATA% is not set to an absolute path, so the Token Harness state directory cannot be located',
        'Set %LOCALAPPDATA% to your per-user application data directory, normally C:\\Users\\<you>\\AppData\\Local',
      );
    }
    const stateRoot = flavor.join(localAppData, DIRECTORY_NAME_TITLE);
    // Roaming AppData is not required. When it is absent, configuration joins the
    // local root rather than failing the whole resolution: RFC 0004 makes the
    // *state* root the hard requirement, and a machine with no %APPDATA% can still
    // be managed safely.
    const roaming = absoluteEnv(env, 'APPDATA', flavor);
    paths = {
      home,
      config: roaming === null ? stateRoot : flavor.join(roaming, DIRECTORY_NAME_TITLE),
      data: stateRoot,
      state: stateRoot,
      cache: flavor.join(stateRoot, 'Cache'),
    };
  } else if (facts.os === 'macos') {
    const appSupport = flavor.join(home, 'Library', 'Application Support', DIRECTORY_NAME_TITLE);
    paths = {
      home,
      // On macOS the convention is that everything a program owns lives in
      // Application Support, so config, data, and state are one directory. RFC
      // 0001 already places the state root there.
      config: appSupport,
      data: appSupport,
      state: appSupport,
      cache: flavor.join(home, 'Library', 'Caches', DIRECTORY_NAME_TITLE),
    };
  } else {
    const xdg = (name: string, ...fallback: string[]): string =>
      absoluteEnv(env, name, flavor) ?? flavor.join(home, ...fallback);
    paths = {
      home,
      config: flavor.join(xdg('XDG_CONFIG_HOME', '.config'), DIRECTORY_NAME_SLUG),
      data: flavor.join(xdg('XDG_DATA_HOME', '.local', 'share'), DIRECTORY_NAME_SLUG),
      state: flavor.join(xdg('XDG_STATE_HOME', '.local', 'state'), DIRECTORY_NAME_SLUG),
      cache: flavor.join(xdg('XDG_CACHE_HOME', '.cache'), DIRECTORY_NAME_SLUG),
    };
  }

  const normalized: PlatformPaths = {
    home: normalizePath(paths.home, facts),
    config: normalizePath(paths.config, facts),
    data: normalizePath(paths.data, facts),
    state: normalizePath(paths.state, facts),
    cache: normalizePath(paths.cache, facts),
  };

  // RFC 0004 §State directory permissions: "on both, assert the state root is
  // never placed in a world-writable location such as the system temporary
  // directory." Asserted here rather than only in a test, because an environment
  // that redirects XDG_STATE_HOME or LOCALAPPDATA into /tmp is a real environment
  // and the test would never see it.
  if (
    input.temporaryDirectory !== null &&
    isInsideDirectory(normalized.state, input.temporaryDirectory, facts)
  ) {
    return {
      ok: false,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'state-path-world-writable',
          message: `The resolved state directory is inside the system temporary directory (${input.temporaryDirectory}), which other users can write to`,
          path: normalized.state,
          remediation: nativeWindows
            ? 'Set %LOCALAPPDATA% to your per-user application data directory'
            : 'Unset $XDG_STATE_HOME, or set it to a directory under your home directory',
        }),
      ],
    };
  }

  return { ok: true, paths: normalized };
}
