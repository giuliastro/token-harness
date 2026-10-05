import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { ChildProcess, spawn } from 'node:child_process';
import { describe, it } from 'node:test';
import type { PlatformFacts } from '@token-harness/core';
import { guidedApplicationUrl, startManagedGuidedApplication } from '../src/index.js';

const facts: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: '24.13.0',
  isWsl: false,
};
const input = {
  executable: 'C:\\App\\runtime\\node.exe',
  entryScript: 'C:\\App\\backend\\token-harness.mjs',
  cwd: 'C:\\Project & one',
  facts,
  env: {
    Path: 'C:\\Tools',
    SystemRoot: 'C:\\Windows',
    API_KEY: 'secret',
    NODE_OPTIONS: '--require evil.js',
  },
};
class FakeChild extends EventEmitter {
  connected = true;
  killed = false;
  messages: unknown[] = [];
  kill(): boolean {
    this.killed = true;
    return true;
  }
  send(message: unknown, callback: () => void): boolean {
    this.messages.push(message);
    callback();
    return true;
  }
}
function fixture() {
  const child = new FakeChild();
  const requests: unknown[][] = [];
  const start = ((...args: unknown[]) => {
    requests.push(args);
    return child as unknown as ChildProcess;
  }) as typeof spawn;
  return { child, requests, start };
}

describe('managed guided application', () => {
  it('rejects readiness URLs outside one bare loopback listener', () => {
    assert.equal(
      guidedApplicationUrl({ type: 'token-harness-guide-ready', url: 'http://127.0.0.1:49152/' }),
      'http://127.0.0.1:49152/',
    );
    for (const url of [
      'http://localhost:1/',
      'http://127.0.0.1/',
      'https://127.0.0.1:1/',
      'file:///app',
      'http://127.0.0.1:1/?command=apply',
      'http://127.0.0.1:1/#x',
      'http://user@127.0.0.1:1/',
      'http://127.0.0.1:1/api/apply',
      'bad',
    ])
      assert.equal(guidedApplicationUrl({ type: 'token-harness-guide-ready', url }), null, url);
    assert.equal(guidedApplicationUrl({ type: 'other', url: 'http://127.0.0.1:1/' }), null);
  });
  it('uses a literal argument array and filtered Windows environment', async () => {
    const f = fixture();
    const started = startManagedGuidedApplication(input, f.start);
    f.child.emit('message', { type: 'token-harness-guide-ready', url: 'http://127.0.0.1:49152/' });
    const app = await started;
    const request = f.requests[0]!;
    assert.equal(request[0], input.executable);
    assert.deepEqual(request[1], [input.entryScript, 'ui', '--no-open']);
    const options = request[2] as Record<string, unknown>;
    assert.equal(options['cwd'], input.cwd);
    assert.equal(options['shell'], false);
    assert.equal(options['detached'], false);
    assert.deepEqual(options['env'], {
      Path: 'C:\\Tools',
      SystemRoot: 'C:\\Windows',
      NO_COLOR: '1',
      TOKEN_HARNESS_GUIDE_LIFECYCLE: 'managed',
    });
    let stopped = false;
    const stopping = app.stop().then(() => {
      stopped = true;
    });
    await Promise.resolve();
    assert.equal(stopped, false, 'quit must await in-flight work');
    assert.equal(f.child.killed, false);
    assert.deepEqual(f.child.messages, [{ type: 'token-harness-guide-stop' }]);
    void app.stop();
    assert.equal(f.child.messages.length, 1);
    f.child.emit('exit', 0);
    await stopping;
    assert.equal(stopped, true);
  });
  it('ignores invalid readiness before accepting the actual listener', async () => {
    const f = fixture();
    const started = startManagedGuidedApplication(input, f.start);
    f.child.emit('message', { type: 'token-harness-guide-ready', url: 'https://example.com/' });
    f.child.emit('message', { type: 'token-harness-guide-ready', url: 'http://127.0.0.1:49152/' });
    assert.equal((await started).url, 'http://127.0.0.1:49152/');
    f.child.emit('exit', 0);
  });
  it('refuses an early exit and terminates a startup that never becomes ready', async () => {
    const early = fixture();
    const failed = startManagedGuidedApplication(input, early.start);
    early.child.emit('exit', 1);
    await assert.rejects(failed, /could not start/);
    const timeout = fixture();
    await assert.rejects(
      startManagedGuidedApplication({ ...input, timeoutMs: 5 }, timeout.start),
      /could not start/,
    );
    assert.equal(timeout.child.killed, true);
  });
});
