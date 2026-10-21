import type { Diagnostic } from './diagnostics.js';

/** Platform-held exclusion around a whole approved command, including verification/rollback. */
export interface StateMutationGuard {
  run<T>(
    stateRoot: string,
    operation: () => Promise<T>,
  ): Promise<
    { acquired: true; value: T } | { acquired: false; exitCode: 5 | 9; diagnostics: Diagnostic[] }
  >;
}
