/** Local CCR usage observation shared by routing metrics and paired task captures. */

import {
  CCR_REVIEWED_VERSION,
  CcrManagementClient,
  ccrAgentForHarness,
  readCcrVersion,
  reduceCcrSessionUsage,
  type CcrObservedRequestUsage,
  type CcrSessionUsage,
} from '@token-harness/adapters';
import {
  SMART_ROUTING_EVENT_PREFIX,
  isSmartRoutingDecisionEvent,
  type SmartRoutingDecisionEvent,
  type SmartRoutingHarness,
} from '@token-harness/core';

import type { CommandContext } from './context.js';

export interface CcrUsageReport {
  status: 'observed' | 'partial' | 'unavailable';
  sessionCount: number;
  observedSessionCount: number;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  recordedCostUsd: number | null;
  byModel: CcrObservedRequestUsage[];
}

function combineSessionUsage(rows: readonly CcrSessionUsage[]): CcrUsageReport {
  const byModel = new Map<string, CcrObservedRequestUsage>();
  for (const row of rows) {
    for (const model of row.byModel) {
      const current = byModel.get(model.model) ?? {
        ...model,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        recordedCostUsd: 0,
      };
      current.requestCount += model.requestCount;
      current.inputTokens += model.inputTokens;
      current.outputTokens += model.outputTokens;
      current.cacheReadTokens += model.cacheReadTokens;
      current.cacheWriteTokens += model.cacheWriteTokens;
      current.totalTokens += model.totalTokens;
      if (current.recordedCostUsd === null || model.recordedCostUsd === null) {
        current.recordedCostUsd = null;
      } else {
        current.recordedCostUsd += model.recordedCostUsd;
      }
      byModel.set(model.model, current);
    }
  }
  const models = [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
  const allCostsKnown = rows.length > 0 && rows.every((row) => row.recordedCostUsd !== null);
  return {
    status: rows.length === 0 ? 'unavailable' : 'observed',
    sessionCount: rows.length,
    observedSessionCount: rows.length,
    requestCount: rows.reduce((total, row) => total + row.requestCount, 0),
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    cacheReadTokens: rows.reduce((total, row) => total + row.cacheReadTokens, 0),
    cacheWriteTokens: rows.reduce((total, row) => total + row.cacheWriteTokens, 0),
    totalTokens: rows.reduce((total, row) => total + row.totalTokens, 0),
    recordedCostUsd: allCostsKnown
      ? rows.reduce((total, row) => total + (row.recordedCostUsd ?? 0), 0)
      : null,
    byModel: models,
  };
}

export async function observeCcrUsage(input: {
  context: CommandContext;
  events: readonly SmartRoutingDecisionEvent[];
  since: string;
  until: string;
}): Promise<{ usage: CcrUsageReport; failedSessions: number }> {
  const unique = new Map<string, { harness: SmartRoutingHarness; sessionId: string }>();
  for (const event of input.events) {
    if (event.sessionId) {
      unique.set(`${event.harnessId}:${event.sessionId}`, {
        harness: event.harnessId,
        sessionId: event.sessionId,
      });
    }
  }
  const entries = [...unique.values()];
  const bounded = entries.slice(0, 20);
  if (bounded.length === 0) {
    return {
      usage: {
        status: 'unavailable',
        sessionCount: 0,
        observedSessionCount: 0,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        recordedCostUsd: null,
        byModel: [],
      },
      failedSessions: 0,
    };
  }
  const client = new CcrManagementClient({
    ...(input.context.env?.['CCR_WEB_URL'] === undefined
      ? {}
      : { baseUrl: input.context.env['CCR_WEB_URL'] }),
    ...(input.context.env?.['CCR_WEB_AUTH_TOKEN'] === undefined
      ? {}
      : { authToken: input.context.env['CCR_WEB_AUTH_TOKEN'] }),
    ...(input.context.ccrFetch === undefined ? {} : { fetcher: input.context.ccrFetch }),
  });
  const appInfo = await client.call('getAppInfo');
  if (readCcrVersion(appInfo) !== CCR_REVIEWED_VERSION) {
    throw new Error('CCR version is outside the reviewed metadata interface');
  }
  const rows: CcrSessionUsage[] = [];
  let failedSessions = entries.length - bounded.length;
  for (const item of bounded) {
    try {
      const response = await client.call('getAgentAnalysis', [
        {
          agent: ccrAgentForHarness(item.harness),
          sessionAgent: ccrAgentForHarness(item.harness),
          sessionId: item.sessionId,
          range: '7d',
        },
      ]);
      const usage = reduceCcrSessionUsage(
        response,
        item.sessionId,
        ccrAgentForHarness(item.harness),
        input.since,
        input.until,
      );
      if (usage === null) failedSessions += 1;
      else rows.push(usage);
    } catch {
      failedSessions += 1;
    }
  }
  const usage = combineSessionUsage(rows);
  if (failedSessions > 0 && usage.status !== 'unavailable') usage.status = 'partial';
  return { usage: { ...usage, sessionCount: entries.length }, failedSessions };
}

/** Read just the retained decision metadata inside one paired-task time window. */
export async function loadSmartRoutingEventsForWindow(input: {
  context: CommandContext;
  harness: SmartRoutingHarness;
  since: string;
  until: string;
}): Promise<SmartRoutingDecisionEvent[]> {
  const fs = input.context.adapters?.fs;
  const stateRoot = input.context.stateRoot;
  if (fs === undefined || stateRoot === null) return [];
  const directory = fs.join(stateRoot, 'smart-routing');
  let names: string[];
  try {
    names = (await fs.readDirectory(directory))
      .filter((name) =>
        new RegExp(`^${SMART_ROUTING_EVENT_PREFIX}\\d{13}-[a-z0-9]+\\.json$`).test(name),
      )
      .sort();
  } catch {
    return [];
  }
  const start = Date.parse(input.since);
  const end = Date.parse(input.until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return [];
  const events: SmartRoutingDecisionEvent[] = [];
  for (const name of names) {
    try {
      const value: unknown = JSON.parse(
        new TextDecoder().decode(await fs.readFile(fs.join(directory, name))),
      );
      if (!isSmartRoutingDecisionEvent(value) || value.harnessId !== input.harness) continue;
      const timestamp = Date.parse(value.timestamp);
      if (Number.isFinite(timestamp) && timestamp >= start && timestamp <= end) events.push(value);
    } catch {
      // Malformed records are ignored here and reported by the routing metrics command.
    }
  }
  return events;
}
