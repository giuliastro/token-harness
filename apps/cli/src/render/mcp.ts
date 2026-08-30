import type { McpReport } from '@token-harness/core';

import { document, formatCount, row, truncate, type RenderContext } from './layout.js';

const HARNESS_WIDTH = 9;
const SERVER_WIDTH = 24;
const STATUS_WIDTH = 18;
const AUTH_WIDTH = 14;
const TOOLS_WIDTH = 6;

function value(input: string | null): string {
  return input ?? '-';
}

export function renderMcpReport(report: McpReport, _context: RenderContext): string {
  const lines: string[] = [
    'MCP',
    '',
    row([
      ['HARNESS', HARNESS_WIDTH],
      ['SERVER', SERVER_WIDTH],
      ['STATUS', STATUS_WIDTH],
      ['AUTH', AUTH_WIDTH],
      ['TOOLS', TOOLS_WIDTH],
    ]),
  ];

  let rows = 0;
  for (const harness of report.harnesses) {
    for (const server of harness.servers) {
      rows += 1;
      lines.push(
        truncate(
          row([
            [harness.harnessId, HARNESS_WIDTH],
            [server.name, SERVER_WIDTH],
            [value(server.runtimeStatus), STATUS_WIDTH],
            [value(server.authStatus), AUTH_WIDTH],
            [server.toolCount === null ? '?' : formatCount(server.toolCount), TOOLS_WIDTH],
          ]),
          78,
        ),
      );
    }
  }

  if (rows === 0) lines.push('  no MCP servers observed');

  lines.push('');
  for (const harness of report.harnesses) {
    lines.push(
      truncate(
        '  ' +
          harness.harnessId +
          ': ' +
          formatCount(harness.servers.length) +
          ' servers, ' +
          formatCount(harness.knownToolCount) +
          (harness.unknownToolServerCount > 0
            ? '+? tools (' + formatCount(harness.unknownToolServerCount) + ' unknown servers)'
            : ' tools') +
          (harness.inventoryTruncated ? ', inventory truncated' : ''),
        78,
      ),
    );
  }

  return document(lines);
}
