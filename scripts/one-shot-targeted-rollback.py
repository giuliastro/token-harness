from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new))


replace(
    "apps/cli/src/argv.ts",
    """  /** `--plan <id>`; validated for shape here and for existence by the command. */
  plan: string | null;
  /** Paired task benchmark comparison/capture inputs. */
""",
    """  /** `--plan <id>`; validated for shape here and for existence by the command. */
  plan: string | null;
  /** `--transaction <id>`; an exact rollback target guard, never a historical selector. */
  transaction: string | null;
  /** Paired task benchmark comparison/capture inputs. */
""",
)
replace(
    "apps/cli/src/argv.ts",
    """  '--until',
  '--plan',
  '--baseline',
""",
    """  '--until',
  '--plan',
  '--transaction',
  '--baseline',
""",
)
replace(
    "apps/cli/src/argv.ts",
    """    until: null,
    plan: null,
    baselineReceipt: null,
""",
    """    until: null,
    plan: null,
    transaction: null,
    baselineReceipt: null,
""",
)
replace(
    "apps/cli/src/argv.ts",
    """      case '--plan':
        if (!isPlanId(value)) {
""",
    """      case '--transaction':
        // Kept deliberately opaque here. The rollback command compares it only with a journal id
        // that was already loaded from the local store; the raw value is never used as a path.
        options.transaction = value;
        break;
      case '--plan':
        if (!isPlanId(value)) {
""",
)

replace(
    "apps/cli/src/commands/context.ts",
    """  planId: string | null;
  /**
   * Whether the user granted the confirmation RFC 0006 requires of a mutating command.
""",
    """  planId: string | null;
  /**
   * Optional exact transaction expected at the rollback tip. This is a drift guard, not permission
   * to reverse an arbitrary historical journal. Optional for hand-built test contexts.
   */
  transactionId?: string | null;
  /**
   * Whether the user granted the confirmation RFC 0006 requires of a mutating command.
""",
)

replace(
    "apps/cli/src/run.ts",
    """    planId: invocation.options.plan,
    confirmed: invocation.options.yes,
""",
    """    planId: invocation.options.plan,
    transactionId: invocation.options.transaction,
    confirmed: invocation.options.yes,
""",
)

replace(
    "apps/cli/src/commands/rollback.ts",
    """ * With no `--plan`, the most recent committed transaction. Chosen rather than asked for, because a
 * user who has just seen an apply go wrong should not have to find an identifier first; and
 * *committed* rather than latest, because a transaction that already rolled itself back is not
 * something to reverse again.
""",
    """ * By default, the most recent committed transaction. Chosen rather than asked for, because a user
 * who has just seen an apply go wrong should not have to find an identifier first; and *committed*
 * rather than latest, because a transaction that already rolled itself back is not something to
 * reverse again. `--transaction` is intentionally only an exact tip guard: it can prove the target
 * has not changed since preview, but can never select an older transaction underneath a newer one.
""",
)
replace(
    "apps/cli/src/commands/rollback.ts",
    """  // A guided undo names the reviewed plan; never undo a newer unrelated transaction.
  if (context.planId !== null && target.planId !== context.planId) {
""",
    """  // A transaction-targeted undo is a compare-and-swap guard on the history tip, not a historical
  // selector. If anything committed after preview, refuse instead of walking backwards past it.
  if ((context.transactionId ?? null) !== null && target.transactionId !== context.transactionId) {
    diagnostics.push(
      diagnostic({
        severity: 'error',
        code: 'rollback-transaction-drift',
        message: `The latest committed transaction no longer matches the requested rollback target ${JSON.stringify(context.transactionId)}`,
        remediation: 'Review the latest transaction before choosing what to restore',
      }),
    );
    return finish(EXIT_CODES['precondition-drift'], 'rollback', empty('rejected'), diagnostics);
  }

  // A guided apply undo names the reviewed plan; never undo a newer unrelated transaction.
  if (context.planId !== null && target.planId !== context.planId) {
""",
)

replace(
    "apps/cli/src/usage.ts",
    """Usage
  token-harness rollback [--json] [--yes]

Reverses the most recent committed transaction from the snapshots it recorded,
then reads the files back to confirm the restoration actually took.
""",
    """Usage
  token-harness rollback [--json] [--yes] [--transaction <id>]

Reverses the most recent committed transaction from the snapshots it recorded,
then reads the files back to confirm the restoration actually took. --transaction
is an exact safety guard for a transaction you already reviewed: if a newer
transaction has committed since then, rollback refuses with drift instead of
walking backwards past it. It never selects an older historical transaction.
""",
)

replace(
    "apps/cli/test/argv.test.ts",
    """  it('rejects a --plan value that cannot be a plan id', () => {
""",
    """  it('parses an opaque rollback transaction guard', () => {
    const parsed = parseArgv(['rollback', '--transaction', 'txn-2026-09-10T16:35:57Z']);
    assert.equal(parsed.kind, 'command');
    if (parsed.kind !== 'command') return;
    assert.equal(parsed.options.transaction, 'txn-2026-09-10T16:35:57Z');
  });

  it('rejects a --plan value that cannot be a plan id', () => {
""",
)

replace(
    "tests/integration/lifecycle.test.ts",
    """  it('walks back through history when there is more than one transaction', async () => {
""",
    """  it('rolls back the exact latest transaction when a transaction guard matches', async () => {
    const place = world();
    await invoke(['apply', '--yes'], place);
    const removed = await invoke<ApplyReport>(['uninstall', '--yes'], place);
    const transactionId = removed.data?.transactionId;
    assert.ok(transactionId);
    assert.deepEqual(matchers(place), ['Edit']);

    const result = await invoke<ApplyReport>(
      ['rollback', '--transaction', transactionId, '--yes'],
      place,
    );

    assert.equal(result.exitCode, 0);
    assert.equal(result.data?.transactionId, transactionId);
    assert.deepEqual(matchers(place), ['Edit', ...MANAGED_MATCHERS]);
  });

  it('refuses a stale transaction guard instead of reversing a newer transaction', async () => {
    const place = world();
    const applied = await invoke<ApplyReport>(['apply', '--yes'], place);
    const applyTransactionId = applied.data?.transactionId;
    assert.ok(applyTransactionId);
    await invoke(['uninstall', '--yes'], place);
    assert.deepEqual(matchers(place), ['Edit']);

    const result = await invoke<ApplyReport>(
      ['rollback', '--transaction', applyTransactionId, '--yes'],
      place,
    );

    assert.equal(result.exitCode, 5);
    assert.equal(result.data, null);
    assert.deepEqual(matchers(place), ['Edit']);
    assert.ok(
      result.envelope.diagnostics.some((entry) => entry.code === 'rollback-transaction-drift'),
    );
  });

  it('walks back through history when there is more than one transaction', async () => {
""",
)
