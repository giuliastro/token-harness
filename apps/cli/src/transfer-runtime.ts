import {
  deriveProjectId,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type FileSystemPort,
  type TaskBenchmarkCapture,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';
import {
  NodeFileSystem,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';

type TransferFileSystem = Pick<FileSystemPort, 'join' | 'stat' | 'readFile'>;

export type TransferObservationStatus =
  | 'observed'
  | 'not-found'
  | 'invalid'
  | 'other-project'
  | 'handoff-missing'
  | 'unavailable';

export interface ObservedTransferExperiment {
  stay: TaskBenchmarkReceipt;
  switched: TaskBenchmarkReceipt;
  handoffBytes: number;
}

export interface TransferObservation {
  status: TransferObservationStatus;
  experiment: ObservedTransferExperiment | null;
  reason: string | null;
}

export interface ProjectTransferReaderInput {
  fs: TransferFileSystem;
  stateRoot: string;
  projectId: string;
  benchmarkId: string;
  handoffFile: string;
}

async function readJson(fs: TransferFileSystem, path: string): Promise<unknown | null> {
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
  capture: TaskBenchmarkCapture,
  variant: 'baseline' | 'optimized',
): boolean {
  return (
    receipt.benchmarkId === capture.benchmarkId &&
    receipt.variant === variant &&
    capture.variant === variant &&
    receipt.taskClass === capture.taskClass &&
    receipt.harnessId === capture.harnessId
  );
}

/**
 * Read one explicit baseline=stay / optimized=switch experiment from normal benchmark state.
 *
 * The pair is admitted only when both receipts and captures are valid, both captures belong to the
 * requested local project, task identity matches, and the two harnesses differ. No benchmark-matrix
 * efficiency verdict is consulted: transfer benefit has its own conservative comparator.
 */
export async function readProjectTransferExperiment(
  input: ProjectTransferReaderInput,
): Promise<TransferObservation> {
  if (!isTaskBenchmarkId(input.benchmarkId)) {
    return { status: 'invalid', experiment: null, reason: 'benchmark id is invalid' };
  }

  const directory = input.fs.join(input.stateRoot, 'benchmarks', input.benchmarkId);
  const directoryStat = await input.fs.stat(directory);
  if (directoryStat === null || directoryStat.kind !== 'directory') {
    return { status: 'not-found', experiment: null, reason: 'benchmark experiment was not found' };
  }

  const [baselineReceiptRaw, optimizedReceiptRaw, baselineCaptureRaw, optimizedCaptureRaw] =
    await Promise.all([
      readJson(input.fs, input.fs.join(directory, 'baseline.json')),
      readJson(input.fs, input.fs.join(directory, 'optimized.json')),
      readJson(input.fs, input.fs.join(directory, 'baseline.capture.json')),
      readJson(input.fs, input.fs.join(directory, 'optimized.capture.json')),
    ]);
  if (
    baselineReceiptRaw === null ||
    optimizedReceiptRaw === null ||
    baselineCaptureRaw === null ||
    optimizedCaptureRaw === null
  ) {
    return {
      status: 'not-found',
      experiment: null,
      reason: 'a complete baseline/optimized receipt and capture pair is required',
    };
  }

  const baselineReceipt = parseTaskBenchmarkReceipt(baselineReceiptRaw);
  const optimizedReceipt = parseTaskBenchmarkReceipt(optimizedReceiptRaw);
  const baselineCapture = parseTaskBenchmarkCapture(baselineCaptureRaw);
  const optimizedCapture = parseTaskBenchmarkCapture(optimizedCaptureRaw);
  if (!baselineReceipt.ok || !optimizedReceipt.ok || !baselineCapture.ok || !optimizedCapture.ok) {
    return {
      status: 'invalid',
      experiment: null,
      reason: 'benchmark receipt or capture is invalid',
    };
  }

  if (
    !receiptMatchesCapture(baselineReceipt.receipt, baselineCapture.capture, 'baseline') ||
    !receiptMatchesCapture(optimizedReceipt.receipt, optimizedCapture.capture, 'optimized') ||
    baselineReceipt.receipt.benchmarkId !== input.benchmarkId ||
    optimizedReceipt.receipt.benchmarkId !== input.benchmarkId ||
    baselineReceipt.receipt.taskClass !== optimizedReceipt.receipt.taskClass
  ) {
    return {
      status: 'invalid',
      experiment: null,
      reason: 'benchmark pair identity, task class, or receipt/capture lineage does not match',
    };
  }

  if (
    baselineCapture.capture.projectId !== input.projectId ||
    optimizedCapture.capture.projectId !== input.projectId
  ) {
    return {
      status: 'other-project',
      experiment: null,
      reason: 'benchmark pair belongs to a different local project',
    };
  }

  if (baselineReceipt.receipt.harnessId === optimizedReceipt.receipt.harnessId) {
    return {
      status: 'invalid',
      experiment: null,
      reason: 'transfer experiment requires different baseline and optimized harnesses',
    };
  }

  const handoffStat = await input.fs.stat(input.handoffFile);
  if (handoffStat === null || handoffStat.kind !== 'file') {
    return { status: 'handoff-missing', experiment: null, reason: 'handoff file was not found' };
  }

  let handoffBytes: number;
  try {
    handoffBytes = (await input.fs.readFile(input.handoffFile)).byteLength;
  } catch {
    return {
      status: 'handoff-missing',
      experiment: null,
      reason: 'handoff file could not be read',
    };
  }

  return {
    status: 'observed',
    experiment: {
      stay: baselineReceipt.receipt,
      switched: optimizedReceipt.receipt,
      handoffBytes,
    },
    reason: null,
  };
}

export async function observeProjectTransferExperiment(input: {
  cwd: string;
  benchmarkId: string;
  handoffFile: string;
}): Promise<TransferObservation> {
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) {
    return { status: 'unavailable', experiment: null, reason: 'local host state is unavailable' };
  }

  const fs = new NodeFileSystem(resolution.environment.facts);
  const attribution = await resolveAttributionSalt(fs, resolution.environment.paths.state);
  if (attribution.salt === null) {
    return {
      status: 'unavailable',
      experiment: null,
      reason: 'project attribution could not be established',
    };
  }

  const projectId = deriveProjectId(
    input.cwd,
    attribution.salt,
    resolution.environment.facts.os === 'windows',
  );
  return readProjectTransferExperiment({
    fs,
    stateRoot: resolution.environment.paths.state,
    projectId,
    benchmarkId: input.benchmarkId,
    handoffFile: input.handoffFile,
  });
}
