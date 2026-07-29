/**
 * Child-process environment policy — RFC 0004 §Credentials.
 *
 * "Inherits only the minimum environment needed by a child process." The default
 * is therefore an allowlist, not the ambient environment with secrets removed: a
 * denylist has to be right about every variable that will ever exist, and an
 * allowlist only has to be right about the ones a child needs.
 *
 * Pure: it takes an environment record and returns one.
 */

import type { PlatformFacts } from '@token-harness/core';

/**
 * Variables a Windows child needs to function.
 *
 * `SystemRoot` and `windir` are not optional — a surprising number of Windows
 * executables fail to initialise without them. The `Program*` and profile
 * variables are what package managers use to find their own installation roots.
 */
const WINDOWS_ALLOWLIST: readonly string[] = [
  'ALLUSERSPROFILE',
  'APPDATA',
  'COMPUTERNAME',
  'COMSPEC',
  'HOMEDRIVE',
  'HOMEPATH',
  'LOCALAPPDATA',
  'NUMBER_OF_PROCESSORS',
  'PATH',
  'PATHEXT',
  'PROCESSOR_ARCHITECTURE',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'PUBLIC',
  'SystemDrive',
  'SystemRoot',
  'TEMP',
  'TMP',
  'USERDOMAIN',
  'USERNAME',
  'USERPROFILE',
  'windir',
];

/**
 * Variables a POSIX child needs.
 *
 * `TERM` is deliberately absent: a child that cannot see a terminal name is a
 * child that does not try to draw one, and captured output stays parseable.
 */
const POSIX_ALLOWLIST: readonly string[] = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
];

/**
 * Added to every child environment.
 *
 * This is an addition rather than an inheritance, and it needs a reason. RFC 0004
 * requires stdout and stderr to be preserved separately, and RFC 0002 has
 * importers read machine-readable provider output; a provider that decides to
 * emit ANSI colour because it cannot tell what it is attached to breaks both.
 * `NO_COLOR` is the conventional way to say so.
 */
const FORCED: Readonly<Record<string, string>> = { NO_COLOR: '1' };

export interface ChildEnvironmentInput {
  facts: PlatformFacts;
  /** The ambient environment, usually `process.env`. */
  ambient: Readonly<Record<string, string | undefined>>;
  /** Variables the caller needs the child to see, on top of the allowlist. */
  additions?: Readonly<Record<string, string>>;
}

/**
 * Environment variable names are case-insensitive on Windows, so the allowlist is
 * matched case-insensitively there and exactly everywhere else. Getting this
 * backwards produces a child with no `Path` on a machine where the variable
 * happens to be spelled that way, which is most of them.
 */
export function minimalChildEnvironment(input: ChildEnvironmentInput): Record<string, string> {
  const caseInsensitive = input.facts.os === 'windows' && !input.facts.isWsl;
  const allowlist = caseInsensitive ? WINDOWS_ALLOWLIST : POSIX_ALLOWLIST;
  const allowed = new Set(allowlist.map((name) => (caseInsensitive ? name.toLowerCase() : name)));

  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.ambient)) {
    if (value === undefined) continue;
    if (!allowed.has(caseInsensitive ? name.toLowerCase() : name)) continue;
    out[name] = value;
  }
  for (const [name, value] of Object.entries(FORCED)) out[name] = value;
  for (const [name, value] of Object.entries(input.additions ?? {})) out[name] = value;
  return out;
}
