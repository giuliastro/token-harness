# Token Harness

> One control plane for token-efficient coding agents.

Token Harness is an open-source orchestrator for token-saving tools used by coding
agents. It detects the active coding harness, installs compatible optimization
providers, prevents conflicting integrations, verifies that the resulting pipeline
works, and reports savings through one normalized metrics model.

Token Harness is not another compressor. It coordinates specialized projects at
different layers of the agent pipeline. This is the current integration landscape;
"candidate" means researched, not supported or installed by this release.

| System | Layer and added value | Token Harness state |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Command rewriting and shell-output reduction | **Integrated today** for Claude Code |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers, harness adapters, skills, pipes, and MCP integration | **MVP provider in progress**: detection, adoption, conflict reconciliation, and metrics |
| [Dejavu](https://github.com/Salnika/dejavu) | Emits only the delta when a command produces repeated output | Priority candidate; requires an RTK ordering fixture and native-Windows work |
| [Lazy MCP](https://github.com/voicetreelab/lazy-mcp) | Loads MCP tool schemas only when the agent needs them | Priority, largely orthogonal candidate |
| [repowise](https://github.com/repowise-dev/repowise) | Retrieves task-shaped repository context instead of repeated grep/read loops | Priority candidate; response bounds and attribution must be verified |
| [LiteLLM](https://github.com/BerriAI/litellm) | Self-hosted model gateway, fallbacks, load balancing, budgets, and usage telemetry | Routing foundation candidate; it does not by itself prove token savings |
| [RouteLLM](https://github.com/lm-sys/RouteLLM) | Routes easier requests to a cheaper model through an OpenAI-compatible endpoint | Learned-routing candidate; needs coding-agent quality benchmarks |
| [vLLM Semantic Router](https://github.com/vllm-project/semantic-router) | Routes by task, complexity, tools, and deployment locality for self-hosted inference | Alternative routing candidate for local inference fleets |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Compresses tool, MCP, file, and RAG payloads and can lower effort on routine turns | Broad-context candidate; alternative to Context Mode, with overlap tests required |
| [Context Mode](https://github.com/mksglu/context-mode) | Keeps raw tool/MCP results outside context and restores compact session memory | Broad-context candidate; alternative to Headroom, source-available under ELv2 |
| [LLMLingua](https://github.com/microsoft/LLMLingua) | Model-based prompt compression engine for long context | Engine candidate, not yet a direct harness adapter |
| [Caveman](https://github.com/JuliusBrussee/caveman) | Steers shorter visible model replies | Opt-in candidate; output savings only, with quality and prompt-overhead checks |

The evidence, licenses, conflicts, and recommended admission order are recorded in the
[provider landscape](docs/provider-landscape.md). Routing savings are reported as cost or
quality trade-offs, never silently added to exact token savings.

Upstream tools remain independent. Token Harness installs supported releases through
their official distribution channels and never silently vendors or forks them.

## Product identity

| Surface | Value |
| --- | --- |
| Product name | Token Harness |
| Repository/package slug | `token-harness` |
| CLI command | `token-harness` |
| License | Apache-2.0 |
| Runtime | Node.js 22.13.0+ |
| Language | TypeScript |
| Package manager | pnpm |

## Core principles

1. **Plan before apply.** Every mutation is represented as a reviewable plan. Dry-run
   is the default, and no flag skips planning.
2. **One owner per interception surface.** The planner prevents two providers from
   rewriting or compressing the same payload unless that exact chain is validated — and
   it keeps checking after installation, because config files keep changing.
3. **Upstreams stay upstream.** Providers wrap official installers and APIs instead
   of copying their implementations.
4. **Measured, not marketed.** Exact, estimated, and counterfactual savings are
   reported separately and never summed into one headline number.
5. **Proven, not assumed.** Verification states its tier: presence, config-only, or an
   observed canary. A configuration that looks correct is never presented as proof that
   the harness reaches the provider.
6. **Reversible by construction.** Configuration edits are marker-owned, backed up,
   journaled, and removable.
7. **Local-first.** No account or telemetry is required. Usage data stays local unless
   the user explicitly enables an upstream service.
8. **Cross-platform.** Windows, macOS, Linux, and WSL are first-class targets, with
   unsupported combinations surfaced before installation.

## Initial user experience

```text
token-harness doctor
token-harness plan
token-harness apply --yes
token-harness verify
token-harness metrics --since 7d
token-harness status
token-harness rollback --yes
```

Existing installations are adopted, not replaced. If RTK or HarnessTrim is already
configured by hand, Token Harness detects it, plans around it, and leaves it in place on
uninstall.

The first useful release will support Codex, Claude Code, and OpenCode. Today Claude Code
and RTK work end to end — see Status below for exactly which of the nine criteria are met.
HarnessTrim will be detected, adopted, reconciled against RTK's ownership, and measured, but
not installed: at its current release no configuration exists that would let both tools
reduce output without contesting the same surface, and Token Harness reports that contest
instead of hiding it.

Additional tools, and joint reduction by two providers, are introduced only after
compatibility and attribution tests prove they compose safely.

## Status

Version `0.0.5`. Per the release gates below, `0.0.x` means **no stability promise** — and
that is still the honest band, because `0.1.0` requires three harnesses and two providers
and this build has one of each. What it does have is the whole lifecycle working for that
one pair, end to end, on a real machine.

### What works today

For **Claude Code + RTK**, every command in the loop:

```text
token-harness doctor                  what is here, and what is broken
token-harness plan                    what would change; nothing is written
token-harness apply --yes             write it, inside a reversible transaction
token-harness verify                  is it actually intercepting, at which tier
token-harness metrics --since 7d      what it saved, by measurement class
token-harness status                  drift, and competing hooks on owned surfaces
token-harness uninstall --yes         remove only what Token Harness owns
token-harness rollback --yes          restore the files a transaction changed
```

On the machine this was developed against, `metrics` reports **91,600 tokens saved over
2,847 intercepted commands**, which is exactly what `rtk gain` reports independently, and
`verify` reaches tier `canary` from RTK's own dated records.

Two findings from that measurement are in the code rather than in a changelog, because both
change how a number should be read:

- **75% of RTK's interceptions save nothing.** 2,149 of 2,847 commands were proxied and
  passed through unchanged. `rtk gain` reports a 9.5% average and structurally cannot say
  this; only per-operation events can.
- **RTK sometimes makes output larger** — 240 rows, 1,957 tokens — and floors its own
  `saved_tokens` at zero per command, so its total is a sum of clamped values. Token Harness
  reports the net effect and names the inflation on its own line.

### Against the definition of the first useful release

PLAN §2 lists nine criteria for `0.1.0`. Measured honestly:

| # | Criterion | State |
| --- | --- | --- |
| 1 | `doctor` detects Codex, Claude Code, or OpenCode | Claude Code only |
| 2 | RTK and HarnessTrim: available, installed, configured, broken | RTK only |
| 3 | Dry-run plan for a compatible setup | RTK only |
| 4 | Apply that plan transactionally | **done** |
| 5 | Verify the integration, with the tier stated | **done** |
| 6 | Inspect normalized savings | RTK only |
| 7 | Uninstall or roll back without damage | **done** |
| 8 | Adopt an existing hand-configured installation | **done** for RTK |
| 9 | Windows, macOS, Linux | **done** — CI on all three, every commit |

So: the machinery is finished and the coverage is not. What `0.1.0` needs is breadth —
adapters for Codex and OpenCode, and the HarnessTrim provider — not new mechanisms.

### What is deliberately not automated

`apply` can plan an RTK installation but cannot execute one: `package-manager-install` is
not implemented, so on a machine without RTK the transaction fails on that action and rolls
back cleanly with your files untouched. Install RTK yourself and Token Harness will adopt
it, which is the path RFC 0004 §Brownfield adoption treats as normal anyway.

`update` is rejected as *unavailable* rather than as unknown, so a script can tell "not
built yet" from "you typed it wrong".

### Guarantees worth knowing before you run `apply`

- **Dry-run by default.** Without `--yes`, mutating commands display the plan and exit 8.
- **One appended entry, not a rewritten list.** Your other hooks keep their content and
  their order; a test asserts your entry is still first afterwards.
- **Every file is snapshotted first**, including files that did not exist, so a rollback can
  restore their absence. The restoration is verified by reading the files back — which is
  what separates exit 6 (rolled back) from exit 7 (did not fully restore).
- **Token Harness removes only what it recorded as its own,** and refuses when the entry no
  longer matches what it wrote. An edit of yours blocks the deletion.
- **A change you did not ask for is reported.** Editing a hand-formatted JSON file reformats
  it, and that warning reaches you rather than only the journal.
- **A competing hook on an owned surface is reported, never removed.** `status` names the
  file, the surface, and the competing command, and exits 3.

### Installing 0.0.5

The package is a single self-contained ESM artifact with **no dependencies at all**. It is
not on npm — publishing is PLAN §8.3, together with provenance, SBOM, and signing — but it
installs from a tarball you build yourself, and CI proves that on Windows, macOS, and Linux
on every commit:

```bash
pnpm install && pnpm build && pnpm package
npm install -g ./dist/package
token-harness doctor
```

To run it without installing:

```bash
node dist/bundle/token-harness.mjs doctor
```

Try it against a scratch directory first if you want to watch it work without touching your
own configuration — `--project <dir>` retargets the project-scoped half, and the state
directory is separate from anything a harness reads.

## Development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
pnpm package
pnpm smoke:install
```

`pnpm build` produces the self-contained artifact at `dist/bundle/token-harness.mjs`;
`pnpm smoke` runs it from a temporary directory outside the repository, so anything
that failed to inline shows up as a resolution failure rather than as a passing test.
CI runs all of it on `windows-latest`, `macos-latest`, and `ubuntu-latest`, in that
order and without fail-fast, because the failures this project exists to prevent are
mostly Windows-specific and finding them after two green jobs is how they become
workarounds instead of design.

## Release gates

| Version | Gate |
| --- | --- |
| `0.0.x` | Internal architecture and fixtures. No stability promise. **← here (`0.0.5`)** |
| `0.1.0` | RTK and HarnessTrim, three harnesses, transactional install, verification with declared tiers, metrics, brownfield adoption |
| `0.2.0` | A third provider, goal-based profiles, the A/B benchmark matrix |
| `1.0.0` | Stable provider and harness contracts, two release cycles with no configuration-loss defects, published benchmark results |

`PLAN.md` §16 is the authority; this table is a summary of it.

`pnpm golden` regenerates the derived halves of the golden fixtures. It never
touches the five human transcripts transcribed from RFC 0006 — see
[tests/fixtures/README.md](tests/fixtures/README.md).

CI runs Windows, macOS, and Linux, with Windows first in the matrix and the
matrix set not to fail fast.

- [Development plan](PLAN.md)
- [Foundation decisions](docs/rfcs/0001-foundation.md)
- [Provider contract](docs/rfcs/0002-provider-contract.md)
- [Capability and conflict model](docs/rfcs/0003-capabilities-and-conflicts.md)
- [Safety and installation model](docs/rfcs/0004-safety-and-installation.md)
- [Metrics and attribution](docs/rfcs/0005-metrics-and-attribution.md)
- [CLI contract](docs/rfcs/0006-cli-contract.md)
- [Live verification](docs/rfcs/0007-live-verification.md)
