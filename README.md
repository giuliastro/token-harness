# Token Harness

**Build, verify and measure an optimization stack for Claude Code and Codex.**

Token Harness runs locally. It checks your coding agents, finds compatible optimization components,
prepares reviewed changes, verifies integrations, and reports savings only when it has evidence to
support them.

It is an **optimization stack manager**, not another coding agent and not a replacement for projects
such as RTK or HarnessTrim.

## Start here

Requirements:

- Node.js 22.13 or newer;
- Claude Code or Codex installed;
- the coding agent you want to use already signed in.

Install and open Token Harness:

```sh
npm install --global token-harness@latest
token-harness
```

The browser app is the normal human interface. There is no daily command sequence to memorize.

### What to do the first time

1. Open **Monitor** and let Token Harness check the current setup.
2. Follow the **Recommended** action if one is shown.
3. Open **Actions** and choose **Set up optimizers** when setup is available.
4. Review the proposed change.
5. Choose **Apply change** only if the preview is what you want.
6. Keep using Claude Code or Codex normally.
7. Open **Results** later to see what Token Harness can actually measure.

Nothing is changed merely because you opened the app. Read-only checks stay read-only, and a
configuration change requires an explicit review and approval.

## The three views

### Monitor

Monitor answers the questions that matter first:

- is Token Harness working;
- which coding agents are available;
- which optimizations are active or available;
- what has actually been saved;
- whether quality needs attention;
- what the most useful next action is.

Implementation detail is deliberately secondary. The optimization stack and candidate catalog live
under **Technical details** instead of occupying the main workflow.

### Actions

Actions is where you ask Token Harness to do something:

- **Optimize reasoning** — choose the agent and work type, then review the recommended persistent
  reasoning preference;
- **Set up optimizers** — add or repair supported optimization components;
- **Check integrations** — verify integrations without changing them;
- **Check updates** — look for reviewed optimizer updates without installing anything automatically;
- **Undo last change** — when available, review a rollback before applying it.

A read-only operation shows that it is checking. During that phase you can cancel it. Once you
approve a mutation, the dialog switches to an explicit applying state and remains locked until that
approved write completes.

### Results

Results separates evidence from guesses. Depending on what can be measured, it can show:

- recorded optimizer output reduction;
- authoritative paired 5-hour / 7-day allowance evidence;
- API cost only when billed-token evidence and a verified price basis exist;
- paired quality evidence;
- recent checks and changes from the current app session.

**Not measured** means exactly that. Token Harness does not turn local token estimates into fake
subscription minutes or money.

## Daily use

Keep launching `claude` or `codex` as usual. Deterministic optimizers that are installed, verified
and still beneficial are intended to remain enabled.

Token Harness does **not** need to stay open, does not need a permanent background daemon, and does
not need to decide before every command whether an optimizer should run.

Open `token-harness` when you want to:

- inspect health or savings;
- review a setup change;
- verify integrations;
- check compatibility or updates;
- re-evaluate the stack after a meaningful version/configuration change.

The app does not perform periodic full reloads. A full read happens on initial open or when you
choose **Refresh**. Existing readings remain visible while a refresh runs. Applying a reviewed
change marks displayed data as previous state rather than immediately forcing another expensive full
read.

## What counts as savings

Token Harness keeps different evidence classes separate.

**Recorded output savings** are attributable reducer measurements. Providers, units and measurement
classes are not silently added together. Negative results and errors remain visible.

**5h / 7d allowance savings** require authoritative paired before/after allowance evidence. A
five-hour percentage may also be expressed as the equivalent share of that 300-minute allowance
window. Weekly quota is not converted into seven days of wall-clock compute.

**API cost** stays **Not measured yet** until attributable billed input/output tokens and a verified
model-price basis are available.

**Quality** is measured independently. A measured regression blocks a positive allowance-saving
claim rather than letting a smaller token number win by itself.

Upstream benchmark numbers are useful for deciding what to test; they are never copied directly
into your savings total.

For a terminal-only savings summary:

```sh
token-harness savings
```

Optional windows are `--since 7d` and `--since 30d`.

## Current optimization stack

Token Harness prefers thin integrations around strong specialized projects instead of copying their
algorithms into this repository.

| Component | Role | Management |
| --- | --- | --- |
| [RTK](https://github.com/rtk-ai/rtk) | Shell/tool output reduction | Supported on reviewed combinations; normally install once and leave enabled |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic output/context reduction | Supported first-party integration |
| [cclimits](https://github.com/cruzanstx/cclimits) | Optional Claude allowance evidence | Read-only evidence; not an optimizer |
| [ccusage](https://github.com/ccusage/ccusage) | Local usage history | Read-only evidence; never subscription quota |

The next savings mechanism is deliberately **not preselected**. Candidate categories include
repository retrieval/indexing, MCP schema/discovery, context/prompt minimization, broad context
management and result-side compression. A candidate is promoted only if it proves material marginal
value over the real native + current-stack baseline while preserving quality and safe rollback.

See [docs/optimizer-priorities.md](docs/optimizer-priorities.md) and
[RFC 0027](docs/rfcs/0027-optimization-stack-manager.md).

## Stable-stack operating model

The intended lifecycle is:

```text
discover -> evaluate -> recommend -> install/configure -> verify -> measure
         -> monitor -> update/re-evaluate -> rollback/uninstall
```

A healthy deterministic component should mostly be left alone. Re-evaluation is useful when:

- Claude Code, Codex or an optimizer changes version;
- configuration drift or verification failure appears;
- measured value deteriorates or quality regresses;
- workload shape changes materially;
- a credible better candidate appears;
- you explicitly request a new review.

## Reasoning optimization

**Optimize reasoning** is a reviewed persistent-preference flow, not a hidden per-task switch.

Choose one of the simple work descriptions in the app — Normal coding, Simple edits, Complex work
or Critical work — and review the exact supported setting before applying it.

A saved preference can affect future sessions and can still be overridden by another settings layer.
It is not presented as a live reading of an already-running session. Token Harness does not silently
switch model, authentication, endpoint or billing.

## Run the current source

From an existing clone:

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

This runs the clone. An unmerged branch or unpublished `main` change is not automatically available
through `token-harness@latest`.

## AI-assisted use

The browser remains the primary human interface, but this repository also includes a portable Agent
Skill at [`skills/token-harness/SKILL.md`](skills/token-harness/SKILL.md).

A compatible Claude Code or Codex skill mechanism can load it on demand. You can then ask the agent
to **use Token Harness for this task**. The skill is deliberately thin: Token Harness remains the
deterministic stack/evidence controller, and configuration changes still require a reviewed plan and
explicit approval.

The app can also preview enabling that guidance in supported user-level Agent Skills locations.
Existing custom skill directories are not silently overwritten or adopted. See
[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md).

## Advanced CLI

Most people do not need these commands. They remain available for automation, debugging and the
browser controller itself.

| Command | Purpose | Changes agent/project config? |
| --- | --- | --- |
| `doctor` | Detect harnesses, providers, versions and problems | No |
| `budget` | Read authoritative/reported allowance windows | No |
| `context` | Inspect model settings, instructions and MCP exposure | No |
| `mcp` | Focus on MCP server/tool health | No |
| `history` | Summarize local usage through an installed ccusage | No |
| `plan` | Prepare exact supported changes | No; stores local plan state |
| `apply` | Apply a reviewed stored plan | Yes, only with `--yes` |
| `verify` | Check the declared integration tier | No |
| `metrics` | Report attributable reducer savings | No |
| `status` | Report pipelines, drift and importer modes | No |
| `update` | Check/update installed providers; unreviewed targets stay installed | Yes, only with `--yes` |
| `rollback` | Restore the latest transaction snapshot | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |
| `schedule` | Compare Claude Code and Codex using available evidence | No |
| `handoff` | Build a bounded cross-harness handoff | No |
| `benchmark*`, `transfer*` | Capture and compare empirical evidence | Local state only |

Need stable machine-readable output? Add `--json`. Need the evidence behind a human summary? Add
`--verbose`.

The older automation contracts remain available. `ui --json` preserves its existing schema-1
report; `ui --read-only` opens the legacy read-only UI; `ui --no-open` starts the guided app without
launching a browser.

### Workload-aware allowance planning

If you explicitly know the remaining backlog, the advanced CLI can reason about whether that work
fits the currently observed allowance:

```sh
token-harness optimize --harness codex --task standard --tasks-left 5
token-harness schedule --current codex --candidate claude --task-class standard --tasks-left 5
```

For a mixed queued workload:

```sh
token-harness schedule --current codex --candidate claude \
  --workload mechanical=2,standard=3,hard=1
```

Token Harness does not infer remaining tasks from session length, local tokens or raw provider
percentages. If the required benchmark/allowance evidence is incomplete, capacity remains unknown.
See [RFC 0020](docs/rfcs/0020-workload-aware-allowance.md) and
[RFC 0021](docs/rfcs/0021-mixed-workload-allocation.md).

### Applying native recommendations from the CLI

`optimize` remains read-only. The explicit CLI path is still review then apply:

```sh
token-harness plan --harness claude --native-policy --task mechanical --profile economy
token-harness apply --plan <printed-plan-id> --yes
```

The browser is simpler and should be preferred for normal use.

## Safety and privacy

Token Harness is conservative by design:

- opening the app and normal read-only commands do not change agent/project configuration;
- a browser mutation requires preview and explicit **Apply change** approval;
- CLI mutations require their explicit `--yes` form;
- plans are checked again immediately before apply;
- existing files are backed up before a managed write;
- only exact Token Harness-owned entries are removed by uninstall;
- newer or untested combinations are reported rather than guessed;
- an available provider update outside reviewed compatibility is kept out rather than forced;
- the guided app binds only to `127.0.0.1` and protects local controls with Host/Origin checks, a
  per-process anti-forgery token and single-use approval tickets;
- source code, prompts, command contents, credentials and cookies are not sent to a Token Harness
  service.

Plans, receipts, metrics and backups stay in the local Token Harness state directory.

See [RFC 0013](docs/rfcs/0013-guided-local-experience.md),
[RFC 0004](docs/rfcs/0004-safety-and-installation.md), and
[RFC 0006](docs/rfcs/0006-cli-contract.md).

## Troubleshooting

### Claude allowance is unavailable

The app explains whether the optional cclimits companion is missing, too old for safe read-only
flags, cannot find Python, has no usable Claude session, reports an expired session, or returns an
unsupported source. It does not expose credentials, raw companion errors or private paths.

To inspect the same path from the terminal:

```sh
npm list --global cclimits
cclimits --claude --json --no-cache-write --no-stale-fallback
token-harness budget --harness claude --verbose
```

A missing observation is not zero remaining allowance. Never paste credentials to debug it.

### `token-harness` is not found

```sh
node --version
npm list --global token-harness
```

Node must be at least 22.13. Reopen the terminal after installation if needed.

### Setup or verification needs attention

Use the action shown in the app. For technical evidence:

```sh
token-harness doctor --verbose
token-harness verify --verbose
```

Do not force an unsupported plan. A newer version outside reviewed compatibility is normally a
safety limitation, not a reason to overwrite the known-working installation.

## Updating or undoing

Update Token Harness itself:

```sh
npm install --global token-harness@latest
```

Provider updates should normally be reviewed through **Actions → Check updates**.

Remove only Token Harness-owned integration entries:

```sh
token-harness uninstall --yes
```

Restore complete files from the latest committed transaction snapshot:

```sh
token-harness rollback --yes
```

`rollback` is whole-file time travel and can also revert later manual edits to those files. Prefer
`uninstall` when you only want to remove Token Harness-owned entries.

## Development

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

Before changing public behavior or architecture, read
[RFC 0027](docs/rfcs/0027-optimization-stack-manager.md),
[docs/optimizer-priorities.md](docs/optimizer-priorities.md),
[docs/release-readiness.md](docs/release-readiness.md), [PLAN.md](PLAN.md), and the accepted
[RFCs](docs/rfcs).

## License

[Apache License 2.0](LICENSE). Referenced provider tools are independent projects with their own
licenses.
