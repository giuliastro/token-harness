import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const targets = [
  join(repoRoot, 'dist'),
  join(repoRoot, 'packages', 'core', 'dist'),
  join(repoRoot, 'packages', 'platform', 'dist'),
  join(repoRoot, 'packages', 'adapters', 'dist'),
  join(repoRoot, 'apps', 'cli', 'dist'),
  join(repoRoot, 'tests', 'dist'),
];

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
  console.log(`removed ${target}`);
}
