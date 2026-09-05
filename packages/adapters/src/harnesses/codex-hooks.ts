/** Native hook enablement/trust is metadata, not evidence of output reduction. */
import type { JsonValue, VerificationCheck } from '@token-harness/core';
import type { HarnessContext, ResolvedHarnessConfig } from './contract.js';
const ID = 'token-harness-hooks-list';
function record(value: JsonValue | undefined): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function tuple(event: string, matcher: string | null, command: string): string {
  return JSON.stringify([event, matcher, command]);
}

export async function readCodexHookEnablement(
  context: HarnessContext,
  config: ResolvedHarnessConfig,
): Promise<VerificationCheck | null> {
  // Match exact on-disk event/matcher/command tuples. An unrelated trusted hook proves nothing.
  const expected: string[] = [];
  try {
    const stat = await context.fs.stat(config.path);
    if (stat === null || stat.kind !== 'file' || stat.byteLength > 1024 * 1024) return null;
    const text = new TextDecoder().decode(await context.fs.readFile(config.path));
    const parsed = JSON.parse(text.replace(/^\uFEFF/, '')) as JsonValue;
    if (!record(parsed) || !record(parsed['hooks'])) return null;
    for (const [event, native] of [
      ['PreToolUse', 'preToolUse'],
      ['PostToolUse', 'postToolUse'],
    ] as const) {
      const entries = parsed['hooks'][event];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!record(entry) || !Array.isArray(entry['hooks'])) continue;
        const matcher = typeof entry['matcher'] === 'string' ? entry['matcher'] : null;
        for (const handler of entry['hooks']) {
          if (
            record(handler) &&
            handler['type'] === 'command' &&
            typeof handler['command'] === 'string'
          ) {
            expected.push(tuple(native, matcher, handler['command']));
          }
        }
      }
    }
  } catch {
    return null;
  }
  if (expected.length === 0) return null;
  const stdin =
    [
      {
        method: 'initialize',
        id: 1,
        params: {
          clientInfo: { name: 'token_harness', version: '0.1' },
          capabilities: { experimentalApi: true },
        },
      },
      { method: 'initialized', params: {} },
      { method: 'hooks/list', id: ID, params: { cwds: [context.projectRoot] } },
    ]
      .map((item) => JSON.stringify(item))
      .join('\n') + '\n';
  const result = await context.runner.run({
    executable: 'codex',
    args: ['app-server'],
    cwd: context.projectRoot,
    stdin,
    stdinCloseAfterStdoutLineIncludes: ID,
    timeoutMs: 10_000,
    maxOutputBytes: 1024 * 1024,
  });
  if (result.failure !== null || result.exitCode !== 0 || result.stdoutTruncated) return null;
  const equalPath = (left: string, right: string): boolean =>
    context.fs.isInside(left, right) && context.fs.isInside(right, left);
  const samePath = async (left: string, right: string): Promise<boolean> => {
    if (equalPath(left, right)) return true;
    if (context.fs.canonicalPath === undefined) return false;
    try {
      const [a, b] = await Promise.all([
        context.fs.canonicalPath(left),
        context.fs.canonicalPath(right),
      ]);
      return a !== null && b !== null && equalPath(a, b);
    } catch {
      return false;
    }
  };
  for (const line of result.stdout.split(/\r?\n/)) {
    let value: JsonValue;
    try {
      value = JSON.parse(line) as JsonValue;
    } catch {
      continue;
    }
    if (!record(value) || value['id'] !== ID || !record(value['result'])) continue;
    const data = value['result']['data'];
    if (!Array.isArray(data)) return null;
    const entries: JsonValue[] = [];
    for (const item of data) {
      if (
        record(item) &&
        typeof item['cwd'] === 'string' &&
        (await samePath(item['cwd'], context.projectRoot))
      )
        entries.push(item);
    }
    if (entries.length !== 1) return null;
    const entry = entries[0];
    if (
      !record(entry) ||
      !Array.isArray(entry['hooks']) ||
      !Array.isArray(entry['errors']) ||
      entry['errors'].length !== 0
    )
      return null;
    const matched = new Set<string>();
    let disabled = 0;
    let untrusted = 0;
    for (const hook of entry['hooks']) {
      if (
        !record(hook) ||
        hook['handlerType'] !== 'command' ||
        typeof hook['sourcePath'] !== 'string' ||
        !(await samePath(hook['sourcePath'], config.path)) ||
        typeof hook['eventName'] !== 'string' ||
        typeof hook['command'] !== 'string'
      )
        continue;
      const key = tuple(
        hook['eventName'],
        typeof hook['matcher'] === 'string' ? hook['matcher'] : null,
        hook['command'],
      );
      if (!expected.includes(key)) continue;
      if (
        typeof hook['enabled'] !== 'boolean' ||
        typeof hook['trustStatus'] !== 'string' ||
        !['trusted', 'managed', 'untrusted', 'modified'].includes(hook['trustStatus']) ||
        typeof hook['currentHash'] !== 'string' ||
        !/^sha256:[0-9a-f]{64}$/i.test(hook['currentHash'])
      )
        return null;
      matched.add(key);
      if (!hook['enabled']) disabled++;
      if (!['trusted', 'managed'].includes(hook['trustStatus'])) untrusted++;
    }
    if (matched.size !== new Set(expected).size) return null;
    const enabled = disabled === 0 && untrusted === 0;
    return {
      id: 'hook-enablement',
      status: enabled ? 'pass' : 'fail',
      achievedTier: null,
      summary: enabled
        ? 'Native hooks/list confirms the configured hooks are enabled and trusted; execution is not proved'
        : 'Native hooks/list reports ' +
          disabled +
          ' disabled and ' +
          untrusted +
          ' untrusted/modified hooks',
      evidence: [
        {
          kind: 'config-entry',
          source: 'codex app-server hooks/list',
          path: null,
          detail:
            String(matched.size) +
            ' exact configured hook tuples matched; no commands or output retained',
        },
      ],
      remediation: enabled
        ? null
        : 'Review and explicitly enable/trust the hooks in Codex; Token Harness never grants trust',
    };
  }
  return null;
}
