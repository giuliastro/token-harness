/**
 * The fake runner — PLAN §2.2, "fake runner with expectation matching".
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FakeProcessRunner } from '../src/index.js';

describe('expectation matching', () => {
  it('matches on the executable name, its basename, or its full path', async () => {
    const runner = new FakeProcessRunner().expect({
      executable: 'icacls',
      respond: { stdout: 'ok' },
    });
    for (const executable of ['icacls', 'icacls.exe', 'C:\\Windows\\System32\\icacls.exe']) {
      const outcome = await runner.run({ executable, args: [], cwd: 'C:\\work' });
      assert.equal(outcome.stdout, 'ok', executable);
    }
  });

  it('matches an exact argument array', async () => {
    const runner = new FakeProcessRunner().expect({
      executable: 'whoami',
      args: ['/user', '/nh', '/fo', 'csv'],
      respond: { stdout: '"DEV\\dev","S-1-5-21-1-2-3-1001"\r\n' },
    });
    const outcome = await runner.run({
      executable: 'whoami',
      args: ['/user', '/nh', '/fo', 'csv'],
      cwd: 'C:\\work',
    });
    assert.match(outcome.stdout, /S-1-5-21-1-2-3-1001/);
  });

  it('matches with a predicate when the arguments are not fixed', async () => {
    const runner = new FakeProcessRunner().expect({
      executable: 'icacls',
      args: (args) => args.includes('/save'),
      respond: { exitCode: 0 },
    });
    const outcome = await runner.run({
      executable: 'icacls',
      args: ['C:\\state', '/save', 'C:\\state\\snap', '/Q'],
      cwd: 'C:\\state',
    });
    assert.equal(outcome.exitCode, 0);
  });

  it('lets a later expectation take over once an earlier one is exhausted', async () => {
    const runner = new FakeProcessRunner()
      .expect({ executable: 'rtk', times: 1, respond: { stdout: 'first' } })
      .expect({ executable: 'rtk', respond: { stdout: 'second' } });
    assert.equal((await runner.run({ executable: 'rtk', args: [], cwd: '/w' })).stdout, 'first');
    assert.equal((await runner.run({ executable: 'rtk', args: [], cwd: '/w' })).stdout, 'second');
    assert.equal((await runner.run({ executable: 'rtk', args: [], cwd: '/w' })).stdout, 'second');
  });

  it('can respond as a function of the request', async () => {
    const runner = new FakeProcessRunner().expect({
      executable: 'rtk',
      respond: (request) => ({ stdout: request.args.join(',') }),
    });
    const outcome = await runner.run({ executable: 'rtk', args: ['gain', '--json'], cwd: '/w' });
    assert.equal(outcome.stdout, 'gain,--json');
  });

  it('records every request in order', async () => {
    const runner = new FakeProcessRunner().expect({ executable: /.*/ });
    await runner.run({ executable: 'a', args: ['1'], cwd: '/w' });
    await runner.run({ executable: 'b', args: ['2'], cwd: '/w' });
    assert.deepEqual(
      runner.calls.map((call) => call.executable),
      ['a', 'b'],
    );
  });

  it('throws on an unexpected command instead of answering it', async () => {
    // A fake that answers anything teaches a test suite nothing: a command nobody
    // declared is a defect in the test, and throwing is the only way that surfaces.
    const runner = new FakeProcessRunner().expect({ executable: 'icacls' });
    await assert.rejects(
      () => runner.run({ executable: 'curl', args: ['https://example.test'], cwd: '/w' }),
      /unexpected command[\s\S]*curl[\s\S]*registered expectations[\s\S]*icacls/,
    );
  });

  it('redacts a secret out of the failure message it throws', async () => {
    const runner = new FakeProcessRunner();
    await assert.rejects(
      () =>
        runner.run({
          executable: 'gh',
          args: ['auth', 'login', '--with-token', 'ghp_deadbeef'],
          cwd: '/w',
          secretValues: ['ghp_deadbeef'],
        }),
      (error: Error) => {
        assert.ok(!error.message.includes('ghp_deadbeef'), error.message);
        assert.match(error.message, /\[redacted\]/);
        return true;
      },
    );
  });

  it('reports an expectation that was declared with a count and not met', async () => {
    const runner = new FakeProcessRunner().expect({ executable: 'icacls', times: 2 });
    await runner.run({ executable: 'icacls', args: [], cwd: '/w' });
    assert.throws(() => runner.assertSatisfied(), /expected 2, got 1/);
  });

  it('is satisfied when the declared counts are met', async () => {
    const runner = new FakeProcessRunner().expect({ executable: 'icacls', times: 1 });
    await runner.run({ executable: 'icacls', args: [], cwd: '/w' });
    assert.doesNotThrow(() => runner.assertSatisfied());
  });

  it('does not match when the working directory differs', async () => {
    const runner = new FakeProcessRunner().expect({ executable: 'rtk', cwd: '/expected' });
    await assert.rejects(() => runner.run({ executable: 'rtk', args: [], cwd: '/other' }));
  });
});
