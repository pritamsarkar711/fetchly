/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { fetchPublicUrl, readResponseText } from '../proxy-utils';
import { detectPacked, unpackAllLayers } from './unpacker';

const MIXDROP_DOMAINS = [
  'mixdrop.co', 'mixdrop.to', 'mixdrop.sx', 'mixdrop.bz',
  'mixdrop.ch', 'mixdrop.club', 'mixdrop.gl', 'mixdrop.vc',
  'mixdrop.ag', 'mixdrop.nu', 'miiiixdrop.net', 'mixdrop.ps',
  'mixdrop.is', 'mixdrop.cc', 'mixdrop.sh', 'mixdrop.ms',
  'mixdrop.biz', 'mixdrop.gg', 'mixdrop.vg', 'mixdrop.xyz',
  'mixdrop.si', 'mixdrop.ma', 'mixdrop.la', 'mixdrop.ws',
  'mixdrop.yt', 'mixdrop.fr', 'mixdrop.eu', 'mixdrop.uk',
  'mixdrop.de', 'mixdrop.li', 'mixdrop.lt', 'mixdrop.tv',
  'mixdrop.tk', 'mixdrop.ga', 'mixdrop.gq', 'mixdrop.ml',
  'mixdrop.cf',
];

const FETCH_TIMEOUT = 12_000;

export function isMixDropUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return MIXDROP_DOMAINS.some(domain =>
      hostname === domain || hostname.endsWith('.' + domain)
    );
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/^\/(?:f|v|e)\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { MIXDROP_DOMAINS };

async function fetchWithFallback(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const response = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
        'Referer': `${new URL(url).origin}/`,
        'Cache-Control': 'no-cache',
      },
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

/**
 * Generic extraction of MDCore.* variables
 * MixDrop uses many var names: wurl, furl, vsrc, vsrc1, surl, etc.
 * Example: MDCore.wurl="https://...", MDCore.furl="//...", MDCore.vsrc="..."
 */
function extractMDCoreUrls(code: string): string[] {
  const urls: string[] = [];
  // Pattern: MDCore.<any>="url"
  const mdcoreRegex = /MDCore\.(\w+)\s*=\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = mdcoreRegex.exec(code)) !== null) {
    const varName = m[1];
    const val = m[2];
    // Filter those likely to be video urls or useful
    // Common naming includes: wurl, furl, vsrc, vfile, vurl, url, poster, etc.
    // We want wurl/furl/vsrc/surl etc, or any that contains .mp4, .m3u8, mxcontent, delivery
    if (
      /^(wurl|furl|vsrc|surl|url|vfile|file|src)$/i.test(varName) ||
      /url|src|file/i.test(varName) && (val.includes('.mp4') || val.includes('.m3u8') || val.includes('mxcontent') || val.includes('mxdcontent') || val.includes('delivery') || val.startsWith('//') || val.startsWith('http'))
      || (val.includes('.mp4') || val.includes('.m3u8'))
    ) {
      if (val.length > 5) urls.push(val);
    }
  }
  return urls;
}

function extractFromUnpackedCode(code: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  // First, collect MDCore urls
  const mdcoreUrls = extractMDCoreUrls(code);
  for (const raw of mdcoreUrls) {
    let url = raw.trim();
    if (url.startsWith('//')) url = 'https:' + url;
    else if (!url.startsWith('http')) {
      // If it's relative or missing protocol but looks like domain, fix
      if (url.includes('mxcontent') || url.includes('mxdcontent') || url.includes('.mp4') || url.includes('.m3u8')) {
        if (!url.startsWith('http')) url = 'https://' + url.replace(/^\/\//, '');
      } else {
        continue;
      }
    }
    url = url.replace(/&amp;/g, '&');
    // Only add if looks like video file
    if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('mxcontent') || url.includes('mxdcontent')) {
      const normalized = url.toLowerCase();
      if (!seen.has(normalized)) {
        seen.add(normalized);
        const isM3u8 = url.includes('.m3u8');
        sources.push({
          url,
          quality: 'HD',
          format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
          isM3u8,
        });
      }
    }
  }

  // Fallback patterns if MDCore didn't catch
  if (sources.length === 0) {
    const wurlMatch = code.match(/wurl\s*=\s*["']([^"']+)["']/i) || code.match(/furl\s*=\s*["']([^"']+)["']/i) || code.match(/vsrc\d*\s*=\s*["']([^"']+)["']/i);
    if (wurlMatch) {
      let url = wurlMatch[1];
      if (url.startsWith('//')) url = 'https:' + url;
      else if (!url.startsWith('http')) url = 'https://' + url;
      if (!seen.has(url.toLowerCase())) {
        seen.add(url.toLowerCase());
        const isM3u8 = url.includes('.m3u8');
        sources.push({
          url: url.replace(/&amp;/g, '&'),
          quality: 'Auto',
          format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
          isM3u8,
        });
      }
    }
  }

  // Additional file patterns
  const filePatterns = [
    /["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
    /["']file["']\s*:\s*["'](\/\/[^"']+)["']/gi,
    /["']src["']\s*:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
  ];

  for (const pattern of filePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      let url = match[1];
      if (url.startsWith('//')) url = 'https:' + url;
      const key = url.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        const isM3u8 = url.includes('.m3u8');
        sources.push({
          url: url.replace(/&amp;/g, '&'),
          quality: 'Auto',
          format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
          isM3u8,
        });
      }
    }
  }

  return sources;
}

function processScripts($: cheerio.CheerioAPI): VideoSource[] {
  const allSources: VideoSource[] = [];
  const processedHashes = new Set<string>();

  $('script').each((_: number, el: any) => {
    try {
      const text = $(el).html() || $(el).text() || '';
      if (!text || text.length < 10) return;

      // Skip very large analytics scripts quickly if not containing clues
      if (text.length > 20000 && !/(MDCore|eval\(function|wurl|furl|vsrc|mxcontent|mxdcontent|\.mp4|\.m3u8)/i.test(text)) {
        return;
      }

      const trimmed = text.trim();
      // Deduplicate identical scripts
      const hash = trimmed.slice(0, 200);
      if (processedHashes.has(hash)) return;
      processedHashes.add(hash);

      if (trimmed.includes('eval(function') || trimmed.includes('function(p,a,c,k,e,')) {
        const unpacked = unpackJs(trimmed);
        if (unpacked) {
          const sources = extractFromUnpackedCode(unpacked);
          allSources.push(...sources);
          // Also try extracting any direct video urls from unpacked text
          const direct = extractVideoUrlsFromText(unpacked);
          allSources.push(...direct);
        } else {
          // Even if unpack fails, try direct extraction
          const sources = extractFromUnpackedCode(trimmed);
          allSources.push(...sources);
        }
      } else {
        // Not packed, check if contains MDCore or video hints
        if (/(MDCore|wurl|furl|vsrc|mxcontent|mxdcontent|\.mp4)/i.test(trimmed)) {
          const sources = extractFromUnpackedCode(trimmed);
          allSources.push(...sources);
          const direct = extractVideoUrlsFromText(trimmed);
          allSources.push(...direct);
        } else {
          const sources = extractVideoUrlsFromText(trimmed);
          if (sources.length > 0) allSources.push(...sources);
        }
      }
    } catch {
      // skip
    }
  });

  return allSources;
}

function extractVideoUrlsFromText(text: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const patterns = [
    // Full https URLs ending with mp4/m3u8
    /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/gi,
    // Protocol-relative
    /(\/\/[^\s"'<>]*mxdcontent[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]*mxcontent[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
    /(\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
    // mxdcontent domains with any path (may include query string with s= and e=)
    /(https?:\/\/[^\s"'<>]*mxdcontent[^\s"'<>]+\.mp4[^\s"'<>]*)/gi,
    /(https?:\/\/[^\s"'<>]*mxcontent[^\s"'<>]+(?:\.mp4)?[^\s"'<>]*)/gi,
    // s-delivery pattern
    /(https?:\/\/s-delivery[^\s"'<>]+\.mxdcontent\.net\/v\/[^\s"'<>]+\.mp4[^\s"'<>]*)/gi,
    // Generic MDCore furl/wurl already covered but catch any //...
    /(https?:\/\/[^\s"'<>]*delivery[^\s"'<>]*\.mp4[^\s"'<>]*)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      let url = (match[1] || match[0] || '').trim();
      if (!url) continue;
      // Clean trailing punctuation
      url = url.replace(/[",';\]]+$/, '');
      if (url.startsWith('//')) url = 'https:' + url;
      if (url.length < 15) continue;
      // Must be http(s)
      if (!url.startsWith('http')) continue;
      const key = url.toLowerCase();
      if (seen.has(key)) continue;
      // Basic validation: should contain mp4/m3u8/mxdcontent/mxcontent
      if (!(url.includes('.mp4') || url.includes('.m3u8') || url.includes('mxdcontent') || url.includes('mxcontent'))) continue;
      seen.add(key);
      url = url.replace(/&amp;/g, '&');
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url,
        quality: 'HD',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  // Also look for JSON-like file:"https://..."
  const jsonPattern = /file\s*:\s*["'](https?:\/\/[^"']+)["']/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonPattern.exec(text)) !== null) {
    let url = jm[1];
    if (url.startsWith('//')) url = 'https:' + url;
    const key = url.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('mxcontent')) {
      const isM3u8 = url.includes('.m3u8');
      sources.push({
        url: url.replace(/&amp;/g, '&'),
        quality: 'Auto',
        format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
        isM3u8,
      });
    }
  }

  return sources;
}

function extractVideoFromHTML($: cheerio.CheerioAPI): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  $('video').each((_: number, videoEl: any) => {
    const $video = $(videoEl);
    const src = $video.attr('src');
    if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.includes('mxcontent') || src.startsWith('http'))) {
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

  return sources;
}

function extractFileInfo($: cheerio.CheerioAPI, html: string, _url: string, fileId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text()
    .replace('MixDrop - Watch ', '')
    .replace('MixDrop - ', '')
    .trim();

  const fileNameMatch = html.match(/\*\*([^*]+\.(?:mp4|mkv|avi|mov|webm|m4v))\*\*/i);
  if (fileNameMatch) {
    fileName = fileNameMatch[1].trim();
  }

  // Fallback: try og:title or h3 or .file-name
  if (!fileName) {
    const ogTitle = $('meta[property="og:title"]').attr('content') || '';
    if (ogTitle && ogTitle.includes('.')) {
      fileName = ogTitle.trim();
    } else {
      const h2 = $('h2').first().text().trim();
      if (h2 && h2.length < 200) fileName = h2;
    }
  }

  const sizeMatch = html.match(/([\d.]+)\s*(MB|GB|KB)/i);
  if (sizeMatch) {
    fileSize = sizeMatch[0].trim();
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit === 'GB') fileSizeBytes = num * 1024 * 1024 * 1024;
    else if (unit === 'MB') fileSizeBytes = num * 1024 * 1024;
    else if (unit === 'KB') fileSizeBytes = num * 1024;
  }

  $('meta[property="og:image"], meta[name="twitter:image"]').each((_: number, el: any) => {
    const content = $(el).attr('content');
    if (content) thumbnail = content;
  });

  if (!thumbnail) {
    $('img').each((_: number, el: any) => {
      const src = $(el).attr('src') || '';
      if (src.includes('mxcontent.net') && src.includes('thumbs') || src.includes('mxdcontent') && src.includes('thumbs')) {
        thumbnail = src.startsWith('http') ? src : `https:${src}`;
      }
    });
  }

  if (!thumbnail) {
    const thumbMatch = html.match(/(https?:\/\/[^\s"'<]+\/thumbs\/[^\s"'<]+\.(?:jpg|png|webp))/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
    else {
      const thumbMatch2 = html.match(/(\/\/[^\s"'<]+\/thumbs\/[^\s"'<]+\.(?:jpg|png|webp))/i);
      if (thumbMatch2) thumbnail = 'https:' + thumbMatch2[1];
    }
  }

  if (!fileName) fileName = title || `${fileId}.mp4`;
  if (!title) title = fileName;

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

function deduplicateSources(sources: VideoSource[]): VideoSource[] {
  const seen = new Set<string>();
  return sources.filter(source => {
    // Normalize for deduplication
    let key = source.url.toLowerCase().trim();
    // Remove query params that are not signature? Keep full for dedup but lower
    // For dedup, ignore protocol differences // vs https
    key = key.replace(/^https?:/, '').replace(/^\/\//, '');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeUrl(raw: string): string {
  let url = raw.replace(/&amp;/g, '&').trim();
  if (url.startsWith('//')) url = 'https:' + url;
  // Fix double https://
  url = url.replace(/^(https:){2,}/, 'https://');
  return url;
}

function isTrueVideoUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Exclude mixdrop pages
  if (lower.includes('mixdrop.') && (lower.includes('/f/') || lower.includes('/e/')) && !lower.includes('.mp4') && !lower.includes('.m3u8')) {
    return false;
  }
  if (lower.includes('?download') && !lower.includes('.mp4') && !lower.includes('.m3u8')) {
    return false;
  }
  // Must contain video indicators
  return lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('mxdcontent') || lower.includes('mxcontent') || lower.includes('delivery');
}

export async function parseMixDrop(url: string): Promise<VideoInfo | null> {
  if (!isMixDropUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  // Prepare variant URLs: try /e/ and /f/ both to maximize chance
  const variants = new Set<string>();
  variants.add(url);
  if (url.includes('/f/')) variants.add(url.replace('/f/', '/e/'));
  if (url.includes('/e/')) variants.add(url.replace('/e/', '/f/'));

  let lastError: any = null;
  const bestResult: VideoInfo | null = null;

  for (const variantUrl of variants) {
    try {
      const response = await fetchWithFallback(variantUrl);
      const html = await readResponseText(response, 2_000_000);
      if (!html || html.length < 100) {
        throw new Error('Empty or invalid response from MixDrop');
      }

      // Early check for file not found
      if (html.includes('WE ARE SORRY') || html.includes('File Not Found') || html.includes('404 Not Found') || html.toLowerCase().includes('file was deleted')) {
        // continue trying other variants
        continue;
      }

      const $ = cheerio.load(html);

      const fileInfo = extractFileInfo($, html, variantUrl, fileId);
      const htmlSources = extractVideoFromHTML($);
      const scriptSources = processScripts($);
      const textSources = extractVideoUrlsFromText(html);

      // Combine
      let allSources: VideoSource[] = [...htmlSources];

      const addIfNew = (src: VideoSource) => {
        if (!allSources.some(s => normalizeUrl(s.url).toLowerCase() === normalizeUrl(src.url).toLowerCase())) {
          allSources.push(src);
        }
      };
      for (const s of [...scriptSources, ...textSources]) {
        addIfNew(s);
      }

      // Normalize
      allSources = allSources.map(s => ({ ...s, url: normalizeUrl(s.url) }));

      // Filter to only true video URLs (exclude ?download pages)
      let videoSources = allSources.filter(s => isTrueVideoUrl(s.url));

      // If after filtering we have nothing, keep original (might still be usable)
      if (videoSources.length === 0) {
        // Try to see if any source contains mxcontent even if not .mp4
        const mxSources = allSources.filter(s => s.url.includes('mxcontent') || s.url.includes('mxdcontent'));
        if (mxSources.length > 0) videoSources = mxSources;
        else videoSources = allSources.filter(s => !s.url.includes('mixdrop.co') || s.url.includes('.mp4'));
      }

      // Deduplicate
      videoSources = deduplicateSources(videoSources);

      // If still empty, try next variant
      if (videoSources.length === 0) {
        // keep parsing but not return yet
        continue;
      }

      // Sort: MP4 first, then prioritize HD, then M3U8
      videoSources.sort((a, b) => {
        if (a.isM3u8 && !b.isM3u8) return 1;
        if (!a.isM3u8 && b.isM3u8) return -1;
        return 0;
      });

      // The direct video URL is the first MP4
      const primaryMp4 = videoSources.find(s => !s.isM3u8 && s.url.includes('.mp4')) || videoSources[0];
      const directVideoUrl = primaryMp4 ? primaryMp4.url : videoSources[0].url;

      // Build downloadUrl as direct video url (not ?download page)
      // Frontend will proxy it via /api/download
      const downloadUrl = directVideoUrl;

      const result: VideoInfo = {
        title: fileInfo.title || fileInfo.fileName || `MixDrop - ${fileId}`,
        fileName: fileInfo.fileName || `${fileId}.mp4`,
        fileSize: fileInfo.fileSize || 'Unknown',
        fileSizeBytes: fileInfo.fileSizeBytes,
        thumbnail: fileInfo.thumbnail || '',
        sources: videoSources,
        originalUrl: url,
        downloadUrl, // now direct video URL, not MixDrop page
      };

      // If we found a result, return immediately (prefer first successful)
      return result;
    } catch (error) {
      lastError = error;
      continue;
    }
  }

  // If we tried all variants and none succeeded, throw last error
  if (lastError) {
    console.error('Error parsing MixDrop URL after trying variants:', lastError);
    throw lastError;
  }

  // As ultimate fallback, try returning minimal info with ?download if nothing found
  // but this should be avoided for watch; yet return something for debug
  if (bestResult) return bestResult;

  throw new Error('Could not extract video from MixDrop. The file may be deleted or the page format changed.');
}
