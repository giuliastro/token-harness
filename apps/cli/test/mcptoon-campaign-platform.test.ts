import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { harnessId, type PlatformFacts } from '@token-harness/core';

import { validateCandidateCampaignSurface } from '../src/commands/candidate-campaign-surface.js';

const CODEX = harnessId('codex');
const CLAUDE = harnessId('claude');

const LINUX: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Linux',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const WINDOWS: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

const MACOS: PlatformFacts = {
  os: 'macos',
  osDisplayName: 'macOS',
  arch: 'arm64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

describe('mcptoon campaign surface admission', () => {
  it('admits reviewed native Linux harness families', () => {
    assert.equal(validateCandidateCampaignSurface('mcptoon', CODEX, LINUX), null);
    assert.equal(validateCandidateCampaignSurface('mcptoon', CLAUDE, LINUX), null);
  });

  it('fails closed on Windows, macOS and WSL', () => {
    assert.equal(
      validateCandidateCampaignSurface('mcptoon', CODEX, WINDOWS)?.code,
      'candidate-benchmark-campaign-surface-unreviewed',
    );
    assert.equal(
      validateCandidateCampaignSurface('mcptoon', CODEX, MACOS)?.code,
      'candidate-benchmark-campaign-surface-unreviewed',
    );
    assert.equal(
      validateCandidateCampaignSurface('mcptoon', CODEX, { ...LINUX, isWsl: true })?.code,
      'candidate-benchmark-campaign-surface-unreviewed',
    );
  });

  it('does not constrain unrelated candidate campaigns', () => {
    assert.equal(validateCandidateCampaignSurface('gitnexus', CODEX, WINDOWS), null);
  });
});
