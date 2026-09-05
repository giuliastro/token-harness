import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const result = spawnSync(command, ['test'], {
  encoding: 'utf8',
  maxBuffer: 100 * 1024 * 1024,
  shell: process.platform === 'win32',
});

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const marker = '✖ failing tests:';
const start = output.lastIndexOf(marker);
if (start >= 0) {
  process.stdout.write(output.slice(start));
} else {
  const lines = output.split(/\r?\n/);
  process.stdout.write(`${lines.slice(-250).join('\n')}\n`);
}

if (result.error !== undefined) {
  console.error(result.error.message);
}
process.exitCode = result.status ?? 1;
