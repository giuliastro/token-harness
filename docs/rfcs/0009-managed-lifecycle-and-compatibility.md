# RFC 0009: Managed lifecycle and compatibility matrix

- Status: Accepted
- Date: 2026-08-02

Numbered 0009 rather than 0008. PLAN §5 §RFC allocation, RFC 0001 §Storage, RFC 0005 §When a
driver is chosen, and RFC 0006 §RFC number allocation all reserve 0008 for the metrics storage
driver, written when JSONL is outgrown. Taking that number here would have left the repository with
two accepted meanings for one identifier and the storage decision with none.

## Purpose

Token Harness must make independently installed harnesses and providers usable through one
reviewable lifecycle: detect, plan, install or update when compatible, verify, and roll back.
This RFC extends the provider contract without weakening RFC 0002, RFC 0003, RFC 0004, RFC
0005, or RFC 0006.

The product detects every version it can identify. It manages only a harness/provider/version
combination represented by a reviewed compatibility fixture. Detection is broad; mutation is
intentionally narrower.

## Compatibility matrix

Every managed integration declares immutable matrix rows:

```ts
interface CompatibilityRow {
  harness: HarnessId;
  harnessVersion: { minimum: string; maximum: string };
  provider: ProviderId;
  providerVersion: string;
  platform: PlatformSupport;
  configSchema: string;
  fixture: string;
  verificationTier: VerificationTier;
}
```

A row is evidence, not a semver guess. Its fixture covers, at minimum:

- an empty configuration;
- a hand-configured brownfield installation;
- the exact post-apply configuration;
- a provider or harness update that invalidates the row;
- user drift after apply; and
- rollback and uninstall with user-owned entries preserved.

A version outside every row is still reported by `doctor`. It is classified as
`unknown-newer`, `unknown-older`, or `below-range` and prevents a managed apply. The diagnostic
names the missing harness schema or provider fixture. Token Harness must not treat compatible
major versions, lockfile presence, or a successful executable probe as proof that a row applies.

Adding a compatible version requires a fixture and an explicit matrix row. Removing support leaves
existing receipts readable and makes their drift visible.

### This is not RFC 0003's compatibility rule

`CompatibilityRow` and RFC 0003's `CompatibilityRule` answer different questions and are keyed
differently, and saying so here is cheaper than discovering later that one was implemented as the
other:

| | Key | Question |
| --- | --- | --- |
| `CompatibilityRule` | provider *set* × harness × capability | which of two contesting providers owns this interception point, and in what order |
| `CompatibilityRow` | single provider × harness × version × platform | may Token Harness *mutate* this one integration at these versions on this platform |

A row therefore never arbitrates between providers and never overrides a rule: a row that permits
a managed apply for a provider the resolver did not assign the scope to changes nothing, because
the resolver runs first. Nor does a row replace `staleRecordedVersions`, which stays the version
test for rules. The two overlap only in carrying fixture references, and that overlap is
deliberate — each names the fixtures that establish its own claim.

## Managed provider lifecycle

A provider adapter continues to describe actions through `plan()`; it never invokes package
managers directly. A managed install or update plan records:

- the installation channel selected, its `kind`, and the evidence that selected it over the
  alternatives the manifest declares for this platform;
- the provider package identity *as that channel names it*, and the exact resolved version;
- the invocation the channel performs, in the form that channel has: an executable and argument
  array for `npm`, `homebrew`, `cargo`, `uv`, and `pipx`; an artifact URL with an expected digest
  for `github-release`; the harness-side entry for `harness-marketplace`;
- the package inventory before mutation **where the channel can report one**, and an explicit
  null where it cannot;
- affected provider and harness paths;
- a reviewed containment boundary and expected artifacts for any delegated installer;
- required verification checks; and
- whether a package is removable automatically under RFC 0004 ownership rules.

The conditional fields are conditional on purpose. RFC 0002 §Installation channels supports seven
channel kinds, and three of them have no package-manager executable, no package name in the
package-manager sense, and no inventory to query: a downloaded release asset, and a
provider-native marketplace entry the harness owns. Requiring those fields unconditionally would
either exclude channels RFC 0002 accepts or invite an adapter to invent a plausible value for
them. Where a channel has no inventory, ownership-based package rollback is not offered at all —
which is a narrower promise than the one below, not a silent exception to it.

`plan` is read-only. `apply` and `update` are dry-run by default and mutate only after an
interactive confirmation or `--yes`, exactly as RFC 0006 §Global flags specifies for every mutating
command; nothing in this RFC narrows that to `--yes` alone. `update` never follows a floating tag
at apply time: planning resolves the exact version and records it in the stored plan. Applying a
stale plan is refused before invoking a package manager.

An update is transactional:

```text
inspect inventory and compatibility
 -> resolve exact target version
 -> snapshot configuration and record package inventory
 -> install the exact package version
 -> delegate/configure inside reviewed boundaries
 -> verify required postconditions
 -> commit receipt
```

A failure restores configuration snapshots. If Token Harness installed the package, the channel
reports an inventory, and no external ownership is detected, rollback also restores the prior
package inventory. Otherwise the receipt reports the package as unreverted and names the manual
remediation. No update may conceal partial rollback.

## Harness-specific configuration

A harness integration is managed only when its configuration schema has a compatibility row.
Configuration edits use the parser declared by the harness adapter. A JSONC configuration requires
a comment-and-trailing-comma-preserving editor; strict JSON mutation must not be repurposed for
JSONC.

For OpenCode, a managed plugin installation includes the configuration directory's package
manifest, lockfile, and dependencies in its reviewed write set. A plugin entry alone is not a
complete installation. Removal restores Token Harness-owned configuration and package state; it
never deletes a user-owned plugin entry or dependency.

## Verification and reporting

Verification reports the tier carried by the compatibility row. `config-only` confirms the exact
managed entry is readable; it never claims runtime interception. A provider receipt or a
Token-Harness-owned canary may raise the tier only where the fixture demonstrates the mechanism.

`status` compares a committed receipt with the live harness version, provider version, and config
schema. A changed version or schema is drift, never an automatic repair.

## Initial delivery order

Two of these were written as though the build had nothing, and the build has part of each. What is
missing is stated instead, because an RFC that asks for what already exists gets discharged by
pointing at it:

1. **Package inventory capture and reversible package ownership.** The
   `package-manager-install` executor exists — PLAN §15 item 19 — and refuses elevation, refuses an
   unknown package manager, and reports an installed package as surviving rollback. What does not
   exist is the inventory: `rollbackData: 'package-inventory'` is a declared value nothing
   implements, and RTK's plan therefore declares `none` with that reason recorded beside the
   assertion. This item is the capture, the ownership test, and the receipt that distinguishes a
   reverted package from an unreverted one.
2. **JSONC mutation beyond a root-level array append.** `appendJsoncRootArray` exists and preserves
   comments and trailing commas, and refuses an edit it cannot locate exactly. What a managed plugin
   entry needs is insertion and update of an object member, and of a nested array, at the same
   standard of refusing rather than approximating.
3. Ship an OpenCode managed integration only for rows with complete fixtures.
4. Extend RTK and HarnessTrim installation/update plans to their reviewed channels.
5. Add matrix rows only after the relevant cross-platform fixtures and verification evidence pass.

This order deliberately rejects an unsupported OpenCode release rather than installing a plugin
whose schema or dependency semantics have not been observed.
