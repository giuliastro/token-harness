/**
 * Action execution against a real filesystem — RFC 0004 §Test requirements.
 *
 * "Every mutating action type requires: apply test; idempotency test; precondition
 * drift test; rollback test; user-modification preservation test; Windows path test
 * where applicable."
 *
 * The last describe block enumerates those six obligations per implemented action
 * kind and fails if one is unclaimed, so the requirement is checked rather than
 * remembered.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  EXECUTABLE_ACTION_KINDS,
  TransactionSnapshotStore,
  applyAction,
  digestText,
  isExecutableActionKind,
  ownedFileDigest,
  type ActionContext,
  type ActionOutcome,
  type CreateDirectoryAction,
  type PatchMarkerBlockAction,
  type PlannedAction,
  type PlannedActionBase,
  type PlannedActionKind,
  type PlatformFacts,
  type RemoveOwnedChangeAction,
  type WriteOwnedFileAction,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';

const NATIVE_WINDOWS = process.platform === 'win32';

const FACTS: PlatformFacts = {
  os: NATIVE_WINDOWS ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const FENCE = { begin: 'token-harness:begin', end: 'token-harness:end' };

/** Which of the six RFC 0004 obligations each test in this file discharges. */
type Obligation =
  | 'apply'
  | 'idempotency'
  | 'precondition-drift'
  | 'rollback'
  | 'user-modification'
  | 'windows-path';

const covered = new Map<PlannedActionKind, Set<Obligation>>();

function claim(kind: PlannedActionKind, ...obligations: Obligation[]): void {
  const set = covered.get(kind) ?? new Set<Obligation>();
  for (const obligation of obligations) set.add(obligation);
  covered.set(kind, set);
}

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-act-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface Harness {
  context: ActionContext;
  store: TransactionSnapshotStore;
  project: string;
}

function harness(): Harness {
  counter += 1;
  const root = join(sandbox, `case-${String(counter)}`);
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const fs = new NodeFileSystem(FACTS);
  const created = TransactionSnapshotStore.create({
    fs,
    backupRoot: join(root, 'state', 'backups'),
    transactionId: 't-0001',
    projectRoot: project,
    now: () => '2026-07-29T10:12:04.000Z',
  });
  assert.ok(created.ok, created.ok ? '' : JSON.stringify(created.diagnostics));
  return { context: { fs, snapshots: created.store }, store: created.store, project };
}

const BASE: Omit<PlannedActionBase, 'id'> = {
  riskClass: 'reversible',
  requiresNetwork: false,
  requiresElevation: false,
  affectedPaths: [],
  affectedProcesses: [],
  preconditions: [],
  postconditions: [],
  rollbackData: 'file-snapshot',
  explanation: 'test action',
};

function writeOwned(
  path: string,
  content: string,
  expectedDigest: string | null,
): WriteOwnedFileAction {
  return {
    ...BASE,
    id: 'w1',
    kind: 'write-owned-file',
    affectedPaths: [path],
    path,
    content,
    mode: null,
    expectedDigest,
  };
}

function patchBlock(
  path: string,
  body: string,
  expectedBodyDigest: string | null,
  createIfMissing = false,
): PatchMarkerBlockAction {
  return {
    ...BASE,
    id: 'p1',
    kind: 'patch-marker-block',
    affectedPaths: [path],
    path,
    markerBegin: FENCE.begin,
    markerEnd: FENCE.end,
    commentPrefix: '#',
    commentSuffix: '',
    body,
    expectedBodyDigest,
    createIfMissing,
  };
}

function makeDirectory(path: string): CreateDirectoryAction {
  return { ...BASE, id: 'd1', kind: 'create-directory', affectedPaths: [path], path };
}

async function rollback(harnessed: Harness, outcome: ActionOutcome): Promise<void> {
  await harnessed.store.restoreAll(outcome.snapshots);
}

describe('create-directory', () => {
  it('creates the directory and records the absence rollback needs', async () => {
    const h = harness();
    const target = join(h.project, 'nested', 'deeper');
    const outcome = await applyAction(makeDirectory(target), h.context);

    assert.equal(outcome.status, 'applied');
    assert.equal(statSync(target).isDirectory(), true);
    assert.equal(outcome.snapshots[0]?.existed, false);
    claim('create-directory', 'apply');
  });

  it('is already satisfied the second time', async () => {
    const h = harness();
    const target = join(h.project, 'nested');
    await applyAction(makeDirectory(target), h.context);
    const again = await applyAction(makeDirectory(target), h.context);
    assert.equal(again.status, 'already-satisfied');
    assert.deepEqual(again.snapshots, []);
    claim('create-directory', 'idempotency');
  });

  it('rolls back to nothing', async () => {
    const h = harness();
    const target = join(h.project, 'nested');
    const outcome = await applyAction(makeDirectory(target), h.context);
    await rollback(h, outcome);
    assert.equal(statSync(target, { throwIfNoEntry: false }), undefined);
    claim('create-directory', 'rollback');
  });

  it('refuses when a file already occupies the path', async () => {
    const h = harness();
    const target = join(h.project, 'occupied');
    writeFileSync(target, 'a file the user put here\n');

    const outcome = await applyAction(makeDirectory(target), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'path-is-not-a-directory');
    assert.equal(readFileSync(target, 'utf8'), 'a file the user put here\n');
    claim('create-directory', 'precondition-drift', 'user-modification');
  });

  it(
    'handles a native Windows path',
    {
      skip: NATIVE_WINDOWS ? false : 'native Windows only',
    },
    async () => {
      const h = harness();
      // A path with a space and a drive letter, which is where naive path joining fails.
      const target = join(h.project, 'Application Support', 'Token Harness');
      const outcome = await applyAction(makeDirectory(target), h.context);
      assert.equal(outcome.status, 'applied');
      assert.equal(statSync(target).isDirectory(), true);
      claim('create-directory', 'windows-path');
    },
  );
});

describe('write-owned-file', () => {
  it('writes the exact bytes the plan carried, and claims ownership of them', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const content = '{\n  "schemaVersion": 1\n}\n';

    const outcome = await applyAction(writeOwned(target, content, null), h.context);
    assert.equal(outcome.status, 'applied');
    assert.equal(readFileSync(target, 'utf8'), content);
    assert.deepEqual(outcome.ownership, [
      { kind: 'owned-file', path: target, digest: digestText(content), mode: null },
    ]);
    claim('write-owned-file', 'apply');
  });

  it('is already satisfied when the file is byte-identical', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const content = 'same\n';
    await applyAction(writeOwned(target, content, null), h.context);

    const again = await applyAction(
      writeOwned(target, content, ownedFileDigest(content)),
      h.context,
    );
    assert.equal(again.status, 'already-satisfied');
    assert.deepEqual(again.snapshots, []);
    claim('write-owned-file', 'idempotency');
  });

  it('updates a file it wrote before, when the digest still matches', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    await applyAction(writeOwned(target, 'first\n', null), h.context);

    const outcome = await applyAction(
      writeOwned(target, 'second\n', ownedFileDigest('first\n')),
      h.context,
    );
    assert.equal(outcome.status, 'applied');
    assert.equal(readFileSync(target, 'utf8'), 'second\n');
  });

  it('reports drift instead of overwriting a file the user created meanwhile', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    writeFileSync(target, 'the user got here first\n');

    const outcome = await applyAction(writeOwned(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'precondition-drift');
    assert.equal(outcome.diagnostics[0]?.code, 'action-precondition-drift');
    assert.equal(readFileSync(target, 'utf8'), 'the user got here first\n');
    claim('write-owned-file', 'precondition-drift', 'user-modification');
  });

  it('reports drift instead of overwriting a file the user edited since planning', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    await applyAction(writeOwned(target, 'ours\n', null), h.context);
    writeFileSync(target, 'ours, plus a line the user added\n');

    const outcome = await applyAction(
      writeOwned(target, 'new content\n', ownedFileDigest('ours\n')),
      h.context,
    );
    assert.equal(outcome.status, 'precondition-drift');
    assert.equal(readFileSync(target, 'utf8'), 'ours, plus a line the user added\n');
  });

  it('reports drift when the file it meant to update has vanished', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const outcome = await applyAction(
      writeOwned(target, 'ours\n', ownedFileDigest('previous\n')),
      h.context,
    );
    assert.equal(outcome.status, 'precondition-drift');
  });

  it('rolls back a creation to nothing and an update to the previous bytes', async () => {
    const h = harness();
    const created = join(h.project, 'created.json');
    const updated = join(h.project, 'updated.json');
    writeFileSync(updated, 'before\r\n');

    const creation = await applyAction(writeOwned(created, 'ours\n', null), h.context);
    const update = await applyAction(
      writeOwned(updated, 'ours\n', digestText('before\r\n')),
      h.context,
    );

    await rollback(h, update);
    await rollback(h, creation);

    assert.equal(statSync(created, { throwIfNoEntry: false }), undefined);
    // Byte-for-byte, CRLF included.
    assert.deepEqual(readFileSync(updated), Buffer.from('before\r\n'));
    claim('write-owned-file', 'rollback');
  });

  it('refuses when a directory occupies the path', async () => {
    const h = harness();
    const target = join(h.project, 'in-the-way');
    mkdirSync(target);
    const outcome = await applyAction(writeOwned(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'path-is-not-a-file');
  });

  it(
    'writes to a native Windows path with spaces',
    {
      skip: NATIVE_WINDOWS ? false : 'native Windows only',
    },
    async () => {
      const h = harness();
      const target = join(h.project, 'Application Support', 'Token Harness', 'receipt.json');
      const outcome = await applyAction(writeOwned(target, 'ours\n', null), h.context);
      assert.equal(outcome.status, 'applied');
      assert.equal(readFileSync(target, 'utf8'), 'ours\n');
      claim('write-owned-file', 'windows-path');
    },
  );

  it(
    'applies the POSIX mode it was given',
    {
      skip: NATIVE_WINDOWS ? 'POSIX only' : false,
    },
    async () => {
      const h = harness();
      const target = join(h.project, 'secret.json');
      const outcome = await applyAction(
        { ...writeOwned(target, 'ours\n', null), mode: '0600' },
        h.context,
      );
      assert.equal(outcome.status, 'applied');
      assert.equal(statSync(target).mode & 0o777, 0o600);
    },
  );
});

describe('patch-marker-block', () => {
  const USER_FILE = 'top matter\n\n## notes\nthe user wrote this\n';

  it('adds a block and leaves everything else exactly as it was', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, USER_FILE);

    const outcome = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'applied');

    const after = readFileSync(target, 'utf8');
    assert.ok(after.startsWith(USER_FILE), after);
    assert.ok(after.includes('# token-harness:begin\nours\n# token-harness:end'), after);
    assert.equal(outcome.ownership[0]?.kind, 'owned-marker-block');
    claim('patch-marker-block', 'apply', 'user-modification');
  });

  it('creates the file when the plan permits it', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    const outcome = await applyAction(patchBlock(target, 'ours\n', null, true), h.context);
    assert.equal(outcome.status, 'applied');
    assert.equal(
      readFileSync(target, 'utf8'),
      '# token-harness:begin\nours\n# token-harness:end\n',
    );
  });

  it('reports drift rather than creating a file the plan did not permit', async () => {
    const h = harness();
    const outcome = await applyAction(
      patchBlock(join(h.project, 'AGENTS.md'), 'ours\n', null, false),
      h.context,
    );
    assert.equal(outcome.status, 'precondition-drift');
  });

  it('is already satisfied when the block is already exactly right', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, USER_FILE);
    const first = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    const digest =
      first.ownership[0]?.kind === 'owned-marker-block' ? first.ownership[0].bodyDigest : null;

    const again = await applyAction(patchBlock(target, 'ours\n', digest), h.context);
    assert.equal(again.status, 'already-satisfied');
    assert.deepEqual(again.snapshots, []);
    claim('patch-marker-block', 'idempotency');
  });

  it('reports drift when the user edited inside our block', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, USER_FILE);
    await applyAction(patchBlock(target, 'ours\n', null), h.context);

    const tampered = readFileSync(target, 'utf8').replace('ours\n', 'ours, edited by hand\n');
    writeFileSync(target, tampered);

    const outcome = await applyAction(patchBlock(target, 'new\n', digestText('ours\n')), h.context);
    assert.equal(outcome.status, 'precondition-drift');
    assert.equal(readFileSync(target, 'utf8'), tampered);
    claim('patch-marker-block', 'precondition-drift');
  });

  it('reports drift when the user removed our block entirely', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, USER_FILE);

    // RFC 0004 §Post-apply drift: "an owned marker block that was edited or removed".
    const outcome = await applyAction(patchBlock(target, 'new\n', digestText('ours\n')), h.context);
    assert.equal(outcome.status, 'precondition-drift');
  });

  it('reports drift when a block already exists but the plan expected none', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, `${USER_FILE}# token-harness:begin\nsomeone else\n# token-harness:end\n`);
    const outcome = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'precondition-drift');
  });

  it('refuses a file whose fences are broken instead of appending a second block', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    const broken = `${USER_FILE}# token-harness:begin\nhalf a block\n`;
    writeFileSync(target, broken);

    const outcome = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'marker-block-malformed');
    assert.equal(readFileSync(target, 'utf8'), broken);
  });

  it('rolls back to the user file byte-for-byte, CRLF and all', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    const original = Buffer.from('﻿top matter\r\n\r\nthe user wrote this\r\n', 'utf8');
    writeFileSync(target, original);

    const outcome = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    assert.equal(outcome.status, 'applied');
    await rollback(h, outcome);

    assert.deepEqual(readFileSync(target), original);
    claim('patch-marker-block', 'rollback');
  });

  it(
    'patches a native Windows path with spaces',
    {
      skip: NATIVE_WINDOWS ? false : 'native Windows only',
    },
    async () => {
      const h = harness();
      const target = join(h.project, 'My Project', 'AGENTS.md');
      mkdirSync(join(h.project, 'My Project'));
      writeFileSync(target, 'user\r\n');
      const outcome = await applyAction(patchBlock(target, 'ours\n', null), h.context);
      assert.equal(outcome.status, 'applied');
      // The file's own CRLF is what the block is written with.
      assert.ok(readFileSync(target, 'utf8').includes('# token-harness:begin\r\n'));
      claim('patch-marker-block', 'windows-path');
    },
  );
});

describe('remove-owned-change', () => {
  function removal(target: RemoveOwnedChangeAction['target']): RemoveOwnedChangeAction {
    return {
      ...BASE,
      id: 'u1',
      kind: 'remove-owned-change',
      riskClass: 'destructive',
      affectedPaths: [target.path],
      path: target.path,
      reverses: 'p1',
      target,
    };
  }

  it('deletes an owned file whose digest still matches', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const applied = await applyAction(writeOwned(target, 'ours\n', null), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-file');

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'applied');
    assert.equal(statSync(target, { throwIfNoEntry: false }), undefined);
    claim('remove-owned-change', 'apply');
  });

  it('removes an owned block and gives the file back byte-for-byte', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    const original = Buffer.from('top\r\n\r\nuser content\r\n', 'utf8');
    writeFileSync(target, original);

    const applied = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-marker-block');

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual(readFileSync(target), original);
  });

  it('is already satisfied when the artifact is already gone', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const outcome = await applyAction(
      removal({ kind: 'owned-file', path: target, digest: digestText('ours\n'), mode: null }),
      h.context,
    );
    // Uninstall is idempotent: a user deleting our file by hand reached uninstall's
    // goal by another route.
    assert.equal(outcome.status, 'already-satisfied');
    claim('remove-owned-change', 'idempotency');
  });

  it('refuses to delete an owned file the user edited', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const applied = await applyAction(writeOwned(target, 'ours\n', null), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-file');
    writeFileSync(target, 'ours, plus the user\n');

    const outcome = await applyAction(removal(owned), h.context);
    // RFC 0004 §Ownership: "user edits ... block automatic deletion until the user
    // reviews the new uninstall plan."
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'owned-artifact-modified');
    assert.equal(outcome.diagnostics[0]?.path, target);
    assert.equal(readFileSync(target, 'utf8'), 'ours, plus the user\n');
    claim('remove-owned-change', 'user-modification', 'precondition-drift');
  });

  it('refuses to remove an owned block the user edited', async () => {
    const h = harness();
    const target = join(h.project, 'AGENTS.md');
    writeFileSync(target, 'user\n');
    const applied = await applyAction(patchBlock(target, 'ours\n', null), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-marker-block');

    const before = readFileSync(target, 'utf8');
    writeFileSync(target, before.replace('ours\n', 'ours and theirs\n'));

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'refused');
    assert.ok(readFileSync(target, 'utf8').includes('ours and theirs'));
  });

  it('rolls back a deletion by putting the file back', async () => {
    const h = harness();
    const target = join(h.project, 'receipt.json');
    const applied = await applyAction(writeOwned(target, 'ours\n', null), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-file');

    const outcome = await applyAction(removal(owned), h.context);
    await rollback(h, outcome);
    assert.equal(readFileSync(target, 'utf8'), 'ours\n');
    claim('remove-owned-change', 'rollback');
  });

  it(
    'removes an owned file at a native Windows path',
    {
      skip: NATIVE_WINDOWS ? false : 'native Windows only',
    },
    async () => {
      const h = harness();
      const target = join(h.project, 'Application Support', 'receipt.json');
      const applied = await applyAction(writeOwned(target, 'ours\n', null), h.context);
      const owned = applied.ownership[0];
      assert.ok(owned !== undefined && owned.kind === 'owned-file');
      const outcome = await applyAction(removal(owned), h.context);
      assert.equal(outcome.status, 'applied');
      claim('remove-owned-change', 'windows-path');
    },
  );
});

describe('action families this build does not execute', () => {
  const unimplemented: readonly PlannedActionKind[] = [
    'download-artifact',
    'package-manager-install',
    'run-installer-command',
    'delegated-provider-install',
    'merge-json',
    'merge-toml',
    'merge-yaml',
    'register-mcp-server',
    'register-hook',
  ];

  for (const kind of unimplemented) {
    it(`reports that it cannot execute a ${kind} action`, async () => {
      const h = harness();
      // An executor that silently skipped an action it did not understand would report
      // a plan as applied when it was not.
      const action = { ...BASE, id: 'x1', kind } as unknown as PlannedAction;
      const outcome = await applyAction(action, h.context);
      assert.equal(outcome.status, 'failed');
      assert.equal(outcome.diagnostics[0]?.code, 'action-not-implemented');
      assert.equal(isExecutableActionKind(kind), false);
    });
  }

  it('agrees with the exported list of what it can execute', () => {
    for (const kind of EXECUTABLE_ACTION_KINDS) {
      assert.equal(isExecutableActionKind(kind), true, kind);
    }
    assert.equal(EXECUTABLE_ACTION_KINDS.length, 4);
  });
});

/**
 * RFC 0004 §Test requirements, checked rather than remembered.
 *
 * `windows-path` is required "where applicable", so it is only demanded when the
 * suite is running on native Windows — on POSIX those cases are skipped and cannot
 * claim anything.
 */
describe('RFC 0004 test obligations', () => {
  const required: readonly Obligation[] = [
    'apply',
    'idempotency',
    'precondition-drift',
    'rollback',
    'user-modification',
  ];

  for (const kind of EXECUTABLE_ACTION_KINDS) {
    it(`${kind} has every required test`, () => {
      const claimed = covered.get(kind) ?? new Set<Obligation>();
      const missing = [...required, ...(NATIVE_WINDOWS ? (['windows-path'] as const) : [])].filter(
        (obligation) => !claimed.has(obligation),
      );
      assert.deepEqual(missing, [], `${kind} is missing: ${missing.join(', ')}`);
    });
  }
});
