/**
 * `token-harness mcp` — RFC 0011 Phase 18.2.
 *
 * Focused, read-only MCP inventory derived from the same native observations as `context`.
 */

import {
  EXIT_CODES,
  commandResult,
  type CommandResult,
  type McpReport,
} from '@token-harness/core';

import type { CommandContext } from './context.js';
import { runContext } from './context-cost.js';

export async function runMcp(context: CommandContext): Promise<CommandResult<McpReport>> {
  const contextResult = await runContext(context);
  const source = contextResult.data;
  const report: McpReport = {
    platform: context.platform,
    projectRoot: context.projectRoot,
    observedAt: source?.observedAt ?? context.now(),
    harnesses: [],
  };

  if (source !== null) {
    for (const harness of source.harnesses) {
      report.harnesses.push({
        harnessId: harness.harnessId,
        state: harness.state,
        servers: harness.mcpServers,
        knownToolCount: harness.mcpServers.reduce(
          (total, server) => total + (server.toolCount ?? 0),
          0,
        ),
        unknownToolServerCount: harness.mcpServers.filter(
          (server) => server.toolCount === null,
        ).length,
        inventoryTruncated: harness.mcpInventoryTruncated,
        diagnostics: harness.diagnostics.filter((item) =>
          item.code.includes('mcp'),
        ),
      });
    }
  }

  return commandResult({
    command: 'mcp',
    exitCode: EXIT_CODES.ok,
    data: report,
    diagnostics: contextResult.diagnostics.filter(
      (item) => item.code.includes('mcp') || item.code === 'context-harness-unsupported',
    ),
  });
}
