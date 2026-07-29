/**
 * Human rendering of `token-harness plan`.
 *
 * Pinned by two RFC 0006 §Golden path scenarios: the clean plan and the
 * brownfield conflict. They are separate fixtures with separate trees, and the
 * conflict branch produces no plan at all rather than an empty one.
 */

import { actionLabel, planAborted, primaryActionPath, type PlanReport } from '@token-harness/core';

import { column, displayPath, document, pluralize, type RenderContext } from './layout.js';

const OWNERSHIP_CAPABILITY_WIDTH = 27;
const EXCLUSION_PROVIDER_WIDTH = 14;
const EXCLUSION_CAPABILITY_WIDTH = 22;
const EXCLUSION_CONTINUATION_INDENT = 2 + EXCLUSION_PROVIDER_WIDTH + EXCLUSION_CAPABILITY_WIDTH;
const ACTION_KIND_WIDTH = 21;
const ACTION_PATH_WIDTH = 28;
const CONFLICT_LABEL_WIDTH = 10;

function renderConflicts(report: PlanReport): string {
  const lines: string[] = [];
  const count = report.conflicts.length;
  lines.push(`Plan aborted — ${count} hard ${pluralize(count, 'conflict')}.`);
  lines.push('');
  for (const [index, conflict] of report.conflicts.entries()) {
    if (index > 0) lines.push('');
    lines.push(`  ${column('conflict', CONFLICT_LABEL_WIDTH)}${conflict.code}`);
    for (const detail of conflict.detail) lines.push(`    ${detail}`);
    lines.push(`    Fix: ${conflict.remediation}`);
  }
  lines.push('');
  lines.push('No plan was produced.');
  return document(lines);
}

function summaryLine(report: PlanReport): string {
  const network = report.network.length === 0 ? 'none' : report.network.join(', ');
  const elevation = report.elevation.length === 0 ? 'none' : report.elevation.join(', ');
  const backups =
    report.backups.files === 0
      ? 'none'
      : `${report.backups.files} ${pluralize(report.backups.files, 'file')}`;
  return `Network: ${network}. Elevation: ${elevation}. Backups: ${backups}.`;
}

function closingLine(report: PlanReport): string {
  if (report.actions.length === 0) return 'Dry run. There is nothing to change.';
  if (!report.persisted || report.planId === null) return 'Dry run. Nothing was changed.';
  return `Dry run. Nothing was changed. Run \`token-harness apply --plan ${report.planId}\`.`;
}

export function renderPlanReport(report: PlanReport, context: RenderContext): string {
  if (planAborted(report) && report.conflicts.length > 0) {
    return renderConflicts(report);
  }

  const lines: string[] = [];
  const header = [
    `Plan ${report.planId ?? 'unsaved'}`,
    `profile ${report.profile}`,
    `harness ${report.harness ?? 'all'}`,
    `project ${displayPath(report.projectRoot, context.home)}`,
  ];
  lines.push(header.join(' — '));
  lines.push('');

  lines.push('Capability ownership');
  if (report.ownership.length === 0) {
    lines.push('  no capability is owned by any provider');
  } else {
    for (const owned of report.ownership) {
      lines.push(`  ${column(owned.scope.capability, OWNERSHIP_CAPABILITY_WIDTH)}${owned.owner}`);
    }
  }

  if (report.exclusions.length > 0) {
    lines.push('');
    lines.push('Excluded');
    for (const exclusion of report.exclusions) {
      const [first = '', ...rest] = exclusion.reason;
      lines.push(
        `  ${column(exclusion.excluded, EXCLUSION_PROVIDER_WIDTH)}` +
          `${column(exclusion.scope.capability, EXCLUSION_CAPABILITY_WIDTH)}` +
          `${first}`,
      );
      for (const line of rest) {
        lines.push(`${' '.repeat(EXCLUSION_CONTINUATION_INDENT)}${line}`);
      }
    }
  }

  lines.push('');
  lines.push('Actions');
  if (report.actions.length === 0) {
    lines.push('  none');
  } else {
    for (const [index, action] of report.actions.entries()) {
      const path = primaryActionPath(action);
      lines.push(
        `  ${index + 1}. ${column(actionLabel(action.kind), ACTION_KIND_WIDTH)}` +
          `${column(path === null ? '' : displayPath(path, context.home), ACTION_PATH_WIDTH)}` +
          `${action.explanation}`,
      );
    }
  }

  lines.push('');
  lines.push(summaryLine(report));
  lines.push('');
  lines.push(closingLine(report));

  return document(lines);
}
