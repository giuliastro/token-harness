/**
 * RFC 0009 §Compatibility matrix — the managed-mutation gate, end to end.
 *
 * The shipped row table is deliberately empty, so a plan on a real (or realistically faked)
 * machine refuses every managed mutation and names the missing config schema or provider
 * fixture. The exit code separates "nothing to do" (0) from "cannot do this safely" (9), and
 * `doctor` reports the uncovered combination as a warning on the provider it belongs to.
 *
 * The fixtures here are the same temporary-home shape the other suites use: `rtk` and `claude`
 * resolve to the running Node binary so versions are observed, and rows are injected to admit
 * exactly that observation when a test wants the machinery *past* the gate.
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
    cwd: sandbox,
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
  it('refuses the managed mutation with exit 9 and names the missing schema and fixture', async () => {
    const { exitCode, data, diagnostics } = await invoke<PlanReport>(['plan'], null);

    assert.equal(exitCode, EXIT_CODES['unsupported-environment']);
    const blocked = diagnostics.find((entry) => entry.code === 'managed-mutation-blocked');
    assert.ok(
      blocked,
      `expected a managed-mutation-blocked diagnostic, got ${JSON.stringify(diagnostics)}`,
    );
    /**
     * Which of the two refusals applies depends on the platform, so the assertion is on what any of
     * them must say rather than on one wording.
     *
     * The shipped table now holds a Windows `rtk × claude` row. On a Windows runner the fake Claude
     * version therefore lands *outside a row that exists* and the diagnostic names the nearest
     * recording — "a provider fixture covering rtk at 24.13.1 (the nearest row's fixture is …)". On
     * Linux and macOS no row matches the platform at all and the wording is the original "a reviewed
     * config schema and fixture for rtk on claude". Pinning either one would make this test pass on
     * one third of the matrix.
     */
    assert.match(blocked.message, /rtk/);
    assert.match(blocked.message, /claude/);
    assert.match(blocked.message, /fixture/);
    // RFC 0006: an `error` diagnostic empties `data` — the refusal has no report to carry.
    assert.equal(data, null);
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

  it('refuses a harness version outside the row — the matching major still fails', async () => {
    // The observed harness version is Node's, and the injected row admits only up to Node's
    // major minus one minor line: same major as the row's maximum, still outside it. RFC 0009
    // item 29 acceptance: "a matching major version" does not satisfy a row.
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
    const { exitCode, diagnostics } = await invoke<PlanReport>(['plan'], outside);

    assert.equal(exitCode, EXIT_CODES['unsupported-environment']);
    const blocked = diagnostics.find((entry) => entry.code === 'managed-mutation-blocked');
    assert.ok(blocked);
    // The row is present, so the refusal names the missing harness schema rather than the
    // provider fixture.
    assert.match(blocked.message, /harness schema/);
    assert.match(blocked.message, /config-schema-claude/);
  });

  it('refuses when the provider version matches no row, naming the nearest fixture', async () => {
    // The row admits a provider version this machine does not have. The refusal names the
    // provider fixture rather than a harness schema.
    const row = { ...rowFor('rtk', 'claude', FACTS), providerVersion: '0.44.0' };
    const { exitCode, diagnostics } = await invoke<PlanReport>(['plan'], [row]);

    assert.equal(exitCode, EXIT_CODES['unsupported-environment']);
    const blocked = diagnostics.find((entry) => entry.code === 'managed-mutation-blocked');
    assert.ok(blocked);
    assert.match(blocked.message, /provider fixture covering rtk/);
  });
});

describe('apply refuses the same combinations', () => {
  it('returns exit 9 rather than nothing-to-do when the gate refuses', async () => {
    // Regression: `runApply` used to drop the refused actions and report `nothing-to-do` with
    // exit 0, collapsing "already in the desired state" and "a row has not admitted this".
    const { exitCode, data, diagnostics } = await invoke<ApplyReport>(['apply', '--yes'], null);

    assert.equal(exitCode, EXIT_CODES['unsupported-environment']);
    assert.equal(data, null);
    const blocked = diagnostics.find((entry) => entry.code === 'managed-mutation-blocked');
    assert.ok(
      blocked,
      `expected a managed-mutation-blocked diagnostic, got ${JSON.stringify(diagnostics)}`,
    );
  });

  it('reports a missing stored plan before resolving an unrelated default scope', async () => {
    const { exitCode, diagnostics } = await invoke<ApplyReport>(
      ['apply', '--plan', '00000000'],
      null,
    );
    assert.equal(exitCode, EXIT_CODES['usage-error']);
    assert.ok(diagnostics.some((entry) => entry.code === 'plan-not-found'));
  });

  it('still refuses a valid stored plan when its reviewed compatibility row is removed', async () => {
    const home = bareHome();
    const original = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const planned = await invoke<PlanReport>(
      ['plan', '--harness', 'claude'],
      nodeVersionRows(FACTS),
      home,
    );
    const id = planned.data?.planId;
    assert.ok(id);
    const { exitCode, diagnostics } = await invoke<ApplyReport>(
      ['apply', '--plan', id, '--yes'],
      [],
      home,
    );
    assert.equal(exitCode, EXIT_CODES['unsupported-environment']);
    assert.ok(diagnostics.some((entry) => entry.code === 'managed-mutation-blocked'));
    assert.equal(readFileSync(join(home, '.claude', 'settings.json'), 'utf8'), original);
  });
});

describe('doctor and the row table', () => {
  it('reports an uncovered combination as a warning on the provider', async () => {
    const { exitCode, data } = await invoke<DoctorReport>(['doctor'], null, wiredHome());

    // The observed version (Node's) is outside the adapters' tested ranges, so doctor already
    // reports `unknown-newer` problems — that exit is about the environment, not about rows.
    assert.equal(exitCode, EXIT_CODES['problems-found']);
    assert.ok(data);
    const rtk = data.providers.find((entry) => entry.providerId === 'rtk');
    assert.ok(rtk);
    const warning = rtk.warnings.find((entry) => entry.code === 'no-compatibility-row');
    assert.ok(
      warning,
      `expected a no-compatibility-row warning, got ${JSON.stringify(rtk.warnings)}`,
    );
    // Same platform dependency as the refusal above: with a Windows `rtk × claude` row shipped, a
    // Windows runner gets the nearest-fixture wording and the other two get the original. What the
    // warning must do either way is name the provider and say a fixture is what is missing.
    assert.match(warning.message, /rtk/);
    assert.match(warning.message, /fixture/);
  });

  it('reports without counting: problemCount is the same with a covering row', async () => {
    // The no-row warning must not be a problem — the environment is fine, only the product's
    // coverage is incomplete — so the count that drives the exit code ignores it entirely.
    const wired = wiredHome();
    const uncovered = await invoke<DoctorReport>(['doctor'], null, wired);
    const covered = await invoke<DoctorReport>(['doctor'], nodeVersionRows(FACTS), wired);

    assert.ok(uncovered.data);
    assert.ok(covered.data);
    assert.equal(covered.data.problemCount, uncovered.data.problemCount);
    assert.equal(
      covered.data.providers
        .find((entry) => entry.providerId === 'rtk')
        ?.warnings.some((entry) => entry.code === 'no-compatibility-row'),
      false,
      'a covering row must silence the warning',
    );
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
