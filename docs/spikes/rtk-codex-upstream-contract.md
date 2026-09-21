# RTK Codex upstream hook contract

- Reviewed: 2026-09-21
- Upstream: `rtk-ai/rtk`
- Release: `v0.49.0`
- Source: `hooks/codex/README.md` at the upstream release line

This note records a **source-contract review**, not a local end-to-end canary.

RTK 0.49.0 documents a native Codex `PreToolUse` processor invoked as
`rtk hook codex`. Its global/project installer registers a `Bash` matcher in
Codex `hooks.json`, and the hook rewrites `tool_input.command` through Codex's
`updatedInput` response.

Token Harness intentionally adopts only the narrow hook entry that its own
transaction engine can own and roll back:

```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "rtk hook codex" }]
}
```

It does **not** invoke `rtk init --codex`, write `RTK.md`, edit `AGENTS.md`,
or grant sandbox/trust/approval permissions. Codex keeps responsibility for its
normal command approval and sandbox checks.

The RTK documentation also notes that Codex requires the hook response's protocol
permission decision for `updatedInput` to take effect and that the command safety
classifier does not currently unwrap the `rtk` binary. For that reason this row is
admitted at **config-only** verification until a harness-attributable execution
receipt is available; RTK's aggregate history database alone cannot prove which
configured harness produced a command.
