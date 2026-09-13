# Development status

Current focus: mcptoon candidate selection evidence after the successful Token Harness 0.1.11 release.

- Current release: `0.1.11`; release PR #275 merged after full Ubuntu, macOS and Windows CI.
- Managed production stack remains RTK + HarnessTrim.
- mcptoon, GitNexus and Headroom remain candidates; none is promoted by this checkpoint.
- mcptoon evidence is pinned to the exact reviewed 0.7.10 build and now includes benchmark capability, managed lifecycle, passive activation, privacy-bounded cached-schema manifest footprint evidence, project maturity, and exact Linux compatibility rows for the reviewed Codex and Claude Code versions.
- The manifest-footprint reader is fail-closed on receipt shape, exact version, aggregate arithmetic and timestamp ordering; the campaign exposes only the latest cached-schema snapshot rather than cumulative savings.
- mcptoon selection campaigns now fail closed outside the exact reviewed native-Linux rows: Codex 0.152.1 or Claude Code 2.1.269. Optimized starts additionally require mcptoon 0.7.10; Windows, macOS, WSL, different harness versions and other harness families cannot create selection evidence.
- Next mcptoon gate: decision-ready selection evidence from real paired campaigns against the unchanged production stack. Fixture-only or CI-generated savings do not close this gate.
- Use a fresh campaign id if a real run contains ambiguous state or the production-stack configuration changes; do not repair selection evidence by overwriting an unlike pair.
- If selection evidence is promising, continue with combined-stack validation against the exact RTK + HarnessTrim baseline, then make a separate compatibility/reversibility decision for the intended promoted surface.
- Do not add mcptoon to `PROVIDER_ADAPTERS` until those independent gates are closed.
