import { createHash } from 'node:crypto';
import { realpath } from 'node:fs/promises';
import { createServer } from 'node:net';
import { diagnostic, type StateMutationGuard } from '@token-harness/core';

/**
 * A kernel-held reservation has no orphaned lock file to steal after a crash.
 * It exposes no API, accepts no data and is scoped to the canonical state root.
 * Port collisions fail closed; older builds do not participate in this protocol.
 */
export const nodeStateMutationGuard: StateMutationGuard = {
  async run<T>(stateRoot: string, operation: () => Promise<T>) {
    let canonical: string;
    try {
      canonical = await realpath(stateRoot);
    } catch {
      return {
        acquired: false as const,
        exitCode: 9 as const,
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: 'mutation-guard-unavailable',
            message: 'The managed state directory could not be verified before the change',
            remediation: 'Re-check local state access before reviewing the change again',
          }),
        ],
      };
    }
    if (process.platform === 'win32') canonical = canonical.toLowerCase();
    const digest = createHash('sha256')
      .update('token-harness-mutation-v1\0' + canonical)
      .digest();
    const port = 16384 + (digest.readUInt32BE(0) % 32768);
    const server = createServer((socket) => socket.destroy());
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
      });
    } catch (error) {
      const busy = (error as NodeJS.ErrnoException).code === 'EADDRINUSE';
      return {
        acquired: false as const,
        exitCode: busy ? (5 as const) : (9 as const),
        diagnostics: [
          diagnostic({
            severity: 'error',
            code: busy ? 'managed-change-in-progress' : 'mutation-guard-unavailable',
            message: busy
              ? 'Another local process holds the managed-change reservation; no second change was started'
              : 'The platform could not reserve exclusive access for this managed change',
            remediation: busy
              ? 'Wait for the other operation to finish, then refresh and review again; if it persists, check local port availability'
              : 'Check local loopback permissions, then review the change again',
          }),
        ],
      };
    }
    try {
      return { acquired: true as const, value: await operation() };
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  },
};
