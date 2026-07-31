/**
 * Human rendering of `token-harness verify`.
 *
 * Pinned by RFC 0006 §Golden path, scenario "verifying RTK managed on Claude and
 * HarnessTrim adopted on OpenCode". The `verify` *command* is Phase 7 (PLAN
 * §12); the renderer exists now because the transcript is normative and PLAN
 * §1.3 commits it as a golden file for the human rendering, not only the JSON.
 */

import type { VerifyReport } from '@token-harness/core';

import { column, document, pluralize, type RenderContext } from './layout.js';

/**
 * The width RFC 0006's transcript uses, and a floor rather than a fixed size.
 *
 * `pass` and `info` fit; `not-exercised` — which RFC 0007 added after that transcript was written —
 * is thirteen characters and pushed the summary column out of line for its row alone.
 *
 * Widening it unconditionally would change the spacing of a normative transcript to accommodate a
 * status the transcript does not contain. So the width is computed from the statuses actually
 * present: a report of `pass` and `info` renders byte-identically to RFC 0006, and a report that
 * contains a longer status aligns all of its own rows.
 */
const CHECK_STATUS_WIDTH = 6;
const CHECK_ID_WIDTH = 27;

function statusWidth(report: VerifyReport): number {
  const longest = Math.max(
    0,
    ...report.results.flatMap((result) => result.checks.map((check) => check.status.length)),
  );
  return Math.max(CHECK_STATUS_WIDTH, longest + 2);
}

export function renderVerifyReport(report: VerifyReport, _context: RenderContext): string {
  const lines: string[] = [];
  const width = statusWidth(report);

  // Two headers, because there are two honest situations. With a receipt this verifies what an
  // apply did; without one it verifies what is on the machine — which RFC 0004 §Brownfield
  // adoption makes the ordinary case, and which a `verify` that demanded a receipt could not
  // report at all.
  lines.push(
    report.receiptId === null || report.appliedAt === null
      ? 'No receipt — verifying the live configuration'
      : `Receipt ${report.receiptId} — applied ${report.appliedAt}`,
  );
  lines.push('');

  for (const result of report.results) {
    const header: string[] = [result.providerId, result.harnessId];
    // RFC 0004 §Brownfield adoption: an adopted installation is verified and
    // measured, never modified, and the header says so before any check does.
    if (!result.managedByTokenHarness) header.push('adopted, not managed');
    header.push(`declared tier: ${result.declaredTier}`);
    lines.push(header.join(' — '));
    for (const check of result.checks) {
      lines.push(
        `  ${column(check.status, width)}${column(check.id, CHECK_ID_WIDTH)}${check.summary}`,
      );
    }
  }

  lines.push('');
  if (report.healthyAtDeclaredTier) {
    lines.push('Pipeline healthy at the declared tier for every provider.');
  } else {
    // RFC 0006 §Tier-aware verification status: only a result below the
    // declared tier is a failure. `info` never contributes.
    const failures = report.results
      .flatMap((result) => result.checks)
      .filter((check) => check.status === 'fail').length;
    lines.push(
      `${failures} ${pluralize(failures, 'check')} below the declared tier. The pipeline is not proven.`,
    );
  }

  return document(lines);
}
