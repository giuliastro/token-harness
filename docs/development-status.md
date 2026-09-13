# Development status

Current focus: mcptoon candidate evidence hardening and release preparation.

- Branch: `codex/mcptoon-manifest-footprint`
- Base: `main`
- Exact reviewed mcptoon build: `0.7.10`
- Added passive manifest footprint evidence derived from the local mcptoon schema cache.
- Footprint evidence is privacy-bounded and never counted as model-visible token, quota, or subscription savings.
- Added fail-closed receipt validation for version, aggregate completeness, byte arithmetic, percentage consistency, and timestamp ordering.
- Receipt-test formatting has been normalized; the branch is ready for the final cross-platform CI gate.
- Next: merge only after full CI is green, then cut Token Harness `0.1.11` from `main`.
