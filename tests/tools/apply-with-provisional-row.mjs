/**
 * Runs a managed lifecycle operation against a *provisional* compatibility row, so compatibility
 * row fixtures can record states that would otherwise be blocked by the row they are trying to
 * establish — PLAN §15 item 44, RFC 0009 §Compatibility matrix.
 *
 * ## The circularity this exists to break
 *
 * RFC 0009 requires a row's fixture to cover the exact post-apply configuration, an update that
 * invalidates the row, user drift after apply, and rollback. All four are states that exist only
 * *after* an apply — and `apply` refuses a managed mutation that no row admits. The row is what the
 * fixture is for, so nothing can be recorded and nothing can be admitted.
 *
 * The way through is the seam the integration suites already use: `RunOptions.compatibilityRows`
 * replaces the shipped table for one run. A provisional row is scaffolding for the recording, and
 * the reviewed row that ships cites the artifact the recording produced.
 *
 * ## Why this is not a force flag, and why it lives here
 *
 * RFC 0003 §Profiles: "An unsafe overlap requires a named compatibility rule, never a generic force
 * flag." An environment variable in the shipped CLI that injected rows would be that flag under
 * another name — anyone could switch the RFC 0009 gate off, and the gate exists so mutation stays
 * narrower than detection.
 *
 * So the injection lives in `tests/tools/`, which `scripts/package.mjs` does not publish, and it
 * duplicates `main.ts`'s adapter wiring rather than adding a hook to it. The duplication is the
 * price of the shipped CLI having no such door, and that is the right trade.
 *
 * ## What the provisional row claims
 *
 * Exactly the machine in front of it: the observed harness and provider versions, this platform,
 * and `config-only` — never a stronger tier than a recording can support. It admits one
 * combination for one run. It is not written to disk and it is not a row anyone reviewed.
 *
 * Usage, from a built checkout (`pnpm build` first):
 *
 *   node tests/tools/apply-with-provisional-row.mjs --harness claude --provider rtk --project .
 *   node tests/tools/apply-with-provisional-row.mjs --operation uninstall --harness codex --provider harnesstrim --project .
 *
 * `--operation` defaults to `apply`; `uninstall` exists specifically so the fixture can prove
 * surgical removal before the reviewed row is committed.
 */

import process from 'node:process';

import { JsonlStore, deriveProjectId, harnessId, providerId } from '@token-harness/core';
import {
  ChildLocalDatabase,
  NodeFileSystem,
  nodeSystemProbe,
  resolveAttributionSalt,
  resolveHostEnvironment,
} from '@token-harness/platform';
import { run } from 'token-harness';

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`--${arg.slice(2)} needs a value`);
    args[arg.slice(2)] = value;
    index += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const operation = args.operation ?? 'apply';
if (operation !== 'apply' && operation !== 'uninstall') {
  throw new Error('--operation must be apply or uninstall');
}
for (const required of ['harness', 'provider', 'project']) {
  if (args[required] === undefined) throw new Error(`--${required} is required`);
}

/**
 * `--home` records against an isolated home instead of the operator's own.
 *
 * Two reasons, and the first was found by running this without it. The post-apply state can only be
 * recorded where the mutation is actually needed, and on a machine that already has the integration
 * `apply` correctly reports nothing to change — on this development machine RTK is wired into the
 * real `~/.claude/settings.json`, so there was no post-apply state to capture. The second is that a
 * recording must not mutate the operator's working configuration to get its fixture.
 *
 * A probe override rather than mutating `process.env`: `resolveHostEnvironment` takes the probe, so
 * the isolation is an argument instead of a side effect, and the harness config paths — which are
 * all home-relative — follow it.
 */
const probe = (() => {
  const base = nodeSystemProbe();
  if (args.home === undefined) return base;
  return {
    ...base,
    homeDirectory: args.home,
    env: {
      ...base.env,
      HOME: args.home,
      USERPROFILE: args.home,
      LOCALAPPDATA: `${args.home}/state`,
    },
  };
})();

if (args.home !== undefined) {
  process.stderr.write(`isolated home: ${args.home}\n`);
}

const resolution = resolveHostEnvironment({ probe });
if (!resolution.ok) {
  process.stderr.write('the host environment did not resolve; nothing can be applied here\n');
  process.exitCode = 9;
} else {
  const facts = resolution.environment.facts;
  const fs = new NodeFileSystem(facts);
  const attribution = await resolveAttributionSalt(fs, resolution.environment.paths.state);

  /**
   * The versions the run will observe, read the same way the recorder reads them.
   *
   * A row records versions, and a provisional row that named a version the machine does not have
   * would admit a combination nobody is standing in. Both must be readable or there is nothing to
   * record: a null here stops the run rather than being filled in with a guess.
   */
  const observe = async (executable) => {
    const outcome = await resolution.environment.runner.run({
      executable,
      args: ['--version'],
      cwd: args.project,
      timeoutMs: 20_000,
    });
    const match = /(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)/.exec(outcome.stdout ?? '');
    return match?.[1] ?? null;
  };

  const harnessVersion = await observe(args.harness === 'claude' ? 'claude' : args.harness);
  const providerVersion = await observe(args.provider);

  if (harnessVersion === null || providerVersion === null) {
    process.stderr.write(
      `refusing to ${operation}: ${args.harness}=${String(harnessVersion)} ${args.provider}=${String(providerVersion)}\n` +
        'A provisional row must name versions this machine actually reports, or the recording ' +
        'describes a combination nobody is standing in.\n',
    );
    process.exitCode = 1;
  } else {
    const row = {
      harness: harnessId(args.harness),
      // A point, not a span: this run observed one version, so the row admits one.
      harnessVersion: { minimum: harnessVersion, maximum: harnessVersion },
      provider: providerId(args.provider),
      providerVersion,
      platform: { os: facts.os, wsl: facts.isWsl, supported: true, limitation: null },
      configSchema: `provisional-${args.harness}-${harnessVersion}`,
      fixture: `provisional-recording-${args.provider}-${args.harness}-${providerVersion}`,
      // Never stronger than what a recording can support. RFC 0007: a tier is what `verify` can
      // prove, and a recording proves configuration, not interception.
      verificationTier: 'config-only',
    };

    process.stderr.write(
      `provisional row: ${args.provider} ${providerVersion} on ${args.harness} ${harnessVersion} (${facts.os}${facts.isWsl ? ', wsl' : ''})\n` +
        'This row is scaffolding for a recording. It is not written anywhere and admits this run only.\n\n',
    );

    const exitCode = await run({
      argv: [
        operation,
        '--yes',
        '--harness',
        args.harness,
        '--provider',
        args.provider,
        '--project',
        args.project,
      ],
      streams: {
        out: (text) => process.stdout.write(text),
        err: (text) => process.stderr.write(text),
      },
      platform: facts,
      cwd: args.project,
      home: resolution.environment.paths.home,
      stateRoot: resolution.environment.paths.state,
      environmentDiagnostics: attribution.diagnostics,
      adapters: {
        fs,
        runner: resolution.environment.runner,
        paths: resolution.environment.paths,
        localDatabase: new ChildLocalDatabase({
          runner: resolution.environment.runner,
          nodeExecutable: process.execPath,
          entryScript: process.argv[1] ?? '',
          exists: async (path) => (await fs.stat(path)) !== null,
          databaseDirectory: resolution.environment.paths.state,
        }),
        projectIdFor: (absolutePath) =>
          attribution.salt === null
            ? 'p_unattributed'
            : deriveProjectId(absolutePath, attribution.salt, facts.os === 'windows'),
      },
      compatibilityRows: [row],
      metrics: new JsonlStore({
        fs,
        stateRoot: resolution.environment.paths.state,
        now: () => new Date().toISOString(),
      }),
      env: process.env,
      stdoutIsTty: false,
    });

    process.exitCode = exitCode;
  }
}
