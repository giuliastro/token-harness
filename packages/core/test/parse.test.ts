import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  checkSchemaVersion,
  parseCliEnvelope,
  parseJsonDocument,
  parseOptimizationEvent,
  parseProviderManifest,
} from '../src/index.js';

const VALID_MANIFEST = {
  schemaVersion: 1,
  id: 'rtk',
  displayName: 'RTK',
  description: 'Rust Token Killer',
  homepage: 'https://example.invalid/rtk',
  sourceRepository: 'https://example.invalid/rtk.git',
  license: { spdx: 'MIT', distributionMode: 'external', reviewRequired: false },
  capabilities: [
    {
      capability: 'shell.command.rewrite',
      mode: 'exclusive',
      harnesses: ['claude'],
      evidence: { sourceReference: 'src/rewrite.rs', upstreamVersion: '1.4.2' },
    },
  ],
  platforms: [],
  harnesses: [],
  installationChannels: [],
  metrics: { source: 'cli-json', mode: 'native', locations: [] },
  delegatedInstallReview: null,
};

describe('schema-version rejection', () => {
  it('stops on an unknown newer version rather than guessing', () => {
    const problem = checkSchemaVersion(2, 1, 'envelope');
    assert.ok(problem);
    assert.equal(problem.code, 'schema-version-unsupported');
    assert.match(problem.remediation ?? '', /Upgrade Token Harness/);
  });

  it('stops on an older version too, with a different remediation', () => {
    const problem = checkSchemaVersion(0, 1, 'envelope');
    assert.ok(problem);
    assert.match(problem.remediation ?? '', /Regenerate/);
  });

  it('rejects a missing or non-integer version', () => {
    assert.equal(checkSchemaVersion(undefined, 1, 'envelope')?.code, 'schema-version-missing');
    assert.equal(checkSchemaVersion('1', 1, 'envelope')?.code, 'schema-version-missing');
    assert.equal(checkSchemaVersion(1.5, 1, 'envelope')?.code, 'schema-version-missing');
  });

  it('accepts the understood version', () => {
    assert.equal(checkSchemaVersion(1, 1, 'envelope'), null);
  });
});

describe('parseCliEnvelope', () => {
  it('accepts a well-formed envelope', () => {
    const result = parseCliEnvelope({
      schemaVersion: 1,
      command: 'doctor',
      toolVersion: '0.1.0',
      status: 'ok',
      exitCode: 0,
      data: null,
      diagnostics: [],
    });
    assert.equal(result.ok, true);
  });

  it('refuses an unknown schema version before looking at anything else', () => {
    const result = parseCliEnvelope({ schemaVersion: 99 });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics.length, 1);
    assert.equal(result.diagnostics[0]?.code, 'schema-version-unsupported');
  });

  it('rejects a status outside the union', () => {
    const result = parseCliEnvelope({
      schemaVersion: 1,
      command: 'doctor',
      toolVersion: '0.1.0',
      status: 'fine',
      exitCode: 0,
      data: null,
      diagnostics: [],
    });
    assert.equal(result.ok, false);
  });
});

describe('parseProviderManifest', () => {
  it('accepts a well-formed manifest', () => {
    const result = parseProviderManifest(VALID_MANIFEST);
    assert.equal(result.ok, true);
  });

  it('fails with an actionable diagnostic on an unknown capability', () => {
    const result = parseProviderManifest({
      ...VALID_MANIFEST,
      capabilities: [{ capability: 'shell.output.compress', mode: 'exclusive', harnesses: [] }],
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    const codes = result.diagnostics.map((entry) => entry.code);
    assert.ok(codes.includes('capability-unknown'));
    for (const entry of result.diagnostics) {
      assert.ok(entry.remediation !== null, `${entry.code} has no remediation`);
    }
  });

  it('rejects a non-kebab-case provider id', () => {
    const result = parseProviderManifest({ ...VALID_MANIFEST, id: 'RTK' });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.diagnostics.some((entry) => entry.code === 'provider-id-invalid'));
  });

  it('requires an explicit metrics declaration, including "none"', () => {
    const withoutMetrics = { ...VALID_MANIFEST } as Record<string, unknown>;
    delete withoutMetrics['metrics'];
    const result = parseProviderManifest(withoutMetrics);
    assert.equal(result.ok, false);
  });

  it('collects every problem rather than stopping at the first', () => {
    const result = parseProviderManifest({
      ...VALID_MANIFEST,
      id: 'RTK',
      displayName: '',
      license: { spdx: null, distributionMode: 'vendored', reviewRequired: 'yes' },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.diagnostics.length >= 3);
  });
});

describe('parseOptimizationEvent', () => {
  it('refuses a figure without a measurement class', () => {
    const result = parseOptimizationEvent({
      schemaVersion: 1,
      eventId: 'e1',
      timestamp: '2026-07-29T10:12:04Z',
      measurement: { class: 'roughly-this-much', beforeChars: 10, afterChars: 5 },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, 'measurement-class-unknown');
    assert.match(result.diagnostics[0]?.remediation ?? '', /never leave a figure unlabelled/);
  });

  it('accepts a labelled event', () => {
    const result = parseOptimizationEvent({
      schemaVersion: 1,
      eventId: 'e1',
      timestamp: '2026-07-29T10:12:04Z',
      measurement: { class: 'estimated-local', beforeChars: 10, afterChars: 5 },
    });
    assert.equal(result.ok, true);
  });
});

describe('parseJsonDocument', () => {
  it('turns a syntax error into a diagnostic', () => {
    const result = parseJsonDocument('{ not json');
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.diagnostics[0]?.code, 'malformed-json');
  });
});
