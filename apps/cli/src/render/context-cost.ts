import type { ContextReport } from '@token-harness/core';

import {
  displayPath,
  document,
  formatCount,
  row,
  truncate,
  truncatePath,
  type RenderContext,
} from './layout.js';

const HARNESS_WIDTH = 9;
const STATE_WIDTH = 9;
const MODEL_WIDTH = 17;
const MCP_WIDTH = 5;
const TOOLS_WIDTH = 6;

function text(value: string | null): string {
  return value ?? '-';
}

function totalTools(report: ContextReport, harnessId: string): string {
  const harness = report.harnesses.find((item) => item.harnessId === harnessId);
  if (harness === undefined) return '-';
  if (harness.mcpServers.some((server) => server.toolCount === null)) return '?';
  return formatCount(
    harness.mcpServers.reduce((total, server) => total + (server.toolCount ?? 0), 0),
  );
}

export function renderContextReport(report: ContextReport, context: RenderContext): string {
  const lines: string[] = ['CONTEXT', ''];
  lines.push(
    row([
      ['HARNESS', HARNESS_WIDTH],
      ['STATE', STATE_WIDTH],
      ['MODEL', MODEL_WIDTH],
      ['MCP', MCP_WIDTH],
      ['TOOLS', TOOLS_WIDTH],
    ]),
  );

  for (const harness of report.harnesses) {
    lines.push(
      truncate(
        row([
          [harness.harnessId, HARNESS_WIDTH],
          [harness.state, STATE_WIDTH],
          [text(harness.model), MODEL_WIDTH],
          [formatCount(harness.mcpServers.length), MCP_WIDTH],
          [totalTools(report, harness.harnessId), TOOLS_WIDTH],
        ]),
        78,
      ),
    );
    if (
      harness.reasoningEffort !== null ||
      harness.verbosity !== null ||
      harness.toolOutputTokenLimit !== null ||
      harness.configInstructionBytes !== null
    ) {
      lines.push(
        truncate(
          '  config: effort=' +
            text(harness.reasoningEffort) +
            ' verbosity=' +
            text(harness.verbosity) +
            ' tool-output=' +
            (harness.toolOutputTokenLimit === null
              ? '-'
              : formatCount(harness.toolOutputTokenLimit)) +
            ' config-instructions=' +
            (harness.configInstructionBytes === null
              ? '-'
              : formatCount(harness.configInstructionBytes) + 'B'),
          78,
        ),
      );
    }
  }

  lines.push('', 'INSTRUCTIONS');
  if (report.instructions.length === 0) {
    lines.push('  none discovered');
  } else {
    for (const item of report.instructions) {
      const path = truncatePath(displayPath(item.path, context.home), 42);
      const loaded = item.loadedBytes === null ? '?' : formatCount(item.loadedBytes) + 'B';
      lines.push(
        truncate(
          row([
            [item.harnessId, HARNESS_WIDTH],
            [item.scope, 8],
            [formatCount(item.byteLength) + 'B', 10],
            [loaded, 10],
            [path, 0],
          ]),
          78,
        ),
      );
    }
    lines.push(
      truncate(
        '  known loaded=' +
          formatCount(report.knownLoadedInstructionBytes) +
          'B; discovered=' +
          formatCount(report.discoveredInstructionBytes) +
          'B; ? means unproven',
        78,
      ),
    );
  }

  lines.push('', 'HIERARCHY');
  if (report.instructionHierarchy.length === 0) {
    lines.push('  no instruction hierarchy observed');
  } else {
    for (const hierarchy of report.instructionHierarchy) {
      const shape =
        hierarchy.projectFileCount === 0
          ? 'none'
          : hierarchy.nestedProjectHierarchy
            ? 'root+subtree'
            : hierarchy.monolithicProjectInstructions
              ? 'monolithic'
              : 'single-scope';
      lines.push(
        truncate(
          '  ' +
            hierarchy.harnessId +
            ': ' +
            shape +
            '; project-files=' +
            formatCount(hierarchy.projectFileCount) +
            '; dirs=' +
            formatCount(hierarchy.distinctProjectDirectories) +
            '; largest=' +
            (hierarchy.largestProjectFileBytes === null
              ? '-'
              : formatCount(hierarchy.largestProjectFileBytes) + 'B'),
          78,
        ),
      );
    }
  }

  return document(lines);
}
