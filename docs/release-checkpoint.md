# Release checkpoint — 2026-09-25

Token Harness `0.1.20` is prepared as a corrective patch from runtime merge `0f0654c5289733996457da9b07c7a7e0b3f1c9f1` on `main`.

The release candidate includes PR #349, which fixes the two post-release gaps found in 0.1.19:

- Smart Model Routing is now exposed in the guided browser UI for Claude Code and Codex, with shadow mode as the default, conservative routing as an explicit opt-in, separate CCR runtime/rule approvals, local routing activity, and managed rule removal;
- RTK 0.44 → 0.50 updates on Linux/macOS now target the first active PATH executable even when additional shadowed RTK copies exist, while retaining official-release digest verification, backup, post-install verification and rollback;
- direct-release RTK warnings are surfaced in the guided update dialog instead of being collapsed into an incorrect “up to date” message.

PR #349 passed full cross-platform CI before merge, including the live Windows RTK release smoke. The post-merge `main` CI must also be completely green before release preparation is merged.

Issue #255 remains open for real before/after receipts from the complete production stack. This corrective patch does not claim measured routing savings or broad-promotion readiness.

Do not tag or publish unless the complete release-preparation CI is green across Windows, macOS and Linux. The exact-tag release workflow must then pass its tests, real-runtime smoke, packaging, provenance, npm Trusted Publishing and npm-latest verification before creating the GitHub Release for `0.1.20`.
