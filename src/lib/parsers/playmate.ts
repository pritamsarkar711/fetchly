import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { detectPacked, unpackAllLayers } from './unpacker';

const PLAYMATE_DOMAINS = [
  'playmate.to',
  'playmate.is',
  'playmate.so',
  'playmate.me',
  'playmate.cc',
];

const FETCH_TIMEOUT = 12_000;

export function isPlaymateUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return PLAYMATE_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    // Playmate uses /watch/<id>
    let match = pathname.match(/^\/(?:watch|v|e|d)\/([A-Za-z0-9]+)/);
    if (match) return match[1];
    match = pathname.match(/\/([A-Za-z0-9]{8,})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { PLAYMATE_DOMAINS };

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
      // basic video check
      if (!(url.includes('.m3u8') || url.includes('.mp4') || url.includes('playmate') || url.includes('hls') || url.includes('master'))) {
        if (!(url.includes('.mp4') || url.includes('.m3u8'))) continue;
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
    /(https?:\/\/[^\s"'<>]*playmate[^\s"'<>]*\.(?:m3u8|mp4)[^\s"'<>]*)/gi,
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
      url = url.replace(/&amp;/g, '&');
      const isM3u8 = url.includes('.m3u8');
      if (!(url.includes('.mp4') || url.includes('.m3u8') || url.includes('playmate') || url.includes('hls') || url.includes('master'))) {
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
    if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('playmate') || url.includes('hls')) {
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
      if (text.length > 80000 && !/(sources|file:|m3u8|mp4|eval\(function|playmate|hls|player)/i.test(text)) return;

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
        if (/(sources|m3u8|mp4|file:|hls|playmate)/i.test(text)) {
          const s1 = extractFromUnpackedCode(text);
          const s2 = extractVideoUrlsFromText(text);
          allSources.push(...s1, ...s2);
        }
      }
    } catch {}
  });

  return allSources;
}

function extractFileInfo($: cheerio.CheerioAPI, html: string, _url: string, fileId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text().replace(/· Playmate.*$/i, '').trim();
  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || '';
  }

  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300 && h1.length > 1) fileName = h1;
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
  if ((lower.includes('playmate.to/watch/') || lower.includes('playmate.to/v/')) && !lower.includes('.mp4') && !lower.includes('.m3u8')) return false;
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('master') || lower.includes('hls') || lower.includes('playmate') || lower.includes('/videos/') || lower.includes('cdn');
}

export async function parsePlaymate(url: string): Promise<VideoInfo | null> {
  if (!isPlaymateUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  const variants = new Set<string>();
  variants.add(url);
  // Try alternative forms: /watch/<id>, /embed/<id>, /v/<id> is 404 but try, also without www
  variants.add(url.replace('/watch/', '/embed/'));
  variants.add(url.replace('https://www.', 'https://').replace('http://www.', 'https://'));

  let lastError: any = null;

  for (const variantUrl of variants) {
    try {
      const response = await fetchWithFallback(variantUrl);
      const html = await response.text();
      if (!html || html.length < 200) throw new Error('Empty response from Playmate');

      if (html.toLowerCase().includes('file not found') || html.toLowerCase().includes('404 not found') || html.toLowerCase().includes('this video isn\'t here') || html.toLowerCase().includes("this video isn't here")) {
        continue;
      }

      const $ = cheerio.load(html);

      const fileInfo = extractFileInfo($, html, variantUrl, fileId);
      const scriptSources = processScripts($);
      const textSources = extractVideoUrlsFromText(html);

      let allSources: VideoSource[] = [];

      const addIfNew = (src: VideoSource) => {
        if (!allSources.some(s => normalizeUrl(s.url).toLowerCase() === normalizeUrl(src.url).toLowerCase())) {
          allSources.push(src);
        }
      };

      for (const s of [...scriptSources, ...textSources]) {
        addIfNew(s);
      }

      // Also check for JSON embedded in __NEXT_DATA__ or similar
      const nextData = $('#__NEXT_DATA__').html();
      if (nextData) {
        try {
          const jsonText = nextData;
          const found = extractVideoUrlsFromText(jsonText);
          for (const src of found) addIfNew(src);
        } catch {}
      }

      // Look for data in window.__INITIAL_DATA__ or similar
      const initDataMatch = html.match(/window\.__INITIAL_DATA__\s*=\s*({[\s\S]+?});/);
      if (initDataMatch) {
        const found = extractVideoUrlsFromText(initDataMatch[1]);
        for (const src of found) addIfNew(src);
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

      return {
        title: fileInfo.title || fileInfo.fileName || `Playmate - ${fileId}`,
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
    console.error('Error parsing Playmate after variants:', lastError);
    throw lastError;
  }

  throw new Error('Could not extract video from Playmate. File may be deleted or format changed.');
}
