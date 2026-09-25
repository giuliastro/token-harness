import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  commandResult,
  toEnvelope,
  type CliEnvelope,
  type SmartRoutingMetricsReport,
} from '@token-harness/core';
import type { SmartRoutingCommandReport } from '../src/commands/smart-routing.js';
import { GuideService, type GuideCall } from '../src/guided.js';

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('previews and applies shadow Smart Model Routing from the guided service', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] !== 'routing') return envelope(args[0] ?? '', null as T);
    const confirmed = args.includes('--yes');
    const report: SmartRoutingCommandReport = {
      kind: 'ccr-configuration',
      action: 'configure',
      state: confirmed ? 'configured' : 'preview',
      harnessId: 'codex',
      mode: 'shadow',
      ccrVersion: '3.1.1',
      gatewayState: 'running',
      ruleId: 'token-harness-smart-routing-codex-v1',
      scriptPath: '/state/ccr-scripts/smart-routing-codex.js',
      managementEndpoint: 'http://127.0.0.1:3458',
      profileId: 'token-harness-smart-routing-codex-v1',
      launchCommand: 'ccr "Token Harness Codex"',
    };
    return envelope('routing', report as T);
  };

  const service = new GuideService(call, () => 0, () => 'routing-ticket');
  const preview = await service.preview({
    action: 'routing-configure',
    harness: 'codex',
    routeMode: 'shadow',
  });

  assert.equal(preview.ticket, 'routing-ticket');
  assert.equal(preview.network, false);
  assert.match(preview.title, /shadow Smart Model Routing for Codex/);
  assert.match(preview.changes[0]?.description ?? '', /never changed/);

  const applied = await service.apply({ ticket: 'routing-ticket' });
  assert.equal(applied.ok, true);
  assert.equal(applied.title, 'Smart routing configured');
  assert.match(
    applied.messages.join(' '),
    /Shadow mode classifies and records requests locally/,
  );
  assert.match(applied.messages.join(' '), /ccr "Token Harness Codex"/);
  assert.deepEqual(calls, [
    ['routing', '--configure-ccr', '--harness', 'codex', '--route-mode', 'shadow'],
    [
      'routing',
      '--configure-ccr',
      '--harness',
      'codex',
      '--route-mode',
      'shadow',
      '--yes',
    ],
  ]);
});

it('keeps CCR runtime setup separate from routing-rule approval', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const confirmed = args.includes('--yes');
    const report: SmartRoutingCommandReport = {
      kind: 'ccr-lifecycle',
      action: 'install',
      state: confirmed ? 'installed' : 'preview',
      version: '3.1.1',
      packagePath: '/state/ccr/runtime',
      executablePath: '/state/ccr/bin/ccr',
      managementEndpoint: 'http://127.0.0.1:3458',
    };
    return envelope('routing', report as T);
  };

  const service = new GuideService(call, () => 0, () => 'runtime-ticket');
  const preview = await service.preview({
    action: 'routing-configure',
    harness: 'claude',
    routeMode: 'shadow',
  });
  assert.equal(preview.ticket, 'runtime-ticket');
  assert.equal(preview.network, true);
  assert.match(preview.changes[0]?.title ?? '', /Install managed CCR 3\.1\.1/);

  const applied = await service.apply({ ticket: 'runtime-ticket' });
  assert.equal(applied.ok, true);
  assert.equal(applied.title, 'Routing runtime ready');
  assert.match(applied.messages.join(' '), /Choose Set up shadow routing again/);
});

it('reads routing decisions without turning them into savings', async () => {
  const metrics: SmartRoutingMetricsReport = {
    schemaVersion: 1,
    retainedDecisionCount: 8,
    byHarness: { claude: 0, codex: 8 },
    byMode: { shadow: 7, conservative: 1 },
    byTier: { simple: 3, standard: 2, complex: 2, critical: 1 },
    routeMutationRequestCount: 1,
    malformedRecordCount: 0,
    prunedRecordCount: 0,
    retentionLimit: 200,
    savingsStatus: 'not-measured',
    savingsMeasurementCount: 0,
  };
  const call: GuideCall = async <T>(args: readonly string[]) => {
    assert.deepEqual(args, ['routing', '--route-metrics', '--harness', 'codex']);
    const report: SmartRoutingCommandReport = {
      kind: 'metrics',
      since: '2026-09-24T00:00:00.000Z',
      until: '2026-09-25T00:00:00.000Z',
      metrics,
    };
    return envelope('routing', report as T);
  };

  const service = new GuideService(call, () => 0, () => 'unused');
  const result = await service.routingMetrics('codex');

  assert.equal(result.ok, true);
  assert.match(result.messages.join(' '), /Recorded decisions: 8/);
  assert.match(result.messages.join(' '), /Model-switch requests: 1/);
  assert.match(result.messages.join(' '), /not verified savings/i);
});
