/**
 * The fake process runner — PLAN §2.2, "fake runner with expectation matching".
 *
 * AGENTS.md: "Tests use temporary directories and fake process runners", and
 * PLAN §2.2 acceptance: "provider unit tests require no installed upstream
 * executable." This is what makes both true, and it is what lets the Windows-only
 * `icacls` logic in `state-root.ts` be tested on macOS and Linux.
 *
 * An unmatched invocation throws rather than returning a plausible outcome. A
 * fake that answers anything teaches a test suite nothing: the whole value of the
 * double is that a command nobody declared is a defect in the test, and a thrown
 * error is the only way that surfaces as one.
 */

import {
  formatDisplayCommand,
  redactionPolicy,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
} from '@token-harness/core';

export interface ProcessExpectation {
  /** Matched against the requested name, its basename, and its full path. */
  executable: string | RegExp;
  /** Exact argument array, or a predicate. Omitted means any arguments. */
  args?: readonly string[] | ((args: readonly string[]) => boolean);
  cwd?: string;
  /** How many times this expectation may match. Defaults to unlimited. */
  times?: number;
  /** Fields to override on the default success outcome. */
  respond?: Partial<ProcessOutcome> | ((request: ProcessRequest) => Partial<ProcessOutcome>);
}

interface Registered {
  expectation: ProcessExpectation;
  matched: number;
}

function basename(value: string): string {
  const cut = Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\'));
  return cut === -1 ? value : value.slice(cut + 1);
}

const LAUNCHABLE_EXTENSION = /\.(?:exe|com|cmd|bat|ps1)$/i;

/**
 * Spellings of the same command.
 *
 * `icacls`, `icacls.exe`, and `C:\Windows\System32\icacls.exe` are one command, and
 * an expectation written as the first must match a request written as any of them —
 * otherwise every test has to know which spelling the code under test happened to
 * resolve.
 */
function spellingsOf(value: string): Set<string> {
  const name = basename(value).toLowerCase();
  return new Set([value, basename(value), name, name.replace(LAUNCHABLE_EXTENSION, '')]);
}

function matchesExecutable(pattern: string | RegExp, requested: string): boolean {
  const candidates = spellingsOf(requested);
  if (typeof pattern === 'string') {
    for (const wanted of spellingsOf(pattern)) {
      if (candidates.has(wanted)) return true;
    }
    return false;
  }
  return [...candidates].some((candidate) => pattern.test(candidate));
}

function matchesArgs(expected: ProcessExpectation['args'], actual: readonly string[]): boolean {
  if (expected === undefined) return true;
  if (typeof expected === 'function') return expected(actual);
  if (expected.length !== actual.length) return false;
  return expected.every((value, index) => value === actual[index]);
}

function describe(expectation: ProcessExpectation): string {
  const executable =
    typeof expectation.executable === 'string'
      ? expectation.executable
      : expectation.executable.source;
  const args =
    expectation.args === undefined
      ? '<any args>'
      : typeof expectation.args === 'function'
        ? '<predicate>'
        : expectation.args.join(' ');
  const cwd = expectation.cwd === undefined ? '' : ` in ${expectation.cwd}`;
  return `${executable} ${args}${cwd}`;
}

export class FakeProcessRunner implements ProcessRunner {
  private readonly registered: Registered[] = [];
  private readonly recorded: ProcessRequest[] = [];

  /** Registers an expectation. Later registrations match only when earlier ones are exhausted. */
  expect(expectation: ProcessExpectation): this {
    this.registered.push({ expectation, matched: 0 });
    return this;
  }

  /** Every request received, in order. Read by tests that assert on the command shape. */
  get calls(): readonly ProcessRequest[] {
    return this.recorded;
  }

  // `async`, so an unexpected command produces a rejected promise rather than a
  // synchronous throw. A `ProcessRunner` that can throw synchronously would make
  // every caller wrap its own `await` in a try block.
  async run(request: ProcessRequest): Promise<ProcessOutcome> {
    this.recorded.push(request);
    const policy = redactionPolicy({ secretValues: request.secretValues ?? [] });
    const displayCommand = formatDisplayCommand(request.executable, request.args, policy);

    for (const entry of this.registered) {
      const { expectation } = entry;
      if (expectation.times !== undefined && entry.matched >= expectation.times) continue;
      if (!matchesExecutable(expectation.executable, request.executable)) continue;
      if (!matchesArgs(expectation.args, request.args)) continue;
      if (expectation.cwd !== undefined && expectation.cwd !== request.cwd) continue;

      entry.matched += 1;
      const override =
        typeof expectation.respond === 'function'
          ? expectation.respond(request)
          : (expectation.respond ?? {});
      return {
        displayCommand,
        interpreter: 'direct',
        executablePath: request.executable,
        exitCode: 0,
        signal: null,
        stdout: '',
        stderr: '',
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: 0,
        timedOut: false,
        failure: null,
        ...override,
      };
    }

    const known =
      this.registered.length === 0
        ? '    (no expectations registered)'
        : this.registered
            .map(
              (entry) =>
                `    ${describe(entry.expectation)}  [matched ${String(entry.matched)}${entry.expectation.times === undefined ? '' : `/${String(entry.expectation.times)}`}]`,
            )
            .join('\n');
    throw new Error(
      `FakeProcessRunner received an unexpected command:\n    ${displayCommand}  in ${request.cwd}\n  registered expectations:\n${known}`,
    );
  }

  /** Throws when an expectation with a declared `times` was not met exactly. */
  assertSatisfied(): void {
    const unmet = this.registered.filter(
      (entry) => entry.expectation.times !== undefined && entry.matched !== entry.expectation.times,
    );
    if (unmet.length === 0) return;
    throw new Error(
      `FakeProcessRunner has unmet expectations:\n${unmet
        .map(
          (entry) =>
            `    ${describe(entry.expectation)}  expected ${String(entry.expectation.times)}, got ${String(entry.matched)}`,
        )
        .join('\n')}`,
    );
  }
}
