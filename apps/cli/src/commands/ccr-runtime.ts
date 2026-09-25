/** Managed local installation and service lifecycle for the reviewed CCR CLI. */

import { randomBytes } from 'node:crypto';

import {
  CCR_REVIEWED_VERSION,
  CcrManagementClient,
  CcrManagementError,
  readCcrVersion,
  resolveCcrManagementUrl,
} from '@token-harness/adapters';
import { EXIT_CODES, commandResult, diagnostic, type CommandResult } from '@token-harness/core';

import type { CommandContext } from './context.js';
import type { SmartRoutingCommandReport } from './smart-routing.js';

const CCR_PACKAGE = '@musistudio/claude-code-router';
const DEFAULT_WEB_PORT = 3458;

export interface ManagedCcrRuntimeReceipt {
  schemaVersion: 1;
  version: string;
  installPrefix: string;
  executablePath: string;
  managementEndpoint: string;
  installedAt: string;
}

export type ManagedCcrResolution =
  | { kind: 'external'; endpoint: string; token: string }
  | { kind: 'managed'; endpoint: string; token: string; receipt: ManagedCcrRuntimeReceipt }
  | { kind: 'unavailable' };

export function ccrRuntimeRoot(context: CommandContext): string {
  return context.adapters!.fs.join(context.stateRoot!, 'smart-routing', 'ccr');
}

function runtimeReceiptPath(context: CommandContext): string {
  return context.adapters!.fs.join(ccrRuntimeRoot(context), 'runtime.json');
}

function runtimeTokenPath(context: CommandContext): string {
  return context.adapters!.fs.join(ccrRuntimeRoot(context), 'web-auth-token');
}

function packagePrefix(context: CommandContext, version: string): string {
  return context.adapters!.fs.join(ccrRuntimeRoot(context), 'versions', version);
}

function ccrExecutable(context: CommandContext, prefix: string): string {
  const suffix = context.platform.os === 'windows' && !context.platform.isWsl ? '.cmd' : '';
  return context.adapters!.fs.join(prefix, 'node_modules', '.bin', `ccr${suffix}`);
}

function parseJsonRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function readManagedCcrRuntime(
  context: CommandContext,
): Promise<ManagedCcrRuntimeReceipt | null> {
  if (context.adapters === null || context.stateRoot === null) return null;
  try {
    const bytes = await context.adapters.fs.readFile(runtimeReceiptPath(context));
    const receipt = parseJsonRecord(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (
      receipt?.['schemaVersion'] !== 1 ||
      typeof receipt['version'] !== 'string' ||
      !/^\d+\.\d+\.\d+$/.test(receipt['version']) ||
      typeof receipt['installPrefix'] !== 'string' ||
      typeof receipt['executablePath'] !== 'string' ||
      typeof receipt['managementEndpoint'] !== 'string' ||
      typeof receipt['installedAt'] !== 'string'
    ) {
      return null;
    }
    const expectedPrefix = packagePrefix(context, receipt['version']);
    if (
      receipt['installPrefix'] !== expectedPrefix ||
      receipt['executablePath'] !== ccrExecutable(context, expectedPrefix) ||
      resolveCcrManagementUrl(receipt['managementEndpoint']) !== receipt['managementEndpoint']
    ) {
      return null;
    }
    return receipt as unknown as ManagedCcrRuntimeReceipt;
  } catch {
    return null;
  }
}

async function readPrivateToken(context: CommandContext): Promise<string | null> {
  if (context.adapters === null || context.stateRoot === null) return null;
  try {
    const value = new TextDecoder()
      .decode(await context.adapters.fs.readFile(runtimeTokenPath(context)))
      .trim();
    return /^[A-Za-z0-9_-]{32,128}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

/** Prefer an explicitly configured CCR, then the credential owned by Token Harness. */
export async function resolveManagedCcr(context: CommandContext): Promise<ManagedCcrResolution> {
  const envToken = context.env?.['CCR_WEB_AUTH_TOKEN']?.trim();
  const envUrl = context.env?.['CCR_WEB_URL'];
  if (envToken) {
    const endpoint = resolveCcrManagementUrl(envUrl);
    if (endpoint === null) throw new CcrManagementError('endpoint-invalid');
    return { kind: 'external', endpoint, token: envToken };
  }
  if (envUrl !== undefined && envUrl.trim() !== '') throw new CcrManagementError('token-missing');

  const receipt = await readManagedCcrRuntime(context);
  const token = await readPrivateToken(context);
  if (receipt !== null && token !== null) {
    return {
      kind: 'managed',
      endpoint: receipt.managementEndpoint,
      token,
      receipt,
    };
  }

  const service = await readCcrServiceState(context);
  if (service !== null) return service;
  return { kind: 'unavailable' };
}

async function readCcrServiceState(context: CommandContext): Promise<ManagedCcrResolution | null> {
  if (context.adapters === null || context.home === null) return null;
  const windows = context.platform.os === 'windows' && !context.platform.isWsl;
  const appData = context.env?.['APPDATA'];
  const configDirectory = windows
    ? context.adapters.fs.join(
        appData || context.adapters.fs.join(context.home, 'AppData', 'Roaming'),
        'claude-code-router',
      )
    : context.adapters.fs.join(context.home, '.claude-code-router');
  try {
    const bytes = await context.adapters.fs.readFile(
      context.adapters.fs.join(configDirectory, 'service.json'),
    );
    const state = parseJsonRecord(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
    if (typeof state?.['url'] !== 'string') return null;
    const serviceUrl = new URL(state['url']);
    const endpoint = resolveCcrManagementUrl(serviceUrl.origin);
    const token = serviceUrl.searchParams.get('ccr_web_token')?.trim();
    if (endpoint === null || token === undefined || !/^[A-Za-z0-9_-]{32,128}$/.test(token))
      return null;
    const client = new CcrManagementClient({
      baseUrl: endpoint,
      authToken: token,
      ...(context.ccrFetch === undefined ? {} : { fetcher: context.ccrFetch }),
    });
    const version = readCcrVersion(await client.call('getAppInfo'));
    if (version === null) return null;
    return { kind: 'external', endpoint, token };
  } catch {
    return null;
  }
}

async function localManagementPortIsOccupied(context: CommandContext): Promise<boolean> {
  const fetcher = context.ccrFetch ?? globalThis.fetch;
  try {
    const response = await fetcher(`http://127.0.0.1:${String(DEFAULT_WEB_PORT)}/api/ccr/rpc`, {
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(1_000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'getAppInfo', args: [] }),
    });
    // Any HTTP response proves that a process is already listening. Do not infer that a 404
    // means the port is free: it may be another local UI or a CCR build with a different route.
    return response.status >= 100 && response.status <= 599;
  } catch {
    return false;
  }
}

function lifecycleError(
  code: string,
  message: string,
  remediation: string,
): CommandResult<SmartRoutingCommandReport> {
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES['problems-found'],
    diagnostics: [diagnostic({ severity: 'error', code, message, remediation })],
  });
}

function lifecyclePreview(
  action: 'install' | 'update' | 'start',
  state: 'preview' | 'already-current',
  context: CommandContext,
  receipt?: ManagedCcrRuntimeReceipt,
): CommandResult<SmartRoutingCommandReport> {
  const fs = context.adapters!.fs;
  const prefix = packagePrefix(context, CCR_REVIEWED_VERSION);
  const executable = ccrExecutable(context, prefix);
  const endpoint = receipt?.managementEndpoint ?? `http://127.0.0.1:${String(DEFAULT_WEB_PORT)}`;
  return commandResult({
    command: 'routing',
    exitCode: EXIT_CODES.ok,
    data: {
      kind: 'ccr-lifecycle',
      action,
      state,
      version: CCR_REVIEWED_VERSION,
      packagePath: prefix,
      executablePath: executable,
      managementEndpoint: endpoint,
    },
    diagnostics: [
      diagnostic({
        severity: 'info',
        code: `ccr-${action}-preview`,
        message:
          state === 'already-current'
            ? `Token Harness manages CCR CLI ${CCR_REVIEWED_VERSION}; no package update is needed`
            : action === 'install'
              ? `Token Harness would install CCR CLI ${CCR_REVIEWED_VERSION} in its protected local state directory`
              : action === 'update'
                ? `Token Harness would stop its managed CCR service, install reviewed CCR ${CCR_REVIEWED_VERSION}, then restart and verify it`
                : `Token Harness would start its managed CCR ${CCR_REVIEWED_VERSION} service on loopback`,
        path: fs.join(ccrRuntimeRoot(context), 'runtime.json'),
        remediation:
          state === 'already-current'
            ? 'Use `token-harness routing --configure-ccr --harness <claude|codex> --yes` to verify or configure the owned shadow rule'
            : 'Review the local package installation and gateway restart, then rerun with `--yes`; no global CCR package or harness configuration is replaced',
      }),
    ],
  });
}

function successfulProcess(
  outcome: Awaited<ReturnType<NonNullable<CommandContext['adapters']>['runner']['run']>>,
): boolean {
  return outcome.failure === null && outcome.exitCode === 0;
}

function managementPortFromOutput(output: string): number {
  const match = /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/i.exec(output);
  const port = Number(match?.[1]);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_WEB_PORT;
}

async function packageVersionAt(context: CommandContext, prefix: string): Promise<string | null> {
  try {
    const path = context.adapters!.fs.join(
      prefix,
      'node_modules',
      '@musistudio',
      'claude-code-router',
      'package.json',
    );
    const parsed = parseJsonRecord(
      JSON.parse(new TextDecoder().decode(await context.adapters!.fs.readFile(path))) as unknown,
    );
    return typeof parsed?.['version'] === 'string' ? parsed['version'] : null;
  } catch {
    return null;
  }
}

async function runCcrExecutable(
  context: CommandContext,
  executable: string,
  args: readonly string[],
  token: string,
): Promise<Awaited<ReturnType<NonNullable<CommandContext['adapters']>['runner']['run']>>> {
  const env: Record<string, string> = { CCR_WEB_AUTH_TOKEN: token };
  const simpleModel = context.env?.['TOKEN_HARNESS_ROUTING_SIMPLE_MODEL']?.trim();
  if (simpleModel && /^[A-Za-z0-9_.:/@+ -]{1,160}$/.test(simpleModel)) {
    env['TOKEN_HARNESS_ROUTING_SIMPLE_MODEL'] = simpleModel;
  }
  return context.adapters!.runner.run({
    executable,
    args,
    cwd: context.projectRoot,
    env,
    timeoutMs: 45_000,
    maxOutputBytes: 128 * 1024,
    secretValues: [token],
  });
}

async function startAndVerify(
  context: CommandContext,
  receipt: ManagedCcrRuntimeReceipt,
  token: string,
  expectedVersion = CCR_REVIEWED_VERSION,
  startGateway = false,
): Promise<{ endpoint: string; version: string } | null> {
  const start = await runCcrExecutable(
    context,
    receipt.executablePath,
    [
      'start',
      '--daemon',
      '--host',
      '127.0.0.1',
      '--port',
      String(DEFAULT_WEB_PORT),
      '--no-open',
      startGateway ? '--gateway' : '--no-gateway',
    ],
    token,
  );
  if (!successfulProcess(start)) return null;

  const port = managementPortFromOutput(`${start.stdout}\n${start.stderr}`);
  const endpoint = resolveCcrManagementUrl(`http://127.0.0.1:${String(port)}`);
  if (endpoint === null) return null;
  const client = new CcrManagementClient({
    baseUrl: endpoint,
    authToken: token,
    ...(context.ccrFetch === undefined ? {} : { fetcher: context.ccrFetch }),
  });
  try {
    const version = readCcrVersion(await client.call('getAppInfo'));
    if (version !== expectedVersion) return null;
    if (startGateway) {
      const gateway = parseJsonRecord(await client.call('getGatewayStatus'));
      if (gateway?.['state'] !== 'running') return null;
    }
    return { endpoint, version };
  } catch {
    return null;
  }
}

async function verifyManagedService(
  context: CommandContext,
  receipt: ManagedCcrRuntimeReceipt,
  token: string,
): Promise<{ version: string; running: boolean } | null> {
  const client = new CcrManagementClient({
    baseUrl: receipt.managementEndpoint,
    authToken: token,
    ...(context.ccrFetch === undefined ? {} : { fetcher: context.ccrFetch }),
  });
  try {
    const version = readCcrVersion(await client.call('getAppInfo'));
    const gateway = parseJsonRecord(await client.call('getGatewayStatus'));
    if (version === null) return null;
    return { version, running: gateway?.['state'] === 'running' };
  } catch {
    return null;
  }
}

/**
 * Install/update only the Token Harness-owned npm CLI copy. It never runs a global npm install
 * and never writes CCR's database directly. Existing CCR profiles/providers remain user data.
 */
export async function ensureManagedCcrRuntime(input: {
  context: CommandContext;
  action: 'configure' | 'update';
}): Promise<
  | {
      kind: 'ready';
      endpoint: string;
      token: string;
      changed: boolean;
      lifecycleAction: 'install' | 'update' | 'start';
      packagePath: string;
      executablePath: string;
    }
  | { kind: 'result'; result: CommandResult<SmartRoutingCommandReport> }
> {
  const { context } = input;
  if (context.adapters === null || context.stateRoot === null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-local-state-required',
        'Managed CCR needs Token Harness local state and process adapters',
        'Run this command from the local Token Harness installation',
      ),
    };
  }
  const nodeMajor = Number(/^v?(\d+)/.exec(context.platform.nodeVersion ?? '')?.[1]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-node-version-unsupported',
        'CCR CLI requires Node.js 22 or newer',
        'Run Token Harness with Node.js 22+ and retry',
      ),
    };
  }
  const fs = context.adapters.fs;
  const root = ccrRuntimeRoot(context);
  const prior = await readManagedCcrRuntime(context);
  const token = await readPrivateToken(context);
  if (prior === null && (await fs.stat(runtimeReceiptPath(context))) !== null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-runtime-receipt-unrecognized',
        'The local CCR runtime receipt exists but is not a valid Token Harness ownership record',
        'Inspect or move the receipt before setup; Token Harness will not overwrite unrecognized runtime state',
      ),
    };
  }
  if (prior === null && (await fs.stat(runtimeTokenPath(context))) !== null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-runtime-token-unrecognized',
        'A local CCR credential exists without a valid Token Harness ownership receipt',
        'Inspect or move the credential before setup; Token Harness will not replace unrecognized authentication state',
      ),
    };
  }
  if (prior !== null && token === null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-managed-token-missing',
        'Token Harness could not read the private credential for its managed CCR service',
        'Restore the private credential from a backup or remove the managed runtime manually before reinstalling',
      ),
    };
  }
  if (prior === null && (await localManagementPortIsOccupied(context))) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-existing-service-auth-required',
        'A local service is already listening on CCR’s default management port, but Token Harness cannot authenticate to it',
        'Set CCR_WEB_AUTH_TOKEN and optionally CCR_WEB_URL to connect to that CCR instance; Token Harness will not start a second gateway beside it',
      ),
    };
  }
  if (input.action === 'update' && prior === null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-managed-runtime-required',
        'Token Harness has no CCR CLI installation to update',
        'Run `token-harness routing --configure-ccr --harness <claude|codex>` first',
      ),
    };
  }
  if (prior?.version === CCR_REVIEWED_VERSION) {
    if (token === null)
      return {
        kind: 'result',
        result: lifecycleError(
          'ccr-managed-token-missing',
          'Token Harness could not read its private CCR management credential',
          'Inspect the protected Token Harness smart-routing state and rerun setup if the credential was removed',
        ),
      };
    const current = await verifyManagedService(context, prior, token);
    if (current?.version === CCR_REVIEWED_VERSION) {
      return input.action === 'update'
        ? { kind: 'result', result: lifecyclePreview('update', 'already-current', context, prior) }
        : {
            kind: 'ready',
            endpoint: prior.managementEndpoint,
            token,
            changed: false,
            lifecycleAction: 'start',
            packagePath: prior.installPrefix,
            executablePath: prior.executablePath,
          };
    }
  }
  if (!context.confirmed) {
    const action =
      prior === null ? 'install' : prior.version === CCR_REVIEWED_VERSION ? 'start' : 'update';
    return {
      kind: 'result',
      result: lifecyclePreview(action, 'preview', context, prior ?? undefined),
    };
  }

  const runtimeToken = token ?? randomBytes(32).toString('base64url');
  const prefix = packagePrefix(context, CCR_REVIEWED_VERSION);
  const executable = ccrExecutable(context, prefix);
  const existingPrefixStat = await fs.stat(prefix);
  if (prior === null && existingPrefixStat !== null) {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-install-path-unowned',
        'The Token Harness CCR package path already contains files with no ownership receipt',
        'Inspect the path reported in the preview and move it before setup; Token Harness will not adopt unknown files',
      ),
    };
  }

  let changed = false;
  if ((await packageVersionAt(context, prefix)) !== CCR_REVIEWED_VERSION) {
    const npm = context.adapters.resolveExecutables?.('npm') ?? [];
    if (npm.length === 0 && context.adapters.resolveExecutables !== undefined) {
      return {
        kind: 'result',
        result: lifecycleError(
          'ccr-npm-not-found',
          'npm could not be resolved, so CCR was not installed',
          'Install npm with Node.js 22+ and retry',
        ),
      };
    }
    if (prior !== null) {
      const stop = await runCcrExecutable(context, prior.executablePath, ['stop'], runtimeToken);
      if (!successfulProcess(stop)) {
        return {
          kind: 'result',
          result: lifecycleError(
            'ccr-stop-before-update-failed',
            'Token Harness could not stop its managed CCR service before updating',
            'Review the local CCR service and retry; the current installation was left in place',
          ),
        };
      }
    }
    const install = await context.adapters.runner.run({
      executable: 'npm',
      args: [
        'install',
        '--prefix',
        prefix,
        '--no-save',
        '--package-lock=true',
        `${CCR_PACKAGE}@${CCR_REVIEWED_VERSION}`,
      ],
      cwd: context.projectRoot,
      timeoutMs: 10 * 60_000,
      maxOutputBytes: 256 * 1024,
    });
    if (
      !successfulProcess(install) ||
      (await packageVersionAt(context, prefix)) !== CCR_REVIEWED_VERSION
    ) {
      const restored =
        prior !== null &&
        (await startAndVerify(context, prior, runtimeToken, prior.version)) !== null;
      return {
        kind: 'result',
        result: lifecycleError(
          'ccr-npm-install-failed',
          `npm did not install the reviewed CCR CLI ${CCR_REVIEWED_VERSION}`,
          restored
            ? 'The previously managed CCR package and gateway were restored; check npm connectivity and retry from a fresh preview'
            : prior !== null
              ? 'The package update failed and Token Harness could not verify restart of the previous gateway; inspect local CCR status before retrying'
              : 'Check npm connectivity and retry from a fresh preview; no global npm package was modified',
        ),
      };
    }
    changed = true;
  }

  const provisional: ManagedCcrRuntimeReceipt = {
    schemaVersion: 1,
    version: CCR_REVIEWED_VERSION,
    installPrefix: prefix,
    executablePath: executable,
    managementEndpoint: prior?.managementEndpoint ?? `http://127.0.0.1:${String(DEFAULT_WEB_PORT)}`,
    installedAt: prior?.installedAt ?? context.now(),
  };
  try {
    await fs.createDirectory(root);
    await fs.writeFile(
      runtimeTokenPath(context),
      new TextEncoder().encode(`${runtimeToken}\n`),
      '0600',
    );
  } catch {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-token-store-failed',
        'Token Harness could not store the local CCR management credential securely',
        'Check Token Harness state-directory permissions; no CCR profile or route change was applied',
      ),
    };
  }

  try {
    await fs.writeFile(
      runtimeReceiptPath(context),
      new TextEncoder().encode(`${JSON.stringify(provisional, null, 2)}\n`),
      '0600',
    );
  } catch {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-receipt-write-failed',
        'Token Harness could not save the local CCR ownership receipt before starting the service',
        'Repair the protected Token Harness state directory; CCR was not started',
      ),
    };
  }
  const started = await startAndVerify(context, provisional, runtimeToken);
  if (started === null) {
    if (prior !== null) {
      const restored = (await startAndVerify(context, prior, runtimeToken, prior.version)) !== null;
      if (!restored)
        return {
          kind: 'result',
          result: lifecycleError(
            'ccr-start-verification-failed',
            'The new CCR service failed verification and Token Harness could not verify restart of the previous gateway',
            'Inspect local CCR status before retrying; the ownership receipt was retained for recovery',
          ),
        };
      await fs.writeFile(
        runtimeReceiptPath(context),
        new TextEncoder().encode(`${JSON.stringify(prior, null, 2)}\n`),
        '0600',
      );
    }
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-start-verification-failed',
        'The managed CCR service did not pass its local management/version checks',
        'Inspect CCR service status and retry; Token Harness did not change routing or report savings',
      ),
    };
  }
  const active: ManagedCcrRuntimeReceipt = { ...provisional, managementEndpoint: started.endpoint };
  try {
    await fs.writeFile(
      runtimeReceiptPath(context),
      new TextEncoder().encode(`${JSON.stringify(active, null, 2)}\n`),
      '0600',
    );
  } catch {
    return {
      kind: 'result',
      result: lifecycleError(
        'ccr-receipt-write-failed',
        'CCR started, but Token Harness could not save its ownership receipt',
        'Keep CCR running; repair the protected Token Harness state directory, then rerun setup',
      ),
    };
  }
  changed = true;
  return {
    kind: 'ready',
    endpoint: started.endpoint,
    token: runtimeToken,
    changed,
    lifecycleAction:
      prior === null ? 'install' : prior.version === CCR_REVIEWED_VERSION ? 'start' : 'update',
    packagePath: prefix,
    executablePath: executable,
  };
}
