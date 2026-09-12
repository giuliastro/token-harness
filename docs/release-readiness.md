# Promotion-ready stable release

Token Harness should be called ready for broad promotion only when it is easy to understand, the
core safety path is reliable, savings claims are evidence-backed, and the product demonstrates the
value of an **optimization stack manager** rather than only exposing isolated reducer telemetry.

Technical stability and broad-promotion readiness are separate. A release may be stable enough for
existing users and testing well before it is the version we actively promote.

## Required before promotion

- [x] Outcome-first **Dashboard / Setup / Results** information architecture.
- [x] No periodic full app reload.
- [x] Existing readings remain visible during refresh and after approved changes.
- [x] Preview → approval → apply → verify → undo safety flow.
- [x] Recorded reducer savings keep providers and measurement classes separate.
- [x] Results display paired allowance and quality value when available and block unsupported claims.
- [x] The primary UI can present the active optimization setup, measured value, quality state and a
      useful next destination while keeping technical detail secondary to user outcomes.
- [ ] RTK and HarnessTrim remain verified on current reviewed combinations.
      Token Harness now keeps exact multi-provider review evidence separate from the individual
      compatibility rows: until a real RTK + HarnessTrim combined fixture/recording exists, that
      combination is reported as `not-recorded` and cannot make the stack `healthy` by inference.
- [ ] At least **three distinct useful savings mechanisms** are available through Token Harness.
- [ ] Every counted mechanism has a real activation/configuration path, verification evidence and a
      safe ownership/rollback or uninstall story.
- [ ] Detection-only candidates do not count toward the three-mechanism target.
- [ ] The third mechanism is selected by comparative Token Harness evidence rather than reserved for
      mcptoon, a native policy, repository indexing, Headroom, Caveman or any other candidate in advance.
- [ ] The selected third mechanism proves material **marginal** value over current native Claude/Codex
      behavior and the already-enabled optimization stack.
- [ ] The **combined recommended stack** is benchmarked; individually good components are not assumed
      to compose safely or additively.
- [x] The app can detect meaningful component/harness version drift and explain whether the current
      stack is still reviewed, needs verification, or has a reviewed update available.
- [ ] Normal steady-state use requires no continuous optimizer toggling or permanent Token Harness
      daemon; admitted deterministic components can remain enabled and work independently.
- [ ] Full CI green for the release candidate on Windows, macOS and Linux.
- [ ] Published package/install smoke test green for the exact release candidate artifact.
- [ ] README onboarding verified against the exact published UI.
- [ ] One clean end-to-end fresh-user scenario passes:
      install → open Dashboard → discover setup → open Setup → review/apply → use agent → inspect
      Results → verify → check/update state → undo/uninstall.

## What counts as an integration

A read-only detector, README entry or upstream benchmark does not count as a savings mechanism.

A managed external component counts when Token Harness can:

1. detect/version it;
2. decide whether the installed harness/environment is supported;
3. recommend it from evidence rather than popularity;
4. install/configure it through a reviewed path or cleanly adopt a user-owned installation;
5. verify the actual integration to an explicit verification tier;
6. attribute its savings in the correct measurement class;
7. report quality confidence where the mechanism can affect task quality;
8. identify drift/version changes and provide a safe update/re-evaluation path;
9. remove or roll back only what Token Harness owns.

A first-party mechanism can count under the same evidence bar, but the roadmap should prefer healthy
specialized external projects over reimplementing their algorithms merely to increase the component
count.

## Candidate-selection gate

Before another mechanism is admitted, Token Harness compares candidates on:

- marginal savings over the **actual native + current-stack baseline**;
- workload coverage;
- paired task quality, retries and source correctness;
- overlap/conflict with current components;
- latency, memory, indexing/startup and operational cost;
- reversibility and failure isolation;
- project maturity, maintenance activity and adapter burden;
- attributable measurement.

Detection or a benchmark-ready surface is not promotion. Candidate promotion readiness also requires
selection evidence, real activation verification, managed lifecycle coverage, reviewed compatibility
and reversibility, project maturity and combined-stack validation. Broad context owners require an
additional admission decision before they can own the session context path.

The current research landscape includes repository-exploration/retrieval systems, MCP
schema/discovery systems such as mcptoon/mcp-compressor-class projects, Caveman-class
prompt/context/output minimizers, broad context owners such as Headroom/Context Mode-class systems,
result-side encoders/compressors, and native Claude/Codex policy controls.

No one category is guaranteed the third slot. A candidate that fails quality, reliability,
compatibility or marginal-value evidence stays experimental regardless of popularity or headline
token reduction.

## Stable-stack operating model

Promotion-ready Token Harness should mostly **leave a good stack alone**.

For deterministic low-risk components the expected lifecycle is:

`install/configure → verify → measure → keep enabled → monitor → re-evaluate on meaningful change`

Re-evaluation should occur when a harness/component version changes, verification fails, measured
value deteriorates, workload shape changes materially, a credible better candidate appears, or the
user explicitly asks for a review. Per-command or per-minute retuning is not a product goal.

Runtime policy remains secondary and must justify itself with evidence. Reasoning/model/verbosity or
explicit cross-harness scheduling can vary when task/allowance state genuinely changes the optimum;
that does not make every external optimizer an orchestrated runtime switch.

## Release decision

When every required item above is complete on a release candidate:

1. run the full cross-platform CI and package smoke suite;
2. publish the candidate artifact;
3. verify the installed npm artifact rather than only the repository build;
4. run the fresh-user end-to-end scenario;
5. confirm the recommended combined stack and evidence UI against that artifact;
6. only then mark that exact version as **promotion-ready**.

Until then the project can keep shipping stable incremental releases without actively marketing one
as the version new users should adopt broadly.
