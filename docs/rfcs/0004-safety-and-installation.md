# RFC 0004: Safety and installation model

- Status: Accepted
- Date: 2026-07-29

## Safety invariant

Token Harness may coordinate third-party executables and modify agent configuration.
Every mutation must therefore be attributable, reviewable, bounded, verified, and
reversible.

## Command behavior

- `doctor`, `status`, `plan`, `verify`, and `metrics` are read-only.
- `apply`, `update`, `rollback`, and `uninstall` are mutating.
- Dry-run is the default whenever a command can lead to mutation.
- Automation uses an explicit `--yes` or non-interactive policy file.
- A plan records the exact provider versions and actions that apply will use.
- A stale plan is rejected when preconditions no longer match.

## Transaction lifecycle

```text
inspect
  -> resolve capabilities
  -> build plan
  -> approve
  -> snapshot affected state
  -> apply actions
  -> verify postconditions
  -> commit journal
```

If an action or required verification fails:

```text
stop
  -> reverse completed actions
  -> restore owned configuration
  -> verify restoration
  -> retain failure receipt
```

Rollback failure is reported as a critical diagnostic with exact affected paths. Token
Harness never hides a partial installation.

## Ownership

Token Harness can remove only:

- files it created and whose digest or ownership marker still matches;
- marker-fenced blocks it owns;
- exact JSON/TOML/YAML entries recorded in its journal;
- packages it installed when no external ownership is detected.

User edits inside an owned file change its digest and block automatic deletion until
the user reviews the new uninstall plan.

Shared config merges preserve:

- unrelated keys;
- comments where the selected parser supports them;
- hook order outside the Token Harness-owned entries;
- user formatting when practical.

When comment-preserving mutation is not reliable, the planner reports that limitation
before apply.

## Backup policy

Before each file mutation:

- capture path, digest, permissions, and content;
- store the backup under the transaction ID;
- never place backups in the project repository;
- redact nothing from configuration backups, but protect the state directory with
  user-only permissions;
- enforce retention by transaction count and age;
- allow the user to pin a transaction against cleanup.

Backups may contain sensitive configuration and are never included in telemetry or
bug-report bundles.

## Network policy

Plans identify every network destination and artifact:

- registry or release host;
- package/artifact name;
- version;
- expected digest when available;
- signature information when available;
- why the network action is needed.

Default trusted distribution sources are:

- official package registries;
- official GitHub releases from the configured upstream repository;
- native harness plugin marketplaces;
- system package managers selected by the user.

Install-time scripts are treated as executable code. Token Harness prefers release
binaries or packages and never pipes network responses directly to a shell.

## Process policy

- Use executable plus argument arrays.
- Avoid shell interpolation.
- Set explicit working directories.
- Bound output retained in diagnostics.
- Enforce action-specific timeouts.
- Preserve exit code, stdout, and stderr separately.
- Redact secrets from displayed commands and logs.
- Never pass untrusted repository content as executable arguments without validation.

Provider commands run with current-user privileges. Elevation is never automatic. If a
system package manager requires elevation, the plan explains it and the user runs or
approves that step explicitly.

## Credentials

Token Harness:

- does not request model API keys for its core operation;
- does not store provider credentials;
- inherits only the minimum environment needed by a child process;
- redacts environment variables matching secret-name patterns;
- never includes command arguments or config values in anonymous telemetry;
- warns when an upstream provider requires credentials or hosted processing.

## Repository trust

Project-local provider manifests or filters are untrusted by default. Before they can
influence installation or execution, the user must trust the repository or explicitly
approve the local extension.

Read-only inspection does not execute repository scripts.

## Provider update policy

- Updates are planned, never silent.
- Major provider upgrades require a new compatibility result.
- A provider may be pinned globally or per project.
- Token Harness retains the last known working version and configuration receipt.
- Rollback uses the original distribution channel where possible.
- If an upstream release disappears, Token Harness restores configuration and reports
  that binary rollback could not be completed.

## Uninstall levels

```text
token-harness uninstall --provider rtk
token-harness uninstall --harness codex
token-harness uninstall --all
```

Each uninstall begins with a plan and distinguishes:

- integration removal;
- provider package removal;
- local metrics/history removal;
- backup removal.

Metrics and backups are retained unless the user explicitly requests their deletion.

## Test requirements

Every mutating action type requires:

- apply test;
- idempotency test;
- precondition drift test;
- rollback test;
- user-modification preservation test;
- Windows path test where applicable.

Provider integration suites operate in temporary homes and fake registries. Live smoke
tests are separate and opt-in.

