import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  desktopEnvironment,
  isDesktopNavigationAllowed,
  isExternalDesktopLink,
} from '../src/policy.js';

describe('desktop navigation', () => {
  const listener = 'http://127.0.0.1:49152/';
  it('keeps navigation on the authenticated listener', () => {
    assert.equal(isDesktopNavigationAllowed(listener, listener), true);
    assert.equal(isDesktopNavigationAllowed(listener + '#results', listener), true);
    for (const url of [
      'https://example.com',
      'file:///tmp/app',
      'http://127.0.0.1:49153/',
      'http://localhost:49152/',
      'http://user@127.0.0.1:49152/',
      'bad',
    ])
      assert.equal(isDesktopNavigationAllowed(url, listener), false, url);
  });
  it('allows only credential-free HTTPS external links', () => {
    assert.equal(
      isExternalDesktopLink('https://github.com/giuliastro/token-harness/releases'),
      true,
    );
    for (const url of [
      'javascript:alert(1)',
      'file:///tmp/app',
      'http://example.com',
      'https://user:password@example.com',
      'bad',
    ])
      assert.equal(isExternalDesktopLink(url), false, url);
  });
});

describe('desktop executable environment', () => {
  it('preserves Windows PATH casing and precedence without duplicate keys or locations', () => {
    const env = desktopEnvironment({
      env: { Path: 'C:\\Tools;C:\\Windows', SystemRoot: 'C:\\Windows' },
      runtimeDirectory: 'C:\\App\\runtime',
      additionalPaths: ['c:\\tools', 'C:\\User\\npm'],
      windows: true,
    });
    assert.equal(env['Path'], 'C:\\Tools;C:\\Windows;C:\\User\\npm;C:\\App\\runtime');
    assert.equal(env['PATH'], undefined);
    assert.equal(env['SystemRoot'], 'C:\\Windows');
  });
  it('drops empty PATH components rather than searching the project directory', () => {
    const env = desktopEnvironment({
      env: { PATH: ':/usr/bin::' },
      runtimeDirectory: '/app/runtime',
      additionalPaths: ['/usr/bin', '/home/user/.local/bin'],
      windows: false,
    });
    assert.equal(env['PATH'], '/usr/bin:/home/user/.local/bin:/app/runtime');
  });
});
