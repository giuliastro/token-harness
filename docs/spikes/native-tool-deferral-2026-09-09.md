# Native tool deferral spike — 2026-09-09

This spike starts RFC 0024 Milestone A. It records what is known today and, more importantly, what is **not** yet proven for the Claude Code / Codex subscription clients Token Harness actually manages.

## Existing Token Harness evidence

The Codex adapter already queries the native app-server with `mcpServerStatus/list` and records each MCP server's tool count, runtime status and auth status. That is enough to inventory potential context pressure, but it does **not** expose tool-schema byte size, prove that every listed tool is inserted into every model turn, or expose a supported Token Harness mutation for deferred loading.

Therefore tool count remains an observation, not a reason to disable or rewrite MCP configuration.

## Public vendor capabilities checked on 2026-09-09

### OpenAI

The current public Responses beta reference includes a `tool_search` tool described as hosted/BYOT tool search for deferred tools:

- https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses

This is evidence that OpenAI has a native deferred-tool mechanism at the API surface. It is **not** evidence that the signed-in Codex CLI subscription path or Codex app-server currently exposes the same control.

Token Harness must not infer a Codex config key or write one from the API documentation.

### Anthropic

The current Claude Platform MCP toolset documentation exposes per-tool / default configuration with `defer_loading`, where deferred tool descriptions are not sent initially and are paired with tool search:

- https://docs.anthropic.com/ja/docs/agents-and-tools/mcp-connector

Anthropic's current migration guidance also documents changing tools mid-conversation without invalidating earlier prompt-cache hits:

- https://docs.anthropic.com/it/docs/about-claude/models/migrating-to-claude-4

These are Claude Platform/API capabilities. They are **not** proof that Claude Code's subscription client exposes an equivalent user setting or stable CLI contract.

## First implementation probes

### Codex

1. Reuse the native app-server transport already used for context/model/MCP inventory.
2. Inspect only documented/discoverable app-server responses or schemas for a deferred-tool/tool-search capability.
3. If no stable capability is exposed, record `native-deferral: unavailable/unknown`; do not synthesize a `config.toml` field.
4. Extend MCP observation only when the native response provides stronger evidence than current tool counts (for example deferred state or schema metadata).
5. Keep any future write behind exact-version admission, reviewed plan/apply, config-origin evidence and rollback.

### Claude Code

1. Observe the installed CLI/version and existing supported configuration without network writes.
2. Look for a stable native Claude Code setting/command that corresponds to deferred MCP/tool loading.
3. Do not treat Claude Platform API fields as Claude Code config fields.
4. If the subscription client exposes no supported control, mark the native path unavailable and move to the external-provider comparison rather than guessing.

## External-provider fallback

Only if neither subscription client exposes an equivalent safe native path should the milestone evaluate a Lazy MCP-style external layer.

Before installation/adoption it must provide:

- identifiable package/repository/version;
- explicit config ownership surface;
- fail-open behavior;
- observable before/after tool exposure;
- no prompt egress to an unreviewed paid service;
- reversible removal or an honest non-reversible classification.

Native support wins when it achieves equivalent deferral with less ownership and compatibility risk.

## Measurement plan

For a candidate deferral mechanism, capture at least:

- MCP server count and tool count;
- any native tool/schema size evidence the harness actually exposes;
- local input/cached/output token deltas where attributable;
- task quality result;
- attempts, failed attempts and runtime/tool errors;
- authoritative same-window provider allowance snapshots when available.

Do not convert schema bytes or local tokens into subscription quota. If backend allowance evidence is unavailable, report the result as context/tool-definition reduction only.

## Immediate next code step

Add a provider-neutral read-only `tool deferral capability` observation only after the Codex/Claude probes identify a real stable signal. The type must be able to express at least `supported`, `unsupported`, `unknown`, and an evidence source/version. It must not start with a boolean that forces unknown into false.

No mutation belongs in the first PR until one native or external mechanism has a verified configuration contract.
