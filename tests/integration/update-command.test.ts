/**
 * `token-harness update` end to end — RFC 0001 §CLI contract, RFC 0004 §Provider update policy and
 * §Amended.
 *
 * Every case here is a *refusal to act* except the explicitly admitted updates. The channel is
 * faked at the process-runner seam, so no test reaches a package index or the real home.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { after, before, describe, it } from 'node:test';

import {
  EXIT_CODES,
  deriveProjectId,
  type CliEnvelope,
  type CompatibilityRow,
  type PlatformFacts,
  type ProcessOutcome,
  type ProcessRequest,
  type ProcessRunner,
  type ResolvedExecutable,
  type UpdateReport,
} from '@token-harness/core';
import { NodeFileSystem } from '@token-harness/platform';
import { DEFAULT_COMMANDS, run, runUpdateCheck, type RunOptions } from 'token-harness';

const FACTS: PlatformFacts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
};

const SALT = 'a'.repeat(64);
const CHANNEL = FACTS.os === 'windows' ? 'winget' : 'cargo';
const PACKAGE = FACTS.os === 'windows' ? 'rtk-ai.rtk' : 'rtk';
const QUERY_VERB = FACTS.os === 'windows' ? 'show' : 'search';
const INVENTORY_LINE =
  FACTS.os === 'windows' ? 'winget list --id rtk-ai.rtk --exact' : 'cargo install --list';

function channelAnswer(...versions: string[]): string {
  if (FACTS.os === 'windows') {
    return ['Trovato rtk [rtk-ai.rtk]', 'Versione', '--------', ...versions, ''].join('\r\n');
  }
  return `${versions.map((version) => `rtk = "${version}"    # a token-saving proxy`).join('\n')}\n`;
}

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

function world(
  options: {
    pins?: unknown;
    projectPins?: unknown;
    managedIntegrations?: Array<{ providerId: string; harnessId: string }>;
    legacyOwnedState?: boolean;
  } = {},
): World {
  counter += 1;
  const root = join(sandbox, `w-${String(counter)}`);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const project = join(root, 'project');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(state, { recursive: true });
  mkdirSync(project, { recursive: true });
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
  if (options.legacyOwnedState === true) {
    const journals = join(state, 'journals');
    mkdirSync(journals, { recursive: true });
    writeFileSync(
      join(journals, 'legacy-owned.json'),
      JSON.stringify({
        schemaVersion: 1,
        transactionId: 'legacy-owned',
        planId: 'legacy-plan',
        projectId: 'p_test',
        projectRoot: project,
        startedAt: '2026-08-01T07:00:00.000Z',
        finishedAt: '2026-08-01T07:00:01.000Z',
        outcome: 'committed',
        entries: [],
        ownership: [
          {
            kind: 'owned-file',
            path: join(project, '.legacy-managed'),
            digest: 'sha256:legacy',
            mode: null,
          },
        ],
        pinned: false,
        diagnostics: [],
      }),
    );
  }
  if (options.managedIntegrations !== undefined) {
    const journals = join(state, 'journals');
    mkdirSync(journals, { recursive: true });
    writeFileSync(
      join(journals, 'managed.json'),
      JSON.stringify({
        schemaVersion: 1,
        transactionId: 'managed',
        planId: 'deadbeef',
        projectId: 'p_test',
        projectRoot: project,
        startedAt: '2026-08-01T08:00:00.000Z',
        finishedAt: '2026-08-01T08:00:01.000Z',
        outcome: 'committed',
        entries: [],
        ownership: [],
        managedIntegrations: options.managedIntegrations,
        pinned: false,
        diagnostics: [],
      }),
    );
  }
  return { home, state, project };
}

interface FakeChannel {
  installed?: Readonly<Record<string, string>>;
  channelStdout?: Readonly<Record<string, string>>;
  inventoryStdout?: Readonly<Record<string, string>>;
  installExitCode?: number;
  installDoesNotChangeResolvedVersion?: boolean;
  compatibilityRows?: readonly CompatibilityRow[];
  application?: {
    npmRoot: string;
    packageRoot: string;
    installedVersion: string;
    availableVersion: string;
  };
}

function harnesstrimCapabilityAnswer(version: string): string {
  return JSON.stringify({
    version,
    harnesses: {
      claude: {
        adapter: '@harnesstrim/adapter-claude',
        surfaces: ['PostToolUse Bash hook — deterministic reduction of Bash output'],
        narrowing: [
          { flag: '--no-hook', produces: 'skills + instructions only' },
          { flag: '--no-instructions', produces: 'skills + hook only' },
        ],
        writeSet: [
          '.claude/skills/',
          '.claude/settings.json',
          'CLAUDE.md (marker-guarded snippet)',
        ],
      },
      codex: {
        adapter: '@harnesstrim/adapter-codex',
        surfaces: ['PostToolUse Bash hook — deterministic reduction of Bash output'],
        narrowing: [
          { flag: '--no-instructions', produces: 'skills only' },
          { flag: '--hook', produces: 'skills + hook' },
        ],
        writeSet: ['.codex/skills/'],
      },
      opencode: {
        adapter: '@harnesstrim/adapter-opencode',
        surfaces: ['tool.execute.after — slims noisy tool output in place'],
        narrowing: [],
        writeSet: ['.opencode/plugin/harnesstrim.ts'],
      },
      hermes: {
        adapter: '@harnesstrim/adapter-hermes',
        surfaces: ['transform_tool_result — deterministic reduction'],
        narrowing: [],
        writeSet: ['.hermes/plugins/harnesstrim/'],
      },
      pi: {
        adapter: '@harnesstrim/adapter-pi',
        surfaces: ['tool_result — deterministic reduction'],
        narrowing: [],
        writeSet: ['.pi/extensions/harnesstrim/'],
      },
    },
    digests: {
      claude: {
        '.claude/skills/runtime/SKILL.md':
          'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      codex: {
        '.codex/skills/runtime/SKILL.md':
          'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    },
  });
}

function fakeRunner(config: FakeChannel): { asked: string[]; runner: ProcessRunner } {
  const asked: string[] = [];
  const installed: Record<string, string> = { ...(config.installed ?? {}) };
  let applicationVersion = config.application?.installedVersion ?? null;
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

    const inventory = inventoryStdout[line];
    if (inventory !== undefined) return { ...base, exitCode: 0, stdout: inventory };

    if (config.application !== undefined && request.executable === 'npm') {
      if (request.args[0] === 'root' && request.args.includes('--global')) {
        return { ...base, exitCode: 0, stdout: `${config.application.npmRoot}\n` };
      }
      if (
        request.args[0] === 'view' &&
        request.args[1] === 'token-harness' &&
        request.args[2] === 'version'
      ) {
        return { ...base, exitCode: 0, stdout: `${config.application.availableVersion}\n` };
      }
      if (
        request.args[0] === 'ls' &&
        request.args.includes('--global') &&
        request.args.includes('--json')
      ) {
        return {
          ...base,
          exitCode: 0,
          stdout: JSON.stringify({
            dependencies: {
              'token-harness': { version: applicationVersion },
            },
          }),
        };
      }
      if (request.args[0] === 'install' && request.args.includes('--global')) {
        const spec = request.args.find((arg) => arg.startsWith('token-harness@'));
        const version = spec?.slice('token-harness@'.length) ?? null;
        if (version !== null) {
          applicationVersion = version;
          writeFileSync(
            join(config.application.packageRoot, 'package.json'),
            JSON.stringify({ name: 'token-harness', version }),
          );
        }
        return { ...base, exitCode: version === null ? 1 : 0, stdout: '' };
      }
    }

    if (request.executable === 'harnesstrim' && request.args[0] === 'capabilities') {
      const raw = installed['harnesstrim'];
      const version = raw === undefined ? null : (/(\d+\.\d+\.\d+)/.exec(raw)?.[1] ?? null);
      if (version !== null)
        return { ...base, exitCode: 0, stdout: harnesstrimCapabilityAnswer(version) };
    }

    const channel = channelStdout[request.executable];
    if (channel !== undefined) {
      const isInstall = request.args[0] === 'install';
      const exitCode = isInstall ? (config.installExitCode ?? 0) : 0;
      if (isInstall && exitCode === 0 && config.installDoesNotChangeResolvedVersion !== true) {
        const explicitVersionIndex = request.args.indexOf('--version');
        const explicitVersion =
          explicitVersionIndex >= 0 ? (request.args[explicitVersionIndex + 1] ?? null) : null;
        if (
          request.executable === 'winget' &&
          request.args.includes('rtk-ai.rtk') &&
          explicitVersion
        )
          installed['rtk'] = `rtk ${explicitVersion}`;
        if (request.executable === 'cargo' && request.args.includes('rtk') && explicitVersion)
          installed['rtk'] = `rtk ${explicitVersion}`;
        if (request.executable === 'npm') {
          const spec = request.args.find((arg) => arg.startsWith('harnesstrim@'));
          const version = spec?.slice('harnesstrim@'.length) ?? null;
          if (version) installed['harnesstrim'] = version;
        }
      }
      return isInstall
        ? { ...base, exitCode, stdout: '' }
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
  applicationEntryScript?: string,
  readOnlyUpdateCheck = false,
): Promise<{ exitCode: number; data: UpdateReport | null; codes: string[]; asked: string[] }> {
  const known = new Set([
    'rtk',
    'harnesstrim',
    ...(config.application === undefined ? [] : ['npm']),
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
    ...(applicationEntryScript === undefined ? {} : { applicationEntryScript }),
    home: place.home,
    stateRoot: place.state,
    adapters: {
      fs: new NodeFileSystem(FACTS),
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
    compatibilityRows: config.compatibilityRows ?? null,
    now: () => '2026-08-01T09:00:00.000Z',
    ...(readOnlyUpdateCheck ? { commands: { ...DEFAULT_COMMANDS, update: runUpdateCheck } } : {}),
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

function admittedRow(): CompatibilityRow {
  return {
    harness: 'claude' as CompatibilityRow['harness'],
    harnessVersion: { minimum: '2.1.220', maximum: '2.1.220' },
    provider: 'rtk' as CompatibilityRow['provider'],
    providerVersion: '0.44.0',
    platform: { os: FACTS.os, wsl: FACTS.isWsl, supported: true, limitation: null },
    configSchema: 'test-claude-settings',
    fixture: 'tests/fixtures/update-target-reviewed',
    verificationTier: 'canary',
  };
}

describe('update', () => {
  it('refuses without --yes and names both versions', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0', '0.43.0') },
    });

    assert.equal(result.exitCode, EXIT_CODES['confirmation-required']);
    assert.ok(result.codes.includes('confirmation-required'));
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
      channelStdout: { [CHANNEL]: channelAnswer('0.42.0') },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.deepEqual(result.data?.network, [`${CHANNEL} package index`]);
    assert.equal(row(result.data, 'rtk')?.verdict, 'current');
  });

  it('does not act when the channel offers something older', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      installed: { rtk: 'rtk 0.44.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.42.0') },
    });

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
    assert.equal(result.exitCode, EXIT_CODES.ok);
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

    assert.ok(result.codes.includes('project-pin-not-honored'));
    assert.equal(row(result.data, 'rtk')?.verdict, 'current');
    assert.equal(row(result.data, 'rtk')?.pin, null);
  });

  it('leaves a provider that is not installed alone', async () => {
    const result = await invoke(['update', '--provider', 'rtk'], world(), {
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
    });

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
      channelStdout: { [CHANNEL]: 'Versione: 0.44.0\r\n' },
    });

    assert.equal(row(result.data, 'rtk')?.verdict, 'unknown');
    assert.equal(row(result.data, 'rtk')?.available, null);
    assert.ok(result.codes.includes('version-query-unreadable'));
    assert.notEqual(row(result.data, 'rtk')?.verdict, 'current');
  });

  it('does not treat legacy journal attribution as a package-update compatibility gate', async () => {
    const result = await invoke(
      ['update', '--provider', 'rtk', '--yes'],
      world({ legacyOwnedState: true }),
      {
        installed: { rtk: 'rtk 0.42.0', claude: '2.1.220' },
        channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
      },
    );

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.equal(result.codes.includes('provider-update-target-unreviewed'), false);
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} install`) && line.includes('--version 0.44.0'),
      ),
      JSON.stringify(result.asked),
    );
  });

  it('updates a reviewed provider package without a managed-mutation compatibility row', async () => {
    const result = await invoke(
      ['update', '--provider', 'rtk', '--yes'],
      world({ managedIntegrations: [{ providerId: 'rtk', harnessId: 'claude' }] }),
      {
        installed: { rtk: 'rtk 0.42.0', claude: '2.1.220' },
        channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
        compatibilityRows: [],
      },
    );

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(row(result.data, 'rtk')?.verdict, 'upgradable');
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.equal(result.codes.includes('provider-update-target-unreviewed'), false);
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} install`) && line.includes('--version 0.44.0'),
      ),
      JSON.stringify(result.asked),
    );
  });

  it('updates to a future RTK package target without requiring a new compatibility row', async () => {
    const result = await invoke(
      ['update', '--provider', 'rtk', '--yes'],
      world({ managedIntegrations: [{ providerId: 'rtk', harnessId: 'claude' }] }),
      {
        installed: { rtk: 'rtk 0.49.0', claude: '2.1.220' },
        channelStdout: { [CHANNEL]: channelAnswer('0.50.0') },
        compatibilityRows: [admittedRow()],
      },
    );

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(row(result.data, 'rtk')?.verdict, 'upgradable');
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.equal(result.codes.includes('provider-update-target-unreviewed'), false);
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} install`) && line.includes('--version 0.50.0'),
      ),
      JSON.stringify(result.asked),
    );
  });

  it('installs the exact version the dry run showed, when confirmed', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0', '0.43.0') },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.ok(
      result.asked.some(
        (line) => line.startsWith(`${CHANNEL} install`) && line.includes('--version 0.44.0'),
      ),
      JSON.stringify(result.asked),
    );
  });

  it('updates HarnessTrim to the latest npm version and verifies the active executable', async () => {
    const result = await invoke(['update', '--provider', 'harnesstrim', '--yes'], world(), {
      installed: { harnesstrim: '0.2.1' },
      channelStdout: { npm: '0.3.0\n' },
      inventoryStdout: {
        'npm ls --global --depth=0 --json': JSON.stringify({
          dependencies: { harnesstrim: { version: '0.2.1' } },
        }),
      },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(row(result.data, 'harnesstrim')?.verdict, 'upgradable');
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.ok(result.codes.includes('provider-update-version-verified'));
    assert.ok(
      result.asked.includes('npm install --global harnesstrim@0.3.0'),
      JSON.stringify(result.asked),
    );
  });

  it('admits a future HarnessTrim release when its runtime capability contract still matches', async () => {
    const result = await invoke(['update', '--provider', 'harnesstrim', '--yes'], world(), {
      installed: { harnesstrim: '0.3.0' },
      channelStdout: { npm: '0.4.0\n' },
      inventoryStdout: {
        'npm ls --global --depth=0 --json': JSON.stringify({
          dependencies: { harnesstrim: { version: '0.3.0' } },
        }),
      },
    });

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(row(result.data, 'harnesstrim')?.verdict, 'upgradable');
    assert.equal(result.data?.execution?.outcome, 'committed');
    assert.ok(result.codes.includes('provider-update-version-verified'));
    assert.ok(result.asked.includes('npm install --global harnesstrim@0.4.0'));
  });

  it('rolls the update back instead of claiming success when PATH still resolves old HarnessTrim', async () => {
    const result = await invoke(['update', '--provider', 'harnesstrim', '--yes'], world(), {
      installed: { harnesstrim: '0.2.1' },
      channelStdout: { npm: '0.3.0\n' },
      inventoryStdout: {
        'npm ls --global --depth=0 --json': JSON.stringify({
          dependencies: { harnesstrim: { version: '0.2.1' } },
        }),
      },
      installDoesNotChangeResolvedVersion: true,
    });

    assert.notEqual(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.data, null);
    assert.ok(result.codes.includes('provider-update-version-not-observed'));
    assert.equal(result.codes.includes('provider-update-version-verified'), false);
    assert.ok(result.asked.includes('npm install --global harnesstrim@0.3.0'));
    assert.ok(
      result.asked.includes('npm install --global harnesstrim@0.2.1'),
      `expected rollback to restore the previously active package: ${JSON.stringify(result.asked)}`,
    );
  });

  it('captures the installed version so a later rollback can restore it', async () => {
    const result = await invoke(['update', '--provider', 'rtk', '--yes'], world(), {
      installed: { rtk: 'rtk 0.42.0' },
      channelStdout: { [CHANNEL]: channelAnswer('0.44.0') },
      inventoryStdout: { [INVENTORY_LINE]: inventoryAnswer('0.42.0') },
    });

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
      inventoryStdout: { [INVENTORY_LINE]: 'Versione: 0.44.0\r\n' },
    });

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

  it('checks and updates Token Harness itself from its verified global npm installation', async () => {
    const place = world();
    const npmRoot = join(place.home, 'npm', 'lib', 'node_modules');
    const packageRoot = join(npmRoot, 'token-harness');
    const entryScript = join(packageRoot, 'token-harness.mjs');
    mkdirSync(packageRoot, { recursive: true });
    writeFileSync(
      join(packageRoot, 'package.json'),
      JSON.stringify({ name: 'token-harness', version: '0.1.17' }),
    );
    writeFileSync(entryScript, '');
    const config: FakeChannel = {
      application: {
        npmRoot,
        packageRoot,
        installedVersion: '0.1.17',
        availableVersion: '0.1.18',
      },
    };

    const preview = await invoke(['update'], place, config, entryScript, true);
    assert.equal(preview.exitCode, EXIT_CODES.ok);
    assert.equal(
      preview.data?.application?.verdict,
      'upgradable',
      JSON.stringify(
        { data: preview.data, diagnostics: preview.codes, asked: preview.asked },
        null,
        2,
      ),
    );
    assert.equal(preview.data?.application?.installed, '0.1.17');
    assert.equal(preview.data?.application?.available, '0.1.18');
    assert.equal(preview.data?.execution?.outcome, 'confirmation-required');
    assert.equal(
      preview.asked.some((line) => line.startsWith('npm install ')),
      false,
    );

    const applied = await invoke(['update', '--yes'], place, config, entryScript);
    assert.equal(applied.exitCode, EXIT_CODES.ok);
    assert.equal(applied.data?.execution?.outcome, 'committed');
    assert.equal(applied.data?.application?.installed, '0.1.18');
    assert.equal(applied.data?.application?.verdict, 'current');
    assert.equal(applied.data?.application?.updated, true);
    assert.ok(applied.codes.includes('application-update-version-verified'));
    assert.ok(applied.asked.includes('npm install --global token-harness@0.1.18'));
    assert.equal(
      JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')).version,
      '0.1.18',
    );
  });

  it('does not update a source or temporary copy just because a global npm package exists', async () => {
    const place = world();
    const npmRoot = join(place.home, 'npm', 'lib', 'node_modules');
    const globalPackageRoot = join(npmRoot, 'token-harness');
    const localPackageRoot = join(place.project, 'node_modules', 'token-harness');
    const localEntryScript = join(localPackageRoot, 'token-harness.mjs');
    mkdirSync(globalPackageRoot, { recursive: true });
    mkdirSync(localPackageRoot, { recursive: true });
    writeFileSync(
      join(globalPackageRoot, 'package.json'),
      JSON.stringify({ name: 'token-harness', version: '0.1.17' }),
    );
    writeFileSync(
      join(localPackageRoot, 'package.json'),
      JSON.stringify({ name: 'token-harness', version: '0.1.17' }),
    );
    writeFileSync(localEntryScript, '');
    const result = await invoke(
      ['update'],
      place,
      {
        application: {
          npmRoot,
          packageRoot: globalPackageRoot,
          installedVersion: '0.1.17',
          availableVersion: '0.1.18',
        },
      },
      localEntryScript,
      true,
    );

    assert.equal(result.exitCode, EXIT_CODES.ok);
    assert.equal(result.data?.application?.verdict, 'unsupported-installation');
    assert.equal(result.asked.includes('npm root --global'), true);
    assert.equal(result.asked.includes('npm view token-harness version'), false);
    assert.equal(
      result.asked.some((line) => line.startsWith('npm install ')),
      false,
    );
  });
});
