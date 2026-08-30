import type { OptimizeReport } from '@token-harness/core';

import { document, formatCount, row, truncate, wrap, type RenderContext } from './layout.js';

const HARNESS_WIDTH = 9;
const STATE_WIDTH = 9;
const MODEL_WIDTH = 18;
const EFFORT_WIDTH = 12;

function value(input: string | null): string {
  return input ?? '-';
}

function percent(input: number | null): string {
  return input === null ? '?' : String(Math.round(input * 10) / 10) + '%';
}

export function renderOptimizeReport(
  report: OptimizeReport,
  _context: RenderContext,
): string {
  const lines: string[] = [
    'OPTIMIZE',
    truncate(
      '  task=' +
        report.taskClass +
        ' profile=' +
        report.profile +
        ' reserve=' +
        String(report.reservePercent) +
        '%',
      78,
    ),
    '',
    row([
      ['HARNESS', HARNESS_WIDTH],
      ['STATE', STATE_WIDTH],
      ['MODEL', MODEL_WIDTH],
      ['EFFORT', EFFORT_WIDTH],
      ['CTX', 0],
    ]),
  ];

  for (const harness of report.harnesses) {
    const effort =
      value(harness.currentEffort) +
      (harness.recommendedEffort !== null &&
      harness.recommendedEffort !== harness.currentEffort
        ? '→' + harness.recommendedEffort
        : '');
    lines.push(
      truncate(
        row([
          [harness.harnessId, HARNESS_WIDTH],
          [harness.state, STATE_WIDTH],
          [value(harness.currentModel), MODEL_WIDTH],
          [effort, EFFORT_WIDTH],
          [harness.contextPressure, 0],
        ]),
        78,
      ),
    );
  }

  lines.push('', 'PACE');
  let paceRows = 0;
  for (const harness of report.harnesses) {
    for (const pace of harness.pace) {
      paceRows += 1;
      lines.push(
        truncate(
          '  ' +
            harness.harnessId +
            ' ' +
            pace.scope +
            ' ' +
            pace.state +
            ' used=' +
            percent(pace.usedPercent) +
            ' target=' +
            percent(pace.targetUsedPercent) +
            ' reset=' +
            (pace.minutesToReset === null
              ? '?'
              : formatCount(pace.minutesToReset) + 'm'),
          78,
        ),
      );
    }
  }
  if (paceRows === 0) lines.push('  no paceable live quota window');

  lines.push('', 'ADVICE');
  let adviceCount = 0;
  for (const harness of report.harnesses) {
    for (const recommendation of harness.recommendations) {
      adviceCount += 1;
      const target = recommendation.target === null ? '' : ' → ' + recommendation.target;
      lines.push(
        ...wrap(
          String(adviceCount) +
            '. ' +
            harness.harnessId +
            ' [' +
            recommendation.priority +
            '/' +
            recommendation.area +
            '] ' +
            recommendation.action +
            target,
          2,
          78,
        ),
      );
      for (const evidence of recommendation.evidence.slice(0, 3)) {
        lines.push(...wrap('because ' + evidence.summary, 5, 78));
      }
    }
  }
  if (adviceCount === 0) lines.push('  no recommendation can be made from the observed evidence');

  return document(lines);
}
