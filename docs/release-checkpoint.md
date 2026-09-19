# Release checkpoint — 2026-09-19

Token Harness `0.1.13` is the next incremental stable release candidate.

PR #310 merged to `main` as `4a9ee3d8161ece9c193ad255fe3e51f01d7be72a` after green cross-platform CI. It simplifies the novice-facing product to **Overview + Results**, removes the separate Setup destination, keeps RTK + HarnessTrim as the recommended baseline, places setup actions beside the state they resolve, collapses advanced agent details, and makes reviewed optimizer updates installable from the same guided flow.

PR #311 then merged as `900940857e16922508a56cc7bfae2b95d7325052` after CI run `35366444787` passed on Ubuntu, macOS and Windows and Headroom managed compatibility smoke `35366444723` passed on all platforms. It removes duplicate baseline setup CTAs so each incomplete coding-agent card has one **Finish setup** action, keeps RTK/HarnessTrim cards focused on status, and moves optional optimizers behind progressive disclosure.

No optimizer lifecycle, compatibility row, measurement rule, transaction boundary or rollback behavior is widened by this release. The existing preview → approval → apply model, reviewed-version gates, ownership-aware removal and fail-closed update behavior remain unchanged.

Release preparation aligns the workspace, publishable CLI and embedded tool version at `0.1.13`. The release may proceed only after the release-prep PR itself passes the full cross-platform CI and installed-package smoke gates. After that PR merges, create `release/v0.1.13` from the exact release-prep merge commit; the existing release bridge will create `v0.1.13`, dispatch the trusted release workflow, attest the tarball/SBOM, publish to npm through OIDC trusted publishing, and create the GitHub Release.
