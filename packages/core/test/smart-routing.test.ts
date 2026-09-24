import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregateSmartRoutingEvents,
  classifySmartRoutingPrompt,
  isSmartRoutingDecisionEvent,
  type SmartRoutingDecisionEvent,
} from '../src/index.js';

function event(input: Partial<SmartRoutingDecisionEvent> = {}): SmartRoutingDecisionEvent {
  return {
    schemaVersion: 1,
    eventId: '1727000000000-test1',
    timestamp: '2026-09-23T12:00:00.000Z',
    source: 'ccr',
    harnessId: 'claude',
    mode: 'shadow',
    classifierVersion: 'heuristic-v1',
    tier: 'simple',
    score: -3.5,
    confidence: 'high',
    reasonCodes: ['short-prompt', 'simple-language-indicator'],
    requestModel: 'Claude Code API/main',
    candidateModel: 'Claude Code API/fast',
    routeMutationRequested: false,
    routeSkipReason: 'shadow-mode',
    promptChars: 14,
    requestInputTokenEstimate: 8,
    toolCount: 0,
    hasImage: false,
    decisionLatencyMs: 1,
    measurement: {
      status: 'not-measured',
      resolvedModel: null,
      providerInputTokens: null,
      providerOutputTokens: null,
      qualityGate: 'unknown',
    },
    ...input,
  };
}

describe('Smart Model Routing classifier', () => {
  it('classifies explicit plain questions as simple with a high-confidence conservative gate', () => {
    const prompt = { text: 'What is 2 + 2?' };
    const first = classifySmartRoutingPrompt(prompt);
    const second = classifySmartRoutingPrompt(prompt);

    assert.deepEqual(first, second);
    assert.equal(first.tier, 'simple');
    assert.equal(first.confidence, 'high');
    assert.equal(first.conservativeEligible, true);
    assert.equal('text' in first, false);
  });

  it('keeps vague short follow-ups away from the simple route', () => {
    const decision = classifySmartRoutingPrompt({ text: 'do that' });

    assert.equal(decision.tier, 'standard');
    assert.equal(decision.conservativeEligible, false);
    assert.ok(decision.reasonCodes.includes('possible-contextual-follow-up'));
  });

  it('marks technical multi-step code work as complex and ineligible for downgrade', () => {
    const decision = classifySmartRoutingPrompt({
      text: 'Analyze this distributed database race condition and implement a TypeScript transaction fix in three steps.',
      toolCount: 5,
    });

    assert.ok(['complex', 'critical'].includes(decision.tier));
    assert.equal(decision.codePresent, false);
    assert.equal(decision.conservativeEligible, false);
    assert.ok(decision.reasonCodes.includes('technical-terms'));
    assert.ok(decision.reasonCodes.includes('multi-step-request'));
  });

  it('treats code and images as higher-risk request signals', () => {
    const code = classifySmartRoutingPrompt({ text: 'Fix this: ```ts\nconst x = 1;\n```' });
    const image = classifySmartRoutingPrompt({ text: 'What is this?', hasImage: true });

    assert.equal(code.codePresent, true);
    assert.notEqual(code.tier, 'simple');
    assert.equal(image.tier, 'complex');
    assert.equal(image.conservativeEligible, false);
  });

  it('keeps empty input at standard with low confidence', () => {
    const decision = classifySmartRoutingPrompt({ text: '   ' });

    assert.equal(decision.tier, 'standard');
    assert.equal(decision.confidence, 'low');
    assert.equal(decision.conservativeEligible, false);
  });
});

describe('Smart Model Routing telemetry', () => {
  it('accepts feature-only decision records and rejects extra prompt fields', () => {
    const record = event();
    assert.equal(isSmartRoutingDecisionEvent(record), true);
    assert.equal(isSmartRoutingDecisionEvent({ ...record, prompt: 'private prompt text' }), false);
  });

  it('aggregates decisions without inventing measured savings', () => {
    const report = aggregateSmartRoutingEvents({
      events: [
        event(),
        event({
          harnessId: 'codex',
          mode: 'conservative',
          routeMutationRequested: true,
          tier: 'complex',
        }),
      ],
    });

    assert.equal(report.retainedDecisionCount, 2);
    assert.equal(report.byHarness.claude, 1);
    assert.equal(report.byHarness.codex, 1);
    assert.equal(report.byMode.conservative, 1);
    assert.equal(report.byTier.complex, 1);
    assert.equal(report.routeMutationRequestCount, 1);
    assert.equal(report.savingsStatus, 'not-measured');
    assert.equal(report.savingsMeasurementCount, 0);
  });
});
