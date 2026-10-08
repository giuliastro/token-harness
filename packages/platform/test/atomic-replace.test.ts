import assert from 'node:assert/strict';
import { it } from 'node:test';
import { replaceAtomically } from '../src/fs/atomic-replace.js';

it('retains the old document during transient Windows sharing violations and eventually replaces it', async () => {
  let target = 'old';
  let remaining = 3;
  const waits: number[] = [];
  await replaceAtomically({
    source: 'staged',
    target: 'checkpoint',
    nativeWindows: true,
    rename: async (source, path) => {
      assert.equal(source, 'staged');
      assert.equal(path, 'checkpoint');
      assert.equal(target, 'old');
      if (remaining-- > 0) throw Object.assign(new Error('sharing violation'), { code: 'EPERM' });
      target = 'new';
    },
    wait: async (ms) => {
      assert.equal(target, 'old');
      waits.push(ms);
    },
  });
  assert.equal(target, 'new');
  assert.equal(waits.length, 3);
  assert.ok(waits.every((ms) => ms > 0 && ms <= 100));
});

it('bounds persistent Windows failures while leaving the old document intact', async () => {
  const failure = Object.assign(new Error('locked'), { code: 'EACCES' });
  let attempts = 0;
  let waited = 0;
  const target = 'old';
  await assert.rejects(
    () =>
      replaceAtomically({
        source: 'staged',
        target: 'checkpoint',
        nativeWindows: true,
        rename: async () => {
          attempts++;
          assert.equal(target, 'old');
          throw failure;
        },
        wait: async (ms) => {
          waited += ms;
        },
      }),
    (error) => error === failure,
  );
  assert.equal(target, 'old');
  assert.ok(attempts > 1 && attempts <= 64);
  assert.ok(waited <= 5000);
});

it('reports POSIX and unrelated Windows errors immediately without a replacement fallback', async () => {
  for (const [nativeWindows, code] of [
    [false, 'EPERM'],
    [true, 'ENOENT'],
  ] as const) {
    const failure = Object.assign(new Error('failure'), { code });
    let attempts = 0;
    await assert.rejects(
      () =>
        replaceAtomically({
          source: 'staged',
          target: 'checkpoint',
          nativeWindows,
          rename: async () => {
            attempts++;
            throw failure;
          },
          wait: async () => {
            throw new Error('must not wait');
          },
        }),
      (error) => error === failure,
    );
    assert.equal(attempts, 1);
  }
});
