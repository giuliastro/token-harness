# mcptoon × Codex 0.153.0 × Linux RFC 0009 recording

Recorded by GitHub Actions on a real `ubuntu-latest` Linux x64 runner from branch
`codex/mcptoon-codex-0.153.0-row`.

Exact observed combination:

- Codex CLI: **0.153.0**
- mcptoon: **0.7.10**
- platform: **Linux, non-WSL, x64**
- verification tier supported by this recording: **config-only**

The recording uses an isolated home and project. The brownfield project starts with
user-owned `AGENTS.md` content. Managed apply adds only the Token Harness mcptoon marker
block. The drift stage edits the managed block. Rollback restores the exact pre-apply
brownfield file. A second apply followed by surgical uninstall preserves both the original
user instructions and a user note added after apply while removing only the owned marker.

`invalidating-update.json` is intentionally absent: this recording installed only the exact
reviewed provider version, so no second real mcptoon version was introduced merely to invent
an update state. RFC 0009 rows remain exact and are not widened by semver inference.

This fixture proves compatibility/reversibility for the exact row only. It does not claim
token, quota, latency or selection savings, and it does not promote mcptoon into the provider registry.
