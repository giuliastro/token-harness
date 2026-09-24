/** Smart routing setup, observation, and local CCR usage reporting. */

import { createHash } from 'node:crypto';

import {
  CCR_REVIEWED_VERSION,
  CcrManagementClient,
  CcrManagementError,
  addCcrSmartRoutingRule,
  ccrSmartRoutingRuleId,
  createCcrSmartRoutingRule,
  createCcrSmartRoutingScript,
  isExactCcrSmartRoutingRule,
  isSameCcrConfig,
  readCcrVersion,
  removeOwnedCcrSmartRoutingRule,
  resolveCcrManagementUrl,
} from '@token-harness/adapters';
import {
  EXIT_CODES,
  SMART_ROUTING_EVENT_PREFIX,
  SMART_ROUTING_EVENT_RETENTION_LIMIT,
  aggregateSmartRoutingEvents,
  commandResult,
  diagnostic,
  isSmartRoutingDecisionEvent,
  resolveMetricsWindow,
  type CommandResult,
  type SmartRoutingDecisionEvent,
  type SmartRoutingHarness,
  type SmartRoutingMetricsReport,
  type SmartRoutingMode,
} from '@token-harness/core';
import type { CommandContext } from './context.js';
import { observeCcrUsage, type CcrUsageReport } from './routing-usage.js';

export type SmartRoutingCommandReport =
  | {
      kind: 'ccr-script';
      harnessId: SmartRoutingHarness;
      mode: SmartRoutingMode;
      telemetryDirectory: string;
      script: string;
    }
  | {
      kind: 'metrics';
      since: string;
      until: string;
      metrics: SmartRoutingMetricsReport;
      ccrUsage?: CcrUsageReport;
    }
  | {
      kind: 'ccr-configuration';
      action: 'configure' | 'rollback';
      state: 'preview' | 'configured' | 'already-configured' | 'rolled-back' | 'already-absent';
      harnessId: SmartRoutingHarness;
      mode: SmartRoutingMode;
      ccrVersion: string;
      gatewayState: string;
      ruleId: string;
      scriptPath: string;
      managementEndpoint: string;
    };

interface CcrOwnershipReceipt {
  schemaVersion: 1;
  status: 'pending' | 'active';
  harnessId: SmartRoutingHarness;
  mode: SmartRoutingMode;
  ruleId: string;
  scriptPath: string;
  scriptSha256: string;
  installedAt: string;
}

interface CcrState {
  client: CcrManagementClient;
  endpoint: string;
  version: string;
  config: Record<string, unknown>;
  gatewayState: string;
}

function safeGatewayState(value: unknown): string {
  if (!isJsonRecord(value) || typeof value['state'] !== 'string') return 'unknown';
  const state = value['state'];
  return ['running', 'stopped', 'starting', 'stopping', 'error'].includes(state)
    ? state
    : 'unknown';
}

function isSmartRoutingHarness(value: string | null): value is SmartRoutingHarness {
  return value === 'claude' || value === 'codex';
}

function error(
  code: string,
  message: string,
  remediation: string,
): CommandResult<SmartRoutingCommandReport> {
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES['usage-error'],
    diagnostics: [diagnostic({ severity: 'error', code, message, remediation })],
  });
}

function ccrFailure(errorValue: unknown): { code: string; message: string; remediation: string } {
  if (!(errorValue instanceof CcrManagementError)) {
    return {
      code: 'ccr-management-failed',
      message: 'CCR management operation failed',
      remediation: 'Check the local CCR management service and repeat the command',
    };
  }
  const rows: Record<
    CcrManagementError['failure'],
    { code: string; message: string; remediation: string }
  > = {
    'endpoint-invalid': {
      code: 'ccr-endpoint-not-local',
      message: 'CCR management URL must use a loopback address on this machine',
      remediation: 'Use CCR_WEB_URL=http://127.0.0.1:3458 or another local loopback port',
    },
    'token-missing': {
      code: 'ccr-auth-token-required',
      message: 'CCR Web RPC authentication is not configured for Token Harness',
      remediation:
        'Set CCR_WEB_AUTH_TOKEN for both CCR and Token Harness, and optionally CCR_WEB_URL; the token is never printed or stored',
    },
    unreachable: {
      code: 'ccr-management-unreachable',
      message: 'The local CCR management service could not be reached',
      remediation:
        'Start CCR Web Management on this machine and set CCR_WEB_URL to its loopback address',
    },
    unauthorized: {
      code: 'ccr-management-unauthorized',
      message: 'CCR rejected the local management token',
      remediation: 'Use the same CCR_WEB_AUTH_TOKEN in the CCR service and Token Harness process',
    },
    'method-unavailable': {
      code: 'ccr-management-api-unsupported',
      message: 'This CCR build does not expose the reviewed management operation',
      remediation: `Use CCR ${CCR_REVIEWED_VERSION} for managed setup, or add the exported rule through CCR Routing manually`,
    },
    'config-drift': {
      code: 'ccr-config-changed-during-operation',
      message: 'CCR configuration changed while Token Harness was preparing the rule update',
      remediation: 'Review the latest CCR configuration and retry from a fresh preview',
    },
    'invalid-response': {
      code: 'ccr-management-response-invalid',
      message: 'CCR returned an unsupported or oversized management response',
      remediation: 'Check the CCR version and retry with a local CCR service',
    },
    'request-failed': {
      code: 'ccr-management-operation-failed',
      message: 'CCR could not complete the management operation',
      remediation: 'Review CCR status and retry; Token Harness did not print CCR response contents',
    },
  };
  return rows[errorValue.failure];
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function receiptPath(context: CommandContext, harness: SmartRoutingHarness): string {
  const fs = context.adapters!.fs;
  return fs.join(stateDirectory(context), `ccr-ownership-${harness}.json`);
}

function scriptDirectory(context: CommandContext): string {
  return context.adapters!.fs.join(stateDirectory(context), 'ccr-scripts');
}

function scriptPath(context: CommandContext, harness: SmartRoutingHarness): string {
  return context.adapters!.fs.join(scriptDirectory(context), `smart-routing-${harness}.js`);
}

function stateDirectory(context: CommandContext): string {
  return context.adapters!.fs.join(context.stateRoot!, 'smart-routing');
}

function scriptHash(script: string): string {
  return createHash('sha256').update(script, 'utf8').digest('hex');
}

async function readOwnership(
  context: CommandContext,
  harness: SmartRoutingHarness,
): Promise<CcrOwnershipReceipt | null> {
  const path = receiptPath(context, harness);
  try {
    const bytes = await context.adapters!.fs.readFile(path);
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      isJsonRecord(value) &&
      value['schemaVersion'] === 1 &&
      (value['status'] === 'pending' || value['status'] === 'active') &&
      value['harnessId'] === harness &&
      (value['mode'] === 'shadow' || value['mode'] === 'conservative') &&
      value['ruleId'] === ccrSmartRoutingRuleId(harness) &&
      typeof value['scriptPath'] === 'string' &&
      /^[a-f0-9]{64}$/.test(String(value['scriptSha256'])) &&
      typeof value['installedAt'] === 'string'
    ) {
      return value as unknown as CcrOwnershipReceipt;
    }
  } catch {
    return null;
  }
  return null;
}

async function writeJson(context: CommandContext, path: string, value: unknown): Promise<void> {
  await context.adapters!.fs.writeFile(
    path,
    new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
  );
}

async function cleanupUnappliedCcrFiles(
  context: CommandContext,
  harness: SmartRoutingHarness,
  ownership: CcrOwnershipReceipt,
): Promise<void> {
  const fs = context.adapters!.fs;
  const receipt = await readOwnership(context, harness);
  if (
    receipt !== null &&
    receipt.status === 'pending' &&
    receipt.scriptPath === ownership.scriptPath &&
    receipt.scriptSha256 === ownership.scriptSha256
  ) {
    await fs.remove(receiptPath(context, harness)).catch(() => undefined);
  }
  const scriptBytes = await fs.readFile(ownership.scriptPath).catch(() => null);
  if (
    scriptBytes !== null &&
    scriptHash(new TextDecoder().decode(scriptBytes)) === ownership.scriptSha256
  ) {
    await fs.remove(ownership.scriptPath).catch(() => undefined);
  }
}

async function readCcrState(context: CommandContext): Promise<CcrState> {
  const baseUrl = resolveCcrManagementUrl(context.env?.['CCR_WEB_URL']);
  if (baseUrl === null) throw new CcrManagementError('endpoint-invalid');
  const client = new CcrManagementClient({
    baseUrl,
    ...(context.env?.['CCR_WEB_AUTH_TOKEN'] === undefined
      ? {}
      : { authToken: context.env['CCR_WEB_AUTH_TOKEN'] }),
    ...(context.ccrFetch === undefined ? {} : { fetcher: context.ccrFetch }),
  });
  const [appInfo, configValue, gatewayValue] = await Promise.all([
    client.call('getAppInfo'),
    client.call('getConfig'),
    client.call('getGatewayStatus'),
  ]);
  const version = readCcrVersion(appInfo);
  if (version !== CCR_REVIEWED_VERSION) {
    throw new CcrManagementError('method-unavailable');
  }
  if (!isJsonRecord(configValue) || !isJsonRecord(configValue['Router'])) {
    throw new CcrManagementError('invalid-response');
  }
  const gatewayState = safeGatewayState(gatewayValue);
  return { client, endpoint: baseUrl, version, config: configValue, gatewayState };
}

function validateRouteRuleResult(value: unknown): boolean {
  return isJsonRecord(value) && value['ok'] === true;
}

async function ccrConfiguration(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const fs = context.adapters?.fs;
  if (fs === undefined || context.stateRoot === null || !isSmartRoutingHarness(context.harness)) {
    return error(
      'ccr-configuration-context-required',
      'Managed CCR setup needs a local state directory and a Claude Code or Codex harness',
      'Pass `--harness claude` or `--harness codex` from a local Token Harness installation',
    );
  }
  const mode = context.routingMode ?? 'shadow';
  const harnessId = context.harness;
  const ruleId = ccrSmartRoutingRuleId(harnessId);
  const path = scriptPath(context, harnessId);
  const telemetryDirectory = stateDirectory(context);
  const script = createCcrSmartRoutingScript({
    harnessId,
    mode,
    telemetryDirectory,
    pathSeparator: context.platform.os === 'windows' ? '\\' : '/',
  });
  let ccr: CcrState;
  try {
    ccr = await readCcrState(context);
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['problems-found'],
      diagnostics: [diagnostic({ severity: 'error', ...issue })],
    });
  }

  const expectedRule = createCcrSmartRoutingRule(harnessId, path);
  const router = ccr.config['Router'];
  const rules = isJsonRecord(router) && Array.isArray(router['rules']) ? router['rules'] : null;
  if (rules === null) {
    return error(
      'ccr-routing-config-unavailable',
      'CCR configuration does not contain the reviewed routing-rule list',
      'Review CCR Routing manually and use `token-harness routing --script` to export the rule',
    );
  }
  const matching = rules.filter((item) => isJsonRecord(item) && item['id'] === ruleId);
  const owned = await readOwnership(context, harnessId);
  const ownershipStat = await fs.stat(receiptPath(context, harnessId));
  if (owned === null && ownershipStat !== null) {
    return error(
      'ccr-ownership-state-invalid',
      'The local CCR ownership path already contains unrecognized data and was left unchanged',
      'Inspect or move the local ownership file before retrying CCR setup',
    );
  }
  const targetFile = await fs.stat(path);
  if (matching.length > 0) {
    if (matching.length === 1 && isExactCcrSmartRoutingRule(matching[0], expectedRule) && owned) {
      const currentScript = await fs.readFile(path).catch(() => null);
      if (
        currentScript !== null &&
        scriptHash(new TextDecoder().decode(currentScript)) === owned.scriptSha256
      ) {
        if (owned.mode !== mode || owned.scriptSha256 !== scriptHash(script)) {
          return error(
            'ccr-route-mode-requires-rollback',
            `CCR is already configured in ${owned.mode} mode; changing the mode requires an explicit rollback first`,
            `Review the active routing rule, run \`token-harness routing --rollback-ccr --harness ${harnessId} --yes\`, then configure again in ${mode} mode`,
          );
        }
        return configurationResult(
          'configure',
          'already-configured',
          ccr,
          harnessId,
          mode,
          ruleId,
          path,
        );
      }
    }
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['precondition-drift'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'ccr-routing-rule-conflict',
          message: 'A CCR rule already uses the Token Harness rule id, so it was left unchanged',
          remediation: 'Inspect that rule in CCR Routing and remove or rename it before retrying',
        }),
      ],
    });
  }
  if (owned !== null) {
    return error(
      'ccr-ownership-state-drift',
      'Token Harness has an ownership receipt but the CCR rule is missing or changed',
      'Run `token-harness routing --rollback-ccr --harness <id> --yes` after reviewing the CCR state',
    );
  }
  if (targetFile !== null) {
    return error(
      'ccr-script-file-conflict',
      'The managed CCR script path already contains a file that Token Harness does not own',
      'Move that file or use the exported script with CCR Routing manually',
    );
  }

  if (!context.confirmed) {
    return configurationResult('configure', 'preview', ccr, harnessId, mode, ruleId, path, [
      diagnostic({
        severity: 'info',
        code: 'ccr-configure-preview',
        message: `CCR ${ccr.version} would receive one ${mode} Node.js routing rule for ${harnessId}`,
        path,
        remediation: `Review the rule and rerun with --yes to apply it; CCR may restart. This does not attach ${harnessId} to CCR: use an enabled CCR Agent Profile and verify requests in CCR logs. Rollback: \`token-harness routing --rollback-ccr --harness ${harnessId} --yes\``,
      }),
    ]);
  }

  let validation: unknown;
  try {
    validation = await ccr.client.call('validateRouteScript', [
      {
        script: {
          apiVersion: 1,
          language: 'javascript',
          source: script,
          timeoutMs: 2_000,
        },
      },
    ]);
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['problems-found'],
      diagnostics: [diagnostic({ severity: 'error', ...issue })],
    });
  }
  if (!validateRouteRuleResult(validation)) {
    return error(
      'ccr-script-validation-failed',
      'CCR did not validate the generated routing script',
      'No CCR or harness configuration was changed; inspect CCR compatibility and retry',
    );
  }

  const nextConfig = addCcrSmartRoutingRule(ccr.config, expectedRule);
  if (nextConfig === null) {
    return error(
      'ccr-routing-rule-conflict',
      'CCR routing rules changed or cannot accept a script rule',
      'Refresh CCR state and review existing rules before retrying',
    );
  }
  const now = context.now();
  const ownership: CcrOwnershipReceipt = {
    schemaVersion: 1,
    status: 'pending',
    harnessId,
    mode,
    ruleId,
    scriptPath: path,
    scriptSha256: scriptHash(script),
    installedAt: now,
  };
  let saveAttempted = false;
  try {
    await fs.createDirectory(telemetryDirectory);
    await fs.createDirectory(scriptDirectory(context));
    await writeJson(context, receiptPath(context, harnessId), ownership);
    await fs.writeFile(path, new TextEncoder().encode(script));
    const currentConfig = await ccr.client.call('getConfig');
    if (!isSameCcrConfig(currentConfig, ccr.config)) {
      throw new CcrManagementError('config-drift');
    }
    saveAttempted = true;
    await ccr.client.call('saveConfig', [nextConfig, { applyProfile: false }]);
    const afterConfig = await ccr.client.call('getConfig');
    const afterRouter = isJsonRecord(afterConfig) ? afterConfig['Router'] : null;
    const afterRules =
      isJsonRecord(afterRouter) && Array.isArray(afterRouter['rules']) ? afterRouter['rules'] : [];
    if (!afterRules.some((item) => isExactCcrSmartRoutingRule(item, expectedRule))) {
      throw new CcrManagementError('request-failed');
    }
    const activeOwnership: CcrOwnershipReceipt = { ...ownership, status: 'active' };
    await writeJson(context, receiptPath(context, harnessId), activeOwnership);
    const gatewayValue = await ccr.client.call('getGatewayStatus');
    const gatewayState = safeGatewayState(gatewayValue);
    const finalCcr = { ...ccr, gatewayState };
    return configurationResult('configure', 'configured', finalCcr, harnessId, mode, ruleId, path, [
      diagnostic({
        severity: gatewayState === 'running' ? 'info' : 'warning',
        code: gatewayState === 'running' ? 'ccr-config-verified' : 'ccr-gateway-not-running',
        message:
          gatewayState === 'running'
            ? 'CCR accepted the rule and its gateway reports running; live request routing has not been exercised'
            : `CCR saved and verified the rule, but its gateway reports ${gatewayState}`,
        path,
        remediation:
          gatewayState === 'running'
            ? 'Use shadow mode first, then inspect local decisions with `token-harness routing --route-metrics`'
            : 'Start or repair the CCR gateway, then verify it before sending a model request',
      }),
    ]);
  } catch (errorValue) {
    if (!saveAttempted) await cleanupUnappliedCcrFiles(context, harnessId, ownership);
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['problems-found'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: issue.code,
          message: saveAttempted
            ? `${issue.message}; the ownership receipt was retained for safe recovery`
            : `${issue.message}; CCR configuration was not changed`,
          ...(saveAttempted ? { path: receiptPath(context, harnessId) } : {}),
          remediation: saveAttempted
            ? `Run \`token-harness routing --rollback-ccr --harness ${harnessId} --yes\` to remove only the owned rule, or inspect the ownership receipt first`
            : 'Resolve the local or CCR issue and start again from a new preview',
        }),
      ],
    });
  }
}

function configurationResult(
  action: 'configure' | 'rollback',
  state: 'preview' | 'configured' | 'already-configured' | 'rolled-back' | 'already-absent',
  ccr: CcrState,
  harnessId: SmartRoutingHarness,
  mode: SmartRoutingMode,
  ruleId: string,
  path: string,
  diagnostics: ReturnType<typeof diagnostic>[] = [],
): CommandResult<SmartRoutingCommandReport> {
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES.ok,
    data: {
      kind: 'ccr-configuration',
      action,
      state,
      harnessId,
      mode,
      ccrVersion: ccr.version,
      gatewayState: ccr.gatewayState,
      ruleId,
      scriptPath: path,
      managementEndpoint: ccr.endpoint,
    },
    diagnostics,
  });
}

async function rollbackCcrConfiguration(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const fs = context.adapters?.fs;
  if (fs === undefined || context.stateRoot === null || !isSmartRoutingHarness(context.harness)) {
    return error(
      'ccr-rollback-context-required',
      'CCR rollback needs the local ownership receipt and a Claude Code or Codex harness',
      'Pass the same `--harness` used for CCR configuration',
    );
  }
  const harnessId = context.harness;
  const ownership = await readOwnership(context, harnessId);
  if (ownership === null) {
    return error(
      'ccr-ownership-receipt-missing',
      'Token Harness has no valid CCR ownership receipt for this harness',
      'Review the rule in CCR manually; Token Harness removes only rules it recorded as owned',
    );
  }
  let ccr: CcrState;
  try {
    ccr = await readCcrState(context);
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['problems-found'],
      diagnostics: [diagnostic({ severity: 'error', ...issue })],
    });
  }
  const expectedRule = createCcrSmartRoutingRule(harnessId, ownership.scriptPath);
  const rules =
    isJsonRecord(ccr.config['Router']) && Array.isArray(ccr.config['Router']['rules'])
      ? ccr.config['Router']['rules']
      : [];
  const ownedRule = rules.find((item) => isJsonRecord(item) && item['id'] === ownership.ruleId);
  if (ownedRule === undefined) {
    if (!context.confirmed) {
      return configurationResult(
        'rollback',
        'already-absent',
        ccr,
        harnessId,
        ownership.mode,
        ownership.ruleId,
        ownership.scriptPath,
      );
    }
    const bytes = await fs.readFile(ownership.scriptPath).catch(() => null);
    if (bytes !== null && scriptHash(new TextDecoder().decode(bytes)) === ownership.scriptSha256) {
      await fs.remove(ownership.scriptPath);
    }
    await fs.remove(receiptPath(context, harnessId));
    return configurationResult(
      'rollback',
      'already-absent',
      ccr,
      harnessId,
      ownership.mode,
      ownership.ruleId,
      ownership.scriptPath,
    );
  }
  if (!isExactCcrSmartRoutingRule(ownedRule, expectedRule)) {
    return error(
      'ccr-owned-rule-drift',
      'The CCR rule changed after Token Harness installed it, so rollback left it untouched',
      'Review the rule in CCR Routing and restore or remove it manually before retrying',
    );
  }
  if (!context.confirmed) {
    return configurationResult(
      'rollback',
      'preview',
      ccr,
      harnessId,
      ownership.mode,
      ownership.ruleId,
      ownership.scriptPath,
      [
        diagnostic({
          severity: 'info',
          code: 'ccr-rollback-preview',
          message:
            'Rollback would remove the exact Token Harness rule and script while preserving other CCR settings',
          path: ownership.scriptPath,
          remediation: 'Review the change and rerun with --yes to apply it',
        }),
      ],
    );
  }
  const nextConfig = removeOwnedCcrSmartRoutingRule(ccr.config, ownership.ruleId, expectedRule);
  if (nextConfig === null) {
    return error(
      'ccr-owned-rule-drift',
      'CCR rules changed while rollback was being prepared',
      'Refresh the CCR state and retry after reviewing the rule list',
    );
  }
  try {
    const currentConfig = await ccr.client.call('getConfig');
    if (!isSameCcrConfig(currentConfig, ccr.config)) {
      throw new CcrManagementError('config-drift');
    }
    await ccr.client.call('saveConfig', [nextConfig, { applyProfile: false }]);
    const after = await ccr.client.call('getConfig');
    const afterRules =
      isJsonRecord(after) &&
      isJsonRecord(after['Router']) &&
      Array.isArray(after['Router']['rules'])
        ? after['Router']['rules']
        : [];
    if (afterRules.some((item) => isJsonRecord(item) && item['id'] === ownership.ruleId)) {
      throw new CcrManagementError('request-failed');
    }
    const gatewayValue = await ccr.client.call('getGatewayStatus');
    const gatewayState = safeGatewayState(gatewayValue);
    const bytes = await fs.readFile(ownership.scriptPath).catch(() => null);
    if (bytes !== null && scriptHash(new TextDecoder().decode(bytes)) === ownership.scriptSha256) {
      await fs.remove(ownership.scriptPath);
    }
    await fs.remove(receiptPath(context, harnessId));
    return configurationResult(
      'rollback',
      'rolled-back',
      { ...ccr, gatewayState },
      harnessId,
      ownership.mode,
      ownership.ruleId,
      ownership.scriptPath,
      [
        diagnostic({
          severity: 'info',
          code: 'ccr-rollback-verified',
          message: 'CCR no longer contains the owned rule; other routing rules were preserved',
          path: ownership.scriptPath,
          remediation: 'No further action is required',
        }),
      ],
    );
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['problems-found'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: issue.code,
          message: `${issue.message}; the ownership receipt was retained for another rollback attempt`,
          path: receiptPath(context, harnessId),
          remediation: 'Check CCR status and retry the rollback after it is reachable',
        }),
      ],
    });
  }
}

export async function runSmartRouting(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const wantsScript = context.routingScript === true;
  const wantsMetrics = context.routingMetrics === true;
  const wantsCcrConfigure = context.routingCcrConfigure === true;
  const wantsCcrRollback = context.routingCcrRollback === true;
  const requestedActions = [wantsScript, wantsMetrics, wantsCcrConfigure, wantsCcrRollback].filter(
    Boolean,
  ).length;
  if (requestedActions !== 1) {
    return error(
      'routing-action-required',
      'Choose one Smart Model Routing action',
      'Use `token-harness routing --script --harness claude`, `--configure-ccr`, `--rollback-ccr`, or `--route-metrics`',
    );
  }
  if (context.routingPrune === true && !wantsMetrics) {
    return error(
      'routing-prune-requires-metrics',
      '`--prune` is available only with the routing metrics action',
      'Use `token-harness routing --route-metrics --prune`',
    );
  }
  if (context.routingCcrUsage === true && !wantsMetrics) {
    return error(
      'ccr-usage-requires-metrics',
      '`--ccr-usage` is available only with routing metrics',
      'Use `token-harness routing --route-metrics --ccr-usage`',
    );
  }
  if (context.routingMode === 'conservative' && !wantsScript && !wantsCcrConfigure) {
    return error(
      'routing-mode-requires-configuration',
      '`--route-mode` applies only when exporting or configuring a CCR rule',
      'Use `token-harness routing --configure-ccr --harness codex --route-mode conservative`',
    );
  }
  if (wantsCcrConfigure) return ccrConfiguration(context);
  if (wantsCcrRollback) return rollbackCcrConfiguration(context);

  const fs = context.adapters?.fs;
  const stateRoot = context.stateRoot;
  if (fs === undefined || stateRoot === null) {
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES['unsupported-environment'],
      diagnostics: [
        diagnostic({
          severity: 'error',
          code: 'routing-state-unavailable',
          message: 'Smart Model Routing requires the protected local Token Harness state directory',
          remediation: 'Resolve the local state directory with `token-harness doctor`',
        }),
      ],
    });
  }

  const telemetryDirectory = fs.join(stateRoot, 'smart-routing');
  if (wantsScript) {
    if (!isSmartRoutingHarness(context.harness)) {
      return error(
        'routing-harness-required',
        'CCR script generation needs Claude Code or Codex as its harness',
        'Pass `--harness claude` or `--harness codex`',
      );
    }
    await fs.createDirectory(telemetryDirectory);
    const script = createCcrSmartRoutingScript({
      harnessId: context.harness,
      mode: context.routingMode ?? 'shadow',
      telemetryDirectory,
      pathSeparator: context.platform.os === 'windows' ? '\\' : '/',
    });
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'ccr-script',
        harnessId: context.harness,
        mode: context.routingMode ?? 'shadow',
        telemetryDirectory,
        script,
      },
    });
  }

  const resolved = resolveMetricsWindow({
    since: context.since,
    until: context.until,
    now: context.now(),
  });
  if (!resolved.ok) {
    return error(
      'invalid-routing-window',
      resolved.failure === 'start-after-end'
        ? `The routing metrics window is empty: ${resolved.detail}`
        : `${JSON.stringify(resolved.detail)} is not a duration such as \`7d\` or a date such as \`2026-09-01\``,
      'Pass `--since 7d`, or `--since 2026-09-01 --until 2026-09-24`',
    );
  }

  const directoryEntries = (await fs.readDirectory(telemetryDirectory))
    .filter((name) =>
      new RegExp(`^${SMART_ROUTING_EVENT_PREFIX}\\d{13}-[a-z0-9]+\\.json$`).test(name),
    )
    .sort();
  let prunedRecordCount = 0;
  if (
    context.routingPrune === true &&
    directoryEntries.length > SMART_ROUTING_EVENT_RETENTION_LIMIT
  ) {
    const removeCount = directoryEntries.length - SMART_ROUTING_EVENT_RETENTION_LIMIT;
    for (const name of directoryEntries.slice(0, removeCount)) {
      await fs.remove(fs.join(telemetryDirectory, name));
    }
    prunedRecordCount = removeCount;
  }
  const retainedNames =
    context.routingPrune === true ? directoryEntries.slice(prunedRecordCount) : directoryEntries;
  const events: SmartRoutingDecisionEvent[] = [];
  let malformedRecordCount = 0;
  for (const name of retainedNames) {
    try {
      const content = new TextDecoder().decode(
        await fs.readFile(fs.join(telemetryDirectory, name)),
      );
      const parsed: unknown = JSON.parse(content);
      if (!isSmartRoutingDecisionEvent(parsed)) {
        malformedRecordCount += 1;
        continue;
      }
      const timestamp = Date.parse(parsed.timestamp);
      if (!Number.isFinite(timestamp)) {
        malformedRecordCount += 1;
        continue;
      }
      if (timestamp < Date.parse(resolved.window.sinceInstant)) continue;
      if (timestamp >= Date.parse(resolved.window.untilInstant)) continue;
      if (context.harness !== null && parsed.harnessId !== context.harness) continue;
      events.push(parsed);
    } catch {
      malformedRecordCount += 1;
    }
  }

  const metrics = aggregateSmartRoutingEvents({ events, malformedRecordCount, prunedRecordCount });
  let ccrUsage: CcrUsageReport | undefined;
  const diagnostics =
    events.length === 0 && malformedRecordCount === 0
      ? [
          diagnostic({
            severity: 'info' as const,
            code: 'routing-decisions-unavailable',
            message: 'No CCR routing decisions are stored for this window',
            remediation:
              'Generate a CCR rule with `token-harness routing --script --harness codex` or configure one with `--configure-ccr`',
          }),
        ]
      : [];
  if (context.routingCcrUsage === true) {
    try {
      const observed = await observeCcrUsage({
        context,
        events,
        since: resolved.window.sinceInstant,
        until: resolved.window.untilInstant,
      });
      ccrUsage = observed.usage;
      if (observed.failedSessions > 0 || observed.usage.status === 'unavailable') {
        diagnostics.push(
          diagnostic({
            severity: 'warning',
            code:
              observed.usage.status === 'unavailable'
                ? 'ccr-usage-unavailable'
                : 'ccr-usage-partial',
            message:
              observed.usage.status === 'unavailable'
                ? 'CCR request usage could not be matched to any retained routing session'
                : `CCR usage was read for ${String(observed.usage.observedSessionCount)} of ${String(observed.usage.sessionCount)} sessions`,
            remediation:
              'Keep CCR request logging enabled, use the same local session, and rerun with a narrower time window',
          }),
        );
      }
    } catch (errorValue) {
      const issue = ccrFailure(errorValue);
      diagnostics.push(diagnostic({ severity: 'warning', ...issue }));
      ccrUsage = {
        status: 'unavailable',
        sessionCount: 0,
        observedSessionCount: 0,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        recordedCostUsd: null,
        byModel: [],
      };
    }
  }

  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES.ok,
    data: {
      kind: 'metrics',
      since: resolved.window.sinceInstant,
      until: resolved.window.untilInstant,
      metrics,
      ...(ccrUsage === undefined ? {} : { ccrUsage }),
    },
    diagnostics,
  });
}
