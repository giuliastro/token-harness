import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  jsonValueDigest,
  type FileStat,
  type FileSystemPort,
  type PlatformFacts,
  type PlatformPaths,
  type ProcessOutcome,
  type ProcessRequest,
} from '@token-harness/core';
import { nativePromptRoutingHookEntries } from '@token-harness/adapters';

import {
  observeNativePromptRouting,
  planNativePromptRoutingInstall,
  planNativePromptRoutingRemoval,
  recordNativePromptRoutingHook,
} from '../src/prompt-router.js';

const PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};
const PATHS: PlatformPaths = {
  home: '/home/dev',
  config: '/home/dev/.config',
  data: '/home/dev/.local/share',
  state: '/home/dev/.local/share/token-harness',
  cache: '/home/dev/.cache',
};
const ROUTER_MARKER = 'token-harness-prompt-router-v1';

function processOutcome(request: ProcessRequest, stdout = ROUTER_MARKER): ProcessOutcome {
  return {
    displayCommand: `${request.executable} ${request.args.join(' ')}`,
    interpreter: 'direct',
    executablePath: '/usr/local/bin/token-harness',
    exitCode: 0,
    signal: null,
    stdout,
    stderr: '',
    stdoutTruncated: false,
    stderrTruncated: false,
    durationMs: 1,
    timedOut: false,
    failure: null,
  };
}

function memoryFs(initial: Record<string, string | null> = {}) {
  const files = new Map<string, Uint8Array>();
  const directories = new Set<string>();
  for (const [path, content] of Object.entries(initial)) {
    if (content === null) directories.add(path);
    else files.set(path, new TextEncoder().encode(content));
  }
  const fs: FileSystemPort = {
    join: (...parts) => ('/' + parts.join('/')).replace(/\/{2,}/g, '/'),
    dirname: (path) => path.slice(0, Math.max(1, path.lastIndexOf('/'))) || '/',
    basename: (path) => path.split('/').filter(Boolean).at(-1) ?? path,
    isInside: (candidate, parent) =>
      candidate === parent || candidate.startsWith(parent.replace(/\/$/, '') + '/'),
    stat: async (path): Promise<FileStat | null> => {
      if (directories.has(path)) return { kind: 'directory', byteLength: 0, mode: null };
      const bytes = files.get(path);
      return bytes === undefined
        ? null
        : { kind: 'file', byteLength: bytes.byteLength, mode: null };
    },
    readFile: async (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error('missing file');
      return bytes;
    },
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    appendFile: async (path, content) => {
      const previous = files.get(path) ?? new Uint8Array();
      const bytes = new Uint8Array(previous.byteLength + content.byteLength);
      bytes.set(previous);
      bytes.set(content, previous.byteLength);
      files.set(path, bytes);
    },
    createDirectory: async (path) => {
      directories.add(path);
    },
    remove: async (path) => {
      files.delete(path);
      directories.delete(path);
    },
    readDirectory: async (path) => {
      const prefix = path.replace(/\/$/, '') + '/';
      const names = [...files.keys(), ...directories]
        .filter((key) => key.startsWith(prefix))
        .map((key) => key.slice(prefix.length).split('/')[0]);
      return [...new Set(names.filter((name): name is string => Boolean(name)))].sort();
    },
  };
  return { fs, files };
}

function runner(output = ROUTER_MARKER) {
  return {
    run: async (request: ProcessRequest) => processOutcome(request, output),
  };
}

function installInput(fs: FileSystemPort, harness: 'claude' | 'codex' = 'claude') {
  return {
    fs,
    home: '/home/dev',
    harness: harnessId(harness),
    version: harness === 'claude' ? '2.1.288' : '0.160.0',
    runner: runner(),
    facts: PLATFORM,
    paths: PATHS,
    projectRoot: '/work/project',
  };
}

function ownedJournal(path: string, harness: 'claude' | 'codex') {
  const entries = nativePromptRoutingHookEntries(harnessId(harness));
  const ownership = entries.map(({ eventName, value }) => ({
    kind: 'owned-json-entry',
    path,
    pointer: `hooks.${eventName}`,
    placement: 'array-element',
    valueDigest: jsonValueDigest(value),
  }));
  return JSON.stringify({
    schemaVersion: 1,
    transactionId: 'enable1',
    planId: 'plan1',
    projectId: 'p_test',
    projectRoot: '/work/project',
    startedAt: '2026-10-03T10:00:00.000Z',
    finishedAt: '2026-10-03T10:00:01.000Z',
    outcome: 'committed',
    entries: [],
    ownership,
    pinned: false,
    diagnostics: [],
  });
}

describe('automatic native prompt routing', () => {
  it('repairs only journal-owned legacy Windows exec hooks and can remove the legacy entries', async () => {
    const path = '/home/dev/.claude/settings.json';
    const entries = nativePromptRoutingHookEntries(harnessId('claude'));
    const document = JSON.stringify({
      hooks: Object.fromEntries(entries.map((entry) => [entry.eventName, [entry.value]])),
    });
    for (const owned of [true, false]) {
      const { fs, files } = memoryFs({
        [path]: document,
        ...(owned
          ? {
              '/state/journals': null,
              '/state/journals/enable1.json': ownedJournal(path, 'claude'),
            }
          : {}),
      });
      const input = {
        ...installInput(fs),
        facts: { ...PLATFORM, os: 'windows' as const },
        stateRoot: '/state',
      };
      const observed = await observeNativePromptRouting({ ...input, projectId: null });
      assert.equal(observed.needsRepair === true, owned);
      const repair = await planNativePromptRoutingInstall(input);
      assert.equal(repair.actions.length, owned ? 4 : 0);
      if (owned) {
        assert.ok(
          repair.actions.slice(0, 3).every((action) => action.kind === 'remove-owned-change'),
        );
        assert.equal(repair.actions[3]?.kind, 'merge-json');
        const removal = await planNativePromptRoutingRemoval(input);
        assert.equal(removal.actions.length, 3);
      }
      assert.equal(new TextDecoder().decode(files.get(path)), document);
    }
  });
  it('previews supported Windows patch versions while preserving existing user hooks', async () => {
    for (const [harness, version] of [
      ['codex', '0.159.1'],
      ['claude', '2.1.285'],
    ] as const) {
      const path =
        harness === 'codex' ? '/home/dev/.codex/hooks.json' : '/home/dev/.claude/settings.json';
      const original =
        '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"user-hook"}]}]}}';
      const { fs, files } = memoryFs({ [path]: original });
      const plan = await planNativePromptRoutingInstall({
        ...installInput(fs, harness),
        version,
        facts: { ...PLATFORM, os: 'windows' },
      });
      assert.equal(plan.actions.length, 1);
      assert.equal(new TextDecoder().decode(files.get(path)), original);
      assert.equal(plan.actions[0]?.kind, 'merge-json');
    }
  });
  it('distinguishes current Codex trust from historical execution and ignores unrelated trusted hooks', async () => {
    for (const mode of ['trusted', 'untrusted', 'disabled', 'unrelated'] as const) {
      const path = '/home/dev/.codex/hooks.json';
      const entries = nativePromptRoutingHookEntries(harnessId('codex'));
      const { fs } = memoryFs({
        [path]: JSON.stringify({
          hooks: Object.fromEntries(entries.map((e) => [e.eventName, [e.value]])),
        }),
      });
      const eventNames = ['userPromptSubmit', 'subagentStart', 'subagentStop'];
      const hooks = entries.map((entry, i) => {
        const group = entry.value as { hooks: Array<{ command: string }> };
        return {
          eventName: eventNames[i],
          handlerType: 'command',
          sourcePath: path,
          command: mode === 'unrelated' ? 'another-hook' : group.hooks[0]!.command,
          enabled: mode !== 'disabled',
          trustStatus: mode === 'untrusted' ? 'untrusted' : 'trusted',
          currentHash: 'sha256:' + 'a'.repeat(64),
        };
      });
      await recordNativePromptRoutingHook({
        fs,
        stateRoot: '/state',
        harness: 'codex',
        event: 'prompt-submit',
        projectId: 'p_other',
        now: new Date().toISOString(),
        hookInput: '{}',
      });
      const observed = await observeNativePromptRouting({
        ...installInput(fs, 'codex'),
        stateRoot: '/state',
        projectId: null,
        runner: {
          run: async (request) =>
            processOutcome(
              request,
              JSON.stringify({
                id: 'token-harness-hooks-list',
                result: { data: [{ cwd: '/work/project', errors: [], hooks }] },
              }),
            ),
        },
      });
      assert.equal(
        observed.enablement,
        mode === 'trusted' ? 'enabled' : mode === 'unrelated' ? 'unknown' : mode,
      );
      assert.equal(observed.promptSubmissions, 1, 'overview can see receipts from another project');
      assert.equal(
        observed.verificationTier,
        mode === 'disabled' || mode === 'untrusted' ? 'config-only' : 'runtime-observed',
      );
      if (mode === 'untrusted' || mode === 'disabled') assert.match(observed.detail, /once/);
      else assert.match(observed.detail, /automatically/);
    }
  });
  it('plans a Codex/Claude user hook without changing existing settings during preview', async () => {
    const existing = JSON.stringify({
      theme: 'dark',
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'user-hook' }] }],
      },
    });
    const { fs, files } = memoryFs({ '/home/dev/.claude/settings.json': existing });
    const plan = await planNativePromptRoutingInstall(installInput(fs));

    assert.equal(plan.actions.length, 1);
    assert.equal(plan.actions[0]?.kind, 'merge-json');
    if (plan.actions[0]?.kind !== 'merge-json') return;
    assert.deepEqual(
      plan.actions[0].operations.map((operation) => operation.pointer),
      ['hooks.UserPromptSubmit', 'hooks.SubagentStart', 'hooks.SubagentStop'],
    );
    assert.match(plan.actions[0].explanation, /start a new Claude Code session/);
    assert.equal(new TextDecoder().decode(files.get('/home/dev/.claude/settings.json')), existing);
  });

  it('fails closed when the hook runner is missing or too old', async () => {
    const { fs } = memoryFs();
    const plan = await planNativePromptRoutingInstall({
      ...installInput(fs),
      runner: runner('token-harness 0.1.23'),
    });
    assert.equal(plan.actions.length, 0);
    assert.ok(
      plan.diagnostics.some((entry) => entry.code === 'prompt-routing-runtime-unavailable'),
    );
  });

  it('builds only ownership-backed removal actions', async () => {
    const path = '/home/dev/.claude/settings.json';
    const { fs } = memoryFs({
      '/state/journals': null,
      '/state/journals/enable1.json': ownedJournal(path, 'claude'),
    });
    const plan = await planNativePromptRoutingRemoval({
      ...installInput(fs),
      stateRoot: '/state',
    });
    assert.equal(plan.actions.length, 3);
    assert.ok(plan.actions.every((action) => action.kind === 'remove-owned-change'));
  });

  it('records hook activity without retaining prompt text or a session model as the child model', async () => {
    const { fs, files } = memoryFs();
    const now = new Date().toISOString();
    await recordNativePromptRoutingHook({
      fs,
      stateRoot: '/state',
      harness: 'claude',
      event: 'prompt-submit',
      projectId: 'p_test',
      now,
      hookInput: JSON.stringify({ prompt: 'private prompt body', model: 'root-model' }),
    });
    await recordNativePromptRoutingHook({
      fs,
      stateRoot: '/state',
      harness: 'claude',
      event: 'subagent-start',
      projectId: 'p_test',
      now,
      hookInput: JSON.stringify({
        prompt: 'private child instructions',
        model: 'root-model',
        agent_type: 'Explore',
        agent_id: 'private-agent-id',
      }),
    });
    const eventFile = [...files.keys()].find((path) => path.endsWith('.jsonl'));
    assert.ok(eventFile);
    const content = new TextDecoder().decode(files.get(eventFile));
    assert.doesNotMatch(
      content,
      /private prompt body|private child instructions|private-agent-id|root-model/,
    );
    const rows = content
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    assert.equal(rows[0]?.['type'], 'prompt-submit');
    assert.equal(rows[1]?.['agentType'], 'Explore');
    assert.equal(rows[1]?.['model'], null);
  });

  it('shows configuration separately from callbacks and exposes owned disable state', async () => {
    const path = '/home/dev/.claude/settings.json';
    const hookEntries = nativePromptRoutingHookEntries(harnessId('claude'));
    const document = JSON.stringify({
      theme: 'dark',
      hooks: Object.fromEntries(hookEntries.map(({ eventName, value }) => [eventName, [value]])),
    });
    const { fs } = memoryFs({
      [path]: document,
      '/state/journals': null,
      '/state/journals/enable1.json': ownedJournal(path, 'claude'),
    });
    const observed = await observeNativePromptRouting({
      ...installInput(fs),
      stateRoot: '/state',
      projectId: 'p_test',
    });
    assert.equal(observed.state, 'managed');
    assert.equal(observed.configured, true);
    assert.equal(observed.label, 'Ready · awaiting prompt');
    const observedAt = new Date().toISOString();
    await recordNativePromptRoutingHook({
      fs,
      stateRoot: '/state',
      harness: 'claude',
      event: 'prompt-submit',
      projectId: 'p_test',
      now: observedAt,
      hookInput: '{}',
    });
    await recordNativePromptRoutingHook({
      fs,
      stateRoot: '/state',
      harness: 'claude',
      event: 'subagent-start',
      projectId: 'p_test',
      now: observedAt,
      hookInput: JSON.stringify({ agent_type: 'Explore' }),
    });
    const runtime = await observeNativePromptRouting({
      ...installInput(fs),
      stateRoot: '/state',
      projectId: 'p_test',
    });
    assert.equal(runtime.label, 'Runtime observed');
    assert.equal(runtime.promptSubmissions, 1);
    assert.equal(runtime.subagentsStarted, 1);
    assert.deepEqual(runtime.reportedModels, []);
    const removal = await planNativePromptRoutingRemoval({
      ...installInput(fs),
      stateRoot: '/state',
    });
    assert.equal(removal.actions.length, 3);
  });
});
