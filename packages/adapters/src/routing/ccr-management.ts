/**
 * Narrow client for CCR's authenticated loopback Web RPC.
 *
 * The adapter never opens CCR's SQLite database. Config writes go through CCR's own `saveConfig`
 * operation, and analysis responses are reduced to model/token counters before leaving this file.
 */

export const CCR_REVIEWED_VERSION = '3.1.1';
export const CCR_ROUTING_RULE_ID_PREFIX = 'token-harness-smart-routing';
export const CCR_ROUTING_RULE_API_VERSION = 1;
export const CCR_ROUTING_RULE_TIMEOUT_MS = 2_000;

export type CcrManagementFailure =
  | 'endpoint-invalid'
  | 'token-missing'
  | 'unreachable'
  | 'unauthorized'
  | 'method-unavailable'
  | 'config-drift'
  | 'invalid-response'
  | 'request-failed';

export class CcrManagementError extends Error {
  readonly failure: CcrManagementFailure;

  constructor(failure: CcrManagementFailure) {
    super(`CCR management request failed (${failure})`);
    this.name = 'CcrManagementError';
    this.failure = failure;
  }
}

export interface CcrRpcClientOptions {
  baseUrl?: string;
  authToken?: string;
  fetcher?: typeof fetch;
}

export interface CcrObservedRequestUsage {
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  recordedCostUsd: number | null;
}

export interface CcrSessionUsage {
  sessionId: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  recordedCostUsd: number | null;
  byModel: CcrObservedRequestUsage[];
}

const DEFAULT_CCR_WEB_URL = 'http://127.0.0.1:3458';
const CCR_RPC_PATH = '/api/ccr/rpc';
const CCR_RESPONSE_MAX_BYTES = 8 * 1024 * 1024;
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const MODEL_ID = /^[A-Za-z0-9_.:/@+-]{1,160}$/;
const HARNESS_AGENTS = { claude: 'claude-code', codex: 'codex' } as const;

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function costField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Resolve only an HTTP(S) loopback endpoint so an auth token can never be sent to another host. */
export function resolveCcrManagementUrl(value?: string): string | null {
  try {
    const url = new URL(value?.trim() || DEFAULT_CCR_WEB_URL);
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      !LOCAL_HOSTS.has(url.hostname.toLowerCase()) ||
      url.username !== '' ||
      url.password !== '' ||
      url.search !== '' ||
      url.hash !== ''
    ) {
      return null;
    }
    url.pathname = '/';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

export class CcrManagementClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetcher: typeof fetch;

  constructor(options: CcrRpcClientOptions = {}) {
    const baseUrl = resolveCcrManagementUrl(options.baseUrl);
    if (baseUrl === null) throw new CcrManagementError('endpoint-invalid');
    const token = options.authToken?.trim();
    if (!token || token.length > 512) throw new CcrManagementError('token-missing');
    this.baseUrl = baseUrl;
    this.token = token;
    this.fetcher = options.fetcher ?? globalThis.fetch;
  }

  async call(method: string, args: readonly unknown[] = []): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetcher(`${this.baseUrl}${CCR_RPC_PATH}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(8_000),
        headers: {
          'content-type': 'application/json',
          'x-ccr-web-auth': this.token,
        },
        body: JSON.stringify({ method, args }),
      });
    } catch {
      throw new CcrManagementError('unreachable');
    }

    if (response.status === 401 || response.status === 403) {
      throw new CcrManagementError('unauthorized');
    }
    if (response.status === 404) throw new CcrManagementError('method-unavailable');
    if (!response.ok) throw new CcrManagementError('request-failed');

    const contentLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(contentLength) && contentLength > CCR_RESPONSE_MAX_BYTES) {
      throw new CcrManagementError('invalid-response');
    }
    let payload: unknown;
    try {
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > CCR_RESPONSE_MAX_BYTES) {
        throw new CcrManagementError('invalid-response');
      }
      payload = JSON.parse(text) as unknown;
    } catch (error) {
      if (error instanceof CcrManagementError) throw error;
      throw new CcrManagementError('invalid-response');
    }
    if (!isRecord(payload)) throw new CcrManagementError('invalid-response');
    if (payload['ok'] !== true) {
      const message = isRecord(payload['error']) ? payload['error']['message'] : undefined;
      if (typeof message === 'string' && /unknown ccr web rpc method/i.test(message)) {
        throw new CcrManagementError('method-unavailable');
      }
      throw new CcrManagementError('request-failed');
    }
    return payload['value'];
  }
}

export function ccrSmartRoutingRuleId(harness: 'claude' | 'codex'): string {
  return `${CCR_ROUTING_RULE_ID_PREFIX}-${harness}-v1`;
}

export function createCcrSmartRoutingRule(
  harness: 'claude' | 'codex',
  scriptPath: string,
): JsonRecord {
  return {
    enabled: true,
    id: ccrSmartRoutingRuleId(harness),
    name: `Token Harness Smart Routing (${harness}, shadow-first)`,
    script: {
      apiVersion: CCR_ROUTING_RULE_API_VERSION,
      file: scriptPath,
      language: 'javascript',
      timeoutMs: CCR_ROUTING_RULE_TIMEOUT_MS,
    },
    type: 'script',
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (!isRecord(value)) return JSON.stringify(value);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(',')}}`;
}

export function isExactCcrSmartRoutingRule(value: unknown, expected: JsonRecord): boolean {
  return isRecord(value) && stableJson(value) === stableJson(expected);
}

/** Guard full-config saves against concurrent edits made after CCR state was read. */
export function isSameCcrConfig(left: unknown, right: unknown): boolean {
  return isRecord(left) && isRecord(right) && stableJson(left) === stableJson(right);
}

function configRouter(
  config: unknown,
): { config: JsonRecord; router: JsonRecord; rules: unknown[] } | null {
  if (
    !isRecord(config) ||
    !isRecord(config['Router']) ||
    !Array.isArray(config['Router']['rules'])
  ) {
    return null;
  }
  return {
    config,
    router: config['Router'],
    rules: config['Router']['rules'],
  };
}

export function addCcrSmartRoutingRule(config: unknown, rule: JsonRecord): JsonRecord | null {
  const current = configRouter(config);
  if (current === null) return null;
  const existing = current.rules.find((item) => isRecord(item) && item['id'] === rule['id']);
  if (existing !== undefined)
    return isExactCcrSmartRoutingRule(existing, rule) ? current.config : null;
  return {
    ...current.config,
    Router: { ...current.router, rules: [rule, ...current.rules] },
  };
}

export function removeOwnedCcrSmartRoutingRule(
  config: unknown,
  ruleId: string,
  expected: JsonRecord,
): JsonRecord | null {
  const current = configRouter(config);
  if (current === null) return null;
  const matches = current.rules.filter((item) => isRecord(item) && item['id'] === ruleId);
  if (matches.length !== 1 || !isExactCcrSmartRoutingRule(matches[0], expected)) return null;
  return {
    ...current.config,
    Router: {
      ...current.router,
      rules: current.rules.filter((item) => !(isRecord(item) && item['id'] === ruleId)),
    },
  };
}

/** Read only CCR's version identifier, never return its installation or database paths. */
export function readCcrVersion(value: unknown): string | null {
  if (!isRecord(value) || typeof value['version'] !== 'string') return null;
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value['version']) ? value['version'] : null;
}

/**
 * Reduce one filtered CCR analysis response to token/model counters. Conversation, trace, tool
 * payload, credentials, paths, and request bodies are deliberately not returned or persisted.
 */
export function reduceCcrSessionUsage(
  value: unknown,
  expectedSessionId: string,
  expectedAgent: string,
  since: string,
  until: string,
): CcrSessionUsage | null {
  if (
    !isRecord(value) ||
    value['requestScanTruncated'] === true ||
    !isRecord(value['selectedSession'])
  ) {
    return null;
  }
  const selected = value['selectedSession'];
  if (
    !isRecord(selected['session']) ||
    selected['session']['agent'] !== expectedAgent ||
    selected['session']['id'] !== `${expectedAgent}:${expectedSessionId}` ||
    !Array.isArray(selected['requests'])
  ) {
    return null;
  }
  const start = Date.parse(since);
  const end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const byModel = new Map<string, CcrObservedRequestUsage>();
  for (const item of selected['requests']) {
    if (!isRecord(item) || item['sessionId'] !== expectedSessionId) continue;
    const createdAt =
      typeof item['createdAt'] === 'string' ? Date.parse(item['createdAt']) : Number.NaN;
    if (!Number.isFinite(createdAt) || createdAt < start || createdAt > end) continue;
    const model = item['model'];
    const inputTokens = numberField(item['inputTokens']);
    const outputTokens = numberField(item['outputTokens']);
    const cacheReadTokens = numberField(item['cacheReadTokens']);
    const cacheWriteTokens = numberField(item['cacheWriteTokens']);
    const totalTokens = numberField(item['totalTokens']);
    if (
      typeof model !== 'string' ||
      !MODEL_ID.test(model) ||
      inputTokens === null ||
      outputTokens === null ||
      cacheReadTokens === null ||
      cacheWriteTokens === null ||
      totalTokens === null
    ) {
      continue;
    }
    const current = byModel.get(model) ?? {
      model,
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      recordedCostUsd: 0,
    };
    const recordedCostUsd = costField(item['costUsd']);
    current.requestCount += 1;
    current.inputTokens += inputTokens;
    current.outputTokens += outputTokens;
    current.cacheReadTokens += cacheReadTokens;
    current.cacheWriteTokens += cacheWriteTokens;
    current.totalTokens += totalTokens;
    if (recordedCostUsd === null) current.recordedCostUsd = null;
    else if (current.recordedCostUsd !== null) current.recordedCostUsd += recordedCostUsd;
    byModel.set(model, current);
  }

  const rows = [...byModel.values()].sort((left, right) => left.model.localeCompare(right.model));
  if (rows.length === 0) return null;
  return {
    sessionId: expectedSessionId,
    requestCount: rows.reduce((total, row) => total + row.requestCount, 0),
    inputTokens: rows.reduce((total, row) => total + row.inputTokens, 0),
    outputTokens: rows.reduce((total, row) => total + row.outputTokens, 0),
    cacheReadTokens: rows.reduce((total, row) => total + row.cacheReadTokens, 0),
    cacheWriteTokens: rows.reduce((total, row) => total + row.cacheWriteTokens, 0),
    totalTokens: rows.reduce((total, row) => total + row.totalTokens, 0),
    recordedCostUsd:
      rows.length === 0 || rows.some((row) => row.recordedCostUsd === null)
        ? null
        : rows.reduce((total, row) => total + (row.recordedCostUsd ?? 0), 0),
    byModel: rows,
  };
}

export function ccrAgentForHarness(harness: 'claude' | 'codex'): string {
  return HARNESS_AGENTS[harness];
}
