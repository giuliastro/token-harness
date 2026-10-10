# Testing unmerged PRs with Harness Remote

PRs stay unmerged until review. Packaging/UI checks and native harness execution are
different gates; a green build means the candidate is available for your PC test,
not that Windows hooks or savings have been proved.

## Get the candidate

The [history/recovery PR #381](https://github.com/giuliastro/token-harness/pull/381)
passed all Windows, Linux and macOS checks. Its
[Desktop packages run](https://github.com/giuliastro/token-harness/actions/runs/37933647821)
contains these downloadable artifacts (GitHub sign-in may be required):

| PC | Artifact | Run/install |
| --- | --- | --- |
| Native Windows x64 | `token-harness-desktop-win-x64` | Extract the artifact ZIP and install its setup EXE. |
| Linux x64 | `token-harness-desktop-linux-x64` | Install the DEB or extract the TAR.GZ into a permanent directory and run `token-harness-desktop`. |
| macOS Intel | `token-harness-desktop-mac-x64` | Copy the application from the DMG/ZIP into Applications. |
| macOS Apple Silicon | `token-harness-desktop-mac-arm64` | Copy the application from the DMG/ZIP into Applications. |

For guided paired captures, [PR #382](https://github.com/giuliastro/token-harness/pull/382)
and its [Desktop packages run](https://github.com/giuliastro/token-harness/actions/runs/37948923478)
are green. For guided benchmark recovery, use the PR for
`codex/guided-benchmark-recovery`, stacked on #382: wait for its **Desktop packages**
checks and download that run's artifacts. The newest candidate includes both predecessors.
Record the PR head SHA/run; candidate packages still have the repository's current
version number, so `0.1.30` alone does not identify the build. These artifacts are
not a new release or an npm `latest` update.

Keep the installed runtime at a stable location while owned hooks reference it.
The initial Windows builds are unsigned and macOS builds are ad-hoc signed, without
notarization; apply your normal OS security review. Opening the app changes no agent
configuration. Do not move/remove its runtime before reviewing owned integrations.

If you prefer source testing, use a separate checkout. With Git, Node 22.13+ and pnpm
available, build the candidate without switching an existing checkout or changing main:

```sh
git clone --branch codex/guided-benchmark-recovery --single-branch https://github.com/giuliastro/token-harness.git token-harness-pr-test
cd token-harness-pr-test
pnpm install --frozen-lockfile
pnpm build
node dist/bundle/token-harness.mjs start
```

That source command opens Token Harness for the checkout directory. To measure a
different project, launch the same absolute bundle path from that project's directory,
or use the desktop application's **File → Open project**. Keep the checkout/runtime
in place while any owned integrations refer to it. No global npm replacement is required.

## Use the same project in both apps

1. Open Token Harness on the PC that runs the Harness Remote Machine/bridge. In the
   desktop app choose **File → Open project** and select a small disposable test project.
2. Open Harness Remote, choose that same Machine and project, then **New Session** and
   **Codex CLI**. Select `gpt-6-luna` only if it is present in the runtime model catalog.
   This is Giulio's approved real-test model; do not substitute another model silently.
   Claude model tests remain disabled by the existing preference.
3. Send a bounded prompt, verify the assistant response, stop and continue a turn, and
   reopen/resume the session to check ordinary Harness Remote behavior. Review the
   resulting file changes/tests in the test project.

Harness Remote's inspected implementation starts the official Codex ACP adapter and
inherits the Machine process environment. That adapter embeds Codex; the globally
installed CLI version is not proof of the ACP session's actual runtime version.
Retain any actual adapter/runtime version reported by the session. Its project
directory must match Token Harness's selected project for project-scoped evidence.

There is no Token Harness dashboard embedded in the inspected Harness Remote source.
Use its sessions for the coding work and Token Harness's local window for review and
measurements. The Token Harness control surface stays loopback-only; do not expose
it or forward its mutation API through the remote gateway.

## Test retained history and recovery

Open **Results → Operation history & recovery**. Earlier retained operations for the
selected project should appear after closing/reopening Token Harness. Reviewing a
restore and choosing **Cancel** should leave configuration unchanged. Only the latest
eligible configuration transaction on the machine can be selected; a newer operation
or another project must block an older approval.

Confirm a full restore only for a configuration operation intentionally made for this
test: restoration replaces complete backed-up files, including later manual edits.
Package operations, pending/dirty state and prepared benchmark leases keep their
separate recovery workflows. User-owned integrations have no invented transaction.

## Test guided manual comparisons

1. In Token Harness select **Results → Start or finish a comparison**, choose **Codex**
   and the actual task class, then **Review new baseline → Record reviewed step**.
   Configuration and models must remain unchanged.
2. Run the bounded baseline task from Harness Remote. Run its acceptance checks
   yourself, then return to **Start or finish a comparison → Record baseline outcome**.
   Choose the actual passed/failed result and coding attempt counts; review and approve.
3. Restore the same task/tree/checks yourself. Explicitly enable the optimization you
   intend to compare through its existing reviewed setup. Choose **Prepare optimized
   run**, acknowledge the conditions, review and record the optimized capture.
4. Run the same task and checks through Harness Remote, then record its actual optimized
   outcome. **Pair complete** should appear even for failed quality; Results must keep
   quality, local output, five-hour quota and weekly quota separate. Missing evidence
   remains unmeasured. Close/reopen the app between steps to test retained-state recovery.

Use one task at a time and avoid other consumption on the same account during a
measurement. Current account balances can include unrelated activity. A single pair,
manual quality declaration or successful UI flow does not prove attributable or
repeatable savings.

For routing execution, inspect **Results → Automatic prompt routing** for new genuine
prompt/child callbacks. Follow the native hook enablement/trust instructions shown by
Overview and create a fresh session after hook changes; do not bypass sandbox or trust
controls. ACP behavior must be observed rather than inferred from global CLI setup.
Luna deliberately keeps work on the root, so it is suitable for the basic flow test,
not for proving delegation's marginal value. An unreported actual child model stays
unknown. The Windows `workspace-write` scope remains an explicit #255 verification gap.

## Test guided benchmark recovery

Use a disposable project with a supported, already-owned configuration integration.
Use the candidate CLI built above, or an installed CLI that exposes `benchmark-prepare`
and uses the same local state store as Desktop. For a source candidate, replace
`token-harness` below with `node /absolute/path/to/token-harness-pr-test/dist/bundle/token-harness.mjs`
(quote a path containing spaces), while keeping the disposable project as the working
directory. An older globally installed CLI may lack this command.
From that project's directory, prepare an arm with the existing CLI command (replace
the starting-state ID with a value valid for the fixture):

```sh
token-harness benchmark-prepare --benchmark-id remote-recovery-1 --variant compression-only --starting-state <commit-or-fixture-id> --task standard --harness codex
```

Review this dry-run first. If its changes are appropriate for the fixture, repeat
the command with `--plan <returned-plan-id> --yes`. That creates an active prepared-arm
lease and backup/checkpoint; it is setup for the recovery test, not proof that hooks
ran. The configuration may include user-level files, so finish recovery before using
other coding sessions. Do not run the task or check. Reopen the candidate Desktop app
on the same PC and project, open **Overview → Health and updates → Review benchmark
recovery**, and confirm the listed arm belongs to that project. Preview the
recovery, then cancel and verify the project configuration is unchanged. Preview again,
apply recovery, and verify the original files, supported mode metadata and absent
paths are restored. On Windows, do not use a chmod call as permission evidence;
check the resulting state and retain the native platform verification gap.
The UI selects only the active lease for the current project. It uses the existing
`benchmark-restore` engine, so detected configuration drift or an invalid/missing
checkpoint must preserve backups and block restoration for investigation.

This action only restores the prepared configuration. It does not finish the capture,
record a quality outcome, run the task or saved check, or select/launch a model. Keep
the native-hook trust and sandbox controls in place. This GUI recovery test is a real
desktop workflow observation; it does not prove native hooks reached the provider,
runtime compression, or savings. Configuration-only evidence remains configuration-only.

Report the PR head/run, PC OS, Harness Remote version, actual session model/runtime,
test project, observed verification tier, and the first failing step/error. Omit tokens,
credentials, raw prompts and private configuration from shared diagnostics.
