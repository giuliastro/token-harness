/**
 * Human rendering of `token-harness doctor`.
 *
 * Pinned by RFC 0006 §Golden path, and amended there twice.
 *
 * ## The first attempt at fixing this made it worse, which is the lesson
 *
 * A first run was reported as unreadable. The first fix added explanatory prose: a line saying the
 * command was read-only, sentences as section headings, a paragraph telling the reader that a note
 * was not a failure. The same reader came back with the same complaint plus three new ones — badly
 * aligned, scattered useless text, still no idea what to do.
 *
 * They were right. Explaining a confusing table in prose beside it produces a confusing table with
 * prose beside it. Two of those added lines said the same thing twice ("changed nothing" appeared
 * in the header *and* under the tables), and none of them was the thing missing, which was a
 * literal next command.
 *
 * ## What this file does instead
 *
 * - **Columns with headers.** `STATE`, `WIRED TO`, `SET UP BY`. The reader learns what a column
 *   means from its heading, not from a sentence explaining the table.
 * - **Harness and provider states in plain words**, because `configured` meant two different things
 *   in the two tables — a harness with hooks, and a provider wired into one.
 * - **A `NEXT` block containing a command to type.** Nothing else in the output tells anybody what
 *   to do, so this does, always, in every state.
 * - **`NOTES` only when there is something in it**, one line each, no commentary.
 *
 * Nothing here is prose about the output. If a fact needs a sentence to be understood, it belongs
 * in a column heading or in `NEXT`.
 */

import {
  renderPlatformSummary,
  type DoctorReport,
  type HarnessDetection,
  type ProviderDetection,
} from '@token-harness/core';

import { column, displayPath, document, type RenderContext } from './layout.js';

const NAME_WIDTH = 15;
const STATE_WIDTH = 12;
const VERSION_WIDTH = 10;
const WIRED_WIDTH = 14;

/** RFC 0002's `HarnessState`, in words that do not need a glossary. */
function harnessState(detection: HarnessDetection): string {
  switch (detection.state) {
    case 'absent':
      return 'not found';
    case 'detected':
      return 'no hooks';
    case 'configured':
      return 'hooks';
    case 'broken':
      return 'unreadable';
  }
}

/** Where a provider is wired, or the reason there is nowhere. */
function wiredTo(detection: ProviderDetection): string {
  if (detection.state === 'broken') return 'cannot run';
  if (detection.state === 'absent') return 'not installed';
  if (detection.configuredHarnesses.length === 0) return 'nothing yet';
  return detection.configuredHarnesses.join(', ');
}

/**
 * Who put it there — the distinction RFC 0004 §Brownfield adoption turns on.
 *
 * It was "adopted, not managed", then a parenthetical sentence per row. It is a column now: on most
 * first runs every row says `you`, and that is the answer to "did this thing just install
 * something", which no earlier version of this output gave.
 */
function setUpBy(detection: ProviderDetection): string {
  if (detection.state === 'absent' || detection.configuredHarnesses.length === 0) return '—';
  return detection.managedByTokenHarness ? 'this tool' : 'you';
}

/**
 * One line per item behind the exit code, and nothing else.
 *
 * `doctor.ts` counts two kinds: a detection that is `broken`, and a version outside its tested
 * range. Neither blocks anything, which is why the heading is `NOTES` and why `NEXT` below is the
 * same command whether this list is empty or not.
 */
function notes(report: DoctorReport): string[] {
  const lines: string[] = [];
  for (const harness of report.harnesses) {
    if (harness.state === 'broken') {
      lines.push(`  ${harness.harnessId}: configuration could not be read`);
    }
    if (harness.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${harness.harnessId} ${harness.version ?? ''}: newer than tested, so treated conservatively`,
      );
    }
  }
  for (const provider of report.providers) {
    if (provider.state === 'broken') {
      lines.push(`  ${provider.providerId}: installed but could not be run`);
    }
    if (provider.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${provider.providerId} ${provider.version ?? ''}: newer than tested, so treated conservatively`,
      );
    }
  }
  return lines;
}

export function renderDoctorReport(report: DoctorReport, context: RenderContext): string {
  const lines: string[] = [];

  lines.push(
    `Token Harness ${context.toolVersion} — ${renderPlatformSummary(report.platform)}, Node ${report.platform.nodeVersion}`,
  );
  lines.push('');

  lines.push(`${column('HARNESSES', NAME_WIDTH)}${column('STATE', STATE_WIDTH)}CONFIG FILE`);
  if (report.harnesses.length === 0) {
    lines.push('  none registered');
  } else {
    for (const harness of report.harnesses) {
      lines.push(
        `  ${column(harness.harnessId, NAME_WIDTH - 2)}${column(harnessState(harness), STATE_WIDTH)}` +
          `${harness.configPath === null ? '' : displayPath(harness.configPath, context.home)}`,
      );
    }
  }
  lines.push('');

  lines.push(
    `${column('PROVIDERS', NAME_WIDTH)}${column('VERSION', VERSION_WIDTH)}${column('WIRED TO', WIRED_WIDTH)}SET UP BY`,
  );
  if (report.providers.length === 0) {
    lines.push('  none registered');
  } else {
    for (const provider of report.providers) {
      lines.push(
        `  ${column(provider.providerId, NAME_WIDTH - 2)}` +
          `${column(provider.version ?? '—', VERSION_WIDTH)}` +
          `${column(wiredTo(provider), WIRED_WIDTH)}` +
          `${setUpBy(provider)}`,
      );
    }
  }

  const notable = notes(report);
  if (notable.length > 0) {
    lines.push('');
    lines.push('NOTES');
    lines.push(...notable);
  }

  /**
   * Always present, always a command to type.
   *
   * Which command depends on what is missing, and that decision is the only thing in this output
   * that is about the reader rather than about the machine.
   */
  const unwired = report.providers.filter(
    (provider) => provider.state !== 'absent' && provider.configuredHarnesses.length === 0,
  );
  lines.push('');
  lines.push('NEXT');
  // Aligned on the widest command, so two suggestions do not read as two unrelated fragments.
  const suggestions: [string, string][] =
    report.providers.every((provider) => provider.state === 'absent') || unwired.length > 0
      ? [['token-harness plan', 'see what would change — writes nothing']]
      : [
          ['token-harness verify', 'check the pipeline actually intercepts'],
          ['token-harness metrics --since 7d', 'see what it saved'],
        ];
  const commandWidth = Math.max(...suggestions.map(([command]) => command.length)) + 2;
  for (const [command, description] of suggestions) {
    lines.push(`  ${column(command, commandWidth)}${description}`);
  }

  return document(lines);
}
