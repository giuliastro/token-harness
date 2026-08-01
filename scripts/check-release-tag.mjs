/**
 * Refuses a release tag that does not match the version about to be published — PLAN §8.3.
 *
 * A tag is a human gesture and a version is a file. When they disagree, `npm publish` ships the
 * file and the tag announces something else — and the mismatch is discovered by whoever installs
 * `v0.2.0` and gets `0.1.0`. Publishing is irreversible, so this runs before it rather than after.
 *
 * The staged manifest is what gets read, not `apps/cli/package.json`. `scripts/package.mjs` already
 * refuses to stage a tree whose root and CLI versions disagree, so by the time this runs the staged
 * version is the single authority on what would be published — and it is what `npm publish` will
 * actually send.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const staged = join(repoRoot, 'dist', 'package', 'package.json');

const tag = process.argv[2];
if (tag === undefined || tag.trim() === '') {
  console.error('usage: node scripts/check-release-tag.mjs <tag>');
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(staged, 'utf8'));
} catch {
  console.error(`missing ${staged}\nRun \`pnpm package\` first.`);
  process.exit(1);
}

// `v0.1.0` is the tag form; anything else is a tag this workflow was not meant to fire on, and
// guessing which part of it is the version is how a release goes out under the wrong name.
const match = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/.exec(tag.trim());
if (match === null) {
  console.error(`tag ${tag} is not of the form v<semver>`);
  process.exit(1);
}

const tagged = match[1];
if (tagged !== manifest.version) {
  console.error(
    `tag ${tag} announces ${tagged}, but the staged package is ${manifest.version}\n` +
      'Bump the version and re-tag, or tag the commit that carries this version.',
  );
  process.exit(1);
}

console.log(`tag ${tag} matches ${manifest.name}@${manifest.version}`);
