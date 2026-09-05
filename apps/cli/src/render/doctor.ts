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
 * - **A `NEXT` block containing commands to type.** Nothing else in the output tells anybody what
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

import {
  MAX_WIDTH,
  displayPath,
  document,
  row,
  truncatePath,
  type RenderContext,
} from './layout.js';

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
      lines.push(
        `  ${row([
          [harness.harnessId, NAME_WIDTH - 2],
          ['configuration could not be read', 0],
        ])}`,
      );
    }
    if (harness.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${row([
          [harness.harnessId, NAME_WIDTH - 2],
          [`${harness.version ?? ''} is newer than any tested version`, 0],
        ])}`,
      );
    }
  }
  for (const provider of report.providers) {
    if (provider.state === 'broken') {
      lines.push(
        `  ${row([
          [provider.providerId, NAME_WIDTH - 2],
          ['installed but could not be run', 0],
        ])}`,
      );
    }
    if (provider.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${row([
          [provider.providerId, NAME_WIDTH - 2],
          [`${provider.version ?? ''} is newer than any tested version`, 0],
        ])}`,
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

  lines.push(
    `  ${row([
      ['HARNESSES', NAME_WIDTH - 2],
      ['STATE', STATE_WIDTH],
      ['CONFIG FILE', 0],
    ])}`,
  );
  if (report.harnesses.length === 0) {
    lines.push('  none registered');
  } else {
    for (const harness of report.harnesses) {
      lines.push(
        `  ${row([
          [harness.harnessId, NAME_WIDTH - 2],
          [harnessState(harness), STATE_WIDTH],
          [
            harness.configPath === null
              ? ''
              : // The columns before this one, plus their separators, consume a fixed prefix; the
                // path gets what is left and is cut from the left so the file name survives.
                truncatePath(
                  displayPath(harness.configPath, context.home),
                  MAX_WIDTH - (2 + NAME_WIDTH - 2 + 3 + STATE_WIDTH + 3),
                ),
            0,
          ],
        ])}`,
      );
    }
  }
  lines.push('');

  lines.push(
    `  ${row([
      ['PROVIDERS', NAME_WIDTH - 2],
      ['VERSION', VERSION_WIDTH],
      ['WIRED TO', WIRED_WIDTH],
      ['SET UP BY', 0],
    ])}`,
  );
  if (report.providers.length === 0) {
    lines.push('  none registered');
  } else {
    for (const provider of report.providers) {
      lines.push(
        `  ${row([
          [provider.providerId, NAME_WIDTH - 2],
          [provider.version ?? '-', VERSION_WIDTH],
          [wiredTo(provider), WIRED_WIDTH],
          [setUpBy(provider), 0],
        ])}`,
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
   * that is about the reader rather than about the machine. Provider binaries may be user-owned;
   * `update` is therefore a dry-run suggestion rather than a silent mutation. This is what makes
   * a stale RTK/HarnessTrim install visible during onboarding without taking ownership of it.
   */
  const unwired = report.providers.filter(
    (provider) => provider.state !== 'absent' && provider.configuredHarnesses.length === 0,
  );
  const installedProviders = report.providers.some((provider) => provider.state !== 'absent');
  lines.push('');
  lines.push('NEXT');
  // Aligned on the widest command, so several suggestions still read as one sequence.
  const suggestions: [string, string][] =
    report.providers.every((provider) => provider.state === 'absent') || unwired.length > 0
      ? [['token-harness plan', 'see what would change — writes nothing']]
      : [
          ...(installedProviders
            ? ([['token-harness update', 'check RTK/HarnessTrim for newer versions']] as [
                string,
                string,
              ][])
            : []),
          ['token-harness verify', 'check the pipeline actually intercepts'],
          ['token-harness metrics --since 7d', 'see what it saved'],
        ];
  const commandWidth = Math.max(...suggestions.map(([command]) => command.length));
  for (const [command, description] of suggestions) {
    lines.push(
      `  ${row([
        [command, commandWidth],
        [description, 0],
      ])}`,
    );
  }

  return document(lines);
}
