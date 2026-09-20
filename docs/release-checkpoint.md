# Release checkpoint — 2026-09-20

Token Harness `0.1.17` is published.

The release tag `v0.1.17` points to `3f33c7f34798b914b26af3b5e17aeb461c5d8493`, whose parent is runtime merge `f71b413f45017949e48ef4dce30dd3e65d8aa0e0` from PR #329. Release workflow run `35506444677` completed successfully: typecheck, tests, build, the guided real-runtime HarnessTrim setup/update smoke, bundle/install smokes, tag/version validation, provenance and SBOM attestations, npm OIDC Trusted Publishing, npm-latest verification and GitHub Release creation all passed.

The published artifact contains the real guided first-run fixes from PR #329:

- optional managed setup is actionable when a reviewed installer path exists;
- GitNexus can use an existing npm, mcptoon an existing pipx and Headroom an existing uv;
- missing prerequisites are reported specifically instead of as “No compatible automatic setup surface detected”;
- managed setup is re-observed before transaction commit and rolls back if the requested integration did not become active;
- npm and uv first-run inventory support reversible absence restoration;
- HarnessTrim guided setup/update is tested against real public packages and verifies the executable actually active on PATH;
- Windows CI includes a real isolated GitNexus-absent first-run gate;
- Headroom’s uv/MCP contract is exercised on Windows, macOS and Linux.

After the release, PR #331 advanced the repository’s historical reviewed HarnessTrim baseline from 0.3.0 to 0.3.1 and closed provider-drift issue #330. That change is now on `main` as `5adedb3b5dd31676aa9d089437ab0779c95dd165`; it does not change the already-published 0.1.17 artifact. Runtime 0.1.17 was already latest-forward for HarnessTrim and its real release gate successfully updated from 0.2.1 to registry latest while validating the machine-readable capability contract.

Release-preparation metadata was subsequently merged to `main` as `c6f62ee08f160c96742ebb805d7ba02b2661de99`; post-merge CI run `35520364071` passed on Ubuntu, macOS and Windows. Do not move or recreate the immutable `v0.1.17` tag.
