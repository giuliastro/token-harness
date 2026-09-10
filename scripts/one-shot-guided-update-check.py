from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(f"{path}: expected {count} match(es), found {actual}")
    p.write_text(text.replace(old, new))


# Keep the public update command contract unchanged, but expose a strictly read-only
# internal entry point that can retain the already-computed dry-run report.
replace(
    "apps/cli/src/commands/update.ts",
    """export async function runUpdate(context: CommandContext): Promise<CommandResult<UpdateReport>> {
  const diagnostics: Diagnostic[] = [];
  const report: UpdateReport = { providers: [], network: [], execution: null };

  const finish = (exitCode: ExitCode, data: UpdateReport | null): CommandResult<UpdateReport> =>
    commandResult<UpdateReport>({
      command: 'update',
      exitCode,
      data: statusForExitCode(exitCode) === 'error' ? null : data,
      diagnostics,
    });""",
    """interface RunUpdateOptions {
  preserveConfirmationReport?: boolean;
}

export async function runUpdate(
  context: CommandContext,
  options: RunUpdateOptions = {},
): Promise<CommandResult<UpdateReport>> {
  const diagnostics: Diagnostic[] = [];
  const report: UpdateReport = { providers: [], network: [], execution: null };

  const finish = (exitCode: ExitCode, data: UpdateReport | null): CommandResult<UpdateReport> =>
    commandResult<UpdateReport>({
      command: 'update',
      exitCode,
      data:
        statusForExitCode(exitCode) === 'error' &&
        !(
          options.preserveConfirmationReport &&
          exitCode === EXIT_CODES['confirmation-required']
        )
          ? null
          : data,
      diagnostics,
    });""",
)
replace(
    "apps/cli/src/commands/update.ts",
    "  return finish(transaction.exitCode, report);\n}\n",
    """  return finish(transaction.exitCode, report);
}

/**
 * Dashboard-only observation path. It can never apply an update: confirmation is forced off even
 * if a caller accidentally supplies a confirmed context. The ordinary CLI keeps exit 8 + null data
 * for its public JSON contract; this internal adapter turns that already-computed dry-run into a
 * successful read-only report for the local UI.
 */
export async function runUpdateCheck(
  context: CommandContext,
): Promise<CommandResult<UpdateReport>> {
  const result = await runUpdate(
    { ...context, confirmed: false },
    { preserveConfirmationReport: true },
  );
  if (result.exitCode !== EXIT_CODES['confirmation-required'] || result.data === null) return result;
  return commandResult<UpdateReport>({
    command: 'update',
    exitCode: EXIT_CODES.ok,
    data: result.data,
    diagnostics: result.diagnostics.filter((entry) => entry.code !== 'confirmation-required'),
  });
}
""",
)

# Guided service: retain update evidence only while the observed stack fingerprint matches.
replace(
    "apps/cli/src/guided.ts",
    "  type TaskBenchmarkContextMatrixReport,\n  type VerifyReport,\n} from '@token-harness/core';",
    "  type TaskBenchmarkContextMatrixReport,\n  type UpdateReport,\n  type VerifyReport,\n} from '@token-harness/core';",
)
replace(
    "apps/cli/src/guided.ts",
    "import { runMetrics } from './commands/metrics.js';",
    "import { runMetrics } from './commands/metrics.js';\nimport { runUpdateCheck } from './commands/update.js';",
)
replace(
    "apps/cli/src/guided.ts",
    """interface GuideVerificationEvidence {
  fingerprint: string;
  report: VerifyReport;
}
""",
    """interface GuideVerificationEvidence {
  fingerprint: string;
  report: VerifyReport;
}
interface GuideUpdateEvidence {
  fingerprint: string;
  report: UpdateReport;
}
""",
)
replace(
    "apps/cli/src/guided.ts",
    "    const savings = args[0] === 'savings';\n    const translated = savings ? ['metrics', ...args.slice(1)] : [...args];",
    "    const savings = args[0] === 'savings';\n    const updateCheck = args[0] === 'update';\n    const translated = savings ? ['metrics', ...args.slice(1)] : [...args];",
)
replace(
    "apps/cli/src/guided.ts",
    """      ...(savings
        ? {
            commands: {
              ...DEFAULT_COMMANDS,
              metrics: (context) =>
                runMetrics({
                  ...context,
                  metricsAllProjects: true,
                  since: context.since ?? '1970-01-01',
                }),
            },
          }
        : {}),""",
    """      ...(savings || updateCheck
        ? {
            commands: {
              ...DEFAULT_COMMANDS,
              ...(savings
                ? {
                    metrics: (context) =>
                      runMetrics({
                        ...context,
                        metricsAllProjects: true,
                        since: context.since ?? '1970-01-01',
                      }),
                  }
                : {}),
              ...(updateCheck ? { update: runUpdateCheck } : {}),
            },
          }
        : {}),""",
)
replace(
    "apps/cli/src/guided.ts",
    "  private verification: GuideVerificationEvidence | null = null;",
    "  private verification: GuideVerificationEvidence | null = null;\n  private updates: GuideUpdateEvidence | null = null;",
)
replace(
    "apps/cli/src/guided.ts",
    "      metrics: base?.metrics ?? null,\n      unattributedDrift: base?.drift ?? [],",
    """      metrics: base?.metrics ?? null,
      updates:
        base !== null && this.updates?.fingerprint === base.fingerprint
          ? this.updates.report.providers
          : null,
      unattributedDrift: base?.drift ?? [],""",
)
replace(
    "apps/cli/src/guided.ts",
    "    this.stackBase = null;\n    this.verification = null;",
    "    this.stackBase = null;\n    this.verification = null;\n    this.updates = null;",
)
replace(
    "apps/cli/src/guided.ts",
    "  async verify(): Promise<GuideResult> {",
    """  async checkUpdates(): Promise<GuideResult> {
    return this.exclusive(async () => {
      this.record('Checking provider update channels without changing software.', 'working');
      const updateResult = await this.call<UpdateReport>(['update']);
      const inventory = await this.call<DoctorReport>(['doctor']);

      if (inventory.data === null) {
        this.updates = null;
        const message =
          'The current optimizer versions could not be re-read, so update evidence was not attached to the stack. No software changed.';
        this.record(message, 'attention');
        return {
          ok: false,
          title: 'Update check needs attention',
          messages: [message],
          appliedPlans: 0,
        };
      }

      const fingerprint = stackFingerprint(inventory.data);
      this.stackBase = {
        detections: [...inventory.data.providers],
        metrics: this.stackBase?.metrics ?? null,
        drift: this.stackBase?.drift ?? [],
        fingerprint,
      };

      if (updateResult.exitCode !== 0 || updateResult.data === null) {
        this.updates = null;
        const message = explainGuideIssue(
          updateResult.diagnostics,
          'The update channels could not be checked safely. No software changed and no automatic retry was made.',
        );
        const stack = this.stackSnapshot();
        if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
        this.record(message, 'attention');
        return {
          ok: false,
          title: 'Update check needs attention',
          messages: [message],
          appliedPlans: 0,
          stack,
        };
      }

      this.updates = { fingerprint, report: updateResult.data };
      const available = updateResult.data.providers.filter((row) => row.verdict === 'upgradable');
      const blocked = updateResult.data.providers.filter(
        (row) => row.verdict === 'blocked-unreviewed',
      );
      const messages: string[] = [];
      if (available.length > 0) {
        messages.push(
          ...available.map(
            (row) =>
              `${name(row.providerId)}: ${row.installed ?? 'installed version'} → ${row.available ?? 'new version'} is available. Run token-harness update to review the dry-run; applying still requires explicit approval.`,
          ),
        );
      }
      if (blocked.length > 0) {
        messages.push(
          ...blocked.map(
            (row) =>
              `${name(row.providerId)}: ${row.available ?? 'a newer version'} exists, but Token Harness is keeping ${row.installed ?? 'the installed version'} until that combination has reviewed compatibility evidence.`,
          ),
        );
      }
      if (available.length === 0 && blocked.length === 0)
        messages.push(
          'No reviewed provider update is currently available. Pins and unavailable channels remain visible in the stack.',
        );
      messages.push(
        'This was a read-only channel check. No provider was installed, updated, downgraded or enabled.',
      );

      const stack = this.stackSnapshot();
      if (this.cached !== null) this.cached.value = { ...this.cached.value, stack };
      this.record('Provider update check completed. No software changed.', 'success');
      return { ok: true, title: 'Optimizer update check', messages, appliedPlans: 0, stack };
    });
  }

  async verify(): Promise<GuideResult> {""",
)

# HTTP bridge: update only stack lifecycle evidence in the selected cached period.
http_path = Path("apps/cli/src/guided-http.ts")
http = http_path.read_text()
marker = "\nexport function createGuideHandler(input: {"
if http.count(marker) != 1:
    raise SystemExit("guided-http.ts: createGuideHandler marker mismatch")
merge_fn = r'''
function mergeUpdatedStack(
  cached: GuideOverview['stack'],
  observed: GuideOverview['stack'],
): GuideOverview['stack'] {
  const observedByProvider = new Map(
    observed.components.map((component) => [component.providerId, component]),
  );
  const components = cached.components.map((component) => {
    const current = observedByProvider.get(component.providerId);
    if (current === undefined) return component;
    const detectionChanged =
      component.version !== current.version ||
      component.detectedState !== current.detectedState ||
      component.configured !== current.configured ||
      component.configuredHarnesses.join('\0') !== current.configuredHarnesses.join('\0');
    const verification = detectionChanged ? current.verification : component.verification;
    const health: GuideOverview['stack']['components'][number]['health'] =
      current.health === 'attention' ||
      component.quality.state === 'regressed' ||
      component.conflicts.length > 0
        ? 'attention'
        : current.detectedState === 'configured' && verification === 'verified'
          ? 'healthy'
          : 'unknown';
    const merged: GuideOverview['stack']['components'][number] = {
      ...component,
      detectedState: current.detectedState,
      version: current.version,
      installed: current.installed,
      configured: current.configured,
      configuredHarnesses: [...current.configuredHarnesses],
      managedByTokenHarness: current.managedByTokenHarness,
      verification,
      health,
      update: current.update,
      updateAvailableVersion: current.updateAvailableVersion,
      warnings: [...current.warnings],
    };
    return { ...merged, nextAction: stackNextAction(merged) };
  });
  const present = components.filter((component) => component.detectedState !== 'absent');
  const state: GuideOverview['stack']['state'] =
    present.length === 0
      ? 'empty'
      : present.some((component) => component.health === 'attention') ||
          cached.unattributedDrift.length > 0
        ? 'attention'
        : present.every(
              (component) =>
                component.health === 'healthy' &&
                component.nextAction === null &&
                (component.update === 'current' || component.update === 'pinned'),
            )
          ? 'healthy'
          : 'incomplete';
  return { components, unattributedDrift: [...cached.unattributedDrift], state };
}
'''
http = http.replace(marker, "\n" + merge_fn + marker, 1)
endpoint_marker = "      if (url.pathname === '/api/verify') {"
if http.count(endpoint_marker) != 1:
    raise SystemExit("guided-http.ts: verify endpoint marker mismatch")
endpoint = r'''      if (url.pathname === '/api/update-check') {
        if (body === null || typeof body !== 'object' || Array.isArray(body))
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const data = body as Record<string, unknown>;
        if (
          Object.keys(data).some((key) => key !== 'period') ||
          (data['period'] !== undefined && !['all', '7d', '30d'].includes(String(data['period'])))
        )
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const result = await input.service.checkUpdates();
        const requested = data['period'] as GuidePeriod | undefined;
        let responseResult = result;
        if (result.stack !== undefined && requested !== undefined) {
          const cached = overviewCache.get(requested);
          if (cached !== undefined) {
            const overview = JSON.parse(cached.body) as GuideOverview;
            const stack = mergeUpdatedStack(overview.stack, result.stack);
            overviewCache.set(requested, {
              ...cached,
              body: JSON.stringify({ ...overview, stack }),
            });
            responseResult = { ...result, stack };
          }
        }
        // Update discovery is intentionally on-demand and read-only. Keep all other period-specific
        // evidence hot; only the stack update/version fields are replaced.
        send(200, JSON.stringify(responseResult));
        return;
      }
'''
http = http.replace(endpoint_marker, endpoint + endpoint_marker, 1)
http_path.write_text(http)

# Put the control next to the product object it observes.
replace(
    "apps/cli/src/guided-assets.ts",
    '<div class="section-title"><div><h2>Your optimization stack</h2><p>The components that actually make up your current efficiency stack. Installed, verified, measured and health state stay separate so a configured tool is never mistaken for a proven result.</p></div></div>',
    '<div class="section-title"><div><h2>Your optimization stack</h2><p>The components that actually make up your current efficiency stack. Installed, verified, measured and health state stay separate so a configured tool is never mistaken for a proven result.</p></div><div class="inline-actions"><button id="update-check" class="secondary" type="button" disabled>Check updates</button></div></div>',
)
replace(
    "apps/cli/src/guided-assets.ts",
    "This dashboard session only. Verification is read-only; changes always require a preview and approval.",
    "This dashboard session only. Verification and update checks are read-only; changes always require a preview and approval.",
)

# Main UI owns CSRF/session and the explicit user gesture.
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    "document.querySelectorAll('[data-operation],#setup,#verify,#undo,#refresh,#task-review').forEach(element => {",
    "document.querySelectorAll('[data-operation],#setup,#verify,#update-check,#undo,#refresh,#task-review').forEach(element => {",
)
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    "  $('live-status').textContent = value ? 'Applying a reviewed operation…' : 'No changes run in the background';\n}",
    """  $('live-status').textContent = value ? 'Applying a reviewed operation…' : 'No changes run in the background';
  if (!value && current)
    $('update-check').disabled = !(current.stack?.components || []).some(
      component => component.detectedState !== 'absent',
    );
}""",
)
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    """async function verify() {
  if (working || !csrf) return;
  showDialog('Checking integrations');
  setLocked(true);
  $('review-content').append(node('p', 'This is read-only. No agent setting will be changed.'));
  try {
    renderResult(await request('/api/verify', {}));
  } catch (e) {
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
    activity();
  }
}
""",
    """async function verify() {
  if (working || !csrf) return;
  showDialog('Checking integrations');
  setLocked(true);
  $('review-content').append(node('p', 'This is read-only. No agent setting will be changed.'));
  try {
    renderResult(await request('/api/verify', {}));
  } catch (e) {
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
    activity();
  }
}
async function checkUpdates() {
  if (working || !csrf) return;
  showDialog('Checking optimizer updates');
  setLocked(true);
  $('review-content').append(
    node('p', 'This checks provider channels only. No provider will be installed or updated.'),
  );
  try {
    renderResult(await request('/api/update-check', {}));
  } catch (e) {
    $('review-error').textContent = e.message;
    $('review-error').hidden = false;
  } finally {
    setLocked(false);
    activity();
  }
}
""",
)
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    "  renderNotices(data);\n  $('export').disabled = false;",
    """  renderNotices(data);
  $('update-check').disabled = !(data.stack?.components || []).some(
    component => component.detectedState !== 'absent',
  );
  $('export').disabled = false;""",
)
replace(
    "apps/cli/src/guided-dashboard-client.ts",
    "$('verify').addEventListener('click', verify);",
    "$('verify').addEventListener('click', verify);\n$('update-check').addEventListener('click', checkUpdates);",
)

# Supplementary stack renderer keeps the selected evidence period hot after the check.
replace(
    "apps/cli/src/guided-stack-client.ts",
    "    if (next.kind === 'review-health') return proxyButton('tab-activity', 'Review health evidence');\n    return null;",
    "    if (next.kind === 'review-health') return proxyButton('tab-activity', 'Review health evidence');\n    if (next.kind === 'review-update') return proxyButton('update-check', 'Recheck updates');\n    return null;",
)
replace(
    "apps/cli/src/guided-stack-client.ts",
    "    const verifyRequest = target.includes('/api/verify');\n    if (verifyRequest && args[1] && typeof args[1] === 'object') {",
    """    const verifyRequest = target.includes('/api/verify');
    const updateRequest = target.includes('/api/update-check');
    const stackObservationRequest = verifyRequest || updateRequest;
    if (stackObservationRequest && args[1] && typeof args[1] === 'object') {""",
)
replace(
    "apps/cli/src/guided-stack-client.ts",
    "      if (response.ok && (target.includes('/api/overview') || verifyRequest)) {",
    "      if (response.ok && (target.includes('/api/overview') || stackObservationRequest)) {",
)
replace(
    "apps/cli/src/guided-stack-client.ts",
    """          const period = verifyRequest
            ? selectedPeriod()
            : (new URL(target, window.location.href).searchParams.get('period') ?? 'all');""",
    """          const period = stackObservationRequest
            ? selectedPeriod()
            : (new URL(target, window.location.href).searchParams.get('period') ?? 'all');""",
)

# Release-readiness gates implemented by the outcome-first dashboard + optimization-stack slices.
replace(
    "docs/release-readiness.md",
    """- [ ] Dashboard displays paired allowance and quality value when available and blocks unsupported claims.
- [ ] The primary UI can present **Your optimization stack**: component, version, category, health,
      verification state, measured value, quality confidence and useful next action.""",
    """- [x] Dashboard displays paired allowance and quality value when available and blocks unsupported claims.
- [x] The primary UI can present **Your optimization stack**: component, version, category, health,
      verification state, measured value, quality confidence and useful next action.""",
)
replace(
    "docs/release-readiness.md",
    """- [ ] The app can detect meaningful component/harness version drift and explain whether the current
      stack is still reviewed, needs verification, or has a reviewed update available.""",
    """- [x] The app can detect meaningful component/harness version drift and explain whether the current
      stack is still reviewed, needs verification, or has a reviewed update available.""",
)

Path("apps/cli/test/guided-update-check.test.ts").write_text(r'''import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { it } from 'node:test';

import {
  commandResult,
  harnessId,
  providerId,
  toEnvelope,
  type CliEnvelope,
  type DoctorReport,
  type UpdateReport,
} from '@token-harness/core';
import { GuideService, type GuideCall, type GuideOverview } from '../src/guided.js';
import { GUIDE_HTML, GUIDE_JS, GUIDE_STACK_JS } from '../src/guided-assets.js';
import { createGuideHandler } from '../src/guided-http.js';

const platform = {
  os: 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
} as const;
const CLAUDE = harnessId('claude');
const RTK = providerId('rtk');

function envelope<T>(command: string, data: T): CliEnvelope<T> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}

it('checks updates only on demand, keeps the period cache hot, and expires evidence on version drift', async () => {
  const calls: string[][] = [];
  let providerVersion = '0.44.0';
  const doctor = (): DoctorReport => ({
    platform,
    problemCount: 0,
    providers: [
      {
        providerId: RTK,
        state: 'configured',
        version: providerVersion,
        executable: '/tools/rtk',
        installationChannel: 'cargo',
        versionVerdict: 'in-range',
        configuredHarnesses: [CLAUDE],
        unmanagedHarnessesConfigured: [],
        supportsUnmanagedHarnesses: false,
        managedByTokenHarness: false,
        assignableHarnesses: [CLAUDE],
        evidence: [],
        warnings: [],
      },
    ],
    harnesses: [
      {
        harnessId: CLAUDE,
        state: 'configured',
        version: '2.1.261',
        versionVerdict: 'in-range',
        configPath: null,
        declaredVerificationTier: 'config-only',
        evidence: [],
        warnings: [],
      },
    ],
  });
  const update = (): UpdateReport => ({
    providers: [
      {
        providerId: RTK,
        installed: providerVersion,
        available: '0.45.0',
        channel: 'cargo',
        verdict: providerVersion === '0.44.0' ? 'upgradable' : 'current',
        pin: null,
      },
    ],
    network: ['crates.io'],
    execution: {
      planId: null,
      transactionId: null,
      fromStoredPlan: false,
      outcome: providerVersion === '0.44.0' ? 'confirmation-required' : 'nothing-to-do',
      results: [],
      unrestored: [],
      receiptId: null,
    },
  });
  const call: GuideCall = async <T>(args: readonly string[]) => {
    calls.push([...args]);
    const command = args[0] ?? '';
    if (command === 'doctor') return envelope(command, doctor() as T);
    if (command === 'update') return envelope(command, update() as T);
    return envelope(command, null as T);
  };

  const service = new GuideService(call, () => 0, () => 'ticket');
  const token = 'a'.repeat(64);
  let authority = '';
  const server = createServer(createGuideHandler({ service, token, authority: () => authority }));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  authority = `127.0.0.1:${address.port}`;
  const origin = `http://${authority}`;

  try {
    const first = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(first.status, 200);
    const initial = (await first.json()) as GuideOverview;
    assert.equal(initial.stack.components[0]?.update, 'not-checked');
    assert.equal(
      calls.filter((args) => args[0] === 'update').length,
      0,
      'opening the UI must not poll update channels',
    );
    const afterOverview = calls.length;

    const checked = await fetch(`${origin}/api/update-check`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        'X-Token-Harness-CSRF': token,
      },
      body: JSON.stringify({ period: 'all' }),
    });
    assert.equal(checked.status, 200);
    const result = (await checked.json()) as { ok: boolean; stack?: GuideOverview['stack'] };
    assert.equal(result.ok, true);
    assert.equal(result.stack?.components[0]?.update, 'available');
    assert.equal(result.stack?.components[0]?.updateAvailableVersion, '0.45.0');
    assert.deepEqual(calls.filter((args) => args[0] === 'update'), [['update']]);
    assert.ok(
      calls.every((args) => !args.includes('--yes')),
      'the dashboard check must never request confirmation',
    );
    const afterCheck = calls.length;
    assert.ok(afterCheck > afterOverview);

    const cached = await fetch(`${origin}/api/overview?period=all`);
    assert.equal(cached.status, 200);
    const cachedOverview = (await cached.json()) as GuideOverview;
    assert.equal(cachedOverview.stack.components[0]?.update, 'available');
    assert.equal(
      calls.length,
      afterCheck,
      'reading the checked stack must not reload allowance, context, or metrics',
    );

    providerVersion = '0.45.0';
    const refreshed = await fetch(`${origin}/api/overview?period=all&refresh=1`);
    assert.equal(refreshed.status, 200);
    const changed = (await refreshed.json()) as GuideOverview;
    assert.equal(changed.stack.components[0]?.version, '0.45.0');
    assert.equal(
      changed.stack.components[0]?.update,
      'not-checked',
      'update evidence must expire when the stack fingerprint changes',
    );
    assert.equal(
      calls.filter((args) => args[0] === 'update').length,
      1,
      'refresh must not silently recheck channels',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('exposes one explicit update control and routes it through the read-only endpoint', () => {
  assert.match(GUIDE_HTML, /id="update-check"[^>]*>Check updates<\/button>/);
  assert.match(GUIDE_JS, /request\('\/api\/update-check', \{\}\)/);
  assert.match(GUIDE_STACK_JS, /stackObservationRequest = verifyRequest \|\| updateRequest/);
  assert.doesNotMatch(GUIDE_JS, /update-check[^\n]+--yes/);
});
''')
