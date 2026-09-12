# Token Harness

**Build, verify and measure an optimization stack for Claude Code and Codex.**

Token Harness is a local **optimization stack manager**. It checks your coding agents, manages the
optimization components it can safely own, keeps experimental candidates separate, verifies the
result, and reports savings only when it has evidence to support them.

It is not another coding agent and it does not replace specialized projects such as RTK or
HarnessTrim.

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

That is the normal human workflow. The browser app is the primary interface; there is no daily list
of CLI commands to memorize.

### First run

1. Open **Dashboard** and let Token Harness inspect the current setup.
2. If setup is incomplete, choose **Open setup**.
3. In **Setup**, work from top to bottom:
   - Coding agents
   - Managed optimizers
   - Experimental tools
   - Optional agent tuning
   - Checks and maintenance
4. For Claude Code or Codex, choose **Review setup** when a managed setup is available.
5. Read the exact proposed changes. **Apply reviewed setup** appears only when there is a concrete
   safe plan to apply.
6. Keep using Claude Code or Codex normally.
7. Open **Results** when you want to see what Token Harness can actually prove.

Opening the app does not change your configuration. Read-only checks stay read-only, and a managed
write requires an explicit review and approval.

## The three views

### Dashboard

Dashboard answers the questions that matter first:

- is my setup ready;
- which coding agents and managed optimizers are active;
- what should I do next;
- what value has actually been measured;
- whether quality or an integration needs attention.

The headline cards deliberately distinguish measured evidence from unknown values. Missing evidence
is never shown as zero savings.

### Setup

Setup is one ordered workflow instead of a collection of unrelated actions.

**1. Coding agents**

Token Harness currently supports guided setup for Claude Code and Codex. Agent details also show
useful read-only allowance and connected-tool observations when available.

**2. Managed optimizers**

The managed stack currently consists of **RTK + HarnessTrim** on reviewed combinations. Token
Harness can prepare their integration transactionally, show the exact plan, apply it only after
approval, verify it, and remove only configuration it owns.

**3. Experimental tools**

Headroom, mcptoon and GitNexus are visible as candidates, not silently promoted dependencies. Their
cards distinguish CLI installation, candidate-side activation/evaluation, Token Harness benchmark
evidence and promotion-readiness gates. External install or activation commands are shown for
review; Token Harness does not silently execute package managers, activate wrappers, index
repositories or register MCP servers.

Choose **Run standard evaluation** to start or resume a paired candidate campaign. Campaign state is
scoped to both the candidate and the selected harness, so Claude Code and Codex evidence cannot be
mixed accidentally. The browser reads the campaign directly and shows **Progress**, the current
selection signal, whether the evidence is **Decision ready**, the number of evidence-bearing pairs
and the exact **Next** step.

For normal use, the browser can now start and finish the local benchmark capture itself. You still
run the actual task in Claude Code or Codex. When the task finishes, record the quality result,
attempt count and failed-attempt count you actually observed. Before an optimized capture, Token
Harness requires you to acknowledge that you enabled the candidate through its own documented
workflow. That acknowledgement is **not activation verification** and is never treated as promotion
evidence. Every browser capture action is matched against the campaign engine's current step before
it can write local benchmark state, so a stale tab cannot advance a different step.

`benchmark-matrix`, `benchmark-start` and `benchmark-finish` remain available as advanced terminal
fallbacks for debugging or automation. The browser does not run the coding task, install or activate
a candidate, or claim that candidate attribution proves activation.

A campaign selection assessment can report `insufficient-evidence`, `promising`, `mixed` or
`negative`, plus whether the evidence is decision-ready. **Decision-ready is not promotion-ready.**
Activation verification, managed lifecycle, compatibility/reversibility, project maturity and
combined-stack validation remain separate gates.

**4. Optional agent tuning**

Reasoning preferences are separate from optimizer installation. They are persistent agent settings,
not hidden per-task switches, and are changed only through the normal preview/apply flow.

**5. Checks and maintenance**

Read-only integration checks, update checks and safe removal/undo controls live here. An update
outside reviewed compatibility is not forced.

### Results

Results keeps evidence separate from estimates. Depending on what is actually observable, it can
show:

- recorded optimizer output reduction;
- authoritative paired 5-hour / 7-day allowance evidence;
- API cost only when billed-token evidence and a verified price basis exist;
- paired quality evidence;
- experimental candidate evidence and campaign selection assessment when available;
- recent checks and changes from the current local app session.

**Not measured** means exactly that. Token Harness does not turn local token estimates into fake
subscription minutes, money or quota savings.

## Daily use

Keep launching `claude` or `codex` as usual. Deterministic optimizers that are installed, verified
and still beneficial are intended to remain enabled.

Token Harness does **not** need to stay open, does not need a permanent background daemon, and does
not need to decide before every command whether an optimizer should run.

Open `token-harness` when you want to inspect health/results, review a setup change, check an update,
verify integrations or re-evaluate the stack after a meaningful version/configuration change.

The app does not periodically reload the whole setup. A full read happens on initial open or when you
choose **Refresh**. Existing readings remain visible while a refresh runs. Applying a reviewed change
marks the displayed data as previous state instead of immediately launching another expensive full
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

Upstream benchmark numbers are useful for deciding what to test; they are never copied directly into
your savings total.

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
| [RTK](https://github.com/rtk-ai/rtk) | Shell/tool output reduction | Managed on reviewed combinations |
| [HarnessTrim](https://github.com/giuliastro/HarnessTrim) | Deterministic output/context reduction | Managed first-party integration |
| [cclimits](https://github.com/cruzanstx/cclimits) | Optional Claude allowance evidence | Read-only evidence; not an optimizer |
| [ccusage](https://github.com/ccusage/ccusage) | Local usage history | Read-only evidence; never subscription quota |

Current experimental candidates include Headroom, mcptoon and GitNexus. Detection or a promising
benchmark is not enough for promotion. Their campaign assessment is structured evidence for the
selection gate, not an activation or promotion decision. A candidate must pass structured promotion
readiness across benchmark capability, category fit, selection evidence, real activation
verification, managed lifecycle, compatibility/reversibility, project maturity and combined-stack
validation. Broader context owners also require an explicit admission decision.

See [docs/optimizer-priorities.md](docs/optimizer-priorities.md) and
[RFC 0027](docs/rfcs/0027-optimization-stack-manager.md).

## Stable-stack operating model

The intended lifecycle is:

```text
discover -> evaluate -> recommend -> install/configure -> verify -> measure
         -> monitor -> update/re-evaluate -> rollback/uninstall
```

A healthy deterministic component should mostly be left alone. Re-evaluation is useful when an
agent/optimizer changes version, configuration drift appears, measured value deteriorates, quality
regresses, workload shape changes materially, or a credible better candidate appears.

## Use Token Harness with an AI agent

The browser remains the primary human interface, but the repository also includes a portable Agent
Skill at [`skills/token-harness/SKILL.md`](skills/token-harness/SKILL.md).

If you prefer, you can ask Claude Code or Codex to help with installation and inspection. For
example:

```text
Install the latest Token Harness, open it, inspect my coding-agent setup, and explain any proposed
change before applying it. Do not apply configuration changes without my approval.
```

The skill is deliberately thin: Token Harness remains the deterministic stack/evidence controller.
The AI does not bypass preview, compatibility checks or explicit approval.

The app can also preview enabling that guidance in supported user-level Agent Skills locations.
Existing custom skill directories are not silently overwritten or adopted. See
[RFC 0023](docs/rfcs/0023-guided-agent-skill-install.md).

## Advanced CLI

Most people do not need these commands. They remain available for automation, debugging and the
browser controller itself.

| Command | Purpose | Changes agent/project config? |
| --- | --- | --- |
| `doctor` | Detect agents, providers, versions and problems | No |
| `budget` | Read authoritative/reported allowance windows | No |
| `context` | Inspect model settings, instructions and MCP exposure | No |
| `mcp` | Focus on MCP server/tool health | No |
| `history` | Summarize local usage through an installed ccusage | No |
| `plan` | Prepare exact supported changes | No; stores local plan state |
| `apply` | Apply a reviewed stored plan | Yes, only with `--yes` |
| `verify` | Check the declared integration tier | No |
| `metrics` | Report attributable reducer savings | No |
| `status` | Report pipelines, drift and importer modes | No |
| `update` | Check/update reviewed providers | Yes, only with `--yes` |
| `rollback` | Restore the latest transaction snapshot | Yes, only with `--yes` |
| `uninstall` | Remove owned integration entries | Yes, only with `--yes` |
| `schedule` | Compare Claude Code and Codex using available evidence | No |
| `handoff` | Build a bounded cross-agent handoff | No |
| `benchmark*`, `transfer*` | Capture and compare empirical evidence | Local state only |

Need stable machine-readable output? Add `--json`. Need the evidence behind a human summary? Add
`--verbose`.

The older automation contracts remain available. `ui --json` preserves its existing schema-1
report; `ui --read-only` opens the legacy read-only UI; `ui --no-open` starts the guided app without
launching a browser.

### Evaluating an experimental candidate

For normal use, open **Setup -> Experimental tools** and choose **Run standard evaluation**. The app
keeps a resumable campaign ID for each candidate/harness pair and reads campaign progress, assessment
and the exact **Next** step directly in the browser. Use **Start baseline capture** or **Start optimized
capture**, run the requested task in the selected coding agent, then choose **Record outcome** and
enter the quality/attempt values you actually observed. Normal use no longer requires copying
`benchmark-start` or `benchmark-finish` commands into a terminal.

The equivalent advanced CLI flow starts by asking the campaign engine for its current state:

```sh
token-harness benchmark-matrix \
  --benchmark-id gitnexus-codex-eval-1 \
  --candidate gitnexus \
  --harness codex
```

Follow only the **Next** command printed by that report, complete the task honestly, then rerun the
same `benchmark-matrix` command. Before an optimized run, enable the candidate through its own
documented workflow. Token Harness records the experiment target but does not treat attribution—or
the browser acknowledgement—as proof that the candidate was active.

The selection assessment can become decision-ready after enough evidence across task classes, but it
still cannot promote a candidate by itself. The remaining lifecycle and combined-stack gates must be
satisfied separately.

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

`optimize` remains read-only. The explicit CLI path is review then apply:

```sh
token-harness plan --harness claude --native-policy --task mechanical --profile economy
token-harness apply --plan <printed-plan-id> --yes
```

For normal use, prefer the browser workflow.

## Safety and privacy

Token Harness is conservative by design:

- opening the app and normal read-only commands do not change agent/project configuration;
- a browser configuration mutation requires preview and explicit approval;
- guided candidate capture buttons write only bounded local benchmark state, are CSRF-protected and
  must still match the campaign engine's current step immediately before the write;
- a browser activation acknowledgement is never treated as verified candidate activation;
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

## Updating, checking and undoing

Update Token Harness itself:

```sh
npm install --global token-harness@latest
```

Provider checks and reviewed updates are in **Setup -> Checks and maintenance**.

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

## Troubleshooting

### Claude allowance is unavailable

The app explains whether the optional cclimits companion is missing, too old for safe read-only
flags, cannot find Python, has no usable Claude session, reports an expired session, or returns an
unsupported source. It does not expose credentials, raw companion errors or private paths.

For the same technical evidence in the terminal:

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

Use the action shown in Dashboard or Setup. For technical evidence:

```sh
token-harness doctor --verbose
token-harness verify --verbose
```

Do not force an unsupported plan. A newer version outside reviewed compatibility is normally a
safety limitation, not a reason to overwrite the known-working installation.

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