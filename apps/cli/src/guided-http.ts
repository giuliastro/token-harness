/** Strict loopback-only browser control. No user-supplied commands or paths. */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { GuideError, type GuideService, type GuidePeriod } from './guided.js';
import { GUIDE_CSS, GUIDE_HTML, GUIDE_JS } from './guided-assets.js';

export const GUIDE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
};
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
export function createGuideHandler(input: {
  service: GuideService;
  token: string;
  authority: () => string;
}): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
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
          send(200, JSON.stringify(await input.service.overview(period as GuidePeriod)));
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
        send(200, JSON.stringify(await input.service.apply(body)));
        return;
      }
      if (url.pathname === '/api/verify') {
        if (
          body === null ||
          typeof body !== 'object' ||
          Array.isArray(body) ||
          Object.keys(body).length !== 0
        )
          throw new GuideError(400, 'No command parameters are accepted.');
        send(200, JSON.stringify(await input.service.verify()));
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
