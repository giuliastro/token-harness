# Candidate promotion readiness

Candidate promotion is intentionally stricter than candidate benchmarking. A benchmark answers
whether a candidate appears to add marginal value over the current stack. Promotion readiness asks
whether Token Harness can safely own that mechanism as part of the managed optimization stack.

The readiness model has no weighted score. Every required gate must be explicitly passed before a
candidate can be considered promotion-eligible. Unknown evidence stays `unreviewed`; a known missing
safety mechanism stays `blocked`.

## Gates

1. **Benchmark capability** — the installed candidate exposes the reviewed surfaces required to
   evaluate it locally.
2. **Category fit** — the candidate belongs to the expected optimization category, so overlap and
   distinctness are evaluated against the right mechanisms.
3. **Selection evidence** — repeated paired benchmarks are decision-ready and `promising`.
4. **Activation verification** — Token Harness can prove that the candidate was actually active for
   the optimized workload.
5. **Managed lifecycle** — reviewed plan/apply/verify/rollback behavior exists.
6. **Compatibility and reversibility** — ownership overlap, failure isolation, coexistence and clean
   removal have been reviewed.
7. **Project maturity** — upstream release activity, maintenance and licensing have been reviewed.
8. **Combined-stack validation** — the candidate has been validated together with the recommended
   Token Harness stack, not only in isolation.
9. **Context-owner admission** — Headroom additionally has to pass the stricter broad-context-owner
   admission gate. This gate is not applicable to mcptoon or GitNexus.

Candidate promotion remains closed by default. Observers may report local progress, and a candidate
may acquire reviewed lifecycle primitives or exact compatibility rows before it is admitted to the
global provider registry. Neither state is equivalent to promotion.

### mcptoon lifecycle checkpoint

The reviewed mcptoon slice now covers the lifecycle mechanics needed for a future promotion decision:

- exact-version installation through an already-present `pipx`, with machine-readable inventory,
  prior-version restore, and verified uninstall when the pre-transaction state was package absence;
- Claude Code guidance in a Token Harness-owned skill and Codex guidance in a surgical marker block;
- brownfield conflict refusal, including refusal to install the package when the activation surface
  cannot be owned safely;
- passive verification through installed version, root CLI capability discovery and the owned
  instruction surface — normal `verify` does not run `manifest` or contact configured MCP servers;
- live Ubuntu `pipx` smoke coverage for mcptoon 0.7.10 installation, inventory, uninstall and
  restoration of the absent state;
- an exact RFC 0009 recording for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL**, captured on a
  real Ubuntu runner with brownfield state, managed apply, user drift, verified rollback and surgical
  uninstall. The row admits only that exact combination; Codex 0.152.2, mcptoon 0.7.11, WSL and
  Windows remain refused.

This does **not** make mcptoon promotion-eligible and does not put it in `PROVIDER_ADAPTERS`.
Compatibility evidence now exists for one exact Codex/Linux combination, but selection evidence,
activation evidence on a real optimized workload, combined-stack validation, project maturity and
any additional harness/platform compatibility required by the intended promoted surface still have
to pass independently. No semver inference substitutes for those gates.

## Candidate categories

The canonical taxonomy currently maps Headroom to `context-minimization`, mcptoon to `mcp-discovery`,
and GitNexus to `repository-exploration`. GitNexus is deliberately separate from broad context
minimization because repository exploration is a distinct waste surface in RFC 0027.
