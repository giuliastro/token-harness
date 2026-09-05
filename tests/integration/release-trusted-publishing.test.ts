import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT } from '../src/index.js';

const RELEASE = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8');

describe('npm trusted publishing runtime', () => {
  it('keeps OIDC enabled and disables release package-manager caching', () => {
    assert.match(RELEASE, /id-token: write/);
    assert.match(RELEASE, /node-version: '24'/);
    assert.match(RELEASE, /npm install --global npm@11\.5\.1/);
    assert.match(RELEASE, /package-manager-cache: false/);
  });

  it('removes setup-node token auth before publishing', () => {
    assert.match(RELEASE, /Remove setup-node token auth shim before OIDC publish/);
    assert.match(RELEASE, /registry=https:\/\/registry\.npmjs\.org\//);
    assert.match(RELEASE, /grep -q '_authToken'/);

    const scrub = RELEASE.indexOf('Remove setup-node token auth shim before OIDC publish');
    const publish = RELEASE.indexOf('Publish to npm with trusted publishing');
    assert.ok(scrub >= 0 && publish > scrub, 'token auth is not removed before publish');
  });

  it('does not inject a long-lived repository secret into npm publish', () => {
    assert.doesNotMatch(RELEASE, /secrets\.NPM_TOKEN/);
    const publishBlock = RELEASE.slice(RELEASE.indexOf('Publish to npm with trusted publishing'));
    assert.doesNotMatch(publishBlock, /NODE_AUTH_TOKEN|NPM_TOKEN/);
  });
});
