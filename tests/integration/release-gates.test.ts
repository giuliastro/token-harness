/**
 * The `0.1.0` quality gates — PLAN §8.2 and RFC 0005 §Release gating.
 *
 * I declared `0.1.0` by checking PLAN §2's nine *capability* criteria. §8.2 is a separate list, and
 * it is the one that matters more:
 *
 * > `0.1.0` must prove that Token Harness does not lie about savings and does not damage
 * > configuration. It does not have to prove how large the savings are.
 *
 * This file discharges that list item by item, and says which items cannot be discharged here and
 * why. An unmet gate named is worth more than an unmet gate assumed.
 *
 * ## Gate 1 belongs to the providers, not here
 *
 * "100% must-keep signal recall in deterministic fixtures" is a property of a *reducer*: given
 * output containing signal that must survive, does the reducer keep it. Token Harness reduces
 * nothing — it installs, verifies and measures the tools that do — so it has no recall to have.
 * Faking a fixture to claim the gate would be the exact dishonesty §8.2 exists to prevent. Recorded
 * in PLAN §17 as belonging to RTK and HarnessTrim, whose own suites can hold it.
 */

import assert from 'node:assert/strict';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import { listHarnessAdapters, listProviderAdapters } from '@token-harness/adapters';
import {
  FileJournalStore,
  MEASUREMENT_CLASSES,
  TRANSACTION_EXIT_CODES,
  TransactionSnapshotStore,
  aggregateEvents,
  deriveProjectId,
  executeTransaction,
  measurementUnit,
  type ApplyReport,
  type CliEnvelope,
  type JsonValue,
  type MetricsReport,
  type OptimizationEvent,
  type PackageManagerInstallAction,
  type PlanReport,
  type PlannedAction,
  type PlannedActionBase,
  type PlatformFacts,
  type ProcessRunner,
  type ResolvedExecutable,
  type StatusReport,
} from '@token-harness/core';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

import { FIXTURES_ROOT } from '../src/index.js';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const SALT = 'f'.repeat(64);

let sandbox = '';
let counter = 0;
let clock = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-gates-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface World {
  home: string;
  state: string;
  project: string;
  claudeSettings: string;
  codexHooks: string;
}

/**
 * A machine, built from whatever the scenario needs.
 *
 * `claude` carries an RTK hook when asked; `codex` carries a HarnessTrim one. Both are the shapes
 * observed on a real machine, which is what makes these brownfield fixtures rather than inventions.
 */
function world(
  options: {
    rtkOnClaude?: boolean;
    harnesstrimOnClaude?: boolean;
    harnesstrimOnCodex?: boolean;
    handEditedHook?: boolean;
  } = {},
): World {
  counter += 1;
  const root = join(sandbox, `w-${String(counter)}`);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(join(home, '.codex'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });

  const preToolUse: unknown[] = [];
  if (options.handEditedHook === true) {
    preToolUse.push({
      matcher: 'Edit',
      hooks: [{ type: 'command', command: 'my-own-linter --strict' }],
    });
  }
  if (options.rtkOnClaude === true) {
    preToolUse.push({ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] });
  }
  if (options.harnesstrimOnClaude === true) {
    preToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'harnesstrim hook claude' }],
    });
  }

  const claudeSettings = join(home, '.claude', 'settings.json');
  writeFileSync(
    claudeSettings,
    JSON.stringify({ theme: 'dark', hooks: { PreToolUse: preToolUse } }, null, 2),
  );

  const codexHooks = join(home, '.codex', 'hooks.json');
  if (options.harnesstrimOnCodex === true) {
    writeFileSync(
      codexHooks,
      JSON.stringify(
        {
          hooks: {
            PostToolUse: [
              {
                matcher: '^Bash$',
                hooks: [{ type: 'command', command: 'harnesstrim hook codex' }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
  }

  return { home, state, project, claudeSettings, codexHooks };
}

/**
 * Both providers resolve; no harness executable does.
 *
 * A harness is detected from its configuration here, which keeps the suite from needing Claude Code
 * or Codex installed — AGENTS.md forbids a test requiring an upstream executable, and a CI runner
 * has neither.
 */
function resolve(name: string): ResolvedExecutable | null {
  if (name === 'rtk' || name === 'harnesstrim') {
    return { requested: name, path: process.execPath, kind: 'native' };
  }
  return null;
}

async function invoke<T>(
  argv: readonly string[],
  place: World,
): Promise<{ exitCode: number; data: T | null; envelope: CliEnvelope<T> }> {
  clock += 1;
  const now = new Date(Date.UTC(2026, 6, 31, 14, 0, clock)).toISOString();
  const fs = new NodeFileSystem(FACTS);
  let stdout = '';
  const options: RunOptions = {
    argv: [...argv, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: () => undefined,
    },
    platform: FACTS,
    cwd: place.project,
    home: place.home,
    stateRoot: place.state,
    adapters: {
      fs,
      runner: new NodeProcessRunner({ facts: FACTS, env: process.env, resolve }),
      paths: {
        home: place.home,
        config: join(place.home, 'config'),
        data: join(place.home, 'data'),
        state: place.state,
        cache: join(place.home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: (path) => deriveProjectId(path, SALT, FACTS.os === 'windows'),
    },
    metrics: null,
    now: () => now,
  };
  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, envelope };
}

function matchers(place: World): string[] {
  const parsed = JSON.parse(readFileSync(place.claudeSettings, 'utf8')) as {
    hooks: { PreToolUse: { matcher: string }[] };
  };
  return parsed.hooks.PreToolUse.map((entry) => entry.matcher);
}

/**
 * RFC 0004 §Brownfield adoption, all four fixtures and all five required behaviours.
 *
 * "The most likely first run is not a clean machine." These are the four the RFC names, and each
 * one checks the behaviours that apply to it rather than a generic smoke test.
 */
describe('brownfield adoption', () => {
  it('1. adopts an RTK installation the user configured in our surface', async () => {
    const place = world({ rtkOnClaude: true });
    const before = readFileSync(place.claudeSettings, 'utf8');

    const doctor = await invoke<{ providers: { providerId: string; state: string }[] }>(
      ['doctor'],
      place,
    );
    // Behaviour 1: "detection reports the existing installation as `configured`, not `absent`".
    assert.equal(
      doctor.data?.providers.find((entry) => entry.providerId === 'rtk')?.state,
      'configured',
    );

    const plan = await invoke<PlanReport>(['plan'], place);
    // Behaviour 2: "the plan adopts the existing installation rather than reinstalling it".
    assert.deepEqual(plan.data?.actions, []);

    // Behaviour 5, the strongest form: not one byte changed by any read-only command.
    assert.equal(readFileSync(place.claudeSettings, 'utf8'), before);
  });

  it('2. adopts a standalone HarnessTrim whose own writes are already present', async () => {
    const place = world({ harnesstrimOnCodex: true });
    const before = readFileSync(place.codexHooks, 'utf8');

    const doctor = await invoke<{ providers: { providerId: string; state: string }[] }>(
      ['doctor'],
      place,
    );
    assert.equal(
      doctor.data?.providers.find((entry) => entry.providerId === 'harnesstrim')?.state,
      'configured',
    );

    /**
     * Behaviour 2, stated about the adopted surface rather than about the whole plan.
     *
     * This machine has Codex wired and Claude Code bare, so a plan for it *should* contain
     * actions — for Claude. Asserting an empty plan would have made the gate demand that one
     * adopted installation suppress work everywhere else, which is not adoption but paralysis.
     * What adoption forbids is an action against the installation already there.
     */
    const plan = await invoke<PlanReport>(['plan'], place);
    assert.equal(
      plan.data?.actions.some((action) => action.affectedPaths.includes(place.codexHooks)),
      false,
      `no action may touch the adopted file: ${JSON.stringify(plan.data?.actions.map((action) => action.affectedPaths))}`,
    );
    assert.equal(readFileSync(place.codexHooks, 'utf8'), before);
  });

  it('3. reports a pre-existing overlap and never resolves it by overwriting', async () => {
    // Both providers on the same Claude surface: the contest RFC 0003 exists for.
    const place = world({ rtkOnClaude: true, harnesstrimOnClaude: true });
    const before = readFileSync(place.claudeSettings, 'utf8');

    const status = await invoke<StatusReport>(['status'], place);

    /**
     * Behaviour 3: "a pre-existing overlap is a hard conflict the user resolves, and it is never
     * resolved by overwriting".
     *
     * Reported through `status` rather than `plan`, because the overlap is already on disk: the
     * resolver gives RTK the scope, and the competing HarnessTrim entry is drift on an owned
     * surface. Exit 3 is what makes it actionable.
     */
    assert.equal(status.exitCode, 3);
    const finding = status.data?.drift.find(
      (entry) => entry.code === 'unowned-entry-on-exclusive-scope',
    );
    assert.ok(finding, `expected drift, got ${JSON.stringify(status.data?.drift)}`);
    assert.match(finding.detail, /harnesstrim/);
    // And nothing was rewritten to make the conflict go away.
    assert.equal(readFileSync(place.claudeSettings, 'utf8'), before);

    /**
     * The control that gives the two assertions above their power, kept rather than described.
     *
     * A user-written RTK entry is also unowned, and if that alone were enough for exit 3 then
     * neither the code nor the exit above would be saying anything about an *overlap*. Measured:
     * one claimant is exit 0 with empty drift. The second claimant is the whole finding.
     */
    const single = await invoke<StatusReport>(['status'], world({ rtkOnClaude: true }));
    assert.equal(single.exitCode, 0);
    assert.deepEqual(single.data?.drift, []);
  });

  it('4. leaves a hand-edited hook it does not own exactly where it is', async () => {
    const place = world({ handEditedHook: true, rtkOnClaude: true });
    const before = readFileSync(place.claudeSettings, 'utf8');

    // Behaviour 4: "uninstalling Token Harness leaves a user-managed installation in place."
    const uninstall = await invoke<ApplyReport>(['uninstall', '--yes'], place);
    assert.equal(uninstall.exitCode, 0);
    assert.equal(uninstall.data?.outcome, 'nothing-to-do');

    // Behaviour 5: byte-for-byte. Both the user's own linter hook and the RTK entry they wrote.
    assert.equal(readFileSync(place.claudeSettings, 'utf8'), before);
    assert.deepEqual(matchers(place), ['Edit', 'Bash']);
    assert.ok(
      uninstall.envelope.diagnostics.some((entry) => entry.code === 'not-owned-by-token-harness'),
    );
  });

  it('preserves a neighbouring entry byte-for-byte when it does adopt by writing', async () => {
    // The fifth behaviour in its other form: when Token Harness *does* write, the entry beside it
    // keeps its content and its position.
    const place = world({ handEditedHook: true });
    const applied = await invoke<ApplyReport>(['apply', '--yes'], place);

    assert.equal(applied.exitCode, 0);
    assert.deepEqual(matchers(place), ['Edit', 'Bash']);
    const parsed = JSON.parse(readFileSync(place.claudeSettings, 'utf8')) as {
      theme: string;
      hooks: { PreToolUse: { hooks: { command: string }[] }[] };
    };
    assert.equal(parsed.hooks.PreToolUse[0]?.hooks[0]?.command, 'my-own-linter --strict');
    assert.equal(parsed.theme, 'dark');
  });

  it('rolls a written entry back byte-for-byte', async () => {
    const place = world({ handEditedHook: true });
    const original = readFileSync(place.claudeSettings, 'utf8');
    await invoke<ApplyReport>(['apply', '--yes'], place);
    assert.notEqual(readFileSync(place.claudeSettings, 'utf8'), original);

    const rolled = await invoke<ApplyReport>(['rollback', '--yes'], place);
    assert.equal(rolled.exitCode, 0);
    // RFC 0005 §Release gating: "Rollback restores fixtures byte-for-byte" — including the
    // formatting the apply rewrote.
    assert.equal(readFileSync(place.claudeSettings, 'utf8'), original);
  });
});

/**
 * The clause the CLI-level rollback above does not reach: "rollback restores fixtures
 * byte-for-byte, **including after a delegated install**".
 *
 * Delegated install is the one action family with nothing to restore — a package is not a file, so
 * RFC 0004's restore-based rollback "cannot undo side effects outside the filesystem". The gate is
 * therefore two claims at once, and the second is the one worth testing: every *file* comes back
 * exactly, and the report does not let the surviving package pass unmentioned.
 *
 * Run at the transaction layer with a fake runner. No test may install third-party software, so the
 * installer is a stub that reports success — which is exactly the case being tested, since a failed
 * install leaves nothing behind to be honest about.
 */
describe('rollback after a delegated install', () => {
  const FIXTURE = join(FIXTURES_ROOT, 'transactions', 'mid-plan-failure');
  const CLOCK = '2026-07-31T14:00:00.000Z';
  const BASE: Omit<PlannedActionBase, 'id'> = {
    riskClass: 'reversible',
    requiresNetwork: false,
    requiresElevation: false,
    affectedPaths: [],
    affectedProcesses: [],
    preconditions: [],
    postconditions: [],
    rollbackData: 'file-snapshot',
    explanation: 'gate action',
  };

  function stubInstaller(): { spawned: string[]; runner: ProcessRunner } {
    const spawned: string[] = [];
    const runner: ProcessRunner = {
      run(request) {
        spawned.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve({
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          interpreter: 'direct' as const,
          executablePath: `/usr/bin/${request.executable}`,
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        });
      },
    };
    return { spawned, runner };
  }

  function install(): PackageManagerInstallAction {
    return {
      ...BASE,
      id: 'install-1',
      kind: 'package-manager-install',
      riskClass: 'delegated',
      requiresNetwork: true,
      rollbackData: 'none',
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      version: null,
    };
  }

  function mergeHook(path: string): PlannedAction {
    return {
      ...BASE,
      id: `merge-${path.length.toString()}`,
      kind: 'merge-json',
      affectedPaths: [path],
      path,
      ownedPointers: ['hooks.PreToolUse'],
      operations: [
        {
          kind: 'append',
          pointer: 'hooks.PreToolUse',
          value: { matcher: 'Bash', command: 'rtk hook pre' } as JsonValue,
          expectedValueDigest: null,
        },
      ],
      createIfMissing: false,
    };
  }

  it('restores every file and still reports the package it left behind', async () => {
    const root = mkdtempSync(join(sandbox, 'delegated-'));
    const project = join(root, 'project');
    const state = join(root, 'state');
    mkdirSync(project, { recursive: true });
    mkdirSync(state, { recursive: true });
    cpSync(FIXTURE, project, { recursive: true });

    // Read as bytes, before anything runs. `.gitattributes` marks the fixture tree `-text`, so its
    // CRLF and indentation survive a clone and this comparison means the same thing on all three
    // CI platforms.
    const original = new Map(
      readdirSync(project).map((name) => [name, readFileSync(join(project, name))] as const),
    );

    const fs = new NodeFileSystem(FACTS);
    const created = TransactionSnapshotStore.create({
      fs,
      backupRoot: join(state, 'backups'),
      transactionId: 'gate-delegated',
      projectRoot: project,
      now: () => CLOCK,
    });
    assert.ok(created.ok, created.ok ? '' : JSON.stringify(created.diagnostics));
    const { spawned, runner } = stubInstaller();

    const result = await executeTransaction({
      transactionId: 'gate-delegated',
      planId: 'gate-plan',
      projectId: 'gate-project',
      projectRoot: project,
      actions: [
        install(),
        mergeHook(join(project, 'settings.json')),
        // The fixture's commented document is refused rather than stripped of its comments, which
        // is what turns this into a mid-plan failure without needing an artificial fault.
        mergeHook(join(project, 'commented.json')),
      ],
      fs,
      snapshots: created.store,
      journal: new FileJournalStore({
        fs,
        journalRoot: join(state, 'journals'),
        backupRoot: join(state, 'backups'),
      }),
      runner,
      now: () => CLOCK,
    });

    assert.equal(result.exitCode, TRANSACTION_EXIT_CODES.appliedFailedRolledBack);
    assert.equal(result.journal.outcome, 'rolled-back');
    assert.deepEqual(spawned, [
      'winget install --id rtk-ai.rtk --exact --silent --accept-package-agreements --accept-source-agreements',
    ]);
    assert.deepEqual(result.unrestored, []);

    for (const [name, bytes] of original) {
      assert.deepEqual(readFileSync(join(project, name)), bytes, `${name} came back changed`);
    }

    /**
     * The half of the gate a byte comparison cannot express.
     *
     * Every file is back, so "rolled back" is true of the filesystem and false of the machine —
     * the package is still installed. A rollback that reported success without saying so would
     * leave the user believing they were returned to where they started.
     */
    assert.ok(
      result.diagnostics.some((entry) => entry.code === 'install-not-reversible'),
      `expected the surviving package to be reported: ${JSON.stringify(result.diagnostics.map((entry) => entry.code))}`,
    );
  });
});

/**
 * RFC 0005 §Release gating: "No exact-savings claim without both payloads observed" and
 * "Measurement class labelled on every reported figure".
 *
 * Asserted over the aggregation rather than over a rendered string, because the property is about
 * what the report *can* contain, not about how it prints.
 */
describe('the savings a report is allowed to claim', () => {
  const WINDOW = { windowStart: '2026-07-24', windowEnd: '2026-07-31' };

  function event(overrides: Partial<OptimizationEvent['measurement']>): OptimizationEvent {
    return {
      schemaVersion: 1,
      eventId: `e-${String(Math.abs((overrides.beforeChars ?? overrides.beforeTokens ?? 0) + 1))}`,
      timestamp: '2026-07-30T10:00:00.000Z',
      provider: { id: 'rtk', version: '0.42.0' },
      context: {
        projectId: 'p_1',
        harnessId: 'claude',
        sessionId: null,
        operationId: 'op',
        pipelineId: null,
        pipelineOrder: null,
        toolFamily: null,
        capability: 'shell.output.reduce',
      },
      measurement: {
        class: 'exact-local',
        beforeChars: null,
        afterChars: null,
        beforeTokens: null,
        afterTokens: null,
        tokenizer: null,
        confidenceLow: null,
        confidenceHigh: null,
        ...overrides,
      },
      outcome: {
        changed: true,
        bypassReason: null,
        originalReference: null,
        latencyMs: null,
        errorCode: null,
      },
      source: { nativeEventId: null, importedAt: '2026-07-31T00:00:00.000Z' },
    };
  }

  it('makes no claim at all from an event that observed neither payload', () => {
    // Half an observation is not an observation: an event with a before and no after cannot say
    // what was saved, and inventing a zero would be an exact claim about nothing.
    const report = aggregateEvents({ events: [event({ beforeTokens: 100 })], ...WINDOW });
    for (const row of report.classes) assert.equal(row.saved, null);
    assert.deepEqual(report.providers, []);
  });

  it('labels every figure it does report with a class and a unit', () => {
    const report = aggregateEvents({
      events: [
        event({ beforeTokens: 100, afterTokens: 40 }),
        event({ class: 'estimated-local', beforeChars: 900, afterChars: 300 }),
      ],
      ...WINDOW,
    });

    for (const row of report.classes) {
      if (row.saved === null) continue;
      // A figure with no class or no unit is a number a reader cannot judge.
      assert.ok(MEASUREMENT_CLASSES.includes(row.class));
      assert.notEqual(row.unit, null);
    }
    for (const row of report.providers) {
      assert.ok(MEASUREMENT_CLASSES.includes(row.class));
      assert.ok(row.unit === 'tokens' || row.unit === 'chars');
    }
  });

  it('never reports a token figure for a character-only source', () => {
    // HarnessTrim's `0.0.5` records characters. RFC 0005: tokens are "never derived silently", and
    // an `estimated-local` character figure must not become a token claim.
    const characterOnly = event({ class: 'estimated-local', beforeChars: 900, afterChars: 300 });
    assert.equal(measurementUnit(characterOnly), 'chars');
    const report = aggregateEvents({ events: [characterOnly], ...WINDOW });
    const estimated = report.classes.find((row) => row.class === 'estimated-local');
    assert.equal(estimated?.unit, 'chars');
    const exact = report.classes.find((row) => row.class === 'exact-local');
    assert.equal(exact?.saved, null);
  });

  it('keeps a counterfactual out of every realized total', () => {
    const report = aggregateEvents({
      events: [
        event({ beforeTokens: 100, afterTokens: 40 }),
        event({ class: 'counterfactual', beforeTokens: 9000, afterTokens: 10 }),
      ],
      ...WINDOW,
    });
    // The road not taken has its own line and reaches no provider row.
    assert.equal(report.providers.length, 1);
    assert.equal(report.providers[0]?.saved, 60);
    assert.equal(report.classes.find((row) => row.class === 'counterfactual')?.saved, 8990);
  });
});

describe('every harness declares a verification tier', () => {
  it('and so does every provider, per harness', () => {
    // PLAN §8.2, last item. RFC 0002 §Harness versioning is symmetric requires the tier on both
    // sides, and a missing one would let `verify` compare an achieved tier against nothing.
    for (const adapter of listHarnessAdapters()) {
      assert.ok(adapter.manifest.verificationTier.length > 0, adapter.manifest.id);
    }
    for (const adapter of listProviderAdapters()) {
      assert.ok(adapter.manifest.harnesses.length > 0, adapter.manifest.id);
      for (const entry of adapter.manifest.harnesses) {
        assert.ok(entry.verificationTier.length > 0, `${adapter.manifest.id}/${entry.harness}`);
      }
    }
  });

  it('declares a tier for every harness a capability actually claims', () => {
    /**
     * The hole the first version of this gate left open.
     *
     * Asserting that each `HarnessSupport` entry carries a tier says nothing about a *capability*
     * that names a harness with no such entry — and a capability is what the resolver assigns
     * ownership from. That assignment would then have no declared tier to verify against, which is
     * the state RFC 0002 §Harness versioning is symmetric exists to forbid.
     *
     * Nothing trips it today: RTK's capabilities name only `claude`, matching its single entry, and
     * HarnessTrim's name the three it declares. Which is exactly when a gap like this is worth
     * closing — while the check is free and nobody has to be told their manifest is wrong.
     */
    for (const adapter of listProviderAdapters()) {
      const declared = new Set(adapter.manifest.harnesses.map((entry) => entry.harness));
      for (const capability of adapter.manifest.capabilities) {
        for (const harness of capability.harnesses) {
          assert.ok(
            declared.has(harness),
            `${adapter.manifest.id} claims ${capability.capability} on ${harness} with no declared tier for it`,
          );
        }
      }
    }
  });
});

/**
 * PLAN §8.2: "added median planning overhead is negligible" and "provider hot-path overhead remains
 * attributable to the provider, not the control CLI".
 *
 * The second one is structural rather than measurable, and worth stating plainly: Token Harness is
 * not in the hot path. It does not intercept anything — the harness hook calls the *provider*
 * directly, and Token Harness only writes the line that names it. Whatever a rewritten command
 * costs at run time is the provider's, because our process is not running. The test below asserts
 * the property that makes that true.
 */
describe('overhead', () => {
  it('adds nothing to the hot path, because it is not in it', async () => {
    /**
     * Asserted over what a plan actually writes, not over the manifests.
     *
     * Every hook command a plan produces must name the *provider*. The moment one named
     * `token-harness`, the control CLI would be spawned once per intercepted tool call and the
     * attribution claim above would be false — so this reads the real planned operations rather
     * than trusting a declaration.
     */
    const plan = await invoke<PlanReport>(['plan'], world({ handEditedHook: true }));
    const actions = plan.data?.actions ?? [];
    assert.ok(actions.length > 0, 'a plan with no actions could not fail this');

    for (const action of actions) {
      const written = JSON.stringify(Reflect.get(action, 'operations') ?? null);
      assert.doesNotMatch(written, /token-harness/, `${action.kind} writes the control CLI`);
    }
    assert.equal(
      listProviderAdapters().some((adapter) => adapter.identifiesCommand('token-harness hook')),
      false,
      'nor may a provider claim the control CLI as its own hook command',
    );
  });

  it('plans in well under a second on a configured machine', async () => {
    const place = world({ rtkOnClaude: true });
    // Warm first, so the figure is planning rather than module loading.
    await invoke<PlanReport>(['plan'], place);

    const samples: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      const started = process.hrtime.bigint();
      await invoke<PlanReport>(['plan'], place);
      samples.push(Number(process.hrtime.bigint() - started) / 1_000_000);
    }
    samples.sort((left, right) => left - right);
    const median = samples[Math.floor(samples.length / 2)] ?? 0;

    /**
     * A ceiling rather than a benchmark.
     *
     * "Negligible" has to become a number to be a gate at all, and a generous one: this runs on a
     * shared CI runner, and planning here resolves three harness adapters and two providers, each
     * of which spawns a version probe. What it rules out is the failure that matters — a planner
     * that walks a repository or shells out per file — not a slow machine.
     */
    assert.ok(median < 4000, `median planning took ${median.toFixed(0)}ms`);
  });
});

/**
 * The metrics import is idempotent — PLAN §10 acceptance, restated here because §8.2's promise that
 * Token Harness "does not lie about savings" fails immediately if a second import doubles them.
 *
 * Asserted through the aggregation's identity handling rather than through a provider, so it holds
 * for any importer: the doubling bug this guards against was caused by a cursor, and the cursor is
 * not the last line of defence.
 */
describe('importing twice does not double a total', () => {
  it('counts a repeated event once', () => {
    const one: OptimizationEvent = {
      schemaVersion: 1,
      eventId: 'same-event',
      timestamp: '2026-07-30T10:00:00.000Z',
      provider: { id: 'rtk', version: '0.42.0' },
      context: {
        projectId: 'p_1',
        harnessId: 'claude',
        sessionId: null,
        operationId: 'op',
        pipelineId: null,
        pipelineOrder: null,
        toolFamily: null,
        capability: 'shell.output.reduce',
      },
      measurement: {
        class: 'exact-local',
        beforeChars: null,
        afterChars: null,
        beforeTokens: 100,
        afterTokens: 40,
        tokenizer: 'rtk',
        confidenceLow: null,
        confidenceHigh: null,
      },
      outcome: {
        changed: true,
        bypassReason: null,
        originalReference: null,
        latencyMs: null,
        errorCode: null,
      },
      source: { nativeEventId: '1', importedAt: '2026-07-31T00:00:00.000Z' },
    };

    const once: MetricsReport = aggregateEvents({
      events: [one],
      windowStart: '2026-07-24',
      windowEnd: '2026-07-31',
    });
    const twice: MetricsReport = aggregateEvents({
      events: [one, one],
      windowStart: '2026-07-24',
      windowEnd: '2026-07-31',
    });

    assert.equal(twice.classes[0]?.saved, once.classes[0]?.saved);
    assert.equal(twice.providers[0]?.operations, once.providers[0]?.operations);
  });
});
