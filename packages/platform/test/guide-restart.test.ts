import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { it } from 'node:test';
import { launchGuidedApplication } from '../src/index.js';

const facts = {
  os: process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux',
  osDisplayName: 'test',
  arch: 'x64',
  nodeVersion: process.versions.node,
  isWsl: false,
} as const;

it('launches a replacement from a path with spaces and waits for its actual loopback listener', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'token-harness restart '));
  const entryScript = join(directory, 'fake app.mjs');
  writeFileSync(
    entryScript,
    `import {createServer} from 'node:http';
    const server=createServer((req,res)=>{
      res.on('finish',()=>server.close(()=>process.exit(0)));
      res.end(JSON.stringify(process.argv.slice(2)));
    });
    server.listen(0,'127.0.0.1',()=>process.send({type:'token-harness-guide-ready',url:'http://127.0.0.1:'+server.address().port+'/'}));
    setTimeout(()=>server.close(),1000);`,
  );
  try {
    const url = await launchGuidedApplication({
      executable: process.execPath,
      entryScript,
      cwd: directory,
      env: {},
      facts,
    });
    const response = await fetch(url);
    assert.deepEqual(await response.json(), ['ui', '--no-open']);
  } finally {
    // Windows holds the child's working directory until its process has exited.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

it('rejects remote readiness URLs and failed starts without returning a navigation target', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'token-harness-restart-failure-'));
  const entryScript = join(directory, 'fake.mjs');
  writeFileSync(
    entryScript,
    "process.send({type:'token-harness-guide-ready',url:'https://example.com/'});setTimeout(()=>process.exit(0),10);",
  );
  try {
    await assert.rejects(
      launchGuidedApplication({
        executable: process.execPath,
        entryScript,
        cwd: directory,
        env: {},
        facts,
        timeoutMs: 1000,
      }),
      /could not start/,
    );
    await assert.rejects(
      launchGuidedApplication({
        executable: process.execPath,
        entryScript: join(directory, 'missing.mjs'),
        cwd: directory,
        env: {},
        facts,
        timeoutMs: 1000,
      }),
      /could not start/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});
