/**
 * Command-line parsing.
 *
 * RFC 0006 §Global flags is the whole flag surface, and two of its rules shape
 * this module more than the rest:
 *
 * - "`--help` and `--version` always exit 0 and always write to stdout,
 *   including when the rest of the command line is invalid" — so both are
 *   detected by a pre-scan, before any validation runs;
 * - "Usage errors (exit 2) also emit a valid envelope when `--json` was parsed
 *   successfully. An unparseable command line writes plain text to stderr" — so
 *   `--json` is also detected by pre-scan. With that pre-scan, `--json` is
 *   always determinable, and "unparseable" collapses to "the user was not asking
 *   for JSON", which is exactly the case that wants plain text on stderr.
 */

import {
  diagnostic,
  isBudgetProfile,
  isHarnessId,
  isPlanId,
  isProviderId,
  isTaskClass,
  type BudgetProfile,
  type Diagnostic,
  type HarnessId,
  type ProviderId,
  type TaskClass,
} from '@token-harness/core';

/** Commands the Phase 1 shell implements. */
export const AVAILABLE_COMMANDS = [
  'apply',
  'budget',
  'context',
  'doctor',
  'metrics',
  'mcp',
  'optimize',
  'plan',
  'rollback',
  'status',
  'uninstall',
  'update',
  'verify',
] as const;

export type AvailableCommand = (typeof AVAILABLE_COMMANDS)[number];

/**
 * Commands RFC 0001 §CLI contract declares for the stable surface but that this build does not
 * carry yet. They are rejected as usage errors with their own diagnostic code, so a declared
 * command never reads as a typo.
 *
 * Empty, and kept rather than deleted. `update` was the last entry, so every command RFC 0001
 * §CLI contract declares is now implemented — and the mechanism is what makes the *next* declared
 * command distinguishable from a misspelling, which is a property worth keeping past the moment
 * the list happens to be empty.
 */
export const PLANNED_COMMANDS: readonly string[] = [];

export interface CommandOptions {
  harness: HarnessId | null;
  provider: ProviderId | null;
  project: string | null;
  /**
   * The reporting window, unvalidated — RFC 0006 §Golden path spells it `--since 7d`.
   *
   * Parsing happens in `resolveMetricsWindow`, not here, because the window needs a clock and
   * this module deliberately has none. What this layer checks is that a value was given.
   */
  since: string | null;
  until: string | null;
  /** `--plan <id>`; validated for shape here and for existence by the command. */
  plan: string | null;
  /** RFC 0011 advisory optimizer inputs. */
  task: TaskClass | null;
  profile: BudgetProfile | null;
  reservePercent: number | null;
  /** `--yes`: the confirmation RFC 0006 requires of a mutating command. */
  yes: boolean;
}

export type Invocation =
  | { kind: 'help'; json: boolean; topic: AvailableCommand | null }
  | { kind: 'version'; json: boolean }
  | { kind: 'command'; json: boolean; command: AvailableCommand; options: CommandOptions }
  | { kind: 'usage-error'; json: boolean; diagnostics: Diagnostic[] };

/** RFC 0006 §Global flags, restricted to the read-only commands of Phase 1. */
const VALUE_FLAGS = new Set([
  '--harness',
  '--provider',
  '--project',
  '--since',
  '--until',
  '--plan',
  '--task',
  '--profile',
  '--reserve',
]);

/**
 * Flags that carry no value.
 *
 * `--json` is also read by the pre-scan above, because RFC 0006 requires a usage error to emit
 * an envelope when `--json` parsed; it is listed here so the main loop does not reject it as
 * unknown.
 */
const BOOLEAN_FLAGS = new Set(['--json', '--yes']);

export function detectJsonMode(argv: readonly string[]): boolean {
  return argv.some((token) => token === '--json' || token.startsWith('--json='));
}

function detectHelp(argv: readonly string[]): boolean {
  return argv.includes('--help');
}

function detectVersion(argv: readonly string[]): boolean {
  return argv.includes('--version');
}

function usageError(json: boolean, diagnostics: Diagnostic[]): Invocation {
  return { kind: 'usage-error', json, diagnostics };
}

function isAvailableCommand(value: string): value is AvailableCommand {
  return (AVAILABLE_COMMANDS as readonly string[]).includes(value);
}

export function parseArgv(
  argv: readonly string[],
  /**
   * The declared-but-unimplemented list, as data.
   *
   * A parameter rather than a closed-over constant because `PLANNED_COMMANDS` is now empty: every
   * command RFC 0001 declares is implemented. A hardcoded reference to an empty list would make
   * the branch below unreachable and untestable at the same moment, and the branch is what keeps
   * the *next* declared command from reading as a typo.
   */
  plannedCommands: readonly string[] = PLANNED_COMMANDS,
): Invocation {
  const json = detectJsonMode(argv);

  // Pre-scan: these two win over every other outcome, including an otherwise
  // invalid command line.
  if (detectHelp(argv)) {
    const positional = argv.find((token) => !token.startsWith('-'));
    return {
      kind: 'help',
      json,
      topic: positional !== undefined && isAvailableCommand(positional) ? positional : null,
    };
  }
  if (detectVersion(argv)) {
    return { kind: 'version', json };
  }

  const diagnostics: Diagnostic[] = [];
  const options: CommandOptions = {
    harness: null,
    provider: null,
    project: null,
    since: null,
    until: null,
    plan: null,
    task: null,
    profile: null,
    reservePercent: null,
    yes: false,
  };
  let command: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] as string;

    if (!token.startsWith('-')) {
      if (command === null) {
        command = token;
      } else {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'unexpected-argument',
            message: `Unexpected argument ${JSON.stringify(token)}`,
            remediation: 'Run `token-harness --help` to see the accepted arguments',
          }),
        );
      }
      continue;
    }

    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    const inlineValue = equals === -1 ? null : token.slice(equals + 1);

    if (BOOLEAN_FLAGS.has(name)) {
      if (inlineValue !== null) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'flag-takes-no-value',
            message: `The flag \`${name}\` does not take a value`,
            remediation: `Pass \`${name}\` on its own`,
          }),
        );
        continue;
      }
      // RFC 0006: "require either an interactive confirmation or `--yes`". This is the second.
      if (name === '--yes') options.yes = true;
      continue;
    }

    if (!VALUE_FLAGS.has(name)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'unknown-flag',
          message: `Unknown flag ${JSON.stringify(name)}`,
          remediation: 'Run `token-harness --help` to see the accepted flags',
        }),
      );
      continue;
    }

    let value = inlineValue;
    if (value === null) {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('-')) {
        diagnostics.push(
          diagnostic({
            severity: 'error',
            code: 'flag-missing-value',
            message: `The flag \`${name}\` requires a value`,
            remediation: `Pass a value, for example \`${name} <value>\``,
          }),
        );
        continue;
      }
      value = next;
      index += 1;
    }

    if (value === '') {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'flag-missing-value',
          message: `The flag \`${name}\` requires a non-empty value`,
          remediation: `Pass a value, for example \`${name} <value>\``,
        }),
      );
      continue;
    }

    switch (name) {
      case '--harness':
        if (!isHarnessId(value)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-argument',
              message: `Harness id ${JSON.stringify(value)} is not lowercase kebab-case`,
              remediation: 'Use a harness id such as `claude`, `codex`, or `opencode`',
            }),
          );
        } else {
          options.harness = value;
        }
        break;
      case '--provider':
        if (!isProviderId(value)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-argument',
              message: `Provider id ${JSON.stringify(value)} is not lowercase kebab-case`,
              remediation: 'Use a provider id such as `rtk` or `harnesstrim`',
            }),
          );
        } else {
          options.provider = value;
        }
        break;
      case '--project':
        options.project = value;
        break;
      case '--since':
        options.since = value;
        break;
      case '--until':
        options.until = value;
        break;
      case '--task':
        if (!isTaskClass(value)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-task-class',
              message: `Task class ${JSON.stringify(value)} is not supported`,
              remediation: 'Use mechanical, standard, hard, or critical',
            }),
          );
        } else {
          options.task = value;
        }
        break;
      case '--profile':
        if (!isBudgetProfile(value)) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-budget-profile',
              message: `Budget profile ${JSON.stringify(value)} is not supported`,
              remediation: 'Use economy, balanced, quality, or custom',
            }),
          );
        } else {
          options.profile = value;
        }
        break;
      case '--reserve': {
        const parsed = Number(value);
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 95) {
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-reserve-percent',
              message: `Reserve ${JSON.stringify(value)} must be a percentage from 0 to 95`,
              remediation: 'Use a value such as --reserve 20',
            }),
          );
        } else {
          options.reservePercent = parsed;
        }
        break;
      }
      case '--plan':
        if (!isPlanId(value)) {
          // Checked here rather than on the filesystem: a value that cannot be a plan id is a
          // usage error, and reporting it as "no such plan" would send the user looking for a
          // file that was never going to exist.
          diagnostics.push(
            diagnostic({
              severity: 'error',
              code: 'invalid-argument',
              message: `Plan id ${JSON.stringify(value)} is not eight hexadecimal characters`,
              remediation: 'Use the id `token-harness plan` printed',
            }),
          );
        } else {
          options.plan = value;
        }
        break;
      default:
        break;
    }
  }

  if (command === null) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'no-command',
        message: 'No command was given',
        remediation: 'Run `token-harness --help` to see the available commands',
      }),
    );
    return usageError(json, diagnostics);
  }

  if (!isAvailableCommand(command)) {
    const planned = plannedCommands.includes(command);
    diagnostics.push(
      planned
        ? diagnostic({
            severity: 'error',
            code: 'command-not-available',
            message: `The command \`${command}\` is part of the 0.1.0 surface but is not implemented in this build`,
            remediation: 'Use `doctor`, `plan`, or `status`',
          })
        : diagnostic({
            severity: 'error',
            code: 'unknown-command',
            message: `Unknown command ${JSON.stringify(command)}`,
            remediation: 'Run `token-harness --help` to see the available commands',
          }),
    );
    return usageError(json, diagnostics);
  }

  if (diagnostics.length > 0) return usageError(json, diagnostics);

  return { kind: 'command', json, command, options };
}
