import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';

const STREAMTAPE_DOMAINS = [
  'streamtape.com',
  'strtape.cloud',
  'streamtape.net',
  'streamta.pe',
  'streamtape.site',
  'strcloud.link',
  'strcloud.club',
  'strtpe.link',
  'streamtape.cc',
  'scloud.online',
  'stape.fun',
  'streamadblockplus.com',
  'shavetape.cash',
  'streamtape.to',
  'streamta.site',
  'streamadblocker.xyz',
  'tapewithadblock.org',
  'adblocktape.wiki',
  'antiadtape.com',
  'streamtape.xyz',
  'tapeblocker.com',
  'streamnoads.com',
  'tapeadvertisement.com',
  'tapeadsenjoyer.com',
  'watchadsontape.com',
  'tpead.net',
  'advertape.net',
  'stape.me',
  'streamtape.co',
];

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy/?quest=',
];

const FETCH_TIMEOUT = 20000;
const PROXY_TIMEOUT = 25000;

export function isStreamTapeUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return STREAMTAPE_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain) || hostname.includes('streamtape') || hostname.includes('tape') || hostname.includes('strtape'));
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    // Streamtape uses /v/<id> or /e/<id>
    let match = pathname.match(/^\/(?:v|e)\/([A-Za-z0-9]+)/);
    if (match) return match[1];
    match = pathname.match(/\/([A-Za-z0-9]{8,})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { STREAMTAPE_DOMAINS };

async function fetchWithFallback(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://streamtape.com/',
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

/**
 * Reconstruct StreamTape video URL from ById obfuscation
 * Mimics Python resolver:
 * src = re.findall(r'''ById\('.+?=\s*(["']//[^;<]+)''', r)
 * parts = src[-1].replace("'", '"').split('+')
 * for part in parts:
 *   p1 = re.findall(r'"([^"]*)', part)[0]
 *   p2 = sum of substring numbers
 *   src_url += p1[p2:]
 * src_url += '&stream=1'
 */
function extractByIdMethod(html: string): string | null {
  try {
    // Find ById pattern
    const byIdRegex = /ById\([^)]*?=\s*(["']\/\/[^;<]+)/g;
    // More permissive version from resolver: ById\('.+?=\s*(["']//[^;<]+)
    const regex = /ById\(.*?=\s*(["']\/\/[\s\S][^;<]+)/g;
    let match: RegExpExecArray | null;
    let lastMatch: string | null = null;

    // Try both regexes
    const patterns = [
      /ById\(.*?=\s*(["']\/\/[\s\S][^;<]+)/g,
      /getElementById\(.*?\.innerHTML\s*=\s*(["']\/\/[^;<]+)/g,
      /ById\([^)]+\)\.innerHTML\s*=\s*([^;]+);/g,
    ];

    for (const pat of patterns) {
      let m: RegExpExecArray | null;
      while ((m = pat.exec(html)) !== null) {
        lastMatch = m[1] || m[0];
      }
    }

    // More accurate: find the specific line that contains get_video and ById
    const byIdLineRegex = /ById\([^)]*\)[^=]*=\s*([^;]+);/g;
    let lineMatch: RegExpExecArray | null;
    let candidate = '';
    while ((lineMatch = byIdLineRegex.exec(html)) !== null) {
      const inner = lineMatch[1];
      if (inner.includes('get_video') || inner.includes('streamtape') || inner.includes('//')) {
        candidate = inner;
      }
    }

    if (!candidate && lastMatch) {
      candidate = lastMatch;
    }

    if (!candidate) {
      // Fallback: search for the pattern that Python uses: ById\('.+?=\s*(["']//[^;<]+)
      const fallbackRegex = /ById\('.+?=\s*(["']\/\/[^;<]+)/g;
      let fm: RegExpExecArray | null;
      while ((fm = fallbackRegex.exec(html)) !== null) {
        candidate = fm[1] + fm[0].slice(fm[0].indexOf(fm[1]) + fm[1].length); // rough
      }
    }

    if (!candidate) return null;

    // Now candidate is something like '"//streamtape.com/get_video?id=xxx" + something.substring(1) + ...'
    // We need to reconstruct similar to Python logic
    // The Python code takes the last match of ById pattern which includes the whole concatenated string
    // Let's try to directly find the full ById assignment line
    const fullByIdRegex = /document\.getElementById\(['"][^'"]+['"]\)\.innerHTML\s*=\s*([^;]+);/g;
    let fullMatch: RegExpExecArray | null;
    let fullCandidate = '';
    while ((fullMatch = fullByIdRegex.exec(html)) !== null) {
      const expr = fullMatch[1];
      if (expr.includes('get_video')) {
        fullCandidate = expr;
      }
    }

    const srcString = fullCandidate || candidate;
    if (!srcString) return null;

    // Now parse srcString: split by '+'
    // Replace single quotes with double for easier parsing
    const normalized = srcString.replace(/'/g, '"');
    const parts = normalized.split('+');

    let srcUrl = '';
    for (let part of parts) {
      part = part.trim();
      // Extract string inside quotes: "([^"]*)"
      const p1Match = part.match(/"([^"]*)"/);
      if (!p1Match) continue;
      let p1 = p1Match[1];
      let p2 = 0;
      if (part.includes('substring')) {
        const subRegex = /substring\((\d+)\)/g;
        let subMatch: RegExpExecArray | null;
        while ((subMatch = subRegex.exec(part)) !== null) {
          p2 += parseInt(subMatch[1], 10);
        }
      }
      srcUrl += p1.substring(p2);
    }

    if (!srcUrl) {
      // If reconstruction failed, try direct extraction of get_video URL from srcString
      const directMatch = srcString.match(/(\/\/[^"']*get_video[^"']*)/);
      if (directMatch) {
        srcUrl = directMatch[1];
      }
    }

    if (srcUrl) {
      srcUrl += srcUrl.includes('?') ? '&stream=1' : '?stream=1';
      if (srcUrl.startsWith('//')) srcUrl = 'https:' + srcUrl;
      return normalizeUrl(srcUrl);
    }

    return null;
  } catch {
    return null;
  }
}

function extractGetVideoUrls(html: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  // Patterns for get_video URLs - from fetch_page we saw //streamtape.com/get_video?id=...&expires=...&ip=...&token=...
  const patterns = [
    /(?:https?:)?\/\/[^"'<>\s]*\/get_video\?id=[^"'<>\s]+/gi,
    /\/get_video\?id=[^"'<>\s]+/gi,
    /(https?:\/\/[^"'<>\s]*get_video\?id=[^"'<>\s]+)/gi,
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(html)) !== null) {
      let url = m[0].trim();
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.startsWith('/')) url = 'https://streamtape.com' + url;
      // Clean trailing chars
      url = url.replace(/["'<>]+$/, '');
      // Ensure stream=1 param
      if (!url.includes('stream=1')) {
        url += url.includes('?') ? '&stream=1' : '?stream=1';
      }
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      sources.push({
        url: normalizeUrl(url),
        quality: 'HD',
        format: 'MP4',
        isM3u8: false,
      });
    }
  }

  return sources;
}

function extractVideoUrlsFromText(text: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const patterns = [
    /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.m3u8(?:\?[^\s"'<>]*)?)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let url = (match[1] || match[0] || '').trim();
      url = url.replace(/["',;\]]+$/, '');
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.length < 15) continue;
      if (!url.startsWith('http')) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const isM3u8 = url.includes('.m3u8');
      // Filter out non-video domains like ey43.com unless mp4/m3u8
      if (!(url.includes('.mp4') || url.includes('.m3u8') || url.includes('streamtape') || url.includes('get_video'))) continue;
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
  // Titles like "Bw.mp4 at Streamtape.com"
  title = title.replace(/\s*at Streamtape\.com\s*$/i, '').trim();

  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || '';
  }

  // File name might be in h1 or from title
  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300) fileName = h1;
  }

  if (!fileName) fileName = title || `${fileId}.mp4`;

  // Size extraction: we saw "3.48 MB", "6.43 MB", "11.03 MB"
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

  if (!title) title = fileName;

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

function isTrueVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Exclude page URLs
  if ((lower.includes('streamtape.com/v/') || lower.includes('streamtape.com/e/')) && !lower.includes('.mp4') && !lower.includes('.m3u8') && !lower.includes('get_video')) return false;
  return lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('get_video') || lower.includes('streamtape') || lower.includes('/videos/');
}

export async function parseStreamTape(url: string): Promise<VideoInfo | null> {
  if (!isStreamTapeUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  const host = 'streamtape.com';
  let actualHost = host;
  try {
    actualHost = new URL(url).hostname.replace(/^www\./, '');
  } catch {}

  const variants = new Set<string>();
  variants.add(url);
  variants.add(`https://${actualHost}/v/${fileId}`);
  variants.add(`https://${actualHost}/e/${fileId}`);
  variants.add(`https://streamtape.com/v/${fileId}`);
  variants.add(`https://streamtape.com/e/${fileId}`);

  let lastError: any = null;

  for (const variantUrl of variants) {
    try {
      const response = await fetchWithFallback(variantUrl);
      const html = await response.text();
      if (!html || html.length < 200) throw new Error('Empty response from StreamTape');

      const lowerHtml = html.toLowerCase();
      if (lowerHtml.includes('file not found') || lowerHtml.includes('video not found') || lowerHtml.includes('404 not found') || lowerHtml.includes('deleted or removed') || lowerHtml.includes('video is private')) {
        continue;
      }

      const $ = cheerio.load(html);
      const fileInfo = extractFileInfo($, html, variantUrl, fileId);

      let videoSources: VideoSource[] = [];

      // Try ById method first (most reliable per resolver)
      const byIdUrl = extractByIdMethod(html);
      if (byIdUrl) {
        videoSources.push({
          url: byIdUrl,
          quality: 'HD',
          format: 'MP4',
          isM3u8: false,
        });
      }

      // Try direct get_video extraction
      const getVideoSources = extractGetVideoUrls(html);
      for (const src of getVideoSources) {
        if (!videoSources.some(s => s.url.toLowerCase() === src.url.toLowerCase())) {
          videoSources.push(src);
        }
      }

      // Generic video URL extraction
      const genericSources = extractVideoUrlsFromText(html);
      for (const src of genericSources) {
        if (!videoSources.some(s => s.url.toLowerCase() === src.url.toLowerCase())) {
          videoSources.push(src);
        }
      }

      // Also check for video tags
      $('video').each((_: number, videoEl: any) => {
        const $video = $(videoEl);
        const src = $video.attr('src');
        if (src) {
          const normalized = normalizeUrl(src.startsWith('//') ? 'https:' + src : src);
          if (!videoSources.some(s => s.url.toLowerCase() === normalized.toLowerCase())) {
            videoSources.push({
              url: normalized,
              quality: 'HD',
              format: 'MP4',
              isM3u8: normalized.includes('.m3u8'),
            });
          }
        }
        $video.find('source').each((_: number, sourceEl: any) => {
          const $source = $(sourceEl);
          const srcUrl = $source.attr('src');
          if (srcUrl) {
            const normalized = normalizeUrl(srcUrl.startsWith('//') ? 'https:' + srcUrl : srcUrl);
            if (!videoSources.some(s => s.url.toLowerCase() === normalized.toLowerCase())) {
              videoSources.push({
                url: normalized,
                quality: $source.attr('label') || 'HD',
                format: 'MP4',
                isM3u8: normalized.includes('.m3u8'),
              });
            }
          }
        });
      });

      videoSources = videoSources.filter(s => isTrueVideoUrl(s.url));
      videoSources = deduplicateSources(videoSources.map(s => ({ ...s, url: normalizeUrl(s.url) })));

      if (videoSources.length === 0) continue;

      // Prefer MP4 over m3u8 for StreamTape
      videoSources.sort((a, b) => {
        if (!a.isM3u8 && b.isM3u8) return -1;
        if (a.isM3u8 && !b.isM3u8) return 1;
        return 0;
      });

      const primary = videoSources[0];
      const downloadUrl = primary.url;

      return {
        title: fileInfo.title || fileInfo.fileName || `StreamTape - ${fileId}`,
        fileName: fileInfo.fileName || `${fileId}.mp4`,
        fileSize: fileInfo.fileSize || 'Unknown',
        fileSizeBytes: fileInfo.fileSizeBytes,
        thumbnail: fileInfo.thumbnail || '',
        sources: videoSources,
        originalUrl: url,
        downloadUrl,
      };
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    console.error('Error parsing StreamTape after variants:', lastError);
    throw lastError;
  }

  throw new Error('Could not extract video from StreamTape. File may be deleted or format changed.');
}
