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

import type { CliEnvelope, PlanReport, PlatformFacts, ProcessRunner } from '@token-harness/core';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { fakeResolve, nodeVersionRows } from '@token-harness/tests';
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
  const nodeRunner = new NodeProcessRunner({
    facts: FACTS,
    env: process.env,
    // `rtk` and `claude` resolve to the Node binary; nothing else does.
    //
    // The suite needs both versions observed: RFC 0009 admits a managed mutation only
    // inside a compatibility row, and a row cannot admit a version nothing reported. The
    // `claude --version` probe would spawn the real binary on the developer's machine and
    // nothing on Linux, so resolving to the running Node keeps the suite honest on every
    // runner — AGENTS.md forbids a test requiring an upstream executable, and Node is the
    // interpreter the test already runs under.
    resolve: fakeResolve,
  });
  const runner: ProcessRunner = {
    run(request) {
      if (
        request.executable === 'token-harness' &&
        request.args.join(' ') === '__internal-rtk-hook claude --check'
      ) {
        return Promise.resolve({
          displayCommand: 'token-harness __internal-rtk-hook claude --check',
          interpreter: 'direct',
          executablePath: '/test/token-harness',
          exitCode: 0,
          signal: null,
          stdout: 'token-harness-rtk-hook-proxy-v1\n',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 0,
          timedOut: false,
          failure: null,
        });
      }
      return nodeRunner.run(request);
    },
  };
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
      runner,
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
    // RFC 0009: the fake environment observes both versions (Node's), and this table covers
    // exactly what it observes, so the machinery under test — not the gate — is what runs.
    compatibilityRows: nodeVersionRows(FACTS),
    metrics: null,
    now: () => NOW,
  });
  return { exitCode, report: (JSON.parse(stdout) as CliEnvelope<PlanReport>).data };
}

/** The complete RTK hook a configured installation carries on this runner. */
const RTK_HOOK = {
  hooks: {
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
      ...(FACTS.os === 'windows'
        ? [{ matcher: 'PowerShell', hooks: [{ type: 'command', command: 'rtk hook claude' }] }]
        : []),
    ],
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
  it('routes the existing native hook through the per-agent tracker', async () => {
    const { exitCode, report } = await planIn(homeWith(RTK_HOOK));

    assert.equal(exitCode, 0);
    assert.ok(report);
    const migrationActions = report.actions.filter((action) => action.kind === 'merge-json');
    const expectedPointers =
      FACTS.os === 'windows'
        ? ['hooks.PreToolUse.0.hooks.0.command', 'hooks.PreToolUse.1.hooks.0.command']
        : ['hooks.PreToolUse.0.hooks.0.command'];
    assert.deepEqual(
      migrationActions.flatMap((action) => action.ownedPointers).sort(),
      expectedPointers,
      'every existing direct RTK hook must be migrated',
    );
    const bashHook = migrationActions.find((action) =>
      action.ownedPointers.includes('hooks.PreToolUse.0.hooks.0.command'),
    );
    assert.ok(bashHook, 'the existing Bash hook must be migrated');
    assert.deepEqual(bashHook.operations, [
      {
        kind: 'set',
        pointer: 'hooks.PreToolUse.0.hooks.0.command',
        value: 'token-harness __internal-rtk-hook claude --restore-rtk',
        expectedValueDigest: bashHook.operations[0]?.expectedValueDigest,
      },
    ]);
  });

  it('keeps ownership visible while the native hook still needs migration', async () => {
    const { report } = await planIn(homeWith(RTK_HOOK));
    assert.ok(report);
    assert.equal(report.actions.length, FACTS.os === 'windows' ? 2 : 1);
    assert.ok(report.ownership.some((entry) => entry.owner === 'rtk'));
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
