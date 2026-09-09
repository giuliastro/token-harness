import assert from 'node:assert/strict';
import test from 'node:test';

import {
  HEADROOM_MINIMUM_BENCHMARK_VERSION,
  headroomVersionAtLeast,
  parseHeadroomVersion,
  parseHeadroomWrapTargets,
} from '../src/providers/index.js';

test('parses Headroom semantic versions without trusting surrounding text', () => {
  assert.equal(parseHeadroomVersion('headroom 0.36.0'), '0.36.0');
  assert.equal(parseHeadroomVersion('headroom version unknown'), null);
});

test('requires the current benchmark floor', () => {
  assert.equal(HEADROOM_MINIMUM_BENCHMARK_VERSION, '0.36.0');
  assert.equal(headroomVersionAtLeast('0.36.0', '0.36.0'), true);
  assert.equal(headroomVersionAtLeast('0.37.1', '0.36.0'), true);
  assert.equal(headroomVersionAtLeast('0.35.9', '0.36.0'), false);
});

test('recognizes Claude and Codex only when wrap help advertises them', () => {
  assert.deepEqual(parseHeadroomWrapTargets('Supported commands: claude codex aider'), {
    claude: true,
    codex: true,
  });
  assert.deepEqual(parseHeadroomWrapTargets('Supported commands: claude aider'), {
    claude: true,
    codex: false,
  });
});
