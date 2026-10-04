# Native Windows repair and issue checkpoint — 2026-10-04

## Build and scope

The checkout was fast-forwarded from 0.1.11 to the latest published release, 0.1.27,
`580b2fba431d46f5de5beb3ff8345831a08f0f9c`. The user's pnpm 12.4.2 selection and existing
artifacts were preserved. The repaired bundle was packed and installed through the existing
global npm installation. Its package version remains 0.1.27; **this is a locally patched build,
not a newly published release**. The original published tarball is retained separately for rollback.

Retained tarball SHA-256 values: final patched `479f8db1f8781be29987463d5d8dcda09fa6739f40505d3c5367649102f3de8c`;
published rollback copy `ba54a1b167c35f8fc869f4107b51082c7d425b4931d493a4301942c3dc2ce840`.
The paired pilot used the earlier patched tarball recorded in its separate fingerprint; do not
attribute its failed commands to the later launcher repair.

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
  The later native pilot exposed a sandbox PATH that omits global npm shims. The launcher pins the
  observed Token Harness script and RTK executable, encodes their paths and starts them through Node.
  Paths with spaces, apostrophes, dollar signs, backticks and Unicode pass a real reduced-PATH test.
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
| [#255](https://github.com/giuliastro/token-harness/issues/255) | Complete before/after collector; genuine RTK and HarnessTrim execution on both agents; missing Codex shim repaired; real repair rollback/reapply and routing rollback/reapply verified. | Published-artifact/provider-upgrade follow-up and exact compatibility admission remain open. Codex workspace-write cannot read this user's global npm script; the successful RTK canary used an explicit transient full-access invocation. |
| [#359](https://github.com/giuliastro/token-harness/issues/359) | Both agents emitted ordinary native prompt callbacks in two distinct fresh Windows sessions/projects. Native Codex trust is enabled; a genuine native child emitted one start/stop pair without a reported model. Preview/apply and rollback/re-enable were observed. | Fresh native Linux coverage is explicitly deferred at the user's request. These locally patched Windows results do not replace the published-artifact gate. |
| [#360](https://github.com/giuliastro/token-harness/issues/360) | Six matched mechanical/standard/hard pairs on both agents, frozen acceptance, native counters and latency. Negative results and tool failures are published in the [paired pilot](native-pairs-2026-10-04.md). | Codex optimized stack execution failed in the recorded sandbox. Isolated task quota attribution, repetition and marginal routing value remain open; no broad savings claim is made. |

## Runtime evidence and limits

The two fresh Claude prompts were ordinary requests to reply `ready`, with no skill or routing
command prefix. Native streaming hook events confirm `UserPromptSubmit` success. Codex subsequently
passed the same fresh-session/project probes after native trust was observed enabled. A native child
in this coding session emitted one `SubagentStart` and one `SubagentStop`; no actual model was reported.

A native Claude Bash invocation of the targeted Node tests with the TAP reporter produced a real
HarnessTrim `tap-output-slim` receipt at `2026-10-04T07:25:06.852Z`: 3,608 characters before and
3,237 after, `changed: true`, `reductionFailed: false`. Two earlier outputs were recorded unchanged
(1,114 and 1,461 characters); those negative results are retained. This is character evidence,
not token, subscription-quota or quality-gated benefit evidence.

After transactional adoption of the existing Claude RTK hooks, a native `git diff --stat` invocation
recorded one operation in the Claude-specific database. Both Claude providers then passed the
passive `canary` checks. Codex has positive RTK namespace history including a controlled child
launcher execution and a genuine native full-access shell canary after the pinned launcher repair.
The workspace-write canary failed to read the global npm script and remains a separate negative result.

A native Codex TAP run produced a genuine HarnessTrim receipt at `2026-10-04T07:57:44.929Z`:
3,418 characters before and 3,057 after, changed without reduction failure. The paired fixtures also
retain real per-project reductions and unchanged outputs. Character receipts do not prove model-token
replacement, quota or billed-cost savings.

The final routing API reports both agents `runtime-observed`/enabled: 13 prompt callbacks each,
one Codex child start/stop pair, and no reported child models. Six paired trials exist outside the
default project's matrix. Their independently accepted code does not erase failed provider execution.
WSL Ubuntu exposed inherited
Windows npm shims, not a separate native Linux Claude/Codex installation; it was not counted as
Linux runtime evidence. The user requested leaving this control open for later.

Raw recordings stay local under `artifacts/`, including native hook streams and the collector's
exact versions, capabilities, doctor/verify and stack-review output. The before collector directory
is `windows-production-stack-2026-10-04/20261004-090645-before`; the final after directory is
`windows-production-stack-2026-10-04/20261004-103916-after`. All eight final collector commands
passed. The after run uses the repaired local
bundle, so it cannot be presented as proof of unchanged published 0.1.27 behavior. No new compatibility
fixture or promotion claim was added.

## Verification and rollback

Full suite: 2,388 tests, 2,382 passed, zero failed, six expected skips. Build, lint, formatting,
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
