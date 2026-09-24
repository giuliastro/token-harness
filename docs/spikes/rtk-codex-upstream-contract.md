# RTK Codex upstream hook contract

- Reviewed: 2026-09-24
- Upstream: `rtk-ai/rtk`
- Release: `v0.50.0`
- Source: `hooks/codex/README.md` at the upstream release line

This note records a **source-contract review**, not a local end-to-end canary.

RTK 0.50.0 adds a native Codex `PreToolUse` processor invoked as
`rtk hook codex`. Its global/project installer registers a `Bash` matcher in
Codex `hooks.json`, and the hook rewrites `tool_input.command` through Codex's
`updatedInput` response.

RTK 0.49.0 did not contain this processor: its Codex support was prompt-level
guidance only. A `hooks.json` entry on that release could therefore look installed
without recording or rewriting Codex commands.

Token Harness intentionally adopts only the narrow hook entry that its own
transaction engine can own and roll back:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "token-harness __internal-rtk-hook codex" }]
}
```

The Token Harness proxy invokes RTK's native hook and sets `RTK_DB_PATH` for both
the hook and the rewritten command. Codex and Claude Code therefore write command
history to separate databases. Older rows in RTK's shared `history.db` still have
no harness identifier and remain `unknown`.

It does **not** invoke `rtk init --codex`, write `RTK.md`, edit `AGENTS.md`,
or grant sandbox/trust/approval permissions. Codex keeps responsibility for its
normal command approval and sandbox checks.

The RTK documentation also notes that Codex requires the hook response's protocol
permission decision for `updatedInput` to take effect and that the command safety
classifier does not currently unwrap the `rtk` binary. For that reason this row is
admitted at **canary** verification only after its harness-specific database receives
an operation. Linux source-contract and automated tests do not complete issue #255's
native Windows release validation.
