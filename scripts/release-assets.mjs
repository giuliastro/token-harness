import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { desktopArtifactNames } from './desktop-release.mjs';

/** Inventory must be complete before a draft becomes public. Recovery keeps the same tag. */
export function verifyReleaseAssets(tag, inventory, desktop = false) {
  if (
    typeof tag !== 'string' ||
    !/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(tag)
  )
    throw new Error('An exact release tag is required.');
  if (!Array.isArray(inventory?.assets))
    throw new Error('The remote release inventory is unavailable.');
  const version = tag.slice(1);
  const expected = [
    `token-harness-${version}.tgz`,
    ...(desktop
      ? [...desktopArtifactNames(version), `token-harness-${version}-desktop-SHA256SUMS.txt`]
      : []),
  ];
  const actual = new Set(
    inventory.assets
      .filter(
        (asset) =>
          asset &&
          typeof asset.name === 'string' &&
          asset.state === 'uploaded' &&
          Number.isSafeInteger(asset.size) &&
          asset.size > 0,
      )
      .map((asset) => asset.name),
  );
  const missing = expected.filter((name) => !actual.has(name));
  if (missing.length) throw new Error(`Release is incomplete: ${missing.join(', ')}`);
  return expected;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[4] !== undefined && process.argv[4] !== '--desktop')
    throw new Error('Use <tag> <inventory.json> [--desktop].');
  const names = verifyReleaseAssets(
    process.argv[2],
    JSON.parse(readFileSync(process.argv[3], 'utf8')),
    process.argv[4] === '--desktop',
  );
  console.log(`Verified ${names.length} uploaded assets before release publication.`);
}
