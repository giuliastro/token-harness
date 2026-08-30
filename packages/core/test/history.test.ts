import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assessRecentSessionBoundary, harnessId, type SessionHistoryRow } from '../src/index.js';

const CLAUDE = harnessId('claude');

function session(input: Partial<SessionHistoryRow> & { sessionId: string }): SessionHistoryRow {
  return {
    harnessId: CLAUDE,
    sessionId: input.sessionId,
    firstActivity: input.firstActivity ?? null,
    lastActivity: input.lastActivity ?? null,
    modelsUsed: input.modelsUsed ?? [],
    inputTokens: input.inputTokens ?? 0,
    cacheCreationTokens: input.cacheCreationTokens ?? 0,
    cacheReadTokens: input.cacheReadTokens ?? 0,
    outputTokens: input.outputTokens ?? 0,
    totalTokens: input.totalTokens ?? 0,
  };
}

describe('recent session boundary signal', () => {
  it(
    'marks the most recently active large session as a candidate, not an active-session fact',
    () => {
    const result = assessRecentSessionBoundary(
      CLAUDE,
      [
        session({
          sessionId: 'older',
          firstActivity: '2026-08-30T08:00:00.000Z',
          lastActivity: '2026-08-30T09:00:00.000Z',
          totalTokens: 10_000,
        }),
        session({
          sessionId: 'recent-large',
          firstActivity: '2026-08-30T10:00:00.000Z',
          lastActivity: '2026-08-30T14:30:00.000Z',
          totalTokens: 120_000,
        }),
      ],
      '2026-08-30T15:00:00.000Z',
    );

    assert.equal(result.state, 'recent-large');
    assert.equal(result.candidateSessionId, 'recent-large');
    assert.equal(result.totalTokens, 120_000);
    assert.equal(result.durationMinutes, 270);
    assert.equal(result.minutesSinceLastActivity, 30);
      assert.match(result.reason, /heuristic/i);
    },
  );

  it('marks an old candidate stale even when it was small', () => {
    const result = assessRecentSessionBoundary(
      CLAUDE,
      [
        session({
          sessionId: 'stale-small',
          firstActivity: '2026-08-29T20:00:00.000Z',
          lastActivity: '2026-08-29T21:00:00.000Z',
          totalTokens: 5_000,
        }),
      ],
      '2026-08-30T15:00:00.000Z',
    );

    assert.equal(result.state, 'stale');
    assert.equal(result.minutesSinceLastActivity, 1080);
  });

  it('stays unknown when no valid past activity timestamp exists', () => {
    const result = assessRecentSessionBoundary(
      CLAUDE,
      [session({ sessionId: 'unknown-time', lastActivity: null, totalTokens: 200_000 })],
      '2026-08-30T15:00:00.000Z',
    );

    assert.equal(result.state, 'unknown');
    assert.equal(result.candidateSessionId, null);
  });
});
