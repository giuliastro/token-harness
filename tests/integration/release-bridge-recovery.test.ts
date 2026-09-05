import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { REPO_ROOT } from '../src/index.js';

const BRIDGE = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release-bridge.yml'), 'utf8');

describe('release bridge recovery', () => {
  it('keeps the release branch/version guard', () => {
    assert.match(BRIDGE, /branches:\s*\n\s*- 'release\/v\*'/);
    assert.match(BRIDGE, /expected="release\/v\$version"/);
    assert.match(BRIDGE, /require\('\.\/package\.json'\)\.version/);
    assert.match(BRIDGE, /require\('\.\/apps\/cli\/package\.json'\)\.version/);
  });

  it('does not recreate or move an existing release tag', () => {
    assert.match(BRIDGE, /git ls-remote --exit-code --tags origin "refs\/tags\/\$tag"/);
    assert.match(BRIDGE, /tag_exists=true/);
    assert.match(BRIDGE, /if: steps\.release\.outputs\.tag_exists != 'true'/);
  });

  it('recovers an old tag through the trusted workflow on the default branch', () => {
    assert.match(BRIDGE, /DEFAULT_BRANCH: \$\{\{ github\.event\.repository\.default_branch \}\}/);
    assert.match(BRIDGE, /"ref":"\$DEFAULT_BRANCH","inputs":\{"tag":"v\$VERSION"\}/);
    assert.match(BRIDGE, /actions\/workflows\/release\.yml\/dispatches/);
  });

  it('still dispatches a newly-created release from its exact tag', () => {
    assert.match(BRIDGE, /-f ref="v\$VERSION"/);
  });
});
