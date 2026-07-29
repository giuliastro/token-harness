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
  parseOptimizationEvent,
  parseProviderManifest,
  type CompatibilityRule,
  type HarnessManifest,
  type ImportCursor,
  type VerificationReceipt,
} from '@token-harness/core';

import { FIXTURES_ROOT } from '../src/index.js';

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
    assert.equal(parsed.value.delegatedInstallReview, null);
  });

  it('harnesstrim provider manifest carries its delegated-install review', () => {
    const value = assertRoundTrips('provider-manifest.harnesstrim.json');
    const parsed = parseProviderManifest(value);
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    // RFC 0002 §What this cannot detect: the review is recorded with the
    // upstream version it was performed against.
    assert.equal(parsed.value.delegatedInstallReview?.upstreamVersion, '0.0.5');
    assert.equal(parsed.value.delegatedInstallReview?.upstreamUninstallAvailable, false);
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
    assert.equal(value.testedVersions.maximum, '2.0.14');
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

  it('compatibility rule', () => {
    const value = assertRoundTrips('compatibility-rule.json') as CompatibilityRule;
    assert.equal(value.outcome, 'conflict');
    assert.equal(value.order, undefined);
    assert.ok(value.fixtures.length > 0, 'a rule without a fixture is not a rule');
  });
});
