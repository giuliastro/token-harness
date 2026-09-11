import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  commandResult,
  diagnostic,
  providerId,
  toEnvelope,
  type ApplyReport,
  type CliEnvelope,
  type Diagnostic,
  type ExitCode,
} from '@token-harness/core';
import { GuideError, GuideService, type GuideCall } from '../src/guided.js';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

const RTK = providerId('rtk');

function report(
  outcome: ApplyReport['outcome'],
  transactionId = outcome === 'committed' ? 'uninstall-test' : null,
): ApplyReport {
  return {
    planId: null,
    transactionId,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
  };
}

function envelope<T>(
  command: string,
  data: T | null,
  exitCode: ExitCode = 0,
  diagnostics: Diagnostic[] = [],
): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode, diagnostics }), 'test');
}

it('previews a provider-scoped uninstall without confirmation and applies only after approval', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === 'uninstall' && !args.includes('--yes'))
      return envelope<T>('uninstall', null, 8, [
        diagnostic({
          severity: 'error',
          code: 'confirmation-required',
          message: 'This would remove one owned change',
          remediation: 'Re-run with --yes',
        }),
      ]);
    if (args[0] === 'uninstall' && args.includes('--yes'))
      return envelope('uninstall', report('committed') as T);
    if (args[0] === 'rollback')
      return envelope('rollback', report('rolled-back', 'uninstall-test') as T);
    return envelope(args[0] ?? '', null as T);
  };
  const service = new GuideService(
    call,
    () => 0,
    () => 'remove-ticket',
  );

  const preview = await service.preview({ action: 'remove', provider: RTK });
  assert.equal(preview.ticket, 'remove-ticket');
  assert.equal(preview.network, false);
  assert.equal(preview.restart, true);
  assert.match(preview.title, /RTK/);
  assert.deepEqual(calls, [['uninstall', '--provider', 'rtk']]);
  assert.ok(calls.every((args) => !args.includes('--yes')));

  const applied = await service.apply({ ticket: 'remove-ticket' });
  assert.equal(applied.ok, true);
  assert.equal(applied.title, 'Integration removed');
  assert.equal(applied.appliedPlans, 1);
  assert.deepEqual(calls[1], ['uninstall', '--provider', 'rtk', '--yes']);
  assert.equal(service.status().canUndo, true);

  const undo = await service.preview({ action: 'undo' });
  assert.equal(undo.ticket, 'remove-ticket');
  assert.match(undo.title, /RTK/);
  assert.match(undo.notices[0] ?? '', /exact .* removal transaction/i);
  assert.equal(calls.length, 2, 'Undo preview must not execute rollback');

  const restored = await service.apply({ ticket: 'remove-ticket' });
  assert.equal(restored.ok, true);
  assert.equal(restored.title, 'Backup restored');
  assert.deepEqual(calls[2], ['rollback', '--transaction', 'uninstall-test', '--yes']);
  assert.equal(service.status().canUndo, false);
});

it('does not offer an approval when the provider has no Token Harness-owned change', async () => {
  const call: GuideCall = async <T>(args: readonly string[]) =>
    envelope(args[0] ?? '', report('nothing-to-do') as T);
  const service = new GuideService(
    call,
    () => 0,
    () => 'unused',
  );

  const preview = await service.preview({ action: 'remove', provider: RTK });
  assert.equal(preview.ticket, null);
  assert.equal(preview.changes.length, 0);
  assert.match(preview.notices[0] ?? '', /no Token Harness-owned change/i);
});

it('rejects arbitrary providers and keeps removal inside a reviewed managed-only setup flow', async () => {
  const service = new GuideService(
    async <T>(args: readonly string[]) => envelope(args[0] ?? '', null as T),
    () => 0,
    () => 'unused',
  );
  await assert.rejects(
    service.preview({ action: 'remove', provider: 'headroom' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  await assert.rejects(
    service.preview({ action: 'undo', transaction: 'attacker-selected-id' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  assert.match(GUIDE_HTML, /<summary>Remove managed changes<\/summary>/);
  assert.match(GUIDE_JS, /component\.managedByTokenHarness \|\| component\.configured/);
  assert.match(GUIDE_JS, /provider installation remains user-owned/i);
  assert.match(GUIDE_JS, /\{ action: 'remove', provider: component\.providerId \}/);
  assert.match(GUIDE_JS, /Remove reviewed integration/);
  assert.match(GUIDE_JS, /request\('\/api\/preview', body\)/);
  assert.match(GUIDE_JS, /request\('\/api\/apply', \{ ticket \}\)/);
});
