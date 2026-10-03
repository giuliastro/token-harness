# CLI and evaluation guide

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
[`docs/candidates/gitnexus-real-campaign.md`](candidates/gitnexus-real-campaign.md).

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
See [RFC 0020](rfcs/0020-workload-aware-allowance.md) and
[RFC 0021](rfcs/0021-mixed-workload-allocation.md).

### Applying native recommendations from the CLI

`optimize` remains read-only. The explicit CLI path is review then apply:

```sh
token-harness plan --harness claude --native-policy --task mechanical --profile economy
token-harness apply --plan <printed-plan-id> --yes
```

For normal use, prefer the browser workflow.


For installation, everyday use, updates and troubleshooting, see the [README](../README.md).
