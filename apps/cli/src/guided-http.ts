/** Strict loopback-only browser control. No user-supplied commands or paths. */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OptimizationCandidateObservation } from '@token-harness/core';
import { guidedCandidateObservation } from './guided-candidate-readiness.js';
import { GuideError, type GuideOverview, type GuideService, type GuidePeriod } from './guided.js';
import { GUIDE_CSS, GUIDE_HTML, GUIDE_JS, GUIDE_STACK_JS } from './guided-assets.js';

export const GUIDE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};

const OVERVIEW_CACHE_MS = 5 * 60_000;

function equalToken(value: string | string[] | undefined, expected: string): boolean {
  if (typeof value !== 'string' || value.length !== expected.length) return false;
  const actual = Buffer.from(value);
  const token = Buffer.from(expected);
  return actual.length === token.length && timingSafeEqual(actual, token);
}
async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type'] !== 'application/json')
    throw new GuideError(415, 'JSON is required.');
  if (Number(request.headers['content-length'] ?? 0) > 8_192)
    throw new GuideError(413, 'Request too large.');
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += buffer.length;
    if (length > 8_192) throw new GuideError(413, 'Request too large.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new GuideError(400, 'Invalid request. Refresh the page and try again.');
  }
}

function stackNextAction(
  component: GuideOverview['stack']['components'][number],
): GuideOverview['stack']['components'][number]['nextAction'] {
  if (component.health === 'attention') {
    return {
      kind: 'review-health',
      reason: 'The current evidence reports a broken, degraded, conflicting, or unsafe state.',
    };
  }
  if (component.detectedState === 'absent' || component.detectedState === 'available') {
    return {
      kind: 'install-configure',
      reason: 'This optimization component is not installed and configured yet.',
    };
  }
  if (component.detectedState === 'installed') {
    return {
      kind: 'configure',
      reason: 'The component is installed but not configured for an agent.',
    };
  }
  if (component.detectedState === 'configured' && component.verification === 'not-checked') {
    return {
      kind: 'verify',
      reason: 'Configuration was found, but runtime verification has not been checked.',
    };
  }
  if (component.detectedState === 'configured' && component.verification === 'not-exercised') {
    return {
      kind: 'verify',
      reason: 'The integration is configured but has not produced enough execution evidence yet.',
    };
  }
  if (component.update === 'available' || component.update === 'blocked') {
    return {
      kind: 'review-update',
      reason:
        component.update === 'available'
          ? 'A newer provider version is available for review.'
          : 'A newer version exists but is outside the currently reviewed compatibility range.',
    };
  }
  if (component.health === 'healthy' && component.savings.length === 0) {
    return {
      kind: 'measure',
      reason:
        'The integration is healthy; keep using it normally so measured savings evidence can accumulate.',
    };
  }
  return null;
}

function mergeVerifiedStack(
  cached: GuideOverview['stack'],
  observed: GuideOverview['stack'],
): GuideOverview['stack'] {
  const observedByProvider = new Map(
    observed.components.map((component) => [component.providerId, component]),
  );
  const components = cached.components.map((component) => {
    const current = observedByProvider.get(component.providerId);
    if (current === undefined) return component;
    const health: GuideOverview['stack']['components'][number]['health'] =
      current.health === 'attention' ||
      component.quality.state === 'regressed' ||
      component.conflicts.length > 0
        ? 'attention'
        : current.detectedState === 'configured' && current.verification === 'verified'
          ? 'healthy'
          : 'unknown';
    const merged: GuideOverview['stack']['components'][number] = {
      ...component,
      detectedState: current.detectedState,
      version: current.version,
      installed: current.installed,
      configured: current.configured,
      configuredHarnesses: [...current.configuredHarnesses],
      managedByTokenHarness: current.managedByTokenHarness,
      verification: current.verification,
      health,
      warnings: [...current.warnings],
    };
    return { ...merged, nextAction: stackNextAction(merged) };
  });
  const present = components.filter((component) => component.detectedState !== 'absent');
  const state: GuideOverview['stack']['state'] =
    present.length === 0
      ? 'empty'
      : present.some((component) => component.health === 'attention') ||
          cached.unattributedDrift.length > 0
        ? 'attention'
        : present.every(
              (component) =>
                component.health === 'healthy' &&
                component.nextAction === null &&
                (component.update === 'current' || component.update === 'pinned'),
            )
          ? 'healthy'
          : 'incomplete';
  return { components, unattributedDrift: [...cached.unattributedDrift], state };
}

function mergeUpdatedStack(
  cached: GuideOverview['stack'],
  observed: GuideOverview['stack'],
): GuideOverview['stack'] {
  const observedByProvider = new Map(
    observed.components.map((component) => [component.providerId, component]),
  );
  const components = cached.components.map((component) => {
    const current = observedByProvider.get(component.providerId);
    if (current === undefined) return component;
    const detectionChanged =
      component.version !== current.version ||
      component.detectedState !== current.detectedState ||
      component.configured !== current.configured ||
      component.configuredHarnesses.join('\0') !== current.configuredHarnesses.join('\0');
    const verification = detectionChanged ? current.verification : component.verification;
    const health: GuideOverview['stack']['components'][number]['health'] =
      current.health === 'attention' ||
      component.quality.state === 'regressed' ||
      component.conflicts.length > 0
        ? 'attention'
        : current.detectedState === 'configured' && verification === 'verified'
          ? 'healthy'
          : 'unknown';
    const merged: GuideOverview['stack']['components'][number] = {
      ...component,
      detectedState: current.detectedState,
      version: current.version,
      installed: current.installed,
      configured: current.configured,
      configuredHarnesses: [...current.configuredHarnesses],
      managedByTokenHarness: current.managedByTokenHarness,
      verification,
      health,
      update: current.update,
      updateAvailableVersion: current.updateAvailableVersion,
      warnings: [...current.warnings],
    };
    return { ...merged, nextAction: stackNextAction(merged) };
  });
  const present = components.filter((component) => component.detectedState !== 'absent');
  const state: GuideOverview['stack']['state'] =
    present.length === 0
      ? 'empty'
      : present.some((component) => component.health === 'attention') ||
          cached.unattributedDrift.length > 0
        ? 'attention'
        : present.every(
              (component) =>
                component.health === 'healthy' &&
                component.nextAction === null &&
                (component.update === 'current' || component.update === 'pinned'),
            )
          ? 'healthy'
          : 'incomplete';
  return { components, unattributedDrift: [...cached.unattributedDrift], state };
}

export function createGuideHandler(input: {
  service: GuideService;
  token: string;
  authority: () => string;
  optimizationCandidates?: () => readonly OptimizationCandidateObservation[];
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const overviewCache = new Map<GuidePeriod, { at: number; body: string }>();

  return async (request, response) => {
    const send = (status: number, body: string, type = 'application/json; charset=utf-8'): void => {
      response.writeHead(status, { ...GUIDE_SECURITY_HEADERS, 'Content-Type': type });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      const authority = input.authority();
      const origin = `http://${authority}`;
      const peer = request.socket.remoteAddress;
      if (
        !['127.0.0.1', '::ffff:127.0.0.1'].includes(peer ?? '') ||
        request.headers.host !== authority ||
        (request.headers.origin !== undefined && request.headers.origin !== origin) ||
        (request.headers['sec-fetch-site'] !== undefined &&
          !['same-origin', 'none'].includes(String(request.headers['sec-fetch-site'])))
      )
        throw new GuideError(403, 'Only this local dashboard can access these controls.');
      const url = new URL(request.url ?? '/', origin);
      const reading = request.method === 'GET' || request.method === 'HEAD';
      if (reading) {
        if (url.pathname === '/') {
          send(200, GUIDE_HTML, 'text/html; charset=utf-8');
          return;
        }
        if (url.pathname === '/guide.css') {
          send(200, GUIDE_CSS, 'text/css; charset=utf-8');
          return;
        }
        if (url.pathname === '/stack.js') {
          send(200, GUIDE_STACK_JS, 'text/javascript; charset=utf-8');
          return;
        }
        if (url.pathname === '/guide.js') {
          send(200, GUIDE_JS, 'text/javascript; charset=utf-8');
          return;
        }
        if (url.pathname === '/api/session') {
          send(200, JSON.stringify({ token: input.token }));
          return;
        }
        if (url.pathname === '/api/activity') {
          send(200, JSON.stringify(input.service.status()));
          return;
        }
        if (url.pathname === '/api/overview') {
          const period = url.searchParams.get('period') ?? 'all';
          if (!['all', '7d', '30d'].includes(period))
            throw new GuideError(400, 'Unknown reporting period.');
          const guidePeriod = period as GuidePeriod;
          const force = url.searchParams.get('refresh') === '1';
          const cached = overviewCache.get(guidePeriod);
          if (!force && cached !== undefined && Date.now() - cached.at < OVERVIEW_CACHE_MS) {
            send(200, cached.body);
            return;
          }
          const overview = await input.service.overview(guidePeriod, force);
          const body = JSON.stringify({
            ...overview,
            optimizationCandidates: (input.optimizationCandidates?.() ?? []).map(
              guidedCandidateObservation,
            ),
          });
          overviewCache.set(guidePeriod, { at: Date.now(), body });
          send(200, body);
          return;
        }
        send(404, '{"error":"Not found"}');
        return;
      }
      if (request.method !== 'POST') throw new GuideError(405, 'Method not allowed.');
      if (
        request.headers.origin !== origin ||
        !equalToken(request.headers['x-token-harness-csrf'], input.token)
      )
        throw new GuideError(403, 'Refresh this dashboard before approving a change.');
      const body = await readBody(request);
      if (url.pathname === '/api/preview') {
        send(200, JSON.stringify(await input.service.preview(body)));
        return;
      }
      if (url.pathname === '/api/apply') {
        const result = await input.service.apply(body);
        overviewCache.clear();
        send(200, JSON.stringify(result));
        return;
      }
      if (url.pathname === '/api/update-check') {
        if (body === null || typeof body !== 'object' || Array.isArray(body))
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const data = body as Record<string, unknown>;
        if (
          Object.keys(data).some((key) => key !== 'period') ||
          (data['period'] !== undefined && !['all', '7d', '30d'].includes(String(data['period'])))
        )
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const result = await input.service.checkUpdates();
        const requested = data['period'] as GuidePeriod | undefined;
        let responseResult = result;
        if (result.stack !== undefined && requested !== undefined) {
          const cached = overviewCache.get(requested);
          if (cached !== undefined) {
            const overview = JSON.parse(cached.body) as GuideOverview;
            const stack = mergeUpdatedStack(overview.stack, result.stack);
            overviewCache.set(requested, {
              ...cached,
              body: JSON.stringify({ ...overview, stack }),
            });
            responseResult = { ...result, stack };
          }
        }
        // Update discovery is intentionally on-demand and read-only. Keep all other period-specific
        // evidence hot; only the stack update/version fields are replaced.
        send(200, JSON.stringify(responseResult));
        return;
      }
      if (url.pathname === '/api/verify') {
        if (body === null || typeof body !== 'object' || Array.isArray(body))
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const data = body as Record<string, unknown>;
        if (
          Object.keys(data).some((key) => key !== 'period') ||
          (data['period'] !== undefined && !['all', '7d', '30d'].includes(String(data['period'])))
        )
          throw new GuideError(400, 'Only an optional reporting period is accepted.');
        const result = await input.service.verify();
        const requested = data['period'] as GuidePeriod | undefined;
        let responseResult = result;
        if (result.stack !== undefined && requested !== undefined) {
          const cached = overviewCache.get(requested);
          if (cached !== undefined) {
            const overview = JSON.parse(cached.body) as GuideOverview;
            const stack = mergeVerifiedStack(overview.stack, result.stack);
            overviewCache.set(requested, {
              ...cached,
              body: JSON.stringify({ ...overview, stack }),
            });
            responseResult = { ...result, stack };
          }
        }
        // Verification is read-only. Keep the active period's already-loaded overview hot and
        // replace only its verification-dependent stack fields. Period-specific savings stay with
        // their original window; allowance, context, metrics and benchmark collection are not
        // repeated. Explicit Refresh data still forces a full read through both cache layers.
        send(200, JSON.stringify(responseResult));
        return;
      }
      send(404, '{"error":"Not found"}');
    } catch (error) {
      send(
        error instanceof GuideError ? error.status : 500,
        JSON.stringify({
          error:
            error instanceof GuideError
              ? error.message
              : 'The operation could not finish. No automatic retry was made. Refresh and check the current state.',
        }),
      );
    }
  };
}
