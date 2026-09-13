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

## What remains before promotion

The lifecycle, activation, footprint and maturity checkpoints close real evidence gaps, but they do
not put mcptoon in `PROVIDER_ADAPTERS`. Promotion still requires independent, decision-ready
selection evidence from repeated paired workloads, combined-stack validation with RTK and
HarnessTrim, and a separate compatibility/reversibility decision for the intended promoted surface.
Additional exact harness/platform compatibility may be required before that compatibility gate can
pass.

Upstream claims or fixture-only results are never copied into user savings. A positive promotion
signal must come from Token Harness's own attributable campaign evidence while preserving quality.
