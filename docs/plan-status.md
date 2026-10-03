# Delivery status — 2026-10-03

**Published: Token Harness 0.1.26.** The management, transaction, measurement and advisory foundations
are shipped. Automatic native prompt-hook installation is implemented. Real current Windows stack
verification, attributable paired savings and the closed-loop controller remain incomplete.
This checkpoint reconciles the historical PLAN with the published product; it does not change
architecture or declare broad-promotion readiness.

## What is complete, partial or still planned

| Area | Current state | Remaining gate |
| --- | --- | --- |
| Foundation / MVP (Phases 0–8) | Shipped CLI/domain, platform/state, adapters, transactions, ownership, verification tiers and measurement. | Keep regression and exact release checks green. |
| Managed lifecycle (Phase 9) | Claude/Codex baseline lifecycle, package updates, pipeline status and evidence capture shipped. | Real current Windows combination (#255); historical Hermes/Pi/OMP lifecycle and broader 0.2.0 coverage are unfinished. |
| Quota/native policy (Phase 10, §18) | Dual-window observations, conservative recommendations, paired outcome learning, scheduling/handoff and portable skill shipped. | Empirical coverage is narrower than all task/model/platform combinations. |
| Guided skill (§18.13–18.14) | Bundled skill, reversible installation and owned/external/modified state implemented. | No remaining implementation task from the former “next UX work” notes. |
| Native prompt routing (§18.15) | Opt-in hook lifecycle, version/schema checks, native authorization reporting and privacy-bounded receipts shipped in 0.1.24–0.1.26. | Real Windows/Linux session callbacks (#359) and paired quality-gated benefit (#360). Prompt guidance alone does not prove actual model choice. |
| Efficiency Decision (§19.1) | Tested internal read-only `decideEfficiency` contract exists. | Integrate one explainable CLI/controller decision from existing observations (#361). |
| Context Governor (§19.2) | Bounded metadata snapshot, deterministic advice and CLI input shipped. | Complete the checkpoint contract/integration (#361); no automatic context rewrite is proved. |
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
| [#359 native routing runtime](https://github.com/giuliastro/token-harness/issues/359) | New bounded verification task. | Ordinary prompts in fresh sessions/projects on native Windows and Linux, with native authorization and real callbacks. |
| [#360 paired evidence](https://github.com/giuliastro/token-harness/issues/360) | New measurement task. | Routing and combined-stack baseline/optimized runs, attributable units, quality, retries and authoritative allowance. |
| [#362 compatibility contract](https://github.com/giuliastro/token-harness/issues/362) | New contract reconciliation task. | Review RFC 0009's historical exact-row-only language against shipped live-capability admission, without relaxing guards or empirical gates. |
| [#361 decision/checkpoint integration](https://github.com/giuliastro/token-harness/issues/361) | New next implementation task. | Complete the read-only 19.1–19.2 path before escalation, enforced budgets or loops. |

The other 20 issues were already closed: substantive lifecycle, attribution, campaign and update work
stays closed; three accidental/temporary records and duplicate campaign issue #227 add no roadmap
work. The PR history is implementation evidence, not proof that every runtime/promotion gate passed.
The concurrent UI/UX session is independent; this reconciliation changes documentation only.

RFC 0009 still contains historical exact-row-only admission wording while the shipped implementation
also checks live assignable runtime surfaces. #362 tracks the explicit contract amendment; the
provider guide describes current behaviour without changing any guard or evidence registry.

## Release evidence

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
   setup was repaired in 0.1.26; its last observation was configured but untrusted with no callback.
   The user must grant native hook trust once. Native Windows requires genuine machine receipts.
2. **Run bounded paired experiments:** #360. Retain negative outcomes, actual activation,
   acceptance/retry evidence and independent five-hour/weekly observations. Never launch a broad
   campaign merely to fill a dashboard.
3. **Finish the unified advisory path:** #361. Reuse existing decision/context contracts instead of
   rebuilding quota math or inferring missing budgets.
4. **Implement 19.3–19.5 sequentially:** evidenced escalation, enforced per-task budgets, then
   bounded verify/retry/stop. Keep architecture/security/critical work at its quality floor.
5. **Earn promotion:** measure marginal value of a third mechanism over the actual native/current
   baseline, validate the combined stack and run fresh-user end-to-end against a published artifact.

The historical 0.2.0 harness/provider expansion backlog remains visible in PLAN §15–16. It is
secondary to these efficiency priorities and should resume only when it closes a measured workload
gap or adds required reversible lifecycle coverage. UI polish proceeds independently and does not
satisfy empirical gates.
