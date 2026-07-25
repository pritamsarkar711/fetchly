import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { detectPacked, unpackAllLayers } from './unpacker';

const FIRESTREAM_DOMAINS = [
  'firestream.to',
  'firestream.co',
  'firestream.io',
  'firestream.net',
  'firestre.am',
];

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy/?quest=',
];

const FETCH_TIMEOUT = 20000;
const PROXY_TIMEOUT = 25000;

export function isFireStreamUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return FIRESTREAM_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    // Pattern /e/<id> or /v/<id>
    let match = pathname.match(/^\/(?:e|v)\/([A-Za-z0-9_-]+)/);
    if (match) return match[1];
    // fallback last segment
    match = pathname.match(/\/([A-Za-z0-9_-]{4,})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { FIRESTREAM_DOMAINS };

async function fetchWithFallback(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://firestream.to/',
    'Origin': 'https://firestream.to',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (response.ok) return response;
    throw new Error(`Direct fetch failed: ${response.status}`);
  } catch (directError) {
    clearTimeout(timeout);
    for (const proxy of CORS_PROXIES) {
      try {
        const proxyController = new AbortController();
        const proxyTimeout = setTimeout(() => proxyController.abort(), PROXY_TIMEOUT);
        const proxyResponse = await fetch(`${proxy}${encodeURIComponent(url)}`, {
          signal: proxyController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://firestream.to/',
          },
        });
        clearTimeout(proxyTimeout);
        if (proxyResponse.ok) return proxyResponse;
      } catch {
        continue;
      }
    }
    throw directError;
  }
}

async function postApiResolve(apiUrl: string, blob: string, host: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const referer = `https://${host}/`;
  const origin = `https://${host}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': referer,
    'Origin': origin,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Cache-Control': 'no-cache',
  };

  try {
    const body = `blob=${encodeURIComponent(blob)}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      signal: controller.signal,
      headers,
      body,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    return response;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function normalizeUrl(raw: string): string {
  let url = raw.replace(/&amp;/g, '&').trim();
  if (url.startsWith('//')) url = 'https:' + url;
  url = url.replace(/^(https:){2,}/, 'https://');
  return url;
}

function deduplicateSources(sources: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    const key = source.url.toLowerCase().trim().replace(/^https?:/, '').replace(/^\/\//, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractVideoUrlsFromText(text: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const patterns = [
    /(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let url = (match[1] || match[0] || '').trim();
      url = url.replace(/["',;\]]+$/, '');
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.length < 20) continue;
      if (!url.startsWith('http')) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url: url.replace(/&amp;/g, '&'),
        quality: isM3u8 ? 'HD (HLS)' : 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  return sources;
}

function extractFileInfo($: cheerio.CheerioAPI, html: string, _url: string, fileId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text().trim();
  title = title.replace(/^FireStream\s*-?\s*/i, '').trim();
  title = title.replace(/FireStream Video/i, '').trim();
  if (!title || title.length < 2) {
    title = $('meta[property="og:title"]').attr('content') || '';
  }

  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300 && h1.length > 2) fileName = h1;
  }

  if (!fileName) fileName = title || `${fileId}.mp4`;

  const sizeMatch = html.match(/([\d.]+)\s*(MB|GB|KB)/i);
  if (sizeMatch) {
    fileSize = sizeMatch[0].trim();
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit === 'GB') fileSizeBytes = num * 1024 * 1024 * 1024;
    else if (unit === 'MB') fileSizeBytes = num * 1024 * 1024;
    else if (unit === 'KB') fileSizeBytes = num * 1024;
  }

  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) thumbnail = ogImage;
  if (!thumbnail) {
    const thumbMatch = html.match(/(https?:\/\/[^\s"'<]+\.(?:jpg|png|webp))/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
  }

  if (!title) title = fileName;

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

function isTrueVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if ((lower.includes('firestream.to/e/') || lower.includes('firestream.to/v/')) && !lower.includes('.mp4') && !lower.includes('.m3u8')) return false;
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('master') || lower.includes('hls') || lower.includes('firestream') || lower.includes('/videos/') || lower.includes('signed');
}

export async function parseFireStream(url: string): Promise<VideoInfo | null> {
  if (!isFireStreamUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  let host = 'firestream.to';
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {}

  const webUrl = `https://${host}/e/${fileId}`;
  const apiUrl = `https://${host}/api/videos/${fileId}/resolve`;

  try {
    const response = await fetchWithFallback(webUrl);
    const html = await response.text();
    if (!html || html.length < 100) throw new Error('Empty response from FireStream');

    if (html.toLowerCase().includes('file not found') || html.toLowerCase().includes('404 not found') || html.toLowerCase().includes('video not found')) {
      throw new Error('File not found on FireStream');
    }

    const $ = cheerio.load(html);
    const fileInfo = extractFileInfo($, html, webUrl, fileId);

    let videoSources: VideoSource[] = [];

    // Try to extract token-blob
    let blob: string | null = null;
    const blobMatch = html.match(/id=["']token-blob["'][^>]*>([^<]+)</i);
    if (blobMatch) {
      blob = blobMatch[1].trim();
    } else {
      // Try alternative patterns
      const altMatch = html.match(/token-blob["'][^>]*>([^<]+)</i) || html.match(/blob["']?\s*[:=]\s*["']([^"']+)["']/i);
      if (altMatch) blob = altMatch[1].trim();
    }

    // If blob found, try API resolve
    if (blob) {
      try {
        const apiResponse = await postApiResolve(apiUrl, blob, host);
        const apiText = await apiResponse.text();

        // Try JSON parse
        try {
          const json = JSON.parse(apiText);
          // Expected field: signedVideoUrl
          const signedUrl = json.signedVideoUrl || json.signed_video_url || json.url || json.source || json.data?.signedVideoUrl || json.data?.url;
          if (signedUrl) {
            const normalized = normalizeUrl(signedUrl);
            const isM3u8 = normalized.includes('.m3u8');
            videoSources.push({
              url: normalized,
              quality: isM3u8 ? 'HD (HLS)' : 'HD',
              format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
              isM3u8,
            });
          } else {
            // Sometimes API returns {data: {signedVideoUrl: ...}} or array
            // Search for any m3u8/mp4 inside JSON string
            const found = extractVideoUrlsFromText(apiText);
            videoSources.push(...found);
          }
        } catch {
          // Not JSON, search for URLs inside response text
          const found = extractVideoUrlsFromText(apiText);
          videoSources.push(...found);
        }
      } catch (apiErr) {
        console.error('FireStream API resolve failed:', apiErr);
        // Continue to fallback extraction
      }
    }

    // Fallback: try to extract directly from page HTML (maybe already contains signed URL or mp4)
    const directSources = extractVideoUrlsFromText(html);
    for (const src of directSources) {
      if (!videoSources.some(s => s.url === src.url)) videoSources.push(src);
    }

    // Also check <video> tags
    $('video').each((_: number, videoEl: any) => {
      const $video = $(videoEl);
      const src = $video.attr('src');
      if (src) {
        const normalized = normalizeUrl(src.startsWith('//') ? 'https:' + src : src);
        if (!videoSources.some(s => s.url === normalized)) {
          videoSources.push({
            url: normalized,
            quality: 'HD',
            format: normalized.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
            isM3u8: normalized.includes('.m3u8'),
          });
        }
      }
      $video.find('source').each((_: number, sourceEl: any) => {
        const $source = $(sourceEl);
        const srcUrl = $source.attr('src');
        if (srcUrl) {
          const normalized = normalizeUrl(srcUrl.startsWith('//') ? 'https:' + srcUrl : srcUrl);
          if (!videoSources.some(s => s.url === normalized)) {
            videoSources.push({
              url: normalized,
              quality: $source.attr('label') || 'HD',
              format: normalized.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
              isM3u8: normalized.includes('.m3u8'),
            });
          }
        }
      });
    });

    // Try scripts for packed content
    $('script').each((_: number, el: any) => {
      try {
        const text = $(el).html() || $(el).text() || '';
        if (!text) return;
        let working = text;
        if (text.includes('eval(function')) {
          if (detectPacked(text)) {
            const unpacked = unpackAllLayers(text, 3);
            if (unpacked) working = unpacked;
          }
        }
        const found = extractVideoUrlsFromText(working);
        for (const src of found) {
          if (!videoSources.some(s => s.url.toLowerCase() === src.url.toLowerCase())) {
            videoSources.push(src);
          }
        }
      } catch {}
    });

    videoSources = videoSources.filter(s => isTrueVideoUrl(s.url));
    videoSources = deduplicateSources(videoSources.map(s => ({ ...s, url: normalizeUrl(s.url) })));

    if (videoSources.length === 0) {
      throw new Error('Could not find video source. Token may be missing or expired. The FireStream resolver requires token-blob extraction.');
    }

    // Sort mp4 first? Actually HLS may be preferred, but keep mp4 first for download
    videoSources.sort((a, b) => {
      if (a.isM3u8 && !b.isM3u8) return -1;
      if (!a.isM3u8 && b.isM3u8) return 1;
      return 0;
    });

    const primary = videoSources[0];
    const downloadUrl = primary.url;

    return {
      title: fileInfo.title || fileInfo.fileName || `FireStream - ${fileId}`,
      fileName: fileInfo.fileName || `${fileId}.mp4`,
      fileSize: fileInfo.fileSize || 'Unknown',
      fileSizeBytes: fileInfo.fileSizeBytes,
      thumbnail: fileInfo.thumbnail || '',
      sources: videoSources,
      originalUrl: url,
      downloadUrl,
    };
  } catch (error) {
    console.error('Error parsing FireStream URL:', error);
    throw error;
  }
}
