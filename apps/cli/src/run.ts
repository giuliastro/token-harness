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
import { runBenchmark } from './commands/benchmark.js';
import { runBenchmarkFinish } from './commands/benchmark-capture.js';
import {
  runCandidateBenchmarkMatrix,
  runCandidateBenchmarkStart,
} from './commands/candidate-benchmark.js';
import { runBudget } from './commands/budget.js';
import { runContext } from './commands/context-cost.js';
import { runDoctor } from './commands/doctor.js';
import { runHistory } from './commands/history.js';
import { runMetrics } from './commands/metrics.js';
import { runMcp } from './commands/mcp.js';
import { runOptimize } from './commands/optimize.js';
import { runPlan } from './commands/plan.js';
import { runRollback, runUninstall } from './commands/rollback.js';
import { runSetup } from './commands/setup.js';
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
  benchmark: runBenchmark,
  'benchmark-matrix': runCandidateBenchmarkMatrix,
  'benchmark-finish': runBenchmarkFinish,
  'benchmark-start': runCandidateBenchmarkStart,
  budget: runBudget,
  context: runContext,
  doctor: runDoctor,
  history: runHistory,
  metrics: runMetrics,
  mcp: runMcp,
  optimize: runOptimize,
  plan: runPlan,
  rollback: runRollback,
  setup: runSetup,
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

/** The subject column of a diagnostic line. */
const SUBJECT_WIDTH = 12;

function diagnosticLine(entry: Diagnostic): string {
  const label = entry.subject ?? entry.code;
  return truncate(
    `  ${row([
      [label, SUBJECT_WIDTH],
      [entry.message, 0],
    ])}`,
    MAX_WIDTH,
  );
}

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
    try {
      options.streams.out(serializeEnvelope(toEnvelope(result, toolVersion)));
    } catch (error) {
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
  const json = detectJsonMode(options.argv);

  const renderContext: RenderContext = {
    toolVersion,
    home: options.home,
    verbose: false,
    decorate: shouldDecorate({
      stdoutIsTty: options.stdoutIsTty ?? false,
      noColor: env['NO_COLOR'] !== undefined,
      json,
    }),
  };

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

  renderContext.verbose = invocation.options.verbose;

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
    baselineReceipt: invocation.options.baselineReceipt,
    optimizedReceipt: invocation.options.optimizedReceipt,
    benchmarkId: invocation.options.benchmarkId,
    benchmarkVariant: invocation.options.benchmarkVariant,
    benchmarkQuality: invocation.options.benchmarkQuality,
    benchmarkAttempts: invocation.options.benchmarkAttempts,
    benchmarkFailedAttempts: invocation.options.benchmarkFailedAttempts,
    optimizationCandidate: invocation.options.optimizationCandidate,
    taskClass: invocation.options.task,
    budgetProfile: invocation.options.profile,
    reservePercent: invocation.options.reservePercent,
    tasksRemaining: invocation.options.tasksLeft,
    nativePolicy: invocation.options.nativePolicy,
    agentSkill: invocation.options.agentSkill,
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