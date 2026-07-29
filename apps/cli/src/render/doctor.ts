/**
 * Human rendering of `token-harness doctor`.
 *
 * Pinned by RFC 0006 §Golden path, scenario "RTK and HarnessTrim installed,
 * neither wired to a harness".
 */

import {
  renderPlatformSummary,
  type DoctorReport,
  type HarnessDetection,
  type ProviderDetection,
} from '@token-harness/core';

import { column, displayPath, document, pluralize, type RenderContext } from './layout.js';

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
  const adopted = detection.managedByTokenHarness ? '' : ' (adopted, not managed)';
  return `configured for ${list}${adopted}`;
}

export function renderDoctorReport(report: DoctorReport, context: RenderContext): string {
  const lines: string[] = [];

  lines.push(
    `Token Harness ${context.toolVersion} — ${renderPlatformSummary(report.platform)}, Node ${report.platform.nodeVersion}`,
  );
  lines.push('');

  lines.push('Harnesses');
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

  lines.push('Providers');
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

  // RFC 0006 §Exit codes: an installed-but-unwired provider is a state, not a
  // problem, so this line is about breakage only.
  if (report.problemCount === 0) {
    lines.push('Nothing is broken. Run `token-harness plan` to see what would change.');
  } else {
    lines.push(
      `${report.problemCount} ${pluralize(report.problemCount, 'problem')} found. Fix ${pluralize(report.problemCount, 'it', 'them')} before running \`token-harness plan\`.`,
    );
  }

  return document(lines);
}
