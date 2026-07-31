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
  type Diagnostic,
  type ExitCode,
  type MetricsStore,
  type PlatformFacts,
} from '@token-harness/core';

import { detectJsonMode, parseArgv, type AvailableCommand, type Invocation } from './argv.js';
import { runApply } from './commands/apply.js';
import { runDoctor } from './commands/doctor.js';
import { runMetrics } from './commands/metrics.js';
import { runPlan } from './commands/plan.js';
import { runStatus } from './commands/status.js';
import type { AdapterAccess, CommandContext } from './commands/context.js';
import { renderHuman, shouldDecorate, type RenderContext } from './render/index.js';
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
  doctor: runDoctor,
  metrics: runMetrics,
  plan: runPlan,
  status: runStatus,
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

function formatDiagnostic(entry: Diagnostic): string {
  const lines = [`${entry.severity}  ${entry.code}: ${entry.message}`];
  if (entry.path !== null) lines.push(`       ${entry.path}`);
  if (entry.remediation !== null) lines.push(`       Fix: ${entry.remediation}`);
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
  for (const entry of rendering.stderrDiagnostics) options.streams.err(formatDiagnostic(entry));
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
    since: invocation.options.since,
    until: invocation.options.until,
    planId: invocation.options.plan,
    confirmed: invocation.options.yes,
    metrics: options.metrics ?? null,
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
