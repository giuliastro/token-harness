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
  path?: string | null;
  remediation?: string | null;
}

/** Builds a diagnostic with the RFC key order and explicit nulls. */
export function diagnostic(init: DiagnosticInit): Diagnostic {
  return {
    severity: init.severity,
    code: init.code,
    message: init.message,
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
