/**
 * `token-harness status`.
 *
 * Reads the installation receipts and compares them against the live
 * environment (RFC 0004 §Post-apply drift). The state layer is Phase 2, so there
 * are no receipts to read and nothing to compare: an empty machine reports no
 * pipelines, no drift, and exits 0.
 */

import {
  EXIT_CODES,
  commandResult,
  type CommandResult,
  type StatusReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export async function runStatus(context: CommandContext): Promise<CommandResult<StatusReport>> {
  await Promise.resolve();

  const report: StatusReport = {
    platform: context.platform,
    pipelines: [],
    drift: [],
    importers: [],
    problemCount: 0,
  };

  return commandResult<StatusReport>({
    command: 'status',
    exitCode: report.problemCount === 0 ? EXIT_CODES.ok : EXIT_CODES['problems-found'],
    data: report,
  });
}
