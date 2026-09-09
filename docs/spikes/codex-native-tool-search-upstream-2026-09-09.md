# Codex native MCP tool-search evidence — 2026-09-09

## Finding

The reviewed Codex 0.146.0 source already contains the modern tool-search behavior: the old `tool_search` compatibility flag is a removed no-op, and the old `tool_search_always_defer_mcp_tools` flag is also removed because MCP tools are deferred whenever tool search is available.

Current upstream keeps the same contract. `mcp_tool_exposure.rs` registers effective MCP tools as deferred when `search_tool_enabled` is true. `search_tool_enabled` requires both model metadata `supports_search_tool` and provider capability `namespace_tools`.

Upstream commit `c53b1dae09db40902c59f6a0d57d0dcc334926db` (2026-06-22, PR #29486) made this the default path for all effective MCP tools whenever those two gates support it.

## Important observation gap

Codex app-server `model/list` does not currently expose `supports_search_tool` in its v2 Model schema, and Token Harness does not have a supported read of the provider's namespace-tools gate. Therefore Token Harness can prove that the mechanism exists in reviewed Codex 0.146.0, but cannot yet prove it is active for the current model/provider turn.

The old `config.features.tool_search` value must not be used as effective-state truth: in the reviewed source that flag is a compatibility tombstone/no-op.

## Token Harness policy

- Codex 0.146.0: report native MCP tool-search deferral as **available**, effective activation unverified.
- Unknown/newer/unreviewed Codex: report the mechanism as **unknown** until its contract is reviewed.
- Only runtime-proven **active** deferral may remove MCP tools from static context-pressure scoring.
- **available** is useful for provider selection: do not install or recommend an overlapping external Lazy MCP-style layer merely because the MCP inventory is large. First verify whether the native path can be observed.
- The legacy feature boolean remains raw compatibility evidence only and cannot override the richer state.

## Next probe

Find a stable Codex app-server/session response that exposes effective tool namespaces or search-tool availability. If none exists, benchmark native behavior with a controlled MCP fixture rather than adding a guessed config key.
