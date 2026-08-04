/**
 * `token-harness apply` end to end — RFC 0004 §Transaction lifecycle, RFC 0006 §Plan persistence.
 *
 * The first command that writes, so this runs the whole thing against a real filesystem: a
 * temporary home with its own `.claude/settings.json`, a temporary state root, and the real
 * transaction layer. An in-memory double could not check the property that matters most — that
 * the user's own hook entry is still there afterwards.
 *
 * `rtk` and `claude` resolve to the Node binary so `--version` prints something and RTK reads
 * as installed while Claude reads as present. Nothing else resolves, so the suite needs no
 * upstream executable and behaves the same on a CI runner as here. The injected compatibility
 * row covers exactly the versions this reports, which is what lets the plan through the RFC 0009
 * gate and reach the write this file verifies.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  deriveProjectId,
  type ApplyReport,
  type CliEnvelope,
  type PlanReport,
  type PlatformFacts,
  type ResolvedExecutable,
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

const NOW = '2026-07-31T13:00:00.000Z';
const SALT = 'e'.repeat(64);

/** A user hook that must survive everything below. */
const USER_HOOK = {
  theme: 'dark',
  hooks: {
    PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'my-own-linter' }] }],
  },
};

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-apply-'));
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

function world(settings: unknown): World {
  counter += 1;
  const root = join(sandbox, `w-${String(counter)}`);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
  const file = join(home, '.claude', 'settings.json');
  if (settings !== null) writeFileSync(file, JSON.stringify(settings, null, 2));
  return { home, state, project, settings: file };
}

function resolve(name: string): ResolvedExecutable | null {
  // `rtk` and `claude` resolve to the Node binary; nothing else does.
  //
  // Pointing them at the Node binary makes `--version` print a version, so RTK reads as
  // installed and the plan carries no install action — which the executor does not implement
  // anyway — and Claude reads as present, which the compatibility row (injected below) admits.
  // Resolving nothing at all would make every plan start with an install and never reach the
  // write this file is about.
  if (name !== 'rtk' && name !== 'claude') return null;
  return { requested: name, path: process.execPath, kind: 'native' };
}

interface Captured<T> {
  exitCode: number;
  data: T | null;
  envelope: CliEnvelope<T>;
}

async function invoke<T>(
  argv: readonly string[],
  place: World,
  resolveRunner: (name: string) => ResolvedExecutable | null = resolve,
): Promise<Captured<T>> {
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
      runner: new NodeProcessRunner({ facts: FACTS, env: process.env, resolve: resolveRunner }),
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
    now: () => NOW,
  };
  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<T>;
  return { exitCode, data: envelope.data, envelope };
}

describe('confirmation', () => {
  it('refuses without --yes and changes nothing', async () => {
    const place = world(USER_HOOK);
    const before = readFileSync(place.settings, 'utf8');
    const result = await invoke<ApplyReport>(['apply'], place);

    // RFC 0006 §Exit codes: 8 is `confirmation-required`, and "mutating commands are dry-run by
    // default".
    assert.equal(result.exitCode, 8);
    assert.equal(readFileSync(place.settings, 'utf8'), before);
  });

  it('carries no data, because 8 is an error status', async () => {
    const result = await invoke<ApplyReport>(['apply'], world(USER_HOOK));
    // RFC 0006: "`data` … null when status is `error`". Asserted rather than worked around: the
    // human renderer reads the same field, and the two renderings have to agree.
    assert.equal(result.data, null);
  });

  it('names the plan it would have run, in the diagnostic', async () => {
    const result = await invoke<ApplyReport>(['apply'], world(USER_HOOK));
    const refusal = result.envelope.diagnostics.find(
      (entry) => entry.code === 'confirmation-required',
    );
    // Without an id the refusal cannot be acted on, and `data` is not available to carry it.
    assert.match(refusal?.message ?? '', /^Plan [0-9a-f]{8} would run 1 action against 1 file$/);
    assert.match(refusal?.remediation ?? '', /--yes/);
  });
});

describe('a committed apply', () => {
  it('writes the hook and commits', async () => {
    const place = world(USER_HOOK);
    const result = await invoke<ApplyReport>(['apply', '--yes'], place);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'committed');
    assert.match(readFileSync(place.settings, 'utf8'), /rtk hook claude/);
  });

  it("leaves the user's own hook entry in place, and first", async () => {
    const place = world(USER_HOOK);
    await invoke<ApplyReport>(['apply', '--yes'], place);
    const written = JSON.parse(readFileSync(place.settings, 'utf8')) as {
      theme: string;
      hooks: { PreToolUse: { matcher: string }[] };
    };

    // The property `append` exists for. A `set` on the list would have replaced this entry, and
    // RFC 0004 scopes ownership to the one entry Token Harness wrote.
    assert.deepEqual(
      written.hooks.PreToolUse.map((entry) => entry.matcher),
      ['Edit', 'Bash'],
    );
    // And nothing else in the document moved.
    assert.equal(written.theme, 'dark');
  });

  it('reports the action it ran with the path it touched', async () => {
    const place = world(USER_HOOK);
    const result = await invoke<ApplyReport>(['apply', '--yes'], place);
    assert.equal(result.data?.results.length, 1);
    assert.equal(result.data?.results[0]?.status, 'applied');
    assert.equal(result.data?.results[0]?.path, place.settings);
  });

  it('leaves a journal and a backup under the transaction id', async () => {
    const place = world(USER_HOOK);
    const result = await invoke<ApplyReport>(['apply', '--yes'], place);
    const transactionId = result.data?.transactionId;
    assert.ok(transactionId);

    // RFC 0004 §Backup policy: the snapshot is what a rollback works from, and the journal is
    // what a rollback after a crash reads.
    assert.ok(readdirSync(join(place.state, 'journals')).includes(`${transactionId}.json`));
    assert.ok(readdirSync(join(place.state, 'backups')).includes(transactionId));
  });

  it('is idempotent: a second apply has nothing to do', async () => {
    const place = world(USER_HOOK);
    await invoke<ApplyReport>(['apply', '--yes'], place);
    const written = readFileSync(place.settings, 'utf8');

    const again = await invoke<ApplyReport>(['apply', '--yes'], place);
    assert.equal(again.exitCode, 0);
    assert.equal(again.data?.outcome, 'nothing-to-do');
    // Not "applied again harmlessly": the file is untouched, because the plan was empty.
    assert.equal(readFileSync(place.settings, 'utf8'), written);
  });

  it('applies nothing when the harness itself cannot be detected', async () => {
    // No settings file and no runnable `claude`, so there is no evidence the harness is here.
    // The runner here overrides the suite default: `claude` stays unresolvable, so detection
    // has nothing to go on — a settings file is the other evidence, and there is none.
    //
    // My first version of this test expected the file to be *created*. That was wrong: a machine
    // where the harness cannot be detected is not a machine to plan for, and writing a
    // configuration file for a harness that may not be installed is exactly the inference
    // RFC 0002 §Detection forbids. `createIfMissing` remains correct for the
    // detected-but-unwritten case, and it is covered against the adapter directly.
    const place = world(null);
    const noClaude = (name: string): ResolvedExecutable | null =>
      name === 'rtk' ? resolve(name) : null;
    const result = await invoke<ApplyReport>(['apply', '--yes'], place, noClaude);

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.outcome, 'nothing-to-do');
    assert.throws(() => readFileSync(place.settings, 'utf8'));
  });
});

describe('a change the user did not ask for is reported', () => {
  it('warns when editing reformats the document', async () => {
    const place = world(null);
    // Hand-formatted, with a nested object on one line, which `JSON.stringify` cannot reproduce
    // — so the whole document is rewritten.
    const compact = [
      '{',
      '  "theme": "dark",',
      '  "hooks": {',
      '    "PreToolUse": [',
      '      { "matcher": "Edit", "hooks": [{ "type": "command", "command": "x" }] }',
      '    ]',
      '  }',
      '}',
      '',
    ].join('\n');
    writeFileSync(place.settings, compact);

    const result = await invoke<ApplyReport>(['apply', '--yes'], place);
    assert.equal(result.exitCode, 0);

    // This warning reached the journal and not the user until the transaction was changed to
    // surface a succeeding action's diagnostics. Token Harness reformatted a file and said
    // nothing, which is the failure RFC 0004's ownership model exists to prevent.
    assert.ok(
      result.envelope.diagnostics.some((entry) => entry.code === 'json-formatting-not-preserved'),
      `expected the reformatting warning, got ${JSON.stringify(result.envelope.diagnostics.map((entry) => entry.code))}`,
    );
  });
});

describe('plan persistence', () => {
  it('writes the plan under its id and reports it as persisted', async () => {
    const place = world(USER_HOOK);
    const result = await invoke<PlanReport>(['plan'], place);

    assert.equal(result.data?.persisted, true);
    const planId = result.data?.planId;
    assert.ok(planId);
    assert.ok(readdirSync(join(place.state, 'plans')).includes(`${planId}.json`));
  });

  it('gives the same plan the same id twice', async () => {
    const place = world(USER_HOOK);
    const first = await invoke<PlanReport>(['plan'], place);
    const second = await invoke<PlanReport>(['plan'], place);
    // "identical inputs produce identical IDs".
    assert.equal(first.data?.planId, second.data?.planId);
  });

  it('gives a different home a different plan id', async () => {
    const first = await invoke<PlanReport>(['plan'], world(USER_HOOK));
    const second = await invoke<PlanReport>(['plan'], world(USER_HOOK));
    // "a changed environment produces a different one". I expected these to match at first, and
    // they should not: the action writes a different absolute path, so it is a different plan.
    assert.notEqual(first.data?.planId, second.data?.planId);
  });

  it('applies a stored plan by id', async () => {
    const place = world(USER_HOOK);
    const planned = await invoke<PlanReport>(['plan'], place);
    const planId = planned.data?.planId;
    assert.ok(planId);

    const applied = await invoke<ApplyReport>(['apply', '--yes', '--plan', planId], place);
    assert.equal(applied.exitCode, 0);
    assert.equal(applied.data?.fromStoredPlan, true);
    assert.match(readFileSync(place.settings, 'utf8'), /rtk hook claude/);
  });

  it('rejects a plan id that does not exist', async () => {
    const result = await invoke<ApplyReport>(
      ['apply', '--yes', '--plan', 'deadbeef'],
      world(USER_HOOK),
    );
    assert.equal(result.exitCode, 2);
  });

  it('rejects a plan id that is not shaped like one', async () => {
    const result = await invoke<ApplyReport>(
      ['apply', '--yes', '--plan', 'nope'],
      world(USER_HOOK),
    );
    // A usage error rather than "no such plan": sending the user to look for a file that could
    // never have existed is worse than telling them the argument is wrong.
    assert.equal(result.exitCode, 2);
  });

  it('rejects a stored plan whose file was edited afterwards', async () => {
    const place = world(USER_HOOK);
    const planned = await invoke<PlanReport>(['plan'], place);
    const planId = planned.data?.planId;
    assert.ok(planId);

    const path = join(place.state, 'plans', `${planId}.json`);
    const stored = JSON.parse(readFileSync(path, 'utf8')) as { actions: { id: string }[] };
    const first = stored.actions[0];
    assert.ok(first);
    first.id = 'tampered';
    writeFileSync(path, JSON.stringify(stored, null, 2));

    const applied = await invoke<ApplyReport>(['apply', '--yes', '--plan', planId], place);
    // RFC 0006: rejected with the precondition-drift code, "before any action executes". The id
    // a reviewer approved no longer describes the artifact.
    assert.equal(applied.exitCode, 5);
    assert.doesNotMatch(readFileSync(place.settings, 'utf8'), /rtk hook claude/);
  });

  it('rejects a stored plan computed for another project', async () => {
    const place = world(USER_HOOK);
    const planned = await invoke<PlanReport>(['plan'], place);
    const planId = planned.data?.planId;
    assert.ok(planId);

    const elsewhere = world(USER_HOOK);
    // Same state directory, different project. RFC 0006 §Plans are scoped to a project: without
    // the binding, an id computed in one repository could be applied in another.
    const applied = await invoke<ApplyReport>(['apply', '--yes', '--plan', planId], {
      ...elsewhere,
      state: place.state,
    });
    assert.equal(applied.exitCode, 5);
  });
});
