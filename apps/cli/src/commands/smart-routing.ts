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
import { ensureManagedCcrRuntime, resolveManagedCcr } from './ccr-runtime.js';

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
      kind: 'status';
      harnessId: SmartRoutingHarness;
      state: 'off' | 'shadow' | 'conservative' | 'attention';
      mode: SmartRoutingMode | null;
      gatewayState: string;
      profileId: string | null;
      launchCommand: string | null;
      detail: string;
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
      profileId?: string | null;
      launchCommand?: string | null;
    }
  | {
      kind: 'ccr-lifecycle';
      action: 'install' | 'update' | 'start';
      state: 'preview' | 'installed' | 'updated' | 'started' | 'already-current';
      version: string;
      packagePath: string;
      executablePath: string;
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
  profileId?: string;
  profileSha256?: string;
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
        'Start the local CCR service or set CCR_WEB_AUTH_TOKEN and optionally CCR_WEB_URL; Token Harness never prints credentials, and managed credentials are stored only in protected local state',
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
      (value['profileId'] === undefined || typeof value['profileId'] === 'string') &&
      (value['profileSha256'] === undefined ||
        /^[a-f0-9]{64}$/.test(String(value['profileSha256']))) &&
      (value['profileId'] === undefined) === (value['profileSha256'] === undefined) &&
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
  const managed = await resolveManagedCcr(context);
  if (managed.kind === 'unavailable') throw new CcrManagementError('token-missing');
  const client = new CcrManagementClient({
    baseUrl: managed.endpoint,
    authToken: managed.token,
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
  return { client, endpoint: managed.endpoint, version, config: configValue, gatewayState };
}

function validateRouteRuleResult(value: unknown): boolean {
  return isJsonRecord(value) && value['ok'] === true;
}

interface CcrProfilePlan {
  profile: Record<string, unknown> | null;
  profileContainer: Record<string, unknown> | null;
  conflict: boolean;
  reason: string | null;
}

const OWNED_PROFILE_IDS: Record<SmartRoutingHarness, string> = {
  claude: 'token-harness-smart-routing-claude-v1',
  codex: 'token-harness-smart-routing-codex-v1',
};

function profileSlug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'provider'
  );
}

/** Use only an already imported, harness-native provider; never import or select new credentials. */
function planCcrProfile(
  config: Record<string, unknown>,
  harness: SmartRoutingHarness,
  selectedModel?: string,
): CcrProfilePlan {
  const profileContainer = isJsonRecord(config['profile']) ? config['profile'] : null;
  const profiles =
    profileContainer && Array.isArray(profileContainer['profiles'])
      ? profileContainer['profiles']
      : null;
  if (profileContainer === null || profiles === null || profileContainer['enabled'] === false) {
    return {
      profile: null,
      profileContainer,
      conflict: false,
      reason: 'CCR Agent Profiles are unavailable or disabled',
    };
  }
  const providerName = harness === 'claude' ? 'Claude Code API' : 'Codex API';
  const protocol = harness === 'claude' ? 'anthropic_messages' : 'openai_responses';
  const providers = Array.isArray(config['Providers']) ? config['Providers'] : [];
  const matches = providers.filter(
    (item) =>
      isJsonRecord(item) &&
      item['name'] === providerName &&
      item['type'] === protocol &&
      Array.isArray(item['models']) &&
      item['models'].some(
        (model) => typeof model === 'string' && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(model),
      ),
  );
  if (matches.length !== 1 || !isJsonRecord(matches[0])) {
    return {
      profile: null,
      profileContainer,
      conflict: false,
      reason:
        matches.length === 0
          ? `Import the existing ${providerName} login/provider in CCR before Token Harness can create a safe launcher profile`
          : `CCR has multiple ${providerName} providers; select the intended subscription account explicitly in CCR`,
    };
  }
  const provider = matches[0];
  const models = (provider['models'] as unknown[]).filter(
    (model): model is string =>
      typeof model === 'string' && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(model),
  );
  let model: string | undefined;
  const selectedModelValue = selectedModel?.trim();
  if (selectedModelValue) {
    if (!selectedModelValue.startsWith(`${providerName}/`)) {
      return {
        profile: null,
        profileContainer,
        conflict: false,
        reason:
          'TOKEN_HARNESS_ROUTING_PROFILE_MODEL must name a model from the matching CCR provider',
      };
    }
    const selectedId = selectedModelValue.slice(providerName.length + 1);
    if (models.includes(selectedId)) model = selectedId;
    else
      return {
        profile: null,
        profileContainer,
        conflict: false,
        reason:
          'TOKEN_HARNESS_ROUTING_PROFILE_MODEL is not present in the matching CCR provider model list',
      };
  }
  const providerDefault =
    typeof provider['defaultModel'] === 'string'
      ? provider['defaultModel']
      : typeof provider['model'] === 'string'
        ? provider['model']
        : null;
  if (model === undefined && providerDefault !== null) {
    const providerDefaultId = providerDefault.startsWith(`${providerName}/`)
      ? providerDefault.slice(providerName.length + 1)
      : providerDefault;
    if (models.includes(providerDefaultId)) model = providerDefaultId;
  }
  if (model === undefined && models.length === 1) model = models[0];
  if (model === undefined) {
    return {
      profile: null,
      profileContainer,
      conflict: false,
      reason: `${providerName} has multiple models; set TOKEN_HARNESS_ROUTING_PROFILE_MODEL to the exact Provider/model you want as the CCR CLI default`,
    };
  }
  const id = OWNED_PROFILE_IDS[harness];
  const profile: Record<string, unknown> = {
    agent: harness === 'claude' ? 'claude-code' : 'codex',
    enabled: true,
    id,
    model: `${providerName}/${model}`,
    name: `Token Harness ${harness === 'claude' ? 'Claude Code' : 'Codex'}`,
    providerId: typeof provider['id'] === 'string' ? provider['id'] : profileSlug(providerName),
    providerName,
    scope: 'ccr',
    surface: 'cli',
  };
  const existing = profiles.filter((item) => isJsonRecord(item) && item['id'] === id);
  if (existing.length > 0) {
    return {
      profile,
      profileContainer,
      conflict: true,
      reason: 'A CCR Agent Profile already uses the Token Harness profile id',
    };
  }
  return { profile, profileContainer, conflict: false, reason: null };
}

function configuredCcrModel(
  config: Record<string, unknown>,
  requested: string | undefined,
): string | null {
  const candidate = requested?.trim();
  if (candidate === undefined || !/^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(candidate)) return null;
  const providers = Array.isArray(config['Providers']) ? config['Providers'] : [];
  return providers.some(
    (provider) =>
      isJsonRecord(provider) &&
      typeof provider['name'] === 'string' &&
      Array.isArray(provider['models']) &&
      provider['models'].some(
        (model) => typeof model === 'string' && candidate === `${provider['name']}/${model}`,
      ),
  )
    ? candidate
    : null;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isJsonRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

function profileRows(config: Record<string, unknown>): unknown[] {
  const container = config['profile'];
  return isJsonRecord(container) && Array.isArray(container['profiles'])
    ? container['profiles']
    : [];
}

function withCcrProfile(
  config: Record<string, unknown>,
  profile: Record<string, unknown>,
): Record<string, unknown> | null {
  const container = config['profile'];
  if (
    !isJsonRecord(container) ||
    container['enabled'] === false ||
    !Array.isArray(container['profiles'])
  ) {
    return null;
  }
  if (container['profiles'].some((item) => isJsonRecord(item) && item['id'] === profile['id'])) {
    return null;
  }
  return {
    ...config,
    profile: { ...container, profiles: [profile, ...container['profiles']] },
  };
}

function withoutOwnedCcrProfile(
  config: Record<string, unknown>,
  profileId: string,
  expectedSha256: string,
): Record<string, unknown> | null {
  const container = config['profile'];
  if (!isJsonRecord(container) || !Array.isArray(container['profiles'])) return config;
  const matches = container['profiles'].filter(
    (item) => isJsonRecord(item) && item['id'] === profileId,
  );
  if (matches.length === 0) return config;
  if (matches.length !== 1 || scriptHash(stableJson(matches[0])) !== expectedSha256) return null;
  return {
    ...config,
    profile: {
      ...container,
      profiles: container['profiles'].filter(
        (item) => !(isJsonRecord(item) && item['id'] === profileId),
      ),
    },
  };
}

function isExpectedCcrProfile(
  value: unknown,
  expected: Record<string, unknown>,
): value is Record<string, unknown> {
  if (!isJsonRecord(value)) return false;
  const requiredKeys = [
    'agent',
    'enabled',
    'id',
    'model',
    'name',
    'providerId',
    'providerName',
    'scope',
    'surface',
  ];
  return requiredKeys.every((key) => stableJson(value[key]) === stableJson(expected[key]));
}

function ccrLaunchCommand(harness: SmartRoutingHarness): string {
  return `ccr "Token Harness ${harness === 'claude' ? 'Claude Code' : 'Codex'}"`;
}

function profilePlanDiagnostic(plan: CcrProfilePlan) {
  if (plan.reason === null) return null;
  return diagnostic({
    severity: 'warning',
    code: 'ccr-profile-not-created',
    message: plan.reason,
    remediation: `Resolve the CCR profile setup requirement and rerun routing setup; provider login/import and credential changes remain explicit CCR actions`,
  });
}

function routingStatusResult(
  harnessId: SmartRoutingHarness,
  state: 'off' | 'shadow' | 'conservative' | 'attention',
  detail: string,
  gatewayState = 'unknown',
  profileId: string | null = null,
): CommandResult<SmartRoutingCommandReport> {
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES.ok,
    data: {
      kind: 'status',
      harnessId,
      state,
      mode: state === 'shadow' || state === 'conservative' ? state : null,
      gatewayState,
      profileId,
      launchCommand: profileId === null ? null : ccrLaunchCommand(harnessId),
      detail,
    },
  });
}

async function smartRoutingStatus(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const fs = context.adapters?.fs;
  if (fs === undefined || context.stateRoot === null || !isSmartRoutingHarness(context.harness)) {
    return error(
      'routing-status-context-required',
      'Smart Model Routing status needs local state and a Claude Code or Codex harness',
      'Pass `--harness claude` or `--harness codex` from the local Token Harness installation',
    );
  }
  const harnessId = context.harness;
  const owned = await readOwnership(context, harnessId);
  let ccr: CcrState;
  try {
    ccr = await readCcrState(context);
  } catch {
    return owned === null
      ? routingStatusResult(harnessId, 'off', 'No Token Harness-owned routing configuration is active.')
      : routingStatusResult(
          harnessId,
          'attention',
          'Token Harness has routing ownership state, but the local CCR service cannot currently be verified.',
        );
  }

  const path = scriptPath(context, harnessId);
  const expectedRule = createCcrSmartRoutingRule(harnessId, path);
  const router = ccr.config['Router'];
  const rules = isJsonRecord(router) && Array.isArray(router['rules']) ? router['rules'] : [];
  const matching = rules.filter(
    (item) => isJsonRecord(item) && item['id'] === ccrSmartRoutingRuleId(harnessId),
  );

  if (owned === null) {
    return matching.length === 0
      ? routingStatusResult(
          harnessId,
          'off',
          'Smart Model Routing is off for this coding agent.',
          ccr.gatewayState,
        )
      : routingStatusResult(
          harnessId,
          'attention',
          'A routing rule uses the Token Harness id, but no matching ownership receipt exists.',
          ccr.gatewayState,
        );
  }

  const bytes = await fs.readFile(owned.scriptPath).catch(() => null);
  const scriptMatches =
    bytes !== null && scriptHash(new TextDecoder().decode(bytes)) === owned.scriptSha256;
  const ruleMatches =
    matching.length === 1 && isExactCcrSmartRoutingRule(matching[0], expectedRule);
  let profileMatches = true;
  if (owned.profileId !== undefined) {
    const profile = profileRows(ccr.config).find(
      (item) => isJsonRecord(item) && item['id'] === owned.profileId,
    );
    profileMatches =
      isJsonRecord(profile) &&
      owned.profileSha256 !== undefined &&
      scriptHash(stableJson(profile)) === owned.profileSha256;
  }

  if (!scriptMatches || !ruleMatches || !profileMatches) {
    return routingStatusResult(
      harnessId,
      'attention',
      'The owned routing rule, script or launcher profile no longer matches the recorded Token Harness state.',
      ccr.gatewayState,
      owned.profileId ?? null,
    );
  }

  return routingStatusResult(
    harnessId,
    owned.mode,
    owned.mode === 'shadow'
      ? 'Shadow routing is configured. Requests keep their selected model while local routing decisions are recorded.'
      : 'Conservative routing is configured. Eligible high-confidence simple requests may use the configured simple model.',
    ccr.gatewayState,
    owned.profileId ?? null,
  );
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

  const requestedProfileModel = context.env?.['TOKEN_HARNESS_ROUTING_PROFILE_MODEL'];
  const profilePlan = planCcrProfile(ccr.config, harnessId, requestedProfileModel);
  const profileModelWarning =
    requestedProfileModel?.trim() &&
    (profilePlan.profile === null || profilePlan.profile['model'] !== requestedProfileModel.trim())
      ? diagnostic({
          severity: 'warning',
          code: 'ccr-profile-model-not-configured',
          message:
            'TOKEN_HARNESS_ROUTING_PROFILE_MODEL did not match a model in the selected CCR provider and was not applied',
          remediation:
            'Set it to the exact Provider/model alias from CCR, then roll back and preview setup again',
        })
      : null;
  const requestedSimpleModel = context.env?.['TOKEN_HARNESS_ROUTING_SIMPLE_MODEL'];
  const configuredSimpleModel = configuredCcrModel(ccr.config, requestedSimpleModel);
  const simpleModelWarning =
    requestedSimpleModel?.trim() && configuredSimpleModel === null
      ? diagnostic({
          severity: 'warning',
          code: 'ccr-simple-model-not-configured',
          message:
            'TOKEN_HARNESS_ROUTING_SIMPLE_MODEL did not match a model in the selected CCR configuration and was not embedded',
          remediation:
            'Set it to the exact Provider/model alias from CCR, then roll back and preview setup again',
        })
      : null;
  const script = createCcrSmartRoutingScript({
    harnessId,
    mode,
    telemetryDirectory,
    pathSeparator: context.platform.os === 'windows' ? '\\' : '/',
    simpleModel: configuredSimpleModel,
  });

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
  const profileList =
    profilePlan.profileContainer && Array.isArray(profilePlan.profileContainer['profiles'])
      ? profilePlan.profileContainer['profiles']
      : [];
  const currentOwnedProfile = owned?.profileId
    ? profileList.find((item) => isJsonRecord(item) && item['id'] === owned.profileId)
    : undefined;
  const ownedProfileMatches =
    owned?.profileId === undefined ||
    (isJsonRecord(currentOwnedProfile) &&
      owned.profileSha256 === scriptHash(stableJson(currentOwnedProfile)));
  if (owned !== null && !ownedProfileMatches) {
    return error(
      'ccr-owned-profile-drift',
      'The Token Harness CCR profile changed or disappeared after setup, so configuration was left untouched',
      'Review the profile in CCR Agent Config; restore it or remove it manually before retrying',
    );
  }
  if (profilePlan.conflict && !owned?.profileId) {
    return error(
      'ccr-profile-id-conflict',
      'A CCR Agent Profile already uses the Token Harness profile id, so it was left unchanged',
      'Rename or remove that profile in CCR Agent Config before retrying',
    );
  }
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
        if (
          owned.profileId === undefined &&
          profilePlan.profile !== null &&
          !profilePlan.conflict
        ) {
          const profileConfig = withCcrProfile(ccr.config, profilePlan.profile);
          if (profileConfig === null) {
            return error(
              'ccr-profile-config-conflict',
              'CCR Agent Profile settings changed or cannot accept the Token Harness profile',
              'Review CCR Agent Config and retry from a new preview',
            );
          }
          if (!context.confirmed) {
            return configurationResult(
              'configure',
              'preview',
              ccr,
              harnessId,
              mode,
              ruleId,
              path,
              [
                diagnostic({
                  severity: 'info',
                  code: 'ccr-profile-preview',
                  message:
                    'The CCR routing rule is already owned; Token Harness would add its scoped CLI profile using the existing provider',
                  remediation: `Review the CCR-only profile and rerun with --yes. Launch it with ${ccrLaunchCommand(harnessId)}`,
                }),
              ],
              String(profilePlan.profile['id']),
              ccrLaunchCommand(harnessId),
            );
          }
          try {
            const currentConfigValue = await ccr.client.call('getConfig');
            if (!isJsonRecord(currentConfigValue)) throw new CcrManagementError('invalid-response');
            const latestPlan = planCcrProfile(currentConfigValue, harnessId, requestedProfileModel);
            if (
              latestPlan.profile === null ||
              profilePlan.profile === null ||
              !isExpectedCcrProfile(latestPlan.profile, profilePlan.profile)
            ) {
              throw new CcrManagementError('config-drift');
            }
            const latestProfileConfig = withCcrProfile(currentConfigValue, latestPlan.profile);
            if (latestProfileConfig === null) throw new CcrManagementError('config-drift');
            await ccr.client.call('saveConfig', [latestProfileConfig, { applyProfile: false }]);
            const afterConfig = await ccr.client.call('getConfig');
            const afterRouter = isJsonRecord(afterConfig) ? afterConfig['Router'] : null;
            const afterRules =
              isJsonRecord(afterRouter) && Array.isArray(afterRouter['rules'])
                ? afterRouter['rules']
                : [];
            if (!afterRules.some((item) => isExactCcrSmartRoutingRule(item, expectedRule)))
              throw new CcrManagementError('request-failed');
            const savedProfile = profileRows(isJsonRecord(afterConfig) ? afterConfig : {}).find(
              (item) => isJsonRecord(item) && item['id'] === profilePlan.profile?.['id'],
            );
            if (!isExpectedCcrProfile(savedProfile, profilePlan.profile))
              throw new CcrManagementError('request-failed');
            const updatedOwnership: CcrOwnershipReceipt = {
              ...owned,
              profileId: String(profilePlan.profile['id']),
              profileSha256: scriptHash(stableJson(savedProfile)),
            };
            await writeJson(context, receiptPath(context, harnessId), updatedOwnership);
            return configurationResult(
              'configure',
              'configured',
              ccr,
              harnessId,
              mode,
              ruleId,
              path,
              [
                diagnostic({
                  severity: 'info',
                  code: 'ccr-profile-verified',
                  message:
                    'CCR saved and verified the Token Harness scoped CLI profile using an existing provider',
                  remediation: `Launch Claude Code or Codex through ${ccrLaunchCommand(harnessId)} and verify requests in CCR logs`,
                }),
              ],
              updatedOwnership.profileId,
              ccrLaunchCommand(harnessId),
            );
          } catch (errorValue) {
            const issue = ccrFailure(errorValue);
            return commandResult({
              command: 'routing',
              exitCode: EXIT_CODES['problems-found'],
              diagnostics: [diagnostic({ severity: 'error', ...issue })],
            });
          }
        }
        const profileWarning =
          owned.profileId === undefined ? profilePlanDiagnostic(profilePlan) : null;
        return configurationResult(
          'configure',
          'already-configured',
          ccr,
          harnessId,
          mode,
          ruleId,
          path,
          profileWarning === null ? [] : [profileWarning],
          owned.profileId ?? null,
          owned.profileId ? ccrLaunchCommand(harnessId) : null,
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
    const profileDiagnostic = profilePlanDiagnostic(profilePlan);
    return configurationResult(
      'configure',
      'preview',
      ccr,
      harnessId,
      mode,
      ruleId,
      path,
      [
        diagnostic({
          severity: 'info',
          code: 'ccr-configure-preview',
          message:
            profilePlan.profile === null
              ? `CCR ${ccr.version} would receive one ${mode} Node.js routing rule for ${harnessId}`
              : `CCR ${ccr.version} would receive one ${mode} Node.js routing rule and a CCR-only CLI profile for ${harnessId} using ${String(profilePlan.profile['model'])}`,
          path,
          remediation: `Review the exact CCR changes and rerun with --yes to apply them; CCR may restart. The profile uses an existing provider and affects only CLI launches through CCR. Rollback: \`token-harness routing --rollback-ccr --harness ${harnessId} --yes\``,
        }),
        ...(profileDiagnostic === null ? [] : [profileDiagnostic]),
        ...(profileModelWarning === null ? [] : [profileModelWarning]),
        ...(simpleModelWarning === null ? [] : [simpleModelWarning]),
      ],
      profilePlan.profile === null ? null : String(profilePlan.profile['id']),
      profilePlan.profile === null ? null : ccrLaunchCommand(harnessId),
    );
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

  const withRule = addCcrSmartRoutingRule(ccr.config, expectedRule);
  if (withRule === null) {
    return error(
      'ccr-routing-rule-conflict',
      'CCR routing rules changed or cannot accept a script rule',
      'Refresh CCR state and review existing rules before retrying',
    );
  }
  const nextConfig =
    profilePlan.profile === null ? withRule : withCcrProfile(withRule, profilePlan.profile);
  if (nextConfig === null) {
    return error(
      'ccr-profile-config-conflict',
      'CCR Agent Profile settings changed or cannot accept the Token Harness profile',
      'Review CCR Agent Config and retry from a new preview',
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
    const currentConfigValue = await ccr.client.call('getConfig');
    if (!isJsonRecord(currentConfigValue)) throw new CcrManagementError('invalid-response');
    const latestSimpleModel = configuredCcrModel(currentConfigValue, requestedSimpleModel);
    if (latestSimpleModel !== configuredSimpleModel) throw new CcrManagementError('config-drift');
    const latestScript = createCcrSmartRoutingScript({
      harnessId,
      mode,
      telemetryDirectory,
      pathSeparator: context.platform.os === 'windows' ? '\\\\' : '/',
      simpleModel: latestSimpleModel,
    });
    if (scriptHash(latestScript) !== ownership.scriptSha256)
      throw new CcrManagementError('config-drift');
    const latestProfilePlan = planCcrProfile(
      currentConfigValue,
      harnessId,
      requestedProfileModel,
    );
    if (
      (profilePlan.profile === null) !== (latestProfilePlan.profile === null) ||
      (profilePlan.profile !== null &&
        latestProfilePlan.profile !== null &&
        !isExpectedCcrProfile(latestProfilePlan.profile, profilePlan.profile))
    ) {
      throw new CcrManagementError('config-drift');
    }
    const latestWithRule = addCcrSmartRoutingRule(currentConfigValue, expectedRule);
    if (latestWithRule === null) throw new CcrManagementError('config-drift');
    const latestNextConfig =
      latestProfilePlan.profile === null
        ? latestWithRule
        : withCcrProfile(latestWithRule, latestProfilePlan.profile);
    if (latestNextConfig === null) throw new CcrManagementError('config-drift');
    saveAttempted = true;
    await ccr.client.call('saveConfig', [latestNextConfig, { applyProfile: false }]);
    const afterConfig = await ccr.client.call('getConfig');
    const afterRouter = isJsonRecord(afterConfig) ? afterConfig['Router'] : null;
    const afterRules =
      isJsonRecord(afterRouter) && Array.isArray(afterRouter['rules']) ? afterRouter['rules'] : [];
    if (!afterRules.some((item) => isExactCcrSmartRoutingRule(item, expectedRule))) {
      throw new CcrManagementError('request-failed');
    }
    let savedProfile: Record<string, unknown> | null = null;
    if (profilePlan.profile !== null) {
      const saved = profileRows(isJsonRecord(afterConfig) ? afterConfig : {}).find(
        (item) => isJsonRecord(item) && item['id'] === profilePlan.profile?.['id'],
      );
      if (!isExpectedCcrProfile(saved, profilePlan.profile))
        throw new CcrManagementError('request-failed');
      savedProfile = saved;
    }
    const activeOwnership: CcrOwnershipReceipt = {
      ...ownership,
      status: 'active',
      ...(savedProfile === null || profilePlan.profile === null
        ? {}
        : {
            profileId: String(profilePlan.profile['id']),
            profileSha256: scriptHash(stableJson(savedProfile)),
          }),
    };
    await writeJson(context, receiptPath(context, harnessId), activeOwnership);
    const gatewayValue = await ccr.client.call('getGatewayStatus');
    const gatewayState = safeGatewayState(gatewayValue);
    const finalCcr = { ...ccr, gatewayState };
    const profileDiagnostic = profilePlanDiagnostic(profilePlan);
    return configurationResult(
      'configure',
      'configured',
      finalCcr,
      harnessId,
      mode,
      ruleId,
      path,
      [
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
        ...(profileDiagnostic === null ? [] : [profileDiagnostic]),
        ...(profileModelWarning === null ? [] : [profileModelWarning]),
        ...(simpleModelWarning === null ? [] : [simpleModelWarning]),
      ],
      activeOwnership.profileId ?? null,
      activeOwnership.profileId ? ccrLaunchCommand(harnessId) : null,
    );
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
  profileId: string | null = null,
  launchCommand: string | null = null,
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
      profileId,
      launchCommand,
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
  const profileValue =
    ownership.profileId === undefined
      ? null
      : (profileRows(ccr.config).find(
          (item) => isJsonRecord(item) && item['id'] === ownership.profileId,
        ) ?? null);
  if (
    ownership.profileId !== undefined &&
    profileValue !== null &&
    (ownership.profileSha256 === undefined ||
      scriptHash(stableJson(profileValue)) !== ownership.profileSha256)
  ) {
    return error(
      'ccr-owned-profile-drift',
      'The CCR profile changed after Token Harness created it, so rollback left it untouched',
      'Review the profile in CCR Agent Config; restore it or remove it manually before retrying rollback',
    );
  }
  const rules =
    isJsonRecord(ccr.config['Router']) && Array.isArray(ccr.config['Router']['rules'])
      ? ccr.config['Router']['rules']
      : [];
  const ownedRule = rules.find((item) => isJsonRecord(item) && item['id'] === ownership.ruleId);
  if (ownedRule === undefined) {
    if (!context.confirmed) {
      return configurationResult(
        'rollback',
        ownership.profileId === undefined ? 'already-absent' : 'preview',
        ccr,
        harnessId,
        ownership.mode,
        ownership.ruleId,
        ownership.scriptPath,
        ownership.profileId === undefined
          ? []
          : [
              diagnostic({
                severity: 'info',
                code: 'ccr-rollback-profile-preview',
                message:
                  'Rollback would remove the remaining exact Token Harness CLI profile and local script',
                remediation: 'Review the change and rerun with --yes to apply it',
              }),
            ],
        ownership.profileId ?? null,
        ownership.profileId === undefined ? null : ccrLaunchCommand(harnessId),
      );
    }
    if (ownership.profileId !== undefined) {
      const nextConfig = withoutOwnedCcrProfile(
        ccr.config,
        ownership.profileId,
        ownership.profileSha256!,
      );
      if (nextConfig === null) {
        return error(
          'ccr-owned-profile-drift',
          'The CCR profile is duplicated or changed, so rollback left it untouched',
          'Review CCR Agent Config and retry after restoring the exact owned profile',
        );
      }
      try {
        const currentConfig = await ccr.client.call('getConfig');
        if (!isSameCcrConfig(currentConfig, ccr.config))
          throw new CcrManagementError('config-drift');
        await ccr.client.call('saveConfig', [nextConfig, { applyProfile: false }]);
        const afterConfig = await ccr.client.call('getConfig');
        if (
          profileRows(isJsonRecord(afterConfig) ? afterConfig : {}).some(
            (item) => isJsonRecord(item) && item['id'] === ownership.profileId,
          )
        ) {
          throw new CcrManagementError('request-failed');
        }
      } catch (errorValue) {
        const issue = ccrFailure(errorValue);
        return commandResult({
          command: 'routing',
          exitCode: EXIT_CODES['problems-found'],
          diagnostics: [diagnostic({ severity: 'error', ...issue })],
        });
      }
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
        ...(ownership.profileId === undefined
          ? []
          : [
              diagnostic({
                severity: 'info',
                code: 'ccr-rollback-profile-preview',
                message:
                  'Rollback also removes the exact Token Harness scoped CLI profile; providers and credentials remain unchanged',
                remediation: 'Review the change and rerun with --yes to apply it',
              }),
            ]),
      ],
      ownership.profileId ?? null,
      ownership.profileId === undefined ? null : ccrLaunchCommand(harnessId),
    );
  }
  const withoutRule = removeOwnedCcrSmartRoutingRule(ccr.config, ownership.ruleId, expectedRule);
  if (withoutRule === null) {
    return error(
      'ccr-owned-rule-drift',
      'CCR rules changed while rollback was being prepared',
      'Refresh the CCR state and retry after reviewing the rule list',
    );
  }
  const nextConfig =
    ownership.profileId === undefined
      ? withoutRule
      : withoutOwnedCcrProfile(withoutRule, ownership.profileId, ownership.profileSha256!);
  if (nextConfig === null) {
    return error(
      'ccr-owned-profile-drift',
      'The Token Harness CCR profile changed while rollback was being prepared',
      'Refresh CCR state and retry after reviewing the profile',
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
    if (
      ownership.profileId !== undefined &&
      profileRows(isJsonRecord(after) ? after : {}).some(
        (item) => isJsonRecord(item) && item['id'] === ownership.profileId,
      )
    ) {
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
  const wantsStatus = context.routingStatus === true;
  const wantsCcrConfigure = context.routingCcrConfigure === true;
  const wantsCcrRollback = context.routingCcrRollback === true;
  const wantsCcrUpdate = context.routingCcrUpdate === true;
  const requestedActions = [
    wantsScript,
    wantsMetrics,
    wantsStatus,
    wantsCcrConfigure,
    wantsCcrRollback,
    wantsCcrUpdate,
  ].filter(Boolean).length;
  if (requestedActions !== 1) {
    return error(
      'routing-action-required',
      'Choose one Smart Model Routing action',
      'Use `token-harness routing --route-status --harness codex`, `--script`, `--configure-ccr`, `--update-ccr`, `--rollback-ccr`, or `--route-metrics`',
    );
  }
  if (wantsStatus) return smartRoutingStatus(context);
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
  if (wantsCcrConfigure) {
    let managed;
    try {
      managed = await resolveManagedCcr(context);
    } catch (errorValue) {
      const issue = ccrFailure(errorValue);
      return commandResult({
        command: 'routing',
        exitCode: EXIT_CODES['problems-found'],
        diagnostics: [diagnostic({ severity: 'error', ...issue })],
      });
    }
    if (managed.kind === 'external') return ccrConfiguration(context);
    const ensured = await ensureManagedCcrRuntime({ context, action: 'configure' });
    if (ensured.kind === 'result') return ensured.result;
    if (ensured.changed) {
      const state =
        ensured.lifecycleAction === 'install'
          ? 'installed'
          : ensured.lifecycleAction === 'update'
            ? 'updated'
            : 'started';
      return commandResult({
        command: 'routing',
        exitCode: EXIT_CODES.ok,
        data: {
          kind: 'ccr-lifecycle',
          action: ensured.lifecycleAction,
          state,
          version: CCR_REVIEWED_VERSION,
          packagePath: ensured.packagePath,
          executablePath: ensured.executablePath,
          managementEndpoint: ensured.endpoint,
        },
        diagnostics: [
          diagnostic({
            severity: 'info',
            code: `ccr-${ensured.lifecycleAction}-verified`,
            message: `Token Harness ${state} and verified the local CCR CLI and gateway`,
            remediation: `Next preview and configure the ${context.routingMode ?? 'shadow'} routing rule with token-harness routing --configure-ccr --harness ${String(context.harness ?? '<claude|codex>')}; provider login/import remains a separate CCR choice`,
          }),
        ],
      });
    }
    const configured = await ccrConfiguration({
      ...context,
      env: {
        ...(context.env ?? {}),
        CCR_WEB_URL: ensured.endpoint,
        CCR_WEB_AUTH_TOKEN: ensured.token,
      },
    });
    return configured;
  }
  if (wantsCcrUpdate) {
    let managed;
    try {
      managed = await resolveManagedCcr(context);
    } catch (errorValue) {
      const issue = ccrFailure(errorValue);
      return commandResult({
        command: 'routing',
        exitCode: EXIT_CODES['problems-found'],
        diagnostics: [diagnostic({ severity: 'error', ...issue })],
      });
    }
    if (managed.kind !== 'managed') {
      return error(
        'ccr-update-not-managed',
        'Token Harness updates only the CCR CLI installation it owns',
        'Install CCR through `token-harness routing --configure-ccr --harness <claude|codex>` first; external CCR installations are left to their owner',
      );
    }
    const updated = await ensureManagedCcrRuntime({ context, action: 'update' });
    if (updated.kind === 'result') return updated.result;
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'ccr-lifecycle',
        action: updated.lifecycleAction,
        state:
          updated.lifecycleAction === 'start'
            ? 'started'
            : updated.lifecycleAction === 'update'
              ? 'updated'
              : 'installed',
        version: CCR_REVIEWED_VERSION,
        packagePath: updated.packagePath,
        executablePath: updated.executablePath,
        managementEndpoint: updated.endpoint,
      },
      diagnostics: [
        diagnostic({
          severity: 'info',
          code: `ccr-${updated.lifecycleAction}-verified`,
          message:
            updated.lifecycleAction === 'update'
              ? `Token Harness updated its managed CCR CLI to ${CCR_REVIEWED_VERSION} and verified the gateway`
              : updated.lifecycleAction === 'start'
                ? `Token Harness started its managed CCR ${CCR_REVIEWED_VERSION} service`
                : `Token Harness installed its managed CCR ${CCR_REVIEWED_VERSION} service`,
          remediation:
            'This verifies the local gateway only; it does not prove that a Claude Code or Codex request was routed or that subscription quota was saved',
        }),
      ],
    });
  }
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
