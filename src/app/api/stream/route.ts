import { NextRequest, NextResponse } from 'next/server';
import { validateProxyUrl, getHeadersForUrl, buildCorsHeaders } from '@/lib/proxy-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

function isM3U8(url: string, contentType: string | null): boolean {
  return url.includes('.m3u8') || (contentType?.includes('mpegurl') || contentType?.includes('application/vnd.apple.mpegurl') || contentType?.includes('x-mpegURL') || false);
}

async function handleProxy(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');

  const validated = validateProxyUrl(urlParam);
  if (!validated) {
    return NextResponse.json({ error: 'Invalid or blocked URL' }, { status: 400, headers: buildCorsHeaders() });
  }

  const rangeHeader = request.headers.get('range');

  try {
    const upstreamHeaders: Record<string, string> = { ...getHeadersForUrl(validated) };
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

    if (validated.includes('.m3u8')) {
      delete upstreamHeaders['Range'];
    }

    const upstream = await fetch(validated, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });

    if (!upstream.ok && upstream.status !== 206) {
      return NextResponse.json(
        { error: `Upstream responded ${upstream.status}` },
        { status: upstream.status, headers: buildCorsHeaders() }
      );
    }

    const contentType = upstream.headers.get('content-type');
    const isHls = isM3U8(validated, contentType);

    if (isHls) {
      const text = await upstream.text();
      const baseUrl = validated;
      const rewritten = rewriteM3U8(text, baseUrl, request.nextUrl.origin);

      const cors = buildCorsHeaders();
      cors.set('Content-Type', 'application/vnd.apple.mpegurl');
      cors.set('Cache-Control', 'no-cache');
      cors.set('Content-Disposition', 'inline');
      cors.set('Accept-Ranges', 'bytes');

      return new NextResponse(rewritten, {
        status: 200,
        headers: cors,
      });
    }

    const headers = buildCorsHeaders();
    const ct = contentType || 'video/mp4';
    headers.set('Content-Type', ct);

    const cl = upstream.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);

    const cr = upstream.headers.get('content-range');
    if (cr) headers.set('Content-Range', cr);

    const ar = upstream.headers.get('accept-ranges');
    headers.set('Accept-Ranges', ar || 'bytes');

    headers.set('Content-Disposition', 'inline');
    headers.set('Cache-Control', 'public, max-age=3600');

    if (!upstream.body) {
      return NextResponse.json({ error: 'Empty upstream body' }, { status: 502, headers });
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    console.error('Stream proxy error:', err);
    const cors = buildCorsHeaders();
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return NextResponse.json({ error: 'Upstream timeout' }, { status: 504, headers: cors });
    }
    return NextResponse.json({ error: err.message || 'Proxy error' }, { status: 502, headers: cors });
  }
}

function rewriteM3U8(content: string, baseUrl: string, origin: string): string {
  const lines = content.split('\n');
  const rewritten = lines.map(line => {
    const trimmed = line.trim();
    if (!trimmed) return line;
    if (trimmed.startsWith('#')) return line;
    try {
      let absolute = trimmed;
      if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        absolute = new URL(trimmed, baseUrl).toString();
      }
      const proxyUrl = `${origin}/api/stream?url=${encodeURIComponent(absolute)}`;
      return proxyUrl;
    } catch {
      return line;
    }
  });
  return rewritten.join('\n');
}

export async function GET(request: NextRequest) {
  return handleProxy(request);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}

export async function HEAD(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');
  const validated = validateProxyUrl(urlParam);
  if (!validated) {
    return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
  }
  try {
    const upstream = await fetch(validated, {
      method: 'HEAD',
      headers: getHeadersForUrl(validated),
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
    });
    const headers = buildCorsHeaders();
    const ct = upstream.headers.get('content-type');
    if (ct) headers.set('Content-Type', ct);
    const cl = upstream.headers.get('content-length');
    if (cl) headers.set('Content-Length', cl);
    const ar = upstream.headers.get('accept-ranges');
    headers.set('Accept-Ranges', ar || 'bytes');
    return new NextResponse(null, { status: upstream.status, headers });
  } catch {
    return new NextResponse(null, { status: 502, headers: buildCorsHeaders() });
  }
}
