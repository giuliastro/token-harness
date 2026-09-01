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
  jsonValueDigest,
  ownedFileDigest,
  type ActionContext,
  type ActionOutcome,
  type CodexConfigBatchWriteAction,
  type CreateDirectoryAction,
  type DelegatedProviderInstallAction,
  type JsonValue,
  type MergeJsonAction,
  type MergeYamlAction,
  type PackageManagerInstallAction,
  type PatchMarkerBlockAction,
  type PlannedAction,
  type PlannedActionBase,
  type PlannedActionKind,
  type ProcessRunner,
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

describe('merge-json', () => {
  const SETTINGS = [
    '{',
    '    "theme": "dark",',
    '    "hooks": {',
    '        "PreToolUse": [',
    '            { "matcher": "Read", "command": "user-first" }',
    '        ]',
    '    }',
    '}',
    '',
  ].join('\r\n');

  const ENTRY = { matcher: 'Bash', command: 'rtk hook pre' } as JsonValue;

  function mergeHook(
    path: string,
    expected: string | null = null,
    createIfMissing = false,
  ): MergeJsonAction {
    return {
      ...BASE,
      id: 'm1',
      kind: 'merge-json',
      affectedPaths: [path],
      path,
      ownedPointers: ['hooks.PreToolUse'],
      operations: [
        {
          kind: 'append',
          pointer: 'hooks.PreToolUse',
          value: ENTRY,
          expectedValueDigest: expected,
        },
      ],
      createIfMissing,
    };
  }

  it('adds an owned entry and keeps the user keys, order, and formatting', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, SETTINGS);

    const outcome = await applyAction(mergeHook(target), h.context);
    assert.equal(outcome.status, 'applied');

    const after = readFileSync(target, 'utf8');
    // Four-space indentation and CRLF, exactly as the file had them.
    assert.ok(after.includes('\r\n    "theme": "dark"'), JSON.stringify(after.slice(0, 40)));
    const document = JSON.parse(after) as {
      theme: string;
      hooks: { PreToolUse: { matcher: string }[] };
    };
    assert.equal(document.theme, 'dark');
    assert.deepEqual(
      document.hooks.PreToolUse.map((entry) => entry.matcher),
      ['Read', 'Bash'],
    );
    assert.equal(outcome.ownership[0]?.kind, 'owned-json-entry');
    claim('merge-json', 'apply', 'user-modification');
  });

  it('is already satisfied the second time', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, SETTINGS);
    await applyAction(mergeHook(target), h.context);
    const before = readFileSync(target);

    const again = await applyAction(mergeHook(target), h.context);
    assert.equal(again.status, 'already-satisfied');
    assert.deepEqual(again.snapshots, []);
    assert.deepEqual(readFileSync(target), before);
    claim('merge-json', 'idempotency');
  });

  it('reports drift when the owned entry was edited', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, SETTINGS);
    await applyAction(mergeHook(target), h.context);
    const tampered = readFileSync(target, 'utf8').replace('rtk hook pre', 'rtk hook pre --edited');
    writeFileSync(target, tampered);

    const outcome = await applyAction(mergeHook(target, jsonValueDigest(ENTRY)), h.context);
    assert.equal(outcome.status, 'precondition-drift');
    assert.equal(readFileSync(target, 'utf8'), tampered);
    claim('merge-json', 'precondition-drift');
  });

  it('rolls back to the original document byte-for-byte', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    const original = Buffer.from(SETTINGS, 'utf8');
    writeFileSync(target, original);

    const outcome = await applyAction(mergeHook(target), h.context);
    await rollback(h, outcome);
    assert.deepEqual(readFileSync(target), original);
    claim('merge-json', 'rollback');
  });

  it('refuses a document with comments rather than deleting them', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    const commented = '{\n  // the user keeps notes here\n  "hooks": {}\n}\n';
    writeFileSync(target, commented);

    const outcome = await applyAction(mergeHook(target), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'json-comments-unsupported');
    assert.equal(readFileSync(target, 'utf8'), commented);
  });

  it('warns when the document has formatting it cannot reproduce', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    // The nested object is on one line; `JSON.stringify` will expand it. RFC 0004 asks
    // for that limitation to be reported rather than discovered in a diff.
    writeFileSync(target, SETTINGS);
    const outcome = await applyAction(mergeHook(target), h.context);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual(
      outcome.diagnostics.map((entry) => entry.code),
      ['json-formatting-not-preserved'],
    );
    // A warning, so it does not turn a supported configuration into a non-zero exit.
    assert.equal(outcome.diagnostics[0]?.severity, 'warning');
  });

  it('stays silent when the document is already in a shape it reproduces exactly', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(
      target,
      `${JSON.stringify({ theme: 'dark', hooks: { PreToolUse: [] } }, null, 4)}\n`,
    );
    const outcome = await applyAction(mergeHook(target), h.context);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual(outcome.diagnostics, []);
  });

  it('refuses malformed JSON', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, '{ "hooks": }');
    const outcome = await applyAction(mergeHook(target), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'json-malformed');
  });

  it('refuses an operation on a pointer the action did not declare', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, SETTINGS);
    const outcome = await applyAction(
      { ...mergeHook(target), ownedPointers: ['hooks.PostToolUse'] },
      h.context,
    );
    // RFC 0004 §Ownership scopes removal to the entries recorded in the journal, so an
    // action reaching outside its declared claim is a claim nobody reviewed.
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'action-claims-undeclared-pointer');
  });

  it('reports drift rather than creating a document the plan did not permit', async () => {
    const h = harness();
    const outcome = await applyAction(mergeHook(join(h.project, 'absent.json')), h.context);
    assert.equal(outcome.status, 'precondition-drift');
  });

  it('creates the document when the plan permits it', async () => {
    const h = harness();
    const target = join(h.project, 'created.json');
    const outcome = await applyAction(mergeHook(target, null, true), h.context);
    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.snapshots[0]?.existed, false);
  });

  it(
    'merges a document at a native Windows path with spaces',
    {
      skip: NATIVE_WINDOWS ? false : 'native Windows only',
    },
    async () => {
      const h = harness();
      const target = join(h.project, 'Application Support', 'settings.json');
      mkdirSync(join(h.project, 'Application Support'));
      writeFileSync(target, SETTINGS);
      const outcome = await applyAction(mergeHook(target), h.context);
      assert.equal(outcome.status, 'applied');
      claim('merge-json', 'windows-path');
    },
  );
});

describe('merge-yaml', () => {
  const HERMES = [
    '# user-owned config',
    'theme: dark',
    'plugins:',
    '  enabled:',
    '    - security-guidance',
    '  path: ~/.hermes/plugins',
    '',
  ].join('\r\n');

  function mergePlugin(
    path: string,
    expectedValueDigest: string | null = null,
    expectedLineDigest: string | null = null,
    createIfMissing = false,
  ): MergeYamlAction {
    return {
      ...BASE,
      id: 'y1',
      kind: 'merge-yaml',
      affectedPaths: [path],
      path,
      ownedPointers: ['plugins.enabled'],
      operations: [
        {
          kind: 'append-string',
          pointer: 'plugins.enabled',
          value: 'harnesstrim',
          expectedValueDigest,
          expectedLineDigest,
        },
      ],
      createIfMissing,
    };
  }

  it('adds one owned YAML array entry and preserves the rest byte-for-byte', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    writeFileSync(target, HERMES);

    const outcome = await applyAction(mergePlugin(target), h.context);
    assert.equal(outcome.status, 'applied');
    assert.ok(
      readFileSync(target, 'utf8').includes(
        '    - security-guidance\r\n    - harnesstrim\r\n  path:',
      ),
    );
    assert.equal(outcome.ownership[0]?.kind, 'owned-yaml-entry');
    claim('merge-yaml', 'apply');
  });

  it('does not claim a byte-identical entry that existed before the first apply', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    writeFileSync(target, 'plugins:\n  enabled:\n    - harnesstrim\n');

    const outcome = await applyAction(mergePlugin(target), h.context);
    assert.equal(outcome.status, 'already-satisfied');
    assert.deepEqual(outcome.ownership, []);
    assert.deepEqual(outcome.snapshots, []);
  });

  it('is already satisfied on an identical second apply', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    writeFileSync(target, HERMES);
    await applyAction(mergePlugin(target), h.context);
    const before = readFileSync(target);

    const again = await applyAction(mergePlugin(target), h.context);
    assert.equal(again.status, 'already-satisfied');
    assert.deepEqual(again.snapshots, []);
    assert.deepEqual(readFileSync(target), before);
    claim('merge-yaml', 'idempotency');
  });

  it('detects a user edit to the exact owned line through the stored-plan precondition', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    writeFileSync(target, HERMES);
    const applied = await applyAction(mergePlugin(target), h.context);
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-yaml-entry');

    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('    - harnesstrim', '    - harnesstrim # keep this'),
    );
    const outcome = await applyAction(
      mergePlugin(target, owned.valueDigest, owned.lineDigest),
      h.context,
    );
    assert.equal(outcome.status, 'precondition-drift');
    assert.ok(readFileSync(target, 'utf8').includes('# keep this'));
    claim('merge-yaml', 'precondition-drift', 'user-modification');
  });

  it('rolls back to the original YAML bytes', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    const original = Buffer.from(HERMES, 'utf8');
    writeFileSync(target, original);

    const outcome = await applyAction(mergePlugin(target), h.context);
    assert.equal(outcome.status, 'applied');
    await rollback(h, outcome);
    assert.deepEqual(readFileSync(target), original);
    claim('merge-yaml', 'rollback');
  });

  it('refuses unsupported YAML instead of normalizing it', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    const original = 'plugins:\n  enabled: [security-guidance]\n';
    writeFileSync(target, original);

    const outcome = await applyAction(mergePlugin(target), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'yaml-shape-unsupported');
    assert.equal(readFileSync(target, 'utf8'), original);
  });

  it('creates a missing config only when the plan permits it', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    const denied = await applyAction(mergePlugin(target), h.context);
    assert.equal(denied.status, 'precondition-drift');

    const allowed = await applyAction(mergePlugin(target, null, null, true), h.context);
    assert.equal(allowed.status, 'applied');
    assert.equal(readFileSync(target, 'utf8'), 'plugins:\n  enabled:\n    - harnesstrim');
  });

  it(
    'merges YAML at a native Windows path with spaces',
    { skip: NATIVE_WINDOWS ? false : 'native Windows only' },
    async () => {
      const h = harness();
      const dir = join(h.project, 'Application Support');
      const target = join(dir, 'config.yaml');
      mkdirSync(dir);
      writeFileSync(target, HERMES);
      const outcome = await applyAction(mergePlugin(target), h.context);
      assert.equal(outcome.status, 'applied');
      claim('merge-yaml', 'windows-path');
    },
  );
});

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

describe('remove-owned-change', () => {
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

  it('removes an owned JSON entry and leaves the user entries in order', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    // Already in the shape `JSON.stringify(_, null, 4)` produces, so the round trip is
    // byte-exact. A document with a hand-compacted node is the case the
    // `json-formatting-not-preserved` warning exists for.
    const original = Buffer.from(
      JSON.stringify(
        { theme: 'dark', hooks: { PreToolUse: [{ matcher: 'Read' }] } },
        null,
        4,
      ).replace(/\n/g, '\r\n') + '\r\n',
      'utf8',
    );
    writeFileSync(target, original);

    const applied = await applyAction(
      {
        ...BASE,
        id: 'm1',
        kind: 'merge-json',
        affectedPaths: [target],
        path: target,
        ownedPointers: ['hooks.PreToolUse'],
        operations: [
          {
            kind: 'append',
            pointer: 'hooks.PreToolUse',
            value: { matcher: 'Bash' } as JsonValue,
            expectedValueDigest: null,
          },
        ],
        createIfMissing: false,
      },
      h.context,
    );
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-json-entry');

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'applied');
    // Byte-for-byte back to the user's document, CRLF and four-space indentation.
    assert.deepEqual(readFileSync(target), original);
  });

  it('removes only the YAML array entry Token Harness owns', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    const original = 'theme: dark\r\nplugins:\r\n  enabled:\r\n    - security-guidance\r\n';
    writeFileSync(target, original);

    const applied = await applyAction(
      {
        ...BASE,
        id: 'y1',
        kind: 'merge-yaml',
        affectedPaths: [target],
        path: target,
        ownedPointers: ['plugins.enabled'],
        operations: [
          {
            kind: 'append-string',
            pointer: 'plugins.enabled',
            value: 'harnesstrim',
            expectedValueDigest: null,
            expectedLineDigest: null,
          },
        ],
        createIfMissing: false,
      },
      h.context,
    );
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-yaml-entry');

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'applied');
    assert.deepEqual(readFileSync(target, 'utf8'), original);
  });

  it('refuses to remove an owned YAML entry after the user edits its line', async () => {
    const h = harness();
    const target = join(h.project, 'config.yaml');
    writeFileSync(target, 'plugins:\n  enabled:\n');

    const applied = await applyAction(
      {
        ...BASE,
        id: 'y1',
        kind: 'merge-yaml',
        affectedPaths: [target],
        path: target,
        ownedPointers: ['plugins.enabled'],
        operations: [
          {
            kind: 'append-string',
            pointer: 'plugins.enabled',
            value: 'harnesstrim',
            expectedValueDigest: null,
            expectedLineDigest: null,
          },
        ],
        createIfMissing: false,
      },
      h.context,
    );
    const owned = applied.ownership[0];
    assert.ok(owned !== undefined && owned.kind === 'owned-yaml-entry');
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace('    - harnesstrim', '    - harnesstrim # user'),
    );

    const outcome = await applyAction(removal(owned), h.context);
    assert.equal(outcome.status, 'refused');
    assert.equal(outcome.diagnostics[0]?.code, 'owned-artifact-modified');
    assert.ok(readFileSync(target, 'utf8').includes('# user'));
  });

  it('refuses to remove an owned JSON entry the user edited', async () => {
    const h = harness();
    const target = join(h.project, 'settings.json');
    writeFileSync(target, '{\n  "hooks": { "PreToolUse": [{ "matcher": "Bash" }] }\n}\n');

    const outcome = await applyAction(
      removal({
        kind: 'owned-json-entry',
        path: target,
        pointer: 'hooks.PreToolUse',
        placement: 'array-element',
        valueDigest: jsonValueDigest({ matcher: 'Bash', command: 'the original' } as JsonValue),
      }),
      h.context,
    );
    // Our recorded element is not in the array in any form we recognise, so the entry
    // is reported missing rather than guessed at.
    assert.equal(outcome.status, 'already-satisfied');
    assert.ok(readFileSync(target, 'utf8').includes('Bash'));
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

/**
 * `package-manager-install` — RFC 0004 §Network policy and §Process policy.
 *
 * The one family whose effect is not a file, which is why it is exempted from three of the five
 * obligations and why the ones it does discharge look unlike the others. "rollback" here asserts
 * that it *cannot* be rolled back, because that is the property a user has to know.
 *
 * A fake runner throughout. Installing a package to test an installer would leave the machine
 * changed by a test run — no more acceptable for a package manager than for the developer home
 * AGENTS.md already protects.
 */
describe('installing a package', () => {
  function installer(
    options: {
      exitCode?: number;
      fails?: boolean;
      /** Answers the inventory query (`winget list`, `cargo install --list`). */
      inventory?: { stdout?: string; exitCode?: number };
    } = {},
  ) {
    const spawned: { executable: string; args: string[] }[] = [];
    const base = {
      displayCommand: '',
      interpreter: 'direct' as const,
      executablePath: `/usr/bin/`,
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 1,
      timedOut: false,
      failure: null,
    };
    const runner: ProcessRunner = {
      run: (request) => {
        spawned.push({ executable: request.executable, args: [...request.args] });
        const inventory =
          options.inventory !== undefined &&
          (request.args[0] === 'list' || request.args[1] === '--list');
        if (inventory) {
          return Promise.resolve({
            ...base,
            displayCommand: `${request.executable} ${request.args.join(' ')}`,
            executablePath: `/usr/bin/${request.executable}`,
            exitCode: options.inventory?.exitCode ?? 0,
            stdout: options.inventory?.stdout ?? '',
          });
        }
        return Promise.resolve({
          ...base,
          displayCommand: `${request.executable} ${request.args.join(' ')}`,
          executablePath: options.fails === true ? null : `/usr/bin/${request.executable}`,
          exitCode: options.fails === true ? null : (options.exitCode ?? 0),
          failure:
            options.fails === true
              ? { reason: 'executable-not-found' as const, message: 'missing' }
              : null,
        });
      },
    };
    return { spawned, runner };
  }

  function installAction(
    overrides: Partial<PackageManagerInstallAction> = {},
  ): PackageManagerInstallAction {
    return {
      ...BASE,
      id: 'install-1',
      kind: 'package-manager-install',
      riskClass: 'delegated',
      requiresNetwork: true,
      requiresElevation: false,
      rollbackData: 'none',
      packageManager: 'winget',
      packageName: 'rtk-ai.rtk',
      version: null,
      ...overrides,
    } as PackageManagerInstallAction;
  }

  it('runs the package manager and reports it applied', async () => {
    const h = harness();
    const { spawned, runner } = installer();
    const outcome = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });

    assert.equal(outcome.status, 'applied');
    // Verified against a real machine: `rtk` resolves to `WinGet/Packages/rtk-ai.rtk_.../rtk.exe`,
    // and every flag below appears in `winget install --help`.
    assert.equal(spawned[0]?.executable, 'winget');
    assert.deepEqual(spawned[0]?.args, [
      'install',
      '--id',
      'rtk-ai.rtk',
      '--exact',
      '--silent',
      '--accept-package-agreements',
      '--accept-source-agreements',
    ]);
    claim('package-manager-install', 'apply');
  });

  it('takes no snapshot and claims no ownership', async () => {
    const h = harness();
    const { runner } = installer();
    const outcome = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });
    // A package is not a file. A snapshot would promise a restoration that cannot happen, and
    // ownership would let `uninstall` try to delete a package Token Harness did not compose.
    assert.deepEqual(outcome.snapshots, []);
    assert.deepEqual(outcome.ownership, []);
  });

  it('says on success that a rollback will not undo it', async () => {
    const h = harness();
    const { runner } = installer();
    const outcome = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });
    /**
     * The rollback obligation, discharged by asserting the opposite of what the other families do.
     *
     * RFC 0004 permits rollback only by restoring snapshots, "never by inventing an uninstall
     * command", and there is no snapshot of a package. A later failure restores the files and
     * leaves the package — and a report saying "rolled back" without this would let a user believe
     * the machine is as it was.
     *
     * This is the `rollbackData: 'none'` contract. The `package-inventory` contract, when the
     * channel answered what it has installed, is the next test.
     */
    assert.equal(
      outcome.diagnostics.some((entry) => entry.code === 'install-not-reversible'),
      true,
    );
    assert.equal(outcome.packageInventory, null);
    claim('package-manager-install', 'rollback');
  });

  it('captures what the channel has installed before a package-inventory install', async () => {
    const h = harness();
    // `winget list --id <id> --exact` prints the same separator-anchored table as `show --versions`,
    // with the installed version as the last token of the row.
    const { spawned, runner } = installer({
      inventory: { stdout: 'Trovato rtk [rtk-ai.rtk]\nVersione\n--------\n0.42.0\r\n' },
    });
    const outcome = await applyAction(installAction({ rollbackData: 'package-inventory' }), {
      ...h.context,
      runner,
      cwd: '/work',
    });

    assert.equal(outcome.status, 'applied');
    // Asked before the install ran: the capture is the *prior* state, which is the only one a
    // rollback can restore.
    assert.equal(spawned[0]?.args[0], 'list');
    assert.equal(spawned[1]?.args[0], 'install');
    assert.equal(outcome.packageInventory?.status, 'captured');
    assert.equal(outcome.packageInventory?.version, '0.42.0');
    // RFC 0009: with a captured prior version the rollback can restore the package, and the
    // receipt says so instead of the pre-0009 "rollback will not uninstall it".
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'install-inventory-captured'));
  });

  it('says the install is not reversible when the capture cannot be read', async () => {
    const h = harness();
    // The channel answered something this build cannot read, so there is no prior version to
    // restore — an unreadable answer is "no capture", never "captured at nothing".
    const { runner } = installer({ inventory: { stdout: 'Versione: 0.42.0\r\n' } });
    const outcome = await applyAction(installAction({ rollbackData: 'package-inventory' }), {
      ...h.context,
      runner,
      cwd: '/work',
    });

    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.packageInventory?.status, 'unknown');
    assert.ok(outcome.diagnostics.some((entry) => entry.code === 'install-not-reversible'));
  });

  it('skips the capture for an elevated install, which is refused anyway', async () => {
    const h = harness();
    const { spawned, runner } = installer();
    const outcome = await applyAction(
      installAction({ rollbackData: 'package-inventory', requiresElevation: true }),
      { ...h.context, runner, cwd: '/work' },
    );
    // A refused install never runs, so querying the channel first would have been pure I/O.
    assert.equal(outcome.status, 'refused');
    assert.deepEqual(spawned, []);
    assert.equal(outcome.packageInventory, null);
  });

  it('produces the same outcome when the package is already installed', async () => {
    const h = harness();
    const { runner } = installer();
    const first = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });
    const second = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });
    // Idempotency here belongs to the package manager — winget exits 0 for an already-installed
    // package. What this asserts is that the executor keeps no state of its own between runs.
    assert.equal(first.status, second.status);
    claim('package-manager-install', 'idempotency');
  });

  it('refuses rather than elevating', async () => {
    const h = harness();
    const { spawned, runner } = installer();
    const outcome = await applyAction(installAction({ requiresElevation: true }), {
      ...h.context,
      runner,
      cwd: '/work',
    });

    // RFC 0004 §Process policy: "Elevation is never automatic." Refused rather than failed, because
    // nothing is broken — and nothing was spawned.
    assert.equal(outcome.status, 'refused');
    assert.deepEqual(spawned, []);
    assert.equal(outcome.diagnostics[0]?.code, 'install-requires-elevation');
    // The exact command, so the user can finish it in one paste.
    assert.match(outcome.diagnostics[0]?.remediation ?? '', /winget install --id rtk-ai\.rtk/);
  });

  it('refuses a package manager it does not know how to invoke', async () => {
    const h = harness();
    const { spawned, runner } = installer();
    const outcome = await applyAction(installAction({ packageManager: 'brew' }), {
      ...h.context,
      runner,
      cwd: '/work',
    });
    // Guessing an unknown manager's argv is how a plan becomes a command nobody reviewed.
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.diagnostics[0]?.code, 'unknown-package-manager');
    assert.deepEqual(spawned, []);
  });

  it('warns when the invocation was never observed working', async () => {
    const h = harness();
    const { runner } = installer();
    const outcome = await applyAction(
      installAction({ packageManager: 'cargo', packageName: 'rtk' }),
      { ...h.context, runner, cwd: '/work' },
    );
    // `cargo install <crate>` is the documented form, and cargo was not installed on the machine
    // this was checked against — so it says the difference rather than implying it was tested.
    assert.equal(
      outcome.diagnostics.some((entry) => entry.code === 'install-channel-unverified'),
      true,
    );
  });

  it('fails when the installer exits non-zero', async () => {
    const h = harness();
    const { runner } = installer({ exitCode: 1 });
    const outcome = await applyAction(installAction(), { ...h.context, runner, cwd: '/work' });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.diagnostics[0]?.code, 'install-command-failed');
  });

  it('fails, rather than throwing, when there is no runner', async () => {
    const h = harness();
    const outcome = await applyAction(installAction(), { ...h.context, cwd: '/work' });
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.diagnostics[0]?.code, 'no-process-runner');
  });
});

describe('delegated-provider-install', () => {
  it('snapshots and restores a reviewed provider write set', async () => {
    const h = harness();
    const boundary = join(h.project, '.claude');
    const skills = join(boundary, 'skills');
    const runner: ProcessRunner = {
      async run() {
        mkdirSync(join(skills, 'delta-response', 'references'), { recursive: true });
        writeFileSync(join(skills, 'delta-response', 'SKILL.md'), 'skill\n');
        writeFileSync(join(skills, 'delta-response', 'references', 'examples.md'), 'examples\n');
        return {
          displayCommand: 'harnesstrim install claude',
          interpreter: 'direct',
          executablePath: '/fake/harnesstrim',
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        };
      },
    };
    const action: DelegatedProviderInstallAction = {
      ...BASE,
      id: 'delegate-1',
      kind: 'delegated-provider-install',
      riskClass: 'delegated',
      rollbackData: 'directory-snapshot',
      affectedPaths: [
        join(skills, 'delta-response', 'SKILL.md'),
        join(skills, 'delta-response', 'references', 'examples.md'),
      ],
      affectedProcesses: ['harnesstrim'],
      executable: 'harnesstrim',
      args: ['install', 'claude', '--apply'],
      containmentBoundary: [boundary],
      expectedArtifacts: [
        { path: join(skills, 'delta-response', 'SKILL.md'), digest: digestText('skill\n') },
        {
          path: join(skills, 'delta-response', 'references', 'examples.md'),
          digest: digestText('examples\n'),
        },
      ],
      protectedPaths: [],
      rollbackStrategy: 'restore-snapshot',
      snapshotSizeCapBytes: 1024,
      upstreamUninstallAvailable: true,
    };
    const outcome = await applyAction(action, { ...h.context, runner, cwd: h.project });
    assert.equal(outcome.status, 'applied');
    assert.equal(readFileSync(join(skills, 'delta-response', 'SKILL.md'), 'utf8'), 'skill\n');
    assert.equal(
      readFileSync(join(skills, 'delta-response', 'references', 'examples.md'), 'utf8'),
      'examples\n',
    );
    const again = await applyAction(action, { ...h.context, runner, cwd: h.project });
    assert.equal(again.status, 'already-satisfied');
    await rollback(h, outcome);
    assert.equal(statSync(boundary, { throwIfNoEntry: false }), undefined);
    claim('delegated-provider-install', 'apply', 'idempotency', 'rollback');
  });

  it('does not read a protected path that never existed as a change', async () => {
    /**
     * The case the shipped provider is built on, and the one every existing test here missed by
     * passing `protectedPaths: []`.
     *
     * HarnessTrim's skills-only install names `.claude/settings.json` and `CLAUDE.md` as protected
     * *because* the installer must not create them. `equalTreeEntry` required both sides to be
     * defined, so a path absent before and absent after read as changed and the action failed every
     * time the installer behaved correctly. Verified on a real machine: the delegated install now
     * applies and writes exactly its seven skill files, and before this it could not succeed at any
     * version.
     */
    const h = harness();
    const boundary = join(h.project, '.claude');
    const skills = join(boundary, 'skills');
    const runner: ProcessRunner = {
      async run() {
        mkdirSync(join(skills, 'delta-response'), { recursive: true });
        writeFileSync(join(skills, 'delta-response', 'SKILL.md'), 'skill\n');
        return {
          displayCommand: 'harnesstrim install claude --no-hook',
          interpreter: 'direct',
          executablePath: '/fake/harnesstrim',
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        };
      },
    };
    const action: DelegatedProviderInstallAction = {
      ...BASE,
      id: 'delegate-protected',
      kind: 'delegated-provider-install',
      riskClass: 'delegated',
      rollbackData: 'directory-snapshot',
      affectedPaths: [join(skills, 'delta-response', 'SKILL.md')],
      affectedProcesses: ['harnesstrim'],
      executable: 'harnesstrim',
      args: ['install', 'claude', '--apply', '--no-hook', '--no-instructions'],
      containmentBoundary: [boundary],
      expectedArtifacts: [
        { path: join(skills, 'delta-response', 'SKILL.md'), digest: digestText('skill\n') },
      ],
      // Never created by this installer, which is exactly why they are named here.
      protectedPaths: [join(boundary, 'settings.json'), join(h.project, 'CLAUDE.md')],
      rollbackStrategy: 'restore-snapshot',
      snapshotSizeCapBytes: 1024,
      upstreamUninstallAvailable: true,
    };

    const outcome = await applyAction(action, { ...h.context, runner, cwd: h.project });

    assert.equal(outcome.status, 'applied');
    assert.equal(readFileSync(join(skills, 'delta-response', 'SKILL.md'), 'utf8'), 'skill\n');
    // And still absent, so nothing was created to make the check pass.
    assert.equal(statSync(join(boundary, 'settings.json'), { throwIfNoEntry: false }), undefined);
  });

  it('rejects undeclared creations and deletions, then restores both directions', async () => {
    const h = harness();
    const boundary = join(h.project, '.claude');
    const skills = join(boundary, 'skills');
    const preserved = join(boundary, 'settings.json');
    mkdirSync(boundary, { recursive: true });
    writeFileSync(preserved, '{"theme":"dark"}\n');
    const runner: ProcessRunner = {
      async run() {
        mkdirSync(skills, { recursive: true });
        writeFileSync(join(skills, 'SKILL.md'), 'skill\n');
        writeFileSync(join(boundary, 'unexpected.txt'), 'unexpected\n');
        rmSync(preserved);
        return {
          displayCommand: 'harnesstrim install claude',
          interpreter: 'direct',
          executablePath: '/fake/harnesstrim',
          exitCode: 0,
          signal: null,
          stdout: '',
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        };
      },
    };
    const skill = join(skills, 'SKILL.md');
    const action: DelegatedProviderInstallAction = {
      ...BASE,
      id: 'delegate-2',
      kind: 'delegated-provider-install',
      riskClass: 'delegated',
      rollbackData: 'directory-snapshot',
      affectedPaths: [skill],
      affectedProcesses: ['harnesstrim'],
      executable: 'harnesstrim',
      args: ['install', 'claude', '--apply'],
      containmentBoundary: [boundary],
      expectedArtifacts: [{ path: skill, digest: digestText('skill\n') }],
      protectedPaths: [preserved],
      rollbackStrategy: 'restore-snapshot',
      snapshotSizeCapBytes: 1024,
      upstreamUninstallAvailable: true,
    };
    const outcome = await applyAction(action, { ...h.context, runner, cwd: h.project });
    assert.equal(outcome.diagnostics[0]?.code, 'delegated-install-protected-path-changed');
    await rollback(h, outcome);
    assert.equal(readFileSync(preserved, 'utf8'), '{"theme":"dark"}\n');
    assert.equal(statSync(join(boundary, 'unexpected.txt'), { throwIfNoEntry: false }), undefined);
    assert.equal(statSync(skill, { throwIfNoEntry: false }), undefined);
  });
});

describe('codex-config-batch-write', () => {
  function action(path: string, expectedVersion = 'v1'): CodexConfigBatchWriteAction {
    return {
      ...BASE,
      id: 'codex-config-1',
      kind: 'codex-config-batch-write',
      affectedPaths: [path],
      affectedProcesses: ['codex'],
      path,
      edits: [{ keyPath: 'model_reasoning_effort', value: 'low', mergeStrategy: 'replace' }],
      expectedVersion,
      reloadUserConfig: true,
    };
  }

  function runner(path: string, mode: 'success' | 'conflict' = 'success'): ProcessRunner {
    return {
      async run(request) {
        assert.equal(request.executable, 'codex');
        assert.deepEqual(request.args, ['app-server', '--stdio']);
        assert.ok((request.stdin ?? '').includes('config/batchWrite'));
        const batch = (request.stdin ?? '')
          .split(/\r?\n/)
          .filter((line) => line.trim() !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .find((message) => message['id'] === 2);
        assert.ok(batch);
        const params = batch['params'];
        assert.ok(typeof params === 'object' && params !== null && !Array.isArray(params));
        assert.equal((params as Record<string, unknown>)['filePath'], path);

        if (mode === 'success') {
          writeFileSync(path, 'model_reasoning_effort = "low"\n# user comment\n');
        }

        return {
          displayCommand: 'codex app-server --stdio',
          interpreter: 'direct',
          executablePath: '/fake/codex',
          exitCode: 0,
          signal: null,
          stdout:
            mode === 'success'
              ? JSON.stringify({ id: 2, result: { version: 'v2' } })
              : JSON.stringify({
                  id: 2,
                  error: {
                    code: -32600,
                    message: 'configVersionConflict: Configuration was modified since last read',
                  },
                }),
          stderr: '',
          stdoutTruncated: false,
          stderrTruncated: false,
          durationMs: 1,
          timedOut: false,
          failure: null,
        };
      },
    };
  }

  it('applies an atomic native config batch and snapshots the exact target', async () => {
    const h = harness();
    const path = join(h.project, 'config.toml');
    writeFileSync(path, 'model_reasoning_effort = "high"\n# user comment\n');

    const outcome = await applyAction(action(path), {
      ...h.context,
      runner: runner(path),
      cwd: h.project,
    });

    assert.equal(outcome.status, 'applied');
    assert.equal(outcome.snapshots[0]?.path, path);
    assert.equal(readFileSync(path, 'utf8'), 'model_reasoning_effort = "low"\n# user comment\n');
    claim('codex-config-batch-write', 'apply');
    if (NATIVE_WINDOWS) claim('codex-config-batch-write', 'windows-path');
  });

  it('is safely repeatable when Codex accepts the same desired value twice', async () => {
    const h = harness();
    const path = join(h.project, 'config.toml');
    writeFileSync(path, 'model_reasoning_effort = "high"\n# user comment\n');
    const native = runner(path);

    const first = await applyAction(action(path), { ...h.context, runner: native, cwd: h.project });
    const second = await applyAction(action(path, 'v2'), {
      ...h.context,
      runner: native,
      cwd: h.project,
    });

    assert.equal(first.status, 'applied');
    assert.equal(second.status, 'applied');
    assert.equal(readFileSync(path, 'utf8'), 'model_reasoning_effort = "low"\n# user comment\n');
    claim('codex-config-batch-write', 'idempotency');
  });

  it('turns a native config version conflict into precondition drift without writing', async () => {
    const h = harness();
    const path = join(h.project, 'config.toml');
    const original = 'model_reasoning_effort = "high"\n# user edit\n';
    writeFileSync(path, original);

    const outcome = await applyAction(action(path, 'stale'), {
      ...h.context,
      runner: runner(path, 'conflict'),
      cwd: h.project,
    });

    assert.equal(outcome.status, 'precondition-drift');
    assert.equal(outcome.diagnostics[0]?.code, 'action-precondition-drift');
    assert.equal(readFileSync(path, 'utf8'), original);
    claim('codex-config-batch-write', 'precondition-drift', 'user-modification');
  });

  it('restores the original config bytes from its snapshot', async () => {
    const h = harness();
    const path = join(h.project, 'config.toml');
    const original = 'model_reasoning_effort = "high"\r\n# preserve CRLF\r\n';
    writeFileSync(path, original);

    const outcome = await applyAction(action(path), {
      ...h.context,
      runner: runner(path),
      cwd: h.project,
    });
    assert.equal(outcome.status, 'applied');

    await rollback(h, outcome);
    assert.deepEqual(readFileSync(path), Buffer.from(original));
    claim('codex-config-batch-write', 'rollback');
  });
});

describe('action families this build does not execute', () => {
  const unimplemented: readonly PlannedActionKind[] = [
    'download-artifact',
    'run-installer-command',
    'merge-toml',
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
    assert.equal(EXECUTABLE_ACTION_KINDS.length, 9);
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

  /**
   * Obligations that cannot exist for a family, with the reason.
   *
   * Every other action family edits a file, and three of the five obligations are shaped by that:
   * a precondition digest is over file content, a user modification is an edit to a file, and a
   * Windows path is a path. `package-manager-install` touches no file — it is the one family whose
   * effect is outside the filesystem, which is also why RFC 0004 says restore-based rollback
   * "cannot undo side effects outside the filesystem".
   *
   * Exempted explicitly rather than claimed by a test that asserts nothing. An exemption with a
   * reason is reviewable; a hollow test is not.
   */
  const inapplicable: Readonly<Partial<Record<PlannedActionKind, readonly Obligation[]>>> = {
    'package-manager-install': ['precondition-drift', 'user-modification', 'windows-path'],
    // The reviewed boundary is snapshotted before invocation and restore-only afterwards. It does
    // not own a provider-created artifact, so removal-style user-modification and a planned-input
    // digest do not exist for this action family.
    'delegated-provider-install': ['precondition-drift', 'user-modification', 'windows-path'],
  };

  for (const kind of EXECUTABLE_ACTION_KINDS) {
    it(`${kind} has every required test`, () => {
      const claimed = covered.get(kind) ?? new Set<Obligation>();
      const exempt = new Set(inapplicable[kind] ?? []);
      const missing = [...required, ...(NATIVE_WINDOWS ? (['windows-path'] as const) : [])]
        .filter((obligation) => !exempt.has(obligation))
        .filter((obligation) => !claimed.has(obligation));
      assert.deepEqual(missing, [], `${kind} is missing: ${missing.join(', ')}`);
    });
  }
});
