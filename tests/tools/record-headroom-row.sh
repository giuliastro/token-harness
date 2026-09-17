#!/usr/bin/env bash
set -euo pipefail

HARNESS="${1:-}"
if [ "$HARNESS" != "claude" ] && [ "$HARNESS" != "codex" ]; then
  echo 'usage: record-headroom-row.sh <claude|codex>' >&2
  exit 2
fi

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
if [ "$HARNESS" = "claude" ]; then
  HARNESS_VERSION="2.1.269"
  OUT="$ROOT/tests/fixtures/rows/headroom-claude-linux-2.1.269-0.37.0"
else
  HARNESS_VERSION="0.153.0"
  OUT="$ROOT/tests/fixtures/rows/headroom-codex-linux-0.153.0-0.37.0"
fi
REC_HOME="$ROOT/.headroom-${HARNESS}-row-home"
PROJECT="$ROOT/.headroom-${HARNESS}-row-project"
rm -rf "$OUT" "$REC_HOME" "$PROJECT"
mkdir -p "$OUT" "$REC_HOME" "$PROJECT"

record_stage() {
  local stage="$1"
  node tests/tools/record-row-fixture.mjs \
    --stage "$stage" --harness "$HARNESS" --provider headroom \
    --project "$PROJECT" --home "$REC_HOME" --out "$OUT" --reviewed
}

record_stage empty

if [ "$HARNESS" = "claude" ]; then
  cat > "$REC_HOME/.claude.json" <<'EOF'
{
  "theme": "dark",
  "userOwnedFixture": true,
  "mcpServers": {
    "user-owned": {
      "command": "user-owned-server",
      "args": ["serve"]
    }
  }
}
EOF
else
  mkdir -p "$REC_HOME/.codex"
  cat > "$REC_HOME/.codex/config.toml" <<'EOF'
model_reasoning_effort = "medium"
user_owned_fixture = true

[mcp_servers.user-owned]
command = "user-owned-server"
args = ["serve"]
EOF
fi
record_stage brownfield

node tests/tools/apply-with-provisional-row.mjs \
  --operation apply --harness "$HARNESS" --provider headroom \
  --project "$PROJECT" --home "$REC_HOME" > "$OUT/apply-transaction.json"
record_stage post-apply

if [ "$HARNESS" = "claude" ]; then
  node --input-type=module - "$REC_HOME/.claude.json" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.mcpServers.headroom.args = ['mcp', 'serve', '--user-drift'];
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE
else
  python3 - "$REC_HOME/.codex/config.toml" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1])
s = p.read_text()
s = s.replace('args = ["mcp", "serve"]', 'args = ["mcp", "serve", "--user-drift"]', 1)
p.write_text(s)
PY
fi

set +e
node tests/tools/apply-with-provisional-row.mjs \
  --operation uninstall --harness "$HARNESS" --provider headroom \
  --project "$PROJECT" --home "$REC_HOME" > "$OUT/drift-refusal-transaction.json"
drift_status=$?
set -e
if [ "$drift_status" -eq 0 ]; then
  echo 'Expected edited Headroom-owned integration uninstall to be refused' >&2
  exit 1
fi
if [ "$HARNESS" = "claude" ]; then
  grep -q -- '--user-drift' "$REC_HOME/.claude.json"
else
  grep -q -- '--user-drift' "$REC_HOME/.codex/config.toml"
fi
record_stage drift

node tests/tools/apply-with-provisional-row.mjs \
  --operation rollback --harness "$HARNESS" --provider headroom \
  --project "$PROJECT" --home "$REC_HOME" > "$OUT/rollback-transaction.json"
if [ "$HARNESS" = "claude" ]; then
  grep -q 'userOwnedFixture' "$REC_HOME/.claude.json"
  grep -q 'user-owned-server' "$REC_HOME/.claude.json"
  if grep -q '"headroom"' "$REC_HOME/.claude.json"; then
    echo 'Rollback left Headroom Claude MCP entry behind' >&2
    exit 1
  fi
else
  grep -q 'user_owned_fixture' "$REC_HOME/.codex/config.toml"
  grep -q 'user-owned-server' "$REC_HOME/.codex/config.toml"
  if grep -q 'mcp_servers.headroom' "$REC_HOME/.codex/config.toml"; then
    echo 'Rollback left Headroom Codex MCP entry behind' >&2
    exit 1
  fi
fi
record_stage rollback

node tests/tools/apply-with-provisional-row.mjs \
  --operation apply --harness "$HARNESS" --provider headroom \
  --project "$PROJECT" --home "$REC_HOME" > "$OUT/reapply-transaction.json"

if [ "$HARNESS" = "claude" ]; then
  node --input-type=module - "$REC_HOME/.claude.json" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.changedAfterApply = true;
value.mcpServers['post-apply-user-owned'] = { command: 'another-user-server', args: ['serve'] };
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE
else
  cat >> "$REC_HOME/.codex/config.toml" <<'EOF'

post_apply_user_owned = true
[mcp_servers.post-apply-user-owned]
command = "another-user-server"
args = ["serve"]
EOF
fi

node tests/tools/apply-with-provisional-row.mjs \
  --operation uninstall --harness "$HARNESS" --provider headroom \
  --project "$PROJECT" --home "$REC_HOME" > "$OUT/uninstall-transaction.json"

if [ "$HARNESS" = "claude" ]; then
  grep -q 'changedAfterApply' "$REC_HOME/.claude.json"
  grep -q 'post-apply-user-owned' "$REC_HOME/.claude.json"
  if grep -q '"headroom"' "$REC_HOME/.claude.json"; then
    echo 'Surgical uninstall left Headroom Claude MCP entry behind' >&2
    exit 1
  fi
else
  grep -q 'post_apply_user_owned' "$REC_HOME/.codex/config.toml"
  grep -q 'post-apply-user-owned' "$REC_HOME/.codex/config.toml"
  if grep -q 'mcp_servers.headroom' "$REC_HOME/.codex/config.toml"; then
    echo 'Surgical uninstall left Headroom Codex MCP entry behind' >&2
    exit 1
  fi
fi
record_stage uninstall

cat > "$OUT/README.md" <<EOF
# Headroom × ${HARNESS} × Linux RFC 0009 recording

Recorded on $(date -u +%Y-%m-%d) by GitHub Actions run ${GITHUB_RUN_ID:-local} on an Ubuntu hosted runner.

Exact observed combination:

- harness: **${HARNESS} ${HARNESS_VERSION}**
- Headroom: **0.37.0**
- platform: **Linux, non-WSL, x64**
- verification tier: **config-only**

The recording used an isolated home and project and the exact real Headroom 0.37.0 CLI. The harness CLI was used only for its version; no model request, authentication flow, indexing, proxy, wrap, deploy, or Headroom MCP server session was started. Managed apply exercised the production Headroom planner through a one-run provisional RFC 0009 row and wrote only the reviewed local MCP registration.

Brownfield state contained unrelated user-owned configuration and an unrelated MCP server. The drift stage edited only the Token Harness-owned Headroom entry/block; ownership-aware uninstall was refused and preserved that edit. Verified rollback restored the complete pre-apply brownfield state. A second clean apply followed by surgical uninstall removed only the owned Headroom MCP registration while preserving unrelated user changes made after apply.

invalidating-update.json is intentionally absent: no second Headroom or harness version was installed merely to manufacture an invalidation state. Any compatibility row admitted from this recording must remain exact.
EOF

(
  cd "$OUT"
  sha256sum *.json > SHA256SUMS
)
