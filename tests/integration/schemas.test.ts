/**
 * Golden JSON fixtures protect the public schemas — PLAN §1.2 acceptance.
 *
 * Two properties per fixture:
 *
 * 1. it parses into the domain type, or is rejected with an actionable
 *    diagnostic when that is what the fixture is for;
 * 2. it round trips byte for byte through `JSON.parse` and `JSON.stringify`.
 *
 * The second is what makes these golden files rather than samples. A field
 * added, removed, renamed, or reordered in a public schema changes the fixture,
 * and changing a fixture is a reviewed act.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import {
  jsonValueDigest,
  ownedFileDigest,
  parseOptimizationEvent,
  parsePlannedAction,
  parseProviderManifest,
  type CompatibilityRule,
  type HarnessManifest,
  type ImportCursor,
  type VerificationReceipt,
} from '@token-harness/core';

import { claudeAdapter } from '@token-harness/adapters';

import { FIXTURES_ROOT, listGoldenScenarios, loadGolden } from '../src/index.js';

const SCHEMAS = `${FIXTURES_ROOT}schemas/`;

function readFixture(name: string): { text: string; value: unknown } {
  const text = readFileSync(`${SCHEMAS}${name}`, 'utf8');
  return { text, value: JSON.parse(text) as unknown };
}

function assertRoundTrips(name: string): unknown {
  const { text, value } = readFixture(name);
  assert.equal(`${JSON.stringify(value, null, 2)}\n`, text.replace(/\r\n/g, '\n'));
  return value;
}

describe('schema fixtures', () => {
  it('rtk provider manifest', () => {
    const value = assertRoundTrips('provider-manifest.rtk.json');
    const parsed = parseProviderManifest(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.id, 'rtk');
    // RTK carries no delegated install at all, so the map itself is null rather than empty.
    assert.equal(parsed.value.delegatedInstallReviews, null);
  });

  it('harnesstrim provider manifest carries its delegated-install review', () => {
    const value = assertRoundTrips('provider-manifest.harnesstrim.json');
    const parsed = parseProviderManifest(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    // RFC 0002 §What this cannot detect: the review is recorded with the
    // upstream version it was performed against.
    assert.equal(parsed.value.delegatedInstallReviews?.['claude']?.upstreamVersion, '0.0.5');
    assert.equal(
      parsed.value.delegatedInstallReviews?.['claude']?.upstreamUninstallAvailable,
      false,
    );
  });

  it('a manifest from a future build is refused, not partially read', () => {
    const value = assertRoundTrips('provider-manifest.future.json');
    const parsed = parseProviderManifest(value);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.deepEqual(
      parsed.diagnostics.map((entry) => entry.code),
      ['schema-version-unsupported'],
    );
  });

  it('an invalid manifest fails with actionable diagnostics', () => {
    const value = assertRoundTrips('provider-manifest.invalid.json');
    const parsed = parseProviderManifest(value);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    const codes = new Set(parsed.diagnostics.map((entry) => entry.code));
    assert.ok(codes.has('provider-id-invalid'));
    assert.ok(codes.has('capability-unknown'));
    assert.ok(codes.has('field-invalid'));
    for (const entry of parsed.diagnostics) {
      assert.ok(entry.remediation !== null, `${entry.code} has no remediation`);
      assert.equal(entry.severity, 'error');
    }
  });

  it('claude harness manifest', () => {
    const value = assertRoundTrips('harness-manifest.claude.json') as HarnessManifest;
    assert.equal(value.id, 'claude');
    assert.equal(value.verificationTier, 'canary');
    // The version whose settings.json the Phase 2.5 spike actually read. A claim about
    // the configuration schema, not about a test suite having run against it.
    assert.equal(value.testedVersions.maximum, '2.1.212');
    assert.equal(value.receiptFamily, 'provider-telemetry');
    assert.equal(value.requiresEnablement, false);
  });

  /**
   * The fixture is the shipped manifest, asserted rather than transcribed.
   *
   * A hand-copied manifest fixture goes stale the first time the adapter changes and
   * every test keeps passing, which is the failure golden files exist to prevent. This
   * makes the committed file a review surface for a real change to the adapter's declared
   * contract.
   */
  it('is byte-identical to the manifest the adapter actually ships', () => {
    const { text } = readFixture('harness-manifest.claude.json');
    assert.equal(
      text.replace(/\r\n/g, '\n'),
      `${JSON.stringify(claudeAdapter.manifest, null, 2)}\n`,
    );
  });

  it('declares a tool family the spike found uncovered, so the gap is reportable', () => {
    const windowsFamilies = claudeAdapter.manifest.toolFamilies.filter((family) =>
      family.platforms.includes('windows'),
    );
    assert.deepEqual(
      windowsFamilies.map((family) => family.id),
      ['Bash', 'PowerShell'],
    );
    assert.ok(windowsFamilies.every((family) => family.executesShellCommands));
  });

  it('an exact-local rtk event', () => {
    const value = assertRoundTrips('optimization-event.rtk-exact.json');
    const parsed = parseOptimizationEvent(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.value.measurement.class, 'exact-local');
    assert.equal(parsed.value.outcome.changed, true);
  });

  it('a harnesstrim dryrun event is counterfactual and unchanged', () => {
    const value = assertRoundTrips('optimization-event.harnesstrim-dryrun.json');
    const parsed = parseOptimizationEvent(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    // RFC 0005: a dryrun event describes bytes that stayed in context.
    assert.equal(parsed.value.measurement.class, 'counterfactual');
    assert.equal(parsed.value.outcome.changed, false);
    assert.equal(parsed.value.measurement.beforeTokens, null);
    assert.equal(parsed.value.measurement.afterTokens, null);
  });

  it('an event from a future build is refused', () => {
    const value = assertRoundTrips('optimization-event.future.json');
    const parsed = parseOptimizationEvent(value);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.diagnostics[0]?.code, 'schema-version-unsupported');
  });

  it('verification receipt', () => {
    const value = assertRoundTrips('verification-receipt.json') as VerificationReceipt;
    // RFC 0002 §Harness versioning is symmetric: the harness version is
    // recorded in every receipt.
    assert.equal(value.harnessVersions['claude'], '2.0.14');
    assert.equal(value.providerVersions['rtk'], '1.4.2');
  });

  it('import cursor', () => {
    const value = assertRoundTrips('import-cursor.json') as ImportCursor;
    // RFC 0005 §Deduplicating a stream without event IDs.
    assert.ok(value.absolutePath.length > 0);
    assert.ok(value.fileIdentity.length > 0);
    assert.equal(typeof value.byteOffset, 'number');
    assert.ok(value.lastLineDigest !== undefined);
  });

  /**
   * A plan crosses a process boundary — RFC 0006 §Plan persistence stores it under
   * its ID and `apply --plan <id>` reads it back — so an action's payload is a public
   * schema and gets the same protection as a manifest.
   */
  it('a write-owned-file action carries the bytes it will write', () => {
    const value = assertRoundTrips('planned-action.write-owned-file.json');
    const parsed = parsePlannedAction(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.value.kind !== 'write-owned-file') return;
    assert.equal(parsed.value.content, '{\n  "schemaVersion": 1\n}\n');
    // The recorded precondition is the digest of that exact content, so a plan
    // computed as an update cannot be applied to a file somebody else changed.
    assert.equal(parsed.value.expectedDigest, ownedFileDigest(parsed.value.content));
  });

  it('a patch-marker-block action carries its fence, its comment syntax, and its body', () => {
    const value = assertRoundTrips('planned-action.patch-marker-block.json');
    const parsed = parsePlannedAction(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.value.kind !== 'patch-marker-block') return;
    assert.equal(parsed.value.commentPrefix, '<!--');
    assert.equal(parsed.value.commentSuffix, '-->');
    assert.equal(parsed.value.createIfMissing, true);
  });

  it('a merge-json action declares every pointer its operations touch', () => {
    const value = assertRoundTrips('planned-action.merge-json.json');
    const parsed = parsePlannedAction(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.value.kind !== 'merge-json') return;
    const operation = parsed.value.operations[0];
    assert.equal(operation?.kind, 'append');
    assert.ok(parsed.value.ownedPointers.includes(operation?.pointer ?? ''));
    // The precondition digest is over the canonical form, so it is stable under a
    // reformatter that reorders keys.
    assert.equal(operation?.expectedValueDigest, jsonValueDigest(operation?.value ?? null));
  });

  it('a merge-json action that edits outside its declared claim is refused', () => {
    const value = assertRoundTrips('planned-action.merge-json.json') as Record<string, unknown>;
    const parsed = parsePlannedAction({ ...value, ownedPointers: ['hooks.PostToolUse'] });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.diagnostics[0]?.code, 'action-claims-undeclared-pointer');
  });

  it('a remove-owned-change action states the claim it will check before removing', () => {
    const value = assertRoundTrips('planned-action.remove-owned-change.json');
    const parsed = parsePlannedAction(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok || parsed.value.kind !== 'remove-owned-change') return;
    assert.equal(parsed.value.target.kind, 'owned-marker-block');
    assert.equal(parsed.value.riskClass, 'destructive');
  });

  it('an action missing its payload fails with actionable diagnostics', () => {
    const value = assertRoundTrips('planned-action.invalid.json');
    const parsed = parsePlannedAction(value);
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    const messages = parsed.diagnostics.map((entry) => entry.message).join('\n');
    assert.match(messages, /`id` must be a non-empty string/);
    assert.match(messages, /`riskClass` must be/);
    assert.match(messages, /`content` must be a string/);
    assert.match(messages, /`expectedDigest` must be null or a sha256 digest/);
    for (const entry of parsed.diagnostics) {
      assert.ok(entry.remediation !== null, `${entry.code} has no remediation`);
      assert.equal(entry.severity, 'error');
    }
  });

  it('an unknown action kind is refused rather than skipped', () => {
    const parsed = parsePlannedAction({ kind: 'reticulate-splines' });
    assert.equal(parsed.ok, false);
    if (parsed.ok) return;
    assert.equal(parsed.diagnostics[0]?.code, 'action-kind-unknown');
  });

  /**
   * The golden plan fixtures are inputs to the renderer, and nothing else type-checks
   * them: `LoadedGolden.result.data` is `unknown` by design. Without this, an action
   * payload could go stale in a committed fixture and every test would still pass.
   */
  it('every action in every golden plan fixture is a valid action', () => {
    let checked = 0;
    for (const name of listGoldenScenarios()) {
      const { result } = loadGolden(name);
      const data = result.data as { actions?: unknown } | null;
      if (data === null || !Array.isArray(data.actions)) continue;
      for (const action of data.actions) {
        const parsed = parsePlannedAction(action);
        assert.ok(
          parsed.ok,
          `${name}: ${parsed.ok ? '' : parsed.diagnostics.map((d) => d.message).join('; ')}`,
        );
        checked += 1;
      }
    }
    assert.ok(checked > 0, 'no golden fixture contained an action to check');
  });

  it('compatibility rule', () => {
    const value = assertRoundTrips('compatibility-rule.json') as CompatibilityRule;
    assert.equal(value.outcome, 'conflict');
    assert.equal(value.order, undefined);
    assert.ok(value.fixtures.length > 0, 'a rule without a fixture is not a rule');
  });
});
