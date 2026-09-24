import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileSystemPort, SmartRoutingDecisionEvent } from '@token-harness/core';

import { runSmartRouting } from '../src/commands/smart-routing.js';
import type { CommandContext } from '../src/commands/context.js';

function memoryFileSystem(initial: Record<string, unknown> = {}) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set(['/state', '/state/smart-routing']);
  for (const [path, value] of Object.entries(initial)) {
    files.set(path, new TextEncoder().encode(JSON.stringify(value)));
  }
  const fs: FileSystemPort = {
    join: (...segments) => segments.join('/').replace(/\/+/g, '/'),
    dirname: (path) => path.slice(0, path.lastIndexOf('/')) || '/',
    basename: (path) => path.slice(path.lastIndexOf('/') + 1),
    isInside: (candidate, parent) => candidate === parent || candidate.startsWith(`${parent}/`),
    stat: async (path) =>
      files.has(path)
        ? { kind: 'file', byteLength: files.get(path)?.length ?? 0, mode: null }
        : null,
    canonicalPath: async (path) => path,
    readFile: async (path) => {
      const content = files.get(path);
      if (content === undefined) throw new Error(`missing ${path}`);
      return content;
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    appendFile: async (path, content) => {
      const previous = files.get(path) ?? new Uint8Array();
      files.set(path, new Uint8Array([...previous, ...content]));
    },
    createDirectory: async (path) => {
      directories.add(path);
    },
    remove: async (path) => {
      files.delete(path);
    },
    readDirectory: async (path) => {
      const prefix = `${path}/`;
      return [...files.keys()]
        .filter((name) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
        .map((name) => name.slice(prefix.length))
        .sort();
    },
  };
  return { fs, files, directories };
}

function routingEvent(input: Partial<SmartRoutingDecisionEvent> = {}): SmartRoutingDecisionEvent {
  return {
    schemaVersion: 1,
    eventId: '1727000000000-test1',
    timestamp: '2026-09-23T12:00:00.000Z',
    source: 'ccr',
    harnessId: 'claude',
    mode: 'shadow',
    classifierVersion: 'heuristic-v1',
    tier: 'simple',
    score: -3.5,
    confidence: 'high',
    reasonCodes: ['short-prompt', 'simple-language-indicator'],
    requestModel: 'Provider/main',
    candidateModel: 'Provider/fast',
    routeMutationRequested: false,
    routeSkipReason: 'shadow-mode',
    promptChars: 14,
    requestInputTokenEstimate: 8,
    toolCount: 0,
    hasImage: false,
    decisionLatencyMs: 1,
    measurement: {
      status: 'not-measured',
      resolvedModel: null,
      providerInputTokens: null,
      providerOutputTokens: null,
      qualityGate: 'unknown',
    },
    ...input,
  };
}

function context(overrides: Partial<CommandContext> = {}, initial: Record<string, unknown> = {}) {
  const memory = memoryFileSystem(initial);
  const result = {
    fs: memory.fs,
    runner: {},
    facts: { os: 'linux' },
    paths: { state: '/state' },
    projectRoot: '/project',
    localDatabase: null,
    projectIdFor: () => 'project-hash',
  };
  const commandContext = {
    adapters: result,
    platform: { os: 'linux', nodeVersion: '22.13.0' },
    projectRoot: '/project',
    home: '/home/dev',
    stateRoot: '/state',
    harness: null,
    provider: null,
    since: null,
    until: null,
    planId: null,
    confirmed: false,
    metrics: null,
    compatibilityRows: null,
    now: () => '2026-09-24T12:00:00.000Z',
    ...overrides,
  } as unknown as CommandContext;
  return { commandContext, ...memory };
}

describe('Smart Model Routing CLI', () => {
  it('exports a shadow CCR script for Claude and Codex without editing CCR configuration', async () => {
    const { commandContext, directories } = context({
      routingScript: true,
      harness: 'claude' as never,
    });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.kind, 'ccr-script');
    if (result.data?.kind !== 'ccr-script') return;
    assert.equal(result.data.harnessId, 'claude');
    assert.equal(result.data.mode, 'shadow');
    assert.match(result.data.script, /return null;/);
    assert.ok(directories.has('/state/smart-routing'));
  });

  it('reports decision counts separately and never turns routing into a savings total', async () => {
    const timestamp = Date.parse('2026-09-23T12:00:00.000Z');
    const event = routingEvent();
    const path = `/state/smart-routing/smart-routing-${String(timestamp).padStart(13, '0')}-test1.json`;
    const { commandContext } = context({ routingMetrics: true }, { [path]: event });
    const result = await runSmartRouting(commandContext);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.kind, 'metrics');
    if (result.data?.kind !== 'metrics') return;
    assert.equal(result.data.metrics.retainedDecisionCount, 1);
    assert.equal(result.data.metrics.byHarness.claude, 1);
    assert.equal(result.data.metrics.savingsStatus, 'not-measured');
    assert.equal(result.data.metrics.savingsMeasurementCount, 0);
  });

  it('prunes only routing records when explicitly requested', async () => {
    const initial: Record<string, unknown> = {};
    for (let index = 0; index < 201; index += 1) {
      const timestamp = Date.parse('2026-09-23T00:00:00.000Z') + index * 1000;
      const id = `${String(timestamp).padStart(13, '0')}-r${String(index).padStart(3, '0')}`;
      initial[`/state/smart-routing/smart-routing-${id}.json`] = routingEvent({
        eventId: id,
        timestamp: new Date(timestamp).toISOString(),
      });
    }
    initial['/state/smart-routing/smart-routing-not-event.json'] = { userOwned: true };
    const { commandContext, files } = context(
      { routingMetrics: true, routingPrune: true },
      initial,
    );
    const result = await runSmartRouting(commandContext);

    assert.equal(result.data?.kind, 'metrics');
    if (result.data?.kind !== 'metrics') return;
    assert.equal(result.data.metrics.prunedRecordCount, 1);
    assert.equal(result.data.metrics.retainedDecisionCount, 200);
    assert.equal(files.size, 201);
  });

  it('requires exactly one routing action', async () => {
    const { commandContext } = context();
    const result = await runSmartRouting(commandContext);
    assert.equal(result.exitCode, 2);
    assert.equal(result.diagnostics[0]?.code, 'routing-action-required');
  });
});
