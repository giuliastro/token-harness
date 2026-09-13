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
global provider registry. Neither state is equivalent to promotion. The guided UI may surface those
reviewed integration milestones so users can distinguish candidate maturity, but milestone labels do
not alter gate state or make a candidate part of the managed stack.

### mcptoon lifecycle checkpoint

The reviewed mcptoon slice covers the lifecycle mechanics needed for a future promotion decision, and
the formal `managed-lifecycle` gate is explicitly passed for **mcptoon 0.7.10**:

- exact-version installation through an already-present `pipx`, with machine-readable inventory,
  prior-version restore, and verified uninstall when the pre-transaction state was package absence;
- Claude Code guidance in a Token Harness-owned skill and Codex guidance in a surgical marker block;
- brownfield conflict refusal, including refusal to install the package when the activation surface
  cannot be owned safely;
- passive verification through installed version, root CLI capability discovery and the owned
  instruction surface — normal `verify` does not run `manifest` or contact configured MCP servers;
- live Ubuntu `pipx` smoke coverage for mcptoon 0.7.10 installation, inventory, uninstall and
  restoration of the absent state; and
- exact RFC 0009 recordings for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL** and
  **mcptoon 0.7.10 × Claude Code 2.1.269 × Linux non-WSL**, captured on real Ubuntu runners with
  brownfield state, managed apply, user drift, verified rollback and surgical uninstall.

Passing `managed-lifecycle` does **not** pass `compatibility-reversibility`. The exact rows still admit
only those recorded combinations; adjacent harness/provider versions, WSL, Windows and macOS remain
refused, and the intended promoted harness/platform surface still needs a separate compatibility
decision.

### mcptoon activation checkpoint

Optimized mcptoon benchmark pairs have a reviewed passive activation witness for the exact reviewed
build, **mcptoon 0.7.10**. Token Harness snapshots mcptoon's local usage record at `benchmark-start`
and seals the result at `benchmark-finish`; it never invokes an MCP tool merely to prove activation.

The receipt deliberately keeps only the minimum evidence needed for the gate: reviewed version,
monotonic call counters, bounded timestamps, successful-call count and the resulting witness state.
Server and tool identities are discarded rather than copied into Token Harness state. A pair is
verified only when the reviewed version is observed, the counter advances, and at least one successful
mcptoon call is recorded inside the optimized task window. Missing or malformed usage data, counter
resets, unsupported versions, insufficient bounded history, or no successful in-window activity fail
closed as `unknown` or `blocked` rather than being credited as activation.

This is intentionally a **local usage witness, not process lineage**. mcptoon's upstream usage file
does not identify which agent process caused a call, so Token Harness does not claim that distinction.
The evidence establishes that reviewed mcptoon activity occurred in the measured task window on that
user environment. Candidate attribution and a browser acknowledgement remain insufficient on their
own.

### mcptoon project maturity checkpoint

The formal `project-maturity` gate is also backed by an explicit review dated **2026-09-13**. The
Apache-2.0 upstream is active and non-archived, stable releases span 2026-08-12 through 2026-09-12,
and recent releases document regression fixes plus release/test discipline. The repository is still
young, so that remains explicit residual risk and future versions do not inherit the review.

These checkpoints do **not** make mcptoon promotion-eligible and do not put it in
`PROVIDER_ADAPTERS`. A real candidate campaign still has to produce promising selection evidence and
verified activation receipts. Combined-stack validation and the separate compatibility/reversibility
decision for the intended promoted surface also have to pass independently. No semver inference
substitutes for those gates.

## Candidate categories

The canonical taxonomy currently maps Headroom to `context-minimization`, mcptoon to `mcp-discovery`,
and GitNexus to `repository-exploration`. GitNexus is deliberately separate from broad context
minimization because repository exploration is a distinct waste surface in RFC 0027.
