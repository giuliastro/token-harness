import fs from 'node:fs';

const mode = process.argv[2];
if (mode !== 'prepare' && mode !== 'admit') throw new Error('usage: prepare|admit');

function replaceOnce(path, oldText, newText) {
  let text = fs.readFileSync(path, 'utf8');
  if (!text.includes(oldText)) throw new Error(`${path}: replacement target not found`);
  text = text.replace(oldText, newText);
  fs.writeFileSync(path, text);
}

if (mode === 'prepare') {
  replaceOnce(
    'tests/tools/record-row-fixture.mjs',
    "    home: ['.claude/settings.json', '.claude/settings.local.json', '.claude/skills'],",
    "    home: ['.claude.json', '.claude/settings.json', '.claude/settings.local.json', '.claude/skills'],",
  );
  replaceOnce(
    'tests/tools/record-row-fixture.mjs',
    "  gitnexus: ['gitnexus', '--version'],\n};",
    "  gitnexus: ['gitnexus', '--version'],\n  headroom: ['headroom', '--version'],\n};",
  );
  replaceOnce(
    'apps/cli/src/guided.ts',
    "!['rtk', 'harnesstrim', 'mcptoon', 'gitnexus'].includes(String(data['provider']))",
    "!['rtk', 'harnesstrim', 'mcptoon', 'gitnexus', 'headroom'].includes(String(data['provider']))",
  );
  replaceOnce(
    'packages/adapters/src/providers/headroom-managed.ts',
    '      bodyDigest: digestText(HEADROOM_CODEX_MCP_BODY),',
    '      bodyDigest: digestText(`${HEADROOM_CODEX_MCP_BODY}\\n`),',
  );

  const smoke = '.github/workflows/headroom-candidate-smoke.yml';
  let text = fs.readFileSync(smoke, 'utf8');
  text = text.replace(
    "      - 'packages/adapters/src/providers/headroom-candidate.ts'\n      - 'packages/adapters/test/headroom-candidate.test.ts'",
    "      - 'packages/adapters/src/providers/headroom-candidate.ts'\n      - 'packages/adapters/src/providers/headroom-managed.ts'\n      - 'packages/adapters/src/providers/headroom-provider.ts'\n      - 'packages/adapters/test/headroom-candidate.test.ts'\n      - 'packages/adapters/test/headroom-managed.test.ts'",
  );
  text = text.replace(
    '  passive-compatibility:\n    runs-on: ubuntu-latest',
    "  passive-compatibility:\n    strategy:\n      fail-fast: false\n      matrix:\n        os: [ubuntu-latest, macos-latest, windows-latest]\n    runs-on: ${{ matrix.os }}",
  );
  text = text.replace("'headroom-ai[proxy]==0.37.0'", "'headroom-ai[mcp]==0.37.0'");
  text = text.replace(
    '          help="$(headroom wrap --help 2>&1)"\n\n          printf \'%s\\n\' "$version"\n          printf \'%s\\n\' "$help"',
    '          help="$(headroom wrap --help 2>&1)"\n          mcp_help="$(headroom mcp serve --help 2>&1)"\n\n          printf \'%s\\n\' "$version"\n          printf \'%s\\n\' "$help"\n          printf \'%s\\n\' "$mcp_help"',
  );
  text = text.replace(
    "          grep -Eiq '(^|[^[:alnum:]-])codex([^[:alnum:]-]|$)' <<<\"$help\"",
    "          grep -Eiq '(^|[^[:alnum:]-])codex([^[:alnum:]-]|$)' <<<\"$help\"\n          grep -Eiq 'serve|server|mcp' <<<\"$mcp_help\"",
  );
  text = text.replace(
    "          echo 'This workflow intentionally stops at --version and wrap --help.'",
    "          echo 'This workflow intentionally stops at --version, wrap --help and mcp serve --help.'",
  );
  fs.writeFileSync(smoke, text);
}

if (mode === 'admit') {
  const compatibility = 'packages/core/src/domain/compatibility-rows.ts';
  let text = fs.readFileSync(compatibility, 'utf8');
  const marker = '\n];\n\nexport type RowHarnessVerdict';
  if (!text.includes(marker)) throw new Error('compatibility row insertion point not found');
  if (!text.includes("provider: 'headroom' as ProviderId")) {
    const rows = `
  {
    harness: 'claude' as HarnessId,
    harnessVersion: { minimum: '2.1.269', maximum: '2.1.269' },
    provider: 'headroom' as ProviderId,
    providerVersion: '0.37.0',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Ubuntu/Linux recording with the exact Headroom CLI. The harness executable was used
    // only for its version. Apply/verify/drift/rollback/uninstall exercised only ~/.claude.json;
    // no model request, wrap/proxy/deploy, or MCP server session was started.
    configSchema: 'claude-user-json-mcp-entry',
    fixture: 'tests/fixtures/rows/headroom-claude-linux-2.1.269-0.37.0',
    verificationTier: 'config-only',
  },
  {
    harness: 'codex' as HarnessId,
    harnessVersion: { minimum: '0.153.0', maximum: '0.153.0' },
    provider: 'headroom' as ProviderId,
    providerVersion: '0.37.0',
    platform: { os: 'linux', wsl: false, supported: true, limitation: null },
    // Real Ubuntu/Linux recording with the exact Headroom CLI. The lifecycle owns only the
    // marker-delimited mcp_servers.headroom block in ~/.codex/config.toml and preserves user data.
    configSchema: 'codex-config-toml-marker-block',
    fixture: 'tests/fixtures/rows/headroom-codex-linux-0.153.0-0.37.0',
    verificationTier: 'config-only',
  },`;
    text = text.replace(marker, `${rows}\n];\n\nexport type RowHarnessVerdict`);
    fs.writeFileSync(compatibility, text);
  }

  const statusPath = 'docs/development-status.md';
  let status = fs.readFileSync(statusPath, 'utf8');
  const needle = 'All three managed configuration lifecycles use exact-version/config-only admission, ownership-aware removal and drift refusal.';
  const replacement = 'Headroom managed mutation is initially admitted only for the exact Linux recordings Claude Code 2.1.269 + Headroom 0.37.0 and Codex 0.153.0 + Headroom 0.37.0; macOS/Windows still run the passive real-CLI smoke and the shared transactional test suite but remain mutation-refused until equivalent row fixtures exist. All three managed configuration lifecycles use exact-version/config-only admission, ownership-aware removal and drift refusal.';
  if (!status.includes(replacement)) {
    if (!status.includes(needle)) throw new Error('development status Headroom sentence not found');
    status = status.replace(needle, replacement);
    fs.writeFileSync(statusPath, status);
  }
}
