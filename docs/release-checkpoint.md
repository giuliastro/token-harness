# Release checkpoint — 2026-09-20

Token Harness `0.1.16` is the next incremental stable release candidate.

PR #327 merged to `main` as `c615356cb289700a511cbbe13c9c38c3c7567815` after CI run `35471424233` passed on Ubuntu, macOS and Windows and Headroom managed compatibility smoke `35471424232` passed all platforms.

This release changes compatibility policy from static version admission to runtime capability admission. Compatibility rows remain historical evidence, but a newer provider or harness version is no longer rejected merely because its exact tuple has not been recorded yet. When the installed provider still exposes the required managed surface, Token Harness uses the ordinary transactional path and verifies the result after apply.

Provider updates are latest-forward above the supported floor. After installation, Token Harness re-detects the executable actually resolved on PATH and checks the required capability surface. A PATH mismatch or runtime contract regression fails the postcondition and rolls the transaction back instead of reporting a false success.

HarnessTrim 0.3 and newer use the machine-readable `harnesstrim capabilities` contract and runtime-published skill artifact digests. Modern releases that stop publishing the required digest contract fail closed instead of silently falling back to the historical 0.0.7 artifact set. mcptoon, GitNexus and Headroom likewise accept newer releases only while the CLI capability surface required by the managed integration remains observable.

Historical benchmark and performance evidence remains version-specific and is not automatically projected onto future releases. Ownership checks, containment/write-set checks, drift detection, backups, rollback, preview/approval and post-apply verification remain unchanged.

Release preparation aligns workspace, publishable CLI and embedded version at `0.1.16`. After this release-prep PR is green and merged, create `release/v0.1.16` from its exact merge commit; the existing release bridge will create the immutable tag, dispatch the trusted release workflow, attest the tarball/SBOM, publish to npm via OIDC Trusted Publishing, and create the GitHub Release.
