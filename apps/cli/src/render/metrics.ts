/**
 * Human rendering of `token-harness metrics`.
 *
 * Pinned by RFC 0006 §Golden path, scenario "metrics after a week of RTK on
 * Claude and HarnessTrim adopted on OpenCode". The `metrics` *command* is
 * Phase 7; the renderer exists now for the same reason `verify`'s does.
 *
 * The layout enforces RFC 0005 §Measurement classes structurally: each class
 * gets its own line with its own unit, and there is no code path that produces a
 * combined headline figure.
 */

import {
  MEASUREMENT_CLASSES,
  type MeasurementClass,
  type MetricsReport,
} from '@token-harness/core';

import { column, document, formatCount, rightAlign, type RenderContext } from './layout.js';

const CLASS_LABEL_WIDTH = 23;
const FIGURE_BLOCK_GUTTER = 4;
const PROVIDER_ID_WIDTH = 15;
const PROVIDER_SAVED_WIDTH = 23;
const PROVIDER_CLASS_WIDTH = 17;
const PROVIDER_OPERATIONS_WIDTH = 19;
const PROVIDER_CONTINUATION_INDENT = 2 + PROVIDER_ID_WIDTH;

const CLASS_LABELS: Readonly<Record<MeasurementClass, string>> = {
  'exact-local': 'Exact local',
  'estimated-local': 'Estimated local',
  counterfactual: 'Counterfactual',
  'end-to-end-billed': 'End-to-end billed',
};

function renderClassRows(report: MetricsReport): string[] {
  const byClass = new Map(report.classes.map((row) => [row.class, row]));
  const ordered = MEASUREMENT_CLASSES.map((id) => byClass.get(id)).filter(
    (row): row is NonNullable<typeof row> => row !== undefined,
  );

  const withFigures = ordered.filter((row) => row.before !== null && row.after !== null);
  const beforeWidth = Math.max(
    0,
    ...withFigures.map((row) => formatCount(row.before as number).length),
  );
  const afterWidth = Math.max(
    0,
    ...withFigures.map((row) => formatCount(row.after as number).length),
  );

  const blocks = ordered.map((row) => {
    if (row.before === null || row.after === null) return '';
    return `${rightAlign(formatCount(row.before), beforeWidth)} -> ${rightAlign(formatCount(row.after), afterWidth)} ${row.unit ?? ''}`;
  });
  const blockWidth = Math.max(0, ...blocks.map((block) => block.length)) + FIGURE_BLOCK_GUTTER;

  return ordered.map((row, index) => {
    const label = column(CLASS_LABELS[row.class], CLASS_LABEL_WIDTH);
    const block = (blocks[index] ?? '').padEnd(blockWidth, ' ');
    const tail = row.saved === null ? (row.note ?? '') : `saved ${formatCount(row.saved)}`;
    return `${label}${block}${tail}`;
  });
}

export function renderMetricsReport(report: MetricsReport, _context: RenderContext): string {
  const lines: string[] = [];

  const header = [`Savings`, `${report.windowStart} to ${report.windowEnd}`];
  if (report.pipelineId !== null) header.push(`pipeline ${report.pipelineId}`);
  lines.push(header.join(' — '));
  lines.push('');

  lines.push(...renderClassRows(report));
  lines.push('');

  lines.push('By provider (marginal)');
  if (report.providers.length === 0) {
    lines.push('  no provider reported a measurable saving in this window');
  } else {
    for (const provider of report.providers) {
      lines.push(
        `  ${column(provider.providerId, PROVIDER_ID_WIDTH)}` +
          `${column(`saved ${formatCount(provider.saved)} ${provider.unit}`, PROVIDER_SAVED_WIDTH)}` +
          `${column(provider.class, PROVIDER_CLASS_WIDTH)}` +
          `${column(`${formatCount(provider.operations)} operations`, PROVIDER_OPERATIONS_WIDTH)}` +
          `${provider.harnesses.join(', ')}`,
      );
      const notes: string[] = [];
      if (!provider.managedByTokenHarness) notes.push('adopted, not managed');
      if (provider.adapterMode !== null) notes.push(`adapter mode ${provider.adapterMode}`);
      if (notes.length > 0) {
        lines.push(`${' '.repeat(PROVIDER_CONTINUATION_INDENT)}${notes.join(' — ')}`);
      }
    }
  }
  lines.push('');

  lines.push(
    `Coverage ${report.coveragePercent}%. Bypassed ${formatCount(report.bypassed)}. ` +
      `Errors ${formatCount(report.errors)}. Added median latency ${report.addedMedianLatencyMs}ms.`,
  );

  return document(lines);
}
