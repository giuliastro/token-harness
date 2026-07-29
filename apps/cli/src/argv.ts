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
  isHarnessId,
  isProviderId,
  type Diagnostic,
  type HarnessId,
  type ProviderId,
} from '@token-harness/core';

/** Commands the Phase 1 shell implements. */
export const AVAILABLE_COMMANDS = ['doctor', 'plan', 'status'] as const;

export type AvailableCommand = (typeof AVAILABLE_COMMANDS)[number];

/**
 * Commands RFC 0001 §CLI contract declares for the stable surface but that this
 * build does not carry yet. They are rejected as usage errors with their own
 * diagnostic code, so `token-harness apply` never reads as a typo.
 */
export const PLANNED_COMMANDS = [
  'apply',
  'verify',
  'metrics',
  'update',
  'rollback',
  'uninstall',
] as const;

export interface CommandOptions {
  harness: HarnessId | null;
  provider: ProviderId | null;
  project: string | null;
}

export type Invocation =
  | { kind: 'help'; json: boolean; topic: AvailableCommand | null }
  | { kind: 'version'; json: boolean }
  | { kind: 'command'; json: boolean; command: AvailableCommand; options: CommandOptions }
  | { kind: 'usage-error'; json: boolean; diagnostics: Diagnostic[] };

/** RFC 0006 §Global flags, restricted to the read-only commands of Phase 1. */
const VALUE_FLAGS = new Set(['--harness', '--provider', '--project']);
const BOOLEAN_FLAGS = new Set(['--json']);
/** Declared by RFC 0006 for mutating commands, which this build does not have. */
const MUTATING_ONLY_FLAGS = new Set(['--yes', '--plan']);

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

export function parseArgv(argv: readonly string[]): Invocation {
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
  const options: CommandOptions = { harness: null, provider: null, project: null };
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
      }
      continue;
    }

    if (MUTATING_ONLY_FLAGS.has(name)) {
      diagnostics.push(
        diagnostic({
          severity: 'error',
          code: 'flag-not-applicable',
          message: `The flag \`${name}\` applies to mutating commands, which this build does not carry yet`,
          remediation: 'Use `doctor`, `plan`, or `status`',
        }),
      );
      if (inlineValue === null && VALUE_FLAGS.has(name)) index += 1;
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
    const planned = (PLANNED_COMMANDS as readonly string[]).includes(command);
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
