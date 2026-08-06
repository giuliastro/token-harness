import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  CAPABILITY_IDS,
  MANAGED_HARNESS_IDS,
  MVP_PROVIDER_IDS,
  PROFILE_IDS,
  VERIFICATION_TIERS,
  classifyVersion,
  compareVersions,
  defaultCompositionMode,
  evidence,
  findCompatibilityRule,
  formatCapabilityScope,
  formatSemanticVersion,
  formatTestedRange,
  hasCorroboratingEvidence,
  harnessId,
  isCapabilityId,
  isDiagnosticCode,
  isProfileId,
  isValidId,
  isWellFormedRule,
  meetsDeclaredTier,
  parseCapabilityScope,
  parseSemanticVersion,
  providerId,
  renderPlatformSummary,
  verificationTierRank,
  type CompatibilityRule,
  type HarnessId,
  type ProviderId,
} from '../src/index.js';

describe('identifiers', () => {
  it('accepts lowercase kebab-case only', () => {
    for (const good of ['rtk', 'harnesstrim', 'claude', 'lazy-mcp', 'a1']) {
      assert.equal(isValidId(good), true, good);
    }
    for (const bad of ['', 'RTK', 'rtk_', '-rtk', 'rtk--x', 'rtk ', 'rtk.x']) {
      assert.equal(isValidId(bad), false, JSON.stringify(bad));
    }
  });

  it('throws on an invalid id rather than branding it', () => {
    assert.throws(() => providerId('RTK'), TypeError);
    assert.throws(() => harnessId('Claude Code'), TypeError);
    assert.equal(providerId('rtk'), 'rtk');
  });

  it('names the 0.1.0 managed set', () => {
    assert.deepEqual([...MANAGED_HARNESS_IDS], ['claude', 'codex', 'hermes', 'opencode']);
    assert.deepEqual([...MVP_PROVIDER_IDS], ['rtk', 'harnesstrim']);
  });
});

describe('diagnostics', () => {
  it('recognises kebab-case codes', () => {
    assert.equal(isDiagnosticCode('exclusive-scope-contested'), true);
    assert.equal(isDiagnosticCode('Exclusive-Scope'), false);
    assert.equal(isDiagnosticCode('scope_contested'), false);
  });
});

describe('semantic versions', () => {
  it('parses and reformats', () => {
    const version = parseSemanticVersion('1.4.2');
    assert.ok(version);
    assert.equal(formatSemanticVersion(version), '1.4.2');
    assert.equal(parseSemanticVersion('not-a-version'), null);
    assert.equal(parseSemanticVersion('1.4'), null);
  });

  it('orders releases above prereleases of the same core version', () => {
    const a = parseSemanticVersion('1.0.0-rc.1');
    const b = parseSemanticVersion('1.0.0');
    assert.ok(a && b);
    assert.equal(compareVersions(a, b) < 0, true);
    assert.equal(compareVersions(b, a) > 0, true);
    assert.equal(compareVersions(b, b), 0);
  });

  it('orders numeric prerelease identifiers numerically', () => {
    const a = parseSemanticVersion('1.0.0-rc.2');
    const b = parseSemanticVersion('1.0.0-rc.10');
    assert.ok(a && b);
    assert.equal(compareVersions(a, b) < 0, true);
  });

  it('ignores build metadata', () => {
    const a = parseSemanticVersion('1.0.0+aaa');
    const b = parseSemanticVersion('1.0.0+bbb');
    assert.ok(a && b);
    assert.equal(compareVersions(a, b), 0);
  });

  it('classifies against a tested range, warning on unknown-newer', () => {
    const range = { minimum: '1.0.0', maximum: '1.4.2' };
    assert.equal(classifyVersion('1.4.2', range), 'in-range');
    assert.equal(classifyVersion('0.9.0', range), 'below-range');
    assert.equal(classifyVersion('1.5.0', range), 'unknown-newer');
    assert.equal(classifyVersion('bogus', range), 'unparseable');
    assert.equal(classifyVersion('99.0.0', { minimum: '1.0.0', maximum: null }), 'in-range');
  });

  it('formats an open-ended range without inventing an upper bound', () => {
    assert.equal(formatTestedRange({ minimum: '1.0.0', maximum: null }), '>=1.0.0');
    assert.equal(formatTestedRange({ minimum: '1.0.0', maximum: '1.4.2' }), '1.0.0–1.4.2');
  });
});

describe('capabilities', () => {
  it('carries the RFC 0003 taxonomy', () => {
    assert.equal(CAPABILITY_IDS.length, 12);
    assert.equal(isCapabilityId('shell.output.reduce'), true);
    assert.equal(isCapabilityId('shell.output.compress'), false);
  });

  it('declares the RFC 0003 default composition modes', () => {
    assert.equal(defaultCompositionMode('shell.command.rewrite'), 'exclusive');
    assert.equal(defaultCompositionMode('shell.output.reduce'), 'exclusive');
    assert.equal(defaultCompositionMode('tool.output.reduce'), 'exclusive');
    assert.equal(defaultCompositionMode('conversation.compact'), 'exclusive');
    assert.equal(defaultCompositionMode('reasoning.effort.route'), 'exclusive');
    assert.equal(defaultCompositionMode('metrics.observe'), 'observational');
  });

  it('round trips a scope through its address form', () => {
    const scope = {
      harness: 'claude' as HarnessId,
      toolFamily: 'bash',
      interceptionPoint: 'post-tool-use',
      capability: 'shell.output.reduce' as const,
    };
    const text = formatCapabilityScope(scope);
    assert.equal(text, 'claude/bash/post-tool-use/shell.output.reduce');
    assert.deepEqual(parseCapabilityScope(text), scope);
  });

  it('rejects a malformed scope rather than guessing', () => {
    assert.equal(parseCapabilityScope('claude/bash/shell.output.reduce'), null);
    assert.equal(parseCapabilityScope('claude/bash/post-tool-use/nope'), null);
    assert.equal(parseCapabilityScope('claude//post-tool-use/shell.output.reduce'), null);
  });
});

describe('verification tiers', () => {
  it('ranks presence below config-only below canary', () => {
    assert.deepEqual([...VERIFICATION_TIERS], ['presence', 'config-only', 'canary']);
    assert.equal(verificationTierRank('presence'), 1);
    assert.equal(verificationTierRank('canary'), 3);
  });

  it('measures a result against what was declared, not against the strongest tier', () => {
    assert.equal(meetsDeclaredTier('config-only', 'config-only'), true);
    assert.equal(meetsDeclaredTier('config-only', 'canary'), true);
    assert.equal(meetsDeclaredTier('canary', 'config-only'), false);
    assert.equal(meetsDeclaredTier('config-only', 'presence'), false);
  });
});

describe('evidence', () => {
  it('does not treat a configuration string alone as corroboration', () => {
    const configOnly = [
      evidence({ kind: 'config-entry', source: 'settings.json', detail: 'entry present' }),
    ];
    assert.equal(hasCorroboratingEvidence(configOnly), false);
    assert.equal(
      hasCorroboratingEvidence([
        ...configOnly,
        evidence({ kind: 'version-output', source: 'rtk --version', detail: '1.4.2' }),
      ]),
      true,
    );
  });
});

describe('compatibility rules', () => {
  const rule: CompatibilityRule = {
    id: 'rtk-harnesstrim-claude',
    providers: ['rtk', 'harnesstrim'] as ProviderId[],
    harnesses: ['claude'] as HarnessId[],
    capabilities: ['shell.output.reduce'],
    outcome: 'conflict',
    testedVersions: { rtk: '1.4.2', harnesstrim: '0.0.5' },
    rationale: 'both reduce the same Bash result and neither can be narrowed',
    fixtures: ['brownfield/claude-harnesstrim-hooked'],
  };

  it('finds a rule that covers exactly the pair on that harness', () => {
    assert.equal(
      findCompatibilityRule([rule], {
        providers: ['harnesstrim', 'rtk'] as ProviderId[],
        harness: 'claude' as HarnessId,
        capability: 'shell.output.reduce',
      }),
      rule,
    );
  });

  it('fails closed when no rule covers the harness', () => {
    assert.equal(
      findCompatibilityRule([rule], {
        providers: ['rtk', 'harnesstrim'] as ProviderId[],
        harness: 'codex' as HarnessId,
        capability: 'shell.output.reduce',
      }),
      null,
    );
  });

  it('fails closed when the provider set differs', () => {
    assert.equal(
      findCompatibilityRule([rule], {
        providers: ['rtk'] as ProviderId[],
        harness: 'claude' as HarnessId,
        capability: 'shell.output.reduce',
      }),
      null,
    );
  });

  it('honours a wildcard harness', () => {
    const wildcard: CompatibilityRule = { ...rule, harnesses: '*' };
    assert.equal(
      findCompatibilityRule([wildcard], {
        providers: ['rtk', 'harnesstrim'] as ProviderId[],
        harness: 'opencode' as HarnessId,
        capability: 'shell.output.reduce',
      }),
      wildcard,
    );
  });

  it('treats an ordered rule without an order as malformed', () => {
    assert.equal(isWellFormedRule(rule), true);
    assert.equal(isWellFormedRule({ ...rule, outcome: 'ordered' }), false);
    assert.equal(
      isWellFormedRule({
        ...rule,
        outcome: 'ordered',
        order: ['rtk', 'harnesstrim'] as ProviderId[],
      }),
      true,
    );
  });
});

describe('profiles and platform facts', () => {
  it('ships safe and custom, and not balanced', () => {
    assert.deepEqual([...PROFILE_IDS], ['safe', 'custom']);
    assert.equal(isProfileId('balanced'), false);
  });

  it('keeps WSL distinct from native Windows in the rendered summary', () => {
    const base = {
      os: 'linux' as const,
      osDisplayName: 'Ubuntu 24.04',
      arch: 'x64' as const,
      nodeVersion: '22.13.0',
      isWsl: false,
    };
    assert.equal(renderPlatformSummary(base), 'Ubuntu 24.04 (x64)');
    assert.equal(renderPlatformSummary({ ...base, isWsl: true }), 'Ubuntu 24.04 (x64) on WSL');
  });
});
