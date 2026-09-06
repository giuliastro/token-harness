/** Bounded read-only evidence for the current project. No filesystem/global environment access. */
import {
  UNATTRIBUTED_PROJECT_ID,
  isTaskBenchmarkId,
  parseTaskBenchmarkCapture,
  parseTaskBenchmarkReceipt,
  type TaskBenchmarkReceipt,
} from '@token-harness/core';
import type { CommandContext } from './context.js';

export const OPTIMIZATION_HISTORY_MAX_BENCHMARKS = 200;
export const OPTIMIZATION_HISTORY_MAX_FILE_BYTES = 512 * 1024;
export const OPTIMIZATION_HISTORY_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export interface OptimizationHistory {
  state: 'available' | 'unavailable' | 'limited';
  receipts: TaskBenchmarkReceipt[] | null;
  scannedBenchmarks: number;
}

/**
 * A potentially adverse corrupt/partial read disables learning for this scan, not just one row.
 * In-progress captures without completed receipts are normal. Completed orphan receipts are not.
 */
export async function readOptimizationHistory(
  context: CommandContext,
): Promise<OptimizationHistory> {
  const result: OptimizationHistory = {
    state: 'unavailable',
    receipts: null,
    scannedBenchmarks: 0,
  };
  if (context.adapters === null || context.stateRoot === null) return result;
  const fs = context.adapters.fs;
  let bytesRead = 0;
  let limited = false;
  const read = async (path: string): Promise<unknown> => {
    const stat = await fs.stat(path);
    if (
      stat === null ||
      stat.kind !== 'file' ||
      !Number.isSafeInteger(stat.byteLength) ||
      stat.byteLength < 0
    )
      throw new Error('unreadable evidence');
    if (
      stat.byteLength > OPTIMIZATION_HISTORY_MAX_FILE_BYTES ||
      bytesRead + stat.byteLength > OPTIMIZATION_HISTORY_MAX_TOTAL_BYTES
    ) {
      limited = true;
      throw new Error('evidence bound');
    }
    const bytes = await fs.readFile(path);
    bytesRead += bytes.byteLength;
    if (
      bytes.byteLength > OPTIMIZATION_HISTORY_MAX_FILE_BYTES ||
      bytesRead > OPTIMIZATION_HISTORY_MAX_TOTAL_BYTES
    ) {
      limited = true;
      throw new Error('evidence bound');
    }
    if (bytes.byteLength !== stat.byteLength) throw new Error('changing evidence');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  };
  try {
    const project = context.adapters.projectIdFor(context.projectRoot);
    if (project === UNATTRIBUTED_PROJECT_ID || project === '') return result;
    const root = fs.join(context.stateRoot, 'benchmarks');
    const rootStat = await fs.stat(root);
    if (rootStat === null) return { ...result, state: 'available', receipts: [] };
    if (rootStat.kind !== 'directory') return result;
    const names = (await fs.readDirectory(root)).filter(isTaskBenchmarkId).sort();
    if (names.length > OPTIMIZATION_HISTORY_MAX_BENCHMARKS) return { ...result, state: 'limited' };
    const receipts: TaskBenchmarkReceipt[] = [];
    for (const name of names) {
      const directory = fs.join(root, name);
      const stat = await fs.stat(directory);
      if (stat === null || stat.kind !== 'directory') continue;
      result.scannedBenchmarks += 1;
      for (const variant of ['baseline', 'optimized'] as const) {
        const receiptPath = fs.join(directory, `${variant}.json`);
        if ((await fs.stat(receiptPath)) === null) continue;
        const capture = parseTaskBenchmarkCapture(
          await read(fs.join(directory, `${variant}.capture.json`)),
        );
        if (!capture.ok) return result;
        if (capture.capture.projectId !== project) continue;
        const receipt = parseTaskBenchmarkReceipt(await read(receiptPath));
        if (!receipt.ok) return result;
        const start = capture.capture;
        const end = receipt.receipt;
        if (
          start.benchmarkId !== name ||
          end.benchmarkId !== name ||
          start.variant !== variant ||
          end.variant !== variant ||
          start.harnessId !== end.harnessId ||
          start.taskClass !== end.taskClass ||
          start.model !== end.model ||
          start.reasoningEffort !== end.reasoningEffort ||
          start.verbosity !== end.verbosity ||
          start.startedAt !== end.startedAt ||
          JSON.stringify(start.usageBefore) !== JSON.stringify(end.usageBefore)
        )
          return result;
        receipts.push(end);
      }
    }
    return { ...result, state: 'available', receipts };
  } catch {
    // Never expose exception messages, state paths, or partially read evidence to the policy.
    return { ...result, state: limited ? 'limited' : 'unavailable' };
  }
}
