# Token Harness

**Make Claude Code and Codex easier to understand and use efficiently.**

Token Harness checks your coding agents, shows subscription allowance when it can be
observed reliably, reduces avoidable context overhead, and recommends useful actions.
It runs locally and never presents local token estimates as subscription quota.

## Open it. Approve setup. Keep coding.

You need [Node.js 22.13 or newer](https://nodejs.org/) and an installed, signed-in
Claude Code or Codex. Install Token Harness, then open it:

```sh
npm install --global token-harness@latest
token-harness
```

The browser is now the primary interface. **Review setup** checks both agents and
prepares the supported integration changes. It describes each change in plain language.
Choose **Approve and apply** to apply the reviewed configuration with backups and verification.
There are no plan IDs to copy and no daily command sequence to remember.

Already configured? The app shows your existing integrations without replacing them.
An absent provider or an unreviewed version combination is explained rather than installed
or forced silently. Automatic setup covers the reviewed integration paths, not every possible
provider/version. Token Harness does not install Claude Code or Codex or log you in.

### Daily use

Continue launching `claude` or `codex` as usual. Supported output integrations operate in the
agent, not in the dashboard. You can close the page and its terminal without disabling those
integrations. Open `token-harness` whenever you want to inspect the current state or results.

The app **does not perform periodic full dashboard reloads**. A full read happens on initial open
or when you choose **Refresh data**. Existing readings remain visible while a refresh runs, and
period views reuse cached evidence where possible. Applying a reviewed setting marks the displayed
configuration as previous state instead of immediately re-reading everything again.

**Recorded savings** shows retained history across locally recorded projects, with date bounds,
provider, measurement class, units, changed-output counts, and before/after values. It does not
add incompatible provider figures together. Negative results remain visible. Missing telemetry is
shown as **not measured**, never a reassuring zero or an invented subscription saving.
Some provider records may predate Token Harness; locally stored records are not guaranteed
complete lifetime history. RTK history is imported directly. HarnessTrim project-local records
must have been imported from their project, or exposed through a configured known metrics path;
the app does not crawl your disk looking for private projects.

For a terminal-only summary, the one command is:

```sh
token-harness savings
```

Optional windows are `--since 7d` and `--since 30d`. The advanced `metrics` command remains
project-scoped; opening the app from its installation folder does not change the savings scope.

### Find what you need

The app has three primary views:

- **Dashboard** — what is saving resources, what has actually been measured, current allowance,
  quality evidence, and the single most useful next action;
- **Policies** — what is active, what can be enabled, why it matters, and the trade-off before a
  change;
- **Evidence** — recorded reductions, allowance/quality evidence, integration checks and guarded
  undo.

Theme follows your system; the header also offers light and dark modes.

Each policy shows what was actually **observed**, separately from how it works. Actions sit
next to the relevant state: **Adjust reasoning** opens the supported review/apply flow;
**Change in Claude/Codex** explains native steps when an automatic write is not available.
Missing allowance data and measurement records have their own setup/help actions.

A saved Claude effort can be displayed even on an unreviewed CLI version. That does not
admit automatic writes on that version. **No saved preference** means the user field is
absent, not that reasoning is disabled. A failed read is a separate state with a cause.
The displayed preference is not a live reading of an already-running session.

### The policies are visible

**Policies** explains each configured rule: what it does, why it is used,
its mode, and the evidence available. Automatic integrations, persistent preferences,
observations and features that are not enabled are explicitly distinguished.

RTK's supported command integration can reduce output automatically. HarnessTrim can use
adapters or skills/instructions, depending on the installation; skills-only is not a transparent
hook, and the agent must actually use the reducer. Configured never means every command was
intercepted. Provider telemetry and its exact/estimated classification remain separate evidence.

**Optional: match reasoning to your work** lets you choose the agent and the type of work
without learning CLI flags. It previews the actual supported effort/verbosity change, then
applies only after approval. **This is a persistent preference for future sessions, not an
automatic per-task switch.** It does not switch models, billing, login, or hook trust. The
baseline automatic setup never guesses a task or quietly lowers reasoning.

**Check integrations** performs the existing integration checks from the Evidence view.
**Undo last change**, available after an application in that dashboard session, previews a
whole-file backup restoration. It refuses to undo a newer unrelated transaction. It restores
only the last successful agent transaction; manual edits to those same files after that
transaction would also be restored, as the confirmation explains.

### Run the current source

From an existing clone, after installing its dependencies, one command builds and opens the app:

```sh
npm start
```

For a fresh clone:

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
npx --yes pnpm@10.33.4 install --frozen-lockfile
npm start
```

This uses the clone, not an older global installation. An unmerged branch or unpublished main
change is not automatically available through `token-harness@latest`.

### Advanced and AI-assisted use

The long CLI flag combinations are **not** the normal human interface. They are the controller API
used by the app, automation, and optionally by a coding harness. Humans can keep using the browser
and the two entry points above.

For in-session use, this repository now includes a portable Agent Skill at
[`skills/token-harness/SKILL.md`](skills/token-harness/SKILL.md). A compatible Claude Code or Codex
skill mechanism can load it on demand, after which you can simply ask the harness to **use Token
Harness for this task**. The skill classifies substantial work conservatively, calls the existing
local `--json` optimizer at meaningful task boundaries, and can use explicit workload scheduling
when you have actually supplied a backlog. It does not run Token Harness before every tool call.

The skill is deliberately thin: Token Harness remains the deterministic policy engine. No MCP
server, background model, persistent agent, or second quota formula is added just to make this work.
Local tokens are still not subscription quota, and raw Claude/Codex percentages are still not a
common currency.

Agent use is read-only by default. If Token Harness recommends a persistent model, reasoning, or
verbosity change, the harness must first build a reviewed plan, explain the exact proposed mutation,
and wait for your explicit approval before `apply`. A saved preference may affect future sessions;
it is not silently presented as a live change to the current session.

The guided app can preview **Enable in-session guidance** for each detected Claude Code or
Codex installation. It installs the same portable skill into the agent's documented user-level
Agent Skills directory through the normal transactional plan/apply path. The agent card then shows
the live guidance state: **Enabled** when the exact skill is currently owned by Token Harness,
**Enabled externally** for a byte-identical user-owned skill, or an explicit not-enabled,
custom/conflict, or unavailable state. Existing `token-harness` skill directories are never
overwritten or silently adopted, and matching bytes alone never create an ownership claim. The
browser remains fully usable without any skill or second AI subscription. See
[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md) for the install and ownership boundary.

### Measure context savings

Paired task benchmarks can report context exposure separately from quality, local tokens, and
subscription allowance. Capture baseline and optimized variants with the existing benchmark workflow,
then inspect one pair or the current-project matrix:

```sh
token-harness benchmark --baseline baseline.json --optimized optimized.json
token-harness benchmark-matrix
```

When both variants pass quality and each context surface stays stable from task start to finish, the
report can show evidence such as **Context: reduced — static MCP tools 62 → 5**. Truncated MCP
inventory, unknown tool counts, missing observations, or mid-task context drift produce **unknown**
instead of a saving claim. Context reduction is context-shape evidence only; it is never converted
into Claude/Codex subscription quota.

The Dashboard can additionally project authoritative paired benchmark evidence into understandable
outcomes: a five-hour saving can be shown as both a percentage and its equivalent share of the
300-minute window; weekly quota remains a percentage because it is not seven days of wall-clock
compute. Positive allowance savings are not credited when paired quality evidence is missing or
shows a regression. API money remains **not measured** until billed input/output tokens and a
verified model-price basis exist.

This evidence is also the admission gate for experimental context optimizers such as mcptoon,
Headroom and other candidates. Upstream benchmark numbers are never copied directly into a user's
savings total.

The older automation contracts remain available: `setup`, `optimize`, `plan`, `apply`,
`verify`, `metrics`, `rollback`, and their JSON reports. `ui --json` preserves its existing
schema-1 report; `ui --read-only` opens the legacy read-only dashboard. `ui --no-open` starts
the guided app without launching a browser. Stop either local server with Ctrl+C. See
[RFC 0022](docs/rfcs/0022-agent-native-skill.md) for the agent-facing safety boundary.

## What normal output looks like

A healthy final check is intentionally short:

```text
TOKEN HARNESS - READY

WHAT WORKS
  Codex: configured (0.146.0)
  HarnessTrim: active on Codex

CHANGES
  Nothing changed.

NEXT STEP
  Use your coding agent normally; configured optimizers run automatically.
```

A newer-than-tested combination is not presented as if the whole setup were broken:

```text
TOKEN HARNESS - READY WITH LIMITATIONS

WHAT WORKS
  Claude Code: configured
  RTK: active on Claude Code

NEXT STEP
  token-harness verify
  You can keep working; verify the active integrations when convenient.
```

Need the evidence behind a summary? Add `--verbose`:

```sh
token-harness doctor --verbose
```

Need stable machine-readable output for automation? Add `--json`:

```sh
token-harness doctor --json
token-harness ui --json
```

`--json` keeps the complete schema-1 result and diagnostics; it is not shortened.

## Two entry points to remember

`token-harness` opens the application. `token-harness savings` prints recorded results.
The advanced commands below are implementation tools, not a required user workflow.

## Safety and privacy

Token Harness is conservative by design:

- normal read-only commands do not change coding-agent or project configuration;
- `setup --yes`, `apply --yes`, `update --yes`, `rollback --yes`, and
  `uninstall --yes` are the explicit CLI configuration-changing forms; the guided UI uses
  a reviewed preview and explicit **Approve and apply** instead;
- plans are checked again immediately before they are applied;
- existing files are backed up before a managed write;
- only exact Token Harness-owned entries are removed by `uninstall`;
- newer or untested combinations are reported, not guessed;
- an available provider update outside reviewed compatibility is kept out rather than
  forced, and the installed working version stays in place;
- the guided app binds only to 127.0.0.1 and protects its fixed local controls with exact
  Host/Origin checks, a per-process anti-forgery token and single-use approval tickets;
- the legacy read-only dashboard and external status seam remain read-only;
- source code, prompts, command contents, credentials, and cookies are not sent to a
  Token Harness service.

Plans, receipts, metrics, and backups stay in the local Token Harness state directory.
See [RFC 0013](docs/rfcs/0013-guided-local-experience.md) for the local browser trust boundary,
[RFC 0004](docs/rfcs/0004-safety-and-installation.md) for the execution model and
[RFC 0006](docs/rfcs/0006-cli-contract.md) for CLI/JSON guarantees.

## Optimization and evidence tools

Integration priority is based on **marginal useful-work savings**, quality risk, attribution,
coverage and reversibility — not on the biggest upstream marketing percentage. The baseline is the
current native Claude Code/Codex behavior plus the optimizers already active for that user.

| Priority | Tool / policy | Purpose | Current status |
| --- | --- | --- | --- |
| **P0** | **Native adaptive reasoning / verbosity policy** | Avoid overspending thinking/output on simple work while protecting difficult tasks | Supported foundation; next evidence-backed policy expansion |
| P0 | [RTK](https://github.com/rtk-ai/rtk) | Shell-command rewriting and output reduction | Supported for reviewed combinations |
| P0 | [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic reducers and harness adapters | Supported for reviewed combinations |
| **P1 research** | **Repository-exploration reduction** — [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp), [CodeGraph](https://github.com/colbymchenry/codegraph), native baseline | Reduce repeated grep/read/discovery work before it enters context | Highest-priority external mechanism class to compare; no winner selected |
| **P1 conditional** | **MCP discovery/schema reduction** — native Tool Search/deferred tools, [mcptoon](https://github.com/activeing123/mcptoon), [mcp-compressor](https://github.com/atlassian-labs/mcp-compressor) | Reduce static MCP schema exposure | mcptoon detection is read-only; no external MCP optimizer selected until it beats the installed native baseline |
| P2 research | [Headroom](https://github.com/headroomlabs-ai/headroom) / Context Mode-class owners | Broad context ownership, virtualization or compression | Admission-gated; high overlap/complexity |
| P2 research | Result-side encoders/compressors | Reduce MCP/tool result payload | Must beat RTK/HarnessTrim on marginal quality-safe value; no default stacking |
| P0 evidence | [cclimits](https://github.com/cruzanstx/cclimits) | Optional live/local quota companion | Read-only; never installed automatically |
| P0 evidence | [ccusage](https://github.com/ccusage/ccusage) | Local usage history | Read-only; never installed automatically |

mcptoon is therefore **a candidate, not the chosen third integration**. Its read-only detection is
useful, but modern harnesses can already defer/search MCP tools; Token Harness must measure the
remaining tax in the actual harness/model/provider before an external MCP layer can be recommended.
The same benchmark set should compare alternative implementations such as mcp-compressor rather
than privileging whichever project was evaluated first.

Repository exploration is currently the more interesting external mechanism class because it
attacks a distinct cost: repeated code discovery and file reads before output reducers can help.
Graph/index approaches still have to prove exact source correctness, quality, startup/indexing cost,
long-session residual context and provider-level savings under Token Harness-controlled paired tests.

The third mechanism required before broad promotion is intentionally **not named in advance**. It can
be the native adaptive policy, a repository-exploration optimizer, an MCP optimizer, or a later
candidate — whichever wins on measured marginal quality-safe value.

See [docs/optimizer-priorities.md](docs/optimizer-priorities.md) for the evaluation criteria,
capability-ownership rule and promotion gate.

A provider you installed yourself remains yours. Token Harness can adopt observable
configuration without claiming ownership of the executable.

Exact reviewed provider/harness/platform/version combinations are generated in
[docs/matrices.md](docs/matrices.md). A combination outside that table can still be
detected and inspected, but Token Harness will not mutate it.

## Advanced commands

Most people do not need this section. Run `token-harness <command> --help` for details.

| Command | Purpose | Changes agent/project config? |
| --- | --- | --- |
| `doctor` | Detect harnesses, providers, versions, and problems | No |
| `budget` | Read authoritative/reported allowance windows | No |
| `context` | Inspect model settings, instructions, and MCP exposure | No |
| `mcp` | Focus on MCP server/tool health | No |
| `history` | Summarize local usage through an installed ccusage | No |
| `plan` | Prepare exact supported changes | No; stores local plan state |
| `apply` | Apply a reviewed stored plan | Yes, only with `--yes` |
| `verify` | Check the declared integration tier | No |
| `metrics` | Report attributable reducer savings | No |
| `status` | Report pipelines, drift, and importer modes | No |
| `update` | Check/update installed providers; unreviewed targets stay installed | Yes, only with `--yes` |
| `rollback` | Restore the latest transaction snapshot | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |
| `schedule` | Compare Claude Code and Codex using available evidence | No |
| `handoff` | Build a bounded cross-harness handoff | No |
| `benchmark*`, `transfer*` | Capture and compare empirical evidence | Local state only |

## Workload-aware allowance planning

If you know how many accepted tasks remain, the advanced CLI can ask whether that backlog fits the
**currently observed** included allowance:

```sh
token-harness optimize --harness codex --task standard --tasks-left 5
token-harness schedule --current codex --candidate claude --task-class standard --tasks-left 5
```

`--tasks-left` is explicit workload intent for a backlog of one task class. Token Harness does not
infer it from `ccusage`, local tokens, session length, or raw provider percentages. A workload-driven
recommendation requires complete project-local benchmark evidence for the exact model + reasoning
effort + verbosity policy in both the five-hour and weekly windows. If that evidence is incomplete,
capacity stays unknown.

When evidence proves that the current policy cannot cover the stated backlog, `optimize` protects
capacity instead of spending a quota-derived effort bonus and reports whether the five-hour,
weekly, or both windows are limiting. `schedule` can use the same target to consider the other
harness, but only when that candidate has enough conservative accepted-task capacity and passes the
existing quality, pace, availability, and transfer checks.

### Mixed task-class backlog

For queued **new tasks** spanning more than one class, give `schedule` the mix explicitly:

```sh
token-harness schedule --current codex --candidate claude \
  --workload mechanical=2,standard=3,hard=1
```

Mixed mode does not sum per-class task capacities as if they were separate quota buckets. It charges
each proposed task's project-local p75 cost against the same shared five-hour and weekly allowance
of that harness, then returns `stay`, `split`, `switch`, `shortfall`, or
`insufficient-evidence`. Candidate assignments require at least three coherent quality-gated
observations for the exact task class plus complete five-hour and weekly capacity evidence.
Unproven work remains visibly unallocated.

This mode is for queued/new tasks, not an in-progress handoff. Therefore `--workload` is mutually
exclusive with `--task-class`, `--tasks-left`, manual pace/quality flags, and handoff/transfer
flags. The allocator is deterministic and conservative; it does not claim globally optimal routing,
launch either harness, or compare raw Claude and Codex percentages.

No capacity after a future reset is assumed. Re-run the observation after the reset rather than
treating a forecast as provider quota. See [RFC 0020](docs/rfcs/0020-workload-aware-allowance.md)
and [RFC 0021](docs/rfcs/0021-mixed-workload-allocation.md).

## Applying native recommendations

`optimize` remains read-only. Review a plan before applying a supported native change:

```sh
token-harness plan --harness claude --native-policy --task mechanical --profile economy
token-harness apply --plan <printed-plan-id> --yes
```

`apply --plan <id>` restores the reviewed harness/provider selection automatically; you
should not have to repeat `--harness`, `--provider`, `--native-policy`, `--task` or `--profile`.
Run it from the same project as `plan`. Conflicting explicit selectors are rejected, and
actual version, ownership and configuration changes still invalidate the plan. Existing
schema-1 plans remain usable; only their approved actions can execute.

The first Claude path supports the **persisted user effort preference** on the reviewed
Claude Code 2.1.261 build. It does not change model, authentication, hooks, endpoint or billing.
`max` is never persisted. Project/local/ancestor settings, custom configuration roots and
known environment/thinking overrides block the change rather than being overwritten. The
preference affects future sessions unless overridden: reopen Claude and check `/effort`.
This is not evidence of a running session's effective effort or a guaranteed quota saving.

For Codex, the same plan/apply flow manages the existing reviewed reasoning-effort and
verbosity fields through native `config/batchWrite`; project/profile overrides remain yours.
`rollback --yes` restores the complete pre-change files. `uninstall --yes` removes only owned
changes and restores a prior Claude effort preference without undoing unrelated later edits.

## Troubleshooting

### Claude allowance is unavailable

The dashboard explains whether the optional companion is missing, lacks the safe CLI
flags, cannot find Python, has no usable Claude session, reports an expired session, or returns
an unsupported source. It does not expose credentials, raw companion errors or private paths.

As observed on **September 5, 2026**, npm `cclimits@1.7.0` includes the merged Claude
zero-configuration support and the read-only flags. The latest GitHub Release listing is older
and is not evidence of what npm ships. To check the same path Token Harness uses:

```sh
npm list --global cclimits
cclimits --claude --json --no-cache-write --no-stale-fallback
token-harness budget --harness claude --verbose
```

An explicit optional installation/update is `npm install --global cclimits@1.7.0`.
Token Harness does not install it automatically or retry without its read-only flags.
A fresh local Claude cache is shown as **cached**, never promoted to live quota pacing.
A missing observation is not zero remaining allowance. Never paste credentials to debug it.

### Codex is configured but its hook does not run

`token-harness verify --harness codex --verbose` reads native `hooks/list` where the
installed app-server exposes it. Disabled, untrusted and modified hooks are distinguished from
an unavailable observation. Trust must still be granted explicitly in Codex. Enabled/trusted
metadata does not prove interception, reduction, or task quality; the integration remains
`config-only` until attributable runtime evidence exists.

### `token-harness` is not found

Check that Node is new enough and the package is installed:

```sh
node --version
npm list --global token-harness
```

Node must be at least 22.13. Reopen the terminal after installation if needed.

### Setup needs attention

Run the single command it prints. For technical evidence:

```sh
token-harness doctor --verbose
```

Do not force an unsupported plan. Open an issue with the redacted `--json` result if
you believe the combination should be supported.

### `update` finds a newer version but keeps the installed one

That is normally a safety decision, not a failed installation. Token Harness found a
newer provider release but does not yet have reviewed compatibility evidence for the
active provider × harness × platform combination. Keep using the installed version; no
manual upgrade is required.

### Verification says `not-exercised`

Restart the coding agent, use it for one normal command, and run:

```sh
token-harness verify
```

No observed operation is different from a failed integration, so Token Harness reports
the two states separately.

## Updating or undoing

Update the CLI:

```sh
npm install --global token-harness@latest
token-harness setup
```

Remove only Token Harness-owned integration entries:

```sh
token-harness uninstall --yes
```

Restore complete files from the latest committed transaction snapshot:

```sh
token-harness rollback --yes
```

`rollback` is whole-file time travel, so it can also revert later manual edits to those
files. Prefer `uninstall` when you only want to remove Token Harness-owned entries.

## Develop from source

```sh
git clone https://github.com/giuliastro/token-harness.git
cd token-harness
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

Read [PLAN.md](PLAN.md), [docs/optimizer-priorities.md](docs/optimizer-priorities.md), and the
accepted [RFCs](docs/rfcs) before changing public behavior or architecture.

## License

[Apache License 2.0](LICENSE). Referenced provider tools are independent projects with
their own licenses.

### Loading, impact and sharing

The dashboard shows animated, named checks while it reads your setup. Agent cards and saved
reduction records appear as they are ready; a slow allowance check does not hide the results.
Refreshing keeps previous readings visible until newer ones arrive. Errors and waiting are
explicit, and reduced-motion preferences disable animation without removing status text.

A result can say **"65% less tool output"**, with its source, before/after values and count
of recorded changed outputs immediately beside it. An estimate says **"Estimated"**. This
percentage describes only those recorded outputs, not your whole coding session, subscription
allowance or money. Provider rows remain separate; negative results and errors remain visible.

Choose **Share result** to preview the exact summary and a locally generated image. **Open X
draft** prepares a short post. **Open Reddit** prepares a title/link; copy the summary into a
text post and choose a community yourself. **Copy for Discord** prepares a message to paste
in your chosen channel. **Save image** creates a PNG you can attach yourself. Nothing is
posted or uploaded automatically, and sharing excludes private paths, code, prompts and
account/allowance information. An open share preview stays fixed even if readings update.
