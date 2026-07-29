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

The intended MVP policy is:

| Surface | Owner | Notes |
| --- | --- | --- |
| Shell command rewriting | RTK | Uses the harness-specific RTK integration |
| Shell output reduction | RTK | HarnessTrim must not reduce the same result again |
| Generic/non-shell tool reduction | HarnessTrim | Only where the harness can safely transform it |
| Progressive instructions/skills | HarnessTrim | Installed without duplicating RTK awareness text |
| Metrics observation | Token Harness | Imports both provider streams |

This policy creates an explicit HarnessTrim prerequisite: its integration must expose
surface-level controls where an existing adapter currently treats all output as one
stream.

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

Profiles select goals, not hard-coded package lists:

```yaml
profile: balanced

goals:
  shellOutput: true
  repeatedOutput: auto
  mcpContext: auto
  repositoryContext: auto
  terseReplies: false
```

The resolver converts goals into providers according to:

- installed harness;
- OS support;
- repository size and detected workflow;
- provider availability;
- license policy;
- verified compatibility;
- user overrides.

This prevents profiles from becoming stale installer recipes.

