/**
 * Human rendering of `token-harness apply`.
 *
 * RFC 0006 has no normative transcript for `apply`, so this follows the conventions the other
 * five renderers established: a header line, named sections, and no figure that is not also in
 * `data` — rule 3 makes human and JSON "two renderings of the same result object".
 *
 * The outcome line is the last thing printed and says what state the machine is in, because
 * that is the question a user has after a mutation. On the dirty path it names the files, which
 * RFC 0006 requires of exit 7.
 */

import type { ApplyReport } from '@token-harness/core';

import { column, document, type RenderContext } from './layout.js';

const STATUS_WIDTH = 22;
const KIND_WIDTH = 22;

const OUTCOME_LINES: Readonly<Record<ApplyReport['outcome'], string>> = {
  'nothing-to-do': 'Nothing to change. The machine already matches the plan.',
  'confirmation-required': 'Nothing was changed. Re-run with `--yes` to apply this plan.',
  rejected: 'Nothing was changed.',
  committed: 'Applied and committed.',
  'rolled-back': 'A step failed. Everything was rolled back and the restoration was verified.',
  dirty: 'A step failed and the rollback did not fully restore these files.',
};

export function renderApplyReport(report: ApplyReport, _context: RenderContext): string {
  const lines: string[] = [];

  const header = ['Apply'];
  header.push(report.planId === null ? 'no plan' : `plan ${report.planId}`);
  if (report.fromStoredPlan) header.push('stored');
  if (report.transactionId !== null) header.push(`transaction ${report.transactionId}`);
  lines.push(header.join(' — '));
  lines.push('');

  if (report.results.length > 0) {
    lines.push('Actions');
    for (const [index, result] of report.results.entries()) {
      lines.push(
        `  ${String(index + 1)}. ${column(result.kind, KIND_WIDTH)}` +
          `${column(result.status, STATUS_WIDTH)}${result.path ?? ''}`,
      );
    }
    lines.push('');
  }

  if (report.unrestored.length > 0) {
    lines.push('Not restored');
    for (const path of report.unrestored) lines.push(`  ${path}`);
    lines.push('');
  }

  lines.push(OUTCOME_LINES[report.outcome]);

  return document(lines);
}
