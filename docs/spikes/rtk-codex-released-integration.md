# RTK → Codex released integration observation

Reviewed 2026-09-21 against released RTK tags **v0.44.0** and **v0.49.0**.

## Released upstream contract

RTK's released Codex integration is instruction-based, not a transparent Codex hook:

- `rtk init --codex` configures project-scoped Codex instructions.
- `rtk init --global --codex` configures user-global Codex instructions.
- v0.44.0 writes an RTK awareness document to `$CODEX_HOME/RTK.md` (normally `~/.codex/RTK.md`) and adds an `@...RTK.md` reference to `$CODEX_HOME/AGENTS.md`.
- v0.49.0 keeps the same AGENTS.md + RTK.md integration shape, with updated awareness content.
- The released instructions tell Codex to prefix shell commands with `rtk`; this is model-followed guidance, not pre-execution interception.

Upstream source locations reviewed:

- v0.44.0: `src/hooks/init.rs::run_codex_mode_with_paths`, `hooks/codex/rtk-awareness.md`.
- v0.49.0: `src/hooks/init.rs::run_codex_mode_with_paths`, `hooks/rtk-awareness-full.md`.
- v0.49.0 user guide: `docs/guide/getting-started/supported-agents.md`, Codex CLI section.

## Token Harness managed path

Token Harness does **not** invoke `rtk init` for Codex because that would delegate edits to a user-owned instruction file outside Token Harness' narrow ownership model.

Instead it writes the reviewed v0.44.0 Codex awareness text inside one marker-fenced block in the user-global `~/.codex/AGENTS.md`. The block is:

- previewable before apply;
- transactionally snapshotted;
- independently removable without deleting user instructions;
- treated as drifted if the owned block is edited.

An existing upstream RTK `@...RTK.md` + `RTK.md` layout is adopted as already configured but remains user-owned and is never removed by Token Harness.

## Verification boundary

This released RTK/Codex path is declared **config-only**. RTK's global history database does not identify which harness produced a command, so provider-wide RTK telemetry must not be attributed to Codex as a canary receipt.

A future RTK release may provide a native Codex hook. That future behavior must be reviewed as a separate versioned integration and must not be backported conceptually to v0.44.0-v0.49.0.
