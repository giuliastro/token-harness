import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';

import type {
  GuideCandidateCampaignRequest,
  GuideCandidateCampaignStatus,
} from '../src/guided-candidate-campaign-status.js';
import { createGuideHandler } from '../src/guided-http.js';
import { GuideService, type GuideCall } from '../src/guided.js';

function emptyCall(): GuideCall {
  return async <T>(args: readonly string[]): Promise<CliEnvelope<T>> =>
    toEnvelope(
      commandResult({
        command: args[0] ?? 'test',
        exitCode: 0,
        data: null as T,
      }),
      'test',
    );
}

function status(input: GuideCandidateCampaignRequest): GuideCandidateCampaignStatus {
  return {
    available: true,
    ...input,
    completedPairs: 2,
    totalPairs: 6,
    invalidPairs: 0,
    progressPercent: 33,
    signal: 'insufficient-evidence',
    decisionReady: false,
    evidencePairs: 2,
    coveredTaskClasses: ['mechanical'],
    nextCommand: 'token-harness benchmark-start --variant baseline',
    nextInstruction: 'Run the next baseline task.',
    reasons: ['need more evidence'],
    promotionEligible: false,
    note: 'Selection evidence only.',
  };
}

async function get(
  port: number,
  authority: string,
  path: string,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method: 'GET',
        headers: { Host: authority, 'Sec-Fetch-Site': 'same-origin' },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ statusCode: response.statusCode ?? 0, body }));
      },
    );
    request.once('error', reject);
    request.end();
  });
}

describe('guided candidate campaign HTTP status', () => {
  it('accepts only a validated dashboard campaign and never accepts arbitrary argv', async () => {
    const service = new GuideService(
      emptyCall(),
      () => 0,
      () => 'ticket',
    );
    const seen: GuideCandidateCampaignRequest[] = [];
    let authority = '';
    const server = createServer(
      createGuideHandler({
        service,
        token: 'csrf',
        authority: () => authority,
        candidateCampaign: async (input) => {
          seen.push(input);
          return status(input);
        },
      }),
    );
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    authority = `127.0.0.1:${address.port}`;

    try {
      const valid = await get(
        address.port,
        authority,
        '/api/candidate-campaign?candidate=gitnexus&harness=codex&campaign=gitnexus-codex-eval-m123abc',
      );
      assert.equal(valid.statusCode, 200);
      assert.equal(JSON.parse(valid.body).progressPercent, 33);
      assert.deepEqual(seen, [
        {
          candidateId: 'gitnexus',
          harnessId: 'codex',
          campaignId: 'gitnexus-codex-eval-m123abc',
        },
      ]);

      const invalid = await get(
        address.port,
        authority,
        '/api/candidate-campaign?candidate=gitnexus&harness=codex&campaign=doctor--verbose',
      );
      assert.equal(invalid.statusCode, 400);
      assert.equal(seen.length, 1);
      assert.match(JSON.parse(invalid.body).error, /valid candidate campaign/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
