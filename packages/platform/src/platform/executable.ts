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

import { closeSync, constants, openSync, readSync, statSync, accessSync } from 'node:fs';
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
        return 'absent';
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

function candidatesFor(name: string, nativeWindows: boolean, extensions: string[]): string[] {
  if (!nativeWindows) return [name];
  const lower = name.toLowerCase();
  if (extensions.some((extension) => lower.endsWith(extension))) return [name];
  // A name with some other extension is still tried verbatim first — `python3.11`
  // is a name, not an extension — and then with each PATHEXT suffix.
  return [name, ...extensions.map((extension) => `${name}${extension}`)];
}

export function resolveExecutable(input: ResolveExecutableInput): ResolvedExecutable | null {
  const { name, facts, env, probe } = input;
  if (name.trim() === '') return null;

  const nativeWindows = facts.os === 'windows' && !facts.isWsl;
  const flavor = pathFlavor(facts);
  const extensions = nativeWindows ? pathExtensions(env) : [];
  const names = candidatesFor(name, nativeWindows, extensions);

  const hasSeparator = name.includes('/') || (nativeWindows && name.includes('\\'));
  const directories = hasSeparator ? [null] : searchPath(env, facts);

  for (const directory of directories) {
    for (const candidateName of names) {
      const candidate =
        directory === null
          ? flavor.resolve(input.cwd, candidateName)
          : flavor.join(directory, candidateName);
      if (probe.entryKind(candidate) !== 'file') continue;
      if (!nativeWindows && !probe.isExecutable(candidate)) continue;
      return {
        requested: name,
        path: candidate,
        kind: nativeWindows ? classifyWindows(candidate) : classifyPosix(candidate, probe),
      };
    }
  }
  return null;
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
