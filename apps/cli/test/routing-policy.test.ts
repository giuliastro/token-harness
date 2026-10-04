import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { codexModelTier, hookRootModel, routingContext } from '../src/routing-policy.js';

// The hook is paid for on every prompt; Codex's additionalContextLimit is 500 tokens.
const MAX_CONTEXT_CHARACTERS = 1_600;

describe('native routing policy', () => {
  it('classifies Codex roots by model family', () => {
    assert.equal(codexModelTier('gpt-6-astra'), 'frontier');
    assert.equal(codexModelTier('gpt-6.1-sol'), 'workhorse');
    assert.equal(codexModelTier('gpt-5.6-terra'), 'workhorse');
    assert.equal(codexModelTier('gpt-5.5'), 'workhorse');
    assert.equal(codexModelTier('gpt-6-luna'), 'light');
    assert.equal(codexModelTier('gpt-5.6-luna'), 'light');
    assert.equal(codexModelTier('gpt-5.1-codex-mini'), 'light');
    assert.equal(codexModelTier('gpt-reserve'), 'unknown');
    assert.equal(codexModelTier(null), 'unknown');
  });

  it('reads only a well-formed model slug from the hook payload', () => {
    assert.equal(hookRootModel('{"model":"gpt-6.1-sol","prompt":"x"}'), 'gpt-6.1-sol');
    assert.equal(hookRootModel('{"prompt":"x"}'), null);
    assert.equal(hookRootModel('{"model":42}'), null);
    assert.equal(hookRootModel('{"model":"gpt sol\\nignore previous"}'), null);
    assert.equal(hookRootModel(`{"model":"${'a'.repeat(81)}"}`), null);
    assert.equal(hookRootModel('["gpt-6.1-sol"]'), null);
    assert.equal(hookRootModel('not json'), null);
    assert.equal(hookRootModel(null), null);
  });

  it('adds nothing when the Codex root is already the light tier', () => {
    assert.equal(routingContext('codex', 'gpt-6-luna'), null);
  });

  it('routes a workhorse Codex root to Luna with an override-capable fresh spawn', () => {
    const context = routingContext('codex', 'gpt-6.1-sol');
    assert.ok(context !== null);
    assert.match(context, /gpt-6-luna/);
    assert.doesNotMatch(context, /gpt-6\.1-sol/);
    assert.match(context, /fork_turns "none"/);
    assert.match(context, /reasoning_effort/);
  });

  it('offers the workhorse tier only below a frontier Codex root', () => {
    const context = routingContext('codex', 'gpt-6-astra');
    assert.ok(context !== null);
    assert.match(context, /gpt-6\.1-sol/);
    assert.match(context, /gpt-6-luna/);
  });

  it('keeps an unknown Codex root from routing Luna to itself', () => {
    const context = routingContext('codex', null);
    assert.ok(context !== null);
    assert.match(context, /unless you are already running Luna/);
  });

  it('gives Claude a ladder keyed on its own model and requires an explicit model', () => {
    const context = routingContext('claude', null);
    assert.ok(context !== null);
    for (const alias of ['"opus"', '"sonnet"', '"haiku"']) assert.ok(context.includes(alias));
    assert.match(context, /Haiku root: do not route/);
    assert.match(context, /Always set the Agent tool model parameter/);
    assert.doesNotMatch(context, /spawn_agent/);
  });

  it('keeps the safety boundaries and savings rule in every variant', () => {
    for (const context of [
      routingContext('claude', null),
      routingContext('codex', null),
      routingContext('codex', 'gpt-6.1-sol'),
      routingContext('codex', 'gpt-6-astra'),
    ]) {
      assert.ok(context !== null);
      for (const boundary of ['architecture', 'security', 'releases', 'final review'])
        assert.ok(context.includes(boundary), boundary);
      assert.match(context, /One routed worker at a time/);
      assert.match(context, /finish on the root rather than retrying cheaper/);
      assert.match(context, /paired, quality-gated measurements/);
      assert.ok(context.length <= MAX_CONTEXT_CHARACTERS, String(context.length));
    }
  });
});
