# Token Harness

**Get more useful work from your Claude Code and Codex subscription limits.**

Token Harness is a local, quota-aware efficiency layer for coding agents. It helps you understand how much subscription headroom you have left, reduce avoidable context overhead, choose a sensible task/profile, and decide when switching between Claude Code and Codex is actually supported by evidence.

It is deliberately conservative: read-only commands stay read-only, configuration changes are previewed first, unsupported combinations are refused instead of guessed, and local token savings are never presented as if they were the same thing as subscription quota.

> Current release: **v0.1.6**. See the [latest release](https://github.com/giuliastro/token-harness/releases/latest).

## Start here

If you already use **Claude Code**, **Codex**, or both, the basic setup is:

1. Install **Node.js 22.13 or newer**.
2. Open a terminal.
3. Copy and paste:

```sh
npm install --global token-harness@latest
token-harness doctor
token-harness budget
token-harness optimize
```

That is enough to get useful, read-only guidance.

If you only remember three commands, remember these:

```sh
token-harness doctor
token-harness budget
token-harness optimize
```

- `doctor` tells you what Token Harness can see and what needs attention.
- `budget` shows the subscription usage/headroom that the harness can actually prove.
- `optimize` combines quota pressure and context pressure into practical advice.

`doctor` ends with a **NEXT** section. If you are unsure what to do, run the command shown there.

### Try it without installing globally

You can run the read-only diagnosis with:

```sh
npx token-harness doctor
```

`npx` may download Token Harness into npm's cache, but it does **not** install or configure Claude Code, Codex, RTK, HarnessTrim, or another coding agent.

## What Token Harness does

Token Harness focuses on two budgets:

| Budget | What it tries to improve |
| --- | --- |
| **Subscription headroom** | Observe five-hour, weekly, model-specific, or credit-backed limits only from evidence exposed by the coding agent; pace work against reset time; avoid wasting expensive turns |
| **Model context** | Reduce unnecessary instructions, MCP/tool schemas, stale conversation history, repeated command output, and other context that gets sent back to the model |

It can help with:

- live Claude Code and Codex quota/headroom observation where reliable evidence exists;
- model/reasoning/profile recommendations for the current task;
- oversized session and context pressure detection;
- MCP/tool exposure inspection;
- local usage history and measured reducer savings;
- conservative scheduling between Claude Code and Codex;
- compact handoffs when moving an in-progress task from one harness to another;
- reviewed installation/configuration of supported optimization providers such as RTK and HarnessTrim.

## The safest way to use it

If you do **not** want Token Harness to change any configuration, stay with these commands:

```sh
token-harness doctor
token-harness budget
token-harness context
token-harness history --since 7d
token-harness optimize
```

They are read-only with respect to your coding-agent and project configuration.

A useful everyday command is:

```sh
token-harness optimize --task standard --profile balanced
```

For routine work where you want to conserve quota:

```sh
token-harness optimize --task mechanical --profile economy
```

For difficult work where quality matters more:

```sh
token-harness optimize --task hard --profile quality
```

## Let Token Harness apply supported optimizations

Token Harness separates **review** from **mutation**.

First preview the exact plan:

```sh
token-harness plan
```

Nothing is changed yet.

If the plan is supported and looks correct, apply it explicitly:

```sh
token-harness apply --yes
```

Then restart the coding agent and verify:

```sh
token-harness status
token-harness verify
```

If Token Harness says the environment is unsupported or unverifiable, do not force it. Refusing an unreviewed combination is intentional.

You can also apply the exact stored plan printed by `plan`:

```sh
token-harness apply --plan <plan-id> --yes
```

The stored plan is rejected if the project, versions, ownership, or file preconditions changed after review.

## Claude Code and Codex

You can target one harness explicitly:

```sh
token-harness budget --harness claude
token-harness optimize --harness claude --task standard --profile balanced
```

```sh
token-harness budget --harness codex
token-harness context --harness codex
token-harness optimize --harness codex --task standard --profile balanced
```

On supported recent Codex builds, Token Harness uses Codex's native app-server for rate-limit windows, effective configuration, model catalog, MCP inventory, and reviewed native-policy changes. It does not infer subscription quota from local token counts.

For Claude, live quota observation can optionally use an already-installed compatible `cclimits` build in cacheless JSON mode. Token Harness does not read `cclimits` credentials and does not install it automatically.

## Using both Claude Code and Codex

Version 0.1.6 adds a conservative cross-harness scheduler and compact handoff workflow.

Ask which harness is the better candidate for a task:

```sh
token-harness schedule \
  --current claude \
  --candidate codex \
  --task-class hard \
  --handoff-bytes 900
```

`schedule` is a recommendation, not an automatic router. It uses attributable quota and benchmark evidence where available. Missing or conflicting evidence returns `insufficient-evidence` instead of guessing.

If you decide to switch harnesses mid-task, create a compact handoff instead of copying the whole conversation:

```sh
token-harness handoff \
  --objective "Finish the current task" \
  --decision "Keep the validated architecture" \
  --changed-file src/example.ts \
  --validation "tests pass" \
  --unresolved "One edge case remains" \
  --next-action "Fix the edge case and rerun tests" \
  --max-bytes 2048 > handoff.md
```

Advanced users can benchmark cross-harness transfers with `benchmark-start`, `benchmark-finish`, `transfer`, and `transfer-record`. See `token-harness schedule --help` and the command reference below.

## What's new in v0.1.6

The current release includes, among other changes:

- stronger Codex quota recovery with a cacheless `cclimits` fallback path where appropriate;
- compatibility with recent Codex app-server behavior;
- HarnessTrim 0.2.1 support for the reviewed Codex/Linux combination;
- clearer distinction between provider ownership and integration ownership;
- detection of shadowed provider executables;
- empirical task benchmark aggregation;
- compact cross-harness handoff generation;
- conservative Claude Code ↔ Codex scheduling;
- transfer evaluation and immutable transfer evidence receipts;
- scheduler hydration from live quota and local benchmark evidence.

See the [v0.1.6 release notes](https://github.com/giuliastro/token-harness/releases/tag/v0.1.6) for the complete changelog.

## What Token Harness does not do

Token Harness does **not**:

- install Claude Code, Codex, OpenCode, Hermes, or Pi for you;
- silently reroute subscription traffic through unrelated API providers;
- equate local token reduction with subscription-quota savings;
- overwrite an unsupported or unreviewed integration because it "probably works";
- delete user-owned provider configuration;
- send your source code, prompts, raw commands, or credentials to a Token Harness service.

Install and sign in to at least one supported coding agent first, then run `token-harness doctor`.

## Optimization providers

Token Harness can detect and measure optimization providers while keeping ownership explicit.

| Provider | Main role | Current direction |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Shell-command rewriting and output reduction | Active. Managed only where a reviewed compatibility row exists |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers, skills, pipes, and harness adapters | Active. Managed only on reviewed surfaces; otherwise detected/adopted |
| [cclimits](https://github.com/cruzanstx/cclimits) | Live/local quota companion | Optional read-only companion for Claude; Codex prefers its native app-server |
| [ccusage](https://github.com/ccusage/ccusage) | Historical local usage analytics | Read-only companion for history and baselines |

Other candidates such as Lazy MCP, Context Mode, Headroom, Dejavu, repowise, routers, and generic prompt compressors are evaluated only when they improve included Claude/Codex capacity without creating overlapping ownership or unverifiable claims. See [docs/provider-landscape.md](docs/provider-landscape.md).

## Managed compatibility

Token Harness changes a harness configuration only when a reviewed compatibility row covers the exact provider version, harness version, platform, and configuration schema.

The managed rows shipped with 0.1.6 are:

| Provider | Harness | Platform | Tested versions | Tier |
| --- | --- | --- | --- | --- |
| RTK | Claude Code | Windows | RTK 0.44.0, Claude Code 2.1.220 | `canary` |
| HarnessTrim | Claude Code | Windows | HarnessTrim 0.1.0, Claude Code 2.1.220 | `config-only` |
| HarnessTrim | Codex | Windows | HarnessTrim 0.1.0, Codex 0.146.0 | `config-only` |
| HarnessTrim | Codex | Linux (non-WSL) | HarnessTrim 0.2.1, Codex 0.152.1 | `config-only` |

Other combinations can still be detected, inspected, verified, or measured where supported, but mutation is refused unless a reviewed row covers it.

The full generated matrices and known limitations are in [docs/matrices.md](docs/matrices.md).

## Updating Token Harness

Update to the newest published CLI with:

```sh
npm install --global token-harness@latest
token-harness --version
```

Then run:

```sh
token-harness doctor
token-harness budget
```

## Undoing Token Harness changes

Remove only exact integration entries owned by Token Harness:

```sh
token-harness uninstall --yes
```

Restore files from the most recent committed Token Harness transaction snapshot:

```sh
token-harness rollback --yes
```

`uninstall` is surgical and normally safer after later manual edits. `rollback` restores whole files to their pre-transaction bytes and can therefore also revert changes made to those files afterwards.

Neither command removes user-owned RTK or HarnessTrim configuration or provider executables.

## Command reference

| Command | Purpose | Changes coding-agent/project configuration? |
| --- | --- | --- |
| `doctor` | Detect agents, providers, ownership, versions, and problems | No |
| `budget` | Read live quota/headroom where reliable evidence exists | No |
| `context` | Inspect model/config, instructions, MCP exposure, and tools | No |
| `mcp` | Inspect MCP servers and tool-schema exposure | No |
| `history` | Summarize attributable local usage history | No |
| `optimize` | Turn quota/context pressure into task-specific advice | No |
| `schedule` | Recommend Claude Code or Codex from attributable evidence | No |
| `handoff` | Build a bounded compact cross-harness handoff | No |
| `plan` | Preview exact supported changes | No; stores plan state only |
| `apply` | Apply a reviewed plan transactionally | Yes, only with `--yes` |
| `status` | Detect drift and competing integrations | No |
| `verify` | Check the declared verification tier | No |
| `metrics` | Report attributable reducer savings | No agent/project config change |
| `benchmark` | Compare an explicit baseline/optimized pair | No |
| `benchmark-start` | Start an empirical task capture | No agent/project config change |
| `benchmark-finish` | Finish an empirical task capture | No agent/project config change |
| `benchmark-matrix` | Aggregate complete project-scoped benchmark pairs | No |
| `transfer` | Evaluate one cross-harness benchmark pair and handoff | No |
| `transfer-record` | Persist an immutable transfer evidence receipt | No agent/project config change |
| `update` | Query channels and update installed providers | Yes, only with `--yes` |
| `rollback` | Restore files from the latest committed transaction | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |

Every command supports `--help`.

Common filters:

```text
--harness <id>
--provider <id>
--project <directory>
--task mechanical|standard|hard|critical
--profile economy|balanced|quality|custom
--reserve <percent>
--native-policy
--plan <plan-id>
--json
```

## Privacy

Token Harness stores plans, journals, backups, receipts, import cursors, and normalized metrics locally.

Default state locations:

| Platform | State root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\TokenHarness` |
| macOS | `~/Library/Application Support/TokenHarness` |
| Linux / WSL | `${XDG_STATE_HOME:-~/.local/state}/token-harness` |

Normalized metrics do not contain raw command text, tool output, source code, prompts, credentials, or raw file paths. Provider records are read in place and only normalized event data is imported.

## Troubleshooting

### `token-harness` is not found

Check Node and the global npm installation:

```sh
node --version
npm list --global token-harness
npm prefix --global
```

Node must be at least **22.13.0**. If npm's global executable directory is not on `PATH`, add it and reopen the terminal.

### `plan` says there is nothing to do

Run:

```sh
token-harness doctor
```

Common reasons are: no supported coding agent was detected, your existing setup is already sufficient, the requested provider is adoption-only on that harness, or no reviewed compatibility row covers the requested mutation.

### `verify` reports `not-exercised`

Restart the coding agent, ask it to run a normal shell command such as `git status`, then run:

```sh
token-harness verify
```

For a `config-only` integration, no stronger external execution receipt may exist; Token Harness reports that limitation explicitly.

### `metrics` shows no data

Make sure the provider has actually processed operations in the selected project and time range. For example:

```sh
token-harness metrics --since 7d
```

An empty metrics report is a valid observation and exits successfully.

### A newer provider or coding-agent version is reported

Token Harness records versions actually exercised by the project. A newer version is handled conservatively rather than assumed compatible. Check [docs/matrices.md](docs/matrices.md) before applying changes.

## Install from source

Most users should install from npm. For development:

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
corepack enable
pnpm install
pnpm build
pnpm package
npm install --global ./dist/package
token-harness --version
```

The workspace requires Node.js 22.13+ and the pnpm version declared in `package.json`.

## Development

```sh
corepack enable
pnpm install
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm smoke
pnpm package
pnpm smoke:install
```

Before changing architecture or public behavior, read [PLAN.md](PLAN.md) and the accepted RFCs in [docs/rfcs](docs/rfcs). The CLI and JSON contract is defined by [RFC 0006](docs/rfcs/0006-cli-contract.md).

## License

Token Harness is licensed under the [Apache License 2.0](LICENSE). RTK, HarnessTrim, cclimits, ccusage, and other referenced tools are independent projects distributed under their own licenses.