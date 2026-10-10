/** Private lease/checkpoint projection; no configuration or restore paths leave the server. */
import {
  digestText,
  readMutationLease,
  type FileSystemPort,
  type HarnessId,
} from '@token-harness/core';
import { readBenchmarkSession } from './commands/benchmark-session.js';

export interface GuideBenchmarkRecovery {
  state: 'none' | 'pending' | 'other-project' | 'unavailable';
  benchmarkId: string | null;
  variant: string | null;
  harness: HarnessId | null;
  files: number;
  note: string;
}
export interface GuideBenchmarkRecoveryTarget {
  benchmarkId: string;
  variant: string;
  transactionId: string;
  fingerprint: string;
}
export interface GuideBenchmarkRecoveryObservation {
  report: GuideBenchmarkRecovery;
  /** Server-selected exact identity, never a browser-provided recovery selector. */
  target: GuideBenchmarkRecoveryTarget | null;
}
export type GuideBenchmarkRecoveryReader = () => Promise<GuideBenchmarkRecoveryObservation>;

function empty(
  state: GuideBenchmarkRecovery['state'],
  note: string,
): GuideBenchmarkRecoveryObservation {
  return {
    report: { state, benchmarkId: null, variant: null, harness: null, files: 0, note },
    target: null,
  };
}
export function unavailableGuideBenchmarkRecovery(): GuideBenchmarkRecoveryObservation {
  return empty(
    'unavailable',
    'The configuration lease or recovery checkpoint could not be read safely. Preserve the local checkpoint and backups; no recovery target was selected.',
  );
}

export function createGuideBenchmarkRecoveryReader(input: {
  fs: FileSystemPort | null;
  stateRoot: string | null;
  projectId: string | null;
  projectRoot: string;
  home: string | null;
}): GuideBenchmarkRecoveryReader {
  return async () => {
    if (input.fs === null || input.stateRoot === null || input.projectId === null)
      return unavailableGuideBenchmarkRecovery();
    try {
      const lease = await readMutationLease(input.fs, input.stateRoot);
      if (lease === null)
        return empty('none', 'No temporary benchmark configuration needs recovery.');
      if (lease.projectId !== input.projectId)
        return empty(
          'other-project',
          'A temporary configuration belongs to another project. Open that project to review its recovery; keep its checkpoint and backups.',
        );
      const session = await readBenchmarkSession(
        {
          adapters: { fs: input.fs },
          stateRoot: input.stateRoot,
          home: input.home,
          projectRoot: input.projectRoot,
        },
        lease.benchmarkId,
        lease.variant,
      );
      if (
        session === null ||
        session.projectId !== input.projectId ||
        session.transactionId !== lease.transactionId
      )
        return unavailableGuideBenchmarkRecovery();
      return {
        report: {
          state: 'pending',
          benchmarkId: lease.benchmarkId,
          variant: lease.variant,
          harness: session.harness,
          files: session.before.length,
          note: 'Review restoration of the original configuration saved before this benchmark arm. The preview checks for conflicting edits. Recovery does not finish the capture or record a quality result.',
        },
        target: {
          benchmarkId: lease.benchmarkId,
          variant: lease.variant,
          transactionId: lease.transactionId,
          fingerprint: digestText(JSON.stringify({ lease, session })),
        },
      };
    } catch {
      return unavailableGuideBenchmarkRecovery();
    }
  };
}

export function benchmarkRecoveryArgs(target: GuideBenchmarkRecoveryTarget): string[] {
  return ['benchmark-restore', '--benchmark-id', target.benchmarkId, '--variant', target.variant];
}
