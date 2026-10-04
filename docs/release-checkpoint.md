# Release checkpoint — 2026-10-04

Token Harness `0.1.29` includes the reviewed native routing policy from #368, merged as
`aec108d63c9ba6c2781dffe4926d6ecc21ae61dd`. It also carries the published 0.1.28 Linux callback
and lifecycle evidence documented in #369; that evidence retains its original version and scope.

## Changes in this release

- Routing chooses a cheaper native child from the current harness's model ladder according to the
  bounded task. Codex light-tier roots receive no routing context.
- Codex guidance sets the child model and reasoning effort with an override-capable fresh fork.
  Claude guidance explicitly sets the Agent model parameter.
- Eligibility names concrete independent work, keeps integration and final review on the root,
  allows one routed worker at a time and returns failed checks to the root.
- The portable skill, embedded skill, dashboard explanation and RFC 0030 describe the same policy.
  The hook stays deterministic and does not inspect prompt text.

## Release gates

Local PR validation passed 2,403 tests with nine expected skips, typecheck, lint, build and bundle
smoke. Synthetic CLI probes verified the hook output contract and routing variants. Cross-platform
release-candidate CI must pass before creating `release/v0.1.29`. The bridge creates immutable tag
`v0.1.29` and dispatches the exact-tag workflow, which gates publication on tests, real-runtime smoke,
packaging, provenance, npm Trusted Publishing and npm-latest verification.

Published 0.1.28 callback/lifecycle observations do not prove that this revised policy chooses the
requested child model in a native session. Windows published-artifact verification, Claude Linux
model authentication, paired marginal-value evidence and broad promotion remain separate gates.
No new subscription, token or API savings claim is made.

Release notes and verification scope are in [docs/releases/0.1.29.md](releases/0.1.29.md).
