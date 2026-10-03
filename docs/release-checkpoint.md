# Release checkpoint — 2026-10-03

Token Harness `0.1.25` fixes Windows detection and verification for Codex/RTK and clarifies the
difference between a configured integration and runtime evidence. It also repairs guided checks so
an absent provider or missing callback is not reported as a generic configuration failure.

## Changes in this release

- Adds a first-class Automatic prompt routing control to each supported harness card, with reviewed
  enable/disable plans, ownership, drift checks, verification, and rollback.
- Installs native prompt hooks that inject a short subagent model policy automatically on every
  submitted prompt after the user enables it once. No command prefix or skill invocation is needed.
- Records prompt and native subagent callbacks locally without saving prompt text, transcripts, or
  raw session/agent identifiers. Configuration and runtime evidence are shown separately.
- Reports local token counts separately from authoritative five-hour and weekly allowance deltas;
  only paired, attributable benchmarks that pass both quality gates receive savings credit.
- Reads Codex's Windows `commandWindows` hook command when inspecting the native settings file,
  preserving exact interception points and tool families for drift checks.
- Recognizes RTK's Windows `.cmd` attribution wrapper when its executable path contains spaces and
  accepts Codex hook support from RTK 0.50.0 onward, including 0.51.0.
- Keeps provider compatibility fail-closed above the reviewed RTK range and does not claim a
  Windows runtime test from source or fixture review.
- Separates missing runtime evidence from known integration failures in guided health checks, and
  avoids showing a Codex trust instruction when no routing change was proposed.

The model instruction is advisory and cannot guarantee a native subagent launch. Claude's documented
hook callback does not expose the child's actual model, so Token Harness reports it as unknown. No
routed token/quota savings are claimed before paired measurements. This release does not claim
broad-promotion readiness.

## Release gates

The normal cross-platform PR CI must pass on Windows, macOS, and Linux before creating
`release/v0.1.25`. The release bridge then creates immutable tag `v0.1.25` and dispatches the
exact-tag release workflow. That workflow must pass tests, real-runtime smoke, packaging, provenance,
npm Trusted Publishing, and npm-latest verification before it creates the GitHub Release.

The user's end-to-end Claude Code and RTK-on-Codex Windows checks remain post-install runtime tests
and are required before claiming Windows runtime verification. Run them using the steps in
`docs/releases/0.1.25.md`.
