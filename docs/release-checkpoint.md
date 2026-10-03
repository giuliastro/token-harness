# Release checkpoint — 2026-10-03

Token Harness `0.1.26` repairs automatic routing installation and clarifies native authorization.
It consolidates optimizer controls and measured evidence, supports mcptoon installation through an
existing uv, and refreshes health after approved updates.

## Changes in this release

- Stored-plan apply verifies routing with the reviewed harness selector. Previously `apply --plan`
  could install correct hooks and immediately roll them back during verification.
- Configuration fixtures cover Codex 0.159.0–0.159.1 and 0.160.0, and Claude 2.1.274–2.1.288.
  Unknown/prerelease formats remain blocked with the actual version and an update instruction.
- Windows Claude uses shell form for npm `.cmd` shims. Only exact journal-owned legacy entries
  are repaired; external and edited hooks remain untouched.
- Exact Codex routing definitions are checked through `hooks/list`. Configured, disabled, untrusted
  and runtime-observed states are distinct. Trust remains a one-time user action; individual prompts
  need no manual skill invocation.
- The visible dashboard polls bounded native receipts across projects. Benchmark attribution
  remains project/task-scoped; callbacks are not claimed as measured savings.
- Each optimizer shares one list for setup and owned removal. mcptoon uses an existing pipx or uv,
  with installation options for missing prerequisites.
- Results has a summary dashboard and one filterable, sortable, expandable evidence list. Units
  and measurement classes remain separate. Activity shows the latest eight entries in a scroll area;
  the server retains at most thirty.
- Startup checks notify about updates. Approved updates re-check health automatically; a verified
  application update offers a guarded restart to load and check the new capabilities.

Routing instructions remain advisory: callbacks do not prove model choice, subagent launch,
quality preservation or token/quota savings. Local Linux checks and Windows configuration fixtures
are not Windows runtime verification or broad-promotion readiness.

## Release gates

**Passed and published.** [Final PR CI](https://github.com/giuliastro/token-harness/actions/runs/37146711560)
was green on Windows, macOS and Ubuntu before `release/v0.1.26` / immutable tag `v0.1.26`.
[Exact-tag publication](https://github.com/giuliastro/token-harness/actions/runs/37147152988) passed
release checks, provenance/SBOM, npm Trusted Publishing and npm-latest verification. Public npm
installation and the GitHub release artifact were checked after publication; SHA-256 matched.

Post-install native runtime checks in [release notes](releases/0.1.26.md) remain separate from these
completed publication gates. See [delivery status](plan-status.md) for receipts and open work.
