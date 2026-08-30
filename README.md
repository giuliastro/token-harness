# Token Harness

Token Harness has one objective: **maximize the useful coding work you can get from Claude Code
and Codex usage limits, without hiding quality regressions or pretending that opaque subscription
quota is exactly equivalent to a token count**.

The scarce resource is no longer just model context. Subscription users are constrained by rolling
usage windows, weekly limits, model-dependent burn, long-session context growth, MCP/tool schema
overhead, noisy tool output, and repeated work after poor model or effort choices. Token Harness is
evolving from a token-reduction control plane into a **quota-aware efficiency layer** for coding
harnesses.

The product therefore optimizes two related budgets:

1. **subscription headroom** — observe the usage windows the harness itself exposes, pace work
   against reset time, and choose native model/effort settings that fit the task and remaining
   budget;
2. **context sent to the model** — keep instructions, MCP schemas, conversation history, repository
   context, and tool output as small as possible without removing information needed to finish the
   task correctly.

RTK and HarnessTrim remain useful providers, but reducers are now one layer of the system rather
than the product definition. Native harness controls come first because choosing the right model,
effort, context shape, and enabled tools can avoid an expensive turn entirely.

## What Token Harness should optimize

| Layer | Target behavior |
| --- | --- |
| Usage-window observability | Read five-hour, weekly, model-specific, or credit-backed limits only from surfaces the harness can actually prove; show reset time, headroom, and burn rate |
| Native model policy | Prefer economical models/effort for routine work, escalate only for tasks whose expected quality benefit justifies the extra quota |
| Session hygiene | Detect task boundaries, oversized conversations, and stale context; recommend clear/compact/new-session actions before history dominates each turn |
| Instruction budget | Keep `CLAUDE.md` / `AGENTS.md` concise and hierarchical instead of injecting one large global instruction file everywhere |
| MCP/tool budget | Disable irrelevant MCP servers, defer schemas where the harness supports it, and expose only the tools required by the current task |
| Tool-output budget | Reduce logs, diffs, test output, and repeated command results before they re-enter model context |
| Cross-harness scheduling | When Claude Code and Codex have independent headroom, recommend the harness that can do the task with the best expected quality per remaining quota |
| Measurement | Correlate quota delta, model/effort, context size, tool traffic, and task outcome; never convert local token savings into an unproven subscription-quota claim |

## Optimization ecosystem

The priority order below is deliberately different from the original Token Harness roadmap. A tool
is high priority only when it helps **included Claude Code/Codex capacity**, not merely API cost,
provider routing, or benchmark token counts.

| Tool or surface | Optimization layer | Token Harness direction |
| --- | --- | --- |
| **Claude Code native controls** | Usage status, model/effort choice, context inspection, clear/compact lifecycle | **P0 — build into core**. Prefer native surfaces over third-party credential scraping; discover available models dynamically |
| **Codex native app-server + profiles** | Structured rate-limit telemetry; model, reasoning effort, verbosity, tool-output and MCP/context controls | **P0 — build into core**. `account/rateLimits/read` is the preferred live quota source when available |
| [cclimits](https://github.com/cruzanstx/cclimits) | Live/local quota companion across coding tools | **P0 — optional observational companion for Claude**. Token Harness uses only cacheless Claude JSON mode, never reads its credentials, and labels the result `reported` or `cached`. Codex keeps its native app-server reader |
| [ccusage](https://github.com/ccusage/ccusage) | Local historical token/session/cost analytics for Claude Code and Codex | **P0 — high-priority read-only companion**. Useful for history and baselines; not a substitute for live subscription-limit telemetry |
| [RTK](https://github.com/rtk-ai/rtk) | Shell-command rewriting and command-output reduction | **P1 — active, keep**. Reduces context that would otherwise be resent on later turns |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers, harness adapters, skills, pipes, and MCP reduction | **P1 — active, keep**. Continue only on proven non-overlapping surfaces |
| [Lazy MCP](https://gitlab.com/gitlab-org/ai/lazy-mcp) | Load MCP tool schemas only when needed | **P1 — high priority**. Directly attacks schema/context overhead; benchmark against native Codex tool deferral before installing another owner |
| [Context Mode](https://github.com/mksglu/context-mode) | Keep raw tool/MCP results outside model context | **P2 — alternative broad context owner**. Evaluate against Headroom, not alongside overlapping reducers by default |
| [Headroom](https://github.com/headroomlabs-ai/headroom) | Compress tool, MCP, file, and RAG payloads | **P2 — alternative broad context owner**. Admit only after pair-specific quality and attribution fixtures |
| [Dejavu](https://github.com/Salnika/dejavu) | Emit only the delta when command output repeats | **P2 — useful for test/rerun loops** after the normal output-reduction path is measured |
| [repowise](https://github.com/repowise-dev/repowise) | Retrieve task-specific repository context | **P2 — conditional**. Its MCP overhead must be lower than the repository context it avoids |
| LiteLLM, Claude Code Router, RouteLLM, LLMRouter, vLLM Semantic Router | Route requests across models/providers | **P3 — overflow/API routing only**. Useful after included quota is exhausted or for explicit external-provider policy; not a core subscription-quota optimizer |
| [LLMLingua](https://github.com/microsoft/LLMLingua) | Generic prompt compression | **Research only** until a harness-aware lifecycle proves must-keep recall and quality |
| [Caveman](https://github.com/JuliusBrussee/caveman) | Reduce visible model-output verbosity | **De-prioritized**. Use native verbosity/effort controls first and measure their effect before adding another instruction owner |

Candidate status still means that Token Harness neither installs nor configures the tool until its
installation, conflicts, rollback behavior, verification, quality gates, and metrics attribution are
implemented and tested. The intake evidence lives in
[docs/provider-landscape.md](docs/provider-landscape.md).

### Why generic routers moved down

The original roadmap treated model routers as high priority. For the new objective that is backwards:
a router can reduce API cost by sending work to another provider while consuming **none of the
included Claude Code or Codex allowance**, or it can bypass subscription authentication entirely.
That can be valuable as explicit overflow, but it does not demonstrate better use of the allowance
the user already paid for.

Token Harness should first exploit the harness-native choices that are actually inside the plan:
model tier, reasoning effort, verbosity, session lifecycle, instruction size, MCP exposure, and tool
output. External routing becomes an opt-in second budget, never an invisible shortcut.

## Quick start

Install the CLI:

```sh
npm install --global token-harness
token-harness --version
```

Then run the complete workflow from the project in which you use your coding agent:

```sh
# 1. Inspect the machine. This does not change agent configuration.
token-harness doctor

# 2. Inspect subscription headroom and avoidable context. Still read-only.
token-harness budget
token-harness context
token-harness history --since 7d
token-harness optimize

# Optional: Claude live quota can use an already-installed cclimits build that
# supports --no-cache-write. Token Harness never installs it automatically.

# 3. Preview every proposed configuration change.
token-harness plan

# 4. Apply the reviewed plan. This is the first configuration-changing step.
token-harness apply --yes

# 5. Restart the coding agent, then run a normal shell command through it.

# 6. Check configuration, real interception evidence, and savings.
token-harness status
token-harness verify
token-harness metrics --since 7d
```

`doctor` ends with a `NEXT` section. If you are unsure what to do, run the command shown
there.

To try the read-only diagnosis without installing Token Harness globally:

```sh
npx token-harness doctor
```

`npx` may download Token Harness into npm's cache, but it does not install or configure RTK,
HarnessTrim, or a coding agent.

### Managed compatibility rows

Token Harness changes a harness configuration only when a reviewed compatibility row covers the
exact provider version, harness version, platform, and configuration schema. Three rows ship, and each
names the recording it stands on:

| Provider | Harness | Platform | Tested versions | Tier |
| --- | --- | --- | --- | --- |
| RTK | Claude Code | Windows | rtk 0.44.0, Claude Code 2.1.220 | `canary` |
| HarnessTrim | Claude Code | Windows | harnesstrim 0.1.0, Claude Code 2.1.220 | `config-only` |
| HarnessTrim | Codex | Windows | harnesstrim 0.1.0, Codex 0.146.0 | `config-only` |

Everything else is refused, and that is the design rather than a gap: `doctor` detects and reports on
every supported platform, and only the *mutation* is narrower. An uncovered combination exits 9 and
the diagnostic names what is missing — the reviewed fixture, or the nearest row it does have.

What is not covered today, and why:

- **macOS and Linux.** No row on either. The recordings a row needs are states of a real machine, and
  a fixture cannot be written from a machine nobody ran. On those platforms `plan` and `apply` refuse;
  install the provider with its own installer and Token Harness will detect, verify, and measure it.
- **OpenCode, and permanently rather than pending.** Both providers are detected, adopted, verified
  and measured there, and neither is written. RTK reaches OpenCode through a plugin module its own
  installer places globally, which this build has no action for. HarnessTrim's OpenCode installer
  writes a plugin wrapper *and runs an npm install*, so a containment boundary covering what it wrote
  would hold a `node_modules` tree — and that is not a decision deferred for want of a fixture. A
  dependency tree is not configuration, so it cannot be a reviewed write set; snapshotting it on
  every apply to keep the rollback honest would be slow and would be restoring upstream's install
  rather than our change; and excluding it would leave a transaction claiming a reversibility it does
  not have. So the assignment is not producible, and RFC 0003 is explicit about what that means: a
  capability the provider has but cannot be asked for is not an assignable capability. OpenCode stays
  adoption-only by decision.
- **RTK on Codex.** Not managed, and no row: RTK writes a Claude-shaped hook list and nothing else.
- **A newer Claude Code.** The range is a single observed version. `2.1.221` reads `unknown-newer` and
  refuses rather than assuming it behaves like `2.1.220`.

The recordings are under `tests/fixtures/rows/`, one directory per row, each with a README stating
which stages exist and which do not.

## How the components fit together

There are three separate layers. Installing one does not automatically provide the others.

| Layer | Examples | Who installs it? |
| --- | --- | --- |
| Coding agent (harness) | Claude Code, Codex, OpenCode, Hermes, Pi | You, using the agent's official installer |
| Token Harness | `token-harness` | You, from npm or this repository |
| Optimization provider | RTK, HarnessTrim | Both can be installed by Token Harness where a compatibility row covers the combination; otherwise install them with their own installers and Token Harness detects and measures them |

Token Harness does not install Claude Code, Codex, OpenCode, Hermes, or Pi. Install and run at least one of
them first so that `token-harness doctor` can detect it.

| Provider | Claude Code | Codex | OpenCode | Hermes | Pi | Installed by Token Harness |
| --- | --- | --- | --- | --- | --- | --- |
| RTK | Configure, verify, and measure | Not managed | Detect, adopt, verify, and measure | Not managed | Not managed | **Yes**, for the supported Claude Code path |
| HarnessTrim | Claude skills only; no reducer hook or reduce-pipe instruction | Detect, adopt, verify, and measure | Detect, adopt, verify, and measure | Detect, verify, and measure | Detect, verify, and measure | **Yes**, on a covered row — see above |

"Not managed" does not mean the upstream tool cannot support that agent. It means this release
does not claim ownership of that integration and will not modify it.

Hermes is read-only in both directions: the adapter finds the HarnessTrim plugin, reads whether it
is enabled, and imports the telemetry it writes to `~/.hermes/harnesstrim-metrics.jsonl`, but nothing
here enables the plugin or restarts the gateway. Enabling it is
`hermes plugins enable harnesstrim`, and that stays your command to run. No compatibility row ships
for Hermes because a row is the precondition for a *mutation*, and none is proposed.

Pi is read-only in both directions too: the adapter finds the HarnessTrim extension module in the
directories Pi auto-loads (`~/.pi/agent/extensions/` and `<project>/.pi/extensions/`) and verifies
the configuration, but nothing here installs it, and nothing here can say which mode it runs in —
the extension defaults to `dryrun` and only `HARNESSTRIM_MODE=active` in Pi's environment makes it
reduce. Installing it is `harnesstrim install pi --apply`, and that stays your command to run. No
compatibility row ships for Pi because a row is the precondition for a *mutation*, and none is
proposed.

RTK on OpenCode is detected and verified, not written: `rtk init -g --opencode` installs a plugin
module at `~/.config/opencode/plugins/rtk.ts`, and Token Harness reads that file rather than
producing it. Note that the plugin is inert under OpenCode Desktop — see
[docs/matrices.md](docs/matrices.md) for what was measured.

The generated compatibility tables, tested version ranges, platform coverage, and known
limitations are in [docs/matrices.md](docs/matrices.md).

## Installing each component

### 1. Install Token Harness

Recommended, from npm:

```sh
npm install --global token-harness
token-harness --help
```

If the command is not found after installation, find npm's global binary directory with:

```sh
npm prefix --global
```

Ensure that directory's executable location is on `PATH`, then open a new terminal.

#### Build and install from source

The repository uses the pnpm version declared in `package.json`.

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

`pnpm build` creates the self-contained CLI at `dist/bundle/token-harness.mjs`.
`pnpm package` creates the installable package under `dist/package`.
If `corepack` is unavailable, install the pinned package manager with
`npm install --global pnpm@10.33.4` instead.

### 2. Install or adopt RTK

When a reviewed compatibility row covers the installed versions, you normally do **not** install RTK yourself:

```sh
token-harness plan --harness claude --provider rtk
```

Once a matching compatibility row exists, if RTK is absent, the plan contains two actions:

1. install RTK through the selected package manager;
2. append one RTK entry to Claude Code's `PreToolUse` hook configuration.

The channel selected by this release is:

| Platform | Channel used by the plan | Required command on `PATH` |
| --- | --- | --- |
| Windows | WinGet package `rtk-ai.rtk` | `winget` |
| macOS | Cargo package `rtk` | `cargo` |
| Linux and WSL | Cargo package `rtk` | `cargo` |

The Cargo path in this release invokes `cargo install rtk`. That channel is declared but has not
been exercised by this project, and upstream documents a crates.io name collision. On macOS,
Linux, and WSL, the safer current route is to install RTK with an upstream-recommended method,
confirm that `rtk gain` works, and let Token Harness adopt and configure the existing binary.

Review the plan's `Network`, `Elevation`, and `Actions` sections before applying it:

```sh
token-harness apply --yes --harness claude --provider rtk
```

If RTK is already installed and configured, Token Harness adopts it instead of reinstalling or
rewriting it. User-owned configuration remains user-owned.

Important boundaries:

- Token Harness writes the reviewed hook itself; it does not run `rtk init`.
- A package install is not reversed by file rollback. `rollback` restores configuration files,
  not installed binaries.
- `uninstall` removes only integration entries written by Token Harness; it deliberately leaves
  the RTK executable installed.
- On native Windows, Claude Code exposes both Bash and PowerShell tool families. The current RTK
  matcher covers Bash only, so `doctor` can correctly report PowerShell as bypassed.

For manual installation or use outside Token Harness's managed surface, follow the
[RTK installation guide](https://github.com/rtk-ai/rtk/blob/master/INSTALL.md), then run:

```sh
rtk --version
rtk gain
token-harness doctor --provider rtk
```

`rtk gain` is an important identity check because another unrelated package also uses the name
`rtk`.

### 3. Install or adopt HarnessTrim

With HarnessTrim on `PATH`, `token-harness plan --harness claude` can install its Claude skills
without creating the competing Bash hook or reduce-pipe instruction. The invocation it delegates to
is:

```sh
harnesstrim install claude <project> --apply --no-hook --no-instructions
```

Codex and OpenCode remain adoption-only. Install those integrations with HarnessTrim's own CLI,
first as a dry run and then with its explicit apply flag. Consult the
[HarnessTrim README](https://github.com/giuliastro/HarnessTrim#quick-start) because its adapter
contents, modes, and telemetry differ by coding agent.

After installing it:

```sh
token-harness doctor --provider harnesstrim
token-harness status --provider harnesstrim
token-harness verify --provider harnesstrim
token-harness metrics --provider harnesstrim --since 7d
```

Do not configure RTK and HarnessTrim to reduce the same shell output. In the `safe` profile,
Token Harness gives that exclusive surface to RTK and treats an existing overlap as a hard
conflict instead of guessing an execution order. It never deletes the competing entry for you.

HarnessTrim telemetry is opt-in in some adapters. Without a `.harnesstrim/metrics.jsonl` file,
verification can still inspect configuration, but `metrics` has no HarnessTrim events to import.

From `0.1.0`, HarnessTrim publishes a machine-readable capability declaration: the surfaces it
intercepts per coding agent, the flags that narrow an install, and the paths each install writes.

```sh
harnesstrim capabilities
```

Detection reads that declaration and compares it against the one Token Harness records, so an
upstream change is reported rather than assumed compatible. A disagreement becomes a
`provider-capabilities-drift` warning naming both sides. A build older than the command cannot
answer; Token Harness then falls back to its own recorded declaration and reports nothing, because a
provider that cannot be asked must still be describable.

## The recommended operating workflow

### Step 1: diagnose

```sh
token-harness doctor
```

This answers:

- which supported coding agents are installed;
- which providers are installed and runnable;
- which agent configuration files exist;
- which provider is wired to which agent;
- whether Token Harness owns the integration or merely adopted it;
- whether a version, configuration file, or tool-family matcher needs attention;
- whether the installed provider's own capability declaration still agrees with the one Token
  Harness records.

Common states:

| State | Meaning |
| --- | --- |
| `not found` / `absent` | The executable and usable configuration were not detected |
| `installed` | The provider runs but is not connected to a supported agent |
| `configured` | A relevant hook or plugin entry exists |
| `broken` | Configuration refers to something missing or unreadable |
| `set up by you` | Token Harness adopted existing configuration and will not remove it |
| `set up by this tool` | A committed Token Harness transaction owns the exact entry |

`doctor` is diagnostic. An empty machine is a valid state and exits successfully.

### Step 2: review the plan

```sh
token-harness plan
```

Narrow the operation when useful:

```sh
token-harness plan --harness claude
token-harness plan --provider rtk
token-harness plan --project /path/to/project
```

Read these sections before proceeding:

- `Capability ownership`: which provider is allowed to transform each surface;
- `Excluded`: detected providers intentionally left out;
- `Actions`: every package operation and file change;
- `Network`: destinations contacted by later mutation;
- `Elevation`: whether administrator/root access would be required;
- `Backups`: how many files will be snapshotted.

`plan` does not modify agent or project configuration. It may persist the serialized plan in
Token Harness's private state directory so the exact reviewed artifact can be applied later.

If the plan prints an ID, apply that exact plan with:

```sh
token-harness apply --plan <plan-id> --yes
```

The stored plan is rejected before any action runs if the project, versions, ownership, or file
preconditions changed after review.

### Step 3: apply

```sh
token-harness apply --yes
```

Without `--yes`, `apply` shows what it would do and exits with code 8. Every affected file is
snapshotted before mutation, including the prior absence of a newly created file. A failure
triggers automatic restoration and the result states whether that restoration was verified.

After a successful apply, restart the coding agent so it reloads its hooks or plugins.

### Step 4: create real traffic

Passive verification needs evidence from an operation that actually passed through the provider.
Open the configured coding agent and ask it to run a normal shell command such as `git status` or
a test command. Then return to the terminal.

### Step 5: verify configuration and execution

Use both commands; they answer different questions:

```sh
token-harness status
token-harness verify
```

`status` compares the live environment with committed receipts. It finds drift, changed versions,
and competing entries on exclusive surfaces.

`verify` checks the strongest evidence the integration declares:

| Tier | What it proves |
| --- | --- |
| `presence` | The executable resolves and reports a version |
| `config-only` | The expected configuration entry exists |
| `canary` | Provider records show a real operation crossed the interception point |

`config-only` is not proof that the hook ran. It is the honest ceiling for integrations whose
runtime state cannot be observed externally.

`not-exercised` means no attributable operation has been observed yet. It is neither success nor
failure: run a command through the agent and check again.

### Step 6: inspect savings

```sh
token-harness metrics
token-harness metrics --since 24h
token-harness metrics --since 2026-07-01 --until 2026-08-01
token-harness metrics --provider rtk --since 7d
```

The default window is seven days. Durations such as `12h`, `7d`, and `2w`, plus ISO dates, are
accepted. Date boundaries are midnight UTC.

The report keeps measurement types and units separate:

| Report line | Interpretation |
| --- | --- |
| `Exact local` | Before and after token counts were observed for the same operation |
| `Estimated local` | The payload changed, but the reported unit or tokenizer is an estimate |
| `Counterfactual` | A dry run measured what could have changed; it is not realized saving |
| `End-to-end billed` | Comparable billed sessions were measured; otherwise it says `no A/B run` |
| `Coverage` | Share of relevant operations that were actually changed |
| `Bypassed` | Operations observed but passed through unchanged or outside coverage |

Token counts are never added to character counts, and estimated or counterfactual values are never
silently merged into an exact total.

The report covers one project: the one `--project` names, or the current directory. An operation a
provider recorded without a directory belongs to no project and is excluded, with a count reported
so the difference is reconcilable. When no project identity can be established the report says so
rather than presenting every project's events as one project's figures.

## Undoing changes

Choose the command based on what you want to undo:

```sh
# Remove only exact integration entries owned by Token Harness.
token-harness uninstall --yes

# Restore all files from the most recent committed transaction snapshot.
token-harness rollback --yes
```

`uninstall` is usually the safer choice after subsequent manual edits: it is surgical and refuses
to remove an owned entry if its content no longer matches what Token Harness wrote.

`rollback` restores whole files to their pre-transaction bytes. Changes made to those files after
the transaction are therefore also reverted. It does not restore or remove provider packages.

Neither command removes user-owned RTK or HarnessTrim configuration.

## Command reference

| Command | Purpose | Changes agent/project configuration? |
| --- | --- | --- |
| `doctor` | Detect agents, providers, ownership, and problems | No |
| `plan` | Resolve ownership and preview exact actions | No; stores the plan in private state |
| `apply` | Apply a plan transactionally | Yes, only with `--yes` |
| `status` | Detect drift and competing hooks | No |
| `verify` | Check the declared verification tier | No |
| `metrics` | Import provider records and report savings | No; updates only Token Harness state |
| `update` | Query channels and update installed providers | Yes, only with `--yes` |
| `rollback` | Restore files from the latest committed transaction | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |

Every command supports `--help`. Common filters are:

```text
--harness claude|codex|opencode
--provider rtk|harnesstrim
--project <directory>
--json
```

## Automation and JSON output

Use `--json` in scripts:

```sh
token-harness doctor --json
token-harness verify --json
token-harness metrics --since 7d --json
```

stdout contains exactly one JSON document with this top-level contract:

```json
{
  "schemaVersion": 1,
  "command": "verify",
  "toolVersion": "0.1.0",
  "status": "ok",
  "exitCode": 0,
  "data": {},
  "diagnostics": []
}
```

Important exit codes:

| Code | Meaning |
| ---: | --- |
| 0 | Completed with nothing actionable |
| 2 | Invalid command or argument |
| 3 | A read-only check found an actionable problem |
| 4 | A capability conflict blocks the plan |
| 5 | The environment drifted from the stored plan or journal |
| 6 | Mutation failed and rollback was verified |
| 7 | Mutation failed and state was not fully restored; inspect the named paths |
| 8 | The command needs explicit confirmation (`--yes`) |
| 9 | Unsupported or unverifiable environment |

Do not treat every non-zero code as the same failure. In particular, code 8 is the expected result
of previewing a mutating command without approval.

## State, backups, and privacy

Token Harness stores plans, journals, backups, receipts, import cursors, and normalized metrics
outside the repository:

| Platform | Default state root |
| --- | --- |
| Windows | `%LOCALAPPDATA%\TokenHarness` |
| macOS | `~/Library/Application Support/TokenHarness` |
| Linux and WSL | `${XDG_STATE_HOME:-~/.local/state}/token-harness` |

Normalized metrics do not contain raw command text, tool output, source code, prompts, credentials,
or raw file paths. Provider records are read in place; Token Harness imports only normalized event
data.

## Troubleshooting

### `token-harness` is not found

Confirm Node and the global npm installation:

```sh
node --version
npm list --global token-harness
npm prefix --global
```

Node must be at least 22.13.0. Add npm's global executable directory to `PATH`, then reopen the
terminal.

### `plan` says there is nothing to do

Run `token-harness doctor`. The usual causes are:

- no supported coding agent was detected;
- the requested provider does not claim that coding agent in this release;
- an existing user-managed integration already satisfies the target state;
- the safe profile excluded an overlapping provider.

RTK is written only for Claude Code in 0.1.0. It claims OpenCode too, but the plan builder appends
a `hooks` entry, which is Claude Code's schema — OpenCode's integration is a plugin module, so an
OpenCode scope produces no action and the existing installation is adopted instead. A Codex-only
machine produces no RTK action at all.

### The plan is blocked by `exclusive-scope-contested`

RTK and HarnessTrim both claim the same reducing surface. Token Harness will not choose an order or
overwrite either configuration. Remove or disable one integration using the tool that owns it, then
run `doctor` and `plan` again.

### `verify` reports `not-exercised`

Restart the coding agent, ask it to run a shell command through the configured tool family, then
run `token-harness verify` again. For a `config-only` integration, no stronger external receipt may
exist; the output states that limitation explicitly.

### `metrics` shows no data

Check all of the following:

- the provider has processed at least one operation in the requested time window;
- `rtk gain` works for RTK;
- HarnessTrim telemetry is enabled and `.harnesstrim/metrics.jsonl` exists for the project;
- `--project` points to the project whose records you expect;
- `--since` is not excluding older events.

An empty metrics report exits 0 because it is a valid observation, not a command failure.

### `doctor` or `status` reports `provider-capabilities-drift`

The installed provider's own capability declaration no longer agrees with the one Token Harness
records. The warning names both sides: what the recorded declaration claims, and what the installed
build reported. Nothing is modified, and the recorded declaration still drives planning.

Three disagreements are reported:

- a coding agent that Token Harness records a capability on is missing from the build's declaration;
- the reduction surface Token Harness records is absent from the surfaces the build reports;
- the build no longer covers a reviewed write-set path, or declares a path outside the reviewed
  containment boundary.

The last one matters most before a delegated install. Rollback restores the reviewed boundary, so a
path outside it would survive a rollback. Re-review the write set at the installed version, or hold
at the reviewed one.

### A newer provider or agent version is reported

The tested ranges record versions actually exercised by this project. A newer version is reported
and handled conservatively rather than assumed compatible. Check [docs/matrices.md](docs/matrices.md)
and the upstream release notes before applying configuration changes.

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

Tests use temporary homes and fake process runners; they do not install third-party tools.
`pnpm smoke` runs the bundle from outside the workspace, and `pnpm smoke:install` validates the
packed npm artifact.

Before changing architecture or public behavior, read [PLAN.md](PLAN.md) and the accepted RFCs in
[docs/rfcs](docs/rfcs). The CLI and JSON contract is defined by
[RFC 0006](docs/rfcs/0006-cli-contract.md).

## License

Token Harness is licensed under the [Apache License 2.0](LICENSE). RTK and HarnessTrim are
independent upstream projects distributed under their own licenses.
