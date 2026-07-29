/**
 * Package-manager discovery — PLAN §2.1.
 *
 * Table-driven over a resolver, so nothing on the machine running the test
 * influences the result and no manager has to be installed.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PlatformFacts, ResolvedExecutable } from '@token-harness/core';

import { discoverPackageManagers } from '../src/index.js';

function facts(os: PlatformFacts['os'], isWsl = false): PlatformFacts {
  return { os, osDisplayName: os, arch: 'x64', nodeVersion: '22.13.0', isWsl };
}

function resolverFor(available: readonly string[]) {
  return (name: string): ResolvedExecutable | null =>
    available.includes(name) ? { requested: name, path: `/usr/bin/${name}`, kind: 'native' } : null;
}

describe('discovery', () => {
  it('reports what is on PATH, in declaration order', () => {
    const found = discoverPackageManagers({
      facts: facts('linux'),
      resolve: resolverFor(['pnpm', 'npm', 'cargo']),
    });
    assert.deepEqual(
      found.map((entry) => entry.id),
      ['npm', 'pnpm', 'cargo'],
    );
  });

  it('reports nothing when nothing is installed, rather than assuming npm', () => {
    assert.deepEqual(
      discoverPackageManagers({ facts: facts('linux'), resolve: resolverFor([]) }),
      [],
    );
  });

  it('does not look for Homebrew on Windows', () => {
    const found = discoverPackageManagers({
      facts: facts('windows'),
      resolve: resolverFor(['brew', 'npm']),
    });
    assert.deepEqual(
      found.map((entry) => entry.id),
      ['npm'],
    );
  });

  it('looks for scoop and winget on native Windows', () => {
    const found = discoverPackageManagers({
      facts: facts('windows'),
      resolve: resolverFor(['scoop', 'winget']),
    });
    assert.deepEqual(
      found.map((entry) => entry.id),
      ['scoop', 'winget'],
    );
  });

  it('does not look for scoop or winget under WSL, where they are not reachable as Linux executables', () => {
    const found = discoverPackageManagers({
      facts: facts('linux', true),
      resolve: resolverFor(['scoop', 'winget', 'npm']),
    });
    assert.deepEqual(
      found.map((entry) => entry.id),
      ['npm'],
    );
  });

  it('finds Homebrew on Linux, where it is also supported', () => {
    const found = discoverPackageManagers({
      facts: facts('linux'),
      resolve: resolverFor(['brew']),
    });
    assert.deepEqual(
      found.map((entry) => entry.id),
      ['homebrew'],
    );
  });

  it('carries the resolved executable through, including its kind', () => {
    const found = discoverPackageManagers({
      facts: facts('windows'),
      resolve: (name) =>
        name === 'pnpm'
          ? { requested: name, path: 'C:\\npm\\pnpm.cmd', kind: 'windows-batch-shim' }
          : null,
    });
    assert.equal(found[0]?.executable.kind, 'windows-batch-shim');
    assert.equal(found[0]?.executable.path, 'C:\\npm\\pnpm.cmd');
  });
});
