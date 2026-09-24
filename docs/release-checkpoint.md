# Release checkpoint — 2026-09-24

Token Harness `0.1.18` is prepared as an incremental release candidate from runtime merge `13d23ee15465a0accd01aa18fca3815e66ce96a4` on `main`.

The release candidate includes:

- PR #334: real Windows guided first-run coverage for optional providers and HarnessTrim lifecycle/update paths;
- PR #341: an initial evidence-bound Context Governor CLI integration using read-only snapshots and local byte counts, without claiming token or quota savings;
- PR #344: savings attribution from inspected hook-command evidence by coding agent and harness, plus a Token Harness self-update path limited to verified global npm installations, exact-version approval, post-update verification and restart guidance.

Issue #255 remains open for real before/after receipts from the complete production stack. The broader promotion-readiness checklist is not complete; this is a stable incremental release candidate.

Do not tag or publish unless the full release-preparation CI is green across Windows, macOS and Linux. The release workflow must then pass its exact-tag release gates, publish the npm artifact through Trusted Publishing, verify that npm `latest` points to `0.1.18`, and create the GitHub Release.
