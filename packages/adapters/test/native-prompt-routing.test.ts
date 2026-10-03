import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId } from '@token-harness/core';
import type { JsonValue } from '@token-harness/core';

import { nativePromptRoutingHookEntries } from '../src/harnesses/native-prompt-routing.js';

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
