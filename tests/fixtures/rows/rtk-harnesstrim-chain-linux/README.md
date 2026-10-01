# RTK + HarnessTrim ordered runtime fixture

This fixture pins the composition contract used by the resolver test:

- RTK 0.50.0 owns `PreToolUse` / `pre-tool-use` for the shell command rewrite and reduction.
- HarnessTrim 0.3.1 owns `PostToolUse` / `post-tool-use` and records its own reduction event.
- Claude Code 2.1.274 and Codex 0.159.0 expose the respective hook contracts on native Linux.
- The two providers retain independent hooks and independent telemetry. No combined savings total
  is implied by the resolver order.

`chain.json` pins the exact tuple, surfaces, matchers, metrics argument and order consumed by the
resolver fixture test. The automated fixture validates the version/platform gate and declared hook
ordering. The runtime canary still requires one real shell operation through each harness;
Token Harness reports `not-exercised` until that harness's own telemetry contains an attributable
event. Codex also requires its native hook enablement and trust to be accepted by the user.
