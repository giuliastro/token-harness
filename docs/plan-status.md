# Delivery status — 2026-10-10

**Release candidate: Token Harness 0.1.31.** Desktop distribution, deterministic checks,
managed exploratory benchmarks and guided history/capture/recovery are merged. Exact-tag
publication gates and published-artifact checks remain required. See
[0.1.31 notes](releases/0.1.31.md) and the [desktop coverage matrix](desktop-workflow-coverage.md).

The 0.1.30 management, transaction, measurement and advisory foundations
are shipped. App evidence separates explicitly attributed output, runtime callbacks and current quota.
Paired comparisons retain independent five-hour/weekly readings and explicit quality gates, with
read-only capture guidance for missing comparisons (#371). Automatic native prompt-hook installation supplies a per-harness model ladder with
explicit child models and override-capable Codex forks (#368). Both agents have genuine
Windows callbacks and provider receipts on the earlier locally patched build, plus fresh native
Linux prompt callbacks with published 0.1.28. Linux hook lifecycle and exact rollback are verified;
Claude model access is blocked by existing authentication. Windows published-artifact upgrade
coverage, Codex sandbox access, attributable paired quota savings and the closed-loop controller remain incomplete.
The startup, Codex 0.146.0, Windows RTK attribution and read-only decision/checkpoint fixes
were reviewed, merged and published in 0.1.28; their original live evidence keeps its build distinction.
It does not declare broad-promotion readiness.

## What is complete, partial or still planned

| Area | Current state | Remaining gate |
| --- | --- | --- |
| Foundation / MVP (Phases 0–8) | Shipped CLI/domain, platform/state, adapters, transactions, ownership, verification tiers and measurement. | Keep regression and exact release checks green. |
| Managed lifecycle (Phase 9) | Claude/Codex baseline lifecycle, package updates, pipeline status and evidence capture shipped. | Real current Windows combination (#255); historical Hermes/Pi/OMP lifecycle and broader 0.2.0 coverage are unfinished. |
| Quota/native policy (Phase 10, §18) | Dual-window observations, conservative recommendations, paired outcome learning, scheduling/handoff and portable skill shipped. | Empirical coverage is narrower than all task/model/platform combinations. |
| Guided skill (§18.13–18.14) | Bundled skill, reversible installation and owned/external/modified state implemented. | No remaining implementation task from the former “next UX work” notes. |
| Native prompt routing (§18.15) | Opt-in hook lifecycle, version/schema checks, authorization reporting and privacy-bounded receipts shipped in 0.1.24–0.1.26. Both agents passed fresh Windows probes on the earlier local build and fresh Linux prompt-hook/lifecycle probes with published 0.1.28. | Windows published-artifact recheck (#359), Claude Linux model authentication and paired benefit (#360) remain open. Prompt guidance alone does not prove actual model choice. |
| Efficiency Decision (§19.1) | Public read-only `optimize` decision composes existing observations, exact capacity receipts and optional controller scheduler advice. | Advance explicit escalation/budget contracts after reviewed integration (#361). |
| Context Governor (§19.2) | Bounded metadata advice and checkpoint acceptance/fact fields integrated (#361). | Automatic context execution remains future work; no automatic context rewrite is proved. |
| Adaptive escalation / task budgets (§19.3–19.4) | Native policy/quality/capacity foundations exist; the decision contract carries empirical allowance budgets and optional evidenced attempt limits. | Implement escalation receipts and task-budget enforcement; do not treat an internal suggested budget as a running controller. |
| Bounded loop and later controller (§19.5–19.13) | Roadmap; existing evidence/analytics are prerequisites. | Deterministic stops, failure fingerprints, repository context/cache, selective verification and accepted-work analytics before opt-in autonomy. |
| Self-update (§19.17) | Reviewed global-npm updates, startup notification, automatic health checks and guarded UI restart shipped. | Verify new channels/platforms when added; npx/source installs retain their original update path. |
| CCR gateway (§20) | Withdrawn; removed in #353. | No implementation to revive or merge from old routing branches. |
| Broad promotion | **Not ready.** | Combined-stack evidence, three proven useful mechanisms, marginal third-mechanism value and a clean fresh-user end-to-end run. |

There is no meaningful single completion percentage: shipped implementation, runtime verification,
paired evidence and promotion are independent gates.

## Issues and PR reconciliation

The audit inspected all **22 issue records** and **336 PR records** available at this checkpoint,
including their open/closed state and the historical completion trail. Before reconciliation there
were two open issues and one open PR. No completed implementation issue was reopened simply because
its evidence or promotion follow-up remains separate.

| Record | Decision | Evidence / follow-up |
| --- | --- | --- |
| [#342 provider drift](https://github.com/giuliastro/token-harness/issues/342) | Closed as completed. | #357 and published 0.1.25/0.1.26 record RTK 0.51.0 / HarnessTrim 0.3.1; official upstream latest releases matched on 2026-10-03. |
| [#348 old routing / RTK PR](https://github.com/giuliastro/token-harness/pull/348) | Closed as superseded, without merge. | #349 selected the active canonical PATH executable and preserved shadowed copies; #351 completed the old routing UI fixes; #353 withdrew CCR; #356/#358 supplied native routing. |
| [#255 Windows stack](https://github.com/giuliastro/token-harness/issues/255) | Kept open; title/body refreshed. | RTK 0.51.0 + HarnessTrim 0.3.1, published Token Harness 0.1.26+, exact installed harness versions and genuine before/after receipts. Collector CI is not real stack evidence. |
| [#359 native routing runtime](https://github.com/giuliastro/token-harness/issues/359) | Linux callback/lifecycle coverage completed; Windows published-artifact gate retained. | Published 0.1.28, two fresh projects per agent, genuine Codex child, negative disabled probes and exact rollback; Claude hooks succeeded before blocked model authentication. See the [Linux audit](evaluation/linux-native-routing-2026-10-04.md). |
| [#360 paired evidence](https://github.com/giuliastro/token-harness/issues/360) | New measurement task. | Routing and combined-stack baseline/optimized runs, attributable units, quality, retries and authoritative allowance. |
| [#362 compatibility contract](https://github.com/giuliastro/token-harness/issues/362) | RFC 0009 amendment reviewed against the shipped admission paths. | Integrated in #365; no runtime guard or empirical gate is relaxed. |
| [#361 decision/checkpoint integration](https://github.com/giuliastro/token-harness/issues/361) | Read-only public decisions and bounded checkpoint fields implemented and tested. | Integrated in #365; escalation, enforced budgets and loops remain future work. |

The other 20 issues were already closed: substantive lifecycle, attribution, campaign and update work
stays closed; three accidental/temporary records and duplicate campaign issue #227 add no roadmap
work. The PR history is implementation evidence, not proof that every runtime/promotion gate passed.
The concurrent UI/UX session is independent; the RFC reconciliation changes documentation only.

RFC 0009's October 4 amendment documents the shipped live-assignability admission paths alongside
exact historical recordings and independent native-hook/combined-stack/measurement gates (#362).
The reconciliation changes no guard or evidence registry.

## Release evidence

The next release is [0.1.31](releases/0.1.31.md), including desktop distribution,
benchmark checks/preparation and guided history, paired captures and recovery. Its
publication evidence will retain the exact source tag and artifact checks. The
previous [0.1.30 release](releases/0.1.30.md) includes the evidence repair in #371.
Local review validation passed 2,418 tests with nine expected skips, plus typecheck, lint, formatting,
build and bundle smoke. PR and merged-main CI passed on Windows, macOS and Linux.
The inherited routing policy in #368 has synthetic coverage for Sol/Astra ladders, the Luna no-op,
Claude's explicit model parameter, malformed input and event isolation; this does not establish actual native child selection.
Cross-platform candidate CI and the exact-tag publication workflow remain required release gates.
The previous release's evidence
below retains its original version and date. The [October 4 native Windows repair audit](evaluation/2026-10-04-local-fixes.md)
records the pre-release live results, local build distinction and remaining #255/#359/#360 gates.
The [native Linux routing audit](evaluation/linux-native-routing-2026-10-04.md) adds published 0.1.28
callbacks and lifecycle results without turning Claude authentication failures into successful model turns.
The [six-pair native pilot](evaluation/native-pairs-2026-10-04.md) publishes accepted code, negative
token/latency outcomes and failed Codex stack activation without attributing shared account quota.

- [PR #358](https://github.com/giuliastro/token-harness/pull/358) merged as
  `5f2630357b5a5a8b4b22f9c0ded58bd446982a65`, tagged `v0.1.26`.
- [Final PR CI](https://github.com/giuliastro/token-harness/actions/runs/37146711560): Windows,
  macOS and Ubuntu all passed.
- [Exact-tag publication](https://github.com/giuliastro/token-harness/actions/runs/37147152988):
  passed release checks and npm Trusted Publishing; npm `latest` was verified as 0.1.26.
- Public npm artifact installation, `--version`, `--help`, manifest and provenance/SBOM checks
  passed. The npm tarball and GitHub asset matched SHA-256
  `a0cf714ccb418767f9993d93b4a337a21f104abf2d02b645f6320266b3847a50`.
- [Release notes and runtime checks](releases/0.1.26.md) remain the native-machine checklist.

These release gates do not prove Windows Claude callback execution, actual routing model identity,
combined-stack benchmark performance or subscription/API savings.

## Next steps, in order

1. **Verify the installed stack and automatic callbacks:** #255 and #359. The root Linux Codex
   setup was repaired in 0.1.26. A subsequent passive dashboard/API read reports it enabled and
   runtime-observed: 3 prompt callbacks, 2 starts and 2 stops, last receipt 2026-10-03T19:40:32Z.
   No actual child model is reported. Both agents have fresh-session Windows callbacks on the earlier
   local build. Published 0.1.28 now has two fresh native Linux prompt-hook probes per agent, a genuine
   Codex child start/stop pair and exact lifecycle restoration. Claude model access is blocked by existing
   authentication. Windows published-artifact upgrade and Codex sandbox access remain gates.
2. **Run bounded paired experiments:** #360. Retain negative outcomes, actual activation,
   acceptance/retry evidence and independent five-hour/weekly observations. Never launch a broad
   campaign merely to fill a dashboard. The October 4 pilot already records six pairs; failed Codex
   RTK commands veto those optimized comparisons and concurrent parent activity excludes task quota attribution.
3. **Review the unified advisory path:** #361 is implemented on this branch using the existing
   decision/context contracts, with unknown budgets explicit and source receipt references.
4. **Implement 19.3–19.5 sequentially:** evidenced escalation, enforced per-task budgets, then
   bounded verify/retry/stop. Keep architecture/security/critical work at its quality floor.
5. **Earn promotion:** measure marginal value of a third mechanism over the actual native/current
   baseline, validate the combined stack and run fresh-user end-to-end against a published artifact.

The historical 0.2.0 harness/provider expansion backlog remains visible in PLAN §15–16. It is
secondary to these efficiency priorities and should resume only when it closes a measured workload
gap or adds required reversible lifecycle coverage. UI polish proceeds independently and does not
satisfy empirical gates.
