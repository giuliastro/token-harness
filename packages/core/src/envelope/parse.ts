/**
 * Parsing and schema-version rejection.
 *
 * RFC 0006 rule 1: "`schemaVersion` is an integer. A consumer that sees an
 * unknown value must stop rather than guess." Every parser here refuses an
 * unknown version before it inspects any other field, so a future document is
 * never partially interpreted.
 *
 * PLAN §1.2 acceptance: "invalid manifests fail with actionable diagnostics" —
 * every failure carries a stable code and a remediation.
 */

import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import { isProviderId } from '../domain/ids.js';
import { isCapabilityId } from '../domain/capabilities.js';
import { MANIFEST_SCHEMA_VERSION, type ProviderManifest } from '../domain/manifest.js';
import {
  OPTIMIZATION_EVENT_SCHEMA_VERSION,
  isMeasurementClass,
  type OptimizationEvent,
} from '../metrics/events.js';
import { ENVELOPE_SCHEMA_VERSION, type CliEnvelope } from './envelope.js';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] };

function failure(diagnostics: Diagnostic[]): ParseResult<never> {
  return { ok: false, diagnostics };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function notAnObject(what: string): Diagnostic {
  return diagnostic({
    severity: 'error',
    code: 'malformed-document',
    message: `The ${what} is not a JSON object`,
    remediation: `Provide a JSON object for the ${what}`,
  });
}

/**
 * The single place schema versions are rejected. Returns null when the version
 * is acceptable, or the diagnostic that must stop the caller.
 */
export function checkSchemaVersion(
  value: unknown,
  expected: number,
  what: string,
): Diagnostic | null {
  if (!Number.isInteger(value)) {
    return diagnostic({
      severity: 'error',
      code: 'schema-version-missing',
      message: `The ${what} has no integer schemaVersion`,
      remediation: `Add "schemaVersion": ${expected}`,
    });
  }
  if (value !== expected) {
    return diagnostic({
      severity: 'error',
      code: 'schema-version-unsupported',
      message: `The ${what} declares schemaVersion ${String(value)}, but this build understands ${expected}`,
      remediation:
        (value as number) > expected
          ? 'Upgrade Token Harness to a build that understands this schema version'
          : 'Regenerate the document with the current schema version',
    });
  }
  return null;
}

function requireString(
  source: Record<string, unknown>,
  key: string,
  what: string,
  out: Diagnostic[],
): string | null {
  const value = source[key];
  if (typeof value !== 'string' || value.length === 0) {
    out.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: `The ${what} field \`${key}\` must be a non-empty string`,
        remediation: `Set \`${key}\` to a non-empty string`,
      }),
    );
    return null;
  }
  return value;
}

function requireArray(
  source: Record<string, unknown>,
  key: string,
  what: string,
  out: Diagnostic[],
): unknown[] | null {
  const value = source[key];
  if (!Array.isArray(value)) {
    out.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: `The ${what} field \`${key}\` must be an array`,
        remediation: `Set \`${key}\` to an array`,
      }),
    );
    return null;
  }
  return value;
}

/** Parses a `--json` envelope produced by another Token Harness invocation. */
export function parseCliEnvelope(input: unknown): ParseResult<CliEnvelope<unknown>> {
  if (!isRecord(input)) return failure([notAnObject('envelope')]);

  const versionProblem = checkSchemaVersion(
    input['schemaVersion'],
    ENVELOPE_SCHEMA_VERSION,
    'envelope',
  );
  if (versionProblem !== null) return failure([versionProblem]);

  const problems: Diagnostic[] = [];
  const command = requireString(input, 'command', 'envelope', problems);
  const toolVersion = requireString(input, 'toolVersion', 'envelope', problems);
  const status = input['status'];
  if (status !== 'ok' && status !== 'problems' && status !== 'blocked' && status !== 'error') {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: 'The envelope field `status` must be one of ok, problems, blocked, error',
        remediation: 'Set `status` to a value from the RFC 0006 status union',
      }),
    );
  }
  const exitCode = input['exitCode'];
  if (!Number.isInteger(exitCode)) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: 'The envelope field `exitCode` must be an integer',
        remediation: 'Set `exitCode` to the process exit code',
      }),
    );
  }
  const diagnostics = requireArray(input, 'diagnostics', 'envelope', problems);
  if (problems.length > 0 || command === null || toolVersion === null || diagnostics === null) {
    return failure(problems);
  }

  return {
    ok: true,
    value: {
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      command,
      toolVersion,
      status: status as CliEnvelope<unknown>['status'],
      exitCode: exitCode as number,
      data: 'data' in input ? (input['data'] ?? null) : null,
      diagnostics: diagnostics as Diagnostic[],
    },
  };
}

export function parseProviderManifest(input: unknown): ParseResult<ProviderManifest> {
  if (!isRecord(input)) return failure([notAnObject('provider manifest')]);

  const versionProblem = checkSchemaVersion(
    input['schemaVersion'],
    MANIFEST_SCHEMA_VERSION,
    'provider manifest',
  );
  if (versionProblem !== null) return failure([versionProblem]);

  const problems: Diagnostic[] = [];
  const what = 'provider manifest';

  const id = requireString(input, 'id', what, problems);
  if (id !== null && !isProviderId(id)) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'provider-id-invalid',
        message: `Provider id ${JSON.stringify(id)} is not lowercase kebab-case`,
        remediation: 'Use lowercase alphanumeric segments separated by single hyphens',
      }),
    );
  }
  requireString(input, 'displayName', what, problems);
  requireString(input, 'description', what, problems);
  requireString(input, 'homepage', what, problems);
  requireString(input, 'sourceRepository', what, problems);

  const license = input['license'];
  if (!isRecord(license)) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: 'The provider manifest field `license` must be an object',
        remediation: 'Declare spdx, distributionMode, and reviewRequired',
      }),
    );
  } else {
    const mode = license['distributionMode'];
    if (mode !== 'external' && mode !== 'bundled') {
      problems.push(
        diagnostic({
          severity: 'error',
          code: 'field-invalid',
          message:
            'The provider manifest field `license.distributionMode` must be external or bundled',
          remediation:
            'Set `license.distributionMode` to "external" unless a review approved bundling',
        }),
      );
    }
    if (typeof license['reviewRequired'] !== 'boolean') {
      problems.push(
        diagnostic({
          severity: 'error',
          code: 'field-invalid',
          message: 'The provider manifest field `license.reviewRequired` must be a boolean',
          remediation: 'Set `license.reviewRequired` to true or false',
        }),
      );
    }
  }

  const capabilities = requireArray(input, 'capabilities', what, problems);
  if (capabilities !== null) {
    for (const [index, entry] of capabilities.entries()) {
      if (!isRecord(entry)) {
        problems.push(
          diagnostic({
            severity: 'error',
            code: 'field-invalid',
            message: `The provider manifest entry \`capabilities[${index}]\` must be an object`,
            remediation: 'Declare capability, mode, harnesses, and evidence',
          }),
        );
        continue;
      }
      const capability = entry['capability'];
      if (typeof capability !== 'string' || !isCapabilityId(capability)) {
        problems.push(
          diagnostic({
            severity: 'error',
            code: 'capability-unknown',
            message: `Capability ${JSON.stringify(capability)} is not in the RFC 0003 taxonomy`,
            remediation: 'Use a declared capability id, or add one through an RFC',
          }),
        );
      }
      const mode = entry['mode'];
      if (mode !== 'exclusive' && mode !== 'chainable' && mode !== 'observational') {
        problems.push(
          diagnostic({
            severity: 'error',
            code: 'field-invalid',
            message: `The provider manifest entry \`capabilities[${index}].mode\` must be exclusive, chainable, or observational`,
            remediation: 'Declare one composition mode from RFC 0003',
          }),
        );
      }
    }
  }

  requireArray(input, 'platforms', what, problems);
  requireArray(input, 'harnesses', what, problems);
  requireArray(input, 'installationChannels', what, problems);

  const metrics = input['metrics'];
  if (!isRecord(metrics)) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: 'The provider manifest field `metrics` must be an object',
        remediation: 'Declare a metrics source, including "none" when there is no importer',
      }),
    );
  }

  if (problems.length > 0) return failure(problems);
  return { ok: true, value: input as unknown as ProviderManifest };
}

export function parseOptimizationEvent(input: unknown): ParseResult<OptimizationEvent> {
  if (!isRecord(input)) return failure([notAnObject('optimization event')]);

  const versionProblem = checkSchemaVersion(
    input['schemaVersion'],
    OPTIMIZATION_EVENT_SCHEMA_VERSION,
    'optimization event',
  );
  if (versionProblem !== null) return failure([versionProblem]);

  const problems: Diagnostic[] = [];
  requireString(input, 'eventId', 'optimization event', problems);
  requireString(input, 'timestamp', 'optimization event', problems);

  const measurement = input['measurement'];
  if (!isRecord(measurement)) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'field-invalid',
        message: 'The optimization event field `measurement` must be an object',
        remediation: 'Declare a measurement with an explicit class',
      }),
    );
  } else if (
    typeof measurement['class'] !== 'string' ||
    !isMeasurementClass(measurement['class'])
  ) {
    problems.push(
      diagnostic({
        severity: 'error',
        code: 'measurement-class-unknown',
        message: `Measurement class ${JSON.stringify(measurement['class'])} is not one of the RFC 0005 classes`,
        remediation:
          'Use exact-local, estimated-local, counterfactual, or end-to-end-billed; never leave a figure unlabelled',
      }),
    );
  }

  if (problems.length > 0) return failure(problems);
  return { ok: true, value: input as unknown as OptimizationEvent };
}

/** Parses JSON text, turning a syntax error into a diagnostic rather than a throw. */
export function parseJsonDocument(text: string): ParseResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return failure([
      diagnostic({
        severity: 'error',
        code: 'malformed-json',
        message: `The document is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
        remediation: 'Fix the JSON syntax and retry',
      }),
    ]);
  }
}
