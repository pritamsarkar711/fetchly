/** Shared utilities for the stream and download proxies. */

export const BLOCKED_HOSTS = [
  'localhost', '127.', '0.', '::1', '[::1]',
  '10.', '100.64.', '169.254.', '192.0.0.', '192.0.2.', '192.168.',
  '198.18.', '198.19.', '203.0.113.',
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.', '172.21.',
  '172.22.', '172.23.', '172.24.', '172.25.', '172.26.', '172.27.',
  '172.28.', '172.29.', '172.30.', '172.31.',
];

export function isInternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    const privateIpv6 = hostname.includes(':') && /^(?:fc|fd|fe80:)/.test(hostname);
    return privateIpv6 || BLOCKED_HOSTS.some(blocked => hostname === blocked || hostname.startsWith(blocked));
  } catch {
    return true;
  }
}

export function validateProxyUrl(input: string | null, maxLength = 5000): string | null {
  if (!input || typeof input !== 'string') return null;
  let normalized = input.trim();
  if (normalized.length > maxLength) return null;
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;

  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) return null;
    if (parsed.username || parsed.password || isInternalUrl(parsed.toString())) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * A referrer supplied by the parser is only used as a request header.  Reduce
 * it to an origin so signed media URLs don't leak page paths or query tokens.
 */
function pageOrigin(referrer?: string | null): string | null {
  if (!referrer) return null;
  const valid = validateProxyUrl(referrer);
  if (!valid) return null;

  try {
    const parsed = new URL(valid);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return null;
  }
}

export function sanitizeFilename(input: string | null, fallback = 'video.mp4'): string {
  let name = (input || fallback).trim();
  name = name.split('/').pop()?.split('\\').pop() || fallback;
  name = name.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  if (!name.includes('.')) name += '.mp4';
  if (name.length > 150) {
    const ext = name.split('.').pop();
    name = `${name.slice(0, 100)}.${ext}`;
  }
  return name;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function inferredReferrer(upstreamUrl: string): string {
  const lower = upstreamUrl.toLowerCase();

  if (lower.includes('tnmr.org') || lower.includes('luluvdo') || lower.includes('lulustream') || lower.includes('luluvid')) {
    return 'https://luluvdo.com/';
  }
  if (lower.includes('firestream')) return 'https://firestream.to/';
  if (lower.includes('playmate')) return 'https://playmate.to/';
  if (lower.includes('vidara')) return 'https://vidara.to/';
  if (lower.includes('mxcontent') || lower.includes('mxdcontent') || lower.includes('mixdrop')) return 'https://mixdrop.co/';
  if (lower.includes('streamtape') || lower.includes('strtape')) return 'https://streamtape.com/';

  try {
    const parsed = new URL(upstreamUrl);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://example.com/';
  }
}

/**
 * Hosts frequently reject requests when Origin is forged or when the media CDN
 * is given its own URL as the referrer.  We send a normal browser-like Referer
 * only; individual sources pass the page that produced the media URL.
 */
export function getHeadersForUrl(upstreamUrl: string, referrer?: string | null): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.8',
    'Referer': pageOrigin(referrer) || inferredReferrer(upstreamUrl),
    'Cache-Control': 'no-cache',
  };
}

export function buildCorsHeaders(): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Referer, User-Agent, Accept-Language');
  headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');
  return headers;
}

export function isLikelyHlsUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return path.endsWith('.m3u8') || (path.endsWith('.txt') && /\/(?:hls|hls2)\//.test(path));
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(url);
  }
}
