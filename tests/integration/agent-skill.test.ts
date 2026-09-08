import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT } from '../src/index.js';

const SKILL_PATH = join(REPO_ROOT, 'skills', 'token-harness', 'SKILL.md');
const SKILL = readFileSync(SKILL_PATH, 'utf8');
const INSTALLABLE_SOURCE = readFileSync(
  join(REPO_ROOT, 'apps', 'cli', 'src', 'agent-skill.ts'),
  'utf8',
);

function frontmatterField(name: string): string | null {
  const match = new RegExp(`^${name}:\\s*(.+)$`, 'm').exec(SKILL);
  return match?.[1]?.trim() ?? null;
}

describe('agent-native Token Harness skill', () => {
  it('keeps the bundled install payload byte-identical to SKILL.md', () => {
    const match = /TOKEN_HARNESS_AGENT_SKILL\s*=\s*("(?:\\.|[^"\\])*")\s*;/s.exec(
      INSTALLABLE_SOURCE,
    );
    assert.ok(match?.[1], 'installable skill source must expose one JSON string literal');
    assert.equal(JSON.parse(match[1]), SKILL);
  });

  it('has a compact portable Agent Skills frontmatter contract', () => {
    assert.match(SKILL, /^---\n[\s\S]*?\n---\n/);
    assert.equal(frontmatterField('name'), 'token-harness');
    assert.ok((frontmatterField('description')?.length ?? 0) > 40);
    assert.ok(
      SKILL.split('\n').length < 120,
      'skill should remain compact for progressive disclosure',
    );
  });

  it('delegates policy to the machine-readable Token Harness CLI', () => {
    assert.match(SKILL, /token-harness optimize .*--json/);
    assert.match(SKILL, /--tasks-left <N> --json/);
    assert.match(SKILL, /token-harness schedule .*--workload .*--json/);
    for (const taskClass of ['mechanical', 'standard', 'hard', 'critical']) {
      assert.match(SKILL, new RegExp('`' + taskClass + '`'));
    }
  });

  it('keeps configuration mutation behind explicit human approval', () => {
    assert.match(SKILL, /token-harness plan .*--native-policy/);
    assert.match(SKILL, /explicitly approves the proposed mutation/i);
    assert.match(SKILL, /token-harness apply --plan <id> --yes/);
    assert.doesNotMatch(SKILL, /npm install/);
  });

  it('preserves quota and context safety invariants', () => {
    assert.match(SKILL, /Never equate local token counts with subscription quota/);
    assert.match(SKILL, /Never compare raw Claude and Codex percentages/);
    assert.match(SKILL, /Unknown allowance or benchmark evidence stays unknown/);
    assert.match(SKILL, /Do not add an MCP server or background model/);
    assert.match(SKILL, /Do not run Token Harness before every trivial tool call/);
  });
});
