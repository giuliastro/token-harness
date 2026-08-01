/**
 * Diagnostics — RFC 0006 §JSON envelope.
 *
 * The shape is copied verbatim from the RFC. `code` is a stable kebab-case
 * identifier; messages may be reworded, codes may not.
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  /**
   * What the diagnostic is about — a harness or provider id — for the left column of the human
   * rendering. Null when it is about the run rather than about one thing.
   *
   * Added because the renderer needed it and was guessing. Human output shows one line per
   * diagnostic, and without a subject a reader could not tell which of several warnings referred to
   * which harness; deriving it by splitting the message on a colon worked for some messages and
   * silently produced nonsense for the rest.
   */
  subject: string | null;
  /** Absolute path when the diagnostic is file-scoped, otherwise null. */
  path: string | null;
  /** An action the user can take, otherwise null. */
  remediation: string | null;
}

const KEBAB_CASE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isDiagnosticCode(value: string): boolean {
  return KEBAB_CASE.test(value);
}

export interface DiagnosticInit {
  severity: DiagnosticSeverity;
  code: string;
  message: string;
  subject?: string | null;
  path?: string | null;
  remediation?: string | null;
}

/** Builds a diagnostic with the RFC key order and explicit nulls. */
export function diagnostic(init: DiagnosticInit): Diagnostic {
  return {
    severity: init.severity,
    code: init.code,
    message: init.message,
    subject: init.subject ?? null,
    path: init.path ?? null,
    remediation: init.remediation ?? null,
  };
}

/**
 * `info` never contributes to the exit code (RFC 0006 §Tier-aware verification
 * status). `warning` does not either: only `error` marks a result actionable.
 */
export function countActionable(diagnostics: readonly Diagnostic[]): number {
  return diagnostics.filter((d) => d.severity === 'error').length;
}
