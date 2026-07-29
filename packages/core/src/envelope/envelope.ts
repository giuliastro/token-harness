/**
 * The `--json` envelope — RFC 0006 §JSON envelope.
 *
 * Key order matters: the golden JSON files are compared as text, so the envelope
 * is always built field by field in the order the RFC lists them.
 */

import type { Diagnostic } from '../domain/diagnostics.js';
import { EXIT_CODES, type ExitCode } from './exit-codes.js';

export const ENVELOPE_SCHEMA_VERSION = 1;

export type CliStatus = 'ok' | 'problems' | 'blocked' | 'error';

export interface CliEnvelope<T> {
  schemaVersion: typeof ENVELOPE_SCHEMA_VERSION;
  command: string;
  toolVersion: string;
  status: CliStatus;
  exitCode: number;
  data: T | null;
  diagnostics: Diagnostic[];
}

/**
 * RFC 0006 rule 2: "`status` is derived from `exitCode`: 0 is `ok`, 3 is
 * `problems`, 4 and 5 are `blocked`, everything else is `error`."
 */
export function statusForExitCode(exitCode: number): CliStatus {
  switch (exitCode) {
    case EXIT_CODES.ok:
      return 'ok';
    case EXIT_CODES['problems-found']:
      return 'problems';
    case EXIT_CODES['blocked-by-conflict']:
    case EXIT_CODES['precondition-drift']:
      return 'blocked';
    default:
      return 'error';
  }
}

/** The result object both renderings are produced from. */
export interface CommandResult<T> {
  command: string;
  exitCode: ExitCode;
  data: T | null;
  diagnostics: Diagnostic[];
}

export function commandResult<T>(init: {
  command: string;
  exitCode: ExitCode;
  data?: T | null;
  diagnostics?: Diagnostic[];
}): CommandResult<T> {
  return {
    command: init.command,
    exitCode: init.exitCode,
    data: init.data ?? null,
    diagnostics: init.diagnostics ?? [],
  };
}

export function toEnvelope<T>(result: CommandResult<T>, toolVersion: string): CliEnvelope<T> {
  const status = statusForExitCode(result.exitCode);
  return {
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    command: result.command,
    toolVersion,
    // RFC 0006: "`data` ... null when status is `error`".
    status,
    exitCode: result.exitCode,
    data: status === 'error' ? null : result.data,
    diagnostics: result.diagnostics,
  };
}

/**
 * Serializes with a single terminating newline and nothing else, per RFC 0006
 * rule 1: "No banner, no progress, no trailing newline beyond a single
 * terminating one."
 */
export function serializeEnvelope<T>(envelope: CliEnvelope<T>): string {
  return `${JSON.stringify(envelope, null, 2)}\n`;
}
