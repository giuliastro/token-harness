/** Cooperative cross-process exclusion for a temporary, explicitly approved mutation. */
import { diagnostic, type Diagnostic } from '../domain/diagnostics.js';
import type { FileSystemPort } from './filesystem.js';
import { isTaskBenchmarkId } from '../domain/benchmark.js';
import { FACTORIAL_BENCHMARK_ARMS } from '../domain/benchmark-quality.js';

export interface MutationLease {
  schemaVersion: 1;
  transactionId: string;
  benchmarkId: string;
  variant: string;
  projectId: string;
  acquiredAt: string;
}
export const MUTATION_LEASE_FILENAME = 'mutation-lease.json';
export async function readMutationLease(
  fs: FileSystemPort,
  stateRoot: string,
): Promise<MutationLease | null> {
  const path = fs.join(stateRoot, MUTATION_LEASE_FILENAME);
  const stat = await fs.stat(path);
  if (stat === null) return null;
  if (stat.kind !== 'file' || stat.byteLength > 4096)
    throw new Error('Mutation lease exceeds size limit');
  const value = JSON.parse(
    new TextDecoder().decode(await fs.readFile(path)),
  ) as Partial<MutationLease> | null;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    typeof value.transactionId !== 'string' ||
    !/^factorial-[a-f0-9]{24}$/.test(value.transactionId) ||
    typeof value.benchmarkId !== 'string' ||
    !isTaskBenchmarkId(value.benchmarkId) ||
    typeof value.variant !== 'string' ||
    !(FACTORIAL_BENCHMARK_ARMS as readonly string[]).includes(value.variant) ||
    typeof value.projectId !== 'string' ||
    value.projectId.length === 0 ||
    value.projectId.length > 256 ||
    typeof value.acquiredAt !== 'string' ||
    !Number.isFinite(Date.parse(value.acquiredAt))
  )
    throw new Error('Mutation lease is malformed; preserve its checkpoint and backups');
  return value as MutationLease;
}
export async function mutationLeaseDiagnostics(
  fs: FileSystemPort,
  stateRoot: string,
  transactionId: string,
  allowMatchingTransaction = true,
): Promise<Diagnostic[]> {
  try {
    const lease = await readMutationLease(fs, stateRoot);
    if (lease === null || (allowMatchingTransaction && lease.transactionId === transactionId))
      return [];
    return [
      diagnostic({
        severity: 'error',
        code: 'temporary-configuration-active',
        message: `Benchmark ${lease.benchmarkId} / ${lease.variant} holds the configuration lease`,
        remediation: `Finish that arm or run benchmark-restore --benchmark-id ${lease.benchmarkId} --variant ${lease.variant} --yes`,
      }),
    ];
  } catch {
    return [
      diagnostic({
        severity: 'error',
        code: 'mutation-lease-unreadable',
        message: 'A configuration lease exists but cannot be read safely',
        path: fs.join(stateRoot, MUTATION_LEASE_FILENAME),
        remediation:
          'Inspect the retained lease and benchmark checkpoint; do not overwrite configuration',
      }),
    ];
  }
}
