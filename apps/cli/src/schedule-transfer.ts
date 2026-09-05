import {
  deriveProjectId,
  isTaskBenchmarkId,
  parseCrossHarnessTransferReceipt,
  type CrossHarnessTransferReceipt,
  type FileSystemPort,
} from '@token-harness/core';
import {
  NodeFileSystem,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';

export interface ScheduleTransferObserverInput {
  cwd: string;
}

type ReceiptFileSystem = Pick<FileSystemPort, 'join' | 'stat' | 'readFile' | 'readDirectory'>;

export interface ProjectTransferReceiptReaderInput {
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

/**
 * Read immutable transfer receipts attributable to one local project.
 *
 * The directory name must match the receipt benchmark id. Malformed, misplaced, foreign-project,
 * or future-schema receipts are ignored rather than promoted into scheduler evidence.
 */
export async function readProjectTransferReceipts(
  input: ProjectTransferReceiptReaderInput,
): Promise<CrossHarnessTransferReceipt[]> {
  const root = input.fs.join(input.stateRoot, 'benchmarks');
  const rootStat = await input.fs.stat(root);
  if (rootStat === null || rootStat.kind !== 'directory') return [];

  const receipts: CrossHarnessTransferReceipt[] = [];
  for (const benchmarkId of (await input.fs.readDirectory(root)).sort()) {
    if (!isTaskBenchmarkId(benchmarkId)) continue;
    const directory = input.fs.join(root, benchmarkId);
    const stat = await input.fs.stat(directory);
    if (stat === null || stat.kind !== 'directory') continue;

    const raw = await readJson(input.fs, input.fs.join(directory, 'transfer.json'));
    if (raw === null) continue;
    const parsed = parseCrossHarnessTransferReceipt(raw);
    if (!parsed.ok) continue;
    if (parsed.receipt.projectId !== input.projectId) continue;
    if (parsed.receipt.benchmarkId !== benchmarkId) continue;
    receipts.push(parsed.receipt);
  }

  return receipts;
}

/** Resolve host/project attribution and expose only receipts belonging to `cwd`. */
export async function observeScheduleTransferReceipts(
  input: ScheduleTransferObserverInput,
): Promise<CrossHarnessTransferReceipt[] | null> {
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
  return readProjectTransferReceipts({
    fs,
    stateRoot: resolution.environment.paths.state,
    projectId,
  });
}
