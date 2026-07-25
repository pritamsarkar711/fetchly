/**
 * Shared utilities for proxying video streams
 */

export const BLOCKED_HOSTS = [
  'localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]',
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
  '169.254.',
];

export function isInternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BLOCKED_HOSTS.some(blocked =>
      hostname === blocked || hostname.startsWith(blocked)
    );
  } catch {
    return true;
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
    return normalized;
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

export function getHeadersForUrl(upstreamUrl: string): Record<string, string> {
  const lower = upstreamUrl.toLowerCase();
  const base = {
    'User-Agent': COMMON_HEADERS['User-Agent'],
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Connection': 'keep-alive',
    'Cache-Control': 'no-cache',
  } as Record<string, string>;

  // LuluStream / LuluVdo / tnmr CDN
  if (
    lower.includes('luluvdo') ||
    lower.includes('lulustream') ||
    lower.includes('luluvid') ||
    lower.includes('tnmr.org') ||
    lower.includes('cdn-tnmr') ||
    lower.includes('732eg54de642sa') ||
    lower.includes('d00ds.site') ||
    lower.includes('streamhihi') ||
    lower.includes('lulu.st') ||
    lower.includes('cdn1.site')
  ) {
    return {
      ...base,
      'Referer': 'https://luluvdo.com/',
      'Origin': 'https://luluvdo.com',
    };
  }

  // Vidara
  if (
    lower.includes('vidara.to') ||
    lower.includes('vidara.so') ||
    lower.includes('vidara.is') ||
    lower.includes('vidara.me') ||
    lower.includes('ey43.com') ||
    lower.includes('vidar')
  ) {
    return {
      ...base,
      'Referer': 'https://vidara.to/',
      'Origin': 'https://vidara.to',
    };
  }

  // FireStream
  if (
    lower.includes('firestream.to') ||
    lower.includes('firestream.co') ||
    lower.includes('firestre.am') ||
    lower.includes('firestream')
  ) {
    return {
      ...base,
      'Referer': 'https://firestream.to/',
      'Origin': 'https://firestream.to',
    };
  }

  // Playmate
  if (
    lower.includes('playmate.to') ||
    lower.includes('playmate.is') ||
    lower.includes('playmate.so') ||
    lower.includes('playmate')
  ) {
    return {
      ...base,
      'Referer': 'https://playmate.to/',
      'Origin': 'https://playmate.to',
    };
  }

  // StreamTape
  if (
    lower.includes('streamtape.com') ||
    lower.includes('strtape.cloud') ||
    lower.includes('streamtape.net') ||
    lower.includes('streamta.pe') ||
    lower.includes('streamtape.site') ||
    lower.includes('strcloud.link') ||
    lower.includes('shavetape.cash') ||
    lower.includes('streamtape.to') ||
    lower.includes('streamtape.xyz') ||
    lower.includes('tapeblocker.com') ||
    lower.includes('streamtape') ||
    lower.includes('stape.fun')
  ) {
    return {
      ...base,
      'Referer': 'https://streamtape.com/',
      'Origin': 'https://streamtape.com',
    };
  }

  // MixDrop
  if (
    lower.includes('mxcontent') ||
    lower.includes('mxdcontent') ||
    lower.includes('mixdrop') ||
    lower.includes('delivery')
  ) {
    return {
      ...base,
      'Referer': 'https://mixdrop.co/',
      'Origin': 'https://mixdrop.co',
    };
  }

  try {
    const u = new URL(upstreamUrl);
    return {
      ...base,
      'Referer': `${u.protocol}//${u.host}/`,
      'Origin': `${u.protocol}//${u.host}`,
    };
  } catch {
    return {
      ...base,
      'Referer': 'https://mixdrop.co/',
      'Origin': 'https://mixdrop.co',
    };
  }
}

export function buildCorsHeaders(): Headers {
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Range, Content-Type, Origin, Referer, User-Agent, Accept-Language');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, Content-Type, Content-Disposition');
  return h;
}
