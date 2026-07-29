/**
 * Platform detection — PLAN §2.1 acceptance: "table-driven platform tests" and
 * "WSL and native Windows remain distinct".
 *
 * Every case runs on every operating system, because detection reads a
 * `SystemProbe` rather than the machine. A Windows case that only ran on Windows
 * would be a Windows case that only ran in one of three CI jobs.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { detectPlatform, type SystemProbe } from '../src/index.js';

function probe(overrides: Partial<SystemProbe> = {}): SystemProbe {
  const files: Record<string, string> = {};
  return {
    platform: 'linux',
    arch: 'x64',
    release: '6.8.0-generic',
    version: '',
    nodeVersion: '22.13.0',
    env: {},
    homeDirectory: '/home/dev',
    temporaryDirectory: '/tmp',
    readTextFile: (path) => files[path] ?? null,
    ...overrides,
  };
}

interface Case {
  name: string;
  probe: SystemProbe;
  os: 'windows' | 'macos' | 'linux';
  isWsl: boolean;
  osDisplayName: string;
}

const CASES: readonly Case[] = [
  {
    name: 'native Windows 11, product name available',
    probe: probe({ platform: 'win32', release: '10.0.26200', version: 'Windows 11 Pro' }),
    os: 'windows',
    isWsl: false,
    osDisplayName: 'Windows 11 Pro',
  },
  {
    name: 'native Windows 11, product name unavailable, build above the 22000 line',
    probe: probe({ platform: 'win32', release: '10.0.22631', version: '' }),
    os: 'windows',
    isWsl: false,
    osDisplayName: 'Windows 11',
  },
  {
    name: 'native Windows 10, build below the 22000 line',
    probe: probe({ platform: 'win32', release: '10.0.19045', version: '' }),
    os: 'windows',
    isWsl: false,
    osDisplayName: 'Windows 10',
  },
  {
    name: 'a Windows release nobody has a name for',
    probe: probe({ platform: 'win32', release: '11.2.40000', version: '' }),
    os: 'windows',
    isWsl: false,
    osDisplayName: 'Windows (NT 11.2.40000)',
  },
  {
    name: 'macOS 15 from the Darwin major',
    probe: probe({ platform: 'darwin', release: '24.3.0', arch: 'arm64' }),
    os: 'macos',
    isWsl: false,
    osDisplayName: 'macOS 15',
  },
  {
    name: 'macOS 26, where Apple stopped counting by one',
    probe: probe({ platform: 'darwin', release: '25.0.0', arch: 'arm64' }),
    os: 'macos',
    isWsl: false,
    osDisplayName: 'macOS 26',
  },
  {
    name: 'a Darwin major with no mapping',
    probe: probe({ platform: 'darwin', release: '99.0.0' }),
    os: 'macos',
    isWsl: false,
    osDisplayName: 'macOS (Darwin 99.0.0)',
  },
  {
    name: 'Linux with os-release',
    probe: probe({
      readTextFile: (path) =>
        path === '/etc/os-release' ? 'ID=ubuntu\nPRETTY_NAME="Ubuntu 24.04.1 LTS"\n' : null,
    }),
    os: 'linux',
    isWsl: false,
    osDisplayName: 'Ubuntu 24.04.1 LTS',
  },
  {
    name: 'Linux with os-release only under /usr/lib',
    probe: probe({
      readTextFile: (path) =>
        path === '/usr/lib/os-release' ? "PRETTY_NAME='Alpine Linux v3.21'\n" : null,
    }),
    os: 'linux',
    isWsl: false,
    osDisplayName: 'Alpine Linux v3.21',
  },
  {
    name: 'Linux with no os-release at all',
    probe: probe({ release: '6.1.0' }),
    os: 'linux',
    isWsl: false,
    osDisplayName: 'Linux 6.1.0',
  },
  {
    name: 'WSL2 detected from the kernel, with no interop environment at all',
    probe: probe({
      release: '5.15.153.1-microsoft-standard-WSL2',
      readTextFile: (path) =>
        path === '/proc/sys/kernel/osrelease'
          ? '5.15.153.1-microsoft-standard-WSL2\n'
          : path === '/etc/os-release'
            ? 'PRETTY_NAME="Ubuntu 24.04 LTS"\n'
            : null,
    }),
    os: 'linux',
    isWsl: true,
    osDisplayName: 'Ubuntu 24.04 LTS',
  },
  {
    name: 'WSL detected from the environment when the kernel string is unavailable',
    probe: probe({ env: { WSL_DISTRO_NAME: 'Ubuntu' } }),
    os: 'linux',
    isWsl: true,
    osDisplayName: 'Linux 6.8.0-generic',
  },
  {
    name: 'a Linux VM is not WSL merely because it is Linux',
    probe: probe({
      readTextFile: (path) =>
        path === '/proc/version' ? 'Linux version 6.8.0-generic (gcc 13)\n' : null,
    }),
    os: 'linux',
    isWsl: false,
    osDisplayName: 'Linux 6.8.0-generic',
  },
];

describe('platform detection', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const detection = detectPlatform(testCase.probe);
      assert.ok(detection.ok, 'expected detection to succeed');
      assert.equal(detection.facts.os, testCase.os);
      assert.equal(detection.facts.isWsl, testCase.isWsl);
      assert.equal(detection.facts.osDisplayName, testCase.osDisplayName);
    });
  }

  it('never reports native Windows as WSL', () => {
    const detection = detectPlatform(
      probe({ platform: 'win32', version: 'Windows 11 Pro', env: { WSL_DISTRO_NAME: 'Ubuntu' } }),
    );
    assert.ok(detection.ok);
    assert.equal(detection.facts.os, 'windows');
    // `WSLENV` and friends are visible to a Windows process invoked from WSL
    // through interop. Native Windows is never WSL, whatever the environment says.
    assert.equal(detection.facts.isWsl, false);
  });

  it('maps an unknown architecture rather than guessing', () => {
    const detection = detectPlatform(probe({ arch: 'riscv64' }));
    assert.ok(detection.ok);
    assert.equal(detection.facts.arch, 'unknown');
  });

  it('refuses an unsupported operating system with an actionable diagnostic', () => {
    const detection = detectPlatform(probe({ platform: 'freebsd' }));
    assert.equal(detection.ok, false);
    if (detection.ok) return;
    assert.equal(detection.diagnostics.length, 1);
    assert.equal(detection.diagnostics[0]?.code, 'unsupported-operating-system');
    assert.equal(detection.diagnostics[0]?.severity, 'error');
    assert.notEqual(detection.diagnostics[0]?.remediation, null);
  });
});
