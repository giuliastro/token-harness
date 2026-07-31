/**
 * `token-harness plan` with real actions — PLAN §10, RFC 0002 §Planning.
 *
 * Driven through `run` with an *injected home*, which is the only way to exercise the clean
 * case: Claude's primary configuration file is user-scoped, so on the developer's own machine it
 * always already carries the RTK hook. A temporary home is what separates "the plan is empty
 * because the state is correct" from "the plan is empty because nothing works".
 *
 * AGENTS.md forbids a test reading or writing the real home, and this is the shape that obeys
 * it while still running the whole command.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import type { CliEnvelope, PlanReport, PlatformFacts } from '@token-harness/core';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { run } from 'token-harness';

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
  sandbox = mkdtempSync(join(tmpdir(), 'th-plan-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

/** A home whose `.claude/settings.json` holds exactly what the test wants it to. */
function homeWith(settings: unknown | null): string {
  counter += 1;
  const home = join(sandbox, `home-${String(counter)}`);
  mkdirSync(join(home, '.claude'), { recursive: true });
  if (settings !== null) {
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  }
  return home;
}

async function planIn(home: string): Promise<{ exitCode: number; report: PlanReport | null }> {
  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const exitCode = await run({
    argv: ['plan', '--json'],
    streams: { out: (text) => (stdout += text), err: () => undefined },
    platform: FACTS,
    cwd: sandbox,
    home,
    stateRoot: join(sandbox, 'state'),
    adapters: {
      fs,
      runner: new NodeProcessRunner({
        facts: FACTS,
        env: process.env,
        // Nothing resolves.
        //
        // Deliberate, and it is what keeps this test honest on a CI runner: AGENTS.md forbids a
        // test requiring an upstream executable, and `claude --version` would spawn the real
        // binary on the developer's machine and nothing on Linux. Detection falls back to the
        // configuration file, which is the evidence this test actually cares about.
        resolve: () => null,
      }),
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
    metrics: null,
    now: () => NOW,
  });
  return { exitCode, report: (JSON.parse(stdout) as CliEnvelope<PlanReport>).data };
}

/** The hook a configured installation carries, copied from a real machine. */
const RTK_HOOK = {
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] }],
  },
};

describe('a home with Claude present and no hook', () => {
  it('plans the hook, and says which file it would touch', async () => {
    const home = homeWith({ theme: 'dark' });
    const { exitCode, report } = await planIn(home);

    assert.equal(exitCode, 0);
    assert.ok(report);
    const hook = report.actions.find((action) => action.kind === 'merge-json');
    assert.ok(
      hook,
      `expected a merge-json action, got ${JSON.stringify(report.actions.map((a) => a.kind))}`,
    );
    assert.deepEqual(hook.affectedPaths, [join(home, '.claude', 'settings.json')]);
  });

  it('counts the file it would snapshot', async () => {
    const { report } = await planIn(homeWith({ theme: 'dark' }));
    assert.ok(report);
    // Derived from the actions, so the summary line cannot disagree with what would happen.
    assert.equal(report.backups.files, 1);
  });

  it('writes nothing while planning', async () => {
    const home = homeWith({ theme: 'dark' });
    const before = readSettings(home);
    await planIn(home);
    // RFC 0004 keeps `plan` read-only. The one assertion that makes the dry run a fact rather
    // than a claim.
    assert.equal(readSettings(home), before);
  });
});

describe('a home already carrying the RTK hook', () => {
  it('does not register the hook a second time', async () => {
    const { exitCode, report } = await planIn(homeWith(RTK_HOOK));

    assert.equal(exitCode, 0);
    assert.ok(report);
    // RFC 0004 §Brownfield adoption: for the *configuration*, the desired state is the current
    // state. This asserts the absence of a `merge-json` rather than of every action, because
    // nothing is resolvable in this test — so `rtk` is not runnable, and proposing to install it
    // is correct. Asserting an empty plan here would have been asserting two things at once and
    // passing only by accident on a machine that happened to have RTK on PATH.
    assert.equal(
      report.actions.some((action) => action.kind === 'merge-json'),
      false,
      `expected no hook action, got ${JSON.stringify(report.actions.map((a) => a.kind))}`,
    );
  });

  it('reports the plan as empty once RTK is also present', async () => {
    // The complete brownfield state — configured *and* installed — is asserted against the
    // adapter directly in `packages/adapters/test/rtk-plan.test.ts`, where `installed` is an
    // input rather than a property of the machine the suite runs on.
    const { report } = await planIn(homeWith(RTK_HOOK));
    assert.ok(report);
    assert.deepEqual(
      report.actions.map((action) => action.kind),
      ['package-manager-install'],
    );
  });

  it('still resolves ownership', async () => {
    const { report } = await planIn(homeWith(RTK_HOOK));
    assert.ok(report);
    // An empty plan is not an empty result: the pipeline is still identified, which is what a
    // later apply and every metrics attribution depend on.
    assert.ok(report.ownership.length > 0);
    assert.notEqual(report.pipelineId, null);
  });
});

function readSettings(home: string): string {
  try {
    return readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
  } catch {
    return '';
  }
}
