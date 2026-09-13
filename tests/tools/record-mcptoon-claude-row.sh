#!/usr/bin/env bash
set -euo pipefail

ROOT="${GITHUB_WORKSPACE:-$(pwd)}"
OUT="$ROOT/tests/fixtures/rows/mcptoon-claude-linux-2.1.269-0.7.10"
REC_HOME="$ROOT/.mcptoon-claude-row-home"
PROJECT="$ROOT/.mcptoon-claude-row-project"
rm -rf "$OUT" "$REC_HOME" "$PROJECT"
mkdir -p "$OUT" "$REC_HOME" "$PROJECT"

record_stage() {
  local stage="$1"
  node tests/tools/record-row-fixture.mjs \
    --stage "$stage" --harness claude --provider mcptoon \
    --project "$PROJECT" --home "$REC_HOME" --out "$OUT" --reviewed
  node --input-type=module - "$OUT/$stage.json" "$REC_HOME" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [file, home] = process.argv.slice(2);
const record = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const relative of [
  '.claude/skills/mcptoon/SKILL.md',
  '.claude/skills/user-owned/SKILL.md',
]) {
  const absolute = path.join(home, relative);
  const key = `~/${relative}`;
  record.configuration[key] = fs.existsSync(absolute)
    ? { present: true, kind: 'file', contents: fs.readFileSync(absolute, 'utf8') }
    : { present: false };
}
fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
NODE
}

record_stage empty

mkdir -p "$REC_HOME/.claude/skills/user-owned"
cat > "$REC_HOME/.claude/settings.json" <<'EOF'
{
  "theme": "dark",
  "userOwnedFixture": true
}
EOF
cat > "$REC_HOME/.claude/skills/user-owned/SKILL.md" <<'EOF'
---
name: user-owned
description: Fixture content owned by the user, never by Token Harness.
---

# User-owned skill
Keep this content byte-for-byte.
EOF
record_stage brownfield

node tests/tools/mcptoon-claude-row-lifecycle.mjs \
  --operation apply --project "$PROJECT" --home "$REC_HOME" \
  --transaction-id mcptoon-claude-apply-1 > "$OUT/apply-transaction.json"
record_stage post-apply

printf '\n# user edit after apply\n' >> "$REC_HOME/.claude/skills/mcptoon/SKILL.md"
set +e
node tests/tools/mcptoon-claude-row-lifecycle.mjs \
  --operation uninstall --project "$PROJECT" --home "$REC_HOME" \
  --transaction-id mcptoon-claude-drift-uninstall \
  --source-transaction-id mcptoon-claude-apply-1 > "$OUT/drift-refusal-transaction.json"
drift_status=$?
set -e
if [ "$drift_status" -eq 0 ]; then
  echo 'Expected modified owned SKILL.md uninstall to be refused' >&2
  exit 1
fi
grep -q 'user edit after apply' "$REC_HOME/.claude/skills/mcptoon/SKILL.md"
record_stage drift

node tests/tools/mcptoon-claude-row-lifecycle.mjs \
  --operation rollback --project "$PROJECT" --home "$REC_HOME" \
  --transaction-id mcptoon-claude-apply-1 > "$OUT/rollback-transaction.json"
test ! -e "$REC_HOME/.claude/skills/mcptoon/SKILL.md"
grep -q 'userOwnedFixture' "$REC_HOME/.claude/settings.json"
grep -q 'Keep this content byte-for-byte' "$REC_HOME/.claude/skills/user-owned/SKILL.md"
record_stage rollback

node tests/tools/mcptoon-claude-row-lifecycle.mjs \
  --operation apply --project "$PROJECT" --home "$REC_HOME" \
  --transaction-id mcptoon-claude-apply-2 > "$OUT/reapply-transaction.json"
printf '\nPost-apply user change that uninstall must preserve.\n' >> "$REC_HOME/.claude/skills/user-owned/SKILL.md"
node --input-type=module - "$REC_HOME/.claude/settings.json" <<'NODE'
import fs from 'node:fs';
const file = process.argv[2];
const value = JSON.parse(fs.readFileSync(file, 'utf8'));
value.changedAfterApply = true;
fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
NODE
node tests/tools/mcptoon-claude-row-lifecycle.mjs \
  --operation uninstall --project "$PROJECT" --home "$REC_HOME" \
  --transaction-id mcptoon-claude-uninstall \
  --source-transaction-id mcptoon-claude-apply-2 > "$OUT/uninstall-transaction.json"
test ! -e "$REC_HOME/.claude/skills/mcptoon/SKILL.md"
grep -q 'changedAfterApply' "$REC_HOME/.claude/settings.json"
grep -q 'Post-apply user change' "$REC_HOME/.claude/skills/user-owned/SKILL.md"
record_stage uninstall

cat > "$OUT/README.md" <<EOF
# mcptoon × Claude Code × Linux RFC 0009 recording

Recorded on $(date -u +%Y-%m-%d) by GitHub Actions run ${GITHUB_RUN_ID:-local} on an Ubuntu 24.04 Linux x64 hosted runner.

Exact observed combination:

- Claude Code: **2.1.269**
- mcptoon: **0.7.10**
- platform: **Linux, non-WSL, x64**
- Node.js: **22.13.1**
- verification tier: **config-only**

The recording used an isolated home and project. Brownfield state contained user-owned Claude settings and a separate user-owned skill. Managed apply created only the reviewed mcptoon skill path plus any missing parent directory. The transaction journal recorded the exact owned-file digest.

The drift stage modified the owned mcptoon SKILL.md and then attempted surgical uninstall. The production ownership guard refused removal and the edited file remained present. Verified rollback restored the complete pre-apply brownfield state. A second clean apply followed by surgical uninstall removed only the owned mcptoon SKILL.md while preserving user-owned settings and a user-owned skill, including changes made after apply.

invalidating-update.json is intentionally absent: no second real mcptoon or Claude Code version was installed merely to manufacture an invalidation state. The compatibility row must remain exact.
EOF

(
  cd "$OUT"
  sha256sum *.json > SHA256SUMS
)
