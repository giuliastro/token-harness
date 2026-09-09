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
- [ ] RTK and HarnessTrim remain verified as the first two savings mechanisms on current reviewed combinations.
- [ ] A third mechanism is admitted. Current preferred candidate: mcptoon discovery/schema reduction after local context-tax measurement, paired quality evidence, reviewed activation and rollback.
- [ ] Full CI green for the release candidate on Windows, macOS and Linux.
- [ ] Published package/install smoke test green for the release candidate.
- [ ] README onboarding verified against the exact published UI.
- [ ] One clean end-to-end fresh-user install test: install → open → review setup → apply → use agent → inspect evidence → verify → undo.

## Experimental candidates

Read-only detection alone does not count as a third savings mechanism. Headroom or mcptoon may remain benchmark-only while the core matures, but broad promotion waits until a third mechanism has actually passed its admission and can deliver attributable value safely.

If mcptoon fails its quality or marginal-value benchmark, Token Harness should select another candidate rather than weakening this gate or stacking overlapping compressors just to reach a feature count.

## Release decision

Technical stability and promotion readiness are separate decisions. A release may be stable enough for existing users and testing before it is the version we actively promote.

When every required item above is complete on a release candidate, create the patch/minor release, verify the published npm artifact rather than only the repository build, run the fresh-user scenario, and only then mark that exact version as promotion-ready.
