/**
 * The CLI runner.
 *
 * Everything the process touches is injected, so the whole contract in RFC 0006
 * — exit codes, the envelope, and stream discipline — is testable without
 * spawning anything and without reading the developer's home directory.
 */

import {
  EXIT_CODES,
  MINIMUM_NODE_VERSION,
  commandResult,
  compareVersions,
  diagnostic,
  parseSemanticVersion,
  serializeEnvelope,
  toEnvelope,
  type CommandResult,
  type CompatibilityRow,
  type Diagnostic,
  type ExitCode,
  type MetricsStore,
  type PlatformFacts,
} from '@token-harness/core';

import { detectJsonMode, parseArgv, type AvailableCommand, type Invocation } from './argv.js';
import { runApply } from './commands/apply.js';
import { runBudget } from './commands/budget.js';
import { runContext } from './commands/context-cost.js';
import { runDoctor } from './commands/doctor.js';
import { runMetrics } from './commands/metrics.js';
import { runPlan } from './commands/plan.js';
import { runRollback, runUninstall } from './commands/rollback.js';
import { runStatus } from './commands/status.js';
import { runUpdate } from './commands/update.js';
import { runVerify } from './commands/verify.js';
import type { AdapterAccess, CommandContext } from './commands/context.js';
import {
  MAX_WIDTH,
  renderHuman,
  row,
  shouldDecorate,
  truncate,
  type RenderContext,
} from './render/index.js';
import { usageText } from './usage.js';
import { TOOL_VERSION } from './version.js';

export interface Streams {
  out(text: string): void;
  err(text: string): void;
}

export type CommandTable = Readonly<
  Record<AvailableCommand, (context: CommandContext) => Promise<CommandResult<unknown>>>
>;

export const DEFAULT_COMMANDS: CommandTable = {
  apply: runApply,
  budget: runBudget,
  context: runContext,
  doctor: runDoctor,
  metrics: runMetrics,
  plan: runPlan,
  rollback: runRollback,
  status: runStatus,
  uninstall: runUninstall,
  update: runUpdate,
  verify: runVerify,
};

export interface RunOptions {
  argv: readonly string[];
  streams: Streams;
  /**
   * Null when the operating system is not one of the three Token Harness
   * supports. There are no honest facts to report in that case, and the run ends
   * with the unsupported-environment code before anything reads them.
   */
  platform: PlatformFacts | null;
  /** Absolute working directory. */
  cwd: string;
  /** Absolute home directory, or null when it could not be resolved. */
  home: string | null;
  /** Absolute state root, or null when path resolution failed. */
  stateRoot?: string | null;
  /**
   * Failures from the platform layer: an unsupported operating system, an
   * unresolvable `%LOCALAPPDATA%`, a state root that would land in the system
   * temporary directory. Any `error` here ends the run with exit 9.
   */
  environmentDiagnostics?: readonly Diagnostic[];
  /**
   * The ports adapters need. Omitted by tests that assert the CLI contract without a
   * filesystem; `doctor` then inspects nothing rather than reading the real machine.
   */
  adapters?: AdapterAccess | null;
  /**
   * RFC 0009 compatibility rows. Omitted (or null) to use the shipped table; tests pass a
   * non-null table to admit combinations the shipped, still-empty table refuses.
   */
  compatibilityRows?: readonly CompatibilityRow[] | null;
  /** ISO 8601 instant. Defaults to the real clock; injected by tests. */
  now?: () => string;
  /** The metrics store. Omitted by tests that assert the CLI contract without one. */
  metrics?: MetricsStore | null;
  env?: Readonly<Record<string, string | undefined>>;
  stdoutIsTty?: boolean;
  toolVersion?: string;
  /**
   * Injected so the internal-error boundary can be exercised without a fault
   * flag in shipped code. Defaults to the real command table.
   */
  commands?: CommandTable;
}

/**
 * The key column of a diagnostic block. Every value aligns to it, wrapped text included.
 *
 * The old shape was `severity  code: message`, then the path and `Fix:` each indented seven spaces
 * — a number related to nothing, so continuations looked scattered. A screenshot of one real run
 * showed ten such blocks in a row, several wrapping mid-word. It was unreadable, and no test
 * measured a line width anywhere.
 */
/** The subject column of a diagnostic line. */
const SUBJECT_WIDTH = 12;

/**
 * One line per diagnostic, and no more.
 *
 * Chosen by the user over two alternatives, after three attempts at a block layout. Every earlier
 * shape put the message, the path and a `fix` on separate lines — the path and fix indented seven
 * spaces, a number related to nothing — and long values wrapped, so one warning occupied four lines
 * whose left edges did not line up. One real run printed ten of those.
 *
 * The message is truncated rather than wrapped, and the path and remediation are dropped entirely.
 * Nothing is lost: `--json` carries all three fields untruncated, which is where a caller that needs
 * them should be looking.
 */
function diagnosticLine(entry: Diagnostic): string {
  /**
   * The subject, or the code when there is no subject.
   *
   * Dropping the code entirely was the first attempt, and it cost something real: RFC 0006 rule 4
   * makes codes "stable identifiers, not translated strings", and a usage error whose stderr no
   * longer contains `unknown-command` cannot be matched by a script or quoted in a bug report. A
   * subject is better where one exists — it says which harness a warning is about — and the code is
   * the honest fallback where none does.
   */
  const label = entry.subject ?? entry.code;
  return truncate(
    `  ${row([
      [label, SUBJECT_WIDTH],
      [entry.message, 0],
    ])}`,
    MAX_WIDTH,
  );
}

/**
 * `info` never reaches a human.
 *
 * One ordinary run emitted ten of them — "no event stream, so only a provider can witness
 * interception", "no plugin entry is registered" — none actionable, and indistinguishable from the
 * two lines that were. They stay in `--json`, where a machine can read them and nobody is being
 * asked to.
 */
function formatDiagnostics(diagnostics: readonly Diagnostic[]): string {
  const errors = diagnostics.filter((entry) => entry.severity === 'error');
  const warnings = diagnostics.filter((entry) => entry.severity === 'warning');
  if (errors.length === 0 && warnings.length === 0) return '';

  const lines: string[] = [];
  for (const [title, group] of [
    ['ERRORS', errors],
    ['WARNINGS', warnings],
  ] as const) {
    if (group.length === 0) continue;
    lines.push('');
    lines.push(title);
    for (const entry of group) lines.push(diagnosticLine(entry));
  }
  return `${lines.join('\n')}\n`;
}

/** RFC 0006 §Exit codes 9: "The runtime, OS, or harness combination is unsupported". */
function checkRuntimeFloor(nodeVersion: string): Diagnostic | null {
  const observed = parseSemanticVersion(nodeVersion);
  const floor = parseSemanticVersion(MINIMUM_NODE_VERSION);
  if (floor === null) return null;
  if (observed === null) {
    return diagnostic({
      severity: 'error',
      code: 'unsupported-node-version',
      message: `Node version ${JSON.stringify(nodeVersion)} could not be parsed`,
      remediation: `Run Token Harness on Node ${MINIMUM_NODE_VERSION} or newer`,
    });
  }
  if (compareVersions(observed, floor) < 0) {
    return diagnostic({
      severity: 'error',
      code: 'unsupported-node-version',
      message: `Token Harness requires Node ${MINIMUM_NODE_VERSION} or newer, but this process is Node ${nodeVersion}`,
      remediation: `Upgrade to Node ${MINIMUM_NODE_VERSION} or newer`,
    });
  }
  return null;
}

function emit(
  result: CommandResult<unknown>,
  options: RunOptions,
  renderContext: RenderContext,
  json: boolean,
): ExitCode {
  const toolVersion = options.toolVersion ?? TOOL_VERSION;

  if (json) {
    // RFC 0006 §Streams rule 1: one JSON document on stdout and nothing else.
    try {
      options.streams.out(serializeEnvelope(toEnvelope(result, toolVersion)));
    } catch (error) {
      // The one case the RFC allows on stderr in `--json` mode: a failure that
      // prevented serialization.
      options.streams.err(
        `internal-error  envelope-serialization-failed: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return EXIT_CODES['internal-error'];
    }
    return result.exitCode;
  }

  const rendering = renderHuman(result, renderContext);
  if (rendering.report !== '') options.streams.out(rendering.report);
  const diagnostics = formatDiagnostics(rendering.stderrDiagnostics);
  if (diagnostics !== '') options.streams.err(diagnostics);
  return result.exitCode;
}

function emitHelpOrVersion(invocation: Invocation, options: RunOptions): ExitCode {
  const toolVersion = options.toolVersion ?? TOOL_VERSION;

  if (invocation.kind === 'version') {
    if (invocation.json) {
      options.streams.out(
        serializeEnvelope(
          toEnvelope(
            commandResult({
              command: 'version',
              exitCode: EXIT_CODES.ok,
              data: { version: toolVersion },
            }),
            toolVersion,
          ),
        ),
      );
    } else {
      options.streams.out(`${toolVersion}\n`);
    }
    return EXIT_CODES.ok;
  }

  const topic = invocation.kind === 'help' ? invocation.topic : null;
  const text = usageText(topic);
  if (invocation.kind === 'help' && invocation.json) {
    options.streams.out(
      serializeEnvelope(
        toEnvelope(
          commandResult({ command: 'help', exitCode: EXIT_CODES.ok, data: { usage: text } }),
          toolVersion,
        ),
      ),
    );
  } else {
    options.streams.out(`${text}\n`);
  }
  return EXIT_CODES.ok;
}

export async function run(options: RunOptions): Promise<number> {
  const toolVersion = options.toolVersion ?? TOOL_VERSION;
  const env = options.env ?? {};
  // Pre-scan, so the runtime-floor failure below is also reported as an
  // envelope when the caller asked for one.
  const json = detectJsonMode(options.argv);

  const renderContext: RenderContext = {
    toolVersion,
    home: options.home,
    decorate: shouldDecorate({
      stdoutIsTty: options.stdoutIsTty ?? false,
      noColor: env['NO_COLOR'] !== undefined,
      json,
    }),
  };

  // An unsupported operating system is checked before anything else, for the same
  // reason as the runtime floor below: there is no version of this program that
  // runs correctly here, so printing a usage page would imply otherwise.
  if (options.platform === null) {
    return emit(
      commandResult({
        command: 'token-harness',
        exitCode: EXIT_CODES['unsupported-environment'],
        diagnostics:
          options.environmentDiagnostics !== undefined && options.environmentDiagnostics.length > 0
            ? [...options.environmentDiagnostics]
            : [
                diagnostic({
                  severity: 'error',
                  code: 'unsupported-operating-system',
                  message: 'Token Harness supports Windows, macOS, and Linux',
                  remediation: 'Run Token Harness on Windows, macOS, Linux, or WSL',
                }),
              ],
      }),
      options,
      renderContext,
      json,
    );
  }

  // The runtime floor is checked before anything else, including `--help`. A
  // process that cannot be trusted to run correctly should say so rather than
  // print a usage page that implies it can.
  const runtimeProblem = checkRuntimeFloor(options.platform.nodeVersion);
  if (runtimeProblem !== null) {
    return emit(
      commandResult({
        command: 'token-harness',
        exitCode: EXIT_CODES['unsupported-environment'],
        diagnostics: [runtimeProblem],
      }),
      options,
      renderContext,
      json,
    );
  }

  const invocation = parseArgv(options.argv);

  if (invocation.kind === 'help' || invocation.kind === 'version') {
    return emitHelpOrVersion(invocation, options);
  }

  if (invocation.kind === 'usage-error') {
    return emit(
      commandResult({
        command: 'token-harness',
        exitCode: EXIT_CODES['usage-error'],
        diagnostics: invocation.diagnostics,
      }),
      options,
      renderContext,
      json,
    );
  }

  // Checked here rather than beside the runtime floor: an unresolvable state
  // directory does not make `--help` or `--version` untrustworthy, and it does not
  // make a mistyped command line correct either. What it does block is every
  // command, because RFC 0004 §State directory permissions requires failing with
  // the unsupported-environment code instead of continuing into a location whose
  // protection has not been verified. There is deliberately no fallback to a
  // writable directory.
  const environmentDiagnostics = options.environmentDiagnostics ?? [];
  if (environmentDiagnostics.some((entry) => entry.severity === 'error')) {
    return emit(
      commandResult({
        command: invocation.command,
        exitCode: EXIT_CODES['unsupported-environment'],
        diagnostics: [...environmentDiagnostics],
      }),
      options,
      renderContext,
      json,
    );
  }

  const context: CommandContext = {
    adapters: options.adapters ?? null,
    now: options.now ?? (() => new Date().toISOString()),
    platform: options.platform,
    projectRoot: invocation.options.project ?? options.cwd,
    home: options.home,
    stateRoot: options.stateRoot ?? null,
    harness: invocation.options.harness,
    provider: invocation.options.provider,
    taskClass: invocation.options.task,
    budgetProfile: invocation.options.profile,
    reservePercent: invocation.options.reservePercent,
    since: invocation.options.since,
    until: invocation.options.until,
    planId: invocation.options.plan,
    confirmed: invocation.options.yes,
    metrics: options.metrics ?? null,
    compatibilityRows: options.compatibilityRows ?? null,
  };

  const table = options.commands ?? DEFAULT_COMMANDS;
  let result: CommandResult<unknown>;
  try {
    result = await table[invocation.command](context);
  } catch (error) {
    // RFC 0006 §Exit codes 1: "Unexpected failure; a bug in Token Harness".
    result = commandResult({
      command: invocation.command,
      exitCode: EXIT_CODES['internal-error'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'internal-error',
          message: `The command \`${invocation.command}\` failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
          remediation:
            'Report this with the command you ran at https://github.com/giuliastro/TokenHarness/issues',
        }),
      ],
    });
  }

  return emit(result, options, renderContext, json);
}
