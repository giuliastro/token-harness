/**
 * Executable resolution — PLAN §2.1, "executable resolution, including Windows
 * shims and `PATHEXT`".
 *
 * Resolution is done here rather than delegated to `where.exe` or `command -v`,
 * for three reasons: it needs no child process, so `doctor` stays cheap and
 * testable; it can be table-driven across all three platforms from any one of
 * them; and it can *classify* what it found, which is the part that matters. A
 * path alone does not tell the runner whether the file can be started, and on
 * Windows the answer is no surprisingly often.
 *
 * ## The current directory is never searched
 *
 * `CreateProcess` and `cmd.exe` both search the working directory before `PATH`
 * on Windows. This function does not, deliberately: Token Harness runs commands
 * with the user's repository as the working directory, and a repository that can
 * place `pnpm.exe` next to its own source is a repository that can choose what
 * Token Harness executes. RFC 0004 §Repository trust makes project-local content
 * untrusted by default, and this is one of the places that has to hold.
 */

import { closeSync, constants, lstatSync, openSync, readSync, statSync, accessSync } from 'node:fs';
import { win32 } from 'node:path';

import type { ExecutableKind, PlatformFacts, ResolvedExecutable } from '@token-harness/core';

import { pathFlavor } from './paths.js';

export type EntryKind = 'file' | 'directory' | 'absent';

export interface ExecutableProbe {
  entryKind(path: string): EntryKind;
  /** POSIX `X_OK` for the current user. Not consulted on native Windows, where the extension decides. */
  isExecutable(path: string): boolean;
  /** The first bytes of a file, for shebang and binary-format classification. */
  readMagic(path: string): Uint8Array | null;
}

const MAGIC_BYTES = 64;

export function nodeExecutableProbe(): ExecutableProbe {
  return {
    entryKind(path) {
      try {
        const stat = statSync(path);
        return stat.isDirectory() ? 'directory' : 'file';
      } catch {
        /**
         * `stat` failing does not mean the entry is absent, and on Windows the difference is the
         * whole primary install channel.
         *
         * `winget.exe` under `%LOCALAPPDATA%\Microsoft\WindowsApps` is an App Execution Alias: a
         * reparse point that `CreateProcess` executes happily and that `stat` cannot open at all.
         * Measured on the machine this was written on — `statSync` raises `EACCES`, `lstatSync`
         * reports `isFile=false, isSymlink=true, size=99`.
         *
         * So the resolver rejected `winget` as absent, and every winget install and query failed
         * with `executable-not-found`. That path had never actually run: the install argv was
         * verified by reading `winget install --help`, and the *resolution* in front of it was
         * never exercised end to end until `update` asked a channel a question.
         *
         * `lstat` does not follow the link, so it answers where `stat` refuses. A dangling symlink
         * reaches here too and is reported as a file — correctly: whether it can be started is the
         * spawn's answer to give, and a resolver that pre-emptively hid it would be making the same
         * mistake in the other direction.
         */
        try {
          const link = lstatSync(path);
          return link.isDirectory() ? 'directory' : 'file';
        } catch {
          return 'absent';
        }
      }
    },
    isExecutable(path) {
      try {
        accessSync(path, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    },
    readMagic(path) {
      let fd: number | undefined;
      try {
        fd = openSync(path, 'r');
        const buffer = new Uint8Array(MAGIC_BYTES);
        const read = readSync(fd, buffer, 0, MAGIC_BYTES, 0);
        return buffer.subarray(0, read);
      } catch {
        return null;
      } finally {
        if (fd !== undefined) {
          try {
            closeSync(fd);
          } catch {
            // Closing a descriptor we already failed to use changes nothing.
          }
        }
      }
    },
  };
}

/**
 * The `PATHEXT` default, matching a stock Windows installation. Used only when the
 * variable is unset — the configured order is the order the OS would use, so it is
 * respected rather than reordered.
 */
export const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

const WINDOWS_NATIVE_EXTENSIONS = new Set(['.exe', '.com']);
const WINDOWS_BATCH_EXTENSIONS = new Set(['.cmd', '.bat']);

function pathExtensions(env: Readonly<Record<string, string | undefined>>): string[] {
  const raw = env['PATHEXT'];
  const source = raw === undefined || raw.trim() === '' ? DEFAULT_PATHEXT : raw;
  return source
    .split(';')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.startsWith('.') && value.length > 1);
}

function searchPath(
  env: Readonly<Record<string, string | undefined>>,
  facts: PlatformFacts,
): string[] {
  const nativeWindows = facts.os === 'windows' && !facts.isWsl;
  // Windows environment names are case-insensitive, and `Path` is the spelling the
  // OS itself writes.
  const raw = nativeWindows ? (env['PATH'] ?? env['Path'] ?? env['path']) : env['PATH'];
  if (raw === undefined) return [];
  return (
    raw
      .split(nativeWindows ? ';' : ':')
      // A quoted PATH entry is legal on Windows and common in hand-edited values.
      .map((entry) => entry.trim().replace(/^"(.*)"$/, '$1'))
      .filter((entry) => entry !== '')
  );
}

function classifyWindows(path: string): ExecutableKind {
  const extension = win32.extname(path).toLowerCase();
  if (WINDOWS_NATIVE_EXTENSIONS.has(extension)) return 'native';
  if (WINDOWS_BATCH_EXTENSIONS.has(extension)) return 'windows-batch-shim';
  return 'windows-unsupported-extension';
}

const BINARY_MAGICS: readonly (readonly number[])[] = [
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O 32, big endian
  [0xfe, 0xed, 0xfa, 0xcf], // Mach-O 64, big endian
  [0xce, 0xfa, 0xed, 0xfe], // Mach-O 32, little endian
  [0xcf, 0xfa, 0xed, 0xfe], // Mach-O 64, little endian
  [0xca, 0xfe, 0xba, 0xbe], // Mach-O universal
  [0x4d, 0x5a], // PE, reachable under WSL interop
];

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((value, index) => bytes[index] === value);
}

/**
 * Classifies a POSIX file that has the execute bit.
 *
 * The case worth naming is the last one: a text file marked executable with no
 * `#!` line. `execve` rejects it with `ENOEXEC`, which surfaces as an
 * uninformative spawn failure from inside whichever provider adapter tried to run
 * it. Detecting it here turns that into a diagnostic that says what is wrong.
 *
 * Classification fails open. An unrecognised binary format is reported as
 * `native` and left for the kernel to accept or reject, because guessing that a
 * working executable is broken is worse than not guessing.
 */
function classifyPosix(path: string, probe: ExecutableProbe): ExecutableKind {
  const bytes = probe.readMagic(path);
  if (bytes === null || bytes.length === 0) return 'native';
  if (startsWith(bytes, [0x23, 0x21])) return 'posix-script';
  if (BINARY_MAGICS.some((magic) => startsWith(bytes, magic))) return 'native';
  const looksLikeText =
    !bytes.includes(0x00) &&
    bytes.every(
      (byte) => byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte !== 0x7f),
    );
  return looksLikeText ? 'posix-script-without-shebang' : 'native';
}

export interface ResolveExecutableInput {
  name: string;
  facts: PlatformFacts;
  env: Readonly<Record<string, string | undefined>>;
  /** Used only when `name` already contains a separator. `PATH` search never consults it. */
  cwd: string;
  probe: ExecutableProbe;
}

/**
 * The candidate file names to try, in order.
 *
 * The ordering is the whole content of this function, and an earlier version got it
 * backwards. It tried the bare name *first*, which on Windows means an npm or pnpm
 * global `bin` entry resolves to its extensionless Unix shell script — `opencode`,
 * `pnpm`, `harnesstrim` are all installed as a triple of extensionless, `.cmd`, and
 * `.ps1` — and Windows cannot launch the extensionless one at all. Every package
 * manager and every npm-installed provider was therefore reported as
 * `windows-unsupported-extension` on a real machine, which is exactly what
 * `PATHEXT` handling exists to prevent.
 *
 * Windows itself appends `PATHEXT` when the name has no extension and does not
 * execute an extensionless file, so `PATHEXT` candidates come first. The bare name
 * comes last rather than not at all: reporting "found, but this platform cannot
 * start it" is more use than reporting nothing, and `isStartableExecutable` is what
 * callers gate on.
 */
function candidatesFor(name: string, nativeWindows: boolean, extensions: string[]): string[] {
  if (!nativeWindows) return [name];
  const lower = name.toLowerCase();
  if (extensions.some((extension) => lower.endsWith(extension))) return [name];
  return [...extensions.map((extension) => `${name}${extension}`), name];
}

/**
 * Names that must mean the Windows utility, resolved from `%SystemRoot%\System32`
 * rather than by searching `PATH`.
 *
 * Two reasons, and the first is not hypothetical. Git for Windows puts
 * `usr/bin` on `PATH` on a large share of Windows development machines, and its
 * coreutils `whoami` does not understand `/user /fo csv` — it exits 1 with "extra
 * operand". The RFC 0004 §State directory permissions check then cannot obtain the
 * current user's SID, reports `state-directory-unverifiable`, and Token Harness
 * refuses to run at all. It fails safe, and it fails for everyone.
 *
 * The second reason is that letting `PATH` choose `icacls` lets `PATH` choose what
 * the permission check reads. RFC 0004 §Repository trust treats project-local
 * content as untrusted, and Token Harness runs with the user's repository as its
 * working directory; the check that enforces the state invariant must not be
 * selectable by an entry in front of `System32`.
 *
 * The list is exactly the utilities Token Harness invokes, so adding one is a
 * deliberate act. It is not "prefer System32 for everything": `System32` also holds
 * `curl`, `tar`, `find`, and `bash`, and shadowing a user's own would be its own
 * defect.
 */
export const WINDOWS_SYSTEM_UTILITIES: readonly string[] = ['icacls', 'whoami', 'taskkill'];

function systemUtilityPath(
  name: string,
  env: Readonly<Record<string, string | undefined>>,
  probe: ExecutableProbe,
): string | null {
  const stem = win32.basename(name, win32.extname(name)).toLowerCase();
  if (!WINDOWS_SYSTEM_UTILITIES.includes(stem)) return null;
  const systemRoot = env['SystemRoot'] ?? env['windir'];
  if (systemRoot === undefined || systemRoot.trim() === '') return null;
  const candidate = win32.join(systemRoot, 'System32', `${stem}.exe`);
  return probe.entryKind(candidate) === 'file' ? candidate : null;
}

export function resolveExecutables(input: ResolveExecutableInput): ResolvedExecutable[] {
  const { name, facts, env, probe } = input;
  if (name.trim() === '') return [];

  const nativeWindows = facts.os === 'windows' && !facts.isWsl;
  const flavor = pathFlavor(facts);
  const extensions = nativeWindows ? pathExtensions(env) : [];
  const names = candidatesFor(name, nativeWindows, extensions);
  const hasSeparator = name.includes('/') || (nativeWindows && name.includes('\\'));

  if (nativeWindows && !hasSeparator) {
    const system = systemUtilityPath(name, env, probe);
    if (system !== null) return [{ requested: name, path: system, kind: 'native' }];
  }

  const directories = hasSeparator ? [null] : searchPath(env, facts);
  const found: ResolvedExecutable[] = [];
  const seen = new Set<string>();

  for (const directory of directories) {
    for (const candidateName of names) {
      const candidate =
        directory === null
          ? flavor.resolve(input.cwd, candidateName)
          : flavor.join(directory, candidateName);
      if (probe.entryKind(candidate) !== 'file') continue;
      if (!nativeWindows && !probe.isExecutable(candidate)) continue;

      const key = nativeWindows ? candidate.toLowerCase() : candidate;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push({
        requested: name,
        path: candidate,
        kind: nativeWindows ? classifyWindows(candidate) : classifyPosix(candidate, probe),
      });
    }
  }
  return found;
}

export function resolveExecutable(input: ResolveExecutableInput): ResolvedExecutable | null {
  return resolveExecutables(input)[0] ?? null;
}

/**
 * A resolver bound to one environment, which is the shape
 * {@link import('../process/node-runner.js').NodeProcessRunner} takes so that
 * `PATH` handling stays a single implementation rather than one per caller.
 */
export function createExecutableResolver(
  context: Omit<ResolveExecutableInput, 'name'>,
): (name: string) => ResolvedExecutable | null {
  return (name) => resolveExecutable({ ...context, name });
}

/** Same environment binding as createExecutableResolver, but preserves every PATH match in order. */
export function createExecutableEnumerator(
  context: Omit<ResolveExecutableInput, 'name'>,
): (name: string) => ResolvedExecutable[] {
  return (name) => resolveExecutables({ ...context, name });
}
