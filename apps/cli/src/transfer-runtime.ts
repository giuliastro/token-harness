import {
  assessCrossHarnessTransferBenefit,
  buildCrossHarnessTransferReceipt,
  deriveProjectId,
  digestBytes,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type CrossHarnessTransferReceipt,
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
type TransferWritableFileSystem = Pick<FileSystemPort, 'join' | 'stat' | 'readFile' | 'writeFile'>;

export type TransferObservationStatus =
  | 'observed'
  | 'not-found'
  | 'invalid'
  | 'other-project'
  | 'handoff-missing'
  | 'unavailable';

export interface ObservedTransferExperiment {
  projectId: string;
  stay: TaskBenchmarkReceipt;
  switched: TaskBenchmarkReceipt;
  handoffBytes: number;
  handoffDigest: string;
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

export type TransferRecordStatus =
  | 'recorded'
  | 'exists'
  | Exclude<TransferObservationStatus, 'observed'>
  | 'write-failed';

export interface TransferRecordResult {
  status: TransferRecordStatus;
  receipt: CrossHarnessTransferReceipt | null;
  receiptPath: string | null;
  reason: string | null;
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

  let handoff: Uint8Array;
  try {
    handoff = await input.fs.readFile(input.handoffFile);
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
      projectId: input.projectId,
      stay: baselineReceipt.receipt,
      switched: optimizedReceipt.receipt,
      handoffBytes: handoff.byteLength,
      handoffDigest: digestBytes(handoff),
    },
    reason: null,
  };
}

/**
 * Persist one transfer assessment beside its paired benchmark state.
 *
 * The receipt is immutable: an existing `transfer.json` is never overwritten. The exact handoff
 * content is represented by SHA-256 plus byte length; no raw project path or conversation content is
 * copied into Token Harness state.
 */
export async function recordProjectTransferEvidence(input: {
  fs: TransferWritableFileSystem;
  stateRoot: string;
  projectId: string;
  benchmarkId: string;
  handoffFile: string;
  maxHandoffBytes: number;
  recordedAt: string;
}): Promise<TransferRecordResult> {
  const observation = await readProjectTransferExperiment(input);
  if (observation.status !== 'observed' || observation.experiment === null) {
    return {
      status: observation.status,
      receipt: null,
      receiptPath: null,
      reason: observation.reason,
    };
  }

  const receiptPath = input.fs.join(
    input.stateRoot,
    'benchmarks',
    input.benchmarkId,
    'transfer.json',
  );
  if ((await input.fs.stat(receiptPath)) !== null) {
    return {
      status: 'exists',
      receipt: null,
      receiptPath,
      reason: 'transfer evidence receipt already exists and is immutable',
    };
  }

  const experiment = observation.experiment;
  const assessment = assessCrossHarnessTransferBenefit({
    stay: experiment.stay,
    switched: experiment.switched,
    handoffBytes: experiment.handoffBytes,
    maxHandoffBytes: input.maxHandoffBytes,
  });
  const receipt = buildCrossHarnessTransferReceipt({
    projectId: experiment.projectId,
    handoffDigest: experiment.handoffDigest,
    recordedAt: input.recordedAt,
    assessment,
    taskClass: experiment.stay.taskClass,
  });

  try {
    await input.fs.writeFile(
      receiptPath,
      new TextEncoder().encode(`${JSON.stringify(receipt, null, 2)}\n`),
    );
  } catch {
    return {
      status: 'write-failed',
      receipt: null,
      receiptPath,
      reason: 'transfer evidence receipt could not be written',
    };
  }

  return { status: 'recorded', receipt, receiptPath, reason: null };
}

async function resolveLocalTransferContext(cwd: string): Promise<
  | {
      ok: true;
      fs: NodeFileSystem;
      stateRoot: string;
      projectId: string;
    }
  | { ok: false; reason: string }
> {
  const resolution = resolveHostEnvironment();
  if (!resolution.ok) return { ok: false, reason: 'local host state is unavailable' };

  const fs = new NodeFileSystem(resolution.environment.facts);
  const attribution = await resolveAttributionSalt(fs, resolution.environment.paths.state);
  if (attribution.salt === null) {
    return { ok: false, reason: 'project attribution could not be established' };
  }

  const projectId = deriveProjectId(
    cwd,
    attribution.salt,
    resolution.environment.facts.os === 'windows',
  );
  return {
    ok: true,
    fs,
    stateRoot: resolution.environment.paths.state,
    projectId,
  };
}

export async function observeProjectTransferExperiment(input: {
  cwd: string;
  benchmarkId: string;
  handoffFile: string;
}): Promise<TransferObservation> {
  const local = await resolveLocalTransferContext(input.cwd);
  if (!local.ok) return { status: 'unavailable', experiment: null, reason: local.reason };

  return readProjectTransferExperiment({
    fs: local.fs,
    stateRoot: local.stateRoot,
    projectId: local.projectId,
    benchmarkId: input.benchmarkId,
    handoffFile: input.handoffFile,
  });
}

export async function recordObservedProjectTransferEvidence(input: {
  cwd: string;
  benchmarkId: string;
  handoffFile: string;
  maxHandoffBytes: number;
  recordedAt: string;
}): Promise<TransferRecordResult> {
  const local = await resolveLocalTransferContext(input.cwd);
  if (!local.ok) {
    return { status: 'unavailable', receipt: null, receiptPath: null, reason: local.reason };
  }
  return recordProjectTransferEvidence({
    fs: local.fs,
    stateRoot: local.stateRoot,
    projectId: local.projectId,
    benchmarkId: input.benchmarkId,
    handoffFile: input.handoffFile,
    maxHandoffBytes: input.maxHandoffBytes,
    recordedAt: input.recordedAt,
  });
}
