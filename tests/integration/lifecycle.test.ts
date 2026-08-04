/**
 * The whole lifecycle — PLAN §2 criteria 4, 5 and 7.
 *
 * `apply` has its own file; this one is about what comes after: verifying, removing, and
 * reversing. The three together are what makes criterion 7 true — "uninstall or roll back without
 * damaging unrelated configuration" — and the damage clause is the one worth testing, so every
 * assertion here checks the user's own hook entry as well as ours.
 *
 * The same injected-home shape as `apply.test.ts`, for the same reason: Claude's primary
 * configuration file is user-scoped, and no test may touch the real home.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type PlatformFacts,
  type ResolvedExecutable,
  type VerifyReport,
} from '@token-harness/core';
import { nodeVersionRows } from '@token-harness/tests';
import { NodeFileSystem, NodeProcessRunner } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const SALT = 'e'.repeat(64);

/** The entry that must survive every command below. */
const USER_HOOK = {
  theme: 'dark',
  hooks: {
    PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-linter' }] }],
  },
};

let sandbox = '';
let counter = 0;
let clock = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-life-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface World {
  home: string;
  state: string;
  project: string;
  settings: string;
}

function world(): World {
  counter += 1;
  const root = join(sandbox, `w-${String(counter)}`);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
  const file = join(home, '.claude', 'settings.json');
  writeFileSync(file, JSON.stringify(USER_HOOK, null, 2));
  return { home, state, project, settings: file };
}

function resolve(name: string): ResolvedExecutable | null {
  // `rtk` and `claude` resolve to the Node binary: RFC 0009 admits a managed mutation only
  // inside a compatibility row, and the injected table (below) covers exactly the versions
  // this reports — Node's own. Nothing else resolves, so no upstream executable is involved.
  if (name !== 'rtk' && name !== 'claude') return null;
  return { requested: name, path: process.execPath, kind: 'native' };
}

async function invoke<T>(
  argv: readonly string[],
  place: World,
): Promise<{ exitCode: number; data: T | null; envelope: CliEnvelope<T> }> {
  // A monotonic clock, because a rollback picks the most recent committed transaction by
  // `startedAt`. A frozen clock would make two transactions in one test indistinguishable and the
  // choice arbitrary.
  clock += 1;
  const now = new Date(Date.UTC(2026, 6, 31, 12, 0, clock)).toISOString();

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
    compatibilityRows: nodeVersionRows(FACTS),
    metrics: null,
    now: () => now,
  };
  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, envelope };
}

function matchers(place: World): string[] {
  const parsed = JSON.parse(readFileSync(place.settings, 'utf8')) as {
    hooks: { PreToolUse: { matcher: string }[] };
  };
  return parsed.hooks.PreToolUse.map((entry) => entry.matcher);
}

describe('uninstall', () => {
  it('removes only what Token Harness owns', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    assert.deepEqual(matchers(place), ['Edit', 'Bash']);

    const result = await invoke<ApplyReport>(['uninstall', '--yes'], place);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'committed');
    // The whole point of criterion 7's "without damaging unrelated configuration": the user's own
    // entry is still there, and only ours is gone.
    assert.deepEqual(matchers(place), ['Edit']);
  });

  it('refuses without --yes', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const result = await invoke<ApplyReport>(['uninstall'], place);

    assert.equal(result.exitCode, 8);
    assert.deepEqual(matchers(place), ['Edit', 'Bash']);
  });

  it('has nothing to remove on a machine it never touched', async () => {
    const result = await invoke<ApplyReport>(['uninstall', '--yes'], world());
    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'nothing-to-do');
  });

  it('refuses to remove a hook the user wrote by hand', async () => {
    /**
     * The regression that matters most in this file.
     *
     * On the machine this was developed against, RTK's hook was added by hand and its command is
     * byte-identical to the one Token Harness would write. `uninstall --yes` planned a removal for
     * it, the digest precondition matched — because the bytes really were the same — and the user's
     * own hook would have been deleted. That is precisely the "damaging unrelated configuration"
     * PLAN §2 criterion 7 forbids, and looking like ours is not the same as being ours.
     *
     * Ownership now comes from a committed journal and from nothing else.
     */
    const place = world();
    const hooks = JSON.parse(readFileSync(place.settings, 'utf8')) as {
      hooks: { PreToolUse: unknown[] };
    };
    hooks.hooks.PreToolUse.push({
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
    writeFileSync(place.settings, JSON.stringify(hooks, null, 2));
    const before = readFileSync(place.settings, 'utf8');

    const result = await invoke<ApplyReport>(['uninstall', '--yes'], place);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'nothing-to-do');
    assert.equal(readFileSync(place.settings, 'utf8'), before);
    assert.ok(
      result.envelope.diagnostics.some((entry) => entry.code === 'not-owned-by-token-harness'),
      `expected the not-owned diagnostic, got ${JSON.stringify(result.envelope.diagnostics.map((entry) => entry.code))}`,
    );
  });

  it('does not report the planner"s install-oriented commentary', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const result = await invoke<ApplyReport>(['uninstall', '--yes'], place);

    // `computePlan` is shared with `apply`, and `already-in-desired-state` printed during a
    // removal reads as "already configured" while the command is removing that configuration.
    assert.equal(
      result.envelope.diagnostics.some((entry) => entry.code === 'already-in-desired-state'),
      false,
    );
  });

  it('leaves the provider itself installed', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const result = await invoke<ApplyReport>(['uninstall', '--yes'], place);
    // RFC 0004: Token Harness removes the configuration it wrote, never a tool the user installed.
    assert.equal(
      result.data?.results.some((entry) => entry.kind.includes('install')),
      false,
    );
  });
});

describe('rollback', () => {
  it('restores the file to what it was before the apply', async () => {
    const place = world();
    const original = readFileSync(place.settings, 'utf8');
    await invoke(['apply', '--yes'], place);

    const result = await invoke<ApplyReport>(['rollback', '--yes'], place);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'rolled-back');
    // Byte for byte, including the formatting the apply rewrote. That is the difference from
    // `uninstall`: a rollback restores the file, not the entry.
    assert.equal(readFileSync(place.settings, 'utf8'), original);
  });

  it('refuses without --yes, and says what it would reverse', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const before = readFileSync(place.settings, 'utf8');

    const result = await invoke<ApplyReport>(['rollback'], place);

    assert.equal(result.exitCode, 8);
    assert.equal(readFileSync(place.settings, 'utf8'), before);
    const refusal = result.envelope.diagnostics.find(
      (entry) => entry.code === 'confirmation-required',
    );
    // Naming the action kinds is what lets a user notice they are walking back past their last
    // apply — running `rollback` twice reverses the transaction before it.
    assert.match(refusal?.message ?? '', /merge-json/);
    // And the surprising half is stated: a rollback is not a removal of one entry.
    assert.match(refusal?.remediation ?? '', /will be lost/);
  });

  it('has nothing to reverse on a machine where nothing was applied', async () => {
    const result = await invoke<ApplyReport>(['rollback', '--yes'], world());
    // RFC 0006: an empty environment is a state, not a problem.
    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'nothing-to-do');
  });

  it('does not reverse the same transaction twice', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const first = await invoke<ApplyReport>(['rollback', '--yes'], place);
    const second = await invoke<ApplyReport>(['rollback', '--yes'], place);

    // The reversed transaction is marked `rolled-back`, so it is no longer a candidate. With only
    // one apply behind it there is nothing else committed to walk back to.
    assert.notEqual(first.data?.transactionId, second.data?.transactionId);
    assert.equal(second.data?.outcome, 'nothing-to-do');
  });

  it('walks back through history when there is more than one transaction', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    await invoke(['uninstall', '--yes'], place);
    assert.deepEqual(matchers(place), ['Edit']);

    // Reversing the uninstall puts our entry back. Correct, and the reason the confirmation names
    // what it is reversing: this is a step backwards in history, not an undo of the last apply.
    const result = await invoke<ApplyReport>(['rollback', '--yes'], place);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(matchers(place), ['Edit', 'Bash']);
  });
});

describe('verify', () => {
  it('runs without a receipt, against the live configuration', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);

    const result = await invoke<VerifyReport>(['verify'], place);

    // The amendment that made this possible: RFC 0006's transcript opens with a receipt line, and
    // an adopted installation has no receipt. Requiring one would refuse to run in the situation
    // RFC 0004 calls normal.
    assert.equal(result.data?.receiptId, null);
    assert.ok((result.data?.results.length ?? 0) > 0);
  });

  it('reports the declared tier for the provider on the harness it is wired to', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const result = await invoke<VerifyReport>(['verify'], place);

    const row = result.data?.results.find((entry) => entry.providerId === 'rtk');
    assert.ok(row);
    assert.equal(row.harnessId, 'claude');
    assert.equal(row.declaredTier, 'canary');
    // RFC 0004 §Brownfield adoption: nothing has been applied *by* Token Harness in the sense of
    // an owned installation, so it says so rather than claiming management.
    assert.equal(row.managedByTokenHarness, false);
  });

  it('reports a harness finding as a diagnostic rather than as a row', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const result = await invoke<VerifyReport>(['verify'], place);

    // A `HarnessVerification` has no provider, and every row in RFC 0006's transcript is
    // `provider — harness`. Forcing it into a row would have to invent a provider for it.
    assert.ok(
      result.envelope.diagnostics.some((entry) => entry.code.startsWith('harness-')),
      `expected a harness diagnostic, got ${JSON.stringify(result.envelope.diagnostics.map((entry) => entry.code))}`,
    );
    assert.equal(
      result.data?.results.some((entry) => entry.providerId === undefined),
      false,
    );
  });

  it('writes nothing', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const before = readFileSync(place.settings, 'utf8');
    await invoke(['verify'], place);
    // RFC 0007: the passive canary reads records the provider already wrote. Nothing here spends a
    // model call, and nothing here writes.
    assert.equal(readFileSync(place.settings, 'utf8'), before);
  });
});
