/**
 * Human rendering of `token-harness status`.
 *
 * PLAN §1.3 requires `status` in the Phase 1 shell, but no accepted RFC contains
 * a `status` transcript — RFC 0006 §Golden path covers doctor, plan, verify, and
 * metrics only. This layout is therefore project-local: its golden file is
 * marked as such, and it is not a frozen product surface until an RFC pins it.
 *
 * What it does honour is content, not layout: RFC 0004 §Post-apply drift lists
 * the four drift findings a read-only command must report, and RFC 0005
 * §Importer degradation policy requires the importer mode to appear here.
 */

import {
  formatCapabilityScope,
  renderPlatformSummary,
  type StatusReport,
} from '@token-harness/core';

import { column, displayPath, document, pluralize, type RenderContext } from './layout.js';

const OWNER_SCOPE_WIDTH = 44;
const IMPORTER_ID_WIDTH = 14;
const IMPORTER_MODE_WIDTH = 14;

export function renderStatusReport(report: StatusReport, context: RenderContext): string {
  const lines: string[] = [];

  lines.push(
    `Token Harness ${context.toolVersion} — ${renderPlatformSummary(report.platform)}, Node ${report.platform.nodeVersion}`,
  );
  lines.push('');

  lines.push('Pipelines');
  if (report.pipelines.length === 0) {
    lines.push('  nothing has been applied on this machine');
  } else {
    for (const pipeline of report.pipelines) {
      lines.push(`  ${pipeline.harness} — pipeline ${pipeline.pipelineId}`);

      if ((pipeline.channels ?? []).length > 0) {
        lines.push('    channels');
        for (const channel of pipeline.channels ?? []) {
          lines.push(
            `      ${channel.toolFamily}/${channel.capability} — ${channel.owners.join(' → ')}`,
          );
        }
      }

      if ((pipeline.tiers ?? []).length > 0) {
        lines.push(
          `    tiers — ${(pipeline.tiers ?? [])
            .map((tier) => `${tier.providerId}: ${tier.declaredTier}`)
            .join(', ')}`,
        );
      }

      lines.push('    owners');
      for (const owner of pipeline.owners) {
        lines.push(
          `      ${column(formatCapabilityScope(owner.scope), OWNER_SCOPE_WIDTH)}${owner.owner}`,
        );
      }
    }
  }
  lines.push('');

  lines.push('Drift');
  if (report.drift.length === 0) {
    lines.push('  none');
  } else {
    for (const finding of report.drift) {
      lines.push(`  ${finding.code}`);
      lines.push(`    ${finding.detail}`);
      if (finding.path !== null) lines.push(`    ${displayPath(finding.path, context.home)}`);
      if (finding.remediation !== null) lines.push(`    Fix: ${finding.remediation}`);
    }
  }
  lines.push('');

  lines.push('Importers');
  if (report.importers.length === 0) {
    lines.push('  none');
  } else {
    for (const importer of report.importers) {
      lines.push(
        `  ${column(importer.providerId, IMPORTER_ID_WIDTH)}` +
          `${column(importer.mode, IMPORTER_MODE_WIDTH)}` +
          `${importer.lastImportedAt === null ? 'never imported' : `last import ${importer.lastImportedAt}`}`,
      );
    }
  }
  lines.push('');

  if (report.problemCount === 0) {
    lines.push('No drift and no contested scope.');
  } else {
    lines.push(
      `${report.problemCount} ${pluralize(report.problemCount, 'problem')} found. Repair is a plan: run \`token-harness plan\`.`,
    );
  }

  return document(lines);
}
