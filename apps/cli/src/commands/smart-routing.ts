import {
  EXIT_CODES,
  SMART_ROUTING_EVENT_PREFIX,
  SMART_ROUTING_EVENT_RETENTION_LIMIT,
  aggregateSmartRoutingEvents,
  commandResult,
  diagnostic,
  isSmartRoutingDecisionEvent,
  resolveMetricsWindow,
  type CommandResult,
  type SmartRoutingDecisionEvent,
  type SmartRoutingHarness,
  type SmartRoutingMetricsReport,
  type SmartRoutingMode,
} from '@token-harness/core';
import { createCcrSmartRoutingScript } from '@token-harness/adapters';

import type { CommandContext } from './context.js';

export type SmartRoutingCommandReport =
  | {
      kind: 'ccr-script';
      harnessId: SmartRoutingHarness;
      mode: SmartRoutingMode;
      telemetryDirectory: string;
      script: string;
    }
  | {
      kind: 'metrics';
      since: string;
      until: string;
      metrics: SmartRoutingMetricsReport;
    };

function isSmartRoutingHarness(value: string | null): value is SmartRoutingHarness {
  return value === 'claude' || value === 'codex';
}

function error(
  code: string,
  message: string,
  remediation: string,
): CommandResult<SmartRoutingCommandReport> {
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES['usage-error'],
    diagnostics: [diagnostic({ severity: 'error', code, message, remediation })],
  });
}

export async function runSmartRouting(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const wantsScript = context.routingScript === true;
  const wantsMetrics = context.routingMetrics === true;
  if (wantsScript === wantsMetrics) {
    return error(
      'routing-action-required',
      'Choose one Smart Model Routing action',
      'Use `token-harness routing --script --harness claude` or `token-harness routing --route-metrics`',
    );
  }
  if (context.routingPrune === true && !wantsMetrics) {
    return error(
      'routing-prune-requires-metrics',
      '`--prune` is available only with the routing metrics action',
      'Use `token-harness routing --route-metrics --prune`',
    );
  }
  if (context.routingMode === 'conservative' && !wantsScript) {
    return error(
      'routing-mode-requires-script',
      '`--route-mode` applies only when generating a CCR script',
      'Use `token-harness routing --script --harness codex --route-mode conservative`',
    );
  }

  const fs = context.adapters?.fs;
  const stateRoot = context.stateRoot;
  if (fs === undefined || stateRoot === null) {
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['unsupported-environment'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'routing-state-unavailable',
          message: 'Smart Model Routing requires the protected local Token Harness state directory',
          remediation: 'Resolve the local state directory with `token-harness doctor`',
        }),
      ],
    });
  }

  const telemetryDirectory = fs.join(stateRoot, 'smart-routing');
  if (wantsScript) {
    if (!isSmartRoutingHarness(context.harness)) {
      return error(
        'routing-harness-required',
        'CCR script generation needs Claude Code or Codex as its harness',
        'Pass `--harness claude` or `--harness codex`',
      );
    }
    await fs.createDirectory(telemetryDirectory);
    const script = createCcrSmartRoutingScript({
      harnessId: context.harness,
      mode: context.routingMode ?? 'shadow',
      telemetryDirectory,
      pathSeparator: context.platform.os === 'windows' ? '\\' : '/',
    });
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'ccr-script',
        harnessId: context.harness,
        mode: context.routingMode ?? 'shadow',
        telemetryDirectory,
        script,
      },
    });
  }

  const resolved = resolveMetricsWindow({
    since: context.since,
    until: context.until,
    now: context.now(),
  });
  if (!resolved.ok) {
    return error(
      'invalid-routing-window',
      resolved.failure === 'start-after-end'
        ? `The routing metrics window is empty: ${resolved.detail}`
        : `${JSON.stringify(resolved.detail)} is not a duration such as \`7d\` or a date such as \`2026-09-01\``,
      'Pass `--since 7d`, or `--since 2026-09-01 --until 2026-09-24`',
    );
  }

  const directoryEntries = (await fs.readDirectory(telemetryDirectory))
    .filter((name) =>
      new RegExp(`^${SMART_ROUTING_EVENT_PREFIX}\\d{13}-[a-z0-9]+\\.json$`).test(name),
    )
    .sort();
  let prunedRecordCount = 0;
  if (
    context.routingPrune === true &&
    directoryEntries.length > SMART_ROUTING_EVENT_RETENTION_LIMIT
  ) {
    const removeCount = directoryEntries.length - SMART_ROUTING_EVENT_RETENTION_LIMIT;
    for (const name of directoryEntries.slice(0, removeCount)) {
      await fs.remove(fs.join(telemetryDirectory, name));
    }
    prunedRecordCount = removeCount;
  }

  const retainedNames =
    context.routingPrune === true ? directoryEntries.slice(prunedRecordCount) : directoryEntries;
  const events: SmartRoutingDecisionEvent[] = [];
  let malformedRecordCount = 0;
  for (const name of retainedNames) {
    try {
      const content = new TextDecoder().decode(
        await fs.readFile(fs.join(telemetryDirectory, name)),
      );
      const parsed: unknown = JSON.parse(content);
      if (!isSmartRoutingDecisionEvent(parsed)) {
        malformedRecordCount += 1;
        continue;
      }
      const timestamp = Date.parse(parsed.timestamp);
      if (!Number.isFinite(timestamp)) {
        malformedRecordCount += 1;
        continue;
      }
      if (timestamp < Date.parse(resolved.window.sinceInstant)) continue;
      if (timestamp >= Date.parse(resolved.window.untilInstant)) continue;
      if (context.harness !== null && parsed.harnessId !== context.harness) continue;
      events.push(parsed);
    } catch {
      malformedRecordCount += 1;
    }
  }

  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES.ok,
    data: {
      kind: 'metrics',
      since: resolved.window.sinceInstant,
      until: resolved.window.untilInstant,
      metrics: aggregateSmartRoutingEvents({ events, malformedRecordCount, prunedRecordCount }),
    },
    diagnostics:
      events.length === 0 && malformedRecordCount === 0
        ? [
            diagnostic({
              severity: 'info',
              code: 'routing-decisions-unavailable',
              message: 'No CCR routing decisions are stored for this window',
              remediation:
                'Generate a CCR rule with `token-harness routing --script --harness codex` and add it in CCR Routing',
            }),
          ]
        : [],
  });
}
