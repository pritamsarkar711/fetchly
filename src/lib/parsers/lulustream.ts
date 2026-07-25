import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { detectPacked, unpackAllLayers } from './unpacker';

const LULUSTREAM_DOMAINS = [
  'lulustream.com',
  'luluvdo.com',
  'luluvdo.net',
  'lulu.st',
  'luluvid.com',
  'luluvid.net',
  'luluvid.co',
  'luluvdoo.com',
  'luluvdo.net',
  '732eg54de642sa.sbs',
  'cdn1.site',
  'streamhihi.com',
  'd00ds.site',
  'lulu.st',
  'lulustream',
  'luluvido',
  // generic tnmr host will be caught via CDN, but not as page host
];

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy/?quest=',
];

const FETCH_TIMEOUT = 20000;
const PROXY_TIMEOUT = 25000;

export function isLuluStreamUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return LULUSTREAM_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain) || hostname.includes('lulu')
    );
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const u = new URL(url);
    const pathname = u.pathname;
    // Lulu uses /e/<id> or /d/<id> or just /<id>
    let match = pathname.match(/^\/(?:e|d|v)\/([a-zA-Z0-9]+)/);
    if (match) return match[1];
    // fallback: last segment
    match = pathname.match(/\/([a-zA-Z0-9]{6,})$/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { LULUSTREAM_DOMAINS };

async function fetchWithFallback(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://luluvdo.com/',
    'Origin': 'https://luluvdo.com',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'same-origin',
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
            'Referer': 'https://luluvdo.com/',
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

  // Pattern from ResolveURL: sources: [{file: "url"}]
  const patterns = [
    /sources:\s*\[{file:\s*["']([^"']+)["']/gi,
    /sources:\s*\[\s*{\s*file:\s*["']([^"']+)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    // jwplayer setup
    /hls2?[^"']*\.m3u8[^"']*/gi,
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
      if (!(url.includes('.m3u8') || url.includes('.mp4') || url.includes('tnmr') || url.includes('hls'))) continue;
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
    /(https?:\/\/[^\s"'<>]*tnmr\.org[^\s"'<>]*\.m3u8[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*cdn-tnmr[^\s"'<>]*\.m3u8[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*hls2[^\s"'<>]*\.m3u8[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*tnmr[^\s"'<>]*\.m3u8[^\s"'<>]*)/gi,
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
      // validation
      if (!(url.includes('.m3u8') || url.includes('.mp4') || url.includes('tnmr') || url.includes('master'))) continue;
      seen.add(key);
      url = url.replace(/&amp;/g, '&');
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url,
        quality: isM3u8 ? 'HD (HLS)' : 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  // Also file:"url" JSON pattern
  const jsonPat = /["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonPat.exec(text)) !== null) {
    let url = jm[1];
    if (url.startsWith('//')) url = 'https:' + url;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (url.includes('.m3u8') || url.includes('.mp4') || url.includes('tnmr')) {
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
      if (text.length > 50000 && !/(sources|file:|m3u8|tnmr|hls|eval\(function)/i.test(text)) return;

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
        // Also try original
        const sOrig = extractFromUnpackedCode(text);
        const sOrig2 = extractVideoUrlsFromText(text);
        allSources.push(...sOrig, ...sOrig2);
      } else {
        if (/(sources|m3u8|tnmr|hls|mp4|file:)/i.test(text)) {
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

  title = $('title').text().replace(/ - Lulustream.*$/i, '').replace(/ - LuluStream.*$/i, '').trim();

  // og:title
  if (!title) {
    title = $('meta[property="og:title"]').attr('content') || '';
  }

  // Try to find filename in h1 or h2
  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 200) fileName = h1;
    const h2 = $('h2').first().text().trim();
    if (!fileName && h2 && h2.length < 200) fileName = h2;
  }

  if (!fileName) fileName = title || `${fileId}.mp4`;

  // Try to find size: "106.9 MB" pattern
  const sizeMatch = html.match(/([\d.]+)\s*(MB|GB|KB)/i);
  if (sizeMatch) {
    fileSize = sizeMatch[0].trim();
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit === 'GB') fileSizeBytes = num * 1024 * 1024 * 1024;
    else if (unit === 'MB') fileSizeBytes = num * 1024 * 1024;
    else if (unit === 'KB') fileSizeBytes = num * 1024;
  }

  // Thumbnail
  const ogImage = $('meta[property="og:image"]').attr('content');
  if (ogImage) thumbnail = ogImage;
  if (!thumbnail) {
    $('img').each((_: number, el: any) => {
      const src = $(el).attr('src') || '';
      if (src.includes('thumb') || src.includes('poster') || src.includes('.jpg') || src.includes('.png')) {
        if (src.startsWith('http')) thumbnail = src;
      }
    });
  }

  if (!thumbnail) {
    const thumbMatch = html.match(/(https?:\/\/[^\s"'<]+\.(?:jpg|png|webp))/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
  }

  if (!title) title = fileName;

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

function isTrueVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  if (lower.includes('luluvdo.com') && (lower.includes('/e/') || lower.includes('/d/')) && !lower.includes('.m3u8') && !lower.includes('.mp4')) return false;
  if (lower.includes('lulustream') && lower.includes('/e/') && !lower.includes('.m3u8') && !lower.includes('.mp4')) return false;
  return lower.includes('.m3u8') || lower.includes('.mp4') || lower.includes('tnmr') || lower.includes('master') || lower.includes('hls');
}

export async function parseLuluStream(url: string): Promise<VideoInfo | null> {
  if (!isLuluStreamUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  const variants = new Set<string>();
  variants.add(url);
  // try /e/ and /d/ variants
  if (url.includes('/d/')) variants.add(url.replace('/d/', '/e/'));
  if (url.includes('/e/')) variants.add(url.replace('/e/', '/d/'));

  // also try with and without www
  const withoutWww = url.replace('https://www.', 'https://').replace('http://www.', 'https://');
  variants.add(withoutWww);

  let lastError: any = null;

  for (const variantUrl of variants) {
    try {
      const response = await fetchWithFallback(variantUrl);
      const html = await response.text();
      if (!html || html.length < 200) throw new Error('Empty response from LuluStream');

      if (html.includes('WE ARE SORRY') || html.includes('File Not Found') || html.includes('404 Not Found') || html.toLowerCase().includes('file was deleted') || html.toLowerCase().includes('file not found')) {
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

      allSources = allSources.map(s => ({ ...s, url: normalizeUrl(s.url) }));
      let videoSources = allSources.filter(s => isTrueVideoUrl(s.url));

      // Deduplicate
      videoSources = deduplicateSources(videoSources);

      if (videoSources.length === 0) continue;

      // Sort: prefer m3u8 master, then mp4
      videoSources.sort((a, b) => {
        // master.m3u8 first
        const aMaster = a.url.includes('master.m3u8');
        const bMaster = b.url.includes('master.m3u8');
        if (aMaster && !bMaster) return -1;
        if (!aMaster && bMaster) return 1;
        if (a.isM3u8 && !b.isM3u8) return -1;
        if (!a.isM3u8 && b.isM3u8) return 1;
        return 0;
      });

      const primary = videoSources[0];
      const downloadUrl = primary.url;

      const result: VideoInfo = {
        title: fileInfo.title || fileInfo.fileName || `LuluStream - ${fileId}`,
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
    console.error('Error parsing LuluStream after variants:', lastError);
    throw lastError;
  }

  throw new Error('Could not extract video from LuluStream. File may be deleted or format changed.');
}
