import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/** Shared validation and request helpers for untrusted media URLs. */

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443']);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DNS_TIMEOUT = 3_000;

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 203 && b === 0);
}

/** IPv6 loopback, private, link-local, mapped, documentation and multicast ranges. */
function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === '::' || normalized === '::1' ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:') || normalized.startsWith('2001:db8') || normalized.startsWith('ff');
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version === 6) return isPrivateIpv6(address);
  return true;
}

/** Reject malformed, credentialed, local-network and unusual-port URLs. */
export function validateProxyUrl(input: string | null, maxLength = 5000): string | null {
  if (!input || typeof input !== 'string') return null;
  let normalized = input.trim();
  if (normalized.length > maxLength) return null;
  if (normalized.startsWith('//')) normalized = `https:${normalized}`;

  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!hostname || (!hostname.includes('.') && isIP(hostname) === 0)) return null;
    if (parsed.username || parsed.password || !ALLOWED_PORTS.has(parsed.port)) return null;
    if (isIP(hostname) > 0 && isPrivateAddress(hostname)) return null;
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Resolve a hostname before connecting. A name resolving to any local/private
 * address is rejected, which protects the fetch, stream and download routes
 * from hostname and redirect based SSRF attacks.
 */
export async function validatePublicUrl(input: string | null, maxLength = 5000): Promise<string | null> {
  const validated = validateProxyUrl(input, maxLength);
  if (!validated) return null;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const hostname = new URL(validated).hostname.replace(/^\[|\]$/g, '');
    if (isIP(hostname) > 0) return validated;

    const addresses = await Promise.race([
      lookup(hostname, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS lookup timed out')), DNS_TIMEOUT);
      }),
    ]);

    if (!addresses.length || addresses.some(entry => isPrivateAddress(entry.address))) return null;
    return validated;
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Fetch an untrusted public URL without allowing redirects to bypass URL/DNS
 * checks. The caller controls headers and timeout signal; every redirect is
 * validated and resolved again before it is requested.
 */
export async function fetchPublicUrl(
  input: string,
  init: RequestInit = {},
  maxRedirects = 4,
): Promise<Response> {
  let currentUrl = await validatePublicUrl(input);
  if (!currentUrl) throw new Error('Invalid or blocked source URL');

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(currentUrl, { ...init, redirect: 'manual' });
    if (!REDIRECT_STATUSES.has(response.status)) return response;

    const location = response.headers.get('location');
    if (!location) throw new Error('Source returned an invalid redirect');
    currentUrl = await validatePublicUrl(new URL(location, currentUrl).toString());
    if (!currentUrl) throw new Error('Source redirected to a blocked URL');
  }

  throw new Error('Source redirected too many times');
}

/** Read untrusted page/manifest text without buffering an unlimited response. */
export async function readResponseText(response: Response, limit = 1_000_000): Promise<string | null> {
  if (!response.body) return null;
  const declaredLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    await response.body.cancel().catch(() => undefined);
    return null;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(merged);
  } finally {
    reader.releaseLock();
  }
}

/** A parser-provided page URL is reduced to an origin before becoming a header. */
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
  name = name.replace(/[^a-zA-Z0-9._\-\s]/g, '_').replace(/^\.+/, '');
  if (!name || name === '.') name = fallback;
  if (!name.includes('.')) name += '.mp4';
  if (name.length > 150) {
    const extension = name.split('.').pop();
    name = `${name.slice(0, 100)}.${extension}`;
  }
  return name;
}

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function inferredReferrer(upstreamUrl: string): string {
  const lower = upstreamUrl.toLowerCase();
  if (lower.includes('tnmr.org') || lower.includes('luluvdo') || lower.includes('lulustream') || lower.includes('luluvid')) return 'https://luluvdo.com/';
  if (lower.includes('firestream')) return 'https://firestream.to/';
  if (lower.includes('playmate') || lower.includes('handitrrel')) return 'https://playmate.to/';
  if (lower.includes('vidara') || lower.includes('s1q2105') || lower.includes('97bf1')) return 'https://vidara.to/';
  if (lower.includes('mxcontent') || lower.includes('mxdcontent') || lower.includes('mixdrop')) return 'https://miiiixdrop.net/';
  if (lower.includes('streamtape') || lower.includes('strtape')) return 'https://streamtape.com/';

  try {
    const parsed = new URL(upstreamUrl);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'https://example.com/';
  }
}

/** Send a browser-like Referer but never forge Origin. */
export function getHeadersForUrl(upstreamUrl: string, referrer?: string | null): Record<string, string> {
  return {
    'User-Agent': USER_AGENT,
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.8',
    'Referer': pageOrigin(referrer) || inferredReferrer(upstreamUrl),
    'Cache-Control': 'no-cache',
  };
}

/** Kept as a shared response-header factory; API routes are same-origin only. */
export function buildCorsHeaders(): Headers {
  const headers = new Headers();
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Cross-Origin-Resource-Policy', 'same-origin');
  return headers;
}

export function isLikelyHlsUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return path.endsWith('.m3u8') || (path.endsWith('.txt') && /\/(?:hls|hls2)\//.test(path));
  } catch {
    return /\.m3u8(?:$|[?#])/i.test(url);
  }
}
