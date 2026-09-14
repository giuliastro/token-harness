# Development status

Current focus: close the mcptoon real-selection checkpoint, then move to the next candidate without changing the production stack.

- Current release: `0.1.11`; release PR #275 merged after full Ubuntu, macOS and Windows CI.
- Managed production stack remains RTK + HarnessTrim.
- mcptoon, GitNexus and Headroom remain candidates; none is promoted by this checkpoint.
- mcptoon evidence is pinned to the exact reviewed 0.7.10 build and includes benchmark capability, managed lifecycle, passive activation, privacy-bounded cached-schema manifest footprint evidence, project maturity, and exact Linux compatibility rows for the reviewed Codex and Claude Code versions.
- The manifest-footprint reader is fail-closed on receipt shape, exact version, aggregate arithmetic and timestamp ordering; the campaign exposes only the latest cached-schema snapshot rather than cumulative savings.
- mcptoon selection campaigns now fail closed outside the exact reviewed native-Linux rows: Codex 0.152.1, Codex 0.153.0, or Claude Code 2.1.269. The Codex 0.153.0 point has its own real Ubuntu compatibility/reversibility recording; it is not a widened semver range. Optimized starts additionally require mcptoon 0.7.10; Windows, macOS, WSL, different harness versions and other harness families cannot create selection evidence.
- 2026-09-14: real Codex campaign `mcptoon-real-codex` completed all 8/8 pairs with quota-backed evidence, 16/16 quality passes, one attempt per task, and no inconclusive/incomparable pair. Selection was mixed: 4 equivalent pairs, 2 optimized wins and 2 baseline wins. The campaign is decision-ready but not promising.
- Quota evidence shows no consistent saving signal. Local token usage stayed unavailable, so no local-token claim is made.
- Context evidence shows no demonstrated reduction: 7 pairs were stable and 1 critical pair is unknown because the optimized capture changed from 155 to 165 static MCP tools during the task. The following critical baseline started at 165 and stayed there, so the persisted surface drift is not attributable to mcptoon from the available receipts. The exact source of the ten additional tools is not recoverable from the privacy-bounded snapshots.
- Timing evidence is observational only: optimized wall clock was about 5.6% slower cumulatively in this campaign. This is not a statistical conclusion.
- Compatibility/reversibility evidence remains positive only for the exact reviewed tuple/lifecycle. Separately, the campaign activation witness recorded no successful mcptoon activity inside the optimized task windows, so the observed quota/timing differences cannot be attributed to candidate execution.
- Decision: **KEEP EXPERIMENTAL**. mcptoon stays out of `PROVIDER_ADAPTERS` and out of the RTK + HarnessTrim production stack. Do not claim token, quota, context or timing savings from this campaign.
- Next work: evaluate GitNexus versus Headroom and open only the minimum candidate-only lifecycle needed for the better measurable/reversible option.

- 2026-09-13: mcptoon candidate campaigns now have a Token Harness-managed transactional lifecycle on exact reviewed rows. `apply --candidate mcptoon` can install the pinned 0.7.10 build through existing pipx and activate owned guidance; `uninstall --candidate mcptoon` surgically deactivates only owned guidance between paired runs. mcptoon remains candidate-only and is not in `PROVIDER_ADAPTERS`.
