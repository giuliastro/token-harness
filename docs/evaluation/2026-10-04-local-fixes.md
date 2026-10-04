# Native Windows repair and issue checkpoint — 2026-10-04

## Build and scope

The checkout was fast-forwarded from 0.1.11 to the latest published release, 0.1.27,
`580b2fba431d46f5de5beb3ff8345831a08f0f9c`. The user's pnpm 12.4.2 selection and existing
artifacts were preserved. The repaired bundle was packed and installed through the existing
global npm installation. Its package version remains 0.1.27; **this is a locally patched build,
not a newly published release**. The original published tarball is retained separately for rollback.

Retained tarball SHA-256 values: patched `ecda33279fe7b8fd4ee3e0306c0e3e8de5e3c29237426c2a6bcc46dfcbe74dcc`;
published rollback copy `ba54a1b167c35f8fc869f4107b51082c7d425b4931d493a4301942c3dc2ce840`.

Recorded native versions: Windows x64, Node 24.13.1, Codex CLI 0.146.0, Claude Code 2.1.285,
RTK 0.51.0 and HarnessTrim 0.3.1. No third-party package was installed by the automated tests.

## Repairs

- Passive startup update checks no longer acquire the exclusive change lock or create/replace an
  approval. Concurrent passive checks are coalesced; evidence from a check that overlaps a managed
  operation is discarded. A user-requested update review obtains a fresh approval normally.
- Codex 0.146.0 is admitted by the exact, source-reviewed native routing format gate. Neighboring
  versions are not admitted by extrapolation. See [the tagged-source review](../spikes/codex-0.146-routing-contract.md).
- Native Windows Codex shell hooks label PowerShell as `Bash` and omit the shell name. The RTK
  proxy now uses a child launcher with a real process environment rather than a Bash assignment.
- A Codex HarnessTrim hook referenced a missing pnpm `.CMD` shim. The provider now reports this
  verification failure and can plan a reversible repair of one missing absolute executable with
  exact standard arguments. Live absolute paths, custom arguments, custom metrics destinations,
  ambiguous hooks and WSL configurations retain their original command.

The live dashboard check started a background update check and an interactive check concurrently.
Both returned HTTP 200 after 11.5 seconds; activity reported `busy: false` during the background
read. Delayed-runner tests additionally prove that previews remain available and existing/newer
approvals survive. This establishes the startup race repair independently of network speed.

## Issue-by-issue result

| Issue | Completed here | Remaining acceptance gate |
| --- | --- | --- |
| [#362](https://github.com/giuliastro/token-harness/issues/362) | RFC 0009 reconciles historical exact rows with live assignability, package replacement, native format, combination and measurement gates; negative cases are explicit. | Review/merge the documentation; no guard or evidence registry was widened. |
| [#361](https://github.com/giuliastro/token-harness/issues/361) | Public `optimize` decisions compose source-tagged policy/context/scheduler advice and exact capacity receipts; unavailable budgets remain unknown. Bounded checkpoints preserve acceptance criteria and costly facts. Human/verbose/JSON contracts and all four task classes on both agents are tested. | Review/merge this read-only milestone. Escalation, enforced budgets and automatic loops remain later milestones. |
| [#255](https://github.com/giuliastro/token-harness/issues/255) | Before/after collector runs; actual Claude RTK and HarnessTrim receipts; missing Codex shim repaired; real repair rollback/reapply and routing rollback/reapply verified. | Complete the native Codex HarnessTrim reduction and reviewed provider-upgrade coverage; publish and retain the exact runtime recordings before admitting release compatibility rows. |
| [#359](https://github.com/giuliastro/token-harness/issues/359) | Two ordinary prompts in distinct fresh Windows Claude sessions/projects produced two native callbacks. Later probes bring the total to ten. Preview/apply, disabled reporting after rollback and re-enable were observed. | Codex routing remains untrusted with zero prompt receipts. Review the hooks in native `/hooks`, then exercise fresh sessions/projects. Fresh native Linux coverage and genuine subagent lifecycle events remain unproved here. |
| [#360](https://github.com/giuliastro/token-harness/issues/360) | Read-only matrix audit confirms zero local complete pairs and unknown savings; the prerequisite runtime failures above were repaired. | Run bounded matched baseline/optimized mechanical, standard and hard tasks on both agents, retain actual activation, acceptance/retries/latency, and comparable five-hour and weekly observations independently. |

## Runtime evidence and limits

The two fresh Claude prompts were ordinary requests to reply `ready`, with no skill or routing
command prefix. Native streaming hook events confirm `UserPromptSubmit` success. No subagent was
launched in these probes; starts/stops and reported child models remain zero/empty.

A native Claude Bash invocation of the targeted Node tests with the TAP reporter produced a real
HarnessTrim `tap-output-slim` receipt at `2026-10-04T07:25:06.852Z`: 3,608 characters before and
3,237 after, `changed: true`, `reductionFailed: false`. Two earlier outputs were recorded unchanged
(1,114 and 1,461 characters); those negative results are retained. This is character evidence,
not token, subscription-quota or quality-gated benefit evidence.

After transactional adoption of the existing Claude RTK hooks, a native `git diff --stat` invocation
recorded one operation in the Claude-specific database. Both Claude providers then passed the
passive `canary` checks. Codex has positive RTK namespace history including a controlled child
launcher execution, but that does not establish native HarnessTrim execution or prompt routing.

The final routing API reports Claude `runtime-observed`/enabled and Codex `config-only`/untrusted.
The final benchmark matrix has zero pairs and null local-token savings. WSL Ubuntu exposed inherited
Windows npm shims, not a separate native Linux Claude/Codex installation; it was not counted as
Linux runtime evidence. The earlier Linux evidence tracked in #359 was not reverified here.

Raw recordings stay local under `artifacts/`, including native hook streams and the collector's
exact versions, capabilities, doctor/verify and stack-review output. The before collector directory
is `windows-production-stack-2026-10-04/20261004-090645-before`; the final after directory is
`windows-production-stack-2026-10-04/20261004-094741-after`. The after run uses the repaired local
bundle, so it cannot be presented as proof of unchanged published 0.1.27 behavior. No new compatibility
fixture or promotion claim was added.

## Verification and rollback

Full suite: 2,387 tests, 2,381 passed, zero failed, six expected skips. Build, lint, formatting,
package staging, smoke and temporary installation smoke passed. Golden checks cover the public
human, verbose and JSON decision outputs. Launcher tests now isolate home, project, provider PATH
and credentials, so a user's live allowance cannot change their expected output.

Stored transaction records retain the routing and provider repair backups. Claude routing rollback
`c0bc2b3060d7` removed only the owned routing entries and reported Disabled; reapply restored them.
HarnessTrim repair rollback `576e2301dfc5` restored the missing-path command and the new verifier
reported its failure; reapply committed the correction again. Other hooks and settings survived.

The global package can be restored from the original tarball with the same npm installer used for
the local update. Restoring it also restores the two reported bugs, so the repaired build remains
installed. User hook trust is managed in Codex's native UI and was not bypassed.
