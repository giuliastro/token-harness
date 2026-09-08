import fs from 'node:fs';

const testPath = 'apps/cli/test/guided-agent-skill.test.ts';
const test = fs.readFileSync(testPath, 'utf8');
const before = 'const call: GuideCall = async <T>(args: readonly string[]) => {';
if (!test.includes(before)) throw new Error('guided agent skill test anchor missing');
fs.writeFileSync(
  testPath,
  test.replace(before, 'const call: GuideCall = async (args: readonly string[]) => {'),
);

for (const path of [
  '.tmp-guided-agent-skill-install.mjs',
  '.tmp-fix-guided-agent-skill-finalizer.mjs',
  '.github/workflows/tmp-guided-agent-skill-install.yml',
]) {
  fs.rmSync(path, { force: true });
}
