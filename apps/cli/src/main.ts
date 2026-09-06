/**
 * Process entry point.
 *
 * This file is the only place in the CLI that reads `process`, enforced by
 * `tests/integration/architecture.test.ts`. Everything below it takes injected
 * values, which is what lets the whole CLI contract be tested without touching the
 * real machine.
 *
 * Phase 1 carried a provisional platform observer here, with a comment saying the
 * real detector belonged to PLAN §2.1. It does, and it now lives in
 * `@token-harness/platform`, so this file is down to: resolve the host, hand the
 * result to `run`, and set the exit code.
 */

import process from 'node:process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

import {
  EXIT_CODES,
  JsonlStore,
  commandResult,
  deriveProjectId,
  diagnostic,
  serializeEnvelope,
  toEnvelope,
  type BudgetReport,
  type CliEnvelope,
  type DoctorReport,
  type OptimizeReport,
  type MetricsReport,
  type ExitCode,
  type StatusReport,
} from '@token-harness/core';
import {
  ChildLocalDatabase,
  NodeFileSystem,
  SQLITE_CHILD_FLAG,
  readLocalDatabase,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';

import { run, type RunOptions } from './run.js';
import {
  UI_USAGE,
  buildDashboardModel,
  parseUiArgs,
  uiAsset,
  type DashboardModel,
  type UiOptions,
} from './ui.js';
import { TOOL_VERSION } from './version.js';
import { createGuideCall, GuideService, savingsView, type GuidePeriod } from './guided.js';
import { createGuideHandler } from './guided-http.js';

/**
 * The internal reader mode.
 *
 * `ChildLocalDatabase` re-invokes this same program with `SQLITE_CHILD_FLAG` rather than
 * shipping a second entry point beside the bundle. Handled here, before anything else,
 * because this is not a command: it takes no options, emits one JSON document, and must not
 * pass through argument parsing, the runtime-floor check, or the envelope — a child that
 * printed a usage page would be indistinguishable from a child that returned no rows.
 *
 * It is checked by exact position. A stray `--internal-read-local-database` further along a
 * real command line is a usage error, not an invitation.
 */
async function runAsDatabaseReader(argv: readonly string[]): Promise<boolean> {
  if (argv[0] !== SQLITE_CHILD_FLAG) return false;

  let request: unknown = null;
  try {
    request = JSON.parse(argv[1] ?? 'null');
  } catch {
    request = null;
  }
  const result = await readLocalDatabase(request);
  process.stdout.write(JSON.stringify(result));
  process.exitCode = 0;
  return true;
}

export async function main(argv: readonly string[]): Promise<void> {
  if (await runAsDatabaseReader(argv)) return;

  const opensGuide = argv.length === 0 || argv[0] === 'start' || argv[0] === 'ui';
  const readOnly = argv.includes('--read-only');
  const uiInvocation = opensGuide
    ? parseUiArgs(argv.slice(1).filter((arg) => arg !== '--read-only'))
    : null;
  if (uiInvocation !== null && !uiInvocation.ok) {
    process.stderr.write(`${uiInvocation.message}\nRun token-harness ui --help for usage.\n`);
    process.exitCode = EXIT_CODES['usage-error'];
    return;
  }
  if (uiInvocation?.ok === true && uiInvocation.options.help) {
    process.stdout.write(
      readOnly
        ? UI_USAGE + '\n'
        : 'Token Harness: open, review setup once, then use your coding agent normally.\n\n' +
            '  token-harness                   Open the guided application\n' +
            '  token-harness start             Same guided application\n' +
            '  token-harness savings           Show recorded output savings across projects\n' +
            '  token-harness ui --no-open      Start without opening a browser\n' +
            '  token-harness ui --read-only    Use the legacy read-only dashboard\n' +
            '  token-harness ui --json         Emit the existing schema-1 status report\n\n' +
            'The local application listens only on 127.0.0.1 and shows setup, measured results and rules. Changes require an explicit browser approval.\n',
    );
    process.exitCode = EXIT_CODES.ok;
    return;
  }

  const resolution = resolveHostEnvironment();

  /**
   * The ports that need the machine.
   *
   * Assembled only when the host resolved, because each one needs a state directory whose
   * permissions RFC 0004 has already verified. The salt is provisioned as part of that same
   * step; `attribution-salt.ts` records why writing it does not make a read-only command a
   * writing one.
   */
  const fs = resolution.ok ? new NodeFileSystem(resolution.environment.facts) : null;
  const attribution =
    resolution.ok && fs !== null
      ? await resolveAttributionSalt(fs, resolution.environment.paths.state)
      : { salt: null, diagnostics: [] };

  const baseOptions: Omit<RunOptions, 'argv' | 'streams'> = {
    // On failure `facts` is null only when the operating system itself is
    // unsupported. An unresolvable state directory still has honest facts to
    // report, and `run` uses them for the runtime-floor check before refusing.
    platform: resolution.ok ? resolution.environment.facts : resolution.facts,
    cwd: process.cwd(),
    home: resolution.ok ? resolution.environment.paths.home : null,
    stateRoot: resolution.ok ? resolution.environment.paths.state : null,
    environmentDiagnostics: resolution.ok ? attribution.diagnostics : resolution.diagnostics,
    // The ports adapters need. Built here because this is the only file allowed to know
    // there is a real machine underneath.
    adapters:
      resolution.ok && fs !== null
        ? {
            fs,
            runner: resolution.environment.runner,
            resolveExecutables: resolution.environment.resolveExecutables,
            paths: resolution.environment.paths,
            localDatabase: new ChildLocalDatabase({
              runner: resolution.environment.runner,
              nodeExecutable: process.execPath,
              // `argv[1]` is what Node was told to run: the bundled artifact in a release,
              // the development launcher in the workspace. Taking it from here rather than
              // from `import.meta.url` keeps the child running the same program the user
              // started, which is what makes the two impossible to drift apart.
              entryScript: process.argv[1] ?? '',
              exists: async (path) => (await fs.stat(path)) !== null,
              databaseDirectory: resolution.environment.paths.state,
            }),
            projectIdFor: (absolutePath) =>
              attribution.salt === null
                ? 'p_unattributed'
                : deriveProjectId(
                    absolutePath,
                    attribution.salt,
                    resolution.environment.facts.os === 'windows',
                  ),
          }
        : null,
    /**
     * The metrics store.
     *
     * A skipped line goes to stderr as a plain warning rather than into the envelope: the
     * store is read while a report is being assembled, long after the command decided what
     * its diagnostics were. Silence is the one thing it must not be — RFC 0005 exists so a
     * lost record is visible.
     */
    metrics:
      resolution.ok && fs !== null
        ? new JsonlStore({
            fs,
            stateRoot: resolution.environment.paths.state,
            now: () => new Date().toISOString(),
            onSkippedLine: (skipped) => {
              const at = `${skipped.path}:${String(skipped.lineNumber)}`;
              process.stderr.write(`warning  metrics-record-skipped: ${skipped.reason} at ${at}\n`);
            },
          })
        : null,
    env: process.env,
    stdoutIsTty: process.stdout.isTTY === true,
  };

  if (uiInvocation?.ok === true) {
    process.exitCode =
      readOnly || uiInvocation.options.json
        ? await runUi(uiInvocation.options, baseOptions)
        : await runGuidedUi(uiInvocation.options, baseOptions);
    return;
  }

  if (argv[0] === 'savings') {
    process.exitCode = await runSavingsView(argv.slice(1), baseOptions);
    return;
  }

  const exitCode = await run({
    ...baseOptions,
    argv,
    streams: {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
  });

  process.exitCode = exitCode;
}

async function readJsonReport<T>(
  command: string,
  baseOptions: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<{ exitCode: number; data: T }> {
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    ...baseOptions,
    argv: [command, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  });
  let envelope: CliEnvelope<T>;
  try {
    envelope = JSON.parse(stdout) as CliEnvelope<T>;
  } catch {
    throw new Error(stderr.trim() || `${command} did not return a valid report`);
  }
  if (envelope.data === null) {
    throw new Error(
      envelope.diagnostics[0]?.message ?? `${command} could not inspect this computer`,
    );
  }
  return { exitCode, data: envelope.data };
}

async function collectDashboard(
  baseOptions: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<DashboardModel> {
  const [doctor, status, budget, optimize] = await Promise.all([
    readJsonReport<DoctorReport>('doctor', baseOptions),
    readJsonReport<StatusReport>('status', baseOptions),
    readJsonReport<BudgetReport>('budget', baseOptions),
    readJsonReport<OptimizeReport>('optimize', baseOptions),
  ]);
  return buildDashboardModel({
    generatedAt: new Date().toISOString(),
    doctor: doctor.data,
    status: status.data,
    budget: budget.data,
    optimize: optimize.data,
  });
}

const UI_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; " +
    "img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
};

async function openDashboard(
  url: string,
  baseOptions: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<boolean> {
  const adapters = baseOptions.adapters;
  const platform = baseOptions.platform;
  if (adapters === null || adapters === undefined || platform === null) return false;
  const request =
    platform.os === 'windows'
      ? { executable: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] }
      : platform.os === 'macos'
        ? { executable: 'open', args: [url] }
        : { executable: 'xdg-open', args: [url] };
  const result = await adapters.runner.run({
    ...request,
    cwd: baseOptions.cwd,
    env: Object.fromEntries(
      ['DISPLAY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'].flatMap(
        (name) => (process.env[name] === undefined ? [] : [[name, process.env[name] as string]]),
      ),
    ),
    timeoutMs: 5_000,
    maxOutputBytes: 4_096,
  });
  return result.failure === null && result.exitCode === 0;
}

async function runUi(
  options: UiOptions,
  baseOptions: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<number> {
  let initial: DashboardModel;
  try {
    initial = await collectDashboard(baseOptions);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      process.stdout.write(
        serializeEnvelope(
          toEnvelope(
            commandResult({
              command: 'ui',
              exitCode: EXIT_CODES['unsupported-environment'],
              diagnostics: [
                diagnostic({
                  severity: 'error',
                  code: 'dashboard-unavailable',
                  message,
                  remediation: 'Run token-harness doctor --verbose',
                }),
              ],
            }),
            TOOL_VERSION,
          ),
        ),
      );
    } else {
      process.stderr.write(`Token Harness dashboard could not start: ${message}\n`);
    }
    return EXIT_CODES['unsupported-environment'];
  }

  if (options.json) {
    const exitCode =
      initial.state === 'action-needed' ? EXIT_CODES['problems-found'] : EXIT_CODES.ok;
    process.stdout.write(
      serializeEnvelope(
        toEnvelope(commandResult({ command: 'ui', exitCode, data: initial }), TOOL_VERSION),
      ),
    );
    return exitCode;
  }

  let cached = initial;
  let cachedAt = Date.now();
  const server = createServer(async (request, response) => {
    const host = request.headers.host ?? '';
    const sameSite = request.headers['sec-fetch-site'] !== 'cross-site';
    const localHost = host.startsWith('127.0.0.1:') || host.startsWith('localhost:');
    if (!sameSite || !localHost) {
      response.writeHead(403, { ...UI_SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      response.end('Forbidden\n');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, {
        ...UI_SECURITY_HEADERS,
        Allow: 'GET, HEAD',
        'Content-Type': 'text/plain',
      });
      response.end('Method not allowed\n');
      return;
    }
    let model = cached;
    if (request.url === '/api/status') {
      if (Date.now() - cachedAt > 5_000) {
        try {
          cached = await collectDashboard(baseOptions);
          cachedAt = Date.now();
          model = cached;
        } catch {
          response.writeHead(503, {
            ...UI_SECURITY_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
          });
          response.end('{"error":"Dashboard data is temporarily unavailable"}');
          return;
        }
      }
    }
    const asset = uiAsset(request.url ?? '/', model);
    response.writeHead(asset.status, {
      ...UI_SECURITY_HEADERS,
      'Content-Type': asset.contentType,
    });
    response.end(request.method === 'HEAD' ? undefined : asset.body);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', () => resolve());
    });
  } catch (error) {
    process.stderr.write(
      `Token Harness dashboard could not listen locally: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return EXIT_CODES['internal-error'];
  }

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : options.port;
  const url = `http://127.0.0.1:${port}/`;
  process.stdout.write(`Token Harness dashboard is ready: ${url}\nClose it with Ctrl+C.\n`);
  if (options.open && !(await openDashboard(url, baseOptions))) {
    process.stdout.write(`Open this address in your browser: ${url}\n`);
  }
  return EXIT_CODES.ok;
}

async function runGuidedUi(
  options: UiOptions,
  base: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<number> {
  const service = new GuideService(
    createGuideCall(base),
    () => Date.now(),
    () => randomBytes(32).toString('hex'),
  );
  const token = randomBytes(32).toString('hex');
  let authority = '';
  const server = createServer(createGuideHandler({ service, token, authority: () => authority }));
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port, '127.0.0.1', resolve);
    });
  } catch {
    process.stderr.write(
      'The local application could not start. The chosen port may already be in use.\n',
    );
    return EXIT_CODES['internal-error'];
  }
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    return EXIT_CODES['internal-error'];
  }
  authority = `127.0.0.1:${address.port}`;
  const url = `http://${authority}/`;
  process.stdout.write(
    `Token Harness is ready: ${url}\n\n` +
      'Use the browser to review setup, see recorded savings and read the active rules.\n' +
      'No configuration changes happen until you approve them.\n' +
      'Keep using Claude Code and Codex normally. Close this dashboard with Ctrl+C.\n',
  );
  if (options.open && !(await openDashboard(url, base)))
    process.stdout.write(`Open ${url} in your browser.\n`);
  return EXIT_CODES.ok;
}

async function runSavingsView(
  args: readonly string[],
  base: Omit<RunOptions, 'argv' | 'streams'>,
): Promise<number> {
  if (args.includes('--help')) {
    process.stdout.write(
      'token-harness savings [--since all|7d|30d] [--json]\nRecorded output reductions across all locally recorded projects. No configuration changes.\n',
    );
    return EXIT_CODES.ok;
  }
  let period: GuidePeriod = 'all';
  const json = args.includes('--json');
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--json') continue;
    else if (args[index] === '--since' && ['all', '7d', '30d'].includes(args[index + 1] ?? '')) {
      period = args[index + 1] as GuidePeriod;
      index += 1;
    } else {
      const message = 'Use token-harness savings [--since all|7d|30d] [--json].';
      if (json)
        process.stdout.write(
          serializeEnvelope(
            toEnvelope(
              commandResult({
                command: 'savings',
                exitCode: EXIT_CODES['usage-error'],
                data: null,
                diagnostics: [
                  diagnostic({
                    severity: 'error',
                    code: 'invalid-savings-option',
                    message,
                    remediation: 'Run token-harness savings --help',
                  }),
                ],
              }),
              TOOL_VERSION,
            ),
          ),
        );
      else process.stderr.write(message + '\n');
      return EXIT_CODES['usage-error'];
    }
  }
  const result = await createGuideCall(base)<MetricsReport>([
    'savings',
    '--since',
    period === 'all' ? '1970-01-01' : period,
  ]);
  const view = savingsView(result.data, period);
  if (json) {
    process.stdout.write(
      serializeEnvelope(
        toEnvelope(
          commandResult({
            command: 'savings',
            exitCode: result.exitCode as ExitCode,
            data: result.data === null ? null : view,
            diagnostics: result.diagnostics,
          }),
          TOOL_VERSION,
        ),
      ),
    );
  } else if (result.data === null) {
    process.stderr.write(
      'Measurements could not be read. Open Token Harness to check your setup.\n',
    );
  } else {
    process.stdout.write(
      'RECORDED SAVINGS\nAll locally recorded projects / ' +
        (period === 'all' ? 'all available history' : period) +
        '\n\n',
    );
    if (view.rows.length === 0)
      process.stdout.write(
        'No measurable reductions recorded yet. This is not a measured zero.\nUse the configured agent normally; some integrations require telemetry to be enabled.\n',
      );
    for (const row of view.rows)
      process.stdout.write(
        `${row.provider}: ${Math.abs(row.saved).toLocaleString()} ${row.unit} ${row.saved < 0 ? 'added, not saved' : 'removed'}\n  ${row.measurement}; ${row.operations} recorded changed outputs.\n`,
      );
    process.stdout.write('\n' + view.note + '\n');
  }
  return result.exitCode;
}
