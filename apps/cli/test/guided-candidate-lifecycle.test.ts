import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  commandResult,
  diagnostic,
  toEnvelope,
  type ApplyReport,
  type CliEnvelope,
  type Diagnostic,
  type ExitCode,
} from '@token-harness/core';
import { GuideError, GuideService, type GuideCall } from '../src/guided.js';
import { GUIDE_HTML, GUIDE_JS } from '../src/guided-assets.js';

function report(
  outcome: ApplyReport['outcome'],
  requestedStateVerified = outcome === 'committed',
): ApplyReport {
  return {
    planId: null,
    transactionId: outcome === 'committed' ? 'candidate-test' : null,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
    ...(requestedStateVerified ? { requestedStateVerified: true } : {}),
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

function confirmation<T>(command: string): CliEnvelope<T> {
  return envelope<T>(command, null, 8, [
    diagnostic({
      severity: 'error',
      code: 'confirmation-required',
      message: 'A reviewed candidate change is available',
      remediation: 'Re-run with --yes',
    }),
  ]);
}

it('previews and applies mcptoon through the candidate selector without promoting a provider', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (!args.includes('--yes')) return confirmation<T>(args[0] ?? '');
    return envelope(args[0] ?? '', report('committed') as T);
  };
  const service = new GuideService(
    call,
    () => 0,
    () => 'candidate-ticket',
  );

  const preview = await service.preview({
    action: 'candidate-setup',
    candidate: 'mcptoon',
    harness: 'codex',
  });
  assert.equal(preview.ticket, 'candidate-ticket');
  assert.equal(
    preview.network,
    true,
    'mcptoon setup conservatively discloses possible pipx network use',
  );
  assert.match(preview.title, /experimental mcptoon/i);
  assert.deepEqual(calls, [['apply', '--candidate', 'mcptoon', '--harness', 'codex']]);
  assert.ok(calls.every((args) => !args.includes('--provider')));
  assert.ok(calls.every((args) => !args.includes('--yes')));

  const applied = await service.apply({ ticket: 'candidate-ticket' });
  assert.equal(applied.ok, true);
  assert.equal(applied.title, 'Experimental setup applied');
  assert.equal(
    service.status().canUndo,
    false,
    'candidate UI never guesses a historical rollback target',
  );
  assert.deepEqual(calls[1], ['apply', '--candidate', 'mcptoon', '--harness', 'codex', '--yes']);
  assert.ok(calls[1]!.every((arg) => arg !== '--provider'));
});

it('previews and removes GitNexus only through its candidate lifecycle', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (!args.includes('--yes')) return confirmation<T>(args[0] ?? '');
    return envelope(args[0] ?? '', report('committed') as T);
  };
  const service = new GuideService(
    call,
    () => 0,
    () => 'remove-candidate',
  );

  const preview = await service.preview({
    action: 'candidate-remove',
    candidate: 'gitnexus',
    harness: 'claude',
  });
  assert.equal(preview.ticket, 'remove-candidate');
  assert.equal(preview.network, false);
  assert.deepEqual(calls, [['uninstall', '--candidate', 'gitnexus', '--harness', 'claude']]);

  const removed = await service.apply({ ticket: 'remove-candidate' });
  assert.equal(removed.ok, true);
  assert.equal(removed.title, 'Experimental integration removed');
  assert.deepEqual(calls[1], [
    'uninstall',
    '--candidate',
    'gitnexus',
    '--harness',
    'claude',
    '--yes',
  ]);
  assert.ok(calls.flat().every((arg) => arg !== '--provider'));
});

it('keeps Headroom and arbitrary selectors outside the managed candidate UI boundary', async () => {
  let calls = 0;
  const service = new GuideService(
    async <T>(args: readonly string[]) => {
      calls += 1;
      return envelope(args[0] ?? '', null as T);
    },
    () => 0,
    () => 'unused',
  );

  await assert.rejects(
    service.preview({ action: 'candidate-setup', candidate: 'headroom', harness: 'claude' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  await assert.rejects(
    service.preview({
      action: 'candidate-setup',
      candidate: 'mcptoon',
      harness: 'codex',
      provider: 'rtk',
    }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  assert.equal(calls, 0, 'invalid candidate UI input must not reach the CLI');
});

it('keeps candidates visibly experimental while exposing only reviewed lifecycle actions', () => {
  assert.match(GUIDE_HTML, /does not silently install or activate them/i);
  assert.match(GUIDE_JS, /Managed evaluation setup/);
  assert.match(GUIDE_JS, /candidate-setup/);
  assert.match(GUIDE_JS, /candidate-remove/);
  assert.match(GUIDE_JS, /remains outside the RTK \+ HarnessTrim production stack/);
  assert.match(GUIDE_JS, /does not install Python, pipx or administrator prerequisites/);
  assert.match(GUIDE_JS, /never creates or refreshes the repository index/);
});
