import { NextRequest, NextResponse } from 'next/server';
import { buildCorsHeaders, getHeadersForUrl, isLikelyHlsUrl, validateProxyUrl } from '@/lib/proxy-utils';

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
  allowRange = true,
  method: 'GET' | 'HEAD' = 'GET',
): Promise<Response> {
  let currentUrl = url;

  for (let redirects = 0; redirects < 5; redirects += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEADER_TIMEOUT);
    const headers = getHeadersForUrl(currentUrl, referrer);
    if (range && allowRange) headers.Range = range;

    let response: Response;
    try {
      response = await fetch(currentUrl, {
        method,
        headers,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new UpstreamTimeoutError();
      throw error;
    } finally {
      // The timeout protects time-to-first-byte only. Keeping it alive aborts
      // legitimate long downloads after 25 seconds.
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

function isM3U8(contentType: string | null, sourceUrl: string, content?: string): boolean {
  const type = contentType?.toLowerCase() || '';
  return isLikelyHlsUrl(sourceUrl) || type.includes('mpegurl') || type.includes('vnd.apple.mpegurl') || Boolean(content?.trimStart().startsWith('#EXTM3U'));
}

function proxyUrl(target: string, origin: string, referrer: string | null): string {
  const params = new URLSearchParams({ url: target });
  if (referrer) params.set('ref', referrer);
  return `${origin}/api/stream?${params.toString()}`;
}

function rewriteUri(value: string, baseUrl: string, origin: string, referrer: string | null): string {
  try {
    return proxyUrl(new URL(value, baseUrl).toString(), origin, referrer);
  } catch {
    return value;
  }
}

/** Rewrite both media lines and URI attributes (keys, maps and renditions). */
function rewriteM3U8(content: string, baseUrl: string, origin: string, referrer: string | null): string {
  return content.split(/\r?\n/).map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    if (trimmed.startsWith('#')) {
      return line.replace(/URI=("([^"]*)"|'([^']*)'|([^,\s]*))/gi, (match, value: string, doubleQuoted: string, singleQuoted: string, bare: string) => {
        const raw = doubleQuoted ?? singleQuoted ?? bare;
        const rewritten = rewriteUri(raw, baseUrl, origin, referrer);
        const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
        return `URI=${quote}${rewritten}${quote}`;
      });
    }

    return rewriteUri(trimmed, baseUrl, origin, referrer);
  }).join('\n');
}

function proxyHeaders(upstream: Response, disposition: 'inline' | 'attachment' = 'inline'): Headers {
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
  headers.set('Content-Disposition', disposition);
  headers.set('Cache-Control', 'no-store');
  headers.set('Vary', 'Range');
  return headers;
}

async function handleProxy(request: NextRequest) {
  const sourceUrl = validateProxyUrl(request.nextUrl.searchParams.get('url'));
  const referrer = validateProxyUrl(request.nextUrl.searchParams.get('ref'));

  if (!sourceUrl) {
    return NextResponse.json({ error: 'Invalid video URL' }, { status: 400, headers: buildCorsHeaders() });
  }

  try {
    const upstream = await fetchUpstream(sourceUrl, referrer, request.headers.get('range'), !isLikelyHlsUrl(sourceUrl));
    if (!upstream.ok && upstream.status !== 206) {
      const message = upstream.status === 403 ? 'Source access was denied' : `Source returned ${upstream.status}`;
      return NextResponse.json({ error: message }, { status: upstream.status, headers: buildCorsHeaders() });
    }

    const contentType = upstream.headers.get('content-type');
    let manifest: string | null = null;

    // Some hosts serve an HLS playlist as .txt or text/plain. Detect the
    // playlist itself rather than relying on the extension alone.
    if (isM3U8(contentType, sourceUrl)) {
      manifest = await upstream.text();
    } else if ((contentType || '').toLowerCase().startsWith('text/')) {
      const candidate = await upstream.clone().text();
      if (candidate.trimStart().startsWith('#EXTM3U')) manifest = candidate;
    }

    if (manifest !== null && manifest.trimStart().startsWith('#EXTM3U')) {
      const headers = buildCorsHeaders();
      headers.set('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
      headers.set('Content-Disposition', 'inline');
      headers.set('Cache-Control', 'no-store');
      headers.set('Accept-Ranges', 'bytes');
      return new NextResponse(rewriteM3U8(manifest, sourceUrl, request.nextUrl.origin, referrer), { headers });
    }

    if (manifest !== null && isM3U8(contentType, sourceUrl)) {
      return NextResponse.json({ error: 'Source did not return an HLS playlist' }, { status: 502, headers: buildCorsHeaders() });
    }

    if (!upstream.body) {
      return NextResponse.json({ error: 'Empty response from source' }, { status: 502, headers: buildCorsHeaders() });
    }

    return new NextResponse(upstream.body, { status: upstream.status, headers: proxyHeaders(upstream) });
  } catch (error: unknown) {
    console.error('Stream proxy error:', error instanceof Error ? error.message : error);
    const status = error instanceof UpstreamTimeoutError ? 504 : 502;
    return NextResponse.json({ error: status === 504 ? 'Source timed out' : 'Could not reach source' }, { status, headers: buildCorsHeaders() });
  }
}

export async function GET(request: NextRequest) {
  return handleProxy(request);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: buildCorsHeaders() });
}

export async function HEAD(request: NextRequest) {
  const sourceUrl = validateProxyUrl(request.nextUrl.searchParams.get('url'));
  const referrer = validateProxyUrl(request.nextUrl.searchParams.get('ref'));
  if (!sourceUrl) return NextResponse.json({ error: 'Invalid video URL' }, { status: 400, headers: buildCorsHeaders() });

  try {
    const upstream = await fetchUpstream(sourceUrl, referrer, null, false, 'HEAD');
    return new NextResponse(null, { status: upstream.status, headers: proxyHeaders(upstream) });
  } catch {
    return new NextResponse(null, { status: 502, headers: buildCorsHeaders() });
  }
}
