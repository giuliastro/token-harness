/**
 * The state root and its permission invariant — RFC 0004 §State directory
 * permissions.
 *
 * The invariant: "no principal other than the owning user, the local system, and
 * local administrators can read the state directory". Not owner-only, which the
 * RFC explains would be false on both platforms — POSIX `0700` does not stop
 * `root`, and the default Windows profile ACL grants `Administrators`.
 *
 * | Platform | Mechanism |
 * | --- | --- |
 * | POSIX | Create with mode `0700`; stat and assert the mode after creation |
 * | Windows | Create with an explicit DACL; read the effective ACL back and assert its ACEs |
 *
 * `fs.chmod` is never called on native Windows. It affects only the read-only
 * attribute there and restricts nobody, so calling it would produce a passing test
 * and no protection — which is exactly the failure mode the RFC calls out.
 *
 * ## Why this module takes a runner
 *
 * Node has no ACL API, so the Windows path shells out to `icacls` — and RFC 0004
 * requires that it do so "through the process runner". PLAN §15 lists the platform
 * facts (issue 4) before the process runner (issue 5), which cannot be built in
 * that order: the runner is a dependency of the permission check, not the other way
 * round. The runner is therefore injected, and the Windows logic is testable on
 * every platform through `FakeProcessRunner`.
 */

import { chmod, mkdir, readFile, stat, unlink } from 'node:fs/promises';
import process from 'node:process';

import {
  diagnostic,
  type Diagnostic,
  type PlatformFacts,
  type ProcessRunner,
  type StateRootStatus,
} from '@token-harness/core';

import { evaluateStateRootAcl, stateRootGrantArguments } from './sddl.js';

/** Long enough for a loaded machine, short enough that a hung `icacls` is not a hang. */
const ACL_TIMEOUT_MS = 15_000;

export interface StateRootRequest {
  /** The resolved state root. Must come from `resolvePlatformPaths`, which rejects world-writable locations. */
  path: string;
  facts: PlatformFacts;
  /** RFC 0004: `icacls` runs through this. Unused on POSIX. */
  runner: ProcessRunner;
  /**
   * Whether an absent directory may be created.
   *
   * False for read-only commands: RFC 0004 classifies `doctor`, `status`, `plan`,
   * `verify`, and `metrics` as read-only, and creating a directory is a mutation.
   * An absent state root is reported as `absent`, which is not a problem — there is
   * nothing there yet to protect.
   */
  create: boolean;
}

export interface StateRootResult {
  status: StateRootStatus;
  diagnostics: readonly Diagnostic[];
}

function octal(mode: number): string {
  return (mode & 0o7777).toString(8).padStart(4, '0');
}

function unverifiable(path: string, message: string, remediation: string): StateRootResult {
  return {
    status: {
      path,
      verdict: 'unverifiable',
      posixMode: null,
      unexpectedPrincipals: [],
      inheritanceBlocked: null,
    },
    diagnostics: [
      diagnostic({
        severity: 'error',
        code: 'state-directory-unverifiable',
        message,
        path,
        remediation,
      }),
    ],
  };
}

async function directoryExists(path: string): Promise<boolean | null> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    return null;
  }
}

/**
 * POSIX.
 *
 * The asserted property is `(mode & 0o077) === 0` — no group or other bits — rather
 * than `mode === 0o700`. That is the invariant as stated: a directory at `0700`,
 * `0500`, or `0000` all deny every additional principal, and only the group/other
 * bits can violate it. Asserting the exact mode would reject two states that
 * satisfy the property and would say nothing extra about the one that does not.
 */
async function ensurePosix(request: StateRootRequest): Promise<StateRootResult> {
  const { path } = request;
  const exists = await directoryExists(path);
  if (exists === null) {
    return unverifiable(
      path,
      'The state directory could not be inspected',
      'Check that the path exists and is readable, then run the command again',
    );
  }

  if (!exists) {
    if (!request.create) {
      return {
        status: {
          path,
          verdict: 'absent',
          posixMode: null,
          unexpectedPrincipals: [],
          inheritanceBlocked: null,
        },
        diagnostics: [],
      };
    }
    try {
      // The mode passed to `mkdir` is masked by the umask, so it is not sufficient
      // on its own: a umask of 0077 would still produce 0700, but a umask of 0777
      // would produce 0000 and one of 0000 would produce 0700 only by luck. The
      // explicit `chmod` is what makes the result independent of the umask.
      await mkdir(path, { recursive: true, mode: 0o700 });
      await chmod(path, 0o700);
    } catch (error) {
      return unverifiable(
        path,
        `The state directory could not be created: ${(error as Error).message}`,
        'Check the permissions of the parent directory',
      );
    }
  }

  let mode: number;
  try {
    mode = (await stat(path)).mode;
  } catch {
    return unverifiable(
      path,
      'The state directory permissions could not be read',
      'Check that the path is readable, then run the command again',
    );
  }

  if ((mode & 0o077) !== 0) {
    return {
      status: {
        path,
        verdict: 'permissions-unexpected',
        posixMode: octal(mode),
        unexpectedPrincipals: [],
        inheritanceBlocked: null,
      },
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'state-directory-permissions-unexpected',
          message: `The state directory is mode ${octal(mode)}, which grants access to the group or to other users`,
          path,
          // Reported, not repaired: RFC 0004 §Post-apply drift makes repair a plan,
          // and silently widening or narrowing permissions on a directory holding
          // configuration backups is not something to do without being asked.
          remediation: `Run \`chmod 700 ${path}\` after checking why the mode changed`,
        }),
      ],
    };
  }

  return {
    status: {
      path,
      verdict: 'ok',
      posixMode: octal(mode),
      unexpectedPrincipals: [],
      inheritanceBlocked: null,
    },
    diagnostics: [],
  };
}

/**
 * The current user's SID.
 *
 * Needed because an SDDL descriptor gives no indication of which of its SIDs is
 * "us", and because granting by SID avoids composing `%USERDOMAIN%\%USERNAME%`
 * correctly on a machine that may be domain-joined, Azure-AD-joined, or signed in
 * with a Microsoft account.
 */
async function currentUserSid(request: StateRootRequest): Promise<string | null> {
  const outcome = await request.runner.run({
    executable: 'whoami',
    args: ['/user', '/nh', '/fo', 'csv'],
    cwd: request.path,
    timeoutMs: ACL_TIMEOUT_MS,
  });
  if (outcome.failure !== null || outcome.exitCode !== 0) return null;
  const match = /S-1-[0-9-]+/.exec(outcome.stdout);
  return match?.[0] ?? null;
}

/**
 * Decodes an `icacls /save` file.
 *
 * icacls writes UTF-16LE with a byte-order mark. The BOM is honoured when present
 * and the encoding is inferred from the NUL pattern when it is not, because a file
 * decoded with the wrong encoding parses as garbage and garbage is reported as
 * `unverifiable` — a confusing failure for a directory that is perfectly fine.
 */
function decodeAclFile(bytes: Buffer): string {
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return bytes.subarray(2).toString('utf16le');
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString('utf8');
  }
  const sample = bytes.subarray(0, Math.min(bytes.length, 64));
  const nulls = sample.reduce((count, byte) => (byte === 0 ? count + 1 : count), 0);
  return nulls > sample.length / 4 ? bytes.toString('utf16le') : bytes.toString('utf8');
}

/** The SDDL line of an `icacls /save` file: line one is the directory name, line two the descriptor. */
export function extractSecurityDescriptor(text: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^[OGDS]:/.test(trimmed)) return trimmed;
  }
  return null;
}

async function readEffectiveAcl(
  request: StateRootRequest,
): Promise<{ ok: true; sddl: string } | { ok: false; message: string }> {
  // A sibling of the directory rather than a file inside it: writing into the
  // directory whose permissions are still unproven would be the one write this
  // function must not make, and a sibling in the same user-owned parent avoids it.
  // The process id keeps concurrent invocations from colliding. The file holds a
  // description of an ACL that anyone who can read the directory can already read.
  const snapshot = `${request.path}.acl-${String(process.pid)}`;
  await unlink(snapshot).catch(() => undefined);
  try {
    const outcome = await request.runner.run({
      executable: 'icacls',
      args: [request.path, '/save', snapshot, '/Q'],
      cwd: request.path,
      timeoutMs: ACL_TIMEOUT_MS,
    });
    if (outcome.failure !== null || outcome.exitCode !== 0) {
      return {
        ok: false,
        message: `icacls could not read the directory ACL (${outcome.failure?.reason ?? `exit ${String(outcome.exitCode)}`})`,
      };
    }
    const text = decodeAclFile(await readFile(snapshot));
    const sddl = extractSecurityDescriptor(text);
    if (sddl === null) {
      return { ok: false, message: 'The ACL saved by icacls contained no security descriptor' };
    }
    return { ok: true, sddl };
  } catch (error) {
    return {
      ok: false,
      message: `The directory ACL could not be read: ${(error as Error).message}`,
    };
  } finally {
    await unlink(snapshot).catch(() => undefined);
  }
}

async function ensureWindows(request: StateRootRequest): Promise<StateRootResult> {
  const { path } = request;
  const exists = await directoryExists(path);
  if (exists === null) {
    return unverifiable(
      path,
      'The state directory could not be inspected',
      'Check that the path exists and is readable, then run the command again',
    );
  }

  if (!exists && !request.create) {
    return {
      status: {
        path,
        verdict: 'absent',
        posixMode: null,
        unexpectedPrincipals: [],
        inheritanceBlocked: null,
      },
      diagnostics: [],
    };
  }

  // The directory is created before `whoami` runs, because every invocation through
  // the runner needs an existing working directory and this is the one the runner is
  // given. RFC 0004 §Process policy requires an explicit working directory, so there
  // is no ambient one to fall back on.
  if (!exists) {
    try {
      await mkdir(path, { recursive: true });
    } catch (error) {
      return unverifiable(
        path,
        `The state directory could not be created: ${(error as Error).message}`,
        'Check the permissions of the parent directory',
      );
    }
  }

  const ownerSid = await currentUserSid(request);
  if (ownerSid === null) {
    // RFC 0004: "If %LOCALAPPDATA% cannot be resolved, or the ACL cannot be read,
    // Token Harness fails with the unsupported-environment code."
    return unverifiable(
      path,
      'The current user SID could not be determined, so the state directory ACL cannot be verified',
      'Check that whoami.exe is available on PATH',
    );
  }

  if (!exists) {
    // Between `mkdir` and this call the directory carries its inherited ACL. Node
    // exposes no way to create a directory with a DACL in one operation, so the
    // window cannot be closed from here — which is a second reason the ACL is read
    // back afterwards rather than assumed from the request.
    const applied = await request.runner.run({
      executable: 'icacls',
      args: [path, '/inheritance:r', '/grant:r', ...stateRootGrantArguments(ownerSid), '/Q'],
      cwd: path,
      timeoutMs: ACL_TIMEOUT_MS,
    });
    if (applied.failure !== null || applied.exitCode !== 0) {
      return unverifiable(
        path,
        `The explicit ACL could not be applied to the state directory (${applied.failure?.reason ?? `exit ${String(applied.exitCode)}`})`,
        'Check that icacls.exe is available and that you own the directory',
      );
    }
  }

  const read = await readEffectiveAcl(request);
  if (!read.ok) {
    return unverifiable(path, read.message, 'Check that icacls.exe is available on PATH');
  }

  const evaluation = evaluateStateRootAcl(read.sddl, ownerSid);
  if (evaluation === null) {
    return unverifiable(
      path,
      'The security descriptor returned by icacls could not be parsed, so the state directory protection is unproven',
      'Report this with the output of `icacls <state directory>`',
    );
  }

  const diagnostics: Diagnostic[] = [];
  if (!evaluation.inheritanceBlocked) {
    // A warning, not an error: the principals are what the invariant is about, and
    // warnings do not contribute to the exit code (RFC 0006). An unprotected DACL
    // that currently grants nobody extra is safe *now* and fragile later, which is
    // exactly what a warning is for.
    diagnostics.push(
      diagnostic({
        severity: 'warning',
        code: 'state-directory-inheritance-not-blocked',
        message:
          'The state directory inherits permissions from its parent, so a later change to the parent would widen it',
        path,
        remediation: `Run \`icacls "${path}" /inheritance:r\` to detach it`,
      }),
    );
  }

  if (!evaluation.ok) {
    diagnostics.unshift(
      diagnostic({
        severity: 'error',
        code: 'state-directory-permissions-unexpected',
        message: `The state directory grants read access to ${evaluation.unexpectedPrincipals.join(', ')}, which the state permission invariant does not permit`,
        path,
        remediation: `Run \`icacls "${path}" /inheritance:r /grant:r "*${ownerSid}:(OI)(CI)(F)"\` after checking why the ACL changed`,
      }),
    );
    return {
      status: {
        path,
        verdict: 'permissions-unexpected',
        posixMode: null,
        unexpectedPrincipals: evaluation.unexpectedPrincipals,
        inheritanceBlocked: evaluation.inheritanceBlocked,
      },
      diagnostics,
    };
  }

  return {
    status: {
      path,
      verdict: 'ok',
      posixMode: null,
      unexpectedPrincipals: [],
      inheritanceBlocked: evaluation.inheritanceBlocked,
    },
    diagnostics,
  };
}

/**
 * Creates the state root when asked to, and in every case asserts the RFC 0004
 * permission invariant on it.
 *
 * WSL takes the POSIX path. Its `$HOME` is an ext4 filesystem where mode bits are
 * enforced; `icacls` is not applicable and would not be on `PATH`. A state root
 * redirected onto `/mnt/c` would fail the mode assertion rather than pass it
 * silently, because DrvFs does not report `0700` — which is the correct outcome,
 * since DrvFs does not enforce it either.
 */
export function ensureStateRoot(request: StateRootRequest): Promise<StateRootResult> {
  const nativeWindows = request.facts.os === 'windows' && !request.facts.isWsl;
  return nativeWindows ? ensureWindows(request) : ensurePosix(request);
}
