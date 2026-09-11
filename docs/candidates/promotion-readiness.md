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

Current candidate support remains observation-only. The readiness model therefore exposes real local
progress without silently converting candidate observers into active provider adapters.

## Candidate categories

The canonical taxonomy currently maps Headroom to `context-minimization`, mcptoon to `mcp-discovery`,
and GitNexus to `repository-exploration`. GitNexus is deliberately separate from broad context
minimization because repository exploration is a distinct waste surface in RFC 0027.
