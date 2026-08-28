# RFC 0010: Read-only status seam

- Status: Accepted
- Date: 2026-08-28

## Purpose

Token Harness now has a consumer outside this repository: a harness control plane such as
`harness-remote` wants to show which harnesses and providers are present, what the current pipeline
looks like, whether verification passes, and what savings have been measured.

That consumer is **not a provider** under RFC 0002. It intercepts no payload, owns no capability,
and contributes no saving. It therefore gets no provider manifest and no mutation privilege.

The integration surface is the machine-readable CLI Token Harness already exposes. This RFC turns a
subset of that surface from "current implementation" into a compatibility promise, without creating
a code dependency in either direction.

## Contract surface

The following invocations are the read-only integration contract:

```text
token-harness doctor --json
token-harness status --json
token-harness verify --json
token-harness metrics --json
```

A consumer MUST parse the RFC 0006 JSON envelope and MUST NOT parse the human rendering. Human text,
column order, spacing, colour, wording and truncation are presentation details.

The consumed contract includes:

- the envelope fields `schemaVersion`, `command`, `toolVersion`, `status`, `exitCode`,
  `data`, and `diagnostics`;
- RFC 0006 exit-code meanings and the derived `status`;
- the command-specific `data` shape for the four commands above;
- stable diagnostic codes. Messages and remediation prose may be reworded.

`plan --json` is deliberately not in this seam. It is operationally read-only with respect to
harness configuration, but RFC 0006 persists a stored plan in Token Harness state. A remote status
reader has no reason to create an executable artifact merely to inspect the machine.

The mutating commands `apply`, `update`, `uninstall`, and `rollback` are outside this RFC.

## Schema compatibility

The current envelope schema is `schemaVersion: 1`.

Within one schema version Token Harness may:

- add optional object fields;
- add array entries;
- add new diagnostic codes;
- improve human-readable message or remediation text;
- expose data that was previously `null` when a new read-only capability becomes observable.

Within one schema version Token Harness MUST NOT:

- remove or rename an existing field;
- change an existing field's JSON type;
- change the meaning of an existing exit code, diagnostic code, or enum value;
- change a required field into a shape that an existing schema-1 consumer cannot parse.

A change that violates those rules increments `schemaVersion`. A consumer that sees a schema version
it does not implement MUST stop interpreting `data`; it may report the `toolVersion` and the
unsupported schema number, but it must not guess.

Consumers SHOULD ignore unknown optional fields and unknown diagnostic codes. They SHOULD NOT assume
that an array is exhaustive forever merely because a particular Token Harness version returned only
the members known at the time.

`toolVersion` is useful for display and feature policy, but it never overrides the schema check.
A newer semantic version carrying schema 1 is still a schema-1 document; a future schema 2 must not
be parsed as schema 1 just because its tool version looks compatible.

## Failure semantics

A non-zero exit code does not mean "no machine-readable answer". RFC 0006 still requires a valid
JSON envelope whenever serialization was possible. Consumers therefore parse the envelope first and
then interpret `status`, `exitCode`, and diagnostics.

The only case in which stderr may substitute for the envelope is a failure that prevented
serialization itself. A consumer may surface that as "Token Harness could not produce status"; it
must not reconstruct state from partial stdout, human text, or files on disk.

## State-root location

The CLI remains the preferred read seam; consumers do not need the state root to call these four
commands.

For local orchestration that must identify the directory Token Harness owns, the canonical default
state root is nevertheless part of this contract:

| Platform | State root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\\TokenHarness` |
| macOS | `~/Library/Application Support/TokenHarness` |
| Linux and WSL | `${XDG_STATE_HOME:-~/.local/state}/token-harness` |

Only absolute environment-variable values are accepted by Token Harness path resolution. Native
Windows does not guess a replacement when `%LOCALAPPDATA%` is absent; Linux/WSL ignores an invalid
relative `XDG_STATE_HOME` and uses the documented home fallback. A state path resolving inside the
system temporary directory is rejected.

This table lets a launcher identify the Token Harness state root without copying the implementation
of RFC 0004 permission checks. It does **not** make the state-root file layout an integration API.

## Direct state access is not the seam

Consumers MUST NOT build product behavior by reading `journals/`, `backups/`, metrics files,
stored plans, cursors, receipts, or other internal state files directly.

There are two reasons:

1. Their file layout is an implementation detail and may change without an RFC 0010 schema change.
2. The state root is intentionally private. RFC 0004 backups may contain sensitive configuration
   byte-for-byte. They are protected by the state-root permission invariant and are not safe payloads
   for a remote UI.

A consumer that needs information represented in internal state must request that information
through one of the contracted JSON commands, or wait for a future read-only field/command to expose
it deliberately.

## Privacy guarantee of the read surface

RFC 0005's normalized metrics store never records:

- prompts;
- raw command arguments or raw command text;
- raw tool output;
- source code;
- credentials.

Project identity is a machine-local salted identifier. Provider-local original-output references are
not copies of the output, and session identifiers are not exported by default.

The four RFC 0010 envelopes inherit that policy for metrics and attribution data: they MUST NOT turn
a normalized event back into raw prompt, command, output, source-code, or credential content.

This guarantee does **not** imply that the entire state root is nonsensitive. Configuration backups
are allowed to contain sensitive configuration under RFC 0004, which is another reason the state
root itself is never the remote read API.

Diagnostics may contain local configuration paths when a path is necessary to make a finding
actionable. A consumer that sends an envelope off-machine should treat those paths as local metadata
and may redact them in its own UI or transport policy.

## Read-only boundary

An RFC 0010 consumer may observe. It may not mutate.

In particular, this RFC grants no permission to:

- run `apply`, `update`, `uninstall`, or `rollback` remotely;
- edit Token Harness state or harness configuration directly;
- trust project-local manifests or pins;
- turn an RFC 0010 envelope into an instruction to execute a provider command.

Authentication to a remote control plane is not repository trust. RFC 0004 intentionally leaves
project-local execution inert until the user trusts the repository, and Token Harness has no
accepted mechanism that lets a socket, ACP peer, HTTP client, or remote UI substitute for that
decision.

A future remote mutation surface therefore requires its own accepted trust and authorization
contract. It cannot be added as an "extension" of RFC 0010.

## Transport independence

This RFC specifies JSON values, not a transport.

A consumer may obtain them by spawning Token Harness locally, through a daemon that invokes the CLI,
or through another transport that relays the envelope unchanged. HTTP, ACP, WebSocket, SSH and
Harness Remote are not dependencies of Token Harness and are not standardized here.

If a relay wraps the envelope, it must preserve the complete Token Harness envelope as one logical
object. It must not flatten diagnostics into strings or discard the schema version.

## Consumer algorithm

A minimal consumer does this:

1. invoke one of the four contracted commands with `--json`;
2. parse exactly one JSON document;
3. verify `schemaVersion`;
4. verify that `command` matches the command requested;
5. interpret `status` and `exitCode`;
6. render only fields it understands, ignoring additive optional fields and unfamiliar diagnostics;
7. never fall back to parsing human output or internal state.

This is intentionally boring. A status seam that requires knowledge of Token Harness internals has
already failed as a seam.

## First consumer: Harness Remote

Harness Remote may use this contract to display Token Harness health beside a harness session:

- `doctor` for detected harness/provider inventory and compatibility warnings;
- `status` for pipeline/drift state;
- `verify` for the strongest verification tier currently proved;
- `metrics` for measured savings and importer fidelity.

Harness Remote remains independently deployable. Token Harness does not import it, link against it,
or assume it is present; Harness Remote needs only the executable/relay and this JSON contract.

The first integration should remain read-only even if Harness Remote already has its own authenticated
control channel for coding agents. Controlling an agent session and authorizing installation of code
on the host are different authorities.

## Non-goals

This RFC does not:

- define a daemon or HTTP API;
- expose raw journal, receipt, backup or metrics-file schemas;
- add a remote install/update/uninstall operation;
- define repository trust;
- promise that every provider can reach the same verification tier;
- make Harness Remote a provider;
- add a dependency between the two repositories.

## Acceptance

RFC 0010 is satisfied when:

- the four JSON envelopes above are treated as a consumed compatibility contract;
- a schema-breaking change requires a `schemaVersion` bump;
- the canonical state-root locations and the non-API status of its file layout are explicit;
- the privacy boundary distinguishes normalized read data from sensitive configuration backups;
- remote mutation remains explicitly out of scope until a separate trust contract exists.
