# Development status

Current focus: Token Harness 0.1.11 release validation.

- Release preparation branch: `release-prep/v0.1.11`
- Release base: `main` after mcptoon manifest-footprint PR #274.
- Managed production stack remains RTK + HarnessTrim.
- mcptoon, GitNexus and Headroom remain candidates; none is promoted by this release.
- mcptoon evidence is pinned to the exact reviewed 0.7.10 build and now includes passive activation and privacy-bounded manifest-footprint evidence.
- Release gate: full Windows, macOS and Ubuntu CI including package staging and installed-package smoke.
- After the release PR merges, create `release/v0.1.11`; the existing release bridge will create the immutable tag and dispatch the trusted npm/GitHub release workflow.
