/** Fixed, project-scoped manual comparison steps; never accepts commands or paths. */
import {
  digestText,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  readMutationLease,
  type FileSystemPort,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

export type GuideComparisonStep = 'finish-baseline' | 'start-optimized' | 'finish-optimized';
export interface GuideComparison {
  key: string;
  harness: 'claude' | 'codex';
  task: 'mechanical' | 'standard' | 'hard' | 'critical';
  startedAt: string;
  next: GuideComparisonStep | null;
  state: 'baseline-running' | 'optimized-ready' | 'optimized-running' | 'complete' | 'invalid';
  baselineQuality: string | null;
  optimizedQuality: string | null;
}
export interface GuideComparisons {
  available: boolean;
  blocked: boolean;
  items: GuideComparison[];
  note: string;
}
export interface GuideComparisonObservation {
  report: GuideComparisons;
  records: Array<{ item: GuideComparison; fingerprint: string }>;
}
export type GuideComparisonReader = () => Promise<GuideComparisonObservation>;
export interface GuideComparisonRequest {
  action: 'comparison-new' | 'comparison-step';
  harness?: GuideComparison['harness'];
  task?: GuideComparison['task'];
  key?: string;
  expected?: GuideComparisonStep;
  acknowledged?: boolean;
  quality?: 'passed' | 'failed';
  attempts?: number;
  failedAttempts?: number;
}
export interface GuideComparisonApproval {
  id: string;
  fingerprint: string | null;
  args: string[];
  resultState: GuideComparison['state'];
  quality: 'passed' | 'failed' | null;
}

const PREFIX = 'guided-pair-';
const TASKS = new Set(['mechanical', 'standard', 'hard', 'critical']);
const STEPS = new Set(['finish-baseline', 'start-optimized', 'finish-optimized']);
export function parseGuideComparisonRequest(value: unknown): GuideComparisonRequest | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row['action'] === 'comparison-new') {
    if (
      Object.keys(row).some((key) => !['action', 'harness', 'task'].includes(key)) ||
      typeof row['harness'] !== 'string' ||
      !['claude', 'codex'].includes(row['harness']) ||
      typeof row['task'] !== 'string' ||
      !TASKS.has(row['task'])
    )
      return null;
    return row as unknown as GuideComparisonRequest;
  }
  if (
    row['action'] !== 'comparison-step' ||
    Object.keys(row).some(
      (key) =>
        ![
          'action',
          'key',
          'expected',
          'acknowledged',
          'quality',
          'attempts',
          'failedAttempts',
        ].includes(key),
    ) ||
    typeof row['key'] !== 'string' ||
    !row['key'].startsWith(PREFIX) ||
    !isTaskBenchmarkId(row['key']) ||
    typeof row['expected'] !== 'string' ||
    !STEPS.has(row['expected'])
  )
    return null;
  if (row['expected'] === 'start-optimized') {
    if (
      row['acknowledged'] !== true ||
      ['quality', 'attempts', 'failedAttempts'].some((key) => row[key] !== undefined)
    )
      return null;
  } else {
    const attempts = row['attempts'] as number,
      failed = row['failedAttempts'] as number;
    if (
      row['acknowledged'] !== undefined ||
      typeof row['quality'] !== 'string' ||
      !['passed', 'failed'].includes(row['quality']) ||
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      !Number.isSafeInteger(failed) ||
      failed < 0 ||
      failed > attempts ||
      (row['quality'] === 'passed' && failed === attempts)
    )
      return null;
  }
  return row as unknown as GuideComparisonRequest;
}

export function unavailableGuideComparisons(): GuideComparisonObservation {
  return {
    report: {
      available: false,
      blocked: true,
      items: [],
      note: 'Comparison state is unavailable. Keep retained evidence and refresh before recording a step.',
    },
    records: [],
  };
}

function receiptMatches(receipt: TaskBenchmarkReceipt, capture: TaskBenchmarkCapture): boolean {
  return (
    receipt.benchmarkId === capture.benchmarkId &&
    receipt.variant === capture.variant &&
    receipt.harnessId === capture.harnessId &&
    receipt.taskClass === capture.taskClass &&
    receipt.startedAt === capture.startedAt &&
    receipt.model === capture.model &&
    receipt.reasoningEffort === capture.reasoningEffort &&
    receipt.verbosity === capture.verbosity &&
    receipt.experiment === undefined &&
    (receipt.outcome.qualityEvidence === undefined ||
      receipt.outcome.qualityEvidence.source === 'user-recorded')
  );
}

export function createGuideComparisonReader(input: {
  fs: FileSystemPort | null;
  stateRoot: string | null;
  projectId: string | null;
}): GuideComparisonReader {
  return async () => {
    if (
      input.fs === null ||
      input.stateRoot === null ||
      input.projectId === null ||
      input.projectId === 'p_unattributed'
    )
      return unavailableGuideComparisons();
    const fs = input.fs,
      root = fs.join(input.stateRoot, 'benchmarks');
    try {
      const lease = await readMutationLease(fs, input.stateRoot);
      const records: GuideComparisonObservation['records'] = [];
      for (const key of await fs.readDirectory(root)) {
        if (!key.startsWith(PREFIX) || !isTaskBenchmarkId(key)) continue;
        const directory = fs.join(root, key);
        if ((await fs.stat(directory))?.kind !== 'directory') continue;
        const read = async (name: string): Promise<unknown> => {
          const path = fs.join(directory, name),
            stat = await fs.stat(path);
          if (stat === null) return null;
          if (stat.kind !== 'file' || stat.byteLength > 16 * 1024 * 1024)
            throw new Error('Invalid capture size');
          return JSON.parse(new TextDecoder().decode(await fs.readFile(path))) as unknown;
        };
        try {
          const raw = await Promise.all(
            [
              'baseline.capture.json',
              'baseline.json',
              'optimized.capture.json',
              'optimized.json',
            ].map(read),
          );
          const baseline = parseTaskBenchmarkCapture(raw[0]);
          if (
            !baseline.ok ||
            baseline.capture.projectId !== input.projectId ||
            baseline.capture.benchmarkId !== key ||
            baseline.capture.variant !== 'baseline' ||
            baseline.capture.experiment !== undefined ||
            baseline.capture.qualityCheck !== undefined ||
            !['claude', 'codex'].includes(baseline.capture.harnessId)
          )
            continue;
          const b = parseTaskBenchmarkReceipt(raw[1]),
            o = parseTaskBenchmarkCapture(raw[2]),
            r = parseTaskBenchmarkReceipt(raw[3]);
          const validB = b.ok && receiptMatches(b.receipt, baseline.capture);
          const validO =
            o.ok &&
            o.capture.projectId === input.projectId &&
            o.capture.benchmarkId === key &&
            o.capture.variant === 'optimized' &&
            o.capture.harnessId === baseline.capture.harnessId &&
            o.capture.taskClass === baseline.capture.taskClass &&
            o.capture.experiment === undefined &&
            o.capture.qualityCheck === undefined;
          const validR = r.ok && o.ok && receiptMatches(r.receipt, o.capture);
          const invalid =
            (raw[1] !== null && !validB) ||
            (raw[2] !== null && (!validO || !validB)) ||
            (raw[3] !== null && (!validR || !validO || !validB));
          const state = invalid
            ? 'invalid'
            : validR
              ? 'complete'
              : validO
                ? 'optimized-running'
                : validB
                  ? 'optimized-ready'
                  : 'baseline-running';
          const item: GuideComparison = {
            key,
            harness: baseline.capture.harnessId as GuideComparison['harness'],
            task: baseline.capture.taskClass,
            startedAt: baseline.capture.startedAt,
            state,
            next:
              state === 'baseline-running'
                ? 'finish-baseline'
                : state === 'optimized-ready'
                  ? 'start-optimized'
                  : state === 'optimized-running'
                    ? 'finish-optimized'
                    : null,
            baselineQuality: validB && b.ok ? b.receipt.outcome.qualityGate : null,
            optimizedQuality: validR && r.ok ? r.receipt.outcome.qualityGate : null,
          };
          records.push({ item, fingerprint: digestText(JSON.stringify(raw)) });
        } catch {
          /* Corrupt evidence is retained; it never becomes an actionable pair. */
        }
      }
      records.sort((a, b) => b.item.startedAt.localeCompare(a.item.startedAt));
      const visible = records.slice(0, 20);
      return {
        report: {
          available: true,
          blocked: lease !== null,
          items: visible.map((record) => record.item),
          note:
            lease !== null
              ? 'A prepared benchmark holds temporary configuration. Finish or restore it through its existing workflow first.'
              : 'Latest 20 comparisons created in this app for the current project. Checks are user-recorded. Run one task at a time and avoid other account consumption; completion alone does not prove attributable savings.',
        },
        records: visible,
      };
    } catch {
      return unavailableGuideComparisons();
    }
  };
}

export function newGuideComparisonId(random: string): string {
  const id = PREFIX + random.slice(0, 32);
  if (!isTaskBenchmarkId(id)) throw new Error('Invalid generated comparison identity');
  return id;
}
