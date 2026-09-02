/**
 * The real process runner — RFC 0004 §Process policy.
 *
 * This is the only file in the workspace allowed to import
 * `node:child_process`; `tests/integration/architecture.test.ts` enforces that,
 * so nothing else can grow a way to spawn something. RFC 0004 §State directory
 * permissions depends on it: `icacls` runs "through the process runner", which is
 * why 2.2 is implemented before 2.1 despite the order in PLAN §15.
 *
 * Every requirement in the RFC is a property of this class rather than a
 * convention callers follow:
 *
 * - executable plus argument array, with `shell: false` unconditionally;
 * - a required, explicit working directory;
 * - bounded stdout and stderr, per stream, with truncation reported;
 * - an enforced timeout that terminates the whole process tree, not just the
 *   child that was started;
 * - exit code, stdout, and stderr preserved separately;
 * - secrets redacted from the displayed command, the log, and both streams.
 *
 * A non-zero exit is not a failure here. `doctor` reads non-zero exits
 * constantly, so `failure` stays null whenever the child ran to completion.
 */

import { spawn } from 'node:child_process';
import { win32 } from 'node:path';
import process from 'node:process';

import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  formatDisplayCommand,
  isStartableExecutable,
  redactText,
  redactionPolicy,
  secretValuesIn,
  type PlatformFacts,
  type ProcessFailureReason,
  type ProcessInterpreter,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type RedactionPolicy,
  type ResolvedExecutable,
} from '@token-harness/core';

import { minimalChildEnvironment } from './environment.js';
import {
  buildCommandInterpreterCommandLine,
  resolveCommandInterpreter,
} from './windows-command-line.js';

export interface NodeProcessRunnerOptions {
  facts: PlatformFacts;
  /** The ambient environment. Filtered by the RFC 0004 allowlist before any child sees it. */
  env: Readonly<Record<string, string | undefined>>;
  /** Executable resolution, injected so `PATH` handling stays one implementation. */
  resolve: (name: string) => ResolvedExecutable | null;
  /** Receives redacted single-line records. RFC 0004: "Redact secrets from displayed commands and logs." */
  log?: (line: string) => void;
  now?: () => number;
  /** How long a terminated tree gets to exit before it is killed outright. */
  killGraceMs?: number;
}

const DEFAULT_KILL_GRACE_MS = 2_000;

interface BoundedCapture {
  append(chunk: Buffer): void;
  text(policy: RedactionPolicy): string;
  truncated: boolean;
}

/**
 * Retains at most `limit` bytes and keeps counting.
 *
 * The stream is still fully consumed after the limit: a child whose pipe stops
 * being read blocks on write and then hits the timeout instead of finishing,
 * which would turn a chatty command into a hang.
 */
function boundedCapture(limit: number): BoundedCapture {
  const chunks: Buffer[] = [];
  let size = 0;
  const capture: BoundedCapture = {
    truncated: false,
    append(chunk: Buffer): void {
      if (size >= limit) {
        capture.truncated = true;
        return;
      }
      const room = limit - size;
      if (chunk.length <= room) {
        chunks.push(chunk);
        size += chunk.length;
        return;
      }
      chunks.push(chunk.subarray(0, room));
      size = limit;
      capture.truncated = true;
    },
    text(policy: RedactionPolicy): string {
      // A cut can land mid-codepoint; the decoder substitutes U+FFFD, which is
      // the honest rendering of "the rest was dropped".
      return redactText(Buffer.concat(chunks).toString('utf8'), policy);
    },
  };
  return capture;
}

function failureOutcome(
  base: Pick<ProcessOutcome, 'displayCommand' | 'interpreter' | 'executablePath'>,
  reason: ProcessFailureReason,
  message: string,
  durationMs: number,
): ProcessOutcome {
  return {
    ...base,
    exitCode: null,
    signal: null,
    stdout: '',
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs,
    timedOut: reason === 'timed-out',
    failure: { reason, message },
  };
}

function spawnFailureReason(code: string | undefined): ProcessFailureReason {
  if (code === 'EACCES' || code === 'EPERM') return 'executable-not-startable';
  return 'spawn-failed';
}

export class NodeProcessRunner implements ProcessRunner {
  private readonly options: NodeProcessRunnerOptions;

  constructor(options: NodeProcessRunnerOptions) {
    this.options = options;
  }

  async run(request: ProcessRequest): Promise<ProcessOutcome> {
    const now = this.options.now ?? Date.now;
    const started = now();
    const policy = redactionPolicy({
      secretValues: [...(request.secretValues ?? []), ...secretValuesIn(request.env ?? {})],
      secretArgFlags: request.secretArgFlags ?? [],
    });
    const displayCommand = formatDisplayCommand(request.executable, request.args, policy);
    const log = (line: string): void => this.options.log?.(redactText(line, policy));

    const resolved = this.options.resolve(request.executable);
    if (resolved === null) {
      log(`skip  ${displayCommand}  (not found)`);
      return failureOutcome(
        { displayCommand, interpreter: 'direct', executablePath: null },
        'executable-not-found',
        `No executable named ${JSON.stringify(request.executable)} was found on PATH`,
        now() - started,
      );
    }

    if (!isStartableExecutable(resolved)) {
      log(`skip  ${displayCommand}  (${resolved.kind})`);
      return failureOutcome(
        { displayCommand, interpreter: 'direct', executablePath: resolved.path },
        'executable-not-startable',
        resolved.kind === 'posix-script-without-shebang'
          ? `${resolved.path} is a text file with no \`#!\` line, so the kernel cannot start it`
          : `${resolved.path} has an extension Token Harness will not launch (${resolved.kind})`,
        now() - started,
      );
    }

    const plan = this.buildInvocation(resolved, request.args);
    if (!plan.ok) {
      log(`skip  ${displayCommand}  (unsafe argument)`);
      return failureOutcome(
        { displayCommand, interpreter: plan.interpreter, executablePath: resolved.path },
        'unsafe-argument',
        plan.message,
        now() - started,
      );
    }

    log(`run   ${displayCommand}`);
    log(`      cwd ${request.cwd}`);

    const outcome = await this.execute(plan, request, policy, displayCommand, resolved, started);
    const suffix = outcome.timedOut
      ? ' (timed out)'
      : outcome.stdoutTruncated || outcome.stderrTruncated
        ? ' (output truncated)'
        : '';
    log(
      outcome.failure === null
        ? `      exit ${String(outcome.exitCode ?? outcome.signal)} in ${String(outcome.durationMs)}ms${suffix}`
        : `      failed ${outcome.failure.reason}: ${outcome.failure.message}`,
    );
    return outcome;
  }

  /**
   * Chooses between the direct path and the command interpreter.
   *
   * A batch shim is the only reason the second exists. Nothing else routes
   * through `cmd.exe`, and the choice is recorded on the outcome so it is
   * reviewable rather than invisible.
   */
  private buildInvocation(
    resolved: ResolvedExecutable,
    args: readonly string[],
  ):
    | {
        ok: true;
        file: string;
        args: readonly string[];
        verbatim: boolean;
        interpreter: ProcessInterpreter;
      }
    | { ok: false; interpreter: ProcessInterpreter; message: string } {
    if (resolved.kind !== 'windows-batch-shim') {
      return { ok: true, file: resolved.path, args, verbatim: false, interpreter: 'direct' };
    }

    const interpreterPath = resolveCommandInterpreter(this.options.env, win32.join);
    if (interpreterPath === null) {
      return {
        ok: false,
        interpreter: 'windows-command-interpreter',
        message:
          'Neither %SystemRoot% nor %COMSPEC% is set, so cmd.exe could not be located to start a batch shim',
      };
    }

    const built = buildCommandInterpreterCommandLine(interpreterPath, resolved.path, args);
    if (!built.ok) {
      return {
        ok: false,
        interpreter: 'windows-command-interpreter',
        message: `Argument ${JSON.stringify(built.argument)} ${built.reason}, so it cannot be passed to the batch shim ${resolved.path}`,
      };
    }
    return {
      ok: true,
      file: built.invocation.interpreter,
      args: built.invocation.args,
      // The command line was built from an argument array by
      // `buildCommandInterpreterCommandLine`; Node must not quote it again.
      verbatim: true,
      interpreter: 'windows-command-interpreter',
    };
  }

  private execute(
    plan: {
      file: string;
      args: readonly string[];
      verbatim: boolean;
      interpreter: ProcessInterpreter;
    },
    request: ProcessRequest,
    policy: RedactionPolicy,
    displayCommand: string,
    resolved: ResolvedExecutable,
    started: number,
  ): Promise<ProcessOutcome> {
    const now = this.options.now ?? Date.now;
    const limit = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const onPosix = !(this.options.facts.os === 'windows' && !this.options.facts.isWsl);

    return new Promise<ProcessOutcome>((resolvePromise) => {
      const stdout = boundedCapture(limit);
      const stderr = boundedCapture(limit);
      let settled = false;
      let timedOut = false;
      let timer: NodeJS.Timeout | undefined;
      let killTimer: NodeJS.Timeout | undefined;

      const finish = (outcome: ProcessOutcome): void => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        if (killTimer !== undefined) clearTimeout(killTimer);
        resolvePromise(outcome);
      };

      const child = spawn(plan.file, [...plan.args], {
        cwd: request.cwd,
        env: minimalChildEnvironment({
          facts: this.options.facts,
          ambient: this.options.env,
          ...(request.env === undefined ? {} : { additions: request.env }),
        }),
        // RFC 0004 §Process policy. Not configurable, at any call site.
        shell: false,
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
        // A process group leader is what makes the whole tree killable on POSIX.
        // On Windows `detached` would create a console and outlive us instead, so
        // termination there goes through `taskkill /t`.
        detached: onPosix,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const stdinMarker = request.stdinCloseAfterStdoutLineIncludes;
      let stdoutLineBuffer = '';
      let stdinEnded = false;
      const endStdin = (): void => {
        if (stdinEnded) return;
        stdinEnded = true;
        child.stdin?.end();
      };

      child.stdout?.on('data', (chunk: Buffer) => {
        stdout.append(chunk);
        if (stdinMarker === undefined || stdinEnded) return;

        stdoutLineBuffer += chunk.toString('utf8');
        const lines = stdoutLineBuffer.split(/\r?\n/);
        stdoutLineBuffer = lines.pop() ?? '';
        if (lines.some((line) => line.includes(stdinMarker))) endStdin();

        // A malformed/non-JSONL child must not turn this tiny transport guard into unbounded memory.
        // The captured stdout is separately bounded; this buffer only needs enough tail to find the
        // marker across chunk boundaries.
        if (stdoutLineBuffer.length > 65_536) {
          stdoutLineBuffer = stdoutLineBuffer.slice(-Math.max(4096, stdinMarker.length * 2));
        }
      });
      child.stderr?.on('data', (chunk: Buffer) => stderr.append(chunk));

      // stdin is never inherited. Ordinarily it closes immediately after the payload is written.
      // Request/response servers may opt into holding it open until a specific JSONL response line
      // arrives; the process timeout remains the hard bound if that response never comes.
      child.stdin?.on('error', () => {});
      if (request.stdin !== undefined) child.stdin?.write(request.stdin);
      if (stdinMarker === undefined) endStdin();

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          timedOut = true;
          this.terminateTree(child.pid, onPosix);
          // If the tree ignores the polite signal, stop being polite.
          killTimer = setTimeout(
            () => this.terminateTree(child.pid, onPosix, true),
            this.options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
          );
        }, timeoutMs);
      }

      child.on('error', (error: NodeJS.ErrnoException) => {
        finish(
          failureOutcome(
            { displayCommand, interpreter: plan.interpreter, executablePath: resolved.path },
            spawnFailureReason(error.code),
            redactText(
              `Starting ${resolved.path} failed: ${error.code ?? 'unknown'} ${error.message}`,
              policy,
            ),
            now() - started,
          ),
        );
      });

      child.on('close', (code, signal) => {
        const durationMs = now() - started;
        if (timedOut) {
          finish({
            displayCommand,
            interpreter: plan.interpreter,
            executablePath: resolved.path,
            exitCode: code,
            signal,
            stdout: stdout.text(policy),
            stderr: stderr.text(policy),
            stdoutTruncated: stdout.truncated,
            stderrTruncated: stderr.truncated,
            durationMs,
            timedOut: true,
            failure: {
              reason: 'timed-out',
              message: `The command did not finish within ${String(timeoutMs)}ms and its process tree was terminated`,
            },
          });
          return;
        }
        finish({
          displayCommand,
          interpreter: plan.interpreter,
          executablePath: resolved.path,
          exitCode: code,
          signal,
          stdout: stdout.text(policy),
          stderr: stderr.text(policy),
          stdoutTruncated: stdout.truncated,
          stderrTruncated: stderr.truncated,
          durationMs,
          timedOut: false,
          failure: null,
        });
      });
    });
  }

  /**
   * Terminates the child *and its descendants*.
   *
   * Killing only the child leaves a package manager's own node process running
   * and holding the pipe open, so the timeout would fire and the promise would
   * still never settle.
   */
  private terminateTree(pid: number | undefined, onPosix: boolean, force = false): void {
    if (pid === undefined) return;
    try {
      if (onPosix) {
        process.kill(-pid, force ? 'SIGKILL' : 'SIGTERM');
        return;
      }
      const systemRoot = this.options.env['SystemRoot'] ?? this.options.env['windir'];
      const taskkill =
        systemRoot === undefined ? 'taskkill' : win32.join(systemRoot, 'System32', 'taskkill.exe');
      spawn(taskkill, ['/pid', String(pid), '/t', '/f'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      }).on('error', () => {});
    } catch {
      // The tree is already gone, which is the outcome we wanted.
    }
  }
}
