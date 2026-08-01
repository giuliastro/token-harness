/**
 * Human rendering of `token-harness verify`.
 *
 * Pinned by RFC 0006 §Golden path, scenario "verifying RTK managed on Claude and
 * HarnessTrim adopted on OpenCode". The `verify` *command* is Phase 7 (PLAN
 * §12); the renderer exists now because the transcript is normative and PLAN
 * §1.3 commits it as a golden file for the human rendering, not only the JSON.
 */

import type { VerifyReport } from '@token-harness/core';

import { document, pluralize, row, truncate, wrap, type RenderContext } from './layout.js';

/**
 * A fixed status column, wide enough for `not-exercised` — the longest status RFC 0007 defines.
 *
 * This used to be computed from the statuses actually present, so a report of `pass` and `info`
 * would render byte-identically to a transcript that predated `not-exercised`. That is no longer
 * worth preserving: the transcript itself changed when this layout did, and a column whose width
 * depends on the data is a column that moves between two runs of the same command.
 */
const STATUS_WIDTH = 16;
/** The check column. Ids are shortened for display; the full id stays in `--json`. */
const CHECK_WIDTH = 12;

/** `executable-resolves` in 78 columns beside a status and a detail does not fit. */
function shortCheck(id: string): string {
  // Truncated as well as shortened: `adapter-config-readable` survives the suffix strip at 23
  // characters and pushed its row to 84, because `column` pads but never cuts.
  return truncate(id.replace(/-resolves$|-registered$|-intercepted$/, ''), CHECK_WIDTH);
}

export function renderVerifyReport(report: VerifyReport, _context: RenderContext): string {
  const lines: string[] = [];

  lines.push(
    report.receiptId === null || report.appliedAt === null
      ? 'No receipt: verifying what is on the machine now'
      : `Receipt ${report.receiptId} — applied ${report.appliedAt}`,
  );

  /**
   * One block per provider, with the header as key/value rows rather than a chain of em-dashes.
   *
   * The old header was `rtk — claude — adopted, not managed — declared tier: canary`: four facts
   * joined by a separator, one of them jargon, at 65 characters and growing with every id. And the
   * check rows put a free-text summary in a third column, which reached 106 characters and wrapped
   * mid-word in an 80-column terminal.
   */
  for (const result of report.results) {
    lines.push('');
    lines.push(
      `${result.providerId} on ${result.harnessId} — set up by ` +
        `${result.managedByTokenHarness ? 'this tool' : 'you'}, tier ${result.declaredTier}`,
    );
    for (const check of result.checks) {
      // The wrap indent is the column the detail starts in. Getting this wrong is what made the
      // first attempt put continuations further right than the text they continued.
      // Two separators of three characters each sit between the three columns.
      const indent = 2 + CHECK_WIDTH + 3 + STATUS_WIDTH + 3;
      const wrapped = wrap(check.summary, indent);
      lines.push(
        `  ${row([
          [shortCheck(check.id), CHECK_WIDTH],
          [check.status, STATUS_WIDTH],
          [(wrapped[0] ?? '').trimStart(), 0],
        ])}`,
      );
      lines.push(...wrapped.slice(1));
    }
  }

  lines.push('');
  if (report.healthyAtDeclaredTier) {
    lines.push('Healthy at the declared tier for every provider.');
  } else {
    const failures = report.results
      .flatMap((result) => result.checks)
      .filter((check) => check.status === 'fail').length;
    lines.push(`${String(failures)} ${pluralize(failures, 'check')} below tier. Not proven.`);
  }

  return document(lines);
}
