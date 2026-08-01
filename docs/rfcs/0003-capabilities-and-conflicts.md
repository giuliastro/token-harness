# RFC 0003: Capability and conflict model

- Status: Accepted
- Date: 2026-07-29

## Problem

Token-saving tools often claim the same interception point. Installing them together
can:

- reduce already reduced output;
- remove signal required by a later provider;
- cause hook-order instability;
- create recursive command rewriting;
- count the same saved tokens more than once;
- overwrite shared harness configuration.

Token Harness therefore resolves capabilities before it resolves installation
commands.

## Capability taxonomy

Initial capability IDs:

| Capability | Description |
| --- | --- |
| `shell.command.rewrite` | Rewrite a shell command before execution |
| `shell.output.reduce` | Reduce one command's output |
| `shell.output.deduplicate` | Compare output across repeated executions |
| `tool.output.reduce` | Reduce non-shell or generic harness tool results |
| `mcp.schema.lazy` | Load MCP tool definitions on demand |
| `mcp.result.sandbox` | Keep raw MCP results outside model context |
| `repo.context.retrieve` | Retrieve task-specific repository context |
| `conversation.compact` | Compact or restore conversation state |
| `instructions.progressive` | Move recurring instructions behind on-demand skills |
| `model.output.terse` | Steer the model toward shorter visible replies |
| `reasoning.effort.route` | Select reasoning effort by turn type |
| `metrics.observe` | Observe savings without changing the payload |

New capabilities require an RFC when they introduce a new interception surface or
attribution rule.

## Composition modes

Each capability declaration specifies one mode:

### Exclusive

Only one provider can own the capability for a given harness, tool, and interception
point.

Defaults:

- `shell.command.rewrite`
- `shell.output.reduce`
- `tool.output.reduce`
- `conversation.compact`
- `reasoning.effort.route`

### Chainable

Multiple providers may participate only when their order is explicitly validated.

Potential examples:

- `shell.output.deduplicate` followed by `shell.output.reduce`;
- repository retrieval followed by reversible context compression.

"Chainable" is not permission to compose arbitrary providers. A compatibility rule
must name the provider pair, order, supported versions, and test fixture.

### Observational

The provider reads events without modifying the payload. Multiple observers are
allowed, but deduplication keys prevent duplicate accounting.

Default:

- `metrics.observe`

## Scope

Ownership is resolved over:

```text
<harness>/<tool-family>/<interception-point>/<capability>
```

### Observational capabilities are outside this model

Amended during Phase 4. The address above names an interception point, and an observational
capability does not have one: observation happens by reading a provider's own records after the
fact, not by sitting in a hook. Enumerating the four-part scope for `metrics.observe` produces one
row per tool family per interception point — four on Claude Code alone — each asserting ownership
of a surface where nothing is intercepted.

The deeper reason is that there is nothing to arbitrate. This model exists to guarantee that at
most one provider transforms a given payload; an observer transforms nothing, so two observers are
not in conflict, and §Composition modes already says so: "Multiple observers are allowed, but
deduplication keys prevent duplicate accounting." The property that keeps a figure from being
counted twice is the deduplication key, defined in RFC 0005 §Deduplicating a stream without event
IDs — not an ownership assignment. Putting `metrics.observe` in the ownership model would appear
to provide a safety property that is in fact provided elsewhere, which is worse than leaving it
out.

The resolver therefore assigns no observational capability, and the `metrics.observe` row of
§MVP ownership is an intent about who imports rather than an assignment the resolver makes. What
Token Harness observes is reported where it is actually knowable: the importer modes in `status`
and the per-provider rows in `metrics`.

`CompositionMode` keeps its `observational` member. A capability still declares itself
observational, and that declaration is what excludes it here — which is why the member is
load-bearing rather than vestigial.

This allows HarnessTrim to reduce a large generic MCP result while RTK owns shell
command output in the same session.

## Compatibility rule

```ts
interface CompatibilityRule {
  id: string;
  providers: string[];
  harnesses: string[] | "*";
  capabilities: string[];
  outcome: "compatible" | "ordered" | "conflict";
  order?: string[];
  testedVersions: Record<string, string>;
  rationale: string;
  fixtures: string[];
}
```

No rule means conservative conflict for overlapping exclusive capabilities.

## Scope of the resolver at 0.1.0

`0.1.0` ships two providers, and the ownership policy for that pair is already known and
written below. A general resolution engine built now would be designed against one data
point.

The `0.1.0` resolver is therefore deliberately small:

1. a static compatibility-rule table, committed as data;
2. exclusive-scope ownership resolved by lookup in that table;
3. fail-closed on any overlapping exclusive scope not covered by a rule;
4. a pipeline ID derived from the ordered owner list, because metrics attribution
   depends on it.

Deferred to `0.2.0`, when a third provider supplies the second data point:

- goal-based profiles and the `goals` YAML block;
- automatic provider substitution from goals;
- repository-size and workflow heuristics;
- the general chain-ordering solver.

Until then, `profile: safe` and `profile: custom` are the only profiles, and `custom`
means explicit provider and capability assignment. `balanced` is not shipped, because a
profile identical to `safe` is a promise with no content.

This is a reduction in machinery, not in safety: fail-closed behavior on undeclared
overlap is present from the first release, which is the property that actually protects
users.

## Continuous conflict detection

Ownership is resolved when a plan is built, but the configuration it writes lives in
files that other tools and the user can edit afterwards. A second hook added by hand the
next day produces double reduction with nothing to signal it, because every harness in
scope runs all matching hooks rather than only the first.

Conflict detection therefore also runs after apply:

- `status` and `verify` compare the live harness configuration against the installation
  receipt;
- an entry on an exclusive scope that Token Harness does not own is reported as
  `unowned-entry-on-exclusive-scope` with the file, the surface, and the competing
  command;
- the finding is actionable, so the command exits with the problems-found code from
  RFC 0006;
- Token Harness reports it and never silently removes a third party's entry.

Plan-time resolution alone would make the one-owner invariant a claim about a moment
rather than about the system.

## Planner result

The resolver returns:

- selected owner for every capability scope;
- providers disabled or limited;
- configuration flags required to narrow provider behavior;
- unresolved hard conflicts;
- warnings for untested version combinations;
- a pipeline graph used later for metrics attribution.

An apply operation is blocked by a hard conflict.

## MVP ownership

The intended policy — which the two sections below then reconcile against what HarnessTrim
`0.0.5` can actually be asked to do, arriving at a narrower `0.1.0` scope:

| Surface | Owner | Notes |
| --- | --- | --- |
| Shell command rewriting | RTK | Uses the harness-specific RTK integration |
| Shell output reduction | RTK | HarnessTrim must not reduce the same result again |
| Generic/non-shell tool reduction | HarnessTrim | Only where the harness can safely transform it |
| Progressive instructions/skills | HarnessTrim | Installed without duplicating RTK awareness text |
| Metrics observation | Token Harness | Imports both provider streams |

### The table is an intent, not a reachable state on every harness

Ownership can only be assigned to a provider that can actually implement it on that
harness. Checked against the HarnessTrim `0.0.5` source, none of the three MVP harnesses
supports the per-surface narrowing the table assumes:

| Harness | Reduction surface | Source | Narrowing available |
| --- | --- | --- | --- |
| Claude Code | Bash only | `adapter-claude/src/install.ts:6`, `HOOK_MATCHER = "Bash"` | None. Skills and hook install as one unit |
| Codex | Bash only | `adapter-codex/src/index.ts:23`, `CODEX_HOOK_MATCHER = "^Bash$"` | The hook can be omitted entirely: it is opt-in behind `--hook` |
| OpenCode | Every tool result | `adapter-opencode/src/plugin.ts:37`, `tool.execute.after` reduces `output.output` with `input.tool` never used as a filter | `mode: active \| dryrun \| off` and `minLength`. No per-surface selector |

Three consequences follow, and they are not Claude-specific:

1. the row assigning `tool.output.reduce` to HarnessTrim is **unreachable on Claude and
   Codex**, whose adapters implement Bash reduction and no non-shell reduction at all;
2. on OpenCode the opposite holds — it reduces *every* tool result, so it cannot be
   confined to non-shell surfaces either;
3. therefore, on every MVP harness, HarnessTrim's reducing surface either is exactly the
   one assigned to RTK or strictly contains it, and no configuration narrows it.

### Resolution at 0.1.0

An assignment also requires a **producible target state**: the provider's installer must
be invocable in a way that yields it. Checked against `0.0.5`, no narrowed state is:

| Harness | Narrowed state wanted | Why the installer cannot produce it |
| --- | --- | --- |
| Claude Code | Skills without the Bash hook | Installed as one unit; no flag separates them |
| Codex | Skills without the reduction guidance | `install codex` always writes `REDUCE_INSTRUCTION_SNIPPET` into `AGENTS.md` |
| OpenCode | `mode: "dryrun"` | `DEFAULT_OPENCODE_ADAPTER_CONFIG` and all four presets set `mode: "active"`; the value is baked into a generated wrapper, and `resolveConfig` gives it precedence over `HARNESSTRIM_MODE` |

#### Amended: the OpenCode row asks the wrong question

Checked again against the source, the OpenCode row is true about the *installer* and does not
settle the case. `resolveConfig` reads `options.mode` from the plugin entry in `opencode.json`
before consulting the environment, and `"dryrun"` is a documented member of `Mode` — "measure and
log what *would* be reduced, but pass output through unchanged".

So the narrowed state is reachable. What cannot produce it is `harnesstrim install opencode`; what
can is Token Harness writing the plugin options itself — the same thing it does for RTK's hook, and
what the comment-preserving JSONC editor exists to make safe.

The distinction matters because the rule this section states is about *delegation*: "an installer
that cannot be asked for the target state cannot be delegated to for it." That is not a rule that a
state no installer produces is unreachable. Composing the edit ourselves is the reviewable
alternative, and RFC 0004 already prefers it — a delegated install is the exception, not the norm.

**This does not change the `0.1.0` outcome, and the reason is worth separating from the mechanism.**
A `dryrun` HarnessTrim on OpenCode does not resolve the contest with RTK; it *ends* it by measuring
instead of reducing, and RFC 0005 §A measured reduction is not always a realized one already files
those events as `counterfactual`. Run one reducer and measure what a second would have saved is a
coherent product decision — but it is a new profile, not `safe`, and choosing it for a user without
asking would be choosing what their tools do.

Deliberately left open, and recorded in PLAN §17: whether `0.2.0` offers a profile that assigns
`shell.output.reduce` to one provider and `dryrun` measurement to another. The two data points that
decision needs — a second provider pair, and a fixture showing the counterfactual figures are
comparable — are the same ones §Scope of the resolver at 0.1.0 defers the general solver for.

Therefore, under `safe`, RTK owns shell reduction on all three harnesses and **HarnessTrim
is not installed by Token Harness at all**. It is detected, adopted, reconciled against
RTK's ownership, and measured. PLAN §6.1 records the full division of roles.

Under `custom`, a user may invert the assignment — giving `shell.output.reduce` to
HarnessTrim and excluding RTK from that scope on that harness. That state is producible,
because it is the installer's own default. What is not offered is both providers mutating
the same payload.

The general rule this yields: an ownership assignment needs both a demonstrated capability
and a reachable configuration. A capability the provider has but cannot be asked for is not
an assignable capability.

### The instruction-level path

Codex's `REDUCE_INSTRUCTION_SNIPPET` writes guidance into `AGENTS.md` telling the model to
pipe noisy commands through `harnesstrim reduce`. That is a second shell-reduction path
that hook ownership does not cover: it operates through the model's behavior rather than
through an interception point.

It is therefore treated as part of the `shell.output.reduce` scope, not as separate
instruction text. When RTK owns that scope, the planner must either omit the snippet or
reconcile it with RTK's own guidance, and `verify` checks which instruction text is
actually present. Two documents telling the model to reduce the same output through
different tools is a conflict even though no hook is duplicated.

### Rule

An ownership assignment requires a demonstrated capability at the assigned scope on the
assigned harness, evidenced in the provider's own source at a recorded version. An
assignment the provider cannot implement there is a planning error, not a configuration
to attempt.

Compatibility data therefore carries the harness dimension. A provider does not behave
identically across harnesses, and `0.0.5` demonstrates the point: the same tool reduces
one tool family on two harnesses and all of them on a third.

## Dejavu policy

Dejavu is not part of the initial default profile.

Before enabling it with RTK, the project must answer through integration tests:

1. Which component sees raw output?
2. Does deduplication occur before or after semantic reduction?
3. Can the user retrieve the original raw output?
4. Are exit codes preserved through the entire chain?
5. Can either provider recursively intercept the other?
6. Are incremental savings attributable without double counting?
7. Does the combination work on each supported operating system?

Until then, the resolver offers RTK and Dejavu as alternative owners for overlapping
shell scopes.

## Context provider policy

Headroom and Context Mode begin as alternatives. Both can touch large tool results,
MCP payloads, memory, and conversation context. Token Harness will not create a
"maximum savings" profile that blindly activates both.

Repowise can compose with one general context provider only after repository retrieval
results have size limits and an attribution fixture.

## Profiles

### 0.1.0

Two profiles ship:

```yaml
profile: safe
```

`safe` applies the MVP ownership table above: deterministic local optimization, RTK owns
shell rewriting and shell output reduction, HarnessTrim owns only non-overlapping
surfaces, no experimental providers.

```yaml
profile: custom

providers:
  rtk:
    owns: [shell.command.rewrite, shell.output.reduce]
  harnesstrim:
    owns: [tool.output.reduce, instructions.progressive]
```

`custom` is explicit assignment. An unsafe overlap requires a named compatibility rule,
never a generic force flag.

### 0.2.0 and later

Once a third provider exists, profiles select goals rather than assignments:

```yaml
profile: balanced

goals:
  shellOutput: true
  repeatedOutput: auto
  mcpContext: auto
  repositoryContext: auto
  terseReplies: false
```

The resolver will convert goals into providers according to installed harness, OS
support, repository size and detected workflow, provider availability, license policy,
verified compatibility, and user overrides. That mapping is what keeps profiles from
becoming stale installer recipes — but it needs more than one provider pair to be
designed against, so it is deferred rather than guessed.

The `goals` schema is reserved now so that adding it later is not a breaking change to
`token-harness.yaml`.

