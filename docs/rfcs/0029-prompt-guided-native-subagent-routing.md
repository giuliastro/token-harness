# RFC 0029 — Prompt-guided native subagent routing

- Status: Accepted for skill guidance
- Date: 2026-10-03
- Owners: Token Harness
- Extends: RFC 0003, RFC 0005, RFC 0007, RFC 0018, RFC 0022

## Summary

Token Harness may guide a coding harness to assign a bounded unit of work to a native subagent
running a selected model. The harness performs the route through its existing delegation interface;
Token Harness adds no proxy, gateway, provider API, hook, daemon, or model-setting mutation.

This is routing of delegated work only. It does not change the model selected for the root
conversation. The initial path prioritizes Codex. Claude Code guidance is portable but is only used
when that harness is already configured, authenticated, and exposing native subagents.

## Decision

The portable `skills/token-harness/SKILL.md` is the policy surface. The generated
`apps/cli/src/agent-skill.ts` copy stays byte-identical and is installed only through the existing
reviewed plan/apply lifecycle.

### Codex policy

When Codex is the active harness, delegate one complete, substantial, bounded implementation unit
to one native subagent with `model: gpt-6-luna` only when all of the following hold:

- Luna appears in the current native Codex model picker/catalog;
- the root model is known and is not Luna;
- the unit is independently actionable and will not duplicate work the root is doing;
- the user has not asked to avoid delegation.

The root model owns task framing, integration, and acceptance review. The skill skips trivial,
tightly coupled, shared-write, architecture, security, release, and root-judgment work. It does not
spawn a second worker in parallel solely to lower model use. If the route is unavailable or the root
model is unknown, continue with the root model.

### Claude Code policy

When Claude Code is already configured and authenticated, and native subagents are available, the
same eligibility rules may request the current native `haiku` alias for one bounded worker. The
skill never installs Claude Code, changes its model configuration, or obtains authentication.

### Evidence and claims

A model specified at spawn time is a routing request. Report the worker's model as verified only
when the harness exposes its runtime identity. The skill prompt and configured model are not runtime
receipts.

Subagents add context and coordination overhead; they may consume more total tokens than equivalent
single-agent work. The skill must not claim token, allowance, or monetary savings from model names,
spawn requests, or local token counts. A savings claim requires paired same-harness, same-task-class
usage evidence and a quality gate, with retries and accepted outcomes accounted for. Exact allowance,
estimated cost, and local token counts remain separate evidence classes under RFCs 0005, 0007, and
0018. Without those receipts, savings stay unknown.

## Safety and compatibility

- No change to the selected root model or persistent model preference.
- No provider, authentication, billing, trust, hook, or endpoint changes.
- No external router or third-party installation.
- Resolve model availability from the harness's current native catalog; do not infer support from a
  model name or pin an unavailable model silently.
- If the harness does not expose a native subagent route or actual model identity, do not claim that
  a route was executed.
- Existing skill installation remains dry-run by default and uses plan, apply, verification, and
  rollback.

## Acceptance

- Codex is the first and complete implementation path for this milestone.
- The skill gives explicit criteria for using one native Luna worker and cases where routing is
  skipped.
- The root conversation remains on its user-selected model.
- The source skill and embedded install content are byte-identical.
- Claude instructions remain inert unless Claude Code is already configured and authenticated.
- Results distinguish requested worker model, observed runtime model, and savings evidence.
- No savings are asserted without paired quality and comparable allowance evidence.

## References

- [ChatGPT/Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [ChatGPT/Codex models](https://learn.chatgpt.com/docs/models)
- [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude model deprecations and catalog](https://platform.claude.com/docs/en/about-claude/model-deprecations)
