/**
 * Human rendering of `token-harness doctor`.
 *
 * Pinned by RFC 0006 §Golden path, scenario "RTK and HarnessTrim installed, neither wired to a
 * harness" — and amended there, because the first version failed the only reader who matters, on
 * their first run.
 *
 * ## What was wrong with it, reported from a real first run
 *
 * Four misreadings, every one of them the output's fault rather than the reader's:
 *
 * 1. **The problem count named nothing.** On the machine that reported this, the single "problem"
 *    was HarnessTrim being `0.0.6` against a tested range ending at `0.0.5`. The table printed
 *    `0.0.6` with no mark on it, and a *separate* warning about PowerShell coverage appeared
 *    immediately above — so the reader connected the two. They are unrelated.
 * 2. **It claimed the problem blocked `plan`.** "Fix it before running `token-harness plan`" is
 *    false. RFC 0002 §Versioning makes an unknown newer version produce "a warning and default to
 *    conservative behavior"; it blocks nothing, and `plan` ran fine on that machine.
 * 3. **`configured` meant two different things** one section apart: a harness that has hooks written
 *    by anyone, and a provider wired into a harness.
 * 4. **Nothing said Token Harness had changed nothing.** A provider wired by hand and one wired by
 *    Token Harness both render as `configured`, so silence was read as "it installed something".
 *
 * ## The rule this file now follows
 *
 * A count is not a finding. Anything contributing to the count is named on its own line, and if
 * there is nothing to do about it, that is said rather than implied.
 */

import {
  renderPlatformSummary,
  type DoctorReport,
  type HarnessDetection,
  type ProviderDetection,
} from '@token-harness/core';

import { column, displayPath, document, type RenderContext } from './layout.js';

const HARNESS_ID_WIDTH = 12;
const HARNESS_STATE_WIDTH = 12;
const PROVIDER_ID_WIDTH = 14;
const PROVIDER_STATE_WIDTH = 14;
const PROVIDER_VERSION_WIDTH = 8;

function harnessDetail(detection: HarnessDetection, context: RenderContext): string {
  if (detection.configPath === null) return '';
  return displayPath(detection.configPath, context.home);
}

/**
 * RFC 0002 §Providers may exceed the managed surface is the reason RTK reads
 * "not configured for any harness" while HarnessTrim reads "not configured for
 * any managed harness": Token Harness can only speak for the harnesses it
 * manages, and a provider that supports more gets the qualifier.
 */
function providerNote(detection: ProviderDetection): string {
  if (detection.state === 'broken') {
    return 'installed but not usable';
  }
  if (detection.state === 'absent' || detection.state === 'available') {
    return '';
  }
  if (detection.configuredHarnesses.length === 0) {
    const qualifier = detection.supportsUnmanagedHarnesses ? 'managed harness' : 'harness';
    return `not configured for any ${qualifier}`;
  }
  const list = detection.configuredHarnesses.join(', ');
  /**
   * "adopted, not managed" was the wording, and it needed a glossary the reader does not have.
   *
   * The distinction matters — RFC 0004 §Brownfield adoption turns on it, and `uninstall` refuses to
   * remove what no journal records as ours — so it is kept, in words that carry themselves.
   */
  const ownership = detection.managedByTokenHarness
    ? ' (set up by Token Harness)'
    : ' (you set this up; Token Harness has not touched it)';
  return `wired to ${list}${ownership}`;
}

/**
 * One line per thing contributing to `problemCount`.
 *
 * `doctor.ts` counts exactly two kinds: a detection that is `broken`, and a version outside its
 * tested range. Rendering them from the same fields the count is derived from is what keeps the
 * list and the number from disagreeing.
 */
function worthKnowing(report: DoctorReport): string[] {
  const lines: string[] = [];

  for (const harness of report.harnesses) {
    if (harness.state === 'broken') {
      lines.push(`  ${harness.harnessId} is present, and its configuration could not be read`);
    }
    if (harness.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${harness.harnessId} ${harness.version ?? ''} is newer than any version this build was tested against`,
      );
    }
  }

  for (const provider of report.providers) {
    if (provider.state === 'broken') {
      lines.push(`  ${provider.providerId} is installed, and could not be run`);
    }
    if (provider.versionVerdict === 'unknown-newer') {
      lines.push(
        `  ${provider.providerId} ${provider.version ?? ''} is newer than any version this build was tested against`,
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
  // First, because the first question a first run raises is what the command just did.
  lines.push('Read-only: this inspected your machine and changed nothing.');
  lines.push('');

  // Annotated because `configured` appears in both tables meaning different things.
  lines.push('Harnesses — coding agents a provider can plug into (configured = it has hooks)');
  if (report.harnesses.length === 0) {
    lines.push('  no harness adapters registered');
  } else {
    for (const harness of report.harnesses) {
      lines.push(
        `  ${column(harness.harnessId, HARNESS_ID_WIDTH)}${column(harness.state, HARNESS_STATE_WIDTH)}${harnessDetail(harness, context)}`,
      );
    }
  }
  lines.push('');

  lines.push('Providers — the token-saving tools (configured = wired into a harness)');
  if (report.providers.length === 0) {
    lines.push('  no provider adapters registered');
  } else {
    for (const provider of report.providers) {
      lines.push(
        `  ${column(provider.providerId, PROVIDER_ID_WIDTH)}` +
          `${column(provider.state, PROVIDER_STATE_WIDTH)}` +
          `${column(provider.version ?? '', PROVIDER_VERSION_WIDTH)}` +
          `${providerNote(provider)}`,
      );
    }
  }
  lines.push('');

  /**
   * Whether anything above is ours, answered rather than left to inference.
   *
   * RFC 0004 §Brownfield adoption makes the hand-configured machine the common first run, so this
   * is the ordinary answer and not an edge case.
   */
  if (report.providers.length > 0) {
    const managed = report.providers
      .filter((provider) => provider.managedByTokenHarness)
      .map((provider) => provider.providerId);
    lines.push(
      managed.length === 0
        ? 'Token Harness has changed nothing here. Everything above was already on the machine.'
        : `Token Harness set up ${managed.join(', ')}. Everything else was already here.`,
    );
  }

  const notable = worthKnowing(report);
  if (notable.length === 0) {
    lines.push('Nothing is broken. Run `token-harness plan` to see what would change.');
    return document(lines);
  }

  /**
   * "Worth knowing", not "problems to fix", and the difference is factual.
   *
   * Everything reaching this list is a version outside a tested range or an integration that cannot
   * be read. Neither prevents anything, and the previous wording — fix this *before* running
   * `plan` — instructed the reader to do something unnecessary about something they often cannot
   * change.
   */
  lines.push('');
  lines.push('Worth knowing');
  lines.push(...notable);
  lines.push('');
  lines.push(
    notable.length === 1
      ? 'Nothing is blocked. That is a note, not a failure: Token Harness stays conservative where a version is untested.'
      : `Nothing is blocked. Those are ${String(notable.length)} notes, not failures: Token Harness stays conservative where a version is untested.`,
  );
  lines.push('Run `token-harness plan` to see what would change. It writes nothing.');

  return document(lines);
}
