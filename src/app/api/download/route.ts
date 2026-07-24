import { NextRequest, NextResponse } from 'next/server';
import { validateProxyUrl, COMMON_HEADERS, buildCorsHeaders, sanitizeFilename } from '@/lib/proxy-utils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const urlParam = request.nextUrl.searchParams.get('url');
  const filenameParam = request.nextUrl.searchParams.get('filename') || request.nextUrl.searchParams.get('title');

  const validated = validateProxyUrl(urlParam);
  if (!validated) {
    return NextResponse.json({ error: 'Invalid or blocked URL' }, { status: 400, headers: buildCorsHeaders() });
  }

  const filename = sanitizeFilename(filenameParam, 'video.mp4');
  const rangeHeader = request.headers.get('range');

  try {
    const upstreamHeaders: Record<string, string> = { ...COMMON_HEADERS };
    if (rangeHeader) upstreamHeaders['Range'] = rangeHeader;

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

    if (!upstream.body) {
      return NextResponse.json({ error: 'Empty upstream body' }, { status: 502, headers: buildCorsHeaders() });
    }

    const headers = buildCorsHeaders();

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    headers.set('Content-Type', contentType);

    const contentLength = upstream.headers.get('content-length');
    if (contentLength) headers.set('Content-Length', contentLength);

    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);

    const acceptRanges = upstream.headers.get('accept-ranges');
    headers.set('Accept-Ranges', acceptRanges || 'bytes');

    // Force download
    headers.set('Content-Disposition', `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    headers.set('Cache-Control', 'private, max-age=0, must-revalidate');

    return new NextResponse(upstream.body, {
      status: upstream.status,
      headers,
    });
  } catch (err: any) {
    console.error('Download proxy error:', err);
    const cors = buildCorsHeaders();
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return NextResponse.json({ error: 'Upstream timeout' }, { status: 504, headers: cors });
    }
    return NextResponse.json({ error: err.message || 'Proxy error' }, { status: 502, headers: cors });
  }
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
      headers: COMMON_HEADERS,
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
    const fn = sanitizeFilename(request.nextUrl.searchParams.get('filename'), 'video.mp4');
    headers.set('Content-Disposition', `attachment; filename="${fn}"`);
    return new NextResponse(null, { status: upstream.status, headers });
  } catch {
    return new NextResponse(null, { status: 502, headers: buildCorsHeaders() });
  }
}
