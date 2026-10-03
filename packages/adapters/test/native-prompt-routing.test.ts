import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId } from '@token-harness/core';
import type { JsonValue } from '@token-harness/core';

import {
  nativePromptRoutingHookEntries,
  nativePromptRoutingVersionSupported,
} from '../src/harnesses/native-prompt-routing.js';

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  assert.ok(
    value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value),
  );
  return value as Record<string, JsonValue>;
}

function hooksFor(value: JsonValue | undefined): Record<string, JsonValue>[] {
  const hooks = record(value)['hooks'];
  assert.ok(Array.isArray(hooks));
  return hooks.map((hook) => record(hook));
}

describe('native prompt-routing hook adapters', () => {
  it('admits documented patch schemas and rejects unknown or prerelease formats', () => {
    for (const version of ['0.159.0', '0.159.1', '0.160.0'])
      assert.equal(nativePromptRoutingVersionSupported(harnessId('codex'), version), true);
    for (const version of ['2.1.274', '2.1.285', '2.1.288'])
      assert.equal(nativePromptRoutingVersionSupported(harnessId('claude'), version), true);
    for (const version of [null, '0.158.0', '0.161.0', '0.160.0-beta.1'])
      assert.equal(nativePromptRoutingVersionSupported(harnessId('codex'), version), false);
    assert.equal(nativePromptRoutingVersionSupported(harnessId('claude'), '2.2.0'), false);
  });
  it('uses shell form for npm shims on Windows, and exec form on POSIX/WSL', () => {
    const windows = nativePromptRoutingHookEntries(harnessId('claude'), 'token-harness', 'windows');
    for (const entry of windows) {
      const handler = hooksFor(entry.value)[0]!;
      assert.equal('args' in handler, false, '.cmd cannot be launched by native exec form');
      assert.match(
        String(handler['command']),
        /^token-harness __internal-prompt-router claude (prompt-submit|subagent-start|subagent-stop)$/,
      );
    }
    for (const platform of ['linux', 'macos'] as const) {
      assert.ok(
        Array.isArray(
          hooksFor(
            nativePromptRoutingHookEntries(harnessId('claude'), 'token-harness', platform)[0]
              ?.value,
          )[0]?.['args'],
        ),
      );
    }
  });
  it('declares Codex prompt and subagent events with the Windows launch field', () => {
    const entries = nativePromptRoutingHookEntries(harnessId('codex'));
    assert.deepEqual(
      entries.map((entry) => entry.eventName),
      ['UserPromptSubmit', 'SubagentStart', 'SubagentStop'],
    );
    for (const entry of entries) {
      const hook = hooksFor(entry.value)[0];
      assert.ok(hook);
      assert.equal(hook['type'], 'command');
      assert.equal(hook['command'], hook['commandWindows']);
      assert.match(String(hook['command']), /__internal-prompt-router codex/);
    }
    assert.equal(hooksFor(entries[0]?.value)[0]?.['additionalContextLimit'], 500);
  });

  it('declares Claude command arguments in the native settings format', () => {
    const entries = nativePromptRoutingHookEntries(harnessId('claude'));
    assert.deepEqual(
      entries.map((entry) => entry.eventName),
      ['UserPromptSubmit', 'SubagentStart', 'SubagentStop'],
    );
    const hook = hooksFor(entries[0]?.value)[0];
    assert.ok(hook);
    assert.deepEqual(hook['args'], ['__internal-prompt-router', 'claude', 'prompt-submit']);
    assert.equal(hook['command'], 'token-harness');
    assert.equal('commandWindows' in hook, false);
  });
});
