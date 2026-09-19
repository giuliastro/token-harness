/**
 * RFC 0009 §Compatibility matrix — the managed-mutation gate, end to end.
 *
 * Compatibility rows are historical evidence, not a runtime permission list. A missing or stale
 * row must not block a managed mutation when the installed provider still advertises the harness
 * as assignable; the ordinary ownership, transaction, precondition and verification machinery
 * remains responsible for safety.
 *
 * The fixtures here use the same temporary-home shape as the other suites: `rtk` and `claude`
 * resolve to the running Node binary so deliberately future-looking versions are observed. Rows
 * are still injected where useful to prove that exact historical evidence remains accepted.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import type {
  ApplyReport,
  CliEnvelope,
  CompatibilityRow,
  DoctorReport,
  PlanReport,
  PlatformFacts,
} from '@token-harness/core';
import { EXIT_CODES } from '@token-harness/core';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { fakeResolve, nodeVersionRows, rowFor, NODE_VERSION } from '@token-harness/tests';
import { planExitCode, run } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const NOW = '2026-07-31T12:00:00.000Z';

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-gate-'));
  mkdirSync(join(sandbox, 'project'), { recursive: true });
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A home whose `.claude/settings.json` has no hook, so a plan would propose one. */
function bareHome(): string {
  counter += 1;
  const home = join(sandbox, `home-${String(counter)}`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ theme: 'dark' }, null, 2));
  return home;
}

/** A home whose `.claude/settings.json` already wires rtk, so the provider reads as configured. */
function wiredHome(): string {
  counter += 1;
  const home = join(sandbox, `home-${String(counter)}`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify(
      {
        theme: 'dark',
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
          ],
        },
      },
      null,
      2,
    ),
  );
  return home;
}

interface Captured<T> {
  exitCode: number;
  data: T | null;
  diagnostics: { code: string; message: string }[];
}

async function invoke<T>(
  argv: readonly string[],
  rows: readonly CompatibilityRow[] | null,
  home: string = bareHome(),
): Promise<Captured<T>> {
  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const exitCode = await run({
    argv: [...argv, '--json'],
    streams: { out: (text) => (stdout += text), err: () => undefined },
    platform: FACTS,
    cwd: join(sandbox, 'project'),
    home,
    stateRoot: join(sandbox, 'state'),
    adapters: {
      fs,
      runner: new NodeProcessRunner({ facts: FACTS, env: process.env, resolve: fakeResolve }),
      paths: {
        home,
        config: join(home, 'config'),
        data: join(home, 'data'),
        state: join(sandbox, 'state'),
        cache: join(home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: () => 'p_test',
    },
    compatibilityRows: rows,
    metrics: null,
    now: () => NOW,
  });
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, diagnostics: envelope.diagnostics ?? [] };
}

describe('plan with the shipped (empty) row table', () => {
  it('uses the runtime-assignable surface when no exact compatibility row exists', async () => {
    const { exitCode, data, diagnostics } = await invoke<PlanReport>(['plan'], null);

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data);
    assert.ok(data.actions.some((action) => action.kind === 'merge-json'));
    assert.ok(
      diagnostics.some((entry) => entry.code === 'managed-mutation-forward-compatible'),
      `expected forward-compatible evidence, got ${JSON.stringify(diagnostics)}`,
    );
    assert.equal(
      diagnostics.some((entry) => entry.code === 'managed-mutation-blocked'),
      false,
    );
  });

  it('keeps exit 0 — "nothing to do" — distinct from the refusal', async () => {
    // No harness detected, no provider plan: the plan is empty because there is nothing to do,
    // not because a row refused something. The two empty plans are different outcomes, and the
    // exit code is the contract that says so.
    const { exitCode, data } = await invoke<PlanReport>(['plan', '--harness', 'opencode'], null);

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data);
    assert.deepEqual(data.actions, []);
  });
});

describe('plan with an injected row table', () => {
  it('admits the combination a row covers', async () => {
    const { exitCode, data } = await invoke<PlanReport>(['plan'], nodeVersionRows(FACTS));

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data);
    assert.ok(
      data.actions.some((action) => action.kind === 'merge-json'),
      `expected the hook action, got ${JSON.stringify(data.actions.map((a) => a.kind))}`,
    );
  });

  it('does not turn an older harness-version row into a runtime veto', async () => {
    const row = rowFor('rtk', 'claude', FACTS);
    const outside = [
      {
        ...row,
        harnessVersion: {
          minimum: NODE_VERSION,
          maximum: `${Number(NODE_VERSION.split('.')[0]) - 1}.0.0`,
        },
      },
    ];
    const { exitCode, data, diagnostics } = await invoke<PlanReport>(['plan'], outside);

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data?.actions.some((action) => action.kind === 'merge-json'));
    assert.ok(diagnostics.some((entry) => entry.code === 'managed-mutation-forward-compatible'));
  });

  it('does not turn an older provider-version row into a runtime veto', async () => {
    const row = { ...rowFor('rtk', 'claude', FACTS), providerVersion: '0.44.0' };
    const { exitCode, data, diagnostics } = await invoke<PlanReport>(['plan'], [row]);

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data?.actions.some((action) => action.kind === 'merge-json'));
    assert.ok(diagnostics.some((entry) => entry.code === 'managed-mutation-forward-compatible'));
  });
});

describe('apply refuses the same combinations', () => {
  it('applies through the normal transaction when the runtime surface is assignable', async () => {
    const home = bareHome();
    const original = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const { exitCode, data, diagnostics } = await invoke<ApplyReport>(
      ['apply', '--yes'],
      null,
      home,
    );

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.equal(data?.outcome, 'committed');
    assert.equal(diagnostics.some((entry) => entry.code === 'managed-mutation-blocked'), false);
    const updated = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    assert.notEqual(updated, original);
    assert.match(updated, /rtk hook claude/);
  });

  it('reports a missing stored plan before resolving an unrelated default scope', async () => {
    const { exitCode, diagnostics } = await invoke<ApplyReport>(
      ['apply', '--plan', '00000000'],
      null,
    );
    assert.equal(exitCode, EXIT_CODES['usage-error']);
    assert.ok(diagnostics.some((entry) => entry.code === 'plan-not-found'));
  });

  it('keeps a valid stored plan usable when historical compatibility rows are removed', async () => {
    const home = bareHome();
    const original = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const planned = await invoke<PlanReport>(
      ['plan', '--harness', 'claude'],
      nodeVersionRows(FACTS),
      home,
    );
    const id = planned.data?.planId;
    assert.ok(id);
    const { exitCode, data, diagnostics } = await invoke<ApplyReport>(
      ['apply', '--plan', id, '--yes'],
      [],
      home,
    );
    assert.equal(exitCode, EXIT_CODES.ok);
    assert.equal(data?.outcome, 'committed');
    assert.equal(diagnostics.some((entry) => entry.code === 'managed-mutation-blocked'), false);
    const updated = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    assert.notEqual(updated, original);
    assert.match(updated, /rtk hook claude/);
  });
});

describe('doctor and the row table', () => {
  it('does not report a missing row as a problem when the provider is runtime-assignable', async () => {
    const { exitCode, data } = await invoke<DoctorReport>(['doctor'], null, wiredHome());

    assert.equal(exitCode, EXIT_CODES.ok);
    assert.ok(data);
    assert.equal(data.problemCount, 0);
    const rtk = data.providers.find((entry) => entry.providerId === 'rtk');
    assert.ok(rtk);
    assert.equal(
      rtk.warnings.some(
        (entry) =>
          entry.code === 'no-compatibility-row' || entry.code === 'provider-surface-not-assignable',
      ),
      false,
    );
  });

  it('keeps doctor health independent of whether matching historical evidence exists', async () => {
    const wired = wiredHome();
    const uncovered = await invoke<DoctorReport>(['doctor'], null, wired);
    const covered = await invoke<DoctorReport>(['doctor'], nodeVersionRows(FACTS), wired);

    assert.ok(uncovered.data);
    assert.ok(covered.data);
    assert.equal(covered.data.problemCount, uncovered.data.problemCount);
    assert.equal(covered.exitCode, uncovered.exitCode);
  });
});

describe('the exit code when only part of the machine is covered', () => {
  /**
   * The mixed case cannot be built in the harness above: it needs two installed providers, one
   * admitted with actions and one refused, and `fakeResolve` resolves `rtk` and `claude` alone. So
   * the decision is tested where it lives.
   *
   * On the development machine both directions were run for real. With an isolated home:
   * `plan` produced one action and two refusals and exited 0 with the refusals as warnings; in the
   * project, with nothing to install, the same two refusals exited 9 as errors.
   */
  it('refuses only when the refusal is the whole answer', () => {
    // Nothing else to offer: the refusal is the outcome.
    assert.equal(
      planExitCode({ blocked: 2, actions: 0, conflicts: 0 }),
      EXIT_CODES['unsupported-environment'],
    );
    // A real plan beside an uncovered combination. RFC 0006: "A supported configuration must be
    // able to exit 0."
    assert.equal(planExitCode({ blocked: 2, actions: 1, conflicts: 0 }), EXIT_CODES.ok);
  });

  it('keeps a hard conflict distinct from a refusal', () => {
    assert.equal(
      planExitCode({ blocked: 0, actions: 0, conflicts: 1 }),
      EXIT_CODES['blocked-by-conflict'],
    );
    // A refusal that empties the plan outranks a conflict: "cannot do this safely" is not a
    // dispute the user can resolve by editing configuration.
    assert.equal(
      planExitCode({ blocked: 1, actions: 0, conflicts: 1 }),
      EXIT_CODES['unsupported-environment'],
    );
  });
});
