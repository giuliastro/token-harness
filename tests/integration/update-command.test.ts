/**
 * `token-harness update` end to end — RFC 0001 §CLI contract, RFC 0004 §Provider update policy and
 * §Amended.
 *
 * Every case here is a *refusal to act* except one, which is the shape of the command: an update
 * that is willing to guess is worse than one that reports it cannot tell. The channel is faked at
 * the process-runner seam, so no test reaches a package index or the real home.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  EXIT_CODES,
  deriveProjectId,
  type CliEnvelope,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type ResolvedExecutable,
  type UpdateReport,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { run, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const SALT = 'a'.repeat(64);

/**
 * The channel RTK actually uses here, and the shape that channel answers in.
 *
 * Not a detail, and not something to paper over by forcing Windows facts: RTK declares `winget` at
 * priority 0 for Windows only and `cargo` at priority 1 everywhere, so the channel under test is
 * genuinely different per platform. The first version of this file hardcoded winget and passed on
 * Windows while failing all eight cases on Linux and macOS — the tests were asserting one
 * platform's channel selection on three platforms.
 *
 * Parameterising it means each platform exercises the channel it will really use, including that
 * channel's own output format, which is more informative than pinning one everywhere.
 */
const CHANNEL = FACTS.os === 'windows' ? 'winget' : 'cargo';
const PACKAGE = FACTS.os === 'windows' ? 'rtk-ai.rtk' : 'rtk';
const QUERY_VERB = FACTS.os === 'windows' ? 'show' : 'search';

/** The inventory query the channel answers, by name — `winget list`, `cargo install --list`. */
const INVENTORY_LINE =
  FACTS.os === 'windows' ? 'winget list --id rtk-ai.rtk --exact' : 'cargo install --list';

/**
 * What the channel prints for a given available version.
 *
 * winget prints a table with a localized header and a separator of dashes; cargo prints
 * `name = "version"    # description`. Both are the real documented shapes.
 */
function channelAnswer(...versions: string[]): string {
  if (FACTS.os === 'windows') {
    return ['Trovato rtk [rtk-ai.rtk]', 'Versione', '--------', ...versions, ''].join('\r\n');
  }
  return `${versions.map((version) => `rtk = "${version}"    # a token-saving proxy`).join('\n')}\n`;
}

/**
 * What the channel reports as *installed* — `winget list` rows and `cargo install --list` lines.
 */
function inventoryAnswer(version: string): string {
  if (FACTS.os === 'windows') {
    return ['Trovato rtk [rtk-ai.rtk]', 'Versione', '--------', version, ''].join('\r\n');
  }
  return `rtk v${version}:\n    /home/user/.cargo/bin/rtk\n`;
}

let sandbox = '';
let counter = 0;

before(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'th-update-'));
});

after(() => {
  rmSync(sandbox, { recursive: true, force: true });
});

interface World {
  home: string;
  state: string;
  project: string;
}

function world(options: { pins?: unknown; projectPins?: unknown } = {}): World {
  counter += 1;
  const root = join(sandbox, `w-${String(counter)}`);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
  // A wired Claude Code, so the providers are `configured` rather than merely available.
  writeFileSync(
    join(home, '.claude', 'settings.json'),
    JSON.stringify({
      hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: 'rtk hook claude' }] }] },
    }),
  );
  if (options.pins !== undefined) {
    writeFileSync(join(state, 'pins.json'), JSON.stringify(options.pins));
  }
  if (options.projectPins !== undefined) {
    mkdirSync(join(project, '.token-harness'), { recursive: true });
    writeFileSync(
      join(project, '.token-harness', 'pins.json'),
      JSON.stringify(options.projectPins),
    );
  }
  return { home, state, project };
}

interface FakeChannel {
  /** Version each provider's own executable reports. Absent means the executable is missing. */
  installed?: Readonly<Record<string, string>>;
  /** Raw stdout the channel query returns, by executable name. */
  channelStdout?: Readonly<Record<string, string>>;
  /** Raw stdout the inventory query returns, keyed by the full command line. */
  inventoryStdout?: Readonly<Record<string, string>>;
  /** Exit code the install invocation returns. */
  installExitCode?: number;
}

/**
 * A runner that answers as the machine would, and records what it was asked.
 *
 * Provider version probes and channel queries both come through here, which is what lets a test
 * say "installed 0.42.0, channel offers 0.44.0" without either tool being present.
 */
function fakeRunner(config: FakeChannel): { asked: string[]; runner: ProcessRunner } {
  const asked: string[] = [];
  const installed = config.installed ?? {};
  const channelStdout = config.channelStdout ?? {};
  const inventoryStdout = config.inventoryStdout ?? {};

  const answer = (request: ProcessRequest): ProcessOutcome => {
    const line = `${request.executable} ${request.args.join(' ')}`;
    const base = {
      displayCommand: line,
      interpreter: 'direct' as const,
      executablePath: `/usr/bin/${request.executable}`,
      signal: null,
      stderr: '',
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 1,
      timedOut: false,
      failure: null,
    };

    // The inventory query is a read, but it shares the executable with the install (on cargo,
    // `install --list` vs `install <crate>`), so it is keyed by the full line rather than guessed
    // from a flag.
    const inventory = inventoryStdout[line];
    if (inventory !== undefined) return { ...base, exitCode: 0, stdout: inventory };

    const channel = channelStdout[request.executable];
    if (channel !== undefined) {
      // An install through the same executable is not a query: `install` mutates, `show`/`view` read.
      const isInstall = request.args[0] === 'install';
      return isInstall
        ? { ...base, exitCode: config.installExitCode ?? 0, stdout: '' }
        : { ...base, exitCode: 0, stdout: channel };
    }

    const version = installed[request.executable];
    if (version !== undefined) return { ...base, exitCode: 0, stdout: version };

    return {
      ...base,
      executablePath: null,
      exitCode: null,
      stdout: '',
      failure: { reason: 'executable-not-found' as const, message: 'missing' },
    };
  };

  return {
    asked,
    runner: {
      run(request) {
        asked.push(`${request.executable} ${request.args.join(' ')}`);
        return Promise.resolve(answer(request));
      },
    },
  };
}

async function invoke(
  argv: readonly string[],
  place: World,
  config: FakeChannel,
): Promise<{ exitCode: number; data: UpdateReport | null; codes: string[]; asked: string[] }> {
  const known = new Set([
    'rtk',
    'harnesstrim',
    ...Object.keys(config.channelStdout ?? {}),
    ...Object.keys(config.installed ?? {}),
  ]);
  const resolve = (name: string): ResolvedExecutable | null =>
    known.has(name) ? { requested: name, path: `/usr/bin/${name}`, kind: 'native' } : null;

  const { asked, runner } = fakeRunner(config);
  let stdout = '';
  const options: RunOptions = {
    argv: [...argv, '--json'],
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: () => undefined,
    },
    platform: FACTS,
    cwd: place.project,
    home: place.home,
    stateRoot: place.state,
    adapters: {
      fs: new NodeFileSystem(FACTS),
      // Wrapped so the resolver is consulted the way the real runner consults it: a name the test
      // did not declare resolves to nothing, and the provider is then absent.
      runner: {
        run: (request) =>
          resolve(request.executable) === null
            ? Promise.resolve({
                displayCommand: `${request.executable} ${request.args.join(' ')}`,
                interpreter: 'direct' as const,
                executablePath: null,
                exitCode: null,
                signal: null,
                stdout: '',
                stderr: '',
                stdoutTruncated: false,
                stderrTruncated: false,
                durationMs: 0,
                timedOut: false,
                failure: { reason: 'executable-not-found' as const, message: 'missing' },
              })
            : runner.run(request),
      },
      paths: {
        home: place.home,
        config: join(place.home, 'config'),
        data: join(place.home, 'data'),
        state: place.state,
        cache: join(place.home, 'cache'),
      },
      localDatabase: null,
      projectIdFor: (path) => deriveProjectId(path, SALT, FACTS.os === 'windows'),
    },
    metrics: null,
    now: () => '2026-08-01T09:00:00.000Z',
  };

  const exitCode = await run(options);
  const envelope = JSON.parse(stdout) as CliEnvelope<UpdateReport>;
  return {
    exitCode,
    data: envelope.data,
    codes: envelope.diagnostics.map((entry) => entry.code),
    asked,
  };
}

function row(data: UpdateReport | null, provider: string) {
  return data?.providers.find((entry) => entry.providerId === provider);
}

describe('update', () => {
  it('refuses without --yes and names both versions', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0', '0.43.0') },
    });

    // RFC 0006: mutating commands are dry-run by default and there is no flag that skips planning.
    assert.equal(result.exitCode, EXIT_CODES['confirmation-required']);
    assert.ok(result.codes.includes('confirmation-required'));
    // The channel was asked, by the name *that* channel knows the package as — `rtk-ai.rtk` on
    // winget and the bare crate name on cargo. Defaulting to the provider id would query nothing.
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} ${QUERY_VERB}`) && line.includes(PACKAGE),
      ),
      JSON.stringify(result.asked),
    );
    assert.equal(
      result.asked.some((line) => line.startsWith(`${CHANNEL} install`)),
      false,
    );
  });

  it('reports the network it reached on a dry run', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      // Nothing newer, so the run is conclusive and `data` survives — exit 8 nulls it.
      channelStdout: { [CHANNEL]: channelAnswer('0.42.0') },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    /**
     * RFC 0004 §Network policy, on the reconnaissance rather than on the install.
     *
     * A command that changes nothing still reached a package index, and that is the part most
     * likely to surprise someone. It cannot be avoided — a target version cannot be named without
     * asking — so it is disclosed.
     */
    assert.deepEqual(result.data?.network, [`${CHANNEL} package index`]);
    assert.equal(row(result.data, 'rtk')?.verdict, 'current');
  });

  it('does not act when the channel offers something older', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.44.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.42.0') },
    });

    // The user may have installed something newer deliberately. Going backwards is RFC 0004's
    // binary rollback, which is a different command.
    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(row(result.data, 'rtk')?.verdict, 'current');
  });

  it('skips a pinned provider and says which version holds it', async () => {
    const place = world({
      pins: { schemaVersion: 1, pins: [{ provider: 'rtk', version: '0.42.0' }] },
    });
    const result = await invoke(['update', '--provider', 'rtk'], place, {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
    });

    assert.equal(row(result.data, 'rtk')?.verdict, 'pinned');
    assert.equal(row(result.data, 'rtk')?.pin, '0.42.0');
    // RFC 0004 §Amended: a deliberately frozen environment is a state, not a problem.
    assert.equal(result.exitCode, EXIT_CODES.ok);
    // And the channel was never asked, because the answer could not change anything.
    assert.equal(
      result.asked.some((line) => line.startsWith(`${CHANNEL} ${QUERY_VERB}`)),
      false,
    );
  });

  it('reports a project pin without obeying it', async () => {
    const place = world({
      projectPins: { schemaVersion: 1, pins: [{ provider: 'rtk', version: '0.1.0' }] },
    });
    const result = await invoke(['update', '--provider', 'rtk'], place, {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.42.0') },
    });

    // RFC 0004 §Repository trust: a repository may not choose which version the user runs, and no
    // trust mechanism exists to make it able to.
    assert.ok(result.codes.includes('project-pin-not-honored'));
    assert.equal(row(result.data, 'rtk')?.verdict, 'current');
    assert.equal(row(result.data, 'rtk')?.pin, null);
  });

  it('leaves a provider that is not installed alone', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
    });

    // `update` updates. Installing here would be an install nobody reviewed as one.
    assert.equal(row(result.data, 'rtk')?.verdict, 'not-installed');
    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(
      result.asked.some((line) => line.startsWith(`${CHANNEL} install`)),
      false,
    );
  });

  it('says the channel answered unreadably rather than claiming it is current', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      // A shape this build does not read — a future winget, or another locale's layout.
      channelStdout: { [CHANNEL]: 'Versione: 0.44.0\r\n' },
    });

    assert.equal(row(result.data, 'rtk')?.verdict, 'unknown');
    assert.equal(row(result.data, 'rtk')?.available, null);
    assert.ok(result.codes.includes('version-query-unreadable'));
    /**
     * The distinction the first version of this got wrong.
     *
     * `current` and `unknown` are different claims, and reporting the first here would tell a user
     * they are up to date on the strength of an answer nobody could read.
     */
    assert.notEqual(row(result.data, 'rtk')?.verdict, 'current');
  });

  it('installs the exact version the dry run showed, when confirmed', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0', '0.43.0') },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.data?.execution?.outcome, 'committed');
    /**
     * `--version 0.44.0`, not an open-ended install.
     *
     * An unpinned upgrade would install whatever is newest when it executes, which is not the
     * version the dry run displayed and approved.
     */
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} install`) && line.includes('--version 0.44.0'),
      ),
      JSON.stringify(result.asked),
    );
  });

  it('captures the installed version so a later rollback can restore it', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
      inventoryStdout: { [INVENTORY_LINE]: inventoryAnswer('0.42.0') },
    });

    // RFC 0009 §Initial delivery order item 1: the channel was asked what it has installed before
    // the update ran, so a rollback can put the machine back — the receipt says so instead of the
    // pre-0009 "a package is not a file".
    assert.ok(
      result.asked.some(
        (line) =>
          line.startsWith(`${CHANNEL} list`) || line.startsWith(`${CHANNEL} install --list`),
      ),
      `expected the inventory query: ${JSON.stringify(result.asked)}`,
    );
    assert.ok(result.codes.includes('install-inventory-captured'));
    assert.ok(!result.codes.includes('install-not-reversible'));
  });

  it('says the installed package will survive a rollback when no capture exists', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
      // The channel answered nothing this build reads — a shape a future winget, or another
      // locale, would produce — so the update cannot restore the machine and says so.
      inventoryStdout: { [INVENTORY_LINE]: 'Versione: 0.44.0\r\n' },
    });

    // RFC 0004: rollback restores files, and a package is not a file. Reporting a clean transaction
    // without this would leave the user believing the machine could be returned to where it was.
    assert.ok(result.codes.includes('install-not-reversible'));
  });

  it('reports a failed install as a failure rather than as an update', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
      installExitCode: 1,
    });

    assert.notEqual(result.data?.execution?.outcome, 'committed');
    assert.ok(result.codes.includes('install-command-failed'));
  });
});
