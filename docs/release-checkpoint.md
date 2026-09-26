# Release checkpoint — 2026-09-26

Token Harness `0.1.21` is prepared as a corrective patch from runtime merge `e6276e2564e5ffc66e7b55f45c22dd818811473f` on `main`.

The release candidate contains PR #351, which hardens and simplifies Smart Model Routing after the 0.1.20 guided setup failure:

- owned CCR routing changes are rebased onto the latest CCR configuration instead of comparing and rewriting the whole configuration snapshot, so unrelated CCR metadata/config changes are preserved;
- the guided browser now reads an explicit per-agent routing state: **Off**, **Shadow**, **Conservative**, or **Needs attention**;
- Smart Model Routing lives on each Claude Code/Codex card with **Enable**, **Configure**, and **Disable**, rather than a detached management section;
- first enable completes the Token Harness-owned CCR runtime preparation and the selected routing configuration in one reviewed browser flow;
- switching Shadow ↔ Conservative is a reviewed replacement of only Token Harness-owned routing state;
- Conservative mode selects an exact simple model already configured in CCR from the browser UI;
- routing activity remains available as advanced local evidence and is not counted as measured quota savings.

PR #351 passed complete cross-platform CI and Headroom compatibility checks before merge. Post-merge main CI run `36224889510` is green on Ubuntu, macOS and Windows, including tests, GitNexus self-test, Windows production-stack evidence collector, RTK live Windows release smoke, optional-provider live Windows first-run smoke, build, bundle/package and installed-package smoke.

Issue #255 remains open for real before/after receipts from the complete production stack. This corrective patch does not claim measured routing savings or broad-promotion readiness.

Do not tag or publish unless the complete release-preparation CI is green across Windows, macOS and Linux. The exact-tag release workflow must then pass its tests, real-runtime smoke, packaging, provenance, npm Trusted Publishing and npm-latest verification before creating the GitHub Release for `0.1.21`.
