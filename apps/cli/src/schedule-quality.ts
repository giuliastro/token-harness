import {
  deriveProjectId,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type FileSystemPort,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';
import {
  NodeFileSystem,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';

export interface ScheduleQualityObserverInput {
  cwd: string;
}

type ReceiptFileSystem = Pick<FileSystemPort, 'join' | 'stat' | 'readFile' | 'readDirectory'>;

export interface ProjectBenchmarkReceiptReaderInput {
  fs: ReceiptFileSystem;
  stateRoot: string;
  projectId: string;
}

async function readJson(fs: ReceiptFileSystem, path: string): Promise<unknown | null> {
  const stat = await fs.stat(path);
  if (stat === null || stat.kind !== 'file') return null;
  try {
    return JSON.parse(new TextDecoder().decode(await fs.readFile(path))) as unknown;
  } catch {
    return null;
  }
}

function receiptMatchesCapture(
  receipt: TaskBenchmarkReceipt,
  capture: ReturnType<typeof parseTaskBenchmarkCapture> & { ok: true },
): boolean {
  return (
    receipt.benchmarkId === capture.capture.benchmarkId &&
    receipt.variant === capture.capture.variant &&
    receipt.taskClass === capture.capture.taskClass &&
    receipt.harnessId === capture.capture.harnessId
  );
}

/**
 * Read individually attributable benchmark receipts for one local project.
 *
 * A receipt is admitted only when its sibling capture parses, names the same benchmark variant,
 * harness and task class, and carries the requested project id. Baseline and optimized variants are
 * independent observations here; a complete pair is not required because scheduler quality uses
 * the explicit quality gate, never the efficiency comparison between variants.
 */
export async function readProjectBenchmarkReceipts(
  input: ProjectBenchmarkReceiptReaderInput,
): Promise<TaskBenchmarkReceipt[]> {
  const root = input.fs.join(input.stateRoot, 'benchmarks');
  const rootStat = await input.fs.stat(root);
  if (rootStat === null || rootStat.kind !== 'directory') return [];

  const receipts: TaskBenchmarkReceipt[] = [];
  for (const benchmarkId of (await input.fs.readDirectory(root)).sort()) {
    if (!isTaskBenchmarkId(benchmarkId)) continue;
    const directory = input.fs.join(root, benchmarkId);
    const stat = await input.fs.stat(directory);
    if (stat === null || stat.kind !== 'directory') continue;

    for (const variant of ['baseline', 'optimized'] as const) {
      const receiptRaw = await readJson(input.fs, input.fs.join(directory, `${variant}.json`));
      const captureRaw = await readJson(
        input.fs,
        input.fs.join(directory, `${variant}.capture.json`),
      );
      if (receiptRaw === null || captureRaw === null) continue;

      const receipt = parseTaskBenchmarkReceipt(receiptRaw);
      const capture = parseTaskBenchmarkCapture(captureRaw);
      if (!receipt.ok || !capture.ok) continue;
      if (capture.capture.projectId !== input.projectId) continue;
      if (!receiptMatchesCapture(receipt.receipt, capture)) continue;
      receipts.push(receipt.receipt);
    }
  }

  return receipts;
}

/**
 * Resolve the local host and return only quality-gated receipt material attributable to `cwd`.
 * Null means the host/project attribution could not be established safely; an empty array means it
 * was established and this project simply has no admissible benchmark receipts yet.
 */
export async function observeScheduleQualityReceipts(
  input: ScheduleQualityObserverInput,
): Promise<TaskBenchmarkReceipt[] | null> {
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) return null;

  const fs = new NodeFileSystem(resolution.environment.facts);
  const attribution = await resolveAttributionSalt(fs, resolution.environment.paths.state);
  if (attribution.salt === null) return null;

  const projectId = deriveProjectId(
    input.cwd,
    attribution.salt,
    resolution.environment.facts.os === 'windows',
  );
  return readProjectBenchmarkReceipts({
    fs,
    stateRoot: resolution.environment.paths.state,
    projectId,
  });
}
