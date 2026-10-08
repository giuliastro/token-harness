# Record a quality-gated comparison

Use the same task, initial tree, coding app and acceptance checks for every run.
Start a fresh coding session after changing hooks; configure and trust them through
the existing reviewed setup. Capture commands do not run a coding task or change
optimizer configuration.

## Optional direct quality check

In Bash or PowerShell, record an executable and arguments as a JSON array:

```sh
token-harness benchmark-start --benchmark-id fix-1 --variant baseline --task standard --harness codex --check-command '["npm","run","verify"]'
```

The command is previewed and saved. Run the coding task, then preview the check:

```sh
token-harness benchmark-finish --benchmark-id fix-1 --variant baseline --attempts 1 --failed-attempts 0
```

The preview executes nothing and leaves the capture open. After reviewing it, add
`--yes` to run the saved check directly through Token Harness's process runner.
It bypasses agent hooks and reducers. `--check-timeout` at start specifies
milliseconds; the default is 300000 and the maximum is 3600000. Command Prompt
requires its own escaping for the JSON argument; the examples use Bash/PowerShell.

Restore the initial tree and repeat with `--variant optimized`, the same check
arguments and timeout, and the optimization under evaluation enabled. Refresh
Results or run `token-harness benchmark-matrix` from the same project.

The check’s exit zero means passed; a completed nonzero exit means failed. A timeout, signal,
or failure to start means unknown and cannot support a savings claim. Attempt
counts describe coding attempts, not the number of check invocations. A successful
`benchmark-finish` exits zero when recording the receipt, including a failed or
unknown task; inspect `receipt.outcome.qualityGate` for the task result. An optional
`--quality` at finish records your own verdict; the direct check takes precedence
and disagreements appear in Results.

Receipts contain command identity, duration, exit/failure information and SHA-256
digests/byte counts for full stdout and stderr. Bounded, redacted tails remain in
`<state>/benchmarks/<id>/<variant>.check-output.json`, separate from the exported
receipt and metrics. A runner without output-evidence support leaves those hashes
unavailable rather than hashing truncated text. Check success establishes the
selected checks passed; it does not establish complete acceptance coverage.

Omit `--check-command` to retain the manual workflow with required
`--quality passed|failed`. Schema-1 receipts remain readable; new receipts use
schema 2. Automated and manual gates, or different check commands/timeouts, cannot
be mixed into a qualifying pair.

## Exploratory compression/routing experiment

Capture each of these arms with one benchmark id and the same
`--starting-state <initial-commit-or-fixture-id>`:

| Variant | Compression | Routing |
| --- | --- | --- |
| baseline | off | off |
| compression-only | on | off |
| routing-only | off | on |
| combined | on | on |

Use an already-installed supported RTK/HarnessTrim stack. Existing provider and
routing artifacts must be owned by a committed Token Harness setup transaction
before an OFF arm can remove them. Matching manually installed artifacts alone
do not establish ownership; resolve them explicitly before automatic OFF arms.
A matching HarnessTrim skill set needs no
installer; missing/changed skills require ordinary setup first. RTK command
rewriting belongs to compression here; native subagent routing is the other factor.

Preview the compression-only arm:

```sh
token-harness benchmark-prepare --benchmark-id four-1 --variant compression-only --starting-state initial-commit --task standard --harness codex --check-command '["npm","run","verify"]'
```

Review the actions and snapshot paths, then repeat with `--yes` (optionally
`--plan <preview-id>`). This approves temporary configuration and restoration.
Preparation inspects all four projected configurations, applies only local file
actions, verifies the selected arm and starts its capture. It installs no packages.

Start a fresh coding session, grant native hook trust where required, run the task
and finish with the saved check. A check preview keeps the arm active. Executing
finish records measurements/quality first and restores original files, modes and
absence, including empty directories created for the arm. Failed/unknown quality
also restores. Every arm must return to the same configuration fingerprint.
Restore the same task tree yourself before the next arm; the starting-state
identifier does not verify Git state. Prepared captures carry managed config-only
evidence, which does not prove runtime compression activation.

After cancellation or process interruption, preview recovery and then add `--yes`:

```sh
token-harness benchmark-restore --benchmark-id four-1 --variant compression-only
```

The machine-local lease blocks other managed transactions until finish/recovery.
Unrecognized partial writes, user edits or corrupt backups/checkpoints preserve
the lease and backups and name the recovery paths. Resolve those changes before
retrying recovery; it never silently overwrites them. A receipt written before a
cleanup failure remains intact. The dashboard shows pending recovery commands.

`benchmark-start` remains available for experiments configured manually; those
settings remain labelled user-declared and cannot be mixed with managed arms. Routing-on arms additionally require real prompt and
subagent callbacks, and routing-off arms require off configuration without child
callbacks. Keep the same root model, effort, verbosity and check for all arms.

Inspect the set with:

```sh
token-harness benchmark-factorial --benchmark-id four-1
```

The dashboard's **Record a comparison** offers the four-arm guide and Results
shows its evidence separately from paired history and policy learning. Missing
arms remain incomplete; mismatched identities remain incomparable. A combined
quality failure blocks combined savings and interaction, even when the two
single mechanisms passed.

For costs B (baseline), C (compression), R (routing), K (combined), the report
shows B−C, B−R, B−K and interaction cost K−C−R+B. A positive interaction cost means
the combination cost more than the additive single effects predict. Local tokens
and each comparable backend quota window remain separate; no token-to-quota or
money conversion is made.

One set is exploratory. Repeat controlled sets before treating an interaction as
stable. Preparation and guarded restoration are available for supported owned
integrations. Randomized ordering and repeated campaign analysis remain deferred;
coding tasks, Git resets and native hook trust stay under your control.
