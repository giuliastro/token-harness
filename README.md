# Token Harness

**Build, verify and measure an optimization stack for Claude Code and Codex.**

Token Harness is a local **optimization stack manager**. It checks your coding agents, manages the
optimization components it can safely own, keeps evaluation evidence separate from managed lifecycle,
verifies the result, and reports savings only when it has evidence to support them.

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

The first screen is **Overview**. There is no separate Setup page to learn.

1. Token Harness detects Claude Code and Codex.
2. Each detected coding agent says either **Ready** or **Setup incomplete**.
3. If setup is incomplete, use the **Optimizer connections** matrix. It shows every optimizer against
   every detected agent and lets you select one harness or both in the same review. The recommended
   **RTK + HarnessTrim** baseline has its own action in that matrix and shows the exact safe plan
   before anything changes.
4. Optional optimizers (mcptoon, GitNexus and Headroom) use the same matrix and per-optimizer action;
   there is no repeated setup button under each coding-agent card.
5. **Health and updates** is maintenance, not another onboarding checklist. Normal setup performs its
   own safety checks. Use **Re-check health** for troubleshooting and **Check for updates** when you
   want to inspect provider versions. If a reviewed update is available, the same dialog offers
   **Install updates** after showing the versions.
6. Keep using Claude Code or Codex normally. Open **Results** when you want detailed evidence.

Opening the app does not change your configuration. A configuration or software change is always
previewed first and requires an explicit review and approval.

## The two views

### Overview

Overview is both the first-run screen and the normal status screen. It keeps the two product entities
separate:

- **Coding agents** — currently Claude Code and Codex. Detection only means Token Harness can see the
  agent; first-run setup is complete for that agent only when both RTK and HarnessTrim are connected.
- **Optimizers** — RTK and HarnessTrim are the recommended baseline. mcptoon, GitNexus and Headroom
  are optional reviewed integrations with narrower prerequisites and compatibility boundaries.

The status at the top always answers what to do next. States such as **Setup incomplete**,
**Installed · not connected**, **Needs attention**, or **Update available** have their action beside
the affected agent or optimizer instead of in a separate action list.

Overview also contains a compact **Measured impact** summary. Missing evidence is shown as unknown,
never as zero savings.

Advanced agent details and reasoning preferences are collapsed because they are not required for
first-run optimizer setup.

### Optimizer lifecycle and evidence

The recommended baseline remains **RTK + HarnessTrim** on individually reviewed combinations.
Token Harness also exposes **mcptoon**, **GitNexus** and **Headroom** as optional managed integrations
on exact reviewed lifecycle rows. Enabling an optional optimizer does not make it part of the
production baseline and does not create a savings claim.

Token Harness can prepare supported integration changes transactionally, show the exact plan, apply
it only after approval, verify what the declared tier can verify, and remove only configuration it
owns. GitNexus is never auto-indexed and its noncommercial license boundary stays visible. Headroom
remains config-only managed on its reviewed row; Token Harness does not bootstrap uv/Python or start
wrapper/proxy/deploy flows.

For maintainers, `token-harness stack-review --json` captures the exact configured provider versions
and managed harness sets for combined-stack review. Runtime evidence is credited only when it can be
attributed to the relevant harness; missing attribution remains unavailable rather than being copied
across rows.

Evaluation campaigns are an advanced maintainer workflow, not a novice setup step. Normal managed
setup stays in the unified **Optimization Stack** and historical candidate evidence never turns into
a savings, compatibility or promotion claim by itself.

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
| mcptoon | MCP discovery / compact manifest guidance | Optional managed integration on exact reviewed 0.7.10 rows; no savings assumed |
| GitNexus | Repository graph / MCP context | Optional managed Claude/Codex integration for reviewed 1.6.12; license review required |
| Headroom | Local MCP context compression/retrieval | Optional config-only managed Claude/Codex integration for already-installed 0.37.0; package prerequisite stays user-owned |
| [cclimits](https://github.com/cruzanstx/cclimits) | Optional Claude allowance evidence | Read-only evidence; not an optimizer |
| [ccusage](https://github.com/ccusage/ccusage) | Local usage history | Read-only evidence; never subscription quota |

Provider compatibility is deliberately **not pinned forever to the first fixture version**. The
current compatibility policy includes RTK **0.49.0** (source-contract reviewed; the latest live
Windows harness-mutation fixture is 0.48.0) and HarnessTrim **0.3.0**. Newer HarnessTrim builds can
be accepted without another hard-coded version bump when their executable version matches their
machine-readable `capabilities` version and the semantic surface/write-set comparison reports no
drift.

Provider **package updates are separate from harness configuration writes**. `token-harness update`
can replace a reviewed provider target without requiring an exact historical Claude/Codex fixture
for that package version; exact compatibility rows still gate any later managed agent-config
mutation. HarnessTrim updates use its reviewed npm channel and capture the previous global version
for rollback. On native Windows RTK still prefers WinGet, but when that catalog is behind the
reviewed 0.49.0 target Token Harness can fall back to the exact official GitHub Windows x64 release:
it verifies GitHub's published SHA-256, replaces only the uniquely resolved `rtk.exe`, verifies the
new version, and restores and re-verifies the previous bytes on failure. This package-only fallback
does not widen RFC 0009 or grant permission to mutate agent configuration.

RTK has no equivalent machine-readable capability endpoint, so releases newer than the explicitly
reviewed RTK set remain visible as `unknown-newer` until their consumed contract is checked. See
[docs/provider-version-compatibility.md](docs/provider-version-compatibility.md).

Historical evaluation evidence remains available for mcptoon, GitNexus and Headroom. Detection or a promising
benchmark is not enough for a production-stack promotion or savings claim. Their campaign assessment is structured evidence for the
selection gate, not an activation or promotion decision. A candidate must pass structured promotion
readiness across benchmark capability, category fit, selection evidence, real activation
verification, managed lifecycle, compatibility/reversibility, project maturity and combined-stack
validation. Broader context owners also require an explicit admission decision.

See [docs/optimizer-priorities.md](docs/optimizer-priorities.md) and
[RFC 0027](docs/rfcs/0027-optimization-stack-manager.md) and
[RFC 0028](docs/rfcs/0028-smart-model-routing.md).

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
| `routing` | Export a shadow-first CCR rule or inspect routing decisions | No |
| `status` | Report pipelines, drift and importer modes | No |
| `update` | Check/update reviewed provider packages | Yes, only with `--yes` |
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

### Evaluation evidence (advanced / maintainers)

Evaluation campaigns are an advanced maintainer workflow; managed setup stays in the unified **Optimization Stack**. The app
keeps a resumable campaign ID for each candidate/harness pair and reads campaign progress, assessment
and the exact **Next** step directly in the browser. Use **Start baseline capture** or **Start optimized
capture**, run the requested task in the selected coding agent, then choose **Record outcome** and
enter the quality/attempt values you actually observed. Normal use no longer requires copying
`benchmark-start` or `benchmark-finish` commands into a terminal.

The equivalent advanced CLI flow starts by asking the campaign engine for its current state. This
GitNexus example intentionally uses the only currently reviewed campaign row:

```sh
token-harness benchmark-matrix \
  --benchmark-id gitnexus-claude-eval-1 \
  --candidate gitnexus \
  --harness claude
```

Follow only the **Next** command printed by that report, complete the task honestly, then rerun the
same `benchmark-matrix` command. Before an optimized run, enable the candidate through its own
documented workflow. Token Harness records the experiment target but does not treat attribution—or
the browser acknowledgement—as proof that the candidate was active. For GitNexus on the reviewed
Claude Code `2.1.269` × GitNexus `1.6.12` × native-Linux row, the harness-native MCP inventory can
prove only that the GitNexus server was available at both task boundaries. That is not proof Claude
actually called a GitNexus tool, so the activation-verification promotion gate remains blocked
without a separate reviewed usage witness. See
[`docs/candidates/gitnexus-real-campaign.md`](docs/candidates/gitnexus-real-campaign.md).

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
- an available provider update outside reviewed package compatibility is kept out rather than forced;
- provider package replacement does not bypass the stricter compatibility gate for harness config writes;
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

Provider checks and reviewed updates are in **Overview -> Health and updates**. The browser first
checks reviewed channels and, when an installable update exists, offers **Install updates** in the
same dialog. From the advanced CLI, the preview prints the exact confirmation command:

```sh
token-harness update
token-harness update --yes
```

`update` replaces only installed providers whose target is inside the reviewed provider-package
policy. HarnessTrim uses npm and captures the previous global version for rollback. On native
Windows RTK prefers WinGet; when WinGet cannot yet reach the reviewed target, Token Harness can use
the verified official GitHub Windows x64 release fallback described above. That fallback verifies the
published digest and post-update version and restores the previous executable on failure.

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

Use the action shown beside the affected agent or optimizer in Overview. For technical evidence:

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
npx --yes pnpm@10.33.4 install --frozen-lockfile
npx --yes pnpm@10.33.4 typecheck
npx --yes pnpm@10.33.4 lint
npx --yes pnpm@10.33.4 test
npx --yes pnpm@10.33.4 build
npx --yes pnpm@10.33.4 smoke
npx --yes pnpm@10.33.4 package
npx --yes pnpm@10.33.4 smoke:install
```

Using `corepack enable` is optional. On a system-wide Windows Node installation it can require
administrator permission to modify `C:\Program Files\nodejs`; the `npx pnpm@10.33.4` form above
does not require that Corepack shim write.

Before changing public behavior or architecture, read
[RFC 0027](docs/rfcs/0027-optimization-stack-manager.md),
[RFC 0028](docs/rfcs/0028-smart-model-routing.md),
[docs/optimizer-priorities.md](docs/optimizer-priorities.md),
[docs/release-readiness.md](docs/release-readiness.md), [PLAN.md](PLAN.md), and the accepted
[RFCs](docs/rfcs).

## License

[Apache License 2.0](LICENSE). Referenced provider tools are independent projects with their own
licenses.
