# Release checkpoint — 2026-09-13

Token Harness `0.1.11` is the next incremental stable release candidate.

The mcptoon manifest-footprint work has merged to `main` after green Windows, macOS and Ubuntu CI. Release preparation now aligns the workspace, publishable CLI and embedded tool version at `0.1.11` and adds release notes for the accumulated post-0.1.10 work.

Candidate-only components remain gated: mcptoon, GitNexus and Headroom are not promoted merely because lifecycle or evidence primitives exist. The release can proceed only after the `0.1.11` release-prep PR passes the full cross-platform CI and installed-package smoke gates.
