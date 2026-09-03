/**
 * The process runner contract — RFC 0002 §Process abstraction, RFC 0004
 * §Process policy.
 *
 * "Provider adapters never call the operating system directly. They receive a
 * process runner." The runner is therefore part of the provider contract, and
 * the contract lives in `core` alongside `ProviderAdapter` and `PlannedAction`.
 * Its implementations — the one that spawns and the one tests use — live in
 * `@token-harness/platform`, which is the only package allowed to import
 * `node:child_process`.
 *
 * There is deliberately no way to express a shell string in this interface. RFC
 * 0004 requires "executable plus argument arrays" and forbids shell
 * interpolation; making the unsafe call unrepresentable is stronger than
 * documenting that it should not be made.
 */

import type { RedactionPolicy } from './redaction.js';

/**
 * How the executable was started.
 *
 * `windows-command-interpreter` exists because of a real conflict between two
 * accepted rules, resolved in `@token-harness/platform`: a Windows batch shim
 * (`pnpm.cmd`, and every `bin` entry npm installs on Windows) cannot be started
 * by `CreateProcess` at all, so running one requires `cmd.exe`, while RFC 0004
 * forbids shell interpolation. The interpreter is recorded on every outcome so a
 * plan, a receipt, or a diagnostic can state which path was taken rather than
 * leaving it implicit.
 */
export type ProcessInterpreter = 'direct' | 'windows-command-interpreter';

export interface ProcessRequest {
  /** An executable name to resolve, or an absolute path. Never a command line. */
  executable: string;
  args: readonly string[];
  /** RFC 0004: "Set explicit working directories." Required, never inherited. */
  cwd: string;
  /**
   * Variables added to the minimal inherited set. RFC 0004 §Credentials:
   * "inherits only the minimum environment needed by a child process."
   */
  env?: Readonly<Record<string, string>>;
  /** RFC 0004: "Enforce action-specific timeouts." */
  timeoutMs?: number;
  /** RFC 0004: "Bound output retained in diagnostics." Per stream. */
  maxOutputBytes?: number;
  /** Values redacted from the displayed command, the logs, and the captured streams. */
  secretValues?: readonly string[];
  /** Extra flags whose argument is a secret, on top of the defaults. */
  secretArgFlags?: readonly string[];
  /** Written to the child's stdin. Never inherited. */
  stdin?: string;
  /**
   * Keep stdin open until a complete stdout line contains this marker, then close it.
   *
   * Absent by default: ordinary commands still receive EOF immediately after `stdin` is written.
   * This exists for newline-delimited request/response servers whose asynchronous reply can race
   * process shutdown when EOF is their transport-close signal.
   */
  stdinCloseAfterStdoutLineIncludes?: string;
  /**
   * Keep stdin open until every marker has appeared on a complete stdout line.
   *
   * Use this for a batched request/response transport where replies may arrive out of order.
   * The single-marker option above remains the compact form for one awaited response.
   */
  stdinCloseAfterStdoutLineIncludesAll?: readonly string[];
}

export type ProcessFailureReason =
  /** No file matched the name on `PATH`, including `PATHEXT` expansion on Windows. */
  | 'executable-not-found'
  /** Resolved, but this platform cannot start it: a `.ps1` on `PATHEXT`, or a POSIX text file with no shebang. */
  | 'executable-not-startable'
  /** An argument cannot be passed safely through the Windows command interpreter. */
  | 'unsafe-argument'
  /** The child did not finish within `timeoutMs`; its process tree was terminated. */
  | 'timed-out'
  /** The spawn itself failed: a missing working directory, a permission error, a resource limit. */
  | 'spawn-failed';

export interface ProcessFailure {
  reason: ProcessFailureReason;
  /** Already redacted. Safe to place in a `Diagnostic`. */
  message: string;
}

export interface ProcessOutcome {
  /**
   * The command as it may be shown to a user or written to a log: redacted, and
   * never a re-runnable shell string.
   */
  displayCommand: string;
  interpreter: ProcessInterpreter;
  /** The absolute path that was started, or null when resolution failed. */
  executablePath: string | null;
  /** Null when the child was signalled or never started. */
  exitCode: number | null;
  signal: string | null;
  /** Redacted and bounded by `maxOutputBytes`. */
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  durationMs: number;
  timedOut: boolean;
  /**
   * Null when the child ran to completion, *whatever its exit code*. A non-zero
   * exit is data, not an error: `doctor` reads it constantly.
   */
  failure: ProcessFailure | null;
}

export interface ProcessRunner {
  run(request: ProcessRequest): Promise<ProcessOutcome>;
}

/** One mebibyte per stream. Enough for any provider's `--json`, small enough to keep in a diagnostic. */
export const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Thirty seconds. Individual actions narrow this; nothing widens it silently. */
export const DEFAULT_PROCESS_TIMEOUT_MS = 30_000;

/** True when the child started, finished, and exited zero. */
export function processSucceeded(outcome: ProcessOutcome): boolean {
  return outcome.failure === null && outcome.exitCode === 0;
}

export function processRedactionPolicy(request: ProcessRequest): Partial<RedactionPolicy> {
  return {
    secretValues: request.secretValues ?? [],
    secretArgFlags: request.secretArgFlags ?? [],
  };
}
