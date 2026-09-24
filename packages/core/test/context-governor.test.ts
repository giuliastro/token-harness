import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { decideContextGovernor, harnessId, type ContextGovernorInput } from '../src/index.js';

function input(patch: Partial<ContextGovernorInput> = {}): ContextGovernorInput {
  return {
    harnessId: harnessId('codex'),
    pressure: 'high',
    taskBoundary: 'continuing',
    validation: 'passing',
    quality: 'passed',
    reuse: 'efficient',
    materials: [],
    ...patch,
  };
}

describe('context governor policy', () => {
  it('masks only measured superseded tool output and repository reads', () => {
    const decision = decideContextGovernor(
      input({
        materials: [
          { kind: 'tool-output', state: 'superseded', byteLength: 400, reduction: 'none' },
          { kind: 'repository-read', state: 'superseded', byteLength: 200, reduction: 'none' },
          { kind: 'mcp-schema', state: 'superseded', byteLength: 100, reduction: 'none' },
        ],
      }),
    );

    assert.equal(decision.action, 'mask');
    assert.equal(decision.observedBytes, 700);
    assert.equal(decision.actionableBytes, 600);
    assert.deepEqual(
      decision.materials.map(({ kind, action }) => [kind, action]),
      [
        ['mcp-schema', 'keep'],
        ['repository-read', 'mask'],
        ['tool-output', 'mask'],
      ],
    );
  });

  it('summarizes durable condensable material only when no reducer is attributed', () => {
    const decision = decideContextGovernor(
      input({
        materials: [
          { kind: 'task-state', state: 'condensable', byteLength: 800, reduction: 'none' },
          { kind: 'task-state', state: 'condensable', byteLength: 700, reduction: 'rtk' },
          { kind: 'task-state', state: 'condensable', byteLength: 600, reduction: 'harnesstrim' },
          { kind: 'task-state', state: 'condensable', byteLength: 500, reduction: 'unknown' },
        ],
      }),
    );

    assert.equal(decision.action, 'summarize');
    assert.equal(decision.actionableBytes, 800);
    assert.deepEqual(
      decision.materials.map((material) => material.action),
      ['keep', 'keep', 'keep', 'summarize'],
    );
  });

  it('vetoes material reduction for failing, unresolved, quality-regressed or retry-regressed work', () => {
    const vetoes: Partial<ContextGovernorInput>[] = [
      { validation: 'failing' },
      { validation: 'unresolved' },
      { quality: 'regressed' },
      { retryRegression: true },
    ];

    for (const veto of vetoes) {
      const decision = decideContextGovernor(
        input({
          ...veto,
          materials: [
            { kind: 'tool-output', state: 'superseded', byteLength: 512, reduction: 'none' },
          ],
        }),
      );
      assert.equal(decision.materials[0]?.action, 'keep');
      assert.equal(decision.actionableBytes, 0);
    }
  });

  it('starts a fresh session after validated completion but checkpoints unresolved boundaries within budget', () => {
    const completed = decideContextGovernor(input({ taskBoundary: 'completed', materials: [] }));
    assert.equal(completed.action, 'fresh-session');

    const checkpoint = decideContextGovernor(
      input({
        taskBoundary: 'new-task',
        validation: 'unresolved',
        checkpointMaxBytes: 2048,
        materials: [
          { kind: 'task-state', state: 'unresolved', byteLength: 300, reduction: 'none' },
        ],
      }),
    );
    assert.equal(checkpoint.action, 'checkpoint');
    assert.equal(checkpoint.checkpointMaxBytes, 2048);

    const noBudget = decideContextGovernor(
      input({ taskBoundary: 'completed', validation: 'unresolved', materials: [] }),
    );
    assert.equal(noBudget.action, 'unknown');
    assert.equal(
      noBudget.evidence.some((item) => item.code === 'context-checkpoint-budget-missing'),
      true,
    );

    const explicitCheckpoint = decideContextGovernor(
      input({
        checkpointRequired: true,
        checkpointMaxBytes: 512,
        materials: [],
      }),
    );
    assert.equal(explicitCheckpoint.action, 'checkpoint');
  });

  it('compacts an inefficient continuing task only with an artifact byte ceiling', () => {
    const compact = decideContextGovernor(
      input({ taskBoundary: 'continuing', reuse: 'inefficient', checkpointMaxBytes: 1024 }),
    );
    assert.equal(compact.action, 'compact');
    assert.equal(compact.checkpointMaxBytes, 1024);

    const unbounded = decideContextGovernor(
      input({ taskBoundary: 'continuing', reuse: 'inefficient' }),
    );
    assert.equal(unbounded.action, 'unknown');
    assert.equal(
      unbounded.evidence.some((item) => item.code === 'context-compaction-budget-missing'),
      true,
    );
  });

  it('does not infer material cleanup from pressure or unmeasured bytes', () => {
    const highPressure = decideContextGovernor(input({ pressure: 'high', materials: [] }));
    assert.equal(highPressure.action, 'unknown');

    const lowPressure = decideContextGovernor(input({ pressure: 'low', materials: [] }));
    assert.equal(lowPressure.action, 'keep');

    const unmeasured = decideContextGovernor(
      input({
        materials: [
          { kind: 'tool-output', state: 'superseded', byteLength: null, reduction: 'none' },
        ],
      }),
    );
    assert.equal(unmeasured.action, 'unknown');
    assert.equal(unmeasured.actionableBytes, 0);
  });

  it('saturates aggregate local-byte evidence at the safe integer limit', () => {
    const decision = decideContextGovernor(
      input({
        materials: [
          {
            kind: 'tool-output',
            state: 'superseded',
            byteLength: Number.MAX_SAFE_INTEGER,
            reduction: 'none',
          },
          { kind: 'tool-output', state: 'superseded', byteLength: 1, reduction: 'none' },
        ],
      }),
    );

    assert.equal(decision.observedBytes, Number.MAX_SAFE_INTEGER);
    assert.equal(decision.actionableBytes, Number.MAX_SAFE_INTEGER);
  });
});
