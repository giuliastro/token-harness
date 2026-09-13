# mcptoon × Codex × Linux RFC 0009 recording

Recorded on 2026-09-13 by GitHub Actions run `34750472458` on an Ubuntu 24.04.5 Linux x64 hosted runner from branch `codex/mcptoon-compatibility-promotion`.

Exact observed combination:

- Codex CLI: **0.152.1**
- mcptoon: **0.7.10**
- platform: **Linux, non-WSL, x64**
- Node.js: **22.13.1**
- verification tier supported by this recording: **config-only**

The recording uses an isolated home and project. The brownfield project starts with user-owned `AGENTS.md` content. Managed apply adds only the Token Harness mcptoon marker block. The drift stage edits the managed block. Rollback restores the exact pre-apply brownfield file and the transaction engine reports the file restored and verified.

A second apply followed by surgical uninstall preserves both the original user instructions and a user note added after apply while removing only the owned marker. Both managed applies and the uninstall committed with exit code 0.

`invalidating-update.json` is intentionally absent: this recording installed only the exact reviewed provider version, so no second real mcptoon version was introduced merely to invent an update state. RFC 0009 rows remain exact and are not widened by semver inference.

The uploaded recording artifact had SHA-256 `d2c65d33079c32b006cf00fd104edf589c7c24ef3c2a2f866c38bafede3736ca` before review. The JSON files committed beside this README are the reviewed contents of that artifact; this README corrects only the Markdown-generation quoting bug in the one-shot workflow and does not alter any captured machine state.
