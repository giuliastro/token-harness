import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  harnessId,
  providerId,
  type ChannelMeasurementClassRow,
  type MetricsReport,
} from '@token-harness/core';

import { renderMetricsReport } from '../src/render/metrics.js';

const EMPTY_CLASSES: ChannelMeasurementClassRow[] = [
  {
    class: 'exact-local',
    unit: null,
    before: null,
    after: null,
    saved: null,
    operations: 0,
    note: 'none measured',
  },
  {
    class: 'estimated-local',
    unit: null,
    before: null,
    after: null,
    saved: null,
    operations: 0,
    note: 'none measured',
  },
  {
    class: 'counterfactual',
    unit: null,
    before: null,
    after: null,
    saved: null,
    operations: 0,
    note: 'not a realized channel saving',
  },
  {
    class: 'end-to-end-billed',
    unit: null,
    before: null,
    after: null,
    saved: null,
    operations: 0,
    note: 'no A/B run',
  },
];

function report(): MetricsReport {
  return {
    windowStart: '2026-08-21',
    windowEnd: '2026-08-28',
    pipelineId: null,
    classes: [
      {
        class: 'exact-local',
        unit: null,
        before: null,
        after: null,
        saved: null,
        note: 'none recorded',
      },
      {
        class: 'estimated-local',
        unit: null,
        before: null,
        after: null,
        saved: null,
        note: 'none recorded',
      },
      {
        class: 'counterfactual',
        unit: null,
        before: null,
        after: null,
        saved: null,
        note: 'none recorded',
      },
      {
        class: 'end-to-end-billed',
        unit: null,
        before: null,
        after: null,
        saved: null,
        note: 'no A/B run',
      },
    ],
    providers: [],
    channels: [
      {
        pipelineId: 'pipe-1',
        harness: harnessId('claude'),
        toolFamily: 'Bash',
        capability: 'shell.output.reduce',
        owners: [providerId('alpha'), providerId('beta')],
        status: 'measured',
        operations: 2,
        incomparableOperations: 0,
        unattributedOperations: 0,
        incomparableReasons: [],
        classes: [
          {
            ...EMPTY_CLASSES[0]!,
            unit: 'tokens',
            before: 2000,
            after: 400,
            saved: 1600,
            operations: 2,
            note: null,
          },
          ...EMPTY_CLASSES.slice(1),
        ],
        note: null,
      },
      {
        pipelineId: 'pipe-2',
        harness: harnessId('codex'),
        toolFamily: 'shell',
        capability: 'shell.output.reduce',
        owners: [providerId('rtk')],
        status: 'attribution-unavailable',
        operations: 0,
        incomparableOperations: 0,
        unattributedOperations: 4118,
        incomparableReasons: [],
        classes: [...EMPTY_CLASSES],
        note: '4118 provider operations may belong here but do not carry enough pipeline identity to attribute safely',
      },
    ],
    pipelineTotal: {
      status: 'unavailable',
      reason: 'channel-residue',
      class: null,
      unit: null,
      before: null,
      after: null,
      saved: null,
      channels: 2,
      note: 'some channel operations are incomparable or lack safe pipeline attribution',
    },
    coveragePercent: null,
    bypassed: 0,
    inflatedOperations: 0,
    errors: 0,
    addedMedianLatencyMs: null,
  };
}

describe('metrics channel rendering', () => {
  it('shows raw-to-final channel state separately from marginal provider rows', () => {
    const rendered = renderMetricsReport(report(), {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    assert.match(rendered, /^Observed by measurement class \(provider events\)$/m);
    assert.match(rendered, /^By channel \(raw to final\)$/m);
    assert.match(rendered, /alpha -> beta - measured/);
    assert.match(rendered, /Exact local: saved 1,600 tokens across 2 operations/);
    assert.match(rendered, /rtk - attribution-unavailable/);
    assert.match(rendered, /do not carry enough pipeline\s+identity/);
    assert.match(rendered, /^Pipeline total$/m);
    assert.match(rendered, /unavailable - some channel operations are incomparable/);
    assert.match(rendered, /reason: channel-residue/);
    assert.match(rendered, /^By provider \(marginal\)$/m);
  });

  it('keeps every rendered line within the terminal contract', () => {
    const rendered = renderMetricsReport(report(), {
      toolVersion: 'test',
      home: null,
      decorate: false,
    });

    const channelBlock = rendered
      .split('By channel (raw to final)\n')[1]
      ?.split('\nBy provider (marginal)')[0];
    assert.ok(channelBlock);

    for (const line of channelBlock.trimEnd().split('\n')) {
      assert.ok(line.length <= 78, `channel line is ${String(line.length)} chars: ${line}`);
    }
  });
});
