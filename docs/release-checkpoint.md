# Release checkpoint — 2026-09-27

Token Harness `0.1.22` is an incremental corrective release candidate based on PR #353, merged to
`main` as `4e2772e`. PR #353's cross-platform CI passed on Windows, macOS, and Ubuntu.

## Changes in this release

- Removes the managed CCR runtime, Smart Model Routing CLI and guided controls, CCR adapters, and
  CCR-specific benchmark telemetry. The previous integration required a separate CLI launch
  profile, and local config checks did not prove that real requests passed through the router.
- Clarifies that a Codex RTK hook declaration must still be manually enabled and trusted in Codex.
  Token Harness cannot grant that trust, and a declaration alone is config-only evidence.
- Leaves existing provider credentials, native endpoints, and user-owned CCR state untouched.

This release does not claim broad-promotion readiness. Issue #255 remains open for real
before/after receipts from the complete production stack.

## Release gates

Do not create the release branch unless release-preparation CI is green on Windows, macOS, and
Linux. The `release/v0.1.22` bridge then creates the immutable tag and dispatches the exact-tag
workflow. That workflow must pass its tests, real-runtime smoke, packaging, provenance, npm Trusted
Publishing, and npm-latest verification before it creates the GitHub Release.
