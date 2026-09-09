# Promotion-ready stable release

Token Harness should be called ready for broad promotion only when the product is easy to understand, the core safety path is reliable, and savings claims are evidence-backed.

## Required before promotion

- [x] Outcome-first Dashboard / Policies / Evidence information architecture.
- [x] No periodic full dashboard reload.
- [x] Existing readings remain visible during refresh and after approved changes.
- [x] Preview → approval → apply → verify → undo safety flow.
- [x] Recorded reducer savings keep providers and measurement classes separate.
- [ ] Dashboard displays paired allowance and quality value when available and blocks unsupported claims.
- [ ] Full CI green for the value-evidence integration on Windows, macOS and Linux.
- [ ] Published package/install smoke test green for the release candidate.
- [ ] README onboarding verified against the exact published UI.
- [ ] One clean end-to-end fresh-user install test: install → open → review setup → apply → use agent → inspect evidence → verify → undo.

## Not required before promotion

Experimental optimizers such as mcptoon or Headroom do not have to be admitted before a stable release. They can remain read-only, benchmark-only candidates. Shipping a comprehensible and trustworthy core is more important than delaying promotion for every possible optimizer.

## Release decision

When every required item above is complete on a release candidate, create the patch/minor release, verify the published npm artifact rather than only the repository build, and only then mark the version as promotion-ready.
