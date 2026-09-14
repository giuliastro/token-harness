# GitNexus × Claude Code × Linux RFC 0009 recording

Recorded on 2026-09-14 by GitHub Actions run 34878184649 on an Ubuntu 24.04 Linux x64 hosted runner.

Exact observed combination:

- Claude Code: **2.1.269**
- GitNexus: **1.6.12**
- platform: **Linux, non-WSL, x64**
- Node.js: **22.13.1**
- verification tier: **config-only**

The recording used an isolated home and project. The exact third-party CLIs were installed only as GitHub Actions fixture prerequisites; Token Harness did not install GitNexus. GitNexus optional language grammars were skipped during CI installation because this row covers only the Claude user MCP JSON lifecycle, not indexing or language parsing.

Brownfield state contained unrelated user-owned Claude settings plus a separate user-owned MCP server in ~/.claude.json. Managed apply used the production GitNexus planner and generic merge-json transaction to add only mcpServers.gitnexus = { command: gitnexus, args: [mcp] }, with a real owned-json-entry receipt. Verification remained passive and did not start the MCP server.

The drift stage edited only the Token Harness-owned GitNexus entry. Surgical removal was refused and left the user edit untouched. Verified rollback restored the complete pre-apply brownfield state. A second clean apply followed by surgical uninstall removed only the owned GitNexus entry while preserving both pre-existing user configuration and unrelated changes made after apply.

No gitnexus setup, analyze, indexing, hooks, skills installation, MCP server execution, or Codex configuration occurred. invalidating-update.json is intentionally absent: no second real GitNexus or Claude Code version was installed merely to manufacture an invalidation state. Any compatibility row admitted from this fixture must remain exact.
