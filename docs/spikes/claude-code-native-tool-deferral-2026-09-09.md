# Claude Code native tool-deferral probe — 2026-09-09

## Public platform capability

Anthropic's current Claude Platform MCP toolset contract supports `defer_loading`. When true, a tool description is not sent to the model initially and the mechanism is used with tool search. The platform also documents mid-conversation tool changes that preserve earlier prompt-cache hits.

Sources checked on 2026-09-09:

- https://docs.anthropic.com/ja/docs/agents-and-tools/mcp-connector
- https://docs.anthropic.com/it/docs/about-claude/models/migrating-to-claude-4

The migration guidance also states that the legacy `token-efficient-tools-2025-02-19` beta header has no effect on Claude 4+ models because efficient tool use is built in.

## What this does not prove

These are Claude Platform/API contracts. They do **not** establish that the signed-in Claude Code subscription client exposes:

- a supported `defer_loading` setting in Claude Code configuration;
- a stable CLI command for deferred MCP exposure;
- an observable runtime signal equivalent to Codex's native tool-search path;
- identical behavior for every MCP transport Claude Code supports.

Token Harness must therefore keep Claude Code native tool deferral as `unknown` until a Claude Code-specific contract or controlled runtime observation proves it.

## Policy consequence

Do not copy Claude Platform request fields into Claude Code settings and do not install an external Lazy MCP-style layer merely because the API supports deferred loading.

The Claude Code probe order is:

1. inspect supported Claude Code CLI/config surfaces for a documented tool-search/deferred-loading control;
2. inspect any machine-readable MCP inventory/runtime output for an effective exposure signal;
3. if neither exists, benchmark a controlled MCP fixture to determine whether the subscription client already performs progressive exposure internally;
4. only then compare an external deferral provider against that native baseline.

## Admission threshold for an external layer

An external provider must beat the observed Claude Code baseline on attributable context/tool-schema volume while preserving task quality and retry rate. It must also fail open, have explicit reversible ownership, and introduce no implicit paid API path.

Until those gates pass, Token Harness should report large Claude MCP inventories as potential exposure only, not as proof that an extra deferral product will save subscription allowance.
