# Token Harness

> Set up and measure token-saving tools for coding agents.

## Install

```bash
npm install -g token-harness
```

That installs **Token Harness itself**, and nothing else. It does not change your coding agents and
does not install any token-saving tool. Those are the next step, and they only happen when you ask.

To skip installing entirely, put `npx` in front of any command below.

## Use it

Four commands, in this order. Only step 3 writes anything.

### 1. See what you have

```bash
token-harness doctor
```

```text
HARNESSES      STATE       CONFIG FILE
  claude       hooks       ~/.claude/settings.json
  codex        no hooks    ~/.codex/config.toml
  opencode     not found

PROVIDERS      VERSION   WIRED TO      SET UP BY
  rtk          0.42.0    claude        you
  harnesstrim  —         not installed —

NEXT
  token-harness plan  see what would change — writes nothing
```

| Column | Meaning |
| --- | --- |
| `HARNESSES` | Your coding agents. `hooks` = something is hooked into it. `no hooks` = installed, nothing hooked in. `not found` = not on this machine. |
| `PROVIDERS` | The tools that save tokens. `WIRED TO` is which agents they are hooked into. |
| `SET UP BY` | `you` if you configured it yourself, `this tool` if Token Harness did. It never removes what it did not write. |

Every run ends with a `NEXT` block naming the command to type. Follow that if you read nothing else.

### 2. See what would change

```bash
token-harness plan
```

Lists every file it would touch, every action, and any conflict between two tools wanting the same
output. Writes nothing. Read it before step 3.

### 3. Make the change

```bash
token-harness apply --yes
```

The only command here that writes. Without `--yes` it prints the plan and stops. Every file is backed
up first, so `token-harness rollback --yes` puts them back.

### 4. Check it works, and what it saved

```bash
token-harness verify
token-harness metrics --since 7d
```

`verify` answers whether the hooks actually run — configured and never used is a distinct answer, not
a pass. `metrics` reports what was saved and how it was measured.

## Questions you will have at this point

**I already configured RTK by hand. Will this break it?** No. `doctor` shows it as `SET UP BY you`,
`plan` adopts it instead of reinstalling, and `uninstall` leaves it alone.

**Do I need RTK or HarnessTrim installed first?** No. If neither is present, `plan` includes
installing one through its normal channel and tells you which, before you approve anything.

**What if I just want to look?** `doctor`, `plan`, `status`, `verify` and `metrics` never write. You
can stop after any of them.

**Something said "newer than tested".** A note, not an error. Nothing is blocked; Token Harness just
stays conservative about a version it has not been tested against.

**How do I undo it?** `token-harness rollback --yes` restores the files from before the last change.
`token-harness uninstall --yes` removes only what Token Harness itself set up.

## What it coordinates

Token Harness is not another compressor. It coordinates specialized projects at different layers of
the agent pipeline. This is the current landscape; **"candidate" means researched, not supported and
not installed by this release.**

| System | Layer and added value | Token Harness state |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Command rewriting and shell-output reduction | **Shipped**: detected, installed, wired, verified, measured |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers, harness adapters, skills, pipes, and MCP integration | **Shipped**: detected, adopted, reconciled against RTK, measured — never installed, see below |
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

## Why HarnessTrim is adopted but never installed

`0.1.0` supports Claude Code, Codex, and OpenCode. RTK is managed end to end: detected, installed,
wired, verified, measured. HarnessTrim is detected, adopted, reconciled against RTK's ownership, and
measured — but **not installed**, and the reason is a measured property rather than a preference.

At its current release, no configuration of HarnessTrim exists that would let both tools reduce the
same command output without contesting the same surface: its Claude and Codex adapters match shell
commands only, and its OpenCode plugin reduces every tool result. Reducing an already-reduced payload
loses signal and counts the saving twice. So Token Harness reports the contest instead of hiding it,
and leaves your HarnessTrim exactly as you configured it.

Additional tools, and joint reduction by two providers, are introduced only after compatibility and
attribution tests prove they compose safely.

## Status

**Version `0.1.0`.** PLAN §16 defines that number as: RTK and HarnessTrim, three harnesses,
transactional install, verification with declared tiers, metrics, and brownfield adoption. All
of it is here, and a test refuses the version string unless the registries and the command
surface actually back it.

### The nine criteria

PLAN §2 lists what makes `0.1.0` useful. Measured, not estimated:

| # | Criterion | State |
| --- | --- | --- |
| 1 | `doctor` detects Codex, Claude Code, or OpenCode | **done** — all three |
| 2 | RTK and HarnessTrim: available, installed, configured, broken | **done** |
| 3 | Dry-run plan for a compatible setup | **done** |
| 4 | Apply that plan transactionally | **done** |
| 5 | Verify the integration, with the tier stated | **done** |
| 6 | Inspect normalized savings | **done** — both providers |
| 7 | Uninstall or roll back without damage | **done** |
| 8 | Adopt an existing hand-configured installation | **done** — both providers |
| 9 | Windows, macOS, Linux | **done** — CI on all three, every commit |

### What it looks like on a real machine

A snapshot from the development machine on 2026-08-01. The figures move every time RTK runs; the
relationships between them are the part that matters.

```text
$ token-harness doctor
Token Harness 0.1.0 — Windows 11 Pro (x64), Node 24.13.1

Harnesses
  claude      configured  ~/.claude/settings.json
  codex       configured  ~/.codex/config.toml
  opencode    detected    ~/.config/opencode/opencode.jsonc

Providers
  rtk           configured    0.42.0  configured for claude (adopted, not managed)
  harnesstrim   configured    0.0.6   configured for codex (adopted, not managed)

1 problem found. Fix it before running `token-harness plan`.
```

That one problem is not a broken install. It is that no configured matcher covers Claude Code's
PowerShell tool family, so commands routed through it bypass the pipeline entirely — measured, not
inferred. An "all clear" there would have been the more comfortable lie.

```text
$ token-harness verify
No receipt — verifying the live configuration

rtk — claude — adopted, not managed — declared tier: canary
  pass           executable-resolves        rtk 0.42.0
  pass           hook-registered            wired to claude
  pass           canary-intercepted         592 commands intercepted on 2026-08-01
harnesstrim — codex — adopted, not managed — declared tier: config-only
  pass           executable-resolves        harnesstrim 0.0.6
  pass           hook-registered            wired to codex
  not-exercised  canary-intercepted         no telemetry file exists, so no interception has been recorded
```

That last line is the point of the whole verification model: the hook is correctly configured, and
it has never run. RFC 0007 exists because "configured" and "working" are different claims, and
`not-exercised` is neither a pass nor a failure.

### The figures reconcile with the provider's own, and where they differ they say why

```text
$ token-harness metrics --since 2020-01-01
Exact local            1,429,689 -> 1,216,007 tokens    saved 213,682
  rtk            saved 213,682 tokens   exact-local      1,361 operations

Coverage 33%. Bypassed 2,741. Errors 0. Added median latency not measured.
365 operations made the payload larger; the figures above are net of that.
```

`rtk gain` independently reports **4,102 commands** and **217.1K tokens saved** over the same
history. Two of those agree exactly and one does not, and both facts are load-bearing:

- **The operation count matches to the command.** 1,361 intercepted plus 2,741 bypassed is 4,102, and
  the input and output totals match as well. Nothing is being double-counted or dropped.
- **The saved figure is lower by about 3,400 tokens, on purpose.** RTK floors its own per-command
  saving at zero, so its total is a sum of clamped values. Some operations genuinely make the payload
  *larger*, and Token Harness reports the net effect and prints the inflated count beside it. A
  higher number was available and would have been wrong.

Coverage of 33% is the honest reading of the same data: two thirds of intercepted commands were
passed through unchanged. That is what a token-saving tool actually does on a real workload, and it
is the figure a report designed to flatter would have left out.

### The full command surface

```text
token-harness doctor                  what is here, and what is broken
token-harness plan                    what would change; nothing is written
token-harness apply --yes             write it, inside a reversible transaction
token-harness verify                  is it actually intercepting, at which tier
token-harness metrics --since 7d      what it saved, by measurement class
token-harness status                  drift, and competing hooks on owned surfaces
token-harness uninstall --yes         remove only what Token Harness owns
token-harness rollback --yes          restore the files a transaction changed
token-harness update                  what a newer version would be, per channel
```

That is all nine commands RFC 0001 declares. `update` was the last one missing.

It asks each provider's own installation channel what version it offers and compares that with
what is installed — the installed side comes from the provider, the available side from the
channel, because `winget` knows what exists for `rtk-ai.rtk` and RTK's adapter does not. Reaching
the channel is a network read and it happens on a dry run too, since a target version cannot be
named without asking, so the destinations are reported.

It updates and nothing else. A provider that is not installed is left alone, a channel offering
something older is not acted on, and a channel that cannot be read produces *unknown* rather than
the far more comfortable *up to date*. A pinned provider is skipped and its pin is named; a pin
written inside a repository is reported and not honored, because a repository may not choose which
version of a tool you run.

And the honest limit, printed rather than implied: an updated package is not restored by a
rollback. Rollback restores files, and a package is not a file.

### Guarantees worth knowing before you run `apply`

- **Dry-run by default.** Without `--yes`, mutating commands display the plan and exit 8.
- **One appended entry, not a rewritten list.** Your other hooks keep their content and their
  order; a test asserts your entry is still first afterwards.
- **Every file is snapshotted first**, including files that did not exist, so a rollback can
  restore their absence. The restoration is verified by reading the files back — which is what
  separates exit 6 (rolled back) from exit 7 (did not fully restore).
- **Token Harness removes only what a committed journal records as its own.** Not what merely
  looks like its own: an entry whose bytes match what it would have written is still yours if
  it did not write it, and `uninstall` says so and declines.
- **A change you did not ask for is reported.** Editing a hand-formatted JSON file reformats
  it, and that warning reaches you rather than only the journal.
- **A competing hook on an owned surface is reported, never removed.** `status` names the file,
  the surface, and the competing command, and exits 3.

### What is honest about the limits

- **HarnessTrim is never installed**, by design rather than omission. RFC 0003 §Resolution at
  0.1.0 checked its installer at `0.0.5` and found no configuration that lets it and RTK reduce
  output without contesting the same surface. So it is detected, adopted, reconciled, and
  measured — and left alone. Under `profile: custom` you may hand it the scope instead of RTK.
- **An installed package cannot be rolled back.** `apply` can now run a package manager, but a
  package is not a file and there is no snapshot of one, so a later failure restores your files and
  leaves the package installed. The report says so rather than letting "rolled back" imply the
  machine is as it was. Elevation is refused outright, with the exact command to run yourself.
- **A provider that cannot report its version is still adopted.** Older HarnessTrim builds reject
  `--version`; Token Harness asks, falls back, and reports the tool as installed with no version
  rather than as missing. It never reads the reachable `package.json`, which names the monorepo
  rather than the CLI.
- **Codex hooks cannot be proven to run.** Enablement and trust are persisted separately from
  `hooks.json`, in state no adapter can read, so Codex tops out at `config-only` and says why.
- **Two measurement findings that change how a number reads.** 75% of RTK's interceptions save
  nothing, and RTK sometimes makes output *larger* while flooring its own counter at zero — so
  its total is a sum of clamped values. Token Harness reports the net effect and names the
  inflation separately.

### What actually gets installed

On npm as [`token-harness`](https://www.npmjs.com/package/token-harness) — one self-contained ESM
file with **no dependencies at all**. Installing it adds a single package and resolves nothing,
because the whole workspace is inlined and no third-party code is in the artifact.

`npx token-harness doctor` runs it without installing anything.

The tarball carries a CycloneDX SBOM alongside the bundle. CI packs it, installs it with no
workspace above it, and runs the result on Windows, macOS, and Linux on every commit — because a
bundle that runs is not the same as a package that installs.

To build and install it from source instead:

```bash
pnpm install && pnpm build && pnpm package
npm install -g ./dist/package
```

Every read-only command is safe to run first. `doctor`, `plan`, `status`, `verify` and
`metrics` never touch a harness configuration, and `--project <dir>` retargets the
project-scoped half if you want to watch it work against a scratch directory.

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
| `0.0.x` | Internal architecture and fixtures. No stability promise. |
| `0.1.0` | RTK and HarnessTrim, three harnesses, transactional install, verification with declared tiers, metrics, brownfield adoption **← here** |
| `0.2.0` | A third provider, goal-based profiles, the A/B benchmark matrix |
| `1.0.0` | Stable provider and harness contracts, two release cycles with no configuration-loss defects, published benchmark results |

`PLAN.md` §16 is the authority; this table is a summary of it.

`pnpm golden` regenerates the derived halves of the golden fixtures. It never
touches the five human transcripts transcribed from RFC 0006 — see
[tests/fixtures/README.md](tests/fixtures/README.md).

CI runs Windows, macOS, and Linux, with Windows first in the matrix and the
matrix set not to fail fast.

Releases publish on a `v*` tag, with provenance, and a tag that does not match the staged version is
refused before the publish rather than discovered by whoever installs it. The workflow authenticates
with an `NPM_TOKEN` secret — a stopgap, and `.github/workflows/release.yml` says why at the top:
trusted publishing needs an account-level configuration this account cannot currently perform.

- [Compatibility, verification tiers, and known limitations](docs/matrices.md) — the tables are
  generated from the manifests and a test fails if they drift; the limitations below them are prose,
  and a test checks that every limitation the code declares appears there
- [Development plan](PLAN.md)
- [Foundation decisions](docs/rfcs/0001-foundation.md)
- [Provider contract](docs/rfcs/0002-provider-contract.md)
- [Capability and conflict model](docs/rfcs/0003-capabilities-and-conflicts.md)
- [Safety and installation model](docs/rfcs/0004-safety-and-installation.md)
- [Metrics and attribution](docs/rfcs/0005-metrics-and-attribution.md)
- [CLI contract](docs/rfcs/0006-cli-contract.md)
- [Live verification](docs/rfcs/0007-live-verification.md)
