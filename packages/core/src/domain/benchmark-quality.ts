/** Explicit quality provenance. Check commands are argv arrays, never shell expressions. */
import type { ProcessFailureReason, ProcessOutcome } from './process.js';

export const DEFAULT_BENCHMARK_CHECK_TIMEOUT_MS = 300_000;
export const MAX_BENCHMARK_CHECK_TIMEOUT_MS = 3_600_000;

export interface TaskBenchmarkCheck {
  executable: string;
  args: string[];
  timeoutMs: number;
}

export type TaskBenchmarkQualityEvidence =
  | { source: 'user-recorded' }
  | {
      source: 'check-command';
      check: TaskBenchmarkCheck;
      exitCode: number | null;
      signal: string | null;
      failureReason: ProcessFailureReason | null;
      durationMs: number;
      output: {
        stdout: { sha256: string; bytes: number };
        stderr: { sha256: string; bytes: number };
      } | null;
      userRecordedQuality: 'passed' | 'failed' | 'unknown' | null;
    };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeCommandText(value: string): boolean {
  return [...value].every(
    (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
}

export function parseTaskBenchmarkCheck(value: unknown): TaskBenchmarkCheck | null {
  const row = object(value);
  if (
    row === null ||
    typeof row['executable'] !== 'string' ||
    row['executable'].trim() === '' ||
    row['executable'].length > 4096 ||
    !safeCommandText(row['executable']) ||
    !Array.isArray(row['args']) ||
    row['args'].length > 64 ||
    !row['args'].every((arg: unknown) => typeof arg === 'string' && safeCommandText(arg)) ||
    JSON.stringify(row['args']).length > 16_384 ||
    typeof row['timeoutMs'] !== 'number' ||
    !Number.isSafeInteger(row['timeoutMs']) ||
    row['timeoutMs'] < 1 ||
    row['timeoutMs'] > MAX_BENCHMARK_CHECK_TIMEOUT_MS
  )
    return null;
  return {
    executable: row['executable'],
    args: [...row['args']] as string[],
    timeoutMs: row['timeoutMs'],
  };
}

export function qualityFromCheckOutcome(
  outcome: Pick<ProcessOutcome, 'exitCode' | 'signal' | 'failure' | 'timedOut'>,
): 'passed' | 'failed' | 'unknown' {
  if (
    outcome.timedOut ||
    outcome.failure !== null ||
    outcome.signal !== null ||
    outcome.exitCode === null
  )
    return 'unknown';
  return outcome.exitCode === 0 ? 'passed' : 'failed';
}

function parseStreamHash(value: unknown): { sha256: string; bytes: number } | null {
  const row = object(value);
  if (
    row === null ||
    typeof row['sha256'] !== 'string' ||
    !/^[a-f0-9]{64}$/.test(row['sha256']) ||
    typeof row['bytes'] !== 'number' ||
    !Number.isSafeInteger(row['bytes']) ||
    row['bytes'] < 0
  )
    return null;
  return { sha256: row['sha256'], bytes: row['bytes'] };
}

const FAILURE_REASONS = new Set<ProcessFailureReason>([
  'executable-not-found',
  'executable-not-startable',
  'unsafe-argument',
  'timed-out',
  'spawn-failed',
]);

export function parseTaskBenchmarkQualityEvidence(
  value: unknown,
): TaskBenchmarkQualityEvidence | null {
  const row = object(value);
  if (row === null) return null;
  if (row['source'] === 'user-recorded') return { source: 'user-recorded' };
  const check = parseTaskBenchmarkCheck(row['check']);
  const recorded = row['userRecordedQuality'];
  if (
    row['source'] !== 'check-command' ||
    check === null ||
    (row['exitCode'] !== null &&
      (typeof row['exitCode'] !== 'number' || !Number.isSafeInteger(row['exitCode']))) ||
    (row['signal'] !== null && (typeof row['signal'] !== 'string' || row['signal'].length > 64)) ||
    (row['failureReason'] !== null &&
      !FAILURE_REASONS.has(row['failureReason'] as ProcessFailureReason)) ||
    typeof row['durationMs'] !== 'number' ||
    !Number.isFinite(row['durationMs']) ||
    row['durationMs'] < 0 ||
    (recorded !== null && recorded !== 'passed' && recorded !== 'failed' && recorded !== 'unknown')
  )
    return null;
  let output: Extract<TaskBenchmarkQualityEvidence, { source: 'check-command' }>['output'] = null;
  if (row['output'] !== null) {
    const hashes = object(row['output']);
    const stdout = parseStreamHash(hashes?.['stdout']);
    const stderr = parseStreamHash(hashes?.['stderr']);
    if (stdout === null || stderr === null) return null;
    output = { stdout, stderr };
  }
  return {
    source: 'check-command',
    check,
    exitCode: row['exitCode'] as number | null,
    signal: row['signal'] as string | null,
    failureReason: row['failureReason'] as ProcessFailureReason | null,
    durationMs: row['durationMs'],
    output,
    userRecordedQuality: recorded as 'passed' | 'failed' | 'unknown' | null,
  };
}

export function qualityFromCheckEvidence(
  evidence: Extract<TaskBenchmarkQualityEvidence, { source: 'check-command' }>,
): 'passed' | 'failed' | 'unknown' {
  if (evidence.failureReason !== null || evidence.signal !== null || evidence.exitCode === null)
    return 'unknown';
  return evidence.exitCode === 0 ? 'passed' : 'failed';
}

export function sameTaskBenchmarkCheck(
  left: TaskBenchmarkCheck,
  right: TaskBenchmarkCheck,
): boolean {
  return (
    left.executable === right.executable &&
    left.timeoutMs === right.timeoutMs &&
    JSON.stringify(left.args) === JSON.stringify(right.args)
  );
}

export function sameQualityGateEvidence(
  left: TaskBenchmarkQualityEvidence | undefined,
  right: TaskBenchmarkQualityEvidence | undefined,
): boolean {
  const a = left?.source ?? 'user-recorded';
  const b = right?.source ?? 'user-recorded';
  if (a !== b) return false;
  if (left?.source !== 'check-command' || right?.source !== 'check-command') return true;
  return sameTaskBenchmarkCheck(left.check, right.check);
}

export interface TaskBenchmarkPreparedConfiguration {
  source: 'managed-config-only';
  transactionId: string;
  planId: string;
  providers: string[];
  initialConfigurationId: string;
}

export interface TaskBenchmarkFactorialExperiment {
  design: 'factorial-2x2';
  configuration?: TaskBenchmarkPreparedConfiguration;
  /** User-declared identity; not proof of an unchanged Git tree. */
  startingState: string;
  compression: boolean;
  routing: boolean;
}

export const FACTORIAL_BENCHMARK_ARMS = [
  'baseline',
  'compression-only',
  'routing-only',
  'combined',
] as const;
export type TaskBenchmarkFactorialArm = (typeof FACTORIAL_BENCHMARK_ARMS)[number];

export function factorialExperimentForArm(
  arm: string,
  startingState: string,
): TaskBenchmarkFactorialExperiment | null {
  if (
    !/^[A-Za-z0-9._-]{1,128}$/.test(startingState) ||
    !(FACTORIAL_BENCHMARK_ARMS as readonly string[]).includes(arm)
  )
    return null;
  return {
    design: 'factorial-2x2',
    startingState,
    compression: arm === 'compression-only' || arm === 'combined',
    routing: arm === 'routing-only' || arm === 'combined',
  };
}

export function parseTaskBenchmarkFactorialExperiment(
  value: unknown,
  arm: string,
): TaskBenchmarkFactorialExperiment | null {
  const row = object(value);
  if (row === null || row['design'] !== 'factorial-2x2' || typeof row['startingState'] !== 'string')
    return null;
  const expected = factorialExperimentForArm(arm, row['startingState']);
  if (
    expected === null ||
    row['compression'] !== expected.compression ||
    row['routing'] !== expected.routing
  )
    return null;
  if (row['configuration'] === undefined) return expected;
  const c = object(row['configuration']);
  if (
    c === null ||
    c['source'] !== 'managed-config-only' ||
    typeof c['transactionId'] !== 'string' ||
    !/^factorial-[a-f0-9]{24}$/.test(c['transactionId']) ||
    typeof c['planId'] !== 'string' ||
    !/^[a-f0-9]{8}$/.test(c['planId']) ||
    typeof c['initialConfigurationId'] !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(c['initialConfigurationId']) ||
    !Array.isArray(c['providers']) ||
    c['providers'].length < 1 ||
    c['providers'].length > 2 ||
    !c['providers'].every((p) => p === 'rtk' || p === 'harnesstrim') ||
    new Set(c['providers']).size !== c['providers'].length
  )
    return null;
  return {
    ...expected,
    configuration: {
      source: 'managed-config-only',
      transactionId: c['transactionId'],
      planId: c['planId'],
      providers: [...c['providers']] as string[],
      initialConfigurationId: c['initialConfigurationId'],
    },
  };
}
