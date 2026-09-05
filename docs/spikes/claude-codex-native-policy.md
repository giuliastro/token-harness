# Native Claude/Codex compatibility evidence - September 5, 2026

## Scope and sources

This note records a native-contract probe, not an authenticated coding benchmark. Public npm
packages were installed on disposable GitHub-hosted Windows, macOS and Linux runners. No user
account, API key, subscription or project source was used. Workflow run
[33976006739](https://github.com/giuliastro/token-harness/actions/runs/33976006739) records the
probe. Durable sanitized projections are in `tests/fixtures/native-contracts/2026-09-05/`.

Observed packages: Claude Code **2.1.261**, Codex **0.153.4**, cclimits **1.7.0**.
The npm metadata probe (run 33975481819) reported cclimits 1.7.0 published on
2026-09-03T13:56:18.193Z. Upstream PR #3 was merged on September 3. GitHub Releases still
showed v1.4.0 from July 21; that listing must not be used as npm availability evidence.

Primary contracts: [Claude effort configuration](https://code.claude.com/docs/en/model-config),
[Claude settings](https://code.claude.com/docs/en/settings), the installed Codex-generated
`HooksListResponse` schema, and the installed cclimits CLI help/JSON output.

## Observed results

| Probe | Windows | macOS | Linux | What it proves |
| --- | --- | --- | --- | --- |
| cclimits safe flags + synthetic fresh Claude cache | exit 0 | exit 0 | exit 0 | Parser/packaging/cache contract, not real quota |
| Claude doctor with low/medium/high/xhigh preferences | exit 0 | exit 0 | exit 0 | Settings accepted without a parse diagnostic, not effective session effort |
| Codex hooks/list on an isolated hook | exit 0 | exit 0 | exit 0 | Exact hook returned as enabled but untrusted; never executed |
| Codex app-server --stdio | exit 0 | exit 0 | exit 0 | Existing alias remains supported; no forced transport migration |

macOS doctor also reported a runner Keychain warning; all platforms reported no authenticated
organization policy. Neither result was hidden or interpreted as authenticated compatibility.
Codex canonicalized some filesystem paths (`/private` on macOS, long/short Windows paths), so
matching uses the filesystem canonical path when literal equality cannot establish identity.
It never matches by basename or by command text alone.

## Claude native preference contract

The exact reviewed version is admitted only when CLI help advertises persistent effort levels.
The first managed field is `effortLevel`, restricted to `low`, `medium`, `high`, and `xhigh`.
`max` is session-only and excluded. Model-dependent fallback is left to Claude, not guessed as
an observed active-model capability. Native model selection and paid overflow are not changed.

`plan --harness claude --native-policy --task ...` records the version, a narrow environment
snapshot (presence booleans, never credentials), and bounded full-file digests of user/project/
local/ancestor settings. Unknown environment, custom roots, project/local effort overrides,
unsupported syntax, disabled thinking, or known backend/model/effort environment overrides
leave the setting untouched. An explicit task is required; no task classification is invented.

`apply --plan ... --yes` rechecks version, environment and every recorded file before mutation.
Only one `effortLevel` operation is admitted by the executor guard. The existing transaction
engine snapshots the full file and verifies the write. Rollback restores exact original bytes
or original absence. Journal-owned uninstall restores the pre-existing effort preference;
repeated managed changes follow the ownership chain, but a manual replacement is not overwritten.

This is a **persisted user preference**, not an authoritative effective-configuration API.
Managed organization policy, skill/subagent and running-session overrides are not fully
observable. The user must reopen Claude and inspect `/effort`; no running session is modified.

## Codex native enablement contract

`verify` asks `hooks/list` with the installed app-server's experimental API capability enabled.
It checks the project, canonical source file, event, matcher, command, enabled bit, trust enum
and current hash. Missing, ambiguous, unknown or malformed data stays unavailable. Enabled
and trusted metadata is distinct from actual hook execution. No call grants trust or executes a
hook, and `config-only` is not promoted into a runtime/reduction tier.

## Remaining evidence gates

These observations do **not** add RTK/HarnessTrim managed-provider compatibility rows. Those
require actual install/apply/update/rollback/uninstall recordings for each exact combination.
The existing reviewed PowerShell rows are retained, not recreated from CLI help.

Authenticated interception and raw-to-model reduction, empirical model-tier ranking,
quality-passed task A/B runs, WSL runtime coverage and marginal quota benefit remain unproved
by this probe. The existing benchmark-start/finish/matrix tools can collect that evidence on a
consenting signed-in machine. Until then, no automatic model downgrade, MCP removal, output
budget cut or compaction is inferred from synthetic fixtures. Those are separate extensions,
not concealed acceptance criteria for this initial native-preference implementation.
