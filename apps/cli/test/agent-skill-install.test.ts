import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileStat, FileSystemPort } from '@token-harness/core';
import { harnessId } from '@token-harness/core';

import { planAgentSkillInstall, TOKEN_HARNESS_AGENT_SKILL } from '../src/agent-skill.js';

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
    readDirectory: async () => [],
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
