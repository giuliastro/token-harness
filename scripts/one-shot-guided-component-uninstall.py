from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} match(es), found {actual}")
    p.write_text(text.replace(old, new))


# Guided approval can now represent a provider-scoped uninstall without pretending a provider id is a plan id.
replace(
    "apps/cli/src/guided.ts",
    """interface Approval {
  id: string;
  expires: number;
  plans: string[];
  description: string;
  operation: 'apply' | 'rollback';
  network: boolean;
}
""",
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
)

# Extend preview input validation, keeping provider selection exclusive to the remove action.
replace(
    "apps/cli/src/guided.ts",
    """      Object.keys(data).some((key) => !['action', 'harness', 'task'].includes(key)) ||
      !['setup', 'effort', 'skill', 'undo'].includes(String(data['action'])) ||
      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||
      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||
      (data['action'] === 'effort' &&
        (data['harness'] === undefined || data['task'] === undefined)) ||
      (data['action'] === 'skill' && data['harness'] === undefined)
""",
    """      Object.keys(data).some((key) => !['action', 'harness', 'task', 'provider'].includes(key)) ||
      !['setup', 'effort', 'skill', 'undo', 'remove'].includes(String(data['action'])) ||
      (data['harness'] !== undefined && !['claude', 'codex'].includes(String(data['harness']))) ||
      (data['task'] !== undefined && !TASKS.has(String(data['task']))) ||
      (data['provider'] !== undefined &&
        !['rtk', 'harnesstrim'].includes(String(data['provider']))) ||
      (data['action'] === 'effort' &&
        (data['harness'] === undefined || data['task'] === undefined)) ||
      (data['action'] === 'skill' && data['harness'] === undefined) ||
      (data['action'] === 'remove' &&
        (data['provider'] === undefined ||
          data['harness'] !== undefined ||
          data['task'] !== undefined)) ||
      (data['action'] !== 'remove' && data['provider'] !== undefined)
""",
)

# Existing approvals explicitly have no provider target.
replace(
    "apps/cli/src/guided.ts",
    """          plans: [this.lastApplied.plan],
          description: 'Undo',
""",
    """          plans: [this.lastApplied.plan],
          provider: null,
          description: 'Undo',
""",
)
replace(
    "apps/cli/src/guided.ts",
    """          plans,
          description:
            data['action'] === 'effort'
""",
    """          plans,
          provider: null,
          description:
            data['action'] === 'effort'
""",
)

# Component removal preview: dry-run the real uninstall command. No string parsing, no --yes.
anchor = "      this.record('Checking supported changes. Your agent settings are unchanged.', 'working');\n"
remove_preview = """      if (data['action'] === 'remove') {
        const provider = providerId(String(data['provider']));
        this.record(`Reviewing Token Harness-owned ${name(provider)} changes. Nothing is being removed yet.`, 'working');
        const result = await this.call<ApplyReport>(['uninstall', '--provider', provider]);
        const removable = result.diagnostics.some((entry) => entry.code === 'confirmation-required');
        if (!removable) {
          const message = explainGuideIssue(
            result.diagnostics,
            result.data?.outcome === 'nothing-to-do'
              ? `${name(provider)} has no Token Harness-owned change to remove. User-owned configuration is left alone.`
              : `No safe ${name(provider)} removal is available. Nothing was changed.`,
          );
          this.record(message, result.exitCode === 0 ? 'success' : 'attention');
          return {
            ticket: null,
            title: 'No managed change to remove',
            changes: [],
            notices: [message],
            expiresAt: null,
            network: false,
            restart: false,
          };
        }
        const ticket = this.random();
        const expires = this.now() + 10 * 60_000;
        this.approval = {
          id: ticket,
          expires,
          plans: [],
          provider,
          description: `${name(provider)} removal`,
          operation: 'uninstall',
          network: false,
        };
        this.record('Removal preview ready. Waiting for your approval.', 'success');
        return {
          ticket,
          title: `Remove the managed ${name(provider)} integration?`,
          changes: [
            {
              title: `${name(provider)}: remove Token Harness-owned integration`,
              files: 0,
              description:
                'Runs the existing ownership-aware uninstall transaction. Only entries recorded as owned by Token Harness are eligible; user-owned matching configuration is not removed, and edits that invalidate ownership preconditions block the removal.',
            },
          ],
          notices: [
            'The approval will re-run ownership and drift checks before removing anything. No provider update, install, model, login or billing setting is changed.',
          ],
          expiresAt: new Date(expires).toISOString(),
          network: false,
          restart: true,
        };
      }
"""
replace("apps/cli/src/guided.ts", anchor, remove_preview + anchor)

# Approved removal uses the real uninstall command with --yes; all other apply/rollback code remains unchanged.
apply_anchor = """      this.approval = null;
      this.record(
        approval.operation === 'rollback'
"""
uninstall_apply = """      this.approval = null;
      if (approval.operation === 'uninstall') {
        if (approval.provider === null)
          throw new GuideError(409, 'This removal preview is incomplete. Review it again.');
        const provider = approval.provider;
        this.record(`Removing only Token Harness-owned ${name(provider)} integration changes.`, 'working');
        let result: CliEnvelope<ApplyReport>;
        try {
          result = await this.call<ApplyReport>(['uninstall', '--provider', provider, '--yes']);
        } catch {
          this.invalidateObservedState();
          const message =
            'The removal stopped before its final result could be read. No automatic retry was made. Refresh and inspect the current integration state.';
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Removal result needs checking',
            messages: [message],
            appliedPlans: 0,
          };
        }
        if (result.exitCode !== 0 || result.data?.outcome !== 'committed') {
          const message = explainGuideIssue(
            result.diagnostics,
            'The managed integration was not removed. Ownership or configuration changed after the preview, so nothing was forced.',
          );
          this.invalidateObservedState();
          this.record(message, 'attention');
          return {
            ok: false,
            title: 'Integration was not removed',
            messages: [message],
            appliedPlans: 0,
          };
        }
        this.lastApplied = null;
        this.invalidateObservedState();
        const messages = [
          `${name(provider)} Token Harness-owned integration changes were removed transactionally. User-owned matching configuration was not targeted.`,
          'Reopen affected coding agents, then Refresh to confirm the current optimization stack.',
        ];
        this.record(`${name(provider)} managed integration removed.`, 'success');
        return { ok: true, title: 'Integration removed', messages, appliedPlans: 1 };
      }
      this.record(
        approval.operation === 'rollback'
"""
replace("apps/cli/src/guided.ts", apply_anchor, uninstall_apply)

# Browser controller accepts only the two stack providers and sends the normal preview request.
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    """  showDialog(body.action === 'setup' ? 'Review optimizer setup' : body.action === 'skill' ? 'Review in-session guidance' : body.action === 'undo' ? 'Review restore' : 'Review reasoning change');
""",
    """  showDialog(body.action === 'setup' ? 'Review optimizer setup' : body.action === 'skill' ? 'Review in-session guidance' : body.action === 'undo' ? 'Review restore' : body.action === 'remove' ? 'Review optimizer removal' : 'Review reasoning change');
""",
)
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    """$('update-check').addEventListener('click', checkUpdates);
$('undo').addEventListener('click', () => preview({ action: 'undo' }));
""",
    """$('update-check').addEventListener('click', checkUpdates);
window.addEventListener('token-harness:remove-provider', event => {
  const provider = event?.detail?.provider;
  if (provider === 'rtk' || provider === 'harnesstrim') preview({ action: 'remove', provider });
});
$('undo').addEventListener('click', () => preview({ action: 'undo' }));
""",
)

# The remove control lives inside lifecycle details so it never competes with the single primary next action.
replace(
    "apps/cli/src/guided-stack-client.ts",
    """    if (component.nextAction)
      details.append(node('p', 'Next: ' + component.nextAction.reason, 'caption'));
    card.append(details);

    const next = action(component);
""",
    """    if (component.nextAction)
      details.append(node('p', 'Next: ' + component.nextAction.reason, 'caption'));
    if (component.managedByTokenHarness) {
      const remove = node('button', 'Remove managed integration', 'secondary');
      remove.type = 'button';
      remove.dataset.operation = 'remove';
      remove.addEventListener('click', () =>
        window.dispatchEvent(
          new CustomEvent('token-harness:remove-provider', {
            detail: { provider: component.providerId },
          }),
        ),
      );
      details.append(remove);
    } else if (component.configured) {
      details.append(
        node(
          'p',
          'This integration is not owned by Token Harness, so this dashboard will not remove it.',
          'caption',
        ),
      );
    }
    card.append(details);

    const next = action(component);
""",
)

# Regression coverage for the guided preview/apply contract and browser routing.
Path("apps/cli/test/guided-component-uninstall.test.ts").write_text(r"""import assert from 'node:assert/strict';
import { it } from 'node:test';

import {
  commandResult,
  diagnostic,
  providerId,
  toEnvelope,
  type ApplyReport,
  type CliEnvelope,
  type Diagnostic,
  type ExitCode,
} from '@token-harness/core';
import { GuideError, GuideService, type GuideCall } from '../src/guided.js';
import { GUIDE_JS, GUIDE_STACK_JS } from '../src/guided-assets.js';

const RTK = providerId('rtk');

function report(outcome: ApplyReport['outcome']): ApplyReport {
  return {
    planId: null,
    transactionId: outcome === 'committed' ? 'uninstall-test' : null,
    fromStoredPlan: false,
    outcome,
    results: [],
    unrestored: [],
    receiptId: null,
  };
}

function envelope<T>(
  command: string,
  data: T | null,
  exitCode: ExitCode = 0,
  diagnostics: Diagnostic[] = [],
): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode, diagnostics }), 'test');
}

it('previews a provider-scoped uninstall without confirmation and applies only after approval', async () => {
  const calls: string[][] = [];
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    if (args[0] === 'uninstall' && !args.includes('--yes'))
      return envelope<T>(
        'uninstall',
        null,
        8,
        [
          diagnostic({
            severity: 'error',
            code: 'confirmation-required',
            message: 'This would remove one owned change',
            remediation: 'Re-run with --yes',
          }),
        ],
      );
    if (args[0] === 'uninstall' && args.includes('--yes'))
      return envelope('uninstall', report('committed') as T);
    return envelope(args[0] ?? '', null as T);
  };
  const service = new GuideService(
    call,
    () => 0,
    () => 'remove-ticket',
  );

  const preview = await service.preview({ action: 'remove', provider: RTK });
  assert.equal(preview.ticket, 'remove-ticket');
  assert.equal(preview.network, false);
  assert.equal(preview.restart, true);
  assert.match(preview.title, /RTK/);
  assert.deepEqual(calls, [['uninstall', '--provider', 'rtk']]);
  assert.ok(calls.every((args) => !args.includes('--yes')));

  const applied = await service.apply({ ticket: 'remove-ticket' });
  assert.equal(applied.ok, true);
  assert.equal(applied.title, 'Integration removed');
  assert.equal(applied.appliedPlans, 1);
  assert.deepEqual(calls[1], ['uninstall', '--provider', 'rtk', '--yes']);
  assert.equal(service.status().canUndo, false);
});

it('does not offer an approval when the provider has no Token Harness-owned change', async () => {
  const call: GuideCall = async <T>(args: readonly string[]) =>
    envelope(args[0] ?? '', report('nothing-to-do') as T);
  const service = new GuideService(
    call,
    () => 0,
    () => 'unused',
  );

  const preview = await service.preview({ action: 'remove', provider: RTK });
  assert.equal(preview.ticket, null);
  assert.equal(preview.changes.length, 0);
  assert.match(preview.notices[0] ?? '', /no Token Harness-owned change/i);
});

it('rejects arbitrary providers and keeps the removal control scoped to managed stack components', async () => {
  const service = new GuideService(
    async <T>(args: readonly string[]) => envelope(args[0] ?? '', null as T),
    () => 0,
    () => 'unused',
  );
  await assert.rejects(
    service.preview({ action: 'remove', provider: 'headroom' }),
    (error: unknown) => error instanceof GuideError && error.status === 400,
  );
  assert.match(GUIDE_STACK_JS, /component\.managedByTokenHarness/);
  assert.match(GUIDE_STACK_JS, /token-harness:remove-provider/);
  assert.match(GUIDE_JS, /preview\(\{ action: 'remove', provider \}\)/);
});
""")
