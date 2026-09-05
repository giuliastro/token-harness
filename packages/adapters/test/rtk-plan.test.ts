/**
 * RTK's installation and configuration plan — PLAN §10 acceptance.
 *
 * PLAN asks for "fixtures for absent, installed, configured, old, unknown-new, and broken
 * states" and, separately, "the brownfield fixtures, including RTK already configured in the
 * surface Token Harness would claim". The second is the case the real machine is in, and the
 * one an installer gets wrong by overwriting.
 *
 * The hook shape here is copied from a configured installation: `hooks.PreToolUse` is a list of
 * `{ matcher, hooks: [{ type, command }] }`. On Windows the same native `rtk hook claude` command
 * is used for both Claude shell tool families, `Bash` and `PowerShell`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  MANIFEST_SCHEMA_VERSION,
  harnessId,
  providerId,
  type HarnessConfigSummary,
  type HarnessManifest,
  type MergeJsonAction,
  type PlatformFacts,
  type ProcessRequest,
  type RemoveOwnedChangeAction,
  type ResolvedCapability,
} from '@token-harness/core';

import { buildRtkPlan, hookEntryFor, hookListPointer } from '../src/index.js';
import type { ProviderContext, ProviderPlanRequest } from '../src/index.js';

const CLAUDE = harnessId('claude');
const RTK = providerId('rtk');

const CLAUDE_MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: CLAUDE,
  displayName: 'Claude Code',
  homepage: 'https://claude.com/claude-code',
  testedVersions: { minimum: '2.0.0', maximum: '2.1.212' },
  verificationTier: 'canary',
  versionCommand: { executable: 'claude', args: ['--version'] },
  interceptionPoints: [
    { scopeId: 'pre-tool-use', eventName: 'PreToolUse' },
    { scopeId: 'post-tool-use', eventName: 'PostToolUse' },
  ],
  configFiles: [
    { path: '.claude/settings.json', scope: 'user', parser: 'json', primary: true },
    { path: '.claude/settings.local.json', scope: 'project', parser: 'json', primary: false },
  ],
  toolFamilies: [
    { id: 'Bash', platforms: ['windows', 'macos', 'linux'], executesShellCommands: true },
    { id: 'PowerShell', platforms: ['windows'], executesShellCommands: true },
  ],
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'provider-telemetry',
};

/**
 * OpenCode, as the harness adapter declares it — a plugin array and two auto-loaded directories,
 * with no `hooks` document anywhere. Present here only so the guard has something to refuse.
 */
const OPENCODE = harnessId('opencode');

const OPENCODE_MANIFEST: HarnessManifest = {
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  id: OPENCODE,
  displayName: 'OpenCode',
  homepage: 'https://opencode.ai',
  testedVersions: { minimum: '1.18.9', maximum: '1.18.14' },
  verificationTier: 'config-only',
  versionCommand: { executable: 'opencode', args: ['--version'] },
  interceptionPoints: [
    { scopeId: 'tool-execute-before', eventName: 'tool.execute.before' },
    { scopeId: 'tool-execute-after', eventName: 'tool.execute.after' },
  ],
  configFiles: [
    { path: '.config/opencode/opencode.jsonc', scope: 'user', parser: 'jsonc', primary: true },
    { path: '.config/opencode/plugins', scope: 'user', parser: 'markers', primary: false },
  ],
  toolFamilies: [
    { id: 'tool.execute', platforms: ['windows', 'macos', 'linux'], executesShellCommands: true },
  ],
  requiresEnablement: false,
  enablementNote: null,
  receiptFamily: 'none',
};

const SETTINGS = 'C:\\Users\\dev\\.claude\\settings.json';

const CHANNELS = [
  {
    id: 'winget',
    packageId: 'rtk-ai.rtk',
    priority: 0,
    platforms: ['windows'],
    requiresNetwork: true,
    requiresElevation: false,
    digestAvailable: true,
  },
  {
    id: 'cargo',
    packageId: 'rtk',
    priority: 1,
    platforms: ['windows', 'macos', 'linux'],
    requiresNetwork: true,
    requiresElevation: false,
    digestAvailable: false,
  },
];

function facts(os: PlatformFacts['os']): PlatformFacts {
  return {
    os,
    osDisplayName: 'test',
    arch: 'x64',
    nodeVersion: '22.13.0',
    isWsl: false,
  };
}

function ownership(capabilities: readonly string[], toolFamily = 'Bash'): ResolvedCapability[] {
  return capabilities.map((capability) => ({
    scope: {
      harness: CLAUDE,
      toolFamily,
      interceptionPoint: 'pre-tool-use',
      capability: capability as ResolvedCapability['scope']['capability'],
    },
    owner: RTK,
    mode: 'exclusive',
    order: 0,
  }));
}

/** The live configuration as the harness adapter would report it. */
function configuredWithRtk(matchers: string[] = ['Bash']): HarnessConfigSummary {
  return {
    harnessId: CLAUDE,
    configPath: SETTINGS,
    scope: 'user',
    interceptionPoints: ['pre-tool-use'],
    matchers,
    commands: ['rtk hook claude'],
  };
}

function context(
  options: {
    os?: PlatformFacts['os'];
    configs?: HarnessConfigSummary[];
  } = {},
): ProviderContext {
  return {
    fs: {
      join: (...segments) => segments.join('\\'),
      dirname: (path) => path.slice(0, path.lastIndexOf('\\')),
      basename: (path) => path.slice(path.lastIndexOf('\\') + 1),
      isInside: () => false,
      stat: () => Promise.resolve(null),
      readFile: () => Promise.reject(new Error('planning must not read files')),
      writeFile: () => Promise.reject(new Error('planning must not write')),
      appendFile: () => Promise.reject(new Error('planning must not write')),
      createDirectory: () => Promise.reject(new Error('planning must not write')),
      remove: () => Promise.reject(new Error('planning must not write')),
      readDirectory: () => Promise.resolve([]),
    },
    runner: {
      run: (request: ProcessRequest) =>
        Promise.reject(new Error(`planning must not spawn: ${request.executable}`)),
    },
    facts: facts(options.os ?? 'windows'),
    paths: {
      home: 'C:\\Users\\dev',
      config: 'C:\\Users\\dev\\AppData\\Roaming\\TokenHarness',
      data: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
      state: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness',
      cache: 'C:\\Users\\dev\\AppData\\Local\\TokenHarness\\Cache',
    },
    projectRoot: 'C:\\work\\demo',
    harnessConfigs: options.configs ?? [],
    now: () => '2026-07-31T12:00:00.000Z',
    localDatabase: null,
    projectIdFor: () => 'p_test',
  };
}

function request(overrides: Partial<ProviderPlanRequest> = {}): ProviderPlanRequest {
  return {
    ownership: overrides.ownership ?? ownership(['shell.output.reduce']),
    harnesses: overrides.harnesses ?? [CLAUDE_MANIFEST],
    desiredState: overrides.desiredState ?? 'configured',
  };
}

const identifiesCommand = (command: string): boolean =>
  /(^|[\\/\s"'])rtk(\.exe)?([\s"']|$)/i.test(command);

function plan(options: {
  installed?: boolean;
  configs?: HarnessConfigSummary[];
  os?: PlatformFacts['os'];
  request?: ProviderPlanRequest;
}) {
  return buildRtkPlan({
    context: context({
      ...(options.os === undefined ? {} : { os: options.os }),
      ...(options.configs === undefined ? {} : { configs: options.configs }),
    }),
    request: options.request ?? request(),
    installed: options.installed ?? true,
    identifiesCommand,
    installationChannels: CHANNELS,
  });
}

describe('a machine with nothing on it', () => {
  it('installs, then configures both Windows shell families, in that order', () => {
    const result = plan({ installed: false });

    // Order is not cosmetic: a hook pointing at an absent executable is the `broken` state
    // `detect` reports, so every intercepted command would fail.
    assert.deepEqual(
      result.actions.map((action) => action.kind),
      ['package-manager-install', 'merge-json', 'merge-json'],
    );
    assert.deepEqual(
      result.actions.slice(1).map((action) => (action as MergeJsonAction).operations[0]?.value),
      [
        { matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
        { matcher: 'PowerShell', hooks: [{ type: 'command', command: 'rtk hook claude' }] },
      ],
    );
  });

  it('picks the channel the manifest prioritises for this platform', () => {
    const windows = plan({ installed: false, os: 'windows' });
    assert.equal((windows.actions[0] as { packageManager?: string }).packageManager, 'winget');
    // The channel's own id for the package. `rtk` would match nothing on winget: the installed
    // binary lives under `WinGet/Packages/rtk-ai.rtk_...`.
    assert.equal((windows.actions[0] as { packageName?: string }).packageName, 'rtk-ai.rtk');

    // `winget` does not list linux, so the next channel by priority wins rather than the plan
    // proposing a package manager that is not there.
    const linux = plan({ installed: false, os: 'linux' });
    assert.equal((linux.actions[0] as { packageManager?: string }).packageManager, 'cargo');
    assert.equal((linux.actions[0] as { packageName?: string }).packageName, 'rtk');
  });

  it('says when a channel publishes no digest instead of implying verification', () => {
    const linux = plan({ installed: false, os: 'linux' });
    const install = linux.actions[0];
    assert.ok(install);
    // RFC 0004 §Network policy. `cargo` sets `digestAvailable: false`, and a precondition that
    // claimed a digest would be verified is worse than one that admits there is none.
    assert.match(install.preconditions.join(' '), /publishes no digest/);
  });

  it('does not pin a version it has not tested', () => {
    const result = plan({ installed: false });
    assert.equal((result.actions[0] as { version?: string | null }).version, null);
  });

  it('classifies installation as delegated rather than reversible', () => {
    const result = plan({ installed: false });
    // An installed package is removed by uninstalling it, not by restoring a file, and the risk
    // classes exist so a reviewer sees that difference before approving.
    assert.equal(result.actions[0]?.riskClass, 'delegated');
    // `package-inventory`, the value RFC 0009 §Initial delivery order item 1 defines: both RTK
    // channels (winget, cargo) can be asked what they have installed, so the executor captures
    // that before the install and a rollback restores the captured version through the channel.
    // The channels that cannot answer would still be `none`, and the executor says the package
    // stayed.
    assert.equal(result.actions[0]?.rollbackData, 'package-inventory');
  });
});

describe('installed but not wired', () => {
  it('plans one hook per Windows shell family', () => {
    const result = plan({ installed: true });
    assert.deepEqual(
      result.actions.map((action) => action.kind),
      ['merge-json', 'merge-json'],
    );
  });

  it('appends one list element rather than setting the list', () => {
    const result = plan({ installed: true });
    const action = result.actions[0] as MergeJsonAction;

    // RFC 0004 scopes ownership to exact entries. `set` on `hooks.PreToolUse` would claim every
    // entry in it, and a later removal would delete a third party's hook.
    assert.equal(action.operations.length, 1);
    assert.equal(action.operations[0]?.kind, 'append');
    assert.equal(action.operations[0]?.pointer, 'hooks.PreToolUse');
    assert.equal(action.ownedPointers.length, 1);
  });

  it('writes the Bash entry shape the harness already uses', () => {
    const result = plan({ installed: true });
    const action = result.actions[0] as MergeJsonAction;
    assert.deepEqual(action.operations[0]?.value, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('writes a PowerShell entry using the same native RTK Claude hook', () => {
    const result = plan({ installed: true });
    const action = result.actions[1] as MergeJsonAction;
    assert.deepEqual(action.operations[0]?.value, {
      matcher: 'PowerShell',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('requires that nothing of ours is there yet', () => {
    const result = plan({ installed: true });
    const action = result.actions[0] as MergeJsonAction;
    // A digest here would mean "our entry must already be exactly this", which is the
    // precondition for replacing it, not for adding it.
    assert.equal(action.operations[0]?.expectedValueDigest, null);
  });

  it('needs neither network nor elevation', () => {
    const result = plan({ installed: true });
    assert.equal(result.actions[0]?.requiresNetwork, false);
    assert.equal(result.actions[0]?.requiresElevation, false);
    assert.equal(result.actions[0]?.rollbackData, 'file-snapshot');
  });

  it('targets the absolute path of the primary config file', () => {
    const result = plan({ installed: true });
    // `user` scope resolves against the home directory, not the project root. Getting this
    // backwards would write a machine-wide hook into a repository.
    assert.deepEqual(result.actions[0]?.affectedPaths, [SETTINGS]);
    assert.deepEqual(result.actions[1]?.affectedPaths, [SETTINGS]);
  });

  it('deduplicates capabilities but still covers both Windows shell families', () => {
    const result = plan({
      installed: true,
      request: request({
        ownership: ownership(['shell.command.rewrite', 'shell.output.reduce']),
      }),
    });

    // Each family gets one hook even though the same hook provides two capabilities.
    assert.equal(result.actions.length, 2);
  });

  it('does not synthesize PowerShell outside Windows', () => {
    const result = plan({ installed: true, os: 'linux' });
    assert.equal(result.actions.length, 1);
    assert.deepEqual((result.actions[0] as MergeJsonAction).operations[0]?.value, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('gives the same plan the same action id', () => {
    // RFC 0002 §Planning: "the same plan input always yields the same ID", which is what lets
    // RFC 0006 compare a stored plan against a recomputed one.
    assert.equal(
      plan({ installed: true }).actions[0]?.id,
      plan({ installed: true }).actions[0]?.id,
    );
  });

  it('gives a different surface a different action id', () => {
    const bash = plan({ installed: true });
    const powershell = plan({
      installed: true,
      request: request({ ownership: ownership(['shell.output.reduce'], 'PowerShell') }),
    });
    assert.notEqual(bash.actions[0]?.id, powershell.actions[0]?.id);
  });
});

describe('brownfield: RTK already configured in the surface we would claim', () => {
  it('plans only the missing PowerShell coverage on Windows', () => {
    const result = plan({ installed: true, configs: [configuredWithRtk()] });

    assert.equal(result.actions.length, 1);
    assert.deepEqual((result.actions[0] as MergeJsonAction).operations[0]?.value, {
      matcher: 'PowerShell',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('does not duplicate a user-owned combined Bash|PowerShell matcher', () => {
    const result = plan({
      installed: true,
      configs: [configuredWithRtk(['Bash|PowerShell'])],
    });
    assert.deepEqual(result.actions, []);
  });

  it('still plans only the missing family when a third party shares the surface', () => {
    const shared: HarnessConfigSummary = {
      ...configuredWithRtk(),
      commands: ['rtk hook claude', 'somebody-elses-tool'],
    };
    const result = plan({ installed: true, configs: [shared] });
    assert.equal(result.actions.length, 1);
    assert.deepEqual((result.actions[0] as MergeJsonAction).operations[0]?.value, {
      matcher: 'PowerShell',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('plans the Bash hook when the existing entry is on PowerShell only', () => {
    const elsewhere: HarnessConfigSummary = { ...configuredWithRtk(), matchers: ['PowerShell'] };
    const result = plan({ installed: true, configs: [elsewhere] });
    // PowerShell is covered; Bash is not.
    assert.equal(result.actions.length, 1);
    assert.deepEqual((result.actions[0] as MergeJsonAction).operations[0]?.value, {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });

  it('plans both hooks when the entry is on a different interception point', () => {
    const elsewhere: HarnessConfigSummary = {
      ...configuredWithRtk(),
      interceptionPoints: ['post-tool-use'],
    };
    assert.equal(plan({ installed: true, configs: [elsewhere] }).actions.length, 2);
  });

  it('plans both hooks when the entry is in a different file', () => {
    const elsewhere: HarnessConfigSummary = {
      ...configuredWithRtk(),
      configPath: 'C:\\work\\demo\\.claude\\settings.local.json',
    };
    assert.equal(plan({ installed: true, configs: [elsewhere] }).actions.length, 2);
  });

  it('installs and closes the missing family when RTK is configured yet not runnable', () => {
    // The `broken` state `detect` reports: a hook invoking rtk with no rtk to invoke.
    const result = plan({ installed: false, configs: [configuredWithRtk()] });
    assert.deepEqual(
      result.actions.map((action) => action.kind),
      ['package-manager-install', 'merge-json'],
    );
    assert.deepEqual((result.actions[1] as MergeJsonAction).operations[0]?.value, {
      matcher: 'PowerShell',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });
});

describe('the uninstall plan', () => {
  it('removes only what is actually registered', () => {
    const result = plan({
      installed: true,
      configs: [configuredWithRtk()],
      request: request({ desiredState: 'absent' }),
    });

    assert.deepEqual(
      result.actions.map((action) => action.kind),
      ['remove-owned-change'],
    );
    assert.equal(result.desiredState, 'absent');
  });

  it('plans nothing when there is nothing of ours to remove', () => {
    const result = plan({ installed: true, request: request({ desiredState: 'absent' }) });
    // Planning a removal whose precondition cannot hold produces a plan that fails when run,
    // which is worse than an empty one.
    assert.deepEqual(result.actions, []);
  });

  it('does not claim a combined user matcher during removal', () => {
    const result = plan({
      installed: true,
      configs: [configuredWithRtk(['Bash|PowerShell'])],
      request: request({ desiredState: 'absent' }),
    });
    assert.deepEqual(result.actions, []);
  });

  it('states what it believes it owns, so a user edit can block the deletion', () => {
    const result = plan({
      installed: true,
      configs: [configuredWithRtk()],
      request: request({ desiredState: 'absent' }),
    });
    const action = result.actions[0] as RemoveOwnedChangeAction;

    assert.equal(action.target.kind, 'owned-json-entry');
    assert.equal(action.target.path, SETTINGS);
    // RFC 0004 §Ownership: removal is permitted only while the claim still holds, and the claim
    // has to be reviewable before apply.
    assert.equal(action.target.pointer, hookListPointer('PreToolUse'));
    assert.equal(action.target.placement, 'array-element');
    assert.match(action.target.valueDigest, /^sha256:/);
  });

  it('names the action it reverses', () => {
    const configured = plan({ installed: true });
    const removal = plan({
      installed: true,
      configs: [configuredWithRtk()],
      request: request({ desiredState: 'absent' }),
    });
    // The install and the removal address the same Bash entry, so the removal can name the action
    // whose effect it undoes.
    assert.equal(
      (removal.actions[0] as RemoveOwnedChangeAction).reverses,
      configured.actions[0]?.id,
    );
  });

  it('leaves RTK itself installed', () => {
    const result = plan({
      installed: true,
      configs: [configuredWithRtk()],
      request: request({ desiredState: 'absent' }),
    });
    // RFC 0004: Token Harness removes what it owns. On a machine where RTK was already present
    // it never owned the installation, and removing a tool the user installed themselves is the
    // destructive reading of "uninstall".
    assert.equal(
      result.actions.some((action) => action.kind === 'package-manager-install'),
      false,
    );
  });
});

describe('scopes with nowhere to go', () => {
  it('plans nothing for a harness that is not present', () => {
    const result = plan({ installed: true, request: request({ harnesses: [] }) });
    assert.deepEqual(result.actions, []);
  });

  it('plans nothing for an interception point the harness does not expose', () => {
    const result = plan({
      installed: true,
      request: request({
        ownership: [
          {
            scope: {
              harness: CLAUDE,
              toolFamily: 'Bash',
              interceptionPoint: 'session-start',
              capability: 'shell.output.reduce',
            },
            owner: RTK,
            mode: 'exclusive',
            order: 0,
          },
        ],
      }),
    });
    // Inventing an event name for a point the manifest does not carry would write a hook the
    // harness never fires.
    assert.deepEqual(result.actions, []);
  });

  it('plans nothing when no scope was assigned', () => {
    const result = plan({ installed: true, request: request({ ownership: [] }) });
    assert.deepEqual(result.actions, []);
  });

  it('plans nothing for a harness whose configuration is not a hook list', () => {
    /**
     * RTK claims OpenCode as of spike 9.1, so the resolver can hand this an OpenCode scope. What
     * this file builds is a `{matcher, hooks:[…]}` object appended at `hooks.<eventName>`, which
     * is Claude Code's schema and nothing else's — OpenCode has no `hooks` document, and RTK
     * reaches it by dropping a plugin module into `.config/opencode/plugins/`.
     */
    const result = plan({
      installed: true,
      request: request({
        harnesses: [OPENCODE_MANIFEST],
        ownership: [
          {
            scope: {
              harness: OPENCODE,
              toolFamily: 'tool.execute',
              interceptionPoint: 'tool-execute-before',
              capability: 'shell.command.rewrite',
            },
            owner: RTK,
            mode: 'exclusive',
            order: 0,
          },
        ],
      }),
    });
    assert.deepEqual(result.actions, []);
  });
});

describe('the pointer and the entry', () => {
  it('escapes a dot in an event name', () => {
    // The dotted pointer syntax uses `\.` for a literal dot, and an unescaped one would address
    // a nested object that does not exist.
    assert.equal(hookListPointer('Pre.Tool'), 'hooks.Pre\\.Tool');
  });

  it('names the harness in the command, as the observed hook does', () => {
    assert.deepEqual(hookEntryFor('claude', 'Bash'), {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'rtk hook claude' }],
    });
  });
});