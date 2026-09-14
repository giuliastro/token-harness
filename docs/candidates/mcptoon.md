# mcptoon candidate integration

mcptoon remains a **candidate**, not a globally registered managed provider. Token Harness has now
reviewed several integration layers independently so progress can be stated precisely without
turning one successful checkpoint into promotion approval.

## Reviewed build

The managed lifecycle and activation witness are pinned to **mcptoon 0.7.10**. Newer versions do not
inherit this evidence automatically. The read-only `benchmark-capability` admission now follows the
same fail-closed rule: only the exact reviewed 0.7.10 build can become `benchmark-ready`; older or
future releases remain `unsupported-version` until their observation contract is reviewed again.

The reviewed lifecycle includes exact-version `pipx` installation, inventory, restore and uninstall,
brownfield-safe Claude Code/Codex instruction surfaces, passive verification, and exact RFC 0009
compatibility rows for **mcptoon 0.7.10 × Codex 0.152.1 × Linux non-WSL** and
**mcptoon 0.7.10 × Claude Code 2.1.269 × Linux non-WSL**.

## Managed lifecycle review

The formal `managed-lifecycle` promotion gate was reviewed on **2026-09-13** and passes for the
already-landed mcptoon 0.7.10 lifecycle mechanics.

The review covers:

- exact `pipx` install planning for mcptoon 0.7.10 with package inventory used as rollback data;
- prior-state restoration and uninstall through the generic transactional package lifecycle;
- a Token Harness-owned Claude Code skill and a surgical Codex `AGENTS.md` marker block;
- refusal to overwrite non-reviewed/user-owned activation surfaces;
- refusal to install the package when the corresponding activation surface cannot be owned safely;
- passive verification using version/help and the owned instruction surface, without contacting
  configured MCP servers or executing an MCP tool merely to verify setup; and
- repository tests covering clean planning, brownfield conflicts, missing `pipx`, already-present
  guidance, and passive verification.

This is intentionally a **lifecycle** pass, not a compatibility-breadth pass. It says Token Harness
has reviewed mechanics for installing, owning, verifying and reversing the candidate integration. The
second live Linux row additionally proves the exact Claude Code 2.1.269 skill surface, including drift
refusal and preservation of unrelated post-apply user changes. It does not make unrecorded
harness/OS/version combinations compatible and does not satisfy the separate
`compatibility-reversibility` or `combined-stack-validation` gates.

## Passive activation witness

Candidate attribution by itself is not proof that mcptoon was used. For an optimized mcptoon pair,
`benchmark-start` records a privacy-bounded boundary from mcptoon's own local usage record and
`benchmark-finish` seals the corresponding activation receipt.

The reviewed 0.7.10 upstream contract stores local usage in `~/.cache/mcptoon/usage.json`. Token
Harness reads that file directly instead of running a tool call, starting an MCP server, or invoking
candidate setup. It also runs only `mcptoon --version` to require the exact reviewed build.

Token Harness deliberately discards the usage record's server and tool identities. The activation
sidecar retains only the exact reviewed version, total-call boundaries, bounded call counts,
success/failure counts, timestamps needed for interval attribution, and the resulting witness state.
No MCP arguments, tool names, server names, raw results, credentials, prompts, or source code are
persisted by this witness.

A completed optimized pair is `verified` only when all of the following are true:

- mcptoon 0.7.10 is observed at both benchmark boundaries;
- the monotonic total-call counter does not move backwards;
- the counter increases during the optimized capture;
- at least one bounded usage record falls inside the benchmark start/finish interval; and
- at least one in-window call succeeded.

No calls, or only failed in-window calls, block activation for that pair. A reset, malformed data,
wrong version, missing boundary, or a counter increase whose bounded call buffer cannot place any
call inside the task interval stays `unknown` rather than being guessed as active.

### Attribution limit

The upstream usage counter is user-local rather than process-lineage scoped. Therefore the witness
proves that the exact reviewed mcptoon build performed successful local tool activity inside the
optimized benchmark window; it does not prove which operating-system process initiated that call.
The standard paired-campaign discipline and combined-stack validation remain required before a
promotion decision.

## Passive manifest footprint evidence

A second sidecar records a candidate-specific **mechanism footprint** without contacting an MCP
server. At the end of an optimized mcptoon benchmark, Token Harness reads the existing reviewed
0.7.10 cache at `~/.cache/mcptoon/schema_cache.json` and compares two representations of the same
cached tool inventory:

- the complete pretty-printed JSON schema manifest; and
- the full names-only compact index used for schema-light discovery.

The receipt persists only aggregate facts: mcptoon version, server count, tool count, JSON bytes,
compact bytes, byte reduction, reduction percentage, and oldest/newest cache timestamps. Server
names, tool names, schemas, descriptions, prompts, MCP arguments/results, credentials and source code
are discarded before the receipt is written.

This measurement is deliberately **not** added to Token Harness's token, quota, time or subscription
savings totals. It establishes how much smaller mcptoon's compact discovery representation is for the
local cached MCP inventory; it does not prove that the full JSON representation would otherwise have
entered the model context on that task. Campaign reports therefore show the latest observed snapshot
plus observed/non-observed pair counts instead of summing repeated inventory snapshots into a fake
cumulative saving.

An absent cache stays `unavailable`, malformed cache data stays `invalid`, and any build other than
exact mcptoon 0.7.10 stays `unsupported-version`. Activation evidence and repeated paired task quality
and usage evidence remain separate requirements.

## Project maturity review

The upstream project-maturity gate was explicitly reviewed on **2026-09-13**. This is project-level
evidence and is deliberately not inferred from the installed semantic version.

The review passes the gate because the inspected upstream repository is Apache-2.0 licensed, active
and non-archived; stable releases span from **v0.3.0 on 2026-08-12** through **v0.7.10 on
2026-09-12**; and recent releases document regression handling plus automated release/test
discipline. In particular, v0.7.7 records a post-release version-consistency regression and a new
regression test, v0.7.9 records an externally reported HTTP health regression with added coverage,
and v0.7.10 is a correctness release whose notes report 813 tests passed, one skipped, and clean
linting.

Those upstream test counts are upstream release evidence, not Token Harness test results. The project
is also still young — the repository was created on 2026-07-27 — so youth remains an explicit
residual risk. A material change in upstream maintenance should trigger a new project-maturity review;
this pass does not approve future mcptoon versions or widen any compatibility row.

## Real selection campaign: keep experimental

The real Codex campaign `mcptoon-real-codex` completed on **2026-09-14** against the unchanged RTK +
HarnessTrim production baseline on the exact reviewed native-Linux surface (`mcptoon 0.7.10`, Codex
`0.153.0`). It completed 8/8 pairs across mechanical, standard, hard and critical classes. All 16 task
runs passed quality on the first attempt and every completed pair had quota-backed evidence.

The evidence classes are intentionally kept separate:

- **compatibility/reversibility:** positive for the exact reviewed lifecycle tuple only; managed
  apply/deactivation remained reversible and brownfield-safe;
- **quota:** 4 pairs were equivalent, 2 optimized-better and 2 baseline-better, so there is no
  consistent quota-saving signal;
- **local usage:** unavailable/ambiguous, so there is no local-token saving claim;
- **context:** no reduction was demonstrated; 7 pairs were unchanged and one critical pair is
  `unknown` because its optimized capture changed from 155 to 165 static MCP tools during the task;
- **timing:** cumulative optimized wall clock was about 5.6% slower. This is one observed campaign
  result, not a statistical performance conclusion; and
- **activation attribution:** the passive witness did not record successful mcptoon activity inside
  the optimized task windows, so quota or timing differences are not attributable to candidate
  execution merely because the optimized variant was selected.

### Context anomaly: 155 -> 165

The first critical optimized receipt started with 155 known/static MCP tools and finished with 165.
The next critical **baseline** receipt then started at 165 and remained at 165; its optimized partner
also remained at 165. The change therefore persisted across the candidate deactivation boundary.
Token Harness's managed mcptoon lifecycle does not register another MCP server, and the snapshots keep
only bounded aggregate inventory counts rather than tool identities. The available evidence therefore
supports only **persistent Codex/MCP surface drift, not attributable to mcptoon**. It does not identify
which ten tools appeared or what external/runtime event caused the change, so no stronger cause is
recorded and the receipts remain untouched.

### Decision

The campaign is decision-ready but its selection signal is **mixed**. The reviewed decision is
**KEEP EXPERIMENTAL**. mcptoon remains candidate-only, is not added to `PROVIDER_ADAPTERS`, and is not
part of the RTK + HarnessTrim production stack. Token Harness must not claim token/quota savings,
context reduction or a timing improvement from this campaign.

## What remains before promotion

The lifecycle, footprint and maturity checkpoints close real evidence gaps, but they do not put
mcptoon in `PROVIDER_ADAPTERS`. The completed real campaign did not produce a promising selection
signal and its activation witness did not attribute successful candidate activity to the optimized
windows. A future promotion attempt would therefore need new, independently attributable evidence
before combined-stack or broader compatibility work would be justified.

Upstream claims or fixture-only results are never copied into user savings. A positive promotion
signal must come from Token Harness's own attributable campaign evidence while preserving quality.

## Token Harness-managed benchmark lifecycle

Candidate campaigns no longer require the user to install or toggle mcptoon manually. On an exact reviewed row, `token-harness apply --candidate mcptoon --harness <id> --yes` reuses the same transactional planner used by compatibility recording: it installs pinned `mcptoon==0.7.10` through an already available `pipx` when absent, adds only Token Harness-owned agent guidance, verifies the resulting activation, and rolls back automatically on a failed postcondition.

`token-harness uninstall --candidate mcptoon --harness <id> --yes` is intentionally narrower than a full package uninstall: it removes only the guidance Token Harness can prove it owns, preserving unrelated `AGENTS.md`/skill content and the reviewed binary for the next paired run. The guided campaign chains activation before optimized capture and deactivation after optimized finish, so the task window never includes installation work and the next baseline runs with mcptoon inactive.

This does **not** promote mcptoon into the production provider registry. Unreviewed platforms, harness versions, provider versions, malformed/user-owned guidance, and missing `pipx` continue to fail closed. `~/.mcptoon/config.json` and project `.mcptoon.json` remain read-only user configuration.
