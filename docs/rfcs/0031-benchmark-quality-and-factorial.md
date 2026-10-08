# RFC 0031 — Automated benchmark checks and exploratory 2×2 comparisons

- Status: Accepted for this implementation
- Date: 2026-10-05
- Extends: RFC 0004, RFC 0005, RFC 0006, RFC 0011, RFC 0030
- Issues: #377 and #376 (managed preparation, receipt/report and recovery)

## October 5 amendment — managed arm preparation and recovery

`benchmark-prepare` plans one factorial arm using the existing provider resolver,
provider adapters and native routing planner. It accepts the same task/capture
inputs as start. The default is a read-only preview; `--yes` approves both the
temporary changes and their verified restoration. `--plan` is an optional exact
preview digest guard. No coding task, package installation, model/effort change,
hook trust approval or Git reset is automated.

RTK/HarnessTrim already installed and admitted for the selected harness form the
compression factor. RTK command rewriting is part of that compression stack,
not native subagent model routing. The ordinary compatibility rules still apply.
Only supported local file actions enter a prepared arm. Delegated installers,
package/network actions and changes without an owned removal receipt are blocked;
ordinary setup/adoption remains a separate reviewed operation. Provider/harness
paths and hook shapes stay inside their existing adapters.

Before a change, acquire an exclusive machine-local mutation lease, persist all
original snapshots and the expected file images after each planned action, and
pin the transaction journal. Other Token Harness transactions refuse the lease.
State checkpoints use atomic replacement. Every arm begins from the same restored
configuration; preparing a second arm while one is active is refused.

After apply, re-inspect the actual configuration and retain the config-only tier.
Start capture only when the requested state is observed. Start a fresh coding
session and grant native Codex hook trust where required. Real routing callbacks
still decide runtime attribution; configured state never becomes runtime proof.

Finish captures measurements and the quality result before restoring configuration.
Successful and failed/unknown quality outcomes both restore. `benchmark-restore`
previews or performs the same restoration after cancellation or process death,
using the persisted snapshots and action-prefix images. A concurrent user edit,
unknown partial write or corrupt checkpoint blocks destructive restoration, keeps
the lease/backups and names the affected paths. Files, original absence and newly
created empty parent directories are verified after restoration. Configuration
backups never enter project files, comparison reports or telemetry.

The dashboard guide generates preparation and recovery commands for each arm and
shows pending recovery. Prepared captures carry an additive configuration witness;
legacy manual experiments remain readable and labelled user-declared. Existing
capturing commands remain available for manually controlled experiments.

## Automated check

`benchmark-start --check-command '["npm","run","verify"]'` records an optional
executable and argument array, never a shell expression. `--check-timeout` specifies
milliseconds (default 300000, maximum 3600000). The start report previews the check.
The command comes only from explicit CLI input, not repository or observed content.

At finish, an automated check replaces the required manual `--quality` value.
Without `--yes`, finish returns a check plan in the command payload and executes
nothing. Its human rendering appears on stdout in both default and verbose mode,
including saved argv, timeout, working directory and the exact approval command;
it must not depend on visibility of informational diagnostics. With `--yes`,
Token Harness runs the saved command directly through its process runner in the
same project. No agent hooks or reducers mediate that invocation. Zero means
passed, a completed nonzero exit means failed, and timeout, signal or start failure
means unknown. A contradictory manual value is recorded and reported but cannot
override the automated result. Attempt counters still describe coding attempts.

The runner optionally hashes every raw byte of stdout and stderr separately while
retaining bounded output. Receipts record SHA-256 digests, byte counts, duration,
exit code and failure identity. Redacted bounded tails remain in a separate local
sidecar, never the metrics database or exported receipt. A missing full-output
witness cannot fabricate a digest. An exit result remains authoritative even when
its optional output witness is unavailable.

Declared secrets crossing the raw-tail cutoff are redacted using retained overlap;
the full raw hashes remain unchanged. Local captures and receipts use exclusive
creation, so concurrent finish calls cannot overwrite one receipt. Only its winning
writer saves the local tail and restores a prepared configuration. If that cleanup
was interrupted, recovery uses `benchmark-restore` rather than re-running the check.

Quality provenance is explicit. Comparisons require the same provenance and, for
automated checks, the same executable, arguments and timeout. Legacy receipts
without provenance remain user-recorded. Retry detection and multiple independently
configured checks are deferred; one project script can compose several checks.
An exit code proves the selected checks passed, not completeness of acceptance.

## Schema and compatibility

New captures and receipts use schema 2. Readers retain schema-1 two-arm support,
reject future schemas, validate new fields, and never reinterpret old optimized
receipts as combined factorial runs. Optional quality evidence remains absent on
legacy/manual outcomes. Gate provenance mismatch blocks savings in both pair
reports and matrix summaries, including their context/routing layers.

## Exploratory factorial receipt/report phase

`--starting-state <id>` opts capture into a 2×2 experiment. It requires one of
baseline, compression-only, routing-only or combined. Every arm records the same
user-declared starting-state identifier and its intended compression/routing
flags. The existing optimized arm remains reserved for legacy paired comparisons.

`benchmark-factorial --benchmark-id <id>` reads the four project-local captures and
receipts. Matrix/dashboard reports expose these experiments separately from paired
history and policy learning. Task class, harness, root policy, starting state and
quality-check identity must match. Routing-off arms need off configuration and no
child callbacks; routing-on arms need genuine prompt and child callbacks. Unknown
or conflicting runtime evidence blocks attributed routing effects.

Each evidence class/unit is evaluated separately. For costs B, C, R and K, report
compression saving B-C, routing saving B-R, combined saving B-K and interaction
cost K-C-R+B. Positive interaction cost means the combined run cost more than
additive single effects predict. Quality gates apply to each constituent effect;
failed combined quality blocks combined savings and interaction. Five-hour and
weekly quota windows are independent, require common non-reset identities, and
are never summed or converted to tokens. One four-arm set is exploratory, not a
statistical significance claim. Missing arms remain incomplete.

Managed preparation and guarded restoration follow the amendment above. Manual
captures remain supported and user-declared. Neither path runs coding tasks,
proves runtime compression from an arm label, verifies the user-declared starting
Git tree or automates hook trust. Repetitions and randomized ordering remain
deferred; one set is explicitly exploratory.

## Verification

Use fake runners and temporary/in-memory filesystems. Cover schema-1 compatibility,
failure beyond retained output, complete streaming hashes, timeout/start/signal
unknown, plan-only behavior, immutable check identity, conflicting manual results,
gate mismatch in all savings surfaces, incomplete/mixed experiments, real routing
requirements, interaction arithmetic, separate quota windows and combined-only
quality regression. Golden human and JSON renderings remain public contracts.

Managed preparation also covers exact preview digests, real projected and applied
configuration inspection, owned ON-to-OFF transitions, immutable initial configuration
identity, byte/absence/parent-directory restoration, lease exclusion, interrupted
apply/restore recovery, corrupt snapshots/checkpoints and concurrent user edits.
Native-platform CI checks exclusive writers and atomic whole-file replacement;
Windows permissions remain an explicit platform invariant rather than a chmod claim.
