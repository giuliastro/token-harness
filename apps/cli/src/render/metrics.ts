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

import {
  column,
  document,
  formatCount,
  rightAlign,
  row,
  wrap,
  type RenderContext,
} from './layout.js';

const CLASS_LABEL_WIDTH = 23;
const FIGURE_BLOCK_GUTTER = 4;
/**
 * Sized so four columns plus three separators fit inside `MAX_WIDTH`.
 *
 * They were 15 / 23 / 17 / 19, which totalled 74 on their own — fine while columns were separated by
 * the padding itself, and nine characters too wide once a visible ` - ` went between them. The
 * separator is not free and the widths had to pay for it.
 */
const PROVIDER_ID_WIDTH = 13;
const PROVIDER_SAVED_WIDTH = 21;
const PROVIDER_CLASS_WIDTH = 15;
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

  if (report.pipelineTotal !== undefined) {
    lines.push('Observed by measurement class (provider events)');
  }
  lines.push(...renderClassRows(report));
  lines.push('');

  if (report.channels !== undefined) {
    lines.push('By channel (raw to final)');
    if (report.channels.length === 0) {
      lines.push('  no applied pipeline channels');
    } else {
      for (const channel of report.channels) {
        lines.push(...wrap(`${channel.harness} ${channel.toolFamily} ${channel.capability}`, 2));
        const owners = channel.owners.join(' -> ');
        if (channel.status === 'measured') {
          lines.push(...wrap(`${owners} - measured`, 4));
          for (const measurement of channel.classes) {
            if (measurement.saved === null || measurement.unit === null) continue;
            lines.push(
              ...wrap(
                `${CLASS_LABELS[measurement.class]}: ${formatCount(measurement.before ?? 0)} -> ` +
                  `${formatCount(measurement.after ?? 0)} ${measurement.unit}; saved ` +
                  `${formatCount(measurement.saved)} across ${formatCount(measurement.operations)} operation` +
                  `${measurement.operations === 1 ? '' : 's'}`,
                4,
              ),
            );
          }
          if (channel.note !== null) lines.push(...wrap(`note: ${channel.note}`, 4));
        } else {
          lines.push(...wrap(`${owners} - ${channel.status}`, 4));
          if (channel.note !== null) lines.push(...wrap(channel.note, 4));
          if (channel.incomparableReasons.length > 0) {
            lines.push(...wrap(`reasons: ${channel.incomparableReasons.join(', ')}`, 4));
          }
        }
      }
    }
    lines.push('');
  }

  if (report.pipelineTotal !== undefined) {
    lines.push('Pipeline total');
    if (
      report.pipelineTotal.status === 'measured' &&
      report.pipelineTotal.saved !== null &&
      report.pipelineTotal.unit !== null &&
      report.pipelineTotal.class !== null
    ) {
      lines.push(
        ...wrap(
          `${CLASS_LABELS[report.pipelineTotal.class]}: saved ` +
            `${formatCount(report.pipelineTotal.saved)} ${report.pipelineTotal.unit}`,
          2,
        ),
      );
    } else {
      lines.push(...wrap(`${report.pipelineTotal.status} - ${report.pipelineTotal.note}`, 2));
      if (report.pipelineTotal.reason !== null) {
        lines.push(...wrap(`reason: ${report.pipelineTotal.reason}`, 2));
      }
    }
    lines.push('');
  }

  lines.push('By provider (marginal)');
  if (report.providers.length === 0) {
    lines.push('  no provider reported a measurable saving in this window');
  } else {
    for (const provider of report.providers) {
      /**
       * Five columns did not fit, so the harness list moved to the note line below.
       *
       * With a real provider and two harnesses this row reached 82 characters, which wrapped. The
       * harness list is the least load-bearing of the five — it repeats what `doctor` already
       * showed — so it is the one that moves rather than the saving or the count.
       */
      lines.push(
        `  ${row([
          [provider.providerId, PROVIDER_ID_WIDTH],
          [`saved ${formatCount(provider.saved)} ${provider.unit}`, PROVIDER_SAVED_WIDTH],
          [provider.class, PROVIDER_CLASS_WIDTH],
          [`${formatCount(provider.operations)} operations`, 0],
        ])}`,
      );
      const notes: string[] = [];
      if (provider.harnesses.length > 0) notes.push(`on ${provider.harnesses.join(', ')}`);
      if (!provider.managedByTokenHarness) notes.push('set up by you');
      if (provider.adapterMode !== null) notes.push(`mode ${provider.adapterMode}`);
      if (notes.length > 0) {
        lines.push(`${' '.repeat(PROVIDER_CONTINUATION_INDENT)}${notes.join(' — ')}`);
      }
    }
  }
  lines.push('');

  // Both figures can be genuinely absent, and neither has a safe zero. `Coverage 0%` would
  // report that nothing was optimized where the truth is that nothing happened, and
  // `latency 0ms` would claim the overhead was measured and found negligible — a stronger
  // claim than "not measured", and one no source available here supports.
  const coverage =
    report.coveragePercent === null
      ? 'Coverage not applicable — no operations in this window.'
      : `Coverage ${String(report.coveragePercent)}%.`;
  const latency =
    report.addedMedianLatencyMs === null
      ? 'Added median latency not measured.'
      : `Added median latency ${String(report.addedMedianLatencyMs)}ms.`;

  lines.push(
    `${coverage} Bypassed ${formatCount(report.bypassed)}. ` +
      `Errors ${formatCount(report.errors)}. ${latency}`,
  );

  // Only when it happened, so the RFC 0006 transcript — whose fixture has none — is unchanged.
  //
  // A provider row's figure is the *net* effect, so an inflation is already subtracted from
  // it. That is arithmetically complete and rhetorically incomplete: "saved 38,850" reads
  // very differently once you know some operations pushed the other way, and a reader cannot
  // infer it from a net number.
  if (report.inflatedOperations > 0) {
    lines.push(
      `${formatCount(report.inflatedOperations)} operations made the payload larger; ` +
        `the figures above are net of that.`,
    );
  }

  if (report.errorBreakdown.length > 0) {
    lines.push('');
    lines.push('Errors by code');
    for (const error of report.errorBreakdown) {
      lines.push(...wrap(error.code, 2));
      const scope: string[] = [];
      if (error.providerIds.length > 0) scope.push(`providers ${error.providerIds.join(', ')}`);
      if (error.harnesses.length > 0) scope.push(`harnesses ${error.harnesses.join(', ')}`);
      lines.push(
        ...wrap(
          `${formatCount(error.count)} operation${error.count === 1 ? '' : 's'}` +
            (scope.length > 0 ? ` - ${scope.join(' - ')}` : ''),
          4,
        ),
      );
    }
  }

  return document(lines);
}
