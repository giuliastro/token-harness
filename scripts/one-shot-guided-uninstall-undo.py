from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected exactly one match, found {count}")
    target.write_text(text.replace(old, new))


replace(
    "apps/cli/src/guided.ts",
    """interface Approval {
  id: string;
  expires: number;
  plans: string[];
  provider: ReturnType<typeof providerId> | null;
  description: string;
  operation: 'apply' | 'rollback' | 'uninstall';
  network: boolean;
}
""",
    """interface Approval {
  id: string;
  expires: number;
  plans: string[];
  transactionId: string | null;
  provider: ReturnType<typeof providerId> | null;
  description: string;
  operation: 'apply' | 'rollback' | 'uninstall';
  network: boolean;
}
type GuideUndoTarget =
  | { kind: 'plan'; plan: string; network: boolean }
  | {
      kind: 'transaction';
      transactionId: string;
      provider: ReturnType<typeof providerId>;
      network: false;
    };
""",
)

replace(
    "apps/cli/src/guided.ts",
    """  private busy = false;
  private lastApplied: { plan: string; network: boolean } | null = null;
  private reading: Promise<GuideOverview> | null = null;
""",
    """  private busy = false;
  private lastApplied: GuideUndoTarget | null = null;
  private reading: Promise<GuideOverview> | null = null;
""",
)

replace(
    "apps/cli/src/guided.ts",
    """        const ticket = this.random(),
          expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: [this.lastApplied.plan],
          provider: null,
          description: 'Undo',
          operation: 'rollback',
          network: this.lastApplied.network,
        };
        return {
          ticket,
          title: 'Restore the last change?',
          changes: [
            {
              title: 'Restore the last successful transaction from this dashboard',
              files: 0,
              description:
                'Restores complete configuration files from their backups. Any manual edits made to those files after applying will also be undone. If another transaction occurred, this undo is refused.',
            },
          ],
          notices: [
            'For a multi-agent setup, this restores only the last successful agent transaction, not the whole group. Earlier transactions remain in place.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network: this.lastApplied.network,
          restart: true,
        };
""",
    """        const target = this.lastApplied;
        const transactionUndo = target.kind === 'transaction';
        const ticket = this.random(),
          expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: target.kind === 'plan' ? [target.plan] : [],
          transactionId: target.kind === 'transaction' ? target.transactionId : null,
          provider: null,
          description:
            target.kind === 'transaction' ? `${name(target.provider)} removal undo` : 'Undo',
          operation: 'rollback',
          network: target.network,
        };
        return {
          ticket,
          title: transactionUndo
            ? `Restore the removed ${name(target.provider)} integration?`
            : 'Restore the last change?',
          changes: [
            {
              title: transactionUndo
                ? `Restore the ${name(target.provider)} removal transaction`
                : 'Restore the last successful transaction from this dashboard',
              files: 0,
              description: transactionUndo
                ? 'Restores the complete configuration-file snapshots recorded by that uninstall transaction. Drift checks still apply; if another transaction committed afterward, this Undo is refused rather than rolling back history out of order.'
                : 'Restores complete configuration files from their backups. Any manual edits made to those files after applying will also be undone. If another transaction occurred, this undo is refused.',
            },
          ],
          notices: transactionUndo
            ? [
                `This Undo is bound to the exact ${name(target.provider)} removal transaction created by this dashboard session. The browser cannot choose another transaction id.`,
              ]
            : [
                'For a multi-agent setup, this restores only the last successful agent transaction, not the whole group. Earlier transactions remain in place.',
              ],
          expiresAt: new Date(expires).toISOString(),
          network: target.network,
          restart: true,
        };
""",
)

replace(
    "apps/cli/src/guided.ts",
    """        this.approval = {
          id: ticket,
          expires,
          plans: [],
          provider,
          description: `${name(provider)} removal`,
""",
    """        this.approval = {
          id: ticket,
          expires,
          plans: [],
          transactionId: null,
          provider,
          description: `${name(provider)} removal`,
""",
)

replace(
    "apps/cli/src/guided.ts",
    """        this.approval = {
          id,
          expires,
          plans,
          provider: null,
          description:
""",
    """        this.approval = {
          id,
          expires,
          plans,
          transactionId: null,
          provider: null,
          description:
""",
)

replace(
    "apps/cli/src/guided.ts",
    """        this.lastApplied = null;
        this.invalidateObservedState();
        const messages = [
          `${name(provider)} Token Harness-owned integration changes were removed transactionally. User-owned matching configuration was not targeted.`,
          'Reopen affected coding agents, then Refresh to confirm the current optimization stack.',
        ];
""",
    """        const transactionId = result.data.transactionId;
        this.lastApplied =
          transactionId === null
            ? null
            : { kind: 'transaction', transactionId, provider, network: false };
        this.invalidateObservedState();
        const messages = [
          `${name(provider)} Token Harness-owned integration changes were removed transactionally. User-owned matching configuration was not targeted.`,
          transactionId === null
            ? 'The removal completed, but no transaction identifier was returned, so this dashboard will not offer an unsafe Undo. Inspect transaction history before restoring anything.'
            : 'Undo is available for this exact removal transaction. If another transaction commits first, the restore will be refused.',
          'Reopen affected coding agents, then Refresh to confirm the current optimization stack.',
        ];
""",
)

replace(
    "apps/cli/src/guided.ts",
    """      this.record(
        approval.operation === 'rollback'
          ? 'Restoring the reviewed configuration backup.'
          : 'Backing up and applying exactly the changes you approved.',
        'working',
      );
      const messages: string[] = [];
      let appliedPlans = 0;
      for (const plan of approval.plans) {
        this.record(
          `${approval.operation === 'rollback' ? 'Restoring' : 'Applying'} reviewed change ${appliedPlans + 1} of ${approval.plans.length}. The transaction runs its backup and safety checks.`,
          'working',
        );
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>([approval.operation, '--plan', plan, '--yes']);
""",
    """      this.record(
        approval.operation === 'rollback'
          ? 'Restoring the reviewed configuration backup.'
          : 'Backing up and applying exactly the changes you approved.',
        'working',
      );
      const messages: string[] = [];
      let appliedPlans = 0;
      const steps =
        approval.operation === 'rollback' && approval.transactionId !== null
          ? [
              {
                plan: null,
                args: ['rollback', '--transaction', approval.transactionId, '--yes'],
              },
            ]
          : approval.plans.map((plan) => ({
              plan,
              args: [approval.operation, '--plan', plan, '--yes'],
            }));
      for (const step of steps) {
        this.record(
          `${approval.operation === 'rollback' ? 'Restoring' : 'Applying'} reviewed change ${appliedPlans + 1} of ${steps.length}. The transaction runs its backup and safety checks.`,
          'working',
        );
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>(step.args);
""",
)

replace(
    "apps/cli/src/guided.ts",
    """        appliedPlans += 1;
        this.lastApplied =
          approval.operation === 'rollback' ? null : { plan, network: approval.network };
""",
    """        appliedPlans += 1;
        this.lastApplied =
          approval.operation === 'rollback'
            ? null
            : step.plan === null
              ? null
              : { kind: 'plan', plan: step.plan, network: approval.network };
""",
)

replace(
    "apps/cli/test/guided-component-uninstall.test.ts",
    """function report(outcome: ApplyReport['outcome']): ApplyReport {
  return {
    planId: null,
    transactionId: outcome === 'committed' ? 'uninstall-test' : null,
""",
    """function report(
  outcome: ApplyReport['outcome'],
  transactionId = outcome === 'committed' ? 'uninstall-test' : null,
): ApplyReport {
  return {
    planId: null,
    transactionId,
""",
)

replace(
    "apps/cli/test/guided-component-uninstall.test.ts",
    """    if (args[0] === 'uninstall' && args.includes('--yes'))
      return envelope('uninstall', report('committed') as T);
    return envelope(args[0] ?? '', null as T);
""",
    """    if (args[0] === 'uninstall' && args.includes('--yes'))
      return envelope('uninstall', report('committed') as T);
    if (args[0] === 'rollback')
      return envelope('rollback', report('rolled-back', 'uninstall-test') as T);
    return envelope(args[0] ?? '', null as T);
""",
)

replace(
    "apps/cli/test/guided-component-uninstall.test.ts",
    """  assert.deepEqual(calls[1], ['uninstall', '--provider', 'rtk', '--yes']);
  assert.equal(service.status().canUndo, false);
});
""",
    """  assert.deepEqual(calls[1], ['uninstall', '--provider', 'rtk', '--yes']);
  assert.equal(service.status().canUndo, true);

  const undo = await service.preview({ action: 'undo' });
  assert.equal(undo.ticket, 'remove-ticket');
  assert.match(undo.title, /RTK/);
  assert.match(undo.notices[0] ?? '', /exact .* removal transaction/i);
  assert.equal(calls.length, 2, 'Undo preview must not execute rollback');

  const restored = await service.apply({ ticket: 'remove-ticket' });
  assert.equal(restored.ok, true);
  assert.equal(restored.title, 'Backup restored');
  assert.deepEqual(calls[2], ['rollback', '--transaction', 'uninstall-test', '--yes']);
  assert.equal(service.status().canUndo, false);
});
""",
)

replace(
    "apps/cli/test/guided-component-uninstall.test.ts",
    """  await assert.rejects(
    service.preview({ action: 'remove', provider: 'headroom' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
""",
    """  await assert.rejects(
    service.preview({ action: 'remove', provider: 'headroom' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  await assert.rejects(
    service.preview({ action: 'undo', transaction: 'attacker-selected-id' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
""",
)
