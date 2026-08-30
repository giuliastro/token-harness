import type { BudgetReport } from '@token-harness/core';

import { document, row, truncate, type RenderContext } from './layout.js';

const HARNESS_WIDTH = 10;
const STATE_WIDTH = 11;
const WINDOW_WIDTH = 10;
const USED_WIDTH = 8;

function percent(value: number | null): string {
  if (value === null) return 'unknown';
  const rounded = Math.round(value * 10) / 10;
  return `${String(rounded)}%`;
}

function reset(value: string | null): string {
  if (value === null) return 'unknown';
  return value.replace('T', ' ').replace('.000Z', 'Z');
}

export function renderBudgetReport(report: BudgetReport, _context: RenderContext): string {
  const lines: string[] = ['BUDGET', ''];

  lines.push(
    row([
      ['HARNESS', HARNESS_WIDTH],
      ['STATE', STATE_WIDTH],
      ['WINDOW', WINDOW_WIDTH],
      ['USED', USED_WIDTH],
      ['RESETS', 0],
    ]),
  );

  for (const harness of report.harnesses) {
    if (harness.windows.length === 0) {
      lines.push(
        row([
          [harness.harnessId, HARNESS_WIDTH],
          [harness.state, STATE_WIDTH],
          ['-', WINDOW_WIDTH],
          ['-', USED_WIDTH],
          ['-', 0],
        ]),
      );
    } else {
      harness.windows.forEach((window, index) => {
        lines.push(
          truncate(
            row([
              [index === 0 ? harness.harnessId : '', HARNESS_WIDTH],
              [index === 0 ? harness.state : '', STATE_WIDTH],
              [window.scope, WINDOW_WIDTH],
              [percent(window.usedPercent), USED_WIDTH],
              [reset(window.resetsAt), 0],
            ]),
            78,
          ),
        );
      });
    }

    if (harness.windows.length > 0) {
      const sources = [
        ...new Set(
          harness.windows.map((window) => window.source + '/' + window.confidence),
        ),
      ];
      lines.push(truncate('  source - ' + sources.join(', '), 78));
    }

    if (harness.resetCreditsAvailable !== null) {
      lines.push(
        truncate(
          `  reset credits - ${String(harness.resetCreditsAvailable)} available - read-only`,
          78,
        ),
      );
    }
  }

  if (report.harnesses.length === 0) {
    lines.push('  no Claude Code or Codex installation was inspected');
  }

  return document(lines);
}
