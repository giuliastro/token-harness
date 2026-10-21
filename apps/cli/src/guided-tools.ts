import { observeScheduleBudget } from './schedule-budget.js';
import { scheduleDispatchMain } from './schedule-dispatch-main.js';
import type { ScheduleRuntime } from './schedule-main.js';
import { observeScheduleQualityReceipts } from './schedule-quality.js';
import { observeScheduleTransferReceipts } from './schedule-transfer.js';
import { observeScheduleHandoffBytes } from './schedule-handoff.js';
import { handoffMain } from './handoff-main.js';
import { GuideError, type GuideCall } from './guided.js';

type Harness = 'claude' | 'codex';
type TaskClass = 'mechanical' | 'standard' | 'hard' | 'critical';
type Workload = Partial<Record<TaskClass, number>>;
type Envelope = Record<string, unknown>;
type Streams = { out(text: string): void; err(text: string): void };

export type GuideScheduleRunner = (
  argv: readonly string[],
  streams: Streams,
  runtime: ScheduleRuntime,
) => Promise<number>;

export interface GuideToolsOptions {
  call: GuideCall;
  cwd: string;
  /** Trusted test seam for the existing scheduler. Renderer input never selects a runner. */
  runSchedule?: GuideScheduleRunner;
}

const TASK_CLASSES: readonly TaskClass[] = ['mechanical', 'standard', 'hard', 'critical'];
const HANDOFF_LISTS = [
  'acceptance',
  'facts',
  'decisions',
  'changedFiles',
  'validation',
  'unresolved',
] as const;

function invalid(message: string): never {
  throw new GuideError(400, message);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    return invalid('Request must be an object.');
  return value as Record<string, unknown>;
}

function strictKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) invalid(`Unknown request field: ${unknown}.`);
}

function stringValue(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max)
    invalid(`${field} must be a non-empty string of at most ${max} characters.`);
  return value;
}

function integer(value: unknown, field: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  )
    invalid(`${field} must be an integer from ${minimum} to ${maximum}.`);
  return value;
}

function harness(value: unknown, field: string): Harness {
  if (value !== 'claude' && value !== 'codex') invalid(`${field} must be claude or codex.`);
  return value;
}

function parseEnvelope(text: string, mode: string): Envelope {
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('not an envelope object');
    const envelope = parsed as Record<string, unknown>;
    if (
      envelope['schemaVersion'] !== 1 ||
      envelope['command'] !== mode ||
      !Number.isInteger(envelope['exitCode']) ||
      !['ok', 'problems', 'blocked', 'error'].includes(String(envelope['status'])) ||
      !Array.isArray(envelope['diagnostics'])
    )
      throw new Error('incompatible envelope');
    return parsed as Envelope;
  } catch {
    throw new GuideError(500, `The ${mode} advisory did not return a valid JSON envelope.`);
  }
}

function createScheduleRuntime(cwd: string): ScheduleRuntime {
  return {
    observeBudget: () => observeScheduleBudget({ cwd }),
    observeQualityReceipts: () => observeScheduleQualityReceipts({ cwd }),
    observeTransferReceipts: () => observeScheduleTransferReceipts({ cwd }),
    measureHandoffBytes: (handoffFile) => observeScheduleHandoffBytes({ handoffFile }),
  };
}

function handoffArgs(input: Record<string, unknown>): string[] {
  const allowed = ['mode', 'objective', 'nextAction', ...HANDOFF_LISTS, 'maxBytes'];
  strictKeys(input, allowed);
  const objective = stringValue(input['objective'], 'objective', 2000);
  const nextAction = stringValue(input['nextAction'], 'nextAction', 2000);
  const maxBytes =
    input['maxBytes'] === undefined ? 2048 : integer(input['maxBytes'], 'maxBytes', 256, 16384);
  const args = [
    '--json',
    '--objective=' + objective,
    '--next-action=' + nextAction,
    '--max-bytes',
    String(maxBytes),
  ];
  const flags: Record<(typeof HANDOFF_LISTS)[number], string> = {
    acceptance: '--acceptance',
    facts: '--fact',
    decisions: '--decision',
    changedFiles: '--changed-file',
    validation: '--validation',
    unresolved: '--unresolved',
  };
  for (const field of HANDOFF_LISTS) {
    const items = input[field];
    if (items === undefined) continue;
    if (!Array.isArray(items) || items.length > 20)
      invalid(`${field} must be an array with at most 20 items.`);
    for (const item of items) args.push(flags[field] + '=' + stringValue(item, field, 1000));
  }
  return args;
}

export function createGuideTools(
  options: GuideToolsOptions,
): (input: unknown) => Promise<{ mode: string; envelope: Envelope }> {
  const runSchedule = options.runSchedule ?? scheduleDispatchMain;
  return async (rawInput) => {
    const input = record(rawInput);
    const mode = input['mode'];
    if (mode === 'plan') {
      strictKeys(input, ['mode', 'harness', 'task', 'profile', 'reserve', 'tasksLeft']);
      const selectedHarness = harness(input['harness'], 'harness');
      const task = input['task'];
      if (task !== 'mechanical' && task !== 'standard' && task !== 'hard' && task !== 'critical')
        invalid('task must be mechanical, standard, hard, or critical.');
      const profile = input['profile'];
      if (profile !== 'economy' && profile !== 'balanced' && profile !== 'quality')
        invalid('profile must be economy, balanced, or quality.');
      const reserve =
        input['reserve'] === undefined ? 20 : integer(input['reserve'], 'reserve', 0, 90);
      const args = [
        'optimize',
        '--harness',
        selectedHarness,
        '--task',
        task,
        '--profile',
        profile,
        '--reserve',
        String(reserve),
      ];
      if (input['tasksLeft'] !== undefined)
        args.push('--tasks-left', String(integer(input['tasksLeft'], 'tasksLeft', 1, 10000)));
      const envelope = await options.call<unknown>(args);
      return { mode, envelope: envelope as unknown as Envelope };
    }

    if (mode === 'schedule') {
      strictKeys(input, ['mode', 'current', 'candidate', 'workload']);
      const current = harness(input['current'], 'current');
      const candidate = harness(input['candidate'], 'candidate');
      if (current === candidate) invalid('current and candidate must name different harnesses.');
      const workload = record(input['workload']) as Workload;
      const workloadKeys = Object.keys(workload);
      if (workloadKeys.length < 1 || workloadKeys.length > 4)
        invalid('workload must contain 1 to 4 task classes.');
      let total = 0;
      const entries: string[] = [];
      for (const key of TASK_CLASSES) {
        if (!Object.hasOwn(workload, key)) continue;
        const count = integer(workload[key], `workload.${key}`, 0, 10000);
        total += count;
        if (total > 10000) invalid('workload total must not exceed 10000.');
        if (count > 0) entries.push(`${key}=${count}`);
      }
      if (workloadKeys.some((key) => !TASK_CLASSES.includes(key as TaskClass)))
        invalid('workload contains an unsupported task class.');
      if (total === 0) invalid('workload must request at least one task.');
      const args = [
        '--current',
        current,
        '--candidate',
        candidate,
        '--workload',
        entries.join(','),
        '--json',
      ];
      let stdout = '';
      const streams: Streams = {
        out: (text) => {
          stdout += text;
        },
        err: () => {},
      };
      await runSchedule(args, streams, createScheduleRuntime(options.cwd));
      const envelope = parseEnvelope(stdout, 'schedule');
      return { mode, envelope };
    }

    if (mode === 'handoff') {
      const args = handoffArgs(input);
      let stdout = '';
      await handoffMain(args, {
        out: (text) => {
          stdout += text;
        },
        err: () => {},
      });
      return { mode, envelope: parseEnvelope(stdout, 'handoff') };
    }

    invalid('mode must be plan, schedule, or handoff.');
  };
}
