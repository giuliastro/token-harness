import fs from 'node:fs';

function replaceOnce(path, before, after) {
  const text = fs.readFileSync(path, 'utf8');
  const first = text.indexOf(before);
  if (first < 0 || text.indexOf(before, first + before.length) >= 0) {
    throw new Error(`${path}: expected exactly one replacement anchor`);
  }
  fs.writeFileSync(path, text.slice(0, first) + after + text.slice(first + before.length));
}

replaceOnce(
  'README.md',
  `### Advanced and AI-assisted use

An AI may use the existing JSON CLI to inspect, plan and apply an explicitly approved change.
That is optional: another AI subscription is not required to operate the app. No persistent
agent, background model calls or task classifier runs behind your back.

The older automation contracts remain available: \`setup\`, \`optimize\`, \`plan\`, \`apply\`,
\`verify\`, \`metrics\`, \`rollback\`, and their JSON reports. \`ui --json\` preserves its existing
schema-1 report; \`ui --read-only\` opens the legacy read-only dashboard. \`ui --no-open\` starts
the guided app without launching a browser. Stop either local server with Ctrl+C.
`,
  `### Advanced and AI-assisted use

The long CLI flag combinations are **not** the normal human interface. They are the controller API
used by the app, automation, and optionally by a coding harness. Humans can keep using the browser
and the two entry points above.

For in-session use, this repository now includes a portable Agent Skill at
[\`skills/token-harness/SKILL.md\`](skills/token-harness/SKILL.md). A compatible Claude Code or Codex
skill mechanism can load it on demand, after which you can simply ask the harness to **use Token
Harness for this task**. The skill classifies substantial work conservatively, calls the existing
local \`--json\` optimizer at meaningful task boundaries, and can use explicit workload scheduling
when you have actually supplied a backlog. It does not run Token Harness before every tool call.

The skill is deliberately thin: Token Harness remains the deterministic policy engine. No MCP
server, background model, persistent agent, or second quota formula is added just to make this work.
Local tokens are still not subscription quota, and raw Claude/Codex percentages are still not a
common currency.

Agent use is read-only by default. If Token Harness recommends a persistent model, reasoning, or
verbosity change, the harness must first build a reviewed plan, explain the exact proposed mutation,
and wait for your explicit approval before \`apply\`. A saved preference may affect future sessions;
it is not silently presented as a live change to the current session.

Phase 18.13 ships the portable skill source rather than hard-coding harness-specific skill folders.
Install or import the \`skills/token-harness\` directory with a supported Agent Skills mechanism.
A later reviewed phase can bundle and install it from the guided app once current Claude/Codex
skill-discovery locations and ownership semantics are fixture-tested. The browser remains fully
usable without any skill or second AI subscription.

The older automation contracts remain available: \`setup\`, \`optimize\`, \`plan\`, \`apply\`,
\`verify\`, \`metrics\`, \`rollback\`, and their JSON reports. \`ui --json\` preserves its existing
schema-1 report; \`ui --read-only\` opens the legacy read-only dashboard. \`ui --no-open\` starts
the guided app without launching a browser. Stop either local server with Ctrl+C. See
[RFC 0022](docs/rfcs/0022-agent-native-skill.md) for the agent-facing safety boundary.
`,
);

const planAnchor = `Next optimization work should use the observed allocation receipts to improve per-class capacity
confidence and only then consider richer joint model/effort/verbosity allocation across harnesses.
`;
replaceOnce(
  'PLAN.md',
  planAnchor,
  `${planAnchor}
## Agent-native Token Harness milestone (2026-09-08, RFC 0022)

**Phase 18.13 complete.** The advanced optimizer/scheduler CLI remains a machine-facing control
surface rather than becoming the normal human workflow. A portable \`skills/token-harness/SKILL.md\`
now lets a compatible Claude Code or Codex Agent Skills implementation invoke the existing local
JSON contracts at meaningful task boundaries while the browser remains the primary human interface.

The skill contains no duplicate quota math. It identifies the running harness, uses the existing
four task classes conservatively, calls \`optimize --json\` for substantial work or explicit
allowance questions, and uses \`--tasks-left\` or mixed \`--workload\` only when workload intent is
explicit. It does not infer backlog from source code, issue counts or local token history.

Agent use is advisory by default. Persistent model/reasoning/verbosity changes still cross the
existing native-policy plan/apply boundary: the agent must summarize the concrete proposed mutation
and receive explicit user approval before apply. Current-session state is not conflated with a
persisted future-session preference.

The integration deliberately adds no MCP server, background model or autonomous daemon. The skill
is concise so supported Agent Skills implementations can use progressive disclosure rather than
paying its full instruction cost on every turn. Static integration tests pin its frontmatter,
controller calls, task taxonomy, explicit-workload rules and mutation/privacy invariants.

This phase does **not** mutate Claude/Codex skill-discovery directories or pretend their installation
paths are timeless. Next UX work should bundle the tested skill in the publishable artifact and add
a guided **Enable in-session guidance** flow only after current harness/version/platform discovery
and ownership semantics are verified with compatibility fixtures. That flow must be reversible and
must not require the user to learn advanced CLI flags.
`,
);
