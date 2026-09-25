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
      kind: 'status';
      harnessId: SmartRoutingHarness;
      state: 'off' | 'shadow' | 'conservative' | 'attention';
      mode: SmartRoutingMode | null;
      detail: string;
      launchCommand?: string | null;
      profileModel?: string | null;
      simpleModel?: string | null;
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
  profileModel?: string;
  simpleModel?: string;
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
      (value['profileModel'] === undefined || typeof value['profileModel'] === 'string') &&
      (value['simpleModel'] === undefined || typeof value['simpleModel'] === 'string') &&
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


const LOCAL_PROVIDER: Record<
  SmartRoutingHarness,
  { candidateId: string; name: string; protocol: string; preferredModel: string }
> = {
  claude: {
    candidateId: 'claude-code-api',
    name: 'Claude Code API',
    protocol: 'anthropic_messages',
    preferredModel: 'claude-sonnet-5',
  },
  codex: {
    candidateId: 'codex-api',
    name: 'Codex API',
    protocol: 'openai_responses',
    preferredModel: 'gpt-5-codex',
  },
};

function providerNameSlug(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'provider'
  );
}

function replaceProviderTemplate(
  value: unknown,
  replacements: Readonly<Record<string, string>>,
): unknown {
  if (typeof value === 'string') {
    let result = value;
    for (const [from, to] of Object.entries(replacements)) result = result.split(from).join(to);
    return result;
  }
  if (Array.isArray(value))
    return value.map((item) => replaceProviderTemplate(item, replacements));
  if (!isJsonRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      replaceProviderTemplate(item, replacements),
    ]),
  );
}

function harnessProviderRows(
  config: Record<string, unknown>,
  harness: SmartRoutingHarness,
): Record<string, unknown>[] {
  const spec = LOCAL_PROVIDER[harness];
  return (Array.isArray(config['Providers']) ? config['Providers'] : []).filter(
    (item): item is Record<string, unknown> =>
      isJsonRecord(item) && item['name'] === spec.name && item['type'] === spec.protocol,
  );
}

function providerModels(provider: Record<string, unknown>): string[] {
  return (Array.isArray(provider['models']) ? provider['models'] : []).filter(
    (model): model is string =>
      typeof model === 'string' && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(model),
  );
}

interface PreparedHarnessProvider {
  config: Record<string, unknown>;
  provider: Record<string, unknown>;
  imported: boolean;
}

interface ProviderPreparationFailure {
  code: string;
  message: string;
  remediation: string;
}

function localProviderFailure(
  code: string,
  message: string,
  remediation: string,
): { ok: false; issue: ProviderPreparationFailure } {
  return { ok: false, issue: { code, message, remediation } };
}

/**
 * Build the CCR provider from the coding agent's already-authenticated local login.
 *
 * CCR's import RPC only reads the local Codex/Claude credential and returns a provider payload;
 * it does not mutate CCR. The returned payload is merged into the same reviewed saveConfig call
 * that installs Token Harness' rule/profile, so Preview remains read-only and Enable is one
 * explicit mutation.
 */
async function prepareHarnessProvider(
  client: CcrManagementClient,
  config: Record<string, unknown>,
  harness: SmartRoutingHarness,
): Promise<
  | { ok: true; value: PreparedHarnessProvider }
  | { ok: false; issue: ProviderPreparationFailure }
> {
  const existing = harnessProviderRows(config, harness);
  if (existing.length === 1) return { ok: true, value: { config, provider: existing[0]!, imported: false } };
  if (existing.length > 1) {
    return localProviderFailure(
      'ccr-local-provider-ambiguous',
      `CCR contains multiple ${LOCAL_PROVIDER[harness].name} providers`,
      'Keep one intended local subscription provider in CCR before enabling Smart Model Routing',
    );
  }

  let candidatesValue: unknown;
  try {
    candidatesValue = await client.call('getLocalAgentProviderCandidates');
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return localProviderFailure(issue.code, issue.message, issue.remediation);
  }
  const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
  const spec = LOCAL_PROVIDER[harness];
  const candidate = candidates.find(
    (item) => isJsonRecord(item) && item['id'] === spec.candidateId,
  );
  if (!isJsonRecord(candidate) || candidate['importable'] !== true) {
    const detail =
      isJsonRecord(candidate) && typeof candidate['detail'] === 'string'
        ? candidate['detail']
        : `${harness === 'codex' ? 'Codex' : 'Claude Code'} login was not detected by CCR`;
    return localProviderFailure(
      'ccr-local-provider-login-unavailable',
      detail,
      harness === 'codex'
        ? 'Sign in to Codex with ChatGPT in this user account, then Refresh and enable routing again'
        : 'Sign in to Claude Code in this user account, then Refresh and enable routing again',
    );
  }

  const providerNames = (Array.isArray(config['Providers']) ? config['Providers'] : [])
    .filter(isJsonRecord)
    .map((item) => item['name'])
    .filter((name): name is string => typeof name === 'string');
  let importedValue: unknown;
  try {
    importedValue = await client.call('importLocalAgentProvider', [
      { id: spec.candidateId, providerNames },
    ]);
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return localProviderFailure(issue.code, issue.message, issue.remediation);
  }
  if (
    !isJsonRecord(importedValue) ||
    !isJsonRecord(importedValue['provider']) ||
    !Array.isArray(importedValue['providerPlugins'])
  ) {
    return localProviderFailure(
      'ccr-local-provider-import-invalid',
      'CCR returned an unsupported local-login import payload',
      'Update Token Harness/CCR compatibility before enabling routing',
    );
  }

  const payload = importedValue['provider'];
  const name = typeof payload['name'] === 'string' ? payload['name'].trim() : spec.name;
  const protocol =
    typeof payload['protocol'] === 'string' ? payload['protocol'].trim() : spec.protocol;
  const baseUrl = typeof payload['baseUrl'] === 'string' ? payload['baseUrl'].trim() : '';
  const models = Array.isArray(payload['models'])
    ? payload['models'].filter(
        (model): model is string =>
          typeof model === 'string' && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(model),
      )
    : [];
  const apiKey = typeof payload['apiKey'] === 'string' ? payload['apiKey'] : '';
  if (!name || protocol !== spec.protocol || !baseUrl || models.length === 0 || !apiKey) {
    return localProviderFailure(
      'ccr-local-provider-import-invalid',
      'CCR local-login import did not contain the expected provider protocol, endpoint and models',
      'Refresh the coding-agent login/model catalog and retry',
    );
  }
  const id = providerNameSlug(name);
  const provider: Record<string, unknown> = {
    api_base_url: baseUrl.replace(/\/+$/, ''),
    api_key: apiKey,
    id,
    models,
    name,
    type: protocol,
    ...(isJsonRecord(payload['account']) ? { account: payload['account'] } : {}),
    ...(Array.isArray(payload['capabilities']) ? { capabilities: payload['capabilities'] } : {}),
    ...(typeof payload['icon'] === 'string' ? { icon: payload['icon'] } : {}),
    ...(isJsonRecord(payload['modelDescriptions'])
      ? { modelDescriptions: payload['modelDescriptions'] }
      : {}),
    ...(isJsonRecord(payload['modelDisplayNames'])
      ? { modelDisplayNames: payload['modelDisplayNames'] }
      : {}),
    ...(isJsonRecord(payload['modelMetadata']) ? { modelMetadata: payload['modelMetadata'] } : {}),
  };
  const replacements = {
    __CCR_PROVIDER_INTERNAL_NAME__: `${id}::${protocol}`,
    __CCR_PROVIDER_NAME__: name,
    __CCR_PROVIDER_NAME_SLUG__: id,
  };
  const importedPlugins = importedValue['providerPlugins'].map((plugin) =>
    replaceProviderTemplate(plugin, replacements),
  );
  const currentPlugins = Array.isArray(config['providerPlugins']) ? config['providerPlugins'] : [];
  const existingPluginKeys = new Set(
    currentPlugins
      .filter(isJsonRecord)
      .map((plugin) => plugin['key'])
      .filter((key): key is string => typeof key === 'string'),
  );
  for (const plugin of importedPlugins) {
    if (isJsonRecord(plugin) && typeof plugin['key'] === 'string' && existingPluginKeys.has(plugin['key'])) {
      return localProviderFailure(
        'ccr-local-provider-plugin-conflict',
        'CCR already contains a provider plugin key needed by the local coding-agent login',
        'Review the existing CCR provider plugins before enabling routing; Token Harness will not overwrite them',
      );
    }
  }
  const nextConfig: Record<string, unknown> = {
    ...config,
    Providers: [provider, ...(Array.isArray(config['Providers']) ? config['Providers'] : [])],
    providerPlugins: [...currentPlugins, ...importedPlugins],
    ...(
      typeof config['preferredProvider'] === 'string' && config['preferredProvider'].trim()
        ? {}
        : { preferredProvider: name }
    ),
  };
  return { ok: true, value: { config: nextConfig, provider, imported: true } };
}

function canonicalHarnessModel(
  config: Record<string, unknown>,
  harness: SmartRoutingHarness,
  requested: string | null | undefined,
): string | null {
  const rows = harnessProviderRows(config, harness);
  if (rows.length !== 1) return null;
  const provider = rows[0]!;
  const spec = LOCAL_PROVIDER[harness];
  const models = providerModels(provider);
  const raw = requested?.trim();
  if (raw) {
    const bare = raw.startsWith(`${spec.name}/`) ? raw.slice(spec.name.length + 1) : raw;
    return models.includes(bare) ? `${spec.name}/${bare}` : null;
  }
  const providerDefault =
    typeof provider['defaultModel'] === 'string'
      ? provider['defaultModel']
      : typeof provider['model'] === 'string'
        ? provider['model']
        : null;
  if (providerDefault) {
    const bare = providerDefault.startsWith(`${spec.name}/`)
      ? providerDefault.slice(spec.name.length + 1)
      : providerDefault;
    if (models.includes(bare)) return `${spec.name}/${bare}`;
  }
  if (models.includes(spec.preferredModel)) return `${spec.name}/${spec.preferredModel}`;
  return models.length > 0 ? `${spec.name}/${models[0]}` : null;
}

/** Build the scoped launcher profile only from the matching local subscription provider. */
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
  const canonicalModel = canonicalHarnessModel(config, harness, selectedModel);
  if (canonicalModel === null) {
    return {
      profile: null,
      profileContainer,
      conflict: false,
      reason: selectedModel?.trim()
        ? `The selected base model ${selectedModel.trim()} is not available in ${providerName}`
        : `${providerName} exposes no usable model for the routing profile`,
    };
  }
  const model = canonicalModel.slice(providerName.length + 1);
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
  harness: SmartRoutingHarness,
  requested: string | undefined,
): string | null {
  if (!requested?.trim()) return null;
  return canonicalHarnessModel(config, harness, requested);
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
    remediation: 'Choose an available base model and retry. Token Harness can reuse the coding agent login already present on this machine.',
  });
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

  const preparedProvider = await prepareHarnessProvider(ccr.client, ccr.config, harnessId);
  if (!preparedProvider.ok) {
    return error(
      preparedProvider.issue.code,
      preparedProvider.issue.message,
      preparedProvider.issue.remediation,
    );
  }
  ccr = { ...ccr, config: preparedProvider.value.config };

  const requestedProfileModel =
    context.routingProfileModel ?? context.env?.['TOKEN_HARNESS_ROUTING_PROFILE_MODEL'];
  let profilePlan = planCcrProfile(ccr.config, harnessId, requestedProfileModel ?? undefined);
  const profileModelWarning =
    requestedProfileModel?.trim() && profilePlan.profile === null
      ? diagnostic({
          severity: 'warning',
          code: 'ccr-profile-model-not-configured',
          message: profilePlan.reason ?? 'The selected base model is not available in the local subscription provider',
          remediation: 'Choose one of the models reported for this coding agent and retry',
        })
      : null;

  const requestedSimpleModel =
    context.routingSimpleModel ?? context.env?.['TOKEN_HARNESS_ROUTING_SIMPLE_MODEL'];
  const configuredSimpleModel = configuredCcrModel(
    ccr.config,
    harnessId,
    requestedSimpleModel ?? undefined,
  );
  if (mode === 'conservative' && configuredSimpleModel === null) {
    return error(
      'ccr-simple-model-required',
      requestedSimpleModel?.trim()
        ? `The selected simple model ${requestedSimpleModel.trim()} is not available in ${LOCAL_PROVIDER[harnessId].name}`
        : 'Conservative routing needs an explicit simple-model target',
      'Choose a simple model in Smart Model Routing configuration. Shadow mode needs no simple-model target.',
    );
  }
  const simpleModelWarning =
    mode === 'shadow' && requestedSimpleModel?.trim() && configuredSimpleModel === null
      ? diagnostic({
          severity: 'warning',
          code: 'ccr-simple-model-not-configured',
          message: 'The optional simple model is not available in the local subscription provider and is ignored in Shadow mode',
          remediation: 'Choose an available model before switching to Conservative mode',
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
  let owned = await readOwnership(context, harnessId);
  let pendingUnapplied: CcrOwnershipReceipt | null = null;
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
  if (owned?.status === 'pending') {
    const pendingScriptBytes = await fs.readFile(owned.scriptPath).catch(() => null);
    const pendingScriptMatches =
      pendingScriptBytes !== null &&
      scriptHash(new TextDecoder().decode(pendingScriptBytes)) === owned.scriptSha256;
    const pendingRuleMatches =
      matching.length === 1 && isExactCcrSmartRoutingRule(matching[0], expectedRule);
    const expectedProfile = profilePlan.profile;
    const pendingSavedProfile =
      expectedProfile === null
        ? null
        : profileRows(ccr.config).find(
            (item) => isJsonRecord(item) && item['id'] === expectedProfile['id'],
          );
    const pendingProfileMatches =
      expectedProfile === null || isExpectedCcrProfile(pendingSavedProfile, expectedProfile);

    if (pendingScriptMatches && pendingRuleMatches && pendingProfileMatches && owned.mode === mode) {
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
              code: 'ccr-pending-setup-recoverable',
              message:
                'A previous Smart Model Routing setup reached CCR but stopped before final verification; Enable will verify the gateway and recover the owned state',
              remediation: 'Approve Enable to finish the existing Token Harness-owned setup; no unrelated CCR configuration will be adopted',
            }),
          ],
          expectedProfile === null ? null : String(expectedProfile['id']),
          expectedProfile === null ? null : ccrLaunchCommand(harnessId),
        );
      }
      await ccr.client.call('startGateway');
      const recoveredGateway = safeGatewayState(await ccr.client.call('getGatewayStatus'));
      if (recoveredGateway !== 'running') {
        return error(
          'ccr-pending-setup-gateway-unavailable',
          'The previous owned routing rule is present, but CCR gateway verification still does not report running',
          'Review the local CCR gateway error, then retry Enable; Token Harness kept the pending receipt for safe recovery',
        );
      }
      const recoveredOwnership: CcrOwnershipReceipt = {
        ...owned,
        status: 'active',
        ...(expectedProfile === null
          ? {}
          : {
              profileId: String(expectedProfile['id']),
              profileSha256: scriptHash(stableJson(pendingSavedProfile)),
              profileModel: String(expectedProfile['model']),
            }),
        ...(configuredSimpleModel === null ? {} : { simpleModel: configuredSimpleModel }),
      };
      await writeJson(context, receiptPath(context, harnessId), recoveredOwnership);
      return configurationResult(
        'configure',
        'configured',
        { ...ccr, gatewayState: recoveredGateway },
        harnessId,
        mode,
        ruleId,
        path,
        [
          diagnostic({
            severity: 'info',
            code: 'ccr-pending-setup-recovered',
            message: 'Token Harness recovered and verified the interrupted Smart Model Routing setup',
            remediation: 'Use the routed launcher/profile and inspect routing activity after real requests',
          }),
        ],
        recoveredOwnership.profileId ?? null,
        recoveredOwnership.profileId ? ccrLaunchCommand(harnessId) : null,
      );
    }

    if (pendingScriptMatches && matching.length === 0) {
      pendingUnapplied = owned;
      owned = null;
    } else if (!pendingScriptMatches || matching.length > 0) {
      return error(
        'ccr-pending-setup-drift',
        'An interrupted Smart Model Routing setup no longer matches the Token Harness-owned pending state',
        'Do not overwrite it automatically. Review the Token Harness routing receipt and CCR rule/profile before retrying.',
      );
    }
  }
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
  if (owned === null && ownershipStat !== null && pendingUnapplied === null) {
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
          const currentProfileModel =
            owned.profileModel ??
            (isJsonRecord(currentOwnedProfile) && typeof currentOwnedProfile['model'] === 'string'
              ? currentOwnedProfile['model']
              : null);
          const requestedBaseModel =
            profilePlan.profile !== null && typeof profilePlan.profile['model'] === 'string'
              ? profilePlan.profile['model']
              : null;
          if (
            currentProfileModel !== null &&
            requestedBaseModel !== null &&
            currentProfileModel !== requestedBaseModel
          ) {
            return error(
              'ccr-base-model-change-requires-disable',
              'The routed launcher base model differs from the active owned profile',
              'Disable Smart Model Routing before changing its base launcher model; mode and simple-model changes can be configured in place',
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
                  code: 'ccr-routing-mode-update-preview',
                  message:
                    owned.mode === mode
                      ? `Token Harness would update the owned ${mode} routing configuration`
                      : `Token Harness would change the owned routing mode from ${owned.mode} to ${mode}`,
                  remediation:
                    'Only the Token Harness-owned routing script and receipt are changed; the CCR provider login and unrelated configuration remain untouched',
                }),
              ],
              owned.profileId ?? null,
              owned.profileId ? ccrLaunchCommand(harnessId) : null,
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
              'CCR did not validate the updated Smart Model Routing script',
              'The existing active routing configuration was kept unchanged',
            );
          }

          const previousScript = new TextDecoder().decode(currentScript);
          const previousOwnership = { ...owned };
          try {
            await fs.writeFile(path, new TextEncoder().encode(script));
            const updatedOwnership: CcrOwnershipReceipt = {
              ...owned,
              status: 'active',
              mode,
              scriptSha256: scriptHash(script),
              ...(requestedBaseModel === null ? {} : { profileModel: requestedBaseModel }),
              ...(configuredSimpleModel === null
                ? { simpleModel: undefined }
                : { simpleModel: configuredSimpleModel }),
            };
            await writeJson(context, receiptPath(context, harnessId), updatedOwnership);
            await ccr.client.call('startGateway');
            const gatewayState = safeGatewayState(await ccr.client.call('getGatewayStatus'));
            if (gatewayState !== 'running') throw new CcrManagementError('request-failed');
            return configurationResult(
              'configure',
              'configured',
              { ...ccr, gatewayState },
              harnessId,
              mode,
              ruleId,
              path,
              [
                diagnostic({
                  severity: 'info',
                  code: 'ccr-routing-mode-update-verified',
                  message:
                    previousOwnership.mode === mode
                      ? `Smart Model Routing ${mode} configuration was updated and verified`
                      : `Smart Model Routing changed from ${previousOwnership.mode} to ${mode} and was verified`,
                  remediation: 'Use the same routed launcher/profile; no second setup step is required',
                }),
              ],
              updatedOwnership.profileId ?? null,
              updatedOwnership.profileId ? ccrLaunchCommand(harnessId) : null,
            );
          } catch (errorValue) {
            await fs.writeFile(path, new TextEncoder().encode(previousScript)).catch(() => undefined);
            await writeJson(context, receiptPath(context, harnessId), previousOwnership).catch(
              () => undefined,
            );
            const issue = ccrFailure(errorValue);
            return commandResult({
              command: 'routing',
              exitCode: EXIT_CODES['problems-found'],
              diagnostics: [
                diagnostic({
                  severity: 'error',
                  code: issue.code,
                  message: `${issue.message}; the previous owned routing mode was restored`,
                  remediation: 'Inspect CCR gateway status and retry Configure',
                }),
              ],
            });
          }
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
            const currentConfig = await ccr.client.call('getConfig');
            if (!isJsonRecord(currentConfig)) throw new CcrManagementError('invalid-response');
            const freshProfileConfig = withCcrProfile(currentConfig, profilePlan.profile);
            if (freshProfileConfig === null) throw new CcrManagementError('config-drift');
            await ccr.client.call('saveConfig', [freshProfileConfig, { applyProfile: false }]);
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
  if (targetFile !== null && pendingUnapplied === null) {
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

  if (context.confirmed && pendingUnapplied !== null) {
    await cleanupUnappliedCcrFiles(context, harnessId, pendingUnapplied);
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
    const currentConfig = await ccr.client.call('getConfig');
    if (!isJsonRecord(currentConfig)) throw new CcrManagementError('invalid-response');
    const freshProvider = await prepareHarnessProvider(ccr.client, currentConfig, harnessId);
    if (!freshProvider.ok) throw new CcrManagementError('config-drift');
    const freshProfilePlan = planCcrProfile(
      freshProvider.value.config,
      harnessId,
      requestedProfileModel ?? undefined,
    );
    if (
      profilePlan.profile !== null &&
      (freshProfilePlan.profile === null ||
        stableJson(freshProfilePlan.profile) !== stableJson(profilePlan.profile))
    ) {
      throw new CcrManagementError('config-drift');
    }
    const freshSimpleModel = configuredCcrModel(
      freshProvider.value.config,
      harnessId,
      requestedSimpleModel ?? undefined,
    );
    if (mode === 'conservative' && freshSimpleModel !== configuredSimpleModel) {
      throw new CcrManagementError('config-drift');
    }
    const freshWithRule = addCcrSmartRoutingRule(freshProvider.value.config, expectedRule);
    if (freshWithRule === null) throw new CcrManagementError('config-drift');
    const freshNextConfig =
      freshProfilePlan.profile === null
        ? freshWithRule
        : withCcrProfile(freshWithRule, freshProfilePlan.profile);
    if (freshNextConfig === null) throw new CcrManagementError('config-drift');
    profilePlan = freshProfilePlan;
    saveAttempted = true;
    await ccr.client.call('saveConfig', [freshNextConfig, { applyProfile: false }]);
    const afterConfig = await ccr.client.call('getConfig');
    if (!isJsonRecord(afterConfig)) throw new CcrManagementError('invalid-response');
    const savedProviders = harnessProviderRows(afterConfig, harnessId);
    if (savedProviders.length !== 1) throw new CcrManagementError('request-failed');
    const afterRouter = afterConfig['Router'];
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
    await ccr.client.call('startGateway');
    const runningGateway = safeGatewayState(await ccr.client.call('getGatewayStatus'));
    if (runningGateway !== 'running') throw new CcrManagementError('request-failed');

    const activeOwnership: CcrOwnershipReceipt = {
      ...ownership,
      status: 'active',
      ...(profilePlan.profile === null ? {} : { profileModel: String(profilePlan.profile['model']) }),
      ...(configuredSimpleModel === null ? {} : { simpleModel: configuredSimpleModel }),
      ...(savedProfile === null || profilePlan.profile === null
        ? {}
        : {
            profileId: String(profilePlan.profile['id']),
            profileSha256: scriptHash(stableJson(savedProfile)),
          }),
    };
    await writeJson(context, receiptPath(context, harnessId), activeOwnership);
    const gatewayState = runningGateway;
    const finalCcr = { ...ccr, config: afterConfig, gatewayState };
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

async function smartRoutingStatus(
  context: CommandContext,
): Promise<CommandResult<SmartRoutingCommandReport>> {
  const fs = context.adapters?.fs;
  if (fs === undefined || context.stateRoot === null || !isSmartRoutingHarness(context.harness)) {
    return error(
      'routing-status-context-required',
      'Smart Model Routing status needs a local state directory and Claude Code or Codex',
      'Run Token Harness locally with --harness claude or --harness codex',
    );
  }
  const harnessId = context.harness;
  const receiptStat = await fs.stat(receiptPath(context, harnessId));
  const owned = await readOwnership(context, harnessId);
  if (owned === null) {
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'status',
        harnessId,
        state: receiptStat === null ? 'off' : 'attention',
        mode: null,
        detail:
          receiptStat === null
            ? 'Smart Model Routing is not enabled for this coding agent.'
            : 'Token Harness found an unreadable or unrecognized Smart Model Routing ownership record.',
        launchCommand: null,
        profileModel: null,
        simpleModel: null,
      },
    });
  }
  if (owned.status === 'pending') {
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'status',
        harnessId,
        state: 'attention',
        mode: owned.mode,
        detail:
          'A previous Smart Model Routing change stopped before final verification. Configure it again to recover safely.',
        launchCommand: owned.profileId ? ccrLaunchCommand(harnessId) : null,
        profileModel: owned.profileModel ?? null,
        simpleModel: owned.simpleModel ?? null,
      },
    });
  }

  const scriptBytes = await fs.readFile(owned.scriptPath).catch(() => null);
  if (
    scriptBytes === null ||
    scriptHash(new TextDecoder().decode(scriptBytes)) !== owned.scriptSha256
  ) {
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'status',
        harnessId,
        state: 'attention',
        mode: owned.mode,
        detail: 'The Token Harness-owned routing script changed or disappeared.',
        launchCommand: owned.profileId ? ccrLaunchCommand(harnessId) : null,
        profileModel: owned.profileModel ?? null,
        simpleModel: owned.simpleModel ?? null,
      },
    });
  }

  try {
    const ccr = await readCcrState(context);
    const expectedRule = createCcrSmartRoutingRule(harnessId, owned.scriptPath);
    const router = ccr.config['Router'];
    const rules = isJsonRecord(router) && Array.isArray(router['rules']) ? router['rules'] : [];
    const ruleOk = rules.some((item) => isExactCcrSmartRoutingRule(item, expectedRule));
    const profileOk =
      owned.profileId === undefined ||
      profileRows(ccr.config).some(
        (item) =>
          isJsonRecord(item) &&
          item['id'] === owned.profileId &&
          owned.profileSha256 === scriptHash(stableJson(item)),
      );
    if (!ruleOk || !profileOk) {
      return commandResult({
        command: 'routing',
        exitCode: EXIT_CODES.ok,
        data: {
          kind: 'status',
          harnessId,
          state: 'attention',
          mode: owned.mode,
          detail:
            'The active Token Harness ownership record no longer matches its CCR rule/profile.',
          launchCommand: owned.profileId ? ccrLaunchCommand(harnessId) : null,
          profileModel: owned.profileModel ?? null,
          simpleModel: owned.simpleModel ?? null,
        },
      });
    }
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'status',
        harnessId,
        state: owned.mode,
        mode: owned.mode,
        detail:
          ccr.gatewayState === 'running'
            ? `Smart Model Routing is enabled in ${owned.mode} mode and the local CCR gateway is running.`
            : `Smart Model Routing is configured in ${owned.mode} mode; the local CCR gateway currently reports ${ccr.gatewayState}.`,
        launchCommand: owned.profileId ? ccrLaunchCommand(harnessId) : null,
        profileModel: owned.profileModel ?? null,
        simpleModel: owned.simpleModel ?? null,
      },
      diagnostics:
        ccr.gatewayState === 'running'
          ? []
          : [
              diagnostic({
                severity: 'warning',
                code: 'ccr-gateway-not-running',
                message: `Smart Model Routing is configured but CCR gateway reports ${ccr.gatewayState}`,
                remediation: 'Open Configure and re-apply the current routing mode to restart and verify the managed gateway',
              }),
            ],
    });
  } catch (errorValue) {
    const issue = ccrFailure(errorValue);
    return commandResult({
      command: 'routing',
      exitCode: EXIT_CODES.ok,
      data: {
        kind: 'status',
        harnessId,
        state: 'attention',
        mode: owned.mode,
        detail: `Smart Model Routing is locally owned, but its CCR runtime could not be verified: ${issue.message}.`,
        launchCommand: owned.profileId ? ccrLaunchCommand(harnessId) : null,
        profileModel: owned.profileModel ?? null,
        simpleModel: owned.simpleModel ?? null,
      },
      diagnostics: [diagnostic({ severity: 'warning', ...issue })],
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
      'Use `--route-status`, `--script`, `--configure-ccr`, `--update-ccr`, `--rollback-ccr`, or `--route-metrics`',
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
    // One approved Enable owns the whole reviewed operation: prepare the local management
    // runtime when necessary, then reuse the coding-agent login, save the owned rule/profile,
    // start the gateway and verify the final state. The user should not need a second hidden step.
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
