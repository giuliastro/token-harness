import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import {
  commandResult,
  toEnvelope,
  providerId,
  harnessId,
  type ProviderSavingsRow,
  type CliEnvelope,
} from '@token-harness/core';
import { savingsImpact } from '../src/guided-impact.js';
import { GuideService, type GuideCall } from '../src/guided.js';

const window = { start: '2026-08-30T10:00:00Z', end: '2026-09-06T10:00:00Z', all: false };
const row: ProviderSavingsRow = {
  providerId: providerId('rtk'),
  class: 'exact-local',
  unit: 'tokens',
  before: 1200,
  after: 420,
  saved: 780,
  operations: 17,
  harnesses: [harnessId('claude')],
  managedByTokenHarness: true,
  adapterMode: null,
};

describe('honest impact and private sharing', () => {
  it('uses the same per-row baseline for the headline, preview and share', () => {
    const result = savingsImpact(row, window);
    assert.equal(result.headline, '65% less tool output');
    assert.match(result.share!.text, /1,200 -> 420 tokens/);
    assert.match(result.share!.text, /17 recorded changed outputs/);
    assert.match(result.share!.text, /2026-08-30 to 2026-09-06/);
    assert.match(result.share!.text, /Not full-session, money or subscription-quota savings/);
    assert.match(result.share!.shortText, /not quota savings/);
    assert.ok(result.share!.shortText.length + result.share!.url.length + 1 <= 280);
  });
  it('carries estimated and character-only labels everywhere without a token conversion', () => {
    const result = savingsImpact({ ...row, class: 'estimated-local', unit: 'chars' }, window);
    assert.match(result.headline, /^Estimated /);
    assert.match(result.share!.shortText, /Local estimate/);
    assert.match(result.share!.beforeAfter, /characters$/);
    assert.doesNotMatch(result.share!.text, /tokens/);
  });
  it('never silently promotes other classes, missing baselines, invalid counts or inconsistent sums', () => {
    for (const patch of [
      { class: 'counterfactual' },
      { class: 'end-to-end-billed' },
      { before: undefined },
      { before: NaN },
      { after: Infinity },
      { before: -1 },
      { operations: 0 },
      { operations: 1.5 },
      { saved: 900 },
      { saved: Number.MAX_VALUE },
      { after: 0, before: 0, saved: 1 },
    ]) {
      const result = savingsImpact({ ...row, ...patch } as ProviderSavingsRow, window);
      assert.equal(result.percent, null);
      assert.equal(result.share, null);
    }
  });
  it('retains negative and unchanged results, without a positive share button', () => {
    const growth = savingsImpact({ ...row, after: 1320, saved: -120 }, window);
    assert.equal(growth.headline, '10% more tool output');
    assert.equal(growth.share, null);
    const zero = savingsImpact({ ...row, after: 1200, saved: 0 }, window);
    assert.equal(zero.kind, 'unchanged');
    assert.equal(zero.share, null);
    const noBaseline = savingsImpact({ ...row, before: 0, after: 10, saved: -10 }, window);
    assert.equal(noBaseline.percent, null);
    assert.equal(noBaseline.kind, 'growth');
  });
  it('does not round a tiny gain into zero or a near-total reduction into 100%', () => {
    assert.equal(
      savingsImpact({ ...row, before: 100000, after: 99999, saved: 1 }, window).percent,
      '<0.1%',
    );
    assert.equal(
      savingsImpact({ ...row, before: 100000, after: 1, saved: 99999 }, window).percent,
      '99.9%',
    );
    assert.equal(savingsImpact({ ...row, after: 0, saved: 1200 }, window).percent, '100%');
    assert.equal(
      savingsImpact(
        { ...row, before: Number.MAX_SAFE_INTEGER, after: 1, saved: Number.MAX_SAFE_INTEGER - 1 },
        window,
      ).percent,
      '99.9%',
    );
  });
  it('exports only allowlisted source names, numeric aggregates and reporting dates', () => {
    const injected = {
      ...row,
      harnesses: [harnessId('private-project-name')],
      privatePath: '/secret/project',
      prompt: 'secret prompt',
    };
    const result = savingsImpact(injected, window);
    assert.doesNotMatch(
      JSON.stringify(result.share),
      /private-project-name|secret|privatePath|prompt/,
    );
    assert.equal(
      savingsImpact({ ...row, providerId: providerId('secret-source') }, window).share,
      null,
    );
    assert.equal(savingsImpact(row, { ...window, end: 'unknown' }).share, null);
    assert.match(
      savingsImpact(row, { ...window, all: true }).share!.window,
      /^Retained history through/,
    );
  });
});

function envelope(command: string, data: unknown): CliEnvelope<unknown> {
  return toEnvelope(commandResult({ command, data, exitCode: 0 }), 'test');
}
function reads() {
  const pending = new Map<
    string,
    { resolve: (value: CliEnvelope<unknown>) => void; reject: (reason: Error) => void }
  >();
  const calls: string[][] = [];
  const call: GuideCall = <T>(args: readonly string[]): Promise<CliEnvelope<T>> => {
    calls.push([...args]);
    return new Promise((resolve, reject) => {
      pending.set(args[0]!, { resolve: (value) => resolve(value as CliEnvelope<T>), reject });
    });
  };
  const service = new GuideService(
    call,
    () => Date.parse(window.end),
    () => 'ticket',
  );
  const finish = (command: string, data: unknown) =>
    pending.get(command)!.resolve(envelope(command, data));
  return { service, finish, pending, calls };
}
const doctor = {
  harnesses: [
    {
      harnessId: 'claude',
      state: 'configured',
      version: '2.1.261',
      configPath: '/private/settings.json',
    },
  ],
  providers: [
    {
      providerId: 'rtk',
      state: 'configured',
      version: '0.44.0',
      executable: '/tools/rtk',
      installationChannel: 'cargo',
      versionVerdict: 'in-range',
      configuredHarnesses: ['claude'],
      unmanagedHarnessesConfigured: [],
      supportsUnmanagedHarnesses: false,
      managedByTokenHarness: true,
      assignableHarnesses: ['claude'],
      evidence: [],
      warnings: [],
    },
  ],
};
const metrics = { providers: [row], windowStart: window.start, windowEnd: window.end };

describe('real section progress', () => {
  it('publishes completed savings and agent installation while the quota call is still pending', async () => {
    const f = reads(),
      result = f.service.overview('7d');
    assert.equal(
      f.service.status().loading!.stages.filter((step) => step.state === 'working').length,
      6,
    );
    f.finish('doctor', doctor);
    f.finish('savings', metrics);
    f.finish('status', { problemCount: 0 });
    f.finish('benchmark-matrix', { entries: [] });
    await setImmediate();
    const snapshot = f.service.status();
    assert.equal(snapshot.loading!.savings!.rows[0]!.impact.percent, '65%');
    assert.deepEqual(snapshot.loading!.agents![0]!.pending, ['reasoning', 'allowance']);
    assert.doesNotMatch(JSON.stringify(snapshot), /\/private/);
    snapshot.loading!.stages[0]!.state = 'working';
    assert.equal(f.service.status().loading!.stages[0]!.state, 'ready');
    f.finish('context', { harnesses: [] });
    await setImmediate();
    assert.deepEqual(f.service.status().loading!.agents![0]!.pending, ['allowance']);
    f.finish('budget', { harnesses: [] });
    const complete = await result;
    assert.equal(f.service.status().loading!.running, false);
    assert.deepEqual(complete.agents[0]!.pending, []);
    assert.deepEqual(f.calls.map((call) => call[0]).sort(), [
      'benchmark-matrix',
      'budget',
      'context',
      'doctor',
      'savings',
      'status',
    ]);
  });
  it('a broken observation becomes attention, not a forever spinner or a lost good result', async () => {
    const f = reads(),
      result = f.service.overview();
    f.finish('doctor', doctor);
    f.finish('savings', metrics);
    f.finish('status', { problemCount: 0 });
    f.finish('context', { harnesses: [] });
    f.finish('benchmark-matrix', { entries: [] });
    f.pending.get('budget')!.reject(new Error('/private/token=secret'));
    const complete = await result;
    assert.equal(complete.savings.rows[0]!.saved, 780);
    assert.equal(
      f.service.status().loading!.stages.find((step) => step.id === 'allowance')!.state,
      'attention',
    );
    assert.equal(f.service.status().loading!.running, false);
    assert.doesNotMatch(JSON.stringify(f.service.status()), /private|token=secret/);
  });
  it('reuses concurrent same-period reads, with no extra probes', async () => {
    const f = reads(),
      first = f.service.overview(),
      second = f.service.overview();
    f.finish('doctor', doctor);
    f.finish('savings', metrics);
    f.finish('status', { problemCount: 0 });
    f.finish('context', { harnesses: [] });
    f.finish('benchmark-matrix', { entries: [] });
    f.finish('budget', { harnesses: [] });
    assert.deepEqual(await first, await second);
    assert.equal(f.calls.length, 6);
  });
});
