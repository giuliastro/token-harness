import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { it } from 'node:test';
import { nodeStateMutationGuard } from '../src/state/mutation-guard.js';

it('excludes overlapping mutations by canonical state root and releases after verification', async () => {
  const root = await mkdtemp(join(tmpdir(), 'th-mutation-'));
  try {
    await mkdir(join(root, 'child'));
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const first = nodeStateMutationGuard.run(root, async () => {
      entered();
      await waiting;
      return 'verified';
    });
    await ready;
    let secondRan = false;
    const second = await nodeStateMutationGuard.run(join(root, 'child', '..'), async () => {
      secondRan = true;
    });
    assert.equal(second.acquired, false);
    assert.equal(secondRan, false, 'the rejected operation must never execute');
    if (!second.acquired) assert.equal(second.exitCode, 5);
    release();
    assert.deepEqual(await first, { acquired: true, value: 'verified' });
    assert.deepEqual(await nodeStateMutationGuard.run(root, async () => 'next'), {
      acquired: true,
      value: 'next',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('releases the kernel reservation when the operation throws; it leaves no stale lock file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'th-mutation-'));
  try {
    await assert.rejects(
      nodeStateMutationGuard.run(root, async () => {
        throw new Error('fixture failure');
      }),
      /fixture failure/,
    );
    const result = await nodeStateMutationGuard.run(root, async () => 42);
    assert.deepEqual(result, { acquired: true, value: 42 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('refuses an unresolved state root without running any part of the change', async () => {
  const root = await mkdtemp(join(tmpdir(), 'th-mutation-'));
  try {
    let ran = false;
    const result = await nodeStateMutationGuard.run(join(root, 'absent'), async () => {
      ran = true;
    });
    assert.equal(result.acquired, false);
    assert.equal(ran, false);
    if (!result.acquired) assert.equal(result.exitCode, 9);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
