# Token Optimizer MCP — candidate evaluation (first integration slice)

Reviewed upstream: [ooples/token-optimizer-mcp](https://github.com/ooples/token-optimizer-mcp),
2026-11-20. The upstream Codex plugin manifest advertised version `7.11.0` at review time.
This is **not** a compatibility approval for that release or for future versions.

## What this release adds

- A clearly labeled **Evaluation only** card in **Methods → More methods**, with an upstream
  link, scope and limitations. It never offers an installation or activation control.
- The `token-optimizer-mcp` identifier in candidate benchmark attribution and candidate
  comparison reports. Experiments remain separate from Headroom, mcptoon, GitNexus and the
  production RTK/HarnessTrim stack.
- The `context-minimization` category and broad context-owner admission gate. A promising
  upstream result or local comparison cannot bypass activation, compatibility, quality,
  ownership or rollback requirements.

This slice **does not** register a managed provider, install the npm package, add an MCP server,
change `AGENTS.md` or `CLAUDE.md`, run a proxy, install or trust hooks, or claim active savings.
There is no passive activation witness or reviewed version/harness/platform tuple yet. Therefore
the benchmark label identifies **which candidate was being tested**, not whether it actually ran.

## Why evaluate it separately

Upstream offers `smart_read`/`smart_grep` and diff-on-reread, contextual caching,
project knowledge graph, optional hooks, an MCP server and a compression proxy. These cover
several waste surfaces, not just MCP tool definitions. Overlap with RTK and HarnessTrim on
shell output and with Headroom on broad context ownership is substantial. The MCP-only
path is not equivalent to the full plugin: upstream's own comparison of its `off` mode
(hooks/proxy disabled) against a control did not show a meaningful aggregate cost gain.

Upstream's 10-task SWE-bench Verified Claude Sonnet run reports 0.705× relative cost in
default `assist` mode with 7/7 resolved in both arms. It is a small upstream-run comparison,
not measured Token Harness marginal value or proof of subscription allowance savings.

The upstream default MCP tool profile currently advertises **10 tools** (`core`); the
larger `full` profile is opt-in. Any subsequent managed adapter should explicitly preserve
that bounded default rather than unexpectedly expanding the tool catalog.

## Reproducible manual comparison

Use Token Harness's existing paired candidate workflow with the active RTK/HarnessTrim stack
unchanged in the baseline:

```sh
token-harness benchmark-matrix --benchmark-id token-optimizer-eval --candidate token-optimizer-mcp --harness codex
```

Follow each generated start/finish command. **External setup and activation are currently
manual**: verify that the desired upstream hooks/MCP/proxy really ran and retain independent
evidence of that fact. Do not claim a verified activation from campaign attribution or a
configured MCP entry. Do not compare an MCP-only run with a full-hook/proxy run as though they
were the same mechanism. Keep the model, task intent, project, native settings and unrelated
optimizers stable between variants. Record correctness, failures, attempts and wall-clock time
before interpreting local token counts. Do not turn local counts into subscription quota.

## Gates for the next PR

1. Select a reviewed, reproducible upstream version and inspect the actual Codex/Claude native
   plugin and MCP surfaces, including Node prerequisites and Windows launch forms.
2. Implement passive, side-effect-free presence/configuration checks and an attributable
   **runtime activation witness** (not simply an installed-package check).
3. Choose a narrow initial scope (e.g. MCP-only *or* reviewed lifecycle hooks) and explicitly
   arbitrate collisions with RTK/HarnessTrim; proxy ownership must be exclusive with Headroom.
4. Add dry-run plan/apply/verify/uninstall and transactional rollback with brownfield fixtures
   for Linux, Windows, macOS and WSL. Never rewrite user-owned config or grant hook trust.
5. Complete repeated quality-gated paired runs on the current stack before recommending
   activation, especially for users working on subscription quotas.

See [candidate promotion readiness](promotion-readiness.md),
[benchmark workflow](benchmarking.md) and [RFC 0027](../rfcs/0027-optimization-stack-manager.md).
