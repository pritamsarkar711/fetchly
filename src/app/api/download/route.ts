import { NextRequest, NextResponse } from 'next/server';
import { buildCorsHeaders, getHeadersForUrl, sanitizeFilename, validateProxyUrl } from '@/lib/proxy-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

const HEADER_TIMEOUT = 25_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

class UpstreamTimeoutError extends Error {
  constructor() {
    super('Upstream timeout');
    this.name = 'UpstreamTimeoutError';
  }
}

async function fetchUpstream(
  url: string,
  referrer: string | null,
  range?: string | null,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<Response> {
  let currentUrl = url;

  for (let redirects = 0; redirects < 5; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT);
    const headers = getHeadersForUrl(currentUrl, referrer);
    if (range && method === 'GET') headers.Range = range;

    let response: Response;
    try {
      response = await fetch(currentUrl, { method, headers, redirect: 'manual', signal: controller.signal });
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new UpstreamTimeoutError();
      throw error;
    } finally {
      // Do not abort a response body after headers arrive: this previously
      // cut off larger files and appeared to browsers as an unknown failure.
      clearTimeout(timer);
    }

    if (!REDIRECT_STATUSES.has(response.status)) return response;
    const location = response.headers.get('location');
    const nextUrl = location ? validateProxyUrl(new URL(location, currentUrl).toString()) : null;
    if (!nextUrl) throw new Error('Unsafe or invalid redirect from source');
    currentUrl = nextUrl;
  }

  throw new Error('Too many redirects from source');
}

function responseHeaders(upstream: Response, filename: string): Headers {
  const headers = buildCorsHeaders();
  headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream');

  for (const [upstreamHeader, responseHeader] of [
    ['content-length', 'Content-Length'],
    ['content-range', 'Content-Range'],
    ['etag', 'ETag'],
    ['last-modified', 'Last-Modified'],
  ] as const) {
    const value = upstream.headers.get(upstreamHeader);
    if (value) headers.set(responseHeader, value);
  }

  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
  headers.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Range');
  return headers;
}

export async function GET(request: NextRequest) {
  const sourceUrl = validateProxyUrl(request.nextUrl.searchParams.get('url'));
  const referrer = validateProxyUrl(request.nextUrl.searchParams.get('ref'));
  const filename = sanitizeFilename(request.nextUrl.searchParams.get('filename') || request.nextUrl.searchParams.get('title'), 'video.mp4');

  if (!sourceUrl) {
    return NextResponse.json({ error: 'Invalid video URL' }, { status: 400, headers: buildCorsHeaders() });
  }

  try {
    const upstream = await fetchUpstream(sourceUrl, referrer, request.headers.get('range'));
    if (!upstream.ok && upstream.status !== 206) {
      const message = upstream.status === 403 ? 'Source access was denied' : `Source returned ${upstream.status}`;
      return NextResponse.json({ error: message }, { status: upstream.status, headers: buildCorsHeaders() });
    }
    if (!upstream.body) {
      return NextResponse.json({ error: 'Empty response from source' }, { status: 502, headers: buildCorsHeaders() });
    }

    return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders(upstream, filename) });
  } catch (error: unknown) {
    console.error('Download proxy error:', error instanceof Error ? error.message : error);
    const status = error instanceof UpstreamTimeoutError ? 504 : 502;
    return NextResponse.json({ error: status === 504 ? 'Source timed out' : 'Could not reach source' }, { status, headers: buildCorsHeaders() });
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders() });
}

export async function HEAD(request: NextRequest) {
  const sourceUrl = validateProxyUrl(request.nextUrl.searchParams.get('url'));
  const referrer = validateProxyUrl(request.nextUrl.searchParams.get('ref'));
  const filename = sanitizeFilename(request.nextUrl.searchParams.get('filename'), 'video.mp4');
  if (!sourceUrl) return NextResponse.json({ error: 'Invalid video URL' }, { status: 400, headers: buildCorsHeaders() });

  try {
    const upstream = await fetchUpstream(sourceUrl, referrer, null, 'HEAD');
    return new NextResponse(null, { status: upstream.status, headers: responseHeaders(upstream, filename) });
  } catch {
    return new NextResponse(null, { status: 502, headers: buildCorsHeaders() });
  }
}
