import assert from 'node:assert/strict';
import { it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';
import { GuideService, type GuideCall } from '../src/guided.js';
import type { SmartRoutingCommandReport } from '../src/commands/smart-routing.js';

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('guides Smart Model Routing through CCR runtime preparation then shadow rule configuration', async () => {
  const calls: string[][] = [];
  let runtimeReady = false;
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    assert.equal(args[0], 'routing');

    if (args.includes('--route-metrics')) {
      const report: SmartRoutingCommandReport = {
        kind: 'metrics',
        since: '2026-08-26T00:00:00.000Z',
        until: '2026-09-25T00:00:00.000Z',
        metrics: {
          schemaVersion: 1,
          retainedDecisionCount: 4,
          byHarness: { claude: 0, codex: 4 },
          byMode: { shadow: 4, conservative: 0 },
          byTier: { simple: 1, standard: 2, complex: 1, critical: 0 },
          routeMutationRequestCount: 0,
          malformedRecordCount: 0,
          prunedRecordCount: 0,
          retentionLimit: 200,
          savingsStatus: 'not-measured',
          savingsMeasurementCount: 0,
        },
      };
      return envelope('routing', report as T);
    }

    const confirmed = args.includes('--yes');
    if (!runtimeReady) {
      const report: SmartRoutingCommandReport = {
        kind: 'ccr-lifecycle',
        action: 'install',
        state: confirmed ? 'installed' : 'preview',
        version: '3.1.1',
        packagePath: '/state/smart-routing/ccr/versions/3.1.1',
        executablePath: '/state/smart-routing/ccr/versions/3.1.1/node_modules/.bin/ccr',
        managementEndpoint: 'http://127.0.0.1:3458',
      };
      if (confirmed) runtimeReady = true;
      return envelope('routing', report as T);
    }

    const report: SmartRoutingCommandReport = {
      kind: 'ccr-configuration',
      action: 'configure',
      state: confirmed ? 'configured' : 'preview',
      harnessId: 'codex',
      mode: 'shadow',
      ccrVersion: '3.1.1',
      gatewayState: 'running',
      ruleId: 'token-harness-smart-routing-codex-v1',
      scriptPath: '/state/smart-routing/ccr-scripts/smart-routing-codex.js',
      managementEndpoint: 'http://127.0.0.1:3458',
      profileId: 'token-harness-smart-routing-codex-v1',
      launchCommand: 'ccr "Token Harness Codex"',
    };
    return envelope('routing', report as T);
  };

  let ticket = 0;
  const service = new GuideService(
    call,
    () => 0,
    () => 'routing-ticket-' + String(++ticket),
  );

  const first = await service.preview({
    action: 'routing-setup',
    harness: 'codex',
    routeMode: 'shadow',
  });
  assert.equal(first.ticket, 'routing-ticket-1');
  assert.match(first.changes[0]?.title ?? '', /prepare local CCR routing runtime/i);
  assert.ok(first.notices.some((message) => /separate safety stages/i.test(message)));

  const runtime = await service.apply({ ticket: 'routing-ticket-1' });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.title, 'Routing runtime ready');
  assert.ok(runtime.messages.some((message) => /Manage routing again/i.test(message)));

  const second = await service.preview({
    action: 'routing-setup',
    harness: 'codex',
    routeMode: 'shadow',
  });
  assert.equal(second.ticket, 'routing-ticket-2');
  assert.match(second.changes[0]?.title ?? '', /configure Smart Model Routing/i);

  const configured = await service.apply({ ticket: 'routing-ticket-2' });
  assert.equal(configured.ok, true);
  assert.equal(configured.title, 'Smart Model Routing configured');
  assert.ok(
    configured.messages.some((message) => /does not change the request model/i.test(message)),
  );
  assert.ok(configured.messages.some((message) => /ccr "Token Harness Codex"/i.test(message)));

  const metrics = await service.preview({
    action: 'routing-metrics',
    harness: 'codex',
  });
  assert.equal(metrics.ticket, null);
  assert.ok(metrics.notices.some((message) => /4 local routing decisions/i.test(message)));
  assert.ok(metrics.notices.some((message) => /Shadow decisions: 4/i.test(message)));

  assert.deepEqual(calls.slice(0, 4), [
    ['routing', '--configure-ccr', '--harness', 'codex', '--route-mode', 'shadow'],
    ['routing', '--configure-ccr', '--harness', 'codex', '--route-mode', 'shadow', '--yes'],
    ['routing', '--configure-ccr', '--harness', 'codex', '--route-mode', 'shadow'],
    ['routing', '--configure-ccr', '--harness', 'codex', '--route-mode', 'shadow', '--yes'],
  ]);
  assert.deepEqual(calls[4], [
    'routing',
    '--route-metrics',
    '--ccr-usage',
    '--harness',
    'codex',
    '--since',
    '30d',
  ]);
});
