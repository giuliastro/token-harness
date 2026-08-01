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

### Amended: three of these bullets name a mechanism they do not specify

The six bullets above are a policy. Implementing `update` — the last command RFC 0001 declares
— required a contract, and three of the bullets do not supply one. A fourth turned out to be
already satisfied, and the check the first bullet implies is missing in a way that is live on a
real machine rather than hypothetical.

#### A pin is global at `0.1.0`, and a project pin waits for repository trust

"A provider may be pinned globally or per project" names no storage, no schema, no precedence
between the two, and no strength. Specified:

A pin is recorded in the state directory, which is machine-global and whose protection
§Backup policy already establishes. A pin names a provider and an exact version. It is a
**refusal**, not a preference: `update` plans nothing for a pinned provider and says which
version holds it. Refusing is not a problem — an environment the user deliberately froze is a
state, in the sense RFC 0006 §Exit codes means it — so a pin does not increment
`problemCount` and does not change the exit code.

**Project pins are deferred, and not for convenience.** §Repository trust holds that
"project-local provider manifests or filters are untrusted by default. Before they can
influence installation or execution, the user must trust the repository." A version pin
influences installation by construction, so honoring a project pin requires the trust
mechanism that section assumes — and no such mechanism exists in this build. A project pin read
without it would let any cloned repository decide which version of a tool the user runs, which
is the outcome §Repository trust exists to prevent. `0.1.0` therefore supports global pins
only, and reports a project pin it finds as unhonored rather than silently obeying or silently
ignoring it.

The precedence rule is fixed now, so the deferral does not become a decision made later under
pressure: **a project pin may only narrow within what a global pin permits, never widen it.**
Where a global pin holds a provider at a version, a project pin cannot move it to another. A
repository may ask for less than the machine owner allows and never for more.

#### Version discovery belongs to the channel, not the provider

RFC 0006 makes `update` dry-run by default, so it has to state `0.42.0 → 0.44.0` *before*
touching anything. Nothing in RFC 0002's provider contract can produce that: `detect` reports
the version that is installed, which is the wrong side of the arrow.

The available version is therefore obtained from the **installation channel**, not from the
provider. That is where the knowledge actually lives — `winget` knows what exists for
`rtk-ai.rtk`; RTK's own adapter has no idea — and it keeps one query per channel rather than
one per provider, in the same reviewed table as the install argv, for the reason recorded
there: a plan names *what* to install, and *how to ask* is not something a reviewer should
re-audit per provider.

Verified against a real machine, and the verification changed the answer. `winget show --id
<id> --exact` prints the version behind a **localized label** — `Versione:` on the machine this
was written on, `Version:` on an English one — so parsing that label would have shipped a
provider that works in one locale. `winget show --id <id> --exact --versions` instead prints a
table whose header is localized but whose body is bare versions, newest first, after a
separator line of dashes that is not localized. The stable read is "the first line after the
separator that parses as a version", and that is what the channel table records.

A query is a network read. It is disclosed the way every other network access is: the plan
names the destination in its network summary, so a dry run that reached the network says so.

#### The last known working version is already retained

"Token Harness retains the last known working version and configuration receipt" reads like a
requirement for a new store. It is not: the chain exists. A committed transaction journal names
its `planId`; the stored plan under that ID carries `versions`, which records the exact provider
and harness versions the plan was computed against. The most recent committed journal is
therefore the last known working configuration, and its plan is the last known working version.

No new storage is added. This bullet is discharged by naming the chain, which is worth doing
explicitly because the alternative — a second record of the same fact — could disagree with it.

#### "Major" is the wrong test, and nothing performs even that one

"Major provider upgrades require a new compatibility result" has two defects.

The first is that no code consults the result. A `CompatibilityRule` carries
`testedVersions`, and `findCompatibilityRule` matches on providers, harness and capability
and never looks at it. A rule tested at one version keeps applying at every later one,
silently.

The stale data is already on disk. On the machine this amendment was written on HarnessTrim is
`0.0.6`, and the shipped rule declares `harnesstrim: '0.0.5'`.

What that does *not* mean, and the first draft of this amendment claimed: the rule is not being
applied to the wrong version right now. It is not being applied at all. Under `safe` HarnessTrim
is not assignable, so it never becomes a competing claim, so no contested scope consults the
rule — and `custom`, the profile that would, has no CLI surface at `0.1.0`. The check therefore
guards a path the shipped command set does not reach yet.

That is worth stating plainly rather than dressing up as a live incident, and it does not weaken
the case. The rule's recorded versions went stale on their own, with no code able to notice; the
first thing to reach that path would have consulted a result whose validity nobody had checked.
`doctor` reports the provider itself as `unknown-newer`, correctly — the detection side works.
The compatibility side had no equivalent.

The second defect is the word *major*. Both shipped providers are `0.x`, where semver assigns
no compatibility meaning to a minor or patch bump: `0.0.5 → 0.0.6` carries the same risk as
`1.0.0 → 2.0.0` and would not trigger a bullet that only speaks about major upgrades. A rule
whose test cannot fire for either provider it governs is not a safeguard.

Amended to: a compatibility result covers the versions it records. An upgrade that would move
a provider outside them makes every rule naming that provider **stale**, and a stale rule is
not applied. Because the resolver already fails closed where no rule covers a set — "No rule
means conservative conflict for overlapping exclusive capabilities" — staleness needs no new
verdict: withdrawing the rule produces the conservative conflict, which is the outcome a
compatibility result of unknown validity should produce. Outside the tested versions is
reported and not guessed at.

Whether a bump is inside the recorded versions is decided by exact equality below `1.0.0` and
by major equality at or above it, which is what semver itself promises and nothing more.

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

