# Promotion-ready stable release

Token Harness should be called ready for broad promotion only when the product is easy to understand, the core safety path is reliable, savings claims are evidence-backed, and there are enough distinct proven optimizations to make the product valuable beyond a single reducer pattern.

## Required before promotion

- [x] Outcome-first Dashboard / Policies / Evidence information architecture.
- [x] No periodic full dashboard reload.
- [x] Existing readings remain visible during refresh and after approved changes.
- [x] Preview → approval → apply → verify → undo safety flow.
- [x] Recorded reducer savings keep providers and measurement classes separate.
- [ ] Dashboard displays paired allowance and quality value when available and blocks unsupported claims.
- [ ] At least **three distinct savings mechanisms** are usable through Token Harness with measured value, quality-safe admission where applicable, and a clear activation/rollback path.
- [ ] RTK and HarnessTrim remain verified on current reviewed combinations.
- [ ] A third **distinct** mechanism is admitted by comparative Token Harness evidence. No tool is reserved this slot in advance.
- [ ] The winning third mechanism proves material marginal value over current native Claude/Codex behavior and already-enabled Token Harness optimizers.
- [ ] Full CI green for the release candidate on Windows, macOS and Linux.
- [ ] Published package/install smoke test green for the release candidate.
- [ ] README onboarding verified against the exact published UI.
- [ ] One clean end-to-end fresh-user install test: install → open → review setup → apply → use agent → inspect evidence → verify → undo.

## Candidate-selection gate

Read-only detection alone does not count as a savings mechanism. A candidate also does not qualify because its upstream benchmark reports a large percentage.

Before the third mechanism is admitted, Token Harness compares candidates on marginal savings, workload coverage, quality/retries, overlap with existing reducers and native harness features, operational cost, reversibility, maturity and attribution.

The current research queue includes:

- Token Harness native adaptive reasoning/verbosity/task policy;
- repository-exploration reduction, comparing graph/index approaches against native grep/read behavior;
- MCP discovery/schema optimizers such as mcptoon and mcp-compressor, but only against the actual native Tool Search/deferred-tool baseline;
- broad context owners such as Headroom/Context Mode-class systems;
- result-side compressors only where RTK/HarnessTrim leave meaningful uncovered cost.

A candidate that fails quality, reliability or marginal-value evidence stays experimental regardless of popularity or headline token reduction.

## Release decision

Technical stability and promotion readiness are separate decisions. A release may be stable enough for existing users and testing before it is the version we actively promote.

When every required item above is complete on a release candidate, create the patch/minor release, verify the published npm artifact rather than only the repository build, run the fresh-user scenario, and only then mark that exact version as promotion-ready.
