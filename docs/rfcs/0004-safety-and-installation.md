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

### Post-apply drift

Ownership is recorded at apply time, but the files keep changing afterwards. Every
read-only command therefore compares the live environment against the installation
receipt and reports:

- an owned marker block that was edited or removed;
- an entry on an exclusive capability scope that Token Harness does not own, per
  RFC 0003;
- a harness version that changed since the receipt was written, which invalidates the
  hook-schema assumptions the plan was built on;
- a provider version outside the tested range recorded in the receipt.

Drift is reported, never silently repaired. Repair is a plan.

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
- record the *absence* of a file that does not yet exist, because absence is the state
  rollback must restore;
- store the backup under the transaction ID;
- never place backups in the project repository;
- redact nothing from configuration backups, but protect the state directory as
  described below;
- enforce retention by transaction count and age, with the values in RFC 0006 §Expiry;
- allow the user to pin a transaction against cleanup, which exempts it from both limits.

Backups may contain sensitive configuration and are never included in telemetry or
bug-report bundles.

### State directory permissions

The invariant is that no principal other than the owning user, the local system, and
local administrators can read the state directory.

Administrators and `root` are outside the threat model on both platforms. On POSIX,
mode `0700` does not stop `root`; on Windows, the default profile ACL grants
`Administrators`. Claiming owner-only access would be false on either system, so the
invariant is stated at the level it can actually hold: no *additional* principal.

How it is achieved is platform-specific, and this distinction is normative because the
naive implementation on each side is silently ineffective in a different way.

| Platform | Mechanism |
| --- | --- |
| POSIX | Create with mode `0700`; stat and assert the mode after creation |
| Windows | Create with an explicit DACL; read the effective ACL back and assert its ACEs |

`fs.chmod` on Windows affects only the read-only attribute and does not restrict access
by other users, so calling it there would produce a passing test and no protection.

Location is not a substitute. An earlier draft of this section claimed the invariant was
"satisfied by location: `%LOCALAPPDATA%` is already per-user". That is a statement about
the *default* inherited ACL, not about the effective one. A profile whose parent ACL was
widened — by group policy, by a migrated or restored profile, by a roaming setup, or by a
user who changed it — still passes an is-this-path-inside-`%LOCALAPPDATA%` check while
granting read access to principals the invariant excludes. The check would confirm the
path and prove nothing about access.

Windows verification therefore inspects the ACL rather than inferring it:

1. create the state root with an explicit DACL granting only the current user, `SYSTEM`,
   and `Administrators`;
2. read the effective ACL back, since inheritance and policy can override what was
   requested;
3. if any other principal holds read access, do not proceed: report
   `state-directory-permissions-unexpected` with the offending ACEs and the path.

Node has no ACL API, so this runs `icacls` through the process runner from RFC 0004
§Process policy. It is a bounded, argument-array invocation with no shell.

The tests assert the property, not the call:

- on POSIX, stat and assert the mode;
- on Windows, parse the effective ACL and assert the ACE set, including a fixture with a
  widened inherited ACL that must be rejected;
- on both, assert the state root is never placed in a world-writable location such as
  the system temporary directory.

If `%LOCALAPPDATA%` cannot be resolved, or the ACL cannot be read, Token Harness fails
with the unsupported-environment code from RFC 0006 rather than continuing into a
location whose protection it has not verified.

### Delegated installs

When a plan invokes a provider's own installer, Token Harness did not compose the
resulting edits and cannot reverse them with an inverse action. RFC 0002 defines the
action; the executor's obligation is:

1. snapshot every declared affected path before invoking the installer;
2. roll back by restoring those snapshots, never by inventing an uninstall command;
3. fail the action and name the path if the installer touched anything undeclared.

Restore-based rollback is weaker than inverse-action rollback in one respect: it cannot
undo side effects outside the filesystem. A delegated install is therefore restricted to
providers whose installers only write configuration, and the plan states that the
integration is removable by restore only.

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

### Brownfield adoption

The most likely first run is not a clean machine. It is a developer who already
configured RTK or HarnessTrim by hand, possibly through the same hook Token Harness
wants to own. Adoption from that state is a primary scenario, not an edge case, and it
gets its own cross-cutting fixture category:

- RTK installed and configured by the user, in the surface Token Harness would claim;
- HarnessTrim installed standalone with its own `--apply` writes already present;
- both present, with a pre-existing overlap on an exclusive scope;
- one present with a hand-edited hook that Token Harness does not own.

Required behavior in every case:

1. detection reports the existing installation as `configured`, not `absent`;
2. the plan adopts the existing installation rather than reinstalling it;
3. a pre-existing overlap is a hard conflict the user resolves, and it is never resolved
   by overwriting;
4. uninstalling Token Harness leaves a user-managed installation in place;
5. configuration the user wrote is preserved byte-for-byte where it is not the specific
   entry being adopted.

Every harness and provider suite includes these fixtures alongside the absent, partial,
healthy, and broken states.

