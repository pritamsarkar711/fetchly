import { randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';
import { fetchPublicUrl, getHeadersForUrl, readResponseText } from '../proxy-utils';
import { VideoInfo, VideoSource } from '../types';

const DOOD_DOMAINS = [
  'doodstream.com', 'dood.la', 'dood.pm', 'dood.so', 'dood.wf', 'dood.re',
  'dood.yt', 'dood.sh', 'dood.li', 'dood.cx', 'dood.ws', 'dooood.com',
];
const FETCH_TIMEOUT = 12_000;

export function isDoodStreamUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return DOOD_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function fileId(url: string): string {
  try {
    return new URL(url).pathname.match(/^\/(?:e|d|v)\/([A-Za-z0-9_-]+)/)?.[1] || 'video';
  } catch {
    return 'video';
  }
}

function normalizeUrl(value: string, baseUrl: string): string | null {
  try {
    return new URL(value.replace(/&amp;/g, '&').replace(/\\\//g, '/').trim(), baseUrl).toString();
  } catch {
    return null;
  }
}

function source(url: string, isM3u8 = false): VideoSource {
  return { url, quality: isM3u8 ? 'Auto' : 'Direct', format: isM3u8 ? 'HLS' : 'Video', isM3u8 };
}

function directSources(html: string, pageUrl: string): VideoSource[] {
  const decoded = html.replace(/\\\//g, '/');
  const matches = decoded.matchAll(/(?:https?:)?\/\/[^\s"'<>]+?(?:\.m3u8|\.mp4)(?:\?[^\s"'<>]*)?/gi);
  const found: VideoSource[] = [];
  const seen = new Set<string>();
  for (const match of matches) {
    const candidate = normalizeUrl(match[0], pageUrl);
    if (!candidate || seen.has(candidate)) continue;
    seen.add(candidate);
    found.push(source(candidate, /\.m3u8(?:$|[?#])/i.test(candidate)));
  }
  return found;
}

async function textResponse(url: string, referrer: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetchPublicUrl(url, { headers: getHeadersForUrl(url, referrer), signal });
  if (!response.ok) return null;
  return readResponseText(response);
}

/** Resolve Dood's short-lived pass_md5 endpoint when the page exposes it. */
export async function parseDoodStream(url: string): Promise<VideoInfo | null> {
  if (!isDoodStreamUrl(url)) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const html = await textResponse(url, url, controller.signal);
    if (!html) return null;

    const sources = directSources(html, url);
    const passPath = html.match(/(?:['"`])((?:https?:)?\/pass_md5\/[^'"`\\\s]+)(?:['"`])/i)?.[1]
      || html.match(/(\/pass_md5\/[^'"`\\\s]+)/i)?.[1];
    const token = html.match(/[?&]token=([^&"'\s]+).*?[&]expiry=(\d+)/i);

    if (passPath && token) {
      const passUrl = normalizeUrl(passPath, url);
      if (passUrl) {
        const base = await textResponse(passUrl, url, controller.signal);
        if (base && /^https?:\/\//i.test(base.trim())) {
          const suffix = randomBytes(5).toString('hex');
          const separator = base.includes('?') ? '&' : '?';
          const direct = `${base.trim()}${suffix}${separator}token=${encodeURIComponent(token[1])}&expiry=${token[2]}`;
          sources.unshift(source(direct));
        }
      }
    }

    const unique = sources.filter((item, index, all) => all.findIndex(other => other.url === item.url) === index);
    if (!unique.length) return null;

    const $ = cheerio.load(html);
    const title = $('meta[property="og:title"]').attr('content') || $('title').text().trim() || fileId(url);
    return {
      title,
      fileName: title.includes('.') ? title : `${fileId(url)}.mp4`,
      fileSize: 'Unknown',
      fileSizeBytes: 0,
      thumbnail: $('meta[property="og:image"]').attr('content') || '',
      sources: unique,
      originalUrl: url,
      downloadUrl: unique.find(item => !item.isM3u8)?.url || unique[0].url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
