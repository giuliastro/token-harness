# Release checkpoint — 2026-09-19

Token Harness `0.1.14` is the next incremental stable release candidate.

PR #322 merged to `main` as `46f8165dfa9fbdc145def641027c80ef393c32b0` after the final CI run `35430799095` passed on Ubuntu, macOS and Windows and Headroom managed compatibility smoke `35430799108` passed all config/package checks. It fixes the guided setup dead end reported from real use: **Finish setup** now plans RTK and HarnessTrim explicitly for the selected coding agent, and baseline cards expose a direct setup/connect action when an installed optimizer is not connected.

The same patch removes stale post-action UI behavior. After an approved setup/update/removal action, Token Harness now keeps the dialog busy, shows refresh progress, re-reads the current setup automatically, and updates the visible state before returning control. Manual Refresh remains only as a fallback when the automatic re-read fails. Duplicate no-change notices were also removed.

No provider compatibility row, ownership boundary, transaction rule, measurement claim or rollback behavior is widened by this release. The existing preview → approval → apply model, backups, compatibility checks, ownership checks and fail-closed handling of unsupported/unreviewed versions remain unchanged.

Release preparation aligns the workspace, publishable CLI and embedded tool version at `0.1.14`. The release may proceed only after the release-prep PR itself passes the full cross-platform CI and installed-package smoke gates. After that PR merges, create `release/v0.1.14` from the exact release-prep merge commit; the existing release bridge will create `v0.1.14`, dispatch the trusted release workflow, attest the tarball/SBOM, publish to npm through OIDC trusted publishing, and create the GitHub Release.
