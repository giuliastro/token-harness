/**
 * Human rendering of `token-harness update`.
 *
 * No RFC transcript pins this one: RFC 0006 §Golden path has no `update` scenario, so the shape
 * here is project-local and its golden file is marked as such — the same standing `status` has.
 *
 * What RFC 0006 rule 3 does bind is that every field visible here exists in `data`. The one that
 * needed care is `verdict`: a row is not "up to date" or "needs update" but one of six states, and
 * flattening the four inconclusive ones into either of the two conclusive ones is what would let a
 * provider whose channel could not be read render as a provider that is current.
 */

import type { ProviderUpdateRow, UpdateReport } from '@token-harness/core';

import { MAX_WIDTH, document, pluralize, row, truncate, type RenderContext } from './layout.js';

/**
 * Floors, not fixed sizes — the same treatment `verify` gives its status column, and for a reason
 * that showed up the first time this was rendered.
 *
 * A fixed 14-character provider column looks right for `rtk` and `harnesstrim` and breaks the
 * moment a longer id appears: the verdict column then starts at a different offset on that row and
 * every column after it is out of line. Computing the width from what is actually present keeps the
 * common case unchanged and keeps a long name from wrecking the table.
 */
const PROVIDER_WIDTH = 14;
const VERDICT_WIDTH = 15;

function widthOf(values: readonly string[], floor: number): number {
  return Math.max(floor, ...values.map((value) => value.length + 2));
}

/**
 * What each verdict says on its own line.
 *
 * Written out per verdict rather than composed from the version fields, because the *reason* a row
 * has no target version is the information a reader needs, and "—" in an `available` column is the
 * same character for a pin, a missing channel and a channel that would not answer.
 */
function detail(row: ProviderUpdateRow): string {
  switch (row.verdict) {
    case 'upgradable':
      return `${String(row.installed)} → ${String(row.available)} via ${String(row.channel)}`;
    case 'current':
      return `${String(row.installed)} is the newest ${String(row.channel)} offers`;
    case 'pinned':
      return `held at ${String(row.pin)} by a pin`;
    case 'not-installed':
      return 'not installed, so there is nothing to update';
    case 'no-channel':
      return 'no installation channel on this platform';
    case 'unknown':
      return `${String(row.channel)} answered without a version this build can read`;
    case 'unavailable':
      return `${String(row.channel)} could not be asked`;
  }
}

export function renderUpdateReport(report: UpdateReport, _context: RenderContext): string {
  const lines: string[] = [];

  if (report.providers.length === 0) {
    lines.push('No provider was inspected.');
    return document(lines);
  }

  /**
   * Capped, not just floored.
   *
   * `widthOf` grew the column to fit the longest id, which is correct until the ids are long: with
   * placeholder names the detail column started at 37 and the line reached 89 characters. The cap
   * bounds the prefix so the detail always has room, and the detail is truncated rather than
   * wrapped — one row, one line.
   */
  const providerWidth = Math.min(
    20,
    widthOf(
      report.providers.map((entry) => entry.providerId),
      PROVIDER_WIDTH,
    ),
  );
  const detailStart = providerWidth + 3 + VERDICT_WIDTH + 3;
  for (const entry of report.providers) {
    lines.push(
      truncate(
        row([
          [entry.providerId, providerWidth],
          [entry.verdict, VERDICT_WIDTH],
          [truncate(detail(entry), MAX_WIDTH - detailStart), 0],
        ]),
        MAX_WIDTH,
      ),
    );
  }

  /**
   * The network line is printed on a dry run, not only when something is installed.
   *
   * `update` cannot name a target version without asking a channel, so the reconnaissance is the
   * part most likely to surprise someone who ran a command that changes nothing. RFC 0004
   * §Network policy is satisfied by disclosing it where it happened.
   */
  if (report.network.length > 0) {
    lines.push('');
    lines.push(`Network: ${report.network.join(', ')}`);
  }

  const upgradable = report.providers.filter((row) => row.verdict === 'upgradable').length;
  const execution = report.execution;
  lines.push('');
  if (execution === null || execution.outcome === 'nothing-to-do') {
    lines.push('Nothing to update.');
  } else if (execution.outcome === 'confirmation-required') {
    lines.push(
      `${String(upgradable)} ${pluralize(upgradable, 'provider')} would be updated. Re-run with --yes.`,
    );
  } else if (execution.outcome === 'committed') {
    lines.push(`Updated ${String(upgradable)} ${pluralize(upgradable, 'provider')}.`);
  } else {
    // Deliberately not "a step failed": an update that rolled back restored files and left the
    // package, and the executor's own diagnostic is what says which. Overstating it here would
    // contradict the diagnostic printed beside it.
    lines.push(`The transaction ended ${execution.outcome}.`);
  }

  return document(lines);
}
