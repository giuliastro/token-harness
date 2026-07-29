/**
 * In-process CLI invocation with captured streams.
 *
 * No test spawns a process to assert the CLI contract. Spawning would add a
 * shell, an inherited environment, and the developer's real home directory
 * between the assertion and the thing being asserted — the last of which
 * AGENTS.md forbids outright.
 */

import { run, type RunOptions } from 'token-harness';
import type { PlatformFacts } from '@token-harness/core';

export interface CaptureResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export const WINDOWS_FIXTURE_PLATFORM: PlatformFacts = {
  os: 'windows',
  osDisplayName: 'Windows 11',
  arch: 'x64',
  nodeVersion: '22.14.0',
  isWsl: false,
};

export const LINUX_FIXTURE_PLATFORM: PlatformFacts = {
  os: 'linux',
  osDisplayName: 'Ubuntu 24.04',
  arch: 'x64',
  nodeVersion: '22.13.0',
  isWsl: false,
};

export type CaptureOptions = Omit<RunOptions, 'streams'> & { streams?: never };

export async function captureRun(options: CaptureOptions): Promise<CaptureResult> {
  let stdout = '';
  let stderr = '';
  const exitCode = await run({
    ...options,
    streams: {
      out: (text) => {
        stdout += text;
      },
      err: (text) => {
        stderr += text;
      },
    },
  });
  return { exitCode, stdout, stderr };
}
