import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { detectPacked, unpackAllLayers } from './unpacker';

const VIDARA_DOMAINS = [
  'vidara.to',
  'vidara.so',
  'vidara.is',
  'vidara.me',
  'vidara.net',
  'vidara.cc',
  'vidara.site',
  'vidara.xyz',
  'vidarashare',
  'vidar',
];

const FETCH_TIMEOUT = 12_000;

export function isVidaraUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return VIDARA_DOMAINS.some(domain => hostname === domain || hostname.includes(domain) || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    // Vidara uses /v/<id>
    let match = pathname.match(/^\/v\/([A-Za-z0-9]+)/);
    if (match) return match[1];
    // fallback /e/ /d/ etc
    match = pathname.match(/^\/(?:e|d|v)\/([A-Za-z0-9]+)/);
    if (match) return match[1];
    // last segment
    match = pathname.match(/\/([A-Za-z0-9]{6,})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { VIDARA_DOMAINS };

async function fetchWithFallback(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
        'Referer': `${new URL(url).origin}/`,
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function unpackJs(code: string): string | null {
  try {
    if (detectPacked(code)) {
      return unpackAllLayers(code, 4);
    }
    return null;
  } catch {
    return null;
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

function extractFromUnpackedCode(code: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const patterns = [
    /sources:\s*\[{file:\s*["']([^"']+)["']/gi,
    /sources:\s*\[\s*{\s*file:\s*["']([^"']+)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    // Playerjs
    /file:\s*["'](https?:\/\/[^"']+)["']/gi,
  ];

  for (const pat of patterns) {
    let m: RegExpExecArray | null;
    while ((m = pat.exec(code)) !== null) {
      let url = (m[1] || m[0]).trim();
      if (!url) continue;
      if (url.startsWith('//')) url = 'https:' + url;
      if (!url.startsWith('http')) continue;
      url = normalizeUrl(url);
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      // Must look like video
      if (!(url.includes('.m3u8') || url.includes('.mp4') || url.includes('vidara') || url.includes('hls') || url.includes('master') || url.includes('.urlset') || url.includes('ey43'))) {
        // still allow if it contains video extension or known CDN
        if (!(url.includes('.m3u8') || url.includes('.mp4') || url.includes('mp4'))) continue;
      }
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url,
        quality: isM3u8 ? 'Auto (HLS)' : 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  return sources;
}

function extractVideoUrlsFromText(text: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const patterns = [
    /(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(https?:\/\/[^\s"'<>]*\.urlset\/master\.m3u8[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
    // Vidara specific CDN patterns
    /(https?:\/\/[^\s"'<>]*vidara[^\s"'<>]*\.(?:m3u8|mp4)[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*ey43\.com[^\s"'<>]*)/gi,
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
      // filter out obviously non-video
      if (url.includes('ey43.com')) {
        // ey43 is ad redirect, skip unless it ends with mp4 or m3u8
        if (!(url.includes('.mp4') || url.includes('.m3u8'))) continue;
      }
      seen.add(key);
      url = url.replace(/&amp;/g, '&');
      const isM3u8 = url.includes('.m3u8');
      // basic validation
      if (!(url.includes('.mp4') || url.includes('.m3u8') || url.includes('vidara') || url.includes('master') || url.includes('hls'))) {
        // Allow mp4/m3u8 anyway
        if (!(isM3u8 || url.includes('.mp4'))) continue;
      }
      sources.push({
        url,
        quality: isM3u8 ? 'HD (HLS)' : 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  const jsonPat = /["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonPat.exec(text)) !== null) {
    let url = jm[1];
    if (url.startsWith('//')) url = 'https:' + url;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('vidara') || url.includes('hls')) {
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url: url.replace(/&amp;/g, '&'),
        quality: isM3u8 ? 'Auto' : 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  return sources;
}

function processScripts($: cheerio.CheerioAPI): VideoSource[] {
  const allSources: VideoSource[] = [];
  const processed = new Set<string>();

  $('script').each((_: number, el: any) => {
    try {
      const text = $(el).html() || $(el).text() || '';
      if (!text || text.length < 20) return;
      if (text.length > 80000 && !/(sources|file:|m3u8|mp4|eval\(function|vidara|hls|player)/i.test(text)) return;

      const hash = text.slice(0, 300);
      if (processed.has(hash)) return;
      processed.add(hash);

      if (text.includes('eval(function') || text.includes('function(p,a,c,k,e,')) {
        const unpacked = unpackJs(text);
        if (unpacked) {
          const s1 = extractFromUnpackedCode(unpacked);
          const s2 = extractVideoUrlsFromText(unpacked);
          allSources.push(...s1, ...s2);
        }
        const sOrig = extractFromUnpackedCode(text);
        const sOrig2 = extractVideoUrlsFromText(text);
        allSources.push(...sOrig, ...sOrig2);
      } else {
        if (/(sources|m3u8|mp4|file:|hls|vidara)/i.test(text)) {
          const s1 = extractFromUnpackedCode(text);
          const s2 = extractVideoUrlsFromText(text);
          allSources.push(...s1, ...s2);
        }
      }
    } catch {}
  });

  return allSources;
}

function extractVideoFromHTML($: cheerio.CheerioAPI): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  $('video').each((_: number, videoEl: any) => {
    const $video = $(videoEl);
    const src = $video.attr('src');
    if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.includes('vidara') || src.startsWith('http'))) {
      const normalized = src.startsWith('//') ? 'https:' + src : src;
      const key = normalized.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        sources.push({
          url: normalized,
          quality: 'Auto',
          format: normalized.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
          isM3u8: normalized.includes('.m3u8'),
        });
      }
    }
    $video.find('source').each((_: number, sourceEl: any) => {
      const $source = $(sourceEl);
      const srcUrl = $source.attr('src');
      if (srcUrl && srcUrl.length > 5) {
        const normalized = srcUrl.startsWith('//') ? 'https:' + srcUrl : srcUrl;
        const key = normalized.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          sources.push({
            url: normalized,
            quality: $source.attr('label') || $source.attr('title') || 'Auto',
            format: normalized.includes('.m3u8') ? 'HLS (m3u8)' : ($source.attr('type') || 'MP4'),
            isM3u8: normalized.includes('.m3u8'),
          });
        }
      }
    });
  });

  // Look for download file link <a href="...">Download file</a>
  $('a').each((_: number, el: any) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text() || '';
    if (text.toLowerCase().includes('download') && href) {
      // If href is direct mp4/m3u8, add it
      if (href.includes('.mp4') || href.includes('.m3u8') || href.includes('vidara') || href.includes('ey43')) {
        const normalized = href.startsWith('//') ? 'https:' + href : href;
        if (!normalized.includes('ey43.com') || normalized.includes('.mp4') || normalized.includes('.m3u8')) {
          const key = normalized.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            if (normalized.includes('.mp4') || normalized.includes('.m3u8')) {
              sources.push({
                url: normalized,
                quality: 'HD',
                format: normalized.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
                isM3u8: normalized.includes('.m3u8'),
              });
            }
          }
        }
      }
    }
  });

  return sources;
}

function extractFileInfo($: cheerio.CheerioAPI, html: string, _url: string, fileId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text().replace(/^Watch\s+/i, '').trim();
  title = title.replace(/\s+- Vidara.*$/i, '').trim();

  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || '';
  }

  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300) fileName = h1;
    if (!fileName) {
      const h2 = $('h2').first().text().trim();
      if (h2 && h2.length < 300) fileName = h2;
    }
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
  // Exclude page URLs
  if ((lower.includes('vidara.to/v/') || lower.includes('vidara.so/v/')) && !lower.includes('.mp4') && !lower.includes('.m3u8')) return false;
  // Skip ad domains unless they are video
  if (lower.includes('ey43.com') && !lower.includes('.mp4') && !lower.includes('.m3u8')) return false;
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('vidara') || lower.includes('master') || lower.includes('hls') || lower.includes('.urlset');
}

export async function parseVidara(url: string): Promise<VideoInfo | null> {
  if (!isVidaraUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  const variants = new Set<string>();
  variants.add(url);
  // Try with and without www, and different domain variants .to vs .so
  variants.add(url.replace('vidara.to', 'vidara.so'));
  variants.add(url.replace('vidara.so', 'vidara.to'));
  variants.add(url.replace('https://www.', 'https://').replace('http://www.', 'https://'));

  let lastError: any = null;

  for (const variantUrl of variants) {
    try {
      const response = await fetchWithFallback(variantUrl);
      const html = await response.text();
      if (!html || html.length < 200) throw new Error('Empty response from Vidara');

      if (html.includes('WE ARE SORRY') || html.includes('File Not Found') || html.includes('404 Not Found') || html.toLowerCase().includes('file was deleted') || html.toLowerCase().includes('file not found')) {
        continue;
      }

      const $ = cheerio.load(html);

      const fileInfo = extractFileInfo($, html, variantUrl, fileId);
      const htmlSources = extractVideoFromHTML($);
      const scriptSources = processScripts($);
      const textSources = extractVideoUrlsFromText(html);

      let allSources: VideoSource[] = [...htmlSources];

      const addIfNew = (src: VideoSource) => {
        if (!allSources.some(s => normalizeUrl(s.url).toLowerCase() === normalizeUrl(src.url).toLowerCase())) {
          allSources.push(src);
        }
      };

      for (const s of [...scriptSources, ...textSources]) {
        addIfNew(s);
      }

      allSources = allSources.map(s => ({ ...s, url: normalizeUrl(s.url) }));
      let videoSources = allSources.filter(s => isTrueVideoUrl(s.url));
      videoSources = deduplicateSources(videoSources);

      if (videoSources.length === 0) continue;

      videoSources.sort((a, b) => {
        const aMaster = a.url.includes('master.m3u8');
        const bMaster = b.url.includes('master.m3u8');
        if (aMaster && !bMaster) return -1;
        if (!aMaster && bMaster) return 1;
        if (!a.isM3u8 && b.isM3u8) return -1;
        if (a.isM3u8 && !b.isM3u8) return 1;
        return 0;
      });

      const primary = videoSources.find(s => s.url.includes('.mp4')) || videoSources[0];
      const downloadUrl = primary ? primary.url : videoSources[0].url;

      const result: VideoInfo = {
        title: fileInfo.title || fileInfo.fileName || `Vidara - ${fileId}`,
        fileName: fileInfo.fileName || `${fileId}.mp4`,
        fileSize: fileInfo.fileSize || 'Unknown',
        fileSizeBytes: fileInfo.fileSizeBytes,
        thumbnail: fileInfo.thumbnail || '',
        sources: videoSources,
        originalUrl: url,
        downloadUrl,
      };

      return result;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  if (lastError) {
    console.error('Error parsing Vidara after variants:', lastError);
    throw lastError;
  }

  throw new Error('Could not extract video from Vidara. File may be deleted or format changed.');
}
