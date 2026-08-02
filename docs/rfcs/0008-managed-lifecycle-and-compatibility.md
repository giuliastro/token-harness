# RFC 0008: Managed lifecycle and compatibility matrix

- Status: Accepted
- Date: 2026-08-02

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

## Managed provider lifecycle

A provider adapter continues to describe actions through `plan()`; it never invokes package
managers directly. A managed install or update plan records:

- the package-manager executable and argument array;
- provider package name and exact version;
- installation channel evidence and the package inventory before mutation;
- affected provider and harness paths;
- a reviewed containment boundary and expected artifacts for any delegated installer;
- required verification checks; and
- whether a package is removable automatically under RFC 0004 ownership rules.

`plan` is read-only. `apply` and `update` remain dry-run unless `--yes` is supplied. `update`
never follows a floating tag at apply time: planning resolves the exact version and records it in
the stored plan. Applying a stale plan is refused before invoking a package manager.

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

A failure restores configuration snapshots. If Token Harness installed the package and no external
ownership is detected, rollback also restores the prior package inventory. Otherwise the receipt
reports the package as unreverted and names the manual remediation. No update may conceal partial
rollback.

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

1. Add package-manager action execution with inventory capture and reversible ownership.
2. Add comment-preserving JSONC mutation primitives.
3. Ship an OpenCode managed integration only for rows with complete fixtures.
4. Extend RTK and HarnessTrim installation/update plans to their reviewed channels.
5. Add matrix rows only after the relevant cross-platform fixtures and verification evidence pass.

This order deliberately rejects an unsupported OpenCode release rather than installing a plugin
whose schema or dependency semantics have not been observed.
