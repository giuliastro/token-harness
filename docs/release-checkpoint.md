# Release checkpoint — 2026-09-25

Token Harness `0.1.19` is prepared as an incremental release candidate from runtime merge `58e7753e4cf0650492ac232ac65249d773f520f0` on `main`.

The release candidate includes:

- PR #343: shadow-first Smart Model Routing; shadow mode does not rewrite provider calls and conservative routing remains an explicit opt-in;
- PR #346: RTK update checks on Linux and macOS use the official GitHub release rather than the ambiguous Cargo package name. Approved installs verify the release asset's published SHA-256 before replacing the executable, and native Windows keeps WinGet as its primary channel.

Issue #255 remains open for real before/after receipts from the complete production stack. This release is incremental and does not claim broad-promotion readiness.

Do not tag or publish unless the complete release-preparation CI is green across Windows, macOS and Linux. The exact-tag release workflow must then pass its tests, real-runtime smoke, packaging, provenance, npm Trusted Publishing and npm-latest verification before creating the GitHub Release for `0.1.19`.
