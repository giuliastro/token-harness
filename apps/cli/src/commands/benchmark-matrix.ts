/**
 * `token-harness benchmark-matrix` — aggregate real paired benchmark receipts from local state.
 *
 * Read-only. It scans only Token Harness's benchmark state, filters to the current project and
 * optional harness/task class, and delegates every pair verdict to the same deterministic comparator
 * used by `token-harness benchmark`.
 */

import {
  EXIT_CODES,
  UNATTRIBUTED_PROJECT_ID,
  buildTaskBenchmarkMatrix,
  commandResult,
  diagnostic,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type CommandResult,
  type TaskBenchmarkCapture,
  type TaskBenchmarkMatrixPair,
  type TaskBenchmarkMatrixReport,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

async function readJson(context: CommandContext, path: string): Promise<unknown | null> {
  if (context.adapters === null) return null;
  const stat = await context.adapters.fs.stat(path);
  if (stat === null || stat.kind !== 'file') return null;
  try {
    return JSON.parse(new TextDecoder().decode(await context.adapters.fs.readFile(path))) as unknown;
  } catch {
    return null;
  }
}

function pairIsConsistent(input: {
  baseline: TaskBenchmarkReceipt;
  optimized: TaskBenchmarkReceipt;
  baselineCapture: TaskBenchmarkCapture;
  optimizedCapture: TaskBenchmarkCapture;
}): boolean {
  const { baseline, optimized, baselineCapture, optimizedCapture } = input;
  return (
    baseline.variant === 'baseline' &&
    optimized.variant === 'optimized' &&
    baselineCapture.variant === 'baseline' &&
    optimizedCapture.variant === 'optimized' &&
    baseline.benchmarkId === optimized.benchmarkId &&
    baseline.benchmarkId === baselineCapture.benchmarkId &&
    baseline.benchmarkId === optimizedCapture.benchmarkId &&
    baseline.taskClass === optimized.taskClass &&
    baseline.taskClass === baselineCapture.taskClass &&
    baseline.taskClass === optimizedCapture.taskClass &&
    baseline.harnessId === optimized.harnessId &&
    baseline.harnessId === baselineCapture.harnessId &&
    baseline.harnessId === optimizedCapture.harnessId &&
    baselineCapture.projectId === optimizedCapture.projectId
  );
}

export async function runBenchmarkMatrix(
  context: CommandContext,
): Promise<CommandResult<TaskBenchmarkMatrixReport | null>> {
  if (context.adapters === null || context.stateRoot === null) {
    return commandResult({
      command: 'benchmark-matrix',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-matrix-state-unavailable',
          message: 'Token Harness state storage is unavailable for benchmark matrix reporting',
          remediation: 'Run in a supported local environment with a resolved state directory',
        }),
      ],
    });
  }

  const projectId = context.adapters.projectIdFor(context.projectRoot);
  if (projectId === UNATTRIBUTED_PROJECT_ID) {
    return commandResult({
      command: 'benchmark-matrix',
      exitCode: EXIT_CODES['unsupported-environment'],
      data: null,
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'benchmark-matrix-project-unattributed',
          message: 'Benchmark matrix cannot identify the current project stably',
          remediation: 'Repair Token Harness state/project-id initialization before aggregating',
        }),
      ],
    });
  }

  const root = context.adapters.fs.join(context.stateRoot, 'benchmarks');
  const rootStat = await context.adapters.fs.stat(root);
  if (rootStat === null || rootStat.kind !== 'directory') {
    return commandResult({
      command: 'benchmark-matrix',
      exitCode: EXIT_CODES.ok,
      data: buildTaskBenchmarkMatrix([]),
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: 'benchmark-matrix-empty',
          message: 'No local benchmark state exists yet for this project',
          remediation: 'Capture baseline and optimized task variants with benchmark-start/finish',
        }),
      ],
    });
  }

  const selection = {
    scanned: 0,
    completePairs: 0,
    incomplete: 0,
    invalid: 0,
    otherProject: 0,
    filteredOut: 0,
  };
  const pairs: TaskBenchmarkMatrixPair[] = [];

  for (const name of (await context.adapters.fs.readDirectory(root)).sort()) {
    if (!isTaskBenchmarkId(name)) continue;
    const directory = context.adapters.fs.join(root, name);
    const stat = await context.adapters.fs.stat(directory);
    if (stat === null || stat.kind !== 'directory') continue;
    selection.scanned += 1;

    const baselineReceiptRaw = await readJson(
      context,
      context.adapters.fs.join(directory, 'baseline.json'),
    );
    const optimizedReceiptRaw = await readJson(
      context,
      context.adapters.fs.join(directory, 'optimized.json'),
    );
    const baselineCaptureRaw = await readJson(
      context,
      context.adapters.fs.join(directory, 'baseline.capture.json'),
    );
    const optimizedCaptureRaw = await readJson(
      context,
      context.adapters.fs.join(directory, 'optimized.capture.json'),
    );

    if (
      baselineReceiptRaw === null ||
      optimizedReceiptRaw === null ||
      baselineCaptureRaw === null ||
      optimizedCaptureRaw === null
    ) {
      selection.incomplete += 1;
      continue;
    }

    const baselineReceipt = parseTaskBenchmarkReceipt(baselineReceiptRaw);
    const optimizedReceipt = parseTaskBenchmarkReceipt(optimizedReceiptRaw);
    const baselineCapture = parseTaskBenchmarkCapture(baselineCaptureRaw);
    const optimizedCapture = parseTaskBenchmarkCapture(optimizedCaptureRaw);
    if (
      !baselineReceipt.ok ||
      !optimizedReceipt.ok ||
      !baselineCapture.ok ||
      !optimizedCapture.ok ||
      !pairIsConsistent({
        baseline: baselineReceipt.receipt,
        optimized: optimizedReceipt.receipt,
        baselineCapture: baselineCapture.capture,
        optimizedCapture: optimizedCapture.capture,
      })
    ) {
      selection.invalid += 1;
      continue;
    }

    if (baselineCapture.capture.projectId !== projectId) {
      selection.otherProject += 1;
      continue;
    }

    if (
      (context.harness !== null && baselineReceipt.receipt.harnessId !== context.harness) ||
      (context.taskClass !== null && baselineReceipt.receipt.taskClass !== context.taskClass)
    ) {
      selection.filteredOut += 1;
      continue;
    }

    pairs.push({
      baseline: baselineReceipt.receipt,
      optimized: optimizedReceipt.receipt,
    });
  }

  selection.completePairs = pairs.length;
  return commandResult({
    command: 'benchmark-matrix',
    exitCode: EXIT_CODES.ok,
    data: buildTaskBenchmarkMatrix(pairs, selection),
  });
}
