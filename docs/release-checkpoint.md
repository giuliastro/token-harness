# Release checkpoint — 2026-10-03

Token Harness `0.1.24` is a focused release candidate for automatic native prompt routing across
Codex and Claude Code, with local runtime receipts and quality-gated savings attribution.

## Changes in this release

- Adds a first-class Automatic prompt routing control to each supported harness card, with reviewed
  enable/disable plans, ownership, drift checks, verification, and rollback.
- Installs native prompt hooks that inject a short subagent model policy automatically on every
  submitted prompt after the user enables it once. No command prefix or skill invocation is needed.
- Records prompt and native subagent callbacks locally without saving prompt text, transcripts, or
  raw session/agent identifiers. Configuration and runtime evidence are shown separately.
- Reports local token counts separately from authoritative five-hour and weekly allowance deltas;
  only paired, attributable benchmarks that pass both quality gates receive savings credit.
- Adds exact hook fixtures for Codex 0.160.0 and Claude Code 2.1.288 while keeping unknown versions
  fail-closed. Codex still requires manual `/hooks` trust review; Claude requires a new session.

The model instruction is advisory and cannot guarantee a native subagent launch. Claude's documented
hook callback does not expose the child's actual model, so Token Harness reports it as unknown. No
routed token/quota savings are claimed before paired measurements. This release does not claim
broad-promotion readiness.

## Release gates

The normal cross-platform PR CI must pass on Windows, macOS, and Linux before creating
`release/v0.1.24`. The release bridge then creates immutable tag `v0.1.24` and dispatches the
exact-tag release workflow. That workflow must pass tests, real-runtime smoke, packaging, provenance,
npm Trusted Publishing, and npm-latest verification before it creates the GitHub Release.

The user's end-to-end Claude Code Windows callback check remains a post-install runtime test and is
required before claiming Claude-on-Windows runtime verification. Run it using the steps in
`docs/releases/0.1.24.md`.
