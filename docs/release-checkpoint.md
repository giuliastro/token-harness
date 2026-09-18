# Release checkpoint — 2026-09-18

Token Harness `0.1.12` is the next incremental stable release candidate.

PR #306 merged to `main` as `be67fa082e4dc317a1aeb92764015c285ebcb299`. Its PR CI was fully green on Ubuntu, macOS and Windows, including tests, the Windows RTK live release smoke, build, bundle/package staging and installed-package smoke. Post-merge `main` CI #1547 repeated those gates successfully on all three platforms.

This release packages the accumulated work since `0.1.11`: exact-row mcptoon and GitNexus evaluation/lifecycle hardening, quota-safe GitNexus campaign tooling, the Windows production-stack evidence collector, and the promotion of mcptoon 0.7.10, GitNexus 1.6.12 and Headroom 0.37.0 into the ordinary optional managed-provider lifecycle.

The production baseline remains RTK + HarnessTrim. Optional managed integrations do not become savings claims or production-stack recommendations merely because their configuration lifecycle is managed. GitNexus keeps its PolyForm Noncommercial licensing boundary visible; Headroom package installation remains a user-owned prerequisite and Token Harness does not run wrap/proxy/deploy flows.

Release preparation aligns the workspace, publishable CLI and embedded tool version at `0.1.12`. The release may proceed only after the release-prep PR itself passes the full cross-platform CI and installed-package smoke gates. After that PR merges, create `release/v0.1.12` from the exact release-prep merge commit; the existing release bridge will create `v0.1.12`, dispatch the trusted release workflow, attest the tarball/SBOM, publish to npm through OIDC trusted publishing, and create the GitHub Release.
