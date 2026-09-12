import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { describe, it } from 'node:test';

import { commandResult, toEnvelope, type CliEnvelope } from '@token-harness/core';

import type { GuideCandidateCampaignActionRequest } from '../src/guided-candidate-campaign-action.js';
import type {
  GuideCandidateCampaignController,
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
    evidenceCoveragePercent: 100,
    minimumEvidencePairs: 6,
    minimumTaskClasses: 3,
    minimumEvidenceCoveragePercent: 75,
    coveredTaskClasses: ['mechanical'],
    optimizedBetter: 1,
    baselineBetter: 0,
    equivalent: 1,
    localComparablePairs: 2,
    localTokenSavingPercent: 12.5,
    wallClockComparablePairs: 0,
    wallClockSavingPercent: null,
    hardRegressionPairs: 0,
    activationState: 'unreviewed',
    activationVerifiedPairs: 0,
    activationBlockedPairs: 0,
    activationUnknownPairs: 0,
    nextStep: {
      kind: 'start-baseline',
      benchmarkId: 'gitnexus-codex-eval-m123abc-m-1',
      taskClass: 'mechanical',
      run: 1,
      requiresActivationAcknowledgement: false,
    },
    nextCommand: 'token-harness benchmark-start --variant baseline',
    nextInstruction: 'Run the next baseline task.',
    reasons: ['need more evidence'],
    promotionEligible: false,
    promotionBlockers: ['the standard benchmark campaign is not complete'],
    promotionReadiness: null,
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

async function post(
  port: number,
  authority: string,
  body: unknown,
): Promise<{ statusCode: number; body: string }> {
  const encoded = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path: '/api/candidate-campaign/action',
        method: 'POST',
        headers: {
          Host: authority,
          Origin: `http://${authority}`,
          'Sec-Fetch-Site': 'same-origin',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(encoded),
          'X-Token-Harness-CSRF': 'csrf',
        },
      },
      (response) => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          responseBody += chunk;
        });
        response.on('end', () =>
          resolve({ statusCode: response.statusCode ?? 0, body: responseBody }),
        );
      },
    );
    request.once('error', reject);
    request.end(encoded);
  });
}

describe('guided candidate campaign HTTP boundary', () => {
  it('accepts only validated campaign reads and bounded current-step actions', async () => {
    const service = new GuideService(
      emptyCall(),
      () => 0,
      () => 'ticket',
    );
    const seen: GuideCandidateCampaignRequest[] = [];
    const actionSeen: GuideCandidateCampaignActionRequest[] = [];
    const campaign = (async (input: GuideCandidateCampaignRequest) => {
      seen.push(input);
      return status(input);
    }) as GuideCandidateCampaignController;
    campaign.action = async (input) => {
      actionSeen.push(input);
      return { ok: true, performed: input.expectedKind, status: status(input) };
    };

    let authority = '';
    const server = createServer(
      createGuideHandler({
        service,
        token: 'csrf',
        authority: () => authority,
        candidateCampaign: campaign,
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
      assert.equal(seen.length, 1);

      const actionBody = {
        candidateId: 'gitnexus',
        harnessId: 'codex',
        campaignId: 'gitnexus-codex-eval-m123abc',
        expectedKind: 'start-baseline',
        expectedBenchmarkId: 'gitnexus-codex-eval-m123abc-m-1',
        activationAcknowledged: false,
        outcome: null,
      };
      const actionResponse = await post(address.port, authority, actionBody);
      assert.equal(actionResponse.statusCode, 200);
      assert.equal(JSON.parse(actionResponse.body).performed, 'start-baseline');
      assert.equal(actionSeen.length, 1);

      const arbitrary = await post(address.port, authority, {
        ...actionBody,
        argv: ['doctor', '--verbose'],
      });
      assert.equal(arbitrary.statusCode, 400);
      assert.equal(actionSeen.length, 1);
      assert.match(JSON.parse(arbitrary.body).error, /current guided campaign step/);

      const invalid = await get(
        address.port,
        authority,
        '/api/candidate-campaign?candidate=gitnexus&harness=codex&campaign=doctor--verbose',
      );
      assert.equal(invalid.statusCode, 400);
      assert.match(JSON.parse(invalid.body).error, /valid candidate campaign/);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
