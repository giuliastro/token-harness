# Release checkpoint — 2026-10-01

Token Harness `0.1.23` is a focused corrective release candidate for Codex runtime verification and
the RTK + HarnessTrim optimization stack.

## Changes in this release

- Separates Codex CLI availability from Codex Desktop hook health. If the optional `codex` command
  is not on `PATH`, Token Harness reports CLI checks as unobserved instead of marking the configured
  desktop integration broken.
- Keeps runtime proof provider-specific: RTK per-agent history and HarnessTrim reduction receipts
  establish their own Codex canary tier; hook declarations and native trust metadata remain separate
  checks.
- Includes the compatibility fixture for the reviewed RTK + HarnessTrim Codex/Linux chain.

This incremental release does not claim broad-promotion readiness or combine provider savings into
an unlabeled total.

## Release gates

Do not create `release/v0.1.23` until release-preparation CI is green on Windows, macOS, and Linux.
The release bridge then creates immutable tag `v0.1.23` and dispatches the exact-tag workflow. That
workflow must pass its tests, real-runtime smoke, packaging, provenance, npm Trusted Publishing, and
npm-latest verification before it creates the GitHub Release.
