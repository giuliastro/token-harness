import { MCPTOON_REVIEWED_INSTALL_VERSION, parseMcptoonVersion } from '@token-harness/adapters';

import type { CommandContext } from './context.js';

export const MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION = 1;

export type McptoonUsageObservationState =
  | 'observed'
  | 'unsupported-version'
  | 'unavailable'
  | 'invalid';

interface McptoonUsageCall {
  ok: boolean;
  ts: number;
}

export interface McptoonUsageObservation {
  state: McptoonUsageObservationState;
  version: string | null;
  totalCalls: number | null;
  /** Privacy-bounded rows: server/tool names are deliberately never retained. */
  calls: McptoonUsageCall[];
  reason: string;
}

export interface McptoonActivationCapture {
  schemaVersion: typeof MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION;
  benchmarkId: string;
  projectId: string;
  variant: 'optimized';
  startedAt: string;
  version: string | null;
  observationState: McptoonUsageObservationState;
  totalCalls: number | null;
}

export type McptoonActivationWitnessState = 'verified' | 'blocked' | 'unknown';

export interface McptoonActivationReceipt {
  schemaVersion: typeof MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION;
  benchmarkId: string;
  projectId: string;
  variant: 'optimized';
  startedAt: string;
  completedAt: string;
  version: string | null;
  state: McptoonActivationWitnessState;
  totalCallsAtStart: number | null;
  totalCallsAtFinish: number | null;
  callDelta: number | null;
  callsDuringWindow: number;
  successfulCallsDuringWindow: number;
  reason: string;
}

function finiteNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function usagePath(context: CommandContext): string | null {
  if (context.adapters === null || context.home === null) return null;
  return context.adapters.fs.join(context.home, '.cache', 'mcptoon', 'usage.json');
}

function activationPath(
  context: CommandContext,
  benchmarkId: string,
  filename: string,
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, filename);
}

async function writeJson(context: CommandContext, path: string, value: unknown): Promise<boolean> {
  if (context.adapters === null) return false;
  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(JSON.stringify(value, null, 2) + '\n'),
    );
    return true;
  } catch {
    return false;
  }
}

async function readJson(context: CommandContext, path: string): Promise<unknown | null> {
  if (context.adapters === null) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
  } catch {
    return null;
  }
}

/**
 * Read the exact mcptoon 0.7.10 local usage contract without executing a tool or contacting MCP.
 * Raw server/tool identities are discarded before this function returns.
 */
export async function readMcptoonUsageObservation(
  context: CommandContext,
): Promise<McptoonUsageObservation> {
  if (context.adapters === null || context.home === null) {
    return {
      state: 'unavailable',
      version: null,
      totalCalls: null,
      calls: [],
      reason: 'local adapters or home directory are unavailable',
    };
  }

  const versionOutcome = await context.adapters.runner.run({
    executable: 'mcptoon',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (versionOutcome.failure !== null || versionOutcome.exitCode !== 0) {
    return {
      state: 'unavailable',
      version: null,
      totalCalls: null,
      calls: [],
      reason: 'mcptoon version could not be read passively',
    };
  }

  const version = parseMcptoonVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  if (version !== MCPTOON_REVIEWED_INSTALL_VERSION) {
    return {
      state: 'unsupported-version',
      version,
      totalCalls: null,
      calls: [],
      reason: `usage witness is reviewed only for mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION}`,
    };
  }

  const path = usagePath(context);
  if (path === null) {
    return {
      state: 'unavailable',
      version,
      totalCalls: null,
      calls: [],
      reason: 'mcptoon usage path could not be resolved',
    };
  }

  const stat = await context.adapters.fs.stat(path);
  if (stat === null) {
    return {
      state: 'observed',
      version,
      totalCalls: 0,
      calls: [],
      reason: 'mcptoon has not recorded a local tool call yet',
    };
  }
  if (stat.kind !== 'file') {
    return {
      state: 'invalid',
      version,
      totalCalls: null,
      calls: [],
      reason: 'mcptoon usage path is not a regular file',
    };
  }

  const raw = await readJson(context, path);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return {
      state: 'invalid',
      version,
      totalCalls: null,
      calls: [],
      reason: 'mcptoon usage data is not a JSON object',
    };
  }

  const record = raw as Record<string, unknown>;
  const totalCalls = finiteNonNegativeInteger(record['total']);
  const rawCalls = record['calls'];
  if (totalCalls === null || !Array.isArray(rawCalls) || totalCalls < rawCalls.length) {
    return {
      state: 'invalid',
      version,
      totalCalls: null,
      calls: [],
      reason: 'mcptoon usage counters do not match the reviewed 0.7.10 schema',
    };
  }

  const calls: McptoonUsageCall[] = [];
  for (const value of rawCalls) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return {
        state: 'invalid',
        version,
        totalCalls: null,
        calls: [],
        reason: 'mcptoon usage contains an invalid call record',
      };
    }
    const call = value as Record<string, unknown>;
    if (
      typeof call['ok'] !== 'boolean' ||
      typeof call['ts'] !== 'number' ||
      !Number.isFinite(call['ts']) ||
      call['ts'] < 0
    ) {
      return {
        state: 'invalid',
        version,
        totalCalls: null,
        calls: [],
        reason: 'mcptoon usage contains an invalid call outcome or timestamp',
      };
    }
    calls.push({ ok: call['ok'], ts: call['ts'] });
  }

  return {
    state: 'observed',
    version,
    totalCalls,
    calls,
    reason: 'mcptoon 0.7.10 local usage counters were read without retaining tool identities',
  };
}

function parseCapture(value: unknown): McptoonActivationCapture | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row['schemaVersion'] !== MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION ||
    typeof row['benchmarkId'] !== 'string' ||
    typeof row['projectId'] !== 'string' ||
    row['projectId'] === '' ||
    row['variant'] !== 'optimized' ||
    typeof row['startedAt'] !== 'string' ||
    !Number.isFinite(Date.parse(row['startedAt'])) ||
    !(row['version'] === null || typeof row['version'] === 'string') ||
    !(
      row['observationState'] === 'observed' ||
      row['observationState'] === 'unsupported-version' ||
      row['observationState'] === 'unavailable' ||
      row['observationState'] === 'invalid'
    ) ||
    !(row['totalCalls'] === null || finiteNonNegativeInteger(row['totalCalls']) !== null)
  ) {
    return null;
  }
  return row as unknown as McptoonActivationCapture;
}

export async function recordMcptoonActivationStart(
  context: CommandContext,
  input: { benchmarkId: string; projectId: string; startedAt: string },
): Promise<boolean> {
  const path = activationPath(context, input.benchmarkId, 'mcptoon-activation.capture.json');
  if (path === null) return false;
  const observation = await readMcptoonUsageObservation(context);
  const capture: McptoonActivationCapture = {
    schemaVersion: MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION,
    benchmarkId: input.benchmarkId,
    projectId: input.projectId,
    variant: 'optimized',
    startedAt: input.startedAt,
    version: observation.version,
    observationState: observation.state,
    totalCalls: observation.totalCalls,
  };
  return writeJson(context, path, capture);
}

export async function readMcptoonActivationCapture(
  context: CommandContext,
  benchmarkId: string,
): Promise<McptoonActivationCapture | null> {
  const path = activationPath(context, benchmarkId, 'mcptoon-activation.capture.json');
  if (path === null || context.adapters === null) return null;
  const stat = await context.adapters.fs.stat(path);
  if (stat === null || stat.kind !== 'file') return null;
  return parseCapture(await readJson(context, path));
}

export function evaluateMcptoonActivation(
  capture: McptoonActivationCapture | null,
  finish: McptoonUsageObservation,
  completedAt: string,
): McptoonActivationReceipt | null {
  if (capture === null) return null;

  const base = {
    schemaVersion: MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION,
    benchmarkId: capture.benchmarkId,
    projectId: capture.projectId,
    variant: 'optimized' as const,
    startedAt: capture.startedAt,
    completedAt,
    version: finish.version ?? capture.version,
    totalCallsAtStart: capture.totalCalls,
    totalCallsAtFinish: finish.totalCalls,
  };
  const startMs = Date.parse(capture.startedAt);
  const finishMs = Date.parse(completedAt);

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(finishMs) ||
    finishMs < startMs ||
    capture.observationState !== 'observed' ||
    finish.state !== 'observed' ||
    capture.version !== MCPTOON_REVIEWED_INSTALL_VERSION ||
    finish.version !== MCPTOON_REVIEWED_INSTALL_VERSION ||
    capture.totalCalls === null ||
    finish.totalCalls === null
  ) {
    return {
      ...base,
      state: 'unknown',
      callDelta: null,
      callsDuringWindow: 0,
      successfulCallsDuringWindow: 0,
      reason:
        'mcptoon activation cannot be attributed because a reviewed boundary observation is missing',
    };
  }

  if (finish.totalCalls < capture.totalCalls) {
    return {
      ...base,
      state: 'unknown',
      callDelta: null,
      callsDuringWindow: 0,
      successfulCallsDuringWindow: 0,
      reason: 'mcptoon usage counter moved backwards or was reset during the benchmark',
    };
  }

  const callDelta = finish.totalCalls - capture.totalCalls;
  const callsDuringWindow = finish.calls.filter((call) => {
    const at = call.ts * 1000;
    return at >= startMs && at <= finishMs;
  });
  const successfulCallsDuringWindow = callsDuringWindow.filter((call) => call.ok).length;

  if (callDelta === 0) {
    return {
      ...base,
      state: 'blocked',
      callDelta,
      callsDuringWindow: 0,
      successfulCallsDuringWindow: 0,
      reason: 'no mcptoon tool call was recorded while the optimized task was running',
    };
  }

  if (callsDuringWindow.length === 0) {
    return {
      ...base,
      state: 'unknown',
      callDelta,
      callsDuringWindow: 0,
      successfulCallsDuringWindow: 0,
      reason:
        'mcptoon usage increased, but the bounded call buffer cannot place a call inside the benchmark window',
    };
  }

  if (successfulCallsDuringWindow === 0) {
    return {
      ...base,
      state: 'blocked',
      callDelta,
      callsDuringWindow: callsDuringWindow.length,
      successfulCallsDuringWindow,
      reason: 'mcptoon was invoked during the optimized task, but no recorded call succeeded',
    };
  }

  return {
    ...base,
    state: 'verified',
    callDelta,
    callsDuringWindow: callsDuringWindow.length,
    successfulCallsDuringWindow,
    reason:
      'mcptoon 0.7.10 recorded successful local tool activity inside the optimized task window',
  };
}

export async function recordMcptoonActivationFinish(
  context: CommandContext,
  input: { benchmarkId: string; projectId: string; completedAt: string },
): Promise<McptoonActivationReceipt | null> {
  const capture = await readMcptoonActivationCapture(context, input.benchmarkId);
  if (capture === null || capture.projectId !== input.projectId) return null;
  const finish = await readMcptoonUsageObservation(context);
  const receipt = evaluateMcptoonActivation(capture, finish, input.completedAt);
  if (receipt === null) return null;
  const path = activationPath(context, input.benchmarkId, 'mcptoon-activation.json');
  if (path === null || !(await writeJson(context, path, receipt))) return null;
  return receipt;
}

export async function readMcptoonActivationReceipt(
  context: CommandContext,
  benchmarkId: string,
): Promise<McptoonActivationReceipt | null> {
  const path = activationPath(context, benchmarkId, 'mcptoon-activation.json');
  if (path === null || context.adapters === null) return null;
  const stat = await context.adapters.fs.stat(path);
  if (stat === null || stat.kind !== 'file') return null;
  const raw = await readJson(context, path);
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (
    row['schemaVersion'] !== MCPTOON_ACTIVATION_WITNESS_SCHEMA_VERSION ||
    row['benchmarkId'] !== benchmarkId ||
    typeof row['projectId'] !== 'string' ||
    row['variant'] !== 'optimized' ||
    (row['state'] !== 'verified' && row['state'] !== 'blocked' && row['state'] !== 'unknown') ||
    typeof row['reason'] !== 'string'
  ) {
    return null;
  }
  return row as unknown as McptoonActivationReceipt;
}
