import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { digestBytes, harnessId, type FileStat, type FileSystemPort } from '@token-harness/core';

import {
  observeAgentSkill,
  planAgentSkillInstall,
  TOKEN_HARNESS_AGENT_SKILL,
} from '../src/agent-skill.js';

function memoryFs(
  entries: Record<string, { kind: 'file' | 'directory'; content?: string }>,
): FileSystemPort {
  const normalize = (parts: string[]): string => ('/' + parts.join('/')).replace(/\/{2,}/g, '/');
  return {
    join: (...parts) => normalize(parts),
    dirname: (path) => path.slice(0, Math.max(1, path.lastIndexOf('/'))) || '/',
    basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
    isInside: (candidate, parent) =>
      candidate === parent || candidate.startsWith(parent.replace(/\/$/, '') + '/'),
    stat: async (path): Promise<FileStat | null> => {
      const entry = entries[path];
      return entry === undefined
        ? null
        : { kind: entry.kind, byteLength: entry.content?.length ?? 0, mode: null };
    },
    readFile: async (path) => new TextEncoder().encode(entries[path]?.content ?? ''),
    writeFile: async () => undefined,
    appendFile: async () => undefined,
    createDirectory: async () => undefined,
    remove: async () => undefined,
    readDirectory: async (path) => {
      const prefix = path.replace(/\/$/, '') + '/';
      const names = Object.keys(entries)
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length).split('/')[0]);
      return [
        ...new Set(names.filter((name): name is string => name !== undefined && name !== '')),
      ];
    },
  };
}

describe('guided Agent Skill installation planning', () => {
  it('plans a reversible Claude user skill without network or model changes', async () => {
    const plan = await planAgentSkillInstall({
      fs: memoryFs({ '/home/dev/.claude': { kind: 'directory' } }),
      home: '/home/dev',
      harness: harnessId('claude'),
      version: '2.1.261',
    });
    assert.equal(plan.target, '/home/dev/.claude/skills/token-harness/SKILL.md');
    assert.equal(plan.actions.at(-1)?.kind, 'write-owned-file');
    const write = plan.actions.at(-1);
    assert.ok(write?.kind === 'write-owned-file');
    assert.equal(write.content, TOKEN_HARNESS_AGENT_SKILL);
    assert.equal(write.expectedDigest, null);
    assert.equal(write.requiresNetwork, false);
    assert.equal(
      plan.actions.some((action) => action.kind === 'codex-config-batch-write'),
      false,
    );
  });

  it('uses the documented Codex user Agent Skills directory', async () => {
    const plan = await planAgentSkillInstall({
      fs: memoryFs({
        '/home/dev/.agents': { kind: 'directory' },
        '/home/dev/.agents/skills': { kind: 'directory' },
      }),
      home: '/home/dev',
      harness: harnessId('codex'),
      version: '0.146.0',
    });
    assert.equal(plan.target, '/home/dev/.agents/skills/token-harness/SKILL.md');
    assert.equal(plan.actions.at(-1)?.kind, 'write-owned-file');
  });

  it('does not adopt a byte-identical skill that already exists', async () => {
    const plan = await planAgentSkillInstall({
      fs: memoryFs({
        '/home/dev/.claude': { kind: 'directory' },
        '/home/dev/.claude/skills': { kind: 'directory' },
        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },
        '/home/dev/.claude/skills/token-harness/SKILL.md': {
          kind: 'file',
          content: TOKEN_HARNESS_AGENT_SKILL,
        },
      }),
      home: '/home/dev',
      harness: harnessId('claude'),
      version: '2.1.261',
    });
    assert.equal(plan.actions.length, 0);
    assert.equal(
      plan.diagnostics.some((item) => item.code === 'agent-skill-already-present'),
      true,
    );
  });

  it('reports a matching user-owned skill as enabled externally', async () => {
    const observation = await observeAgentSkill({
      fs: memoryFs({
        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },
        '/home/dev/.claude/skills/token-harness/SKILL.md': {
          kind: 'file',
          content: TOKEN_HARNESS_AGENT_SKILL,
        },
      }),
      home: '/home/dev',
      stateRoot: '/state',
      harness: 'claude',
    });
    assert.equal(observation.state, 'external');
  });

  it('reports the skill as managed only when the newest relevant committed journal owns the live digest', async () => {
    const target = '/home/dev/.claude/skills/token-harness/SKILL.md';
    const digest = digestBytes(new TextEncoder().encode(TOKEN_HARNESS_AGENT_SKILL));
    const journal = JSON.stringify({
      schemaVersion: 1,
      transactionId: 'tx1',
      planId: 'abcd1234',
      projectId: null,
      projectRoot: '/project',
      startedAt: '2026-09-08T20:00:00.000Z',
      finishedAt: '2026-09-08T20:00:01.000Z',
      outcome: 'committed',
      entries: [
        {
          actionId: 'agent-skill:claude:write',
          kind: 'write-owned-file',
          status: 'applied',
          snapshots: [{ path: target, kind: 'absent' }],
          ownership: [{ kind: 'owned-file', path: target, digest, mode: '0644' }],
          diagnostics: [],
          packageInventory: null,
        },
      ],
      ownership: [{ kind: 'owned-file', path: target, digest, mode: '0644' }],
      pinned: false,
      diagnostics: [],
    });
    const observation = await observeAgentSkill({
      fs: memoryFs({
        '/home/dev/.claude/skills/token-harness': { kind: 'directory' },
        [target]: { kind: 'file', content: TOKEN_HARNESS_AGENT_SKILL },
        '/state/journals': { kind: 'directory' },
        '/state/journals/tx1.json': { kind: 'file', content: journal },
      }),
      home: '/home/dev',
      stateRoot: '/state',
      harness: 'claude',
    });
    assert.equal(observation.state, 'managed');
  });

  it('reports a custom same-name skill as a conflict instead of overwriting it', async () => {
    const observation = await observeAgentSkill({
      fs: memoryFs({
        '/home/dev/.agents/skills/token-harness': { kind: 'directory' },
        '/home/dev/.agents/skills/token-harness/SKILL.md': {
          kind: 'file',
          content: '# custom skill\n',
        },
      }),
      home: '/home/dev',
      stateRoot: '/state',
      harness: 'codex',
    });
    assert.equal(observation.state, 'conflict');
  });

  it('refuses to overwrite an existing user-owned token-harness skill directory', async () => {
    const plan = await planAgentSkillInstall({
      fs: memoryFs({
        '/home/dev/.agents': { kind: 'directory' },
        '/home/dev/.agents/skills': { kind: 'directory' },
        '/home/dev/.agents/skills/token-harness': { kind: 'directory' },
        '/home/dev/.agents/skills/token-harness/SKILL.md': {
          kind: 'file',
          content: '# custom skill\n',
        },
      }),
      home: '/home/dev',
      harness: harnessId('codex'),
      version: '0.146.0',
    });
    assert.equal(plan.actions.length, 0);
    assert.equal(
      plan.diagnostics.some((item) => item.code === 'agent-skill-target-owned-by-user'),
      true,
    );
  });
});
