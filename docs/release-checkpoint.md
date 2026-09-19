# Release checkpoint — 2026-09-19

Token Harness `0.1.15` is the next incremental stable release candidate.

PR #324 merged to `main` as `6bad1b5d932d5a953a2881b6179965921d12cae5` after CI run `35433245433` passed on Ubuntu, macOS and Windows and Headroom managed compatibility smoke `35433245436` passed all platforms.

This release fixes the guided setup model rather than only its button wiring. Setup availability is now derived from the provider's real detected assignability plus the exact reviewed provider × agent-version × platform compatibility admission. The browser no longer assumes RTK is configurable for Codex, no longer assumes every provider supports every coding agent, and no longer shows **Finish setup** or **Connect to …** when the backend cannot produce a reviewed automatic change.

A recommended-agent card is marked **Setup incomplete** only when at least one concrete recommended setup action is actionable. Unsupported or unreviewed combinations are shown as unavailable instead of unfinished. Provider cards distinguish **setup available** from **no automatic setup**, and explain why a Connect button is absent.

Coverage now includes a stateful Codex + HarnessTrim path that verifies actionable → preview → apply → re-observe → connected and confirms the setup action is gone afterward. It also asserts RTK is never planned for Codex and exact unreviewed version combinations do not advertise setup controls.

No compatibility row was widened. Existing preview → approval → apply transactions, ownership checks, backups, rollback and fail-closed compatibility behavior remain unchanged.

Release preparation aligns workspace, publishable CLI and embedded version at `0.1.15`. After this release-prep PR is green and merged, create `release/v0.1.15` from its exact merge commit; the existing release bridge will create the immutable tag, dispatch the trusted release workflow, attest the tarball/SBOM, publish to npm via OIDC trusted publishing, and create the GitHub Release.
