import { MCPTOON_REVIEWED_INSTALL_VERSION, parseMcptoonVersion } from '@token-harness/adapters';

import type { CommandContext } from './context.js';

export const MCPTOON_MANIFEST_FOOTPRINT_SCHEMA_VERSION = 1;

export type McptoonManifestFootprintState =
  | 'observed'
  | 'unsupported-version'
  | 'unavailable'
  | 'invalid';

export interface McptoonManifestFootprintObservation {
  state: McptoonManifestFootprintState;
  version: string | null;
  serverCount: number | null;
  toolCount: number | null;
  jsonBytes: number | null;
  compactBytes: number | null;
  reductionBytes: number | null;
  reductionPercent: number | null;
  oldestCacheEntryAt: string | null;
  newestCacheEntryAt: string | null;
  reason: string;
}

export interface McptoonManifestFootprintReceipt extends McptoonManifestFootprintObservation {
  schemaVersion: typeof MCPTOON_MANIFEST_FOOTPRINT_SCHEMA_VERSION;
  benchmarkId: string;
  projectId: string;
  variant: 'optimized';
  measuredAt: string;
}

interface CachedTool {
  name: string;
  raw: Record<string, unknown>;
}

interface CachedServer {
  name: string;
  tools: CachedTool[];
  timestamp: number;
}

function footprintPath(
  context: CommandContext,
  benchmarkId: string,
  filename = 'mcptoon-manifest-footprint.json',
): string | null {
  if (context.adapters === null || context.stateRoot === null) return null;
  return context.adapters.fs.join(context.stateRoot, 'benchmarks', benchmarkId, filename);
}

function schemaCachePath(context: CommandContext): string | null {
  if (context.adapters === null || context.home === null) return null;
  return context.adapters.fs.join(context.home, '.cache', 'mcptoon', 'schema_cache.json');
}

async function readJson(context: CommandContext, path: string): Promise<unknown | null> {
  if (context.adapters === null) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(await context.adapters.fs.readFile(path)),
    ) as unknown;
  } catch {
    return null;
  }
}

async function writeJson(context: CommandContext, path: string, value: unknown): Promise<boolean> {
  if (context.adapters === null) return false;
  try {
    await context.adapters.fs.writeFile(
      path,
      new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`),
    );
    return true;
  } catch {
    return false;
  }
}

function parseCache(raw: unknown): CachedServer[] | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const servers: CachedServer[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (
      typeof entry['ts'] !== 'number' ||
      !Number.isFinite(entry['ts']) ||
      entry['ts'] < 0 ||
      !Array.isArray(entry['tools'])
    ) {
      return null;
    }
    const tools: CachedTool[] = [];
    for (const item of entry['tools']) {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return null;
      const tool = item as Record<string, unknown>;
      if (typeof tool['name'] !== 'string' || tool['name'] === '') return null;
      tools.push({ name: tool['name'], raw: tool });
    }
    servers.push({ name, tools, timestamp: entry['ts'] });
  }
  return servers;
}

function formatJsonManifest(servers: readonly CachedServer[]): string {
  const manifest: Record<string, Record<string, unknown>[]> = {};
  for (const server of servers) manifest[server.name] = server.tools.map((tool) => tool.raw);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function formatCompactManifest(servers: readonly CachedServer[]): string {
  const rows = servers
    .filter((server) => server.tools.length > 0)
    .map((server) => `${server.name}: ${server.tools.map((tool) => tool.name).join(', ')}`);
  return `${rows.join(' · ')}\n`;
}

function percent(reduction: number, original: number): number | null {
  if (original <= 0) return null;
  return Math.round((reduction / original) * 1000) / 10;
}

function timestampIso(seconds: number): string | null {
  const milliseconds = seconds * 1000;
  if (!Number.isFinite(milliseconds)) return null;
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return null;
  }
}

function finiteNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function validIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value !== '' && Number.isFinite(Date.parse(value));
}

function footprintAggregatesAreNull(row: Record<string, unknown>): boolean {
  return (
    row['serverCount'] === null &&
    row['toolCount'] === null &&
    row['jsonBytes'] === null &&
    row['compactBytes'] === null &&
    row['reductionBytes'] === null &&
    row['reductionPercent'] === null &&
    row['oldestCacheEntryAt'] === null &&
    row['newestCacheEntryAt'] === null
  );
}

/**
 * Validate persisted footprint evidence before campaign reporting.
 *
 * Receipts are deliberately self-checking: observed aggregates must be complete, exact-version,
 * arithmetically consistent and time ordered. Non-observed receipts cannot carry partial footprint
 * numbers. This prevents a malformed or edited sidecar from becoming candidate evidence.
 */
export function parseMcptoonManifestFootprintReceipt(
  value: unknown,
  benchmarkId: string,
): McptoonManifestFootprintReceipt | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    row['schemaVersion'] !== MCPTOON_MANIFEST_FOOTPRINT_SCHEMA_VERSION ||
    row['benchmarkId'] !== benchmarkId ||
    typeof row['projectId'] !== 'string' ||
    row['projectId'] === '' ||
    row['variant'] !== 'optimized' ||
    !validIsoTimestamp(row['measuredAt']) ||
    !(
      row['state'] === 'observed' ||
      row['state'] === 'unsupported-version' ||
      row['state'] === 'unavailable' ||
      row['state'] === 'invalid'
    ) ||
    !(row['version'] === null || typeof row['version'] === 'string') ||
    typeof row['reason'] !== 'string'
  ) {
    return null;
  }

  if (row['state'] !== 'observed') {
    return footprintAggregatesAreNull(row)
      ? (row as unknown as McptoonManifestFootprintReceipt)
      : null;
  }

  if (
    row['version'] !== MCPTOON_REVIEWED_INSTALL_VERSION ||
    !finiteNonNegativeInteger(row['serverCount']) ||
    row['serverCount'] === 0 ||
    !finiteNonNegativeInteger(row['toolCount']) ||
    !finiteNonNegativeInteger(row['jsonBytes']) ||
    row['jsonBytes'] === 0 ||
    !finiteNonNegativeInteger(row['compactBytes']) ||
    !finiteNonNegativeInteger(row['reductionBytes']) ||
    typeof row['reductionPercent'] !== 'number' ||
    !Number.isFinite(row['reductionPercent']) ||
    row['reductionPercent'] < 0 ||
    row['reductionPercent'] > 100 ||
    !validIsoTimestamp(row['oldestCacheEntryAt']) ||
    !validIsoTimestamp(row['newestCacheEntryAt'])
  ) {
    return null;
  }

  const reductionBytes = row['jsonBytes'] - row['compactBytes'];
  const reductionPercent = percent(reductionBytes, row['jsonBytes']);
  const measuredAt = Date.parse(row['measuredAt']);
  const oldestAt = Date.parse(row['oldestCacheEntryAt']);
  const newestAt = Date.parse(row['newestCacheEntryAt']);
  if (
    reductionBytes < 0 ||
    row['reductionBytes'] !== reductionBytes ||
    reductionPercent === null ||
    row['reductionPercent'] !== reductionPercent ||
    oldestAt > newestAt ||
    newestAt > measuredAt
  ) {
    return null;
  }

  return row as unknown as McptoonManifestFootprintReceipt;
}

/**
 * Read the reviewed mcptoon 0.7.10 schema cache without contacting an MCP server.
 *
 * The returned evidence intentionally persists aggregate byte counts only. `jsonBytes` reproduces
 * mcptoon's pretty JSON manifest representation and `compactBytes` reproduces its names-only compact
 * index for the same cached tool set. This is mechanism footprint evidence, not proof that those
 * bytes entered a model context and not a token/subscription savings claim.
 */
export async function readMcptoonManifestFootprint(
  context: CommandContext,
): Promise<McptoonManifestFootprintObservation> {
  if (context.adapters === null || context.home === null) {
    return {
      state: 'unavailable',
      version: null,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'local adapters or home directory are unavailable',
    };
  }

  const versionOutcome = await context.adapters.runner.run({
    executable: 'mcptoon',
    args: ['--version'],
    cwd: context.projectRoot,
    timeoutMs: 20_000,
  });
  if (versionOutcome.failure !== null || versionOutcome.exitCode !== 0) {
    return {
      state: 'unavailable',
      version: null,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon version could not be read passively',
    };
  }

  const version = parseMcptoonVersion(`${versionOutcome.stdout}\n${versionOutcome.stderr}`);
  if (version !== MCPTOON_REVIEWED_INSTALL_VERSION) {
    return {
      state: 'unsupported-version',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: `manifest footprint is reviewed only for mcptoon ${MCPTOON_REVIEWED_INSTALL_VERSION}`,
    };
  }

  const path = schemaCachePath(context);
  if (path === null) {
    return {
      state: 'unavailable',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon schema cache path could not be resolved',
    };
  }

  const stat = await context.adapters.fs.stat(path);
  if (stat === null) {
    return {
      state: 'unavailable',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon has no local schema cache to measure yet',
    };
  }
  if (stat.kind !== 'file') {
    return {
      state: 'invalid',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon schema cache path is not a regular file',
    };
  }

  const servers = parseCache(await readJson(context, path));
  if (servers === null || servers.length === 0) {
    return {
      state: 'invalid',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon schema cache does not match the reviewed 0.7.10 contract',
    };
  }

  const json = formatJsonManifest(servers);
  const compact = formatCompactManifest(servers);
  const encoder = new TextEncoder();
  const jsonBytes = encoder.encode(json).byteLength;
  const compactBytes = encoder.encode(compact).byteLength;
  const reductionBytes = jsonBytes - compactBytes;
  const timestamps = servers.map((server) => server.timestamp).sort((a, b) => a - b);
  const oldestCacheEntryAt = timestampIso(timestamps[0] ?? Number.NaN);
  const newestCacheEntryAt = timestampIso(timestamps.at(-1) ?? Number.NaN);
  if (oldestCacheEntryAt === null || newestCacheEntryAt === null || reductionBytes < 0) {
    return {
      state: 'invalid',
      version,
      serverCount: null,
      toolCount: null,
      jsonBytes: null,
      compactBytes: null,
      reductionBytes: null,
      reductionPercent: null,
      oldestCacheEntryAt: null,
      newestCacheEntryAt: null,
      reason: 'mcptoon schema cache produced invalid footprint aggregates',
    };
  }

  return {
    state: 'observed',
    version,
    serverCount: servers.length,
    toolCount: servers.reduce((total, server) => total + server.tools.length, 0),
    jsonBytes,
    compactBytes,
    reductionBytes,
    reductionPercent: percent(reductionBytes, jsonBytes),
    oldestCacheEntryAt,
    newestCacheEntryAt,
    reason:
      'aggregate footprint derived from one local mcptoon 0.7.10 cached tool set; no MCP server was contacted',
  };
}

export async function recordMcptoonManifestFootprint(
  context: CommandContext,
  input: { benchmarkId: string; projectId: string; measuredAt: string },
): Promise<McptoonManifestFootprintReceipt | null> {
  const path = footprintPath(context, input.benchmarkId);
  if (path === null) return null;
  const observation = await readMcptoonManifestFootprint(context);
  const receipt: McptoonManifestFootprintReceipt = {
    schemaVersion: MCPTOON_MANIFEST_FOOTPRINT_SCHEMA_VERSION,
    benchmarkId: input.benchmarkId,
    projectId: input.projectId,
    variant: 'optimized',
    measuredAt: input.measuredAt,
    ...observation,
  };
  return (await writeJson(context, path, receipt)) ? receipt : null;
}

export async function readMcptoonManifestFootprintReceipt(
  context: CommandContext,
  benchmarkId: string,
): Promise<McptoonManifestFootprintReceipt | null> {
  const path = footprintPath(context, benchmarkId);
  if (path === null || context.adapters === null) return null;
  const stat = await context.adapters.fs.stat(path);
  if (stat === null || stat.kind !== 'file') return null;
  return parseMcptoonManifestFootprintReceipt(await readJson(context, path), benchmarkId);
}
