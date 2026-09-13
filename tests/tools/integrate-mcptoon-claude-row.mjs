import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const source = fs.readFileSync(path, 'utf8');
  if (!source.includes(before)) throw new Error(`anchor not found in ${path}: ${before.slice(0, 80)}`);
  const first = source.indexOf(before);
  if (source.indexOf(before, first + before.length) !== -1) {
    throw new Error(`anchor occurs more than once in ${path}: ${before.slice(0, 80)}`);
  }
  fs.writeFileSync(path, source.replace(before, after));
}

const rowsPath = 'packages/core/src/domain/compatibility-rows.ts';
replaceOnce(
  rowsPath,
  ` * Windows supplied the first reviewed rows. Linux now has exact Codex 0.152.1 rows for HarnessTrim\n * 0.2.1 and mcptoon 0.7.10. The mcptoon recording ran on Ubuntu 24.04.5 and exercised the owned\n * AGENTS.md marker block through managed apply, user drift, verified rollback, and surgical uninstall\n * while preserving unrelated user instructions. Windows also has live isolated recordings for Claude\n`,
  ` * Windows supplied the first reviewed rows. Linux now has exact Codex 0.152.1 rows for HarnessTrim\n * 0.2.1 and mcptoon 0.7.10, plus an exact Claude Code 2.1.269 row for mcptoon 0.7.10. The mcptoon\n * recordings ran on Ubuntu 24.04.5 and exercised each owned instruction surface through managed apply,\n * user drift, verified rollback, and surgical uninstall while preserving unrelated user content.\n * Windows also has live isolated recordings for Claude\n`,
);
replaceOnce(
  rowsPath,
  `  {\n    harness: 'codex' as HarnessId,\n    harnessVersion: { minimum: '0.152.1', maximum: '0.152.1' },\n    provider: 'mcptoon' as ProviderId,\n`,
  `  {\n    harness: 'claude' as HarnessId,\n    harnessVersion: { minimum: '2.1.269', maximum: '2.1.269' },\n    provider: 'mcptoon' as ProviderId,\n    providerVersion: '0.7.10',\n    platform: { os: 'linux', wsl: false, supported: true, limitation: null },\n    // Real Ubuntu/Linux recording: Token Harness owns only the exact mcptoon SKILL.md. Drift\n    // refusal, verified rollback and surgical uninstall preserved unrelated Claude settings/skills.\n    configSchema: 'claude-skills-directory',\n    fixture: 'tests/fixtures/rows/mcptoon-claude-linux-2.1.269-0.7.10',\n    verificationTier: 'config-only',\n  },\n  {\n    harness: 'codex' as HarnessId,\n    harnessVersion: { minimum: '0.152.1', maximum: '0.152.1' },\n    provider: 'mcptoon' as ProviderId,\n`,
);

const testsPath = 'packages/core/test/compatibility-rows.test.ts';
const testAnchor = `  it('admits an exact provider × harness × version × platform match', () => {\n`;
const claudeTest = `  it('ships the exact Linux Claude 2.1.269 / mcptoon 0.7.10 admission and nothing broader', () => {\n    const exact = admitManagedMutation(COMPATIBILITY_ROWS, {\n      provider: providerId('mcptoon'),\n      providerVersion: '0.7.10',\n      harness: harnessId('claude'),\n      harnessVersion: '2.1.269',\n      os: 'linux',\n      wsl: false,\n    });\n    assert.equal(exact.state, 'admitted');\n    if (exact.state === 'admitted') {\n      assert.equal(exact.row.configSchema, 'claude-skills-directory');\n      assert.equal(\n        exact.row.fixture,\n        'tests/fixtures/rows/mcptoon-claude-linux-2.1.269-0.7.10',\n      );\n      assert.equal(exact.row.verificationTier, 'config-only');\n    }\n\n    for (const variant of [\n      { harnessVersion: '2.1.268', providerVersion: '0.7.10', os: 'linux', wsl: false },\n      { harnessVersion: '2.1.270', providerVersion: '0.7.10', os: 'linux', wsl: false },\n      { harnessVersion: '2.1.269', providerVersion: '0.7.11', os: 'linux', wsl: false },\n      { harnessVersion: '2.1.269', providerVersion: '0.7.10', os: 'linux', wsl: true },\n      { harnessVersion: '2.1.269', providerVersion: '0.7.10', os: 'windows', wsl: false },\n      { harnessVersion: '2.1.269', providerVersion: '0.7.10', os: 'macos', wsl: false },\n    ] as const) {\n      const outcome = admitManagedMutation(COMPATIBILITY_ROWS, {\n        provider: providerId('mcptoon'),\n        providerVersion: variant.providerVersion,\n        harness: harnessId('claude'),\n        harnessVersion: variant.harnessVersion,\n        os: variant.os,\n        wsl: variant.wsl,\n      });\n      assert.equal(outcome.state, 'refused');\n    }\n  });\n\n`;
replaceOnce(testsPath, testAnchor, `${claudeTest}${testAnchor}`);

const providerDoc = 'docs/provider-version-compatibility.md';
replaceOnce(
  providerDoc,
  `- **mcptoon 0.7.10** is the reviewed managed-candidate lifecycle release. Token Harness now has one\n  exact RFC 0009 admission row for mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL, backed by a live\n  Ubuntu recording. mcptoon remains a candidate rather than a globally registered provider; this\n`,
  `- **mcptoon 0.7.10** is the reviewed managed-candidate lifecycle release. Token Harness now has two\n  exact RFC 0009 admission rows on Linux non-WSL, backed by live Ubuntu recordings: Codex 0.152.1 and\n  Claude Code 2.1.269, both with mcptoon 0.7.10. mcptoon remains a candidate rather than a globally\n  registered provider; this\n`,
);
replaceOnce(
  providerDoc,
  `For **mcptoon**, candidate detection and managed lifecycle are intentionally narrower than provider\npromotion. The reviewed lifecycle recognizes the exact managed surface around 0.7.10, but RFC 0009\nadmits managed harness mutation only for the recorded Codex 0.152.1 × Linux non-WSL combination.\nAdjacent Codex versions, adjacent mcptoon versions, WSL and Windows remain refused until separately\nrecorded and reviewed. No semver inference widens that row.\n`,
  `For **mcptoon**, candidate detection and managed lifecycle are intentionally narrower than provider\npromotion. The reviewed lifecycle recognizes the exact managed surface around 0.7.10, but RFC 0009\nadmits managed harness mutation only for the two recorded Linux non-WSL combinations: Codex 0.152.1\nand Claude Code 2.1.269. Adjacent Claude/Codex versions, adjacent mcptoon versions, WSL, Windows and\nmacOS remain refused until separately recorded and reviewed. No semver inference widens either row.\n`,
);
replaceOnce(
  providerDoc,
  `Likewise, one\nexact mcptoon compatibility row is not proof that mcptoon should join the managed provider registry.\n`,
  `Likewise, two\nexact mcptoon compatibility rows are not proof that mcptoon should join the managed provider registry.\n`,
);

const candidateDoc = 'docs/candidates/mcptoon.md';
replaceOnce(
  candidateDoc,
  `brownfield-safe Claude Code/Codex instruction surfaces, passive verification, and an exact RFC 0009\ncompatibility row for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL**.\n`,
  `brownfield-safe Claude Code/Codex instruction surfaces, passive verification, and exact RFC 0009\ncompatibility rows for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL** and\n**mcptoon 0.7.10 × Claude Code 2.1.269 × Linux non-WSL**.\n`,
);
replaceOnce(
  candidateDoc,
  `This is intentionally a **lifecycle** pass, not a compatibility-breadth pass. It says Token Harness\nhas reviewed mechanics for installing, owning, verifying and reversing the candidate integration. It\ndoes not make unrecorded harness/OS/version combinations compatible and does not satisfy the separate\n\`compatibility-reversibility\` or \`combined-stack-validation\` gates.\n`,
  `This is intentionally a **lifecycle** pass, not a compatibility-breadth pass. It says Token Harness\nhas reviewed mechanics for installing, owning, verifying and reversing the candidate integration. The\nsecond live Linux row additionally proves the exact Claude Code 2.1.269 skill surface, including drift\nrefusal and preservation of unrelated post-apply user changes. It does not make unrecorded\nharness/OS/version combinations compatible and does not satisfy the separate\n\`compatibility-reversibility\` or \`combined-stack-validation\` gates.\n`,
);

const readinessDoc = 'docs/candidates/promotion-readiness.md';
replaceOnce(
  readinessDoc,
  `- an exact RFC 0009 recording for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL**, captured on a\n  real Ubuntu runner with brownfield state, managed apply, user drift, verified rollback and surgical\n  uninstall.\n\nPassing \`managed-lifecycle\` does **not** pass \`compatibility-reversibility\`. The exact row still admits\nonly that recorded combination; Codex 0.152.2, mcptoon 0.7.11, WSL and Windows remain refused, and the\nintended promoted harness/platform surface still needs a separate compatibility decision.\n`,
  `- exact RFC 0009 recordings for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL** and\n  **mcptoon 0.7.10 × Claude Code 2.1.269 × Linux non-WSL**, captured on real Ubuntu runners with\n  brownfield state, managed apply, user drift, verified rollback and surgical uninstall.\n\nPassing \`managed-lifecycle\` does **not** pass \`compatibility-reversibility\`. The exact rows still admit\nonly those recorded combinations; adjacent harness/provider versions, WSL, Windows and macOS remain\nrefused, and the intended promoted harness/platform surface still needs a separate compatibility\ndecision.\n`,
);

console.log('Integrated exact mcptoon × Claude Code 2.1.269 Linux compatibility row.');
