import type { HistoryReport } from '@token-harness/core';

import { document, formatCount, row, truncate, type RenderContext } from './layout.js';

const HARNESS_WIDTH = 8;
const PERIOD_WIDTH = 10;
const INPUT_WIDTH = 10;
const CACHE_WIDTH = 10;
const OUTPUT_WIDTH = 10;
const TOTAL_WIDTH = 10;

export function renderHistoryReport(report: HistoryReport, _context: RenderContext): string {
  const lines: string[] = [
    'HISTORY',
    '',
    truncate(
      '  source=ccusage ' +
        (report.source.version ?? '?') +
        '; state=' +
        report.source.state +
        '; local/offline; costs excluded',
      78,
    ),
    '  window=' + report.windowStart + ' through ' + report.windowEnd,
    '',
    'DAILY',
    row([
      ['HARNESS', HARNESS_WIDTH],
      ['DAY', PERIOD_WIDTH],
      ['INPUT', INPUT_WIDTH],
      ['CACHE', CACHE_WIDTH],
      ['OUTPUT', OUTPUT_WIDTH],
      ['TOTAL', TOTAL_WIDTH],
    ]),
  ];

  if (report.daily.length === 0) {
    lines.push('  no Claude/Codex daily usage observed');
  } else {
    for (const item of report.daily) {
      lines.push(
        truncate(
          row([
            [item.harnessId, HARNESS_WIDTH],
            [item.period, PERIOD_WIDTH],
            [formatCount(item.inputTokens), INPUT_WIDTH],
            [formatCount(item.cacheCreationTokens + item.cacheReadTokens), CACHE_WIDTH],
            [formatCount(item.outputTokens), OUTPUT_WIDTH],
            [formatCount(item.totalTokens), TOTAL_WIDTH],
          ]),
          78,
        ),
      );
    }
  }

  lines.push('', 'TREND');
  for (const harness of report.harnesses) {
    const trend = harness.burnTrend;
    lines.push(
      truncate(
        '  ' +
          harness.harnessId +
          ': ' +
          trend.state +
          '; recent=' +
          (trend.recentAverageTokensPerDay === null
            ? '?'
            : formatCount(trend.recentAverageTokensPerDay) + ' tok/day') +
          '; previous=' +
          (trend.previousAverageTokensPerDay === null
            ? '?'
            : formatCount(trend.previousAverageTokensPerDay) + ' tok/day') +
          (trend.changePercent === null ? '' : '; change=' + String(trend.changePercent) + '%'),
        78,
      ),
    );
  }

  lines.push('', 'SESSIONS');
  if (report.sessions.length === 0) {
    lines.push('  no Claude/Codex sessions observed');
  } else {
    const recent = report.sessions.slice(-5).reverse();
    for (const item of recent) {
      lines.push(
        truncate(
          '  ' +
            item.harnessId +
            ' - ' +
            item.sessionId +
            ' - ' +
            formatCount(item.totalTokens) +
            ' tokens - ' +
            (item.lastActivity ?? 'activity time unknown'),
          78,
        ),
      );
    }
    if (report.sessions.length > recent.length) {
      lines.push(
        '  showing ' +
          formatCount(recent.length) +
          ' most recent of ' +
          formatCount(report.sessions.length) +
          ' sessions',
      );
    }
  }

  lines.push(
    '',
    '  Local token history is not converted into subscription quota or spend.',
  );
  return document(lines);
}
