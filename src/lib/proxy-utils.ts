/**
 * Shared utilities for proxying video streams
 */

export const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
  '169.254.', // link-local
];

export function isInternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.some(blocked =>
      hostname === blocked || hostname.startsWith(blocked)
    );
  } catch {
    return true; // block invalid
  }
}

export function validateProxyUrl(input: string | null): string | null {
  if (!input || typeof input !== 'string') return null;
  let normalized = input.trim();
  if (normalized.length > 3000) return null;
  if (normalized.startsWith('//')) normalized = 'https:' + normalized;
  try {
    const parsed = new URL(normalized);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    if (!parsed.hostname.includes('.')) return null;
    if (isInternalUrl(normalized)) return null;
    // Allow only video-like URLs or known CDNs to reduce abuse,
    // but also allow generic https for broader support
    return normalized;
  } catch {
    return null;
  }
}

export function sanitizeFilename(input: string | null, fallback = 'video.mp4'): string {
  let name = (input || fallback).trim();
  // Remove path traversal
  name = name.split('/').pop()?.split('\\').pop() || fallback;
  // Allow only safe chars
  name = name.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  // Ensure extension
  if (!name.includes('.')) name += '.mp4';
  // Limit length
  if (name.length > 150) {
    const ext = name.split('.').pop();
    name = name.slice(0, 100) + '.' + ext;
  }
  return name;
}

export const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': '*/*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Referer': 'https://mixdrop.co/',
  'Origin': 'https://mixdrop.co',
  'Connection': 'keep-alive',
  'Cache-Control': 'no-cache',
};

export function buildCorsHeaders(): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Referer, User-Agent');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');
  return h;
}
