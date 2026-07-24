import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { detectPacked, unpackPacked } from './unpacker';

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

const CORS_PROXIES = [
  'https://api.allorigins.win/raw?url=',
  'https://api.codetabs.com/v1/proxy/?quest=',
];

export function isMixDropUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return MIXDROP_DOMAINS.some(domain => hostname === domain || hostname.endsWith('.' + domain));
  } catch {
    return false;
  }
}

export function extractFileId(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/^\/(?:f|v|e)\/([a-zA-Z0-9]+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export { MIXDROP_DOMAINS };

/**
 * Fetch a URL with fallback to CORS proxies if direct connection fails
 */
async function fetchWithFallback(url: string, retries = 2): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Referer': 'https://mixdrop.co/',
      },
    });
    clearTimeout(timeout);
    return response;
  } catch (directError) {
    clearTimeout(timeout);
    
    // Try CORS proxies as fallback
    for (const proxy of CORS_PROXIES) {
      try {
        const proxyController = new AbortController();
        const proxyTimeout = setTimeout(() => proxyController.abort(), 20000);
        
        const proxyResponse = await fetch(`${proxy}${encodeURIComponent(url)}`, {
          signal: proxyController.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          },
        });
        clearTimeout(proxyTimeout);
        
        if (proxyResponse.ok) {
          return proxyResponse;
        }
      } catch {
        // Try next proxy
        continue;
      }
    }

    // If all proxies failed, throw the original error
    throw directError;
  }
}

/**
 * Unpack eval-packed JavaScript
 */
function unpackJs(code: string): string | null {
  try {
    if (detectPacked(code)) {
      return unpackPacked(code);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract video sources from the unpacked JavaScript code
 */
function extractFromUnpackedCode(code: string): VideoSource[] {
  const sources: VideoSource[] = [];

  const wurlMatch = code.match(/wurl\s*=\s*"([^"]+)"/);
  if (wurlMatch) {
    let url = wurlMatch[1];
    if (url.startsWith('//')) url = 'https:' + url;
    if (!url.startsWith('http')) url = 'https://' + url;
    
    const isM3u8 = url.includes('.m3u8');
    sources.push({
      url: url.replace(/&amp;/g, '&'),
      quality: 'Auto',
      format: isM3u8 ? 'HLS (m3u8)' : 'MP4',
      isM3u8,
    });
  }

  const filePatterns = [
    /["']file["']\s*:\s*["'](https?:\/\/[^"']+)["']/gi,
    /["']file["']\s*:\s*["'](\/\/[^"']+)["']/gi,
  ];

  for (const pattern of filePatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(code)) !== null) {
      let url = match[1];
      if (url.startsWith('//')) url = 'https:' + url;
      const isM3u8 = url.includes('.m3u8');
      if (!sources.some(s => s.url === url)) {
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

/**
 * Find and unpack all packed scripts in the HTML
 */
function processScripts($: cheerio.CheerioAPI): VideoSource[] {
  const allSources: VideoSource[] = [];

  $('script').each((_: number, el: any) => {
    try {
      const text = $(el).html() || '';
      if (!text) return;

      if (text.includes('eval(function') || text.includes('function(p,a,c,k,e,d)')) {
        const unpacked = unpackJs(text);
        if (unpacked) {
          const sources = extractFromUnpackedCode(unpacked);
          allSources.push(...sources);
        }
      } else {
        const sources = extractVideoUrlsFromText(text);
        allSources.push(...sources);
      }
    } catch {
      // Skip scripts that error
    }
  });

  return allSources;
}

/**
 * Extract video URLs from plain JavaScript text
 */
function extractVideoUrlsFromText(text: string): VideoSource[] {
  const sources: VideoSource[] = [];
  
  const patterns = [
    /["']file["']\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi,
    /["']src["']\s*[:=]\s*["'](https?:\/\/[^"']+)["']/gi,
    /video_url\s*=\s*["'](https?:\/\/[^"']+)["']/gi,
    /(https?:\/\/[^\s"'<>]+\.(?:mp4|m3u8)(?:[^\s"'<>]*))/gi,
    /(https?:\/\/[^\s"'<>]*mxcontent\.net[^\s"'<>]*(?:\.mp4|\.m3u8)?[^\s"'<>]*)/gi,
  ];

  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const url = (match[1] || match[0] || '').trim();
      if (url && !sources.some(s => s.url === url) && url.length > 10) {
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

/**
 * Extract video sources from HTML tags
 */
function extractVideoFromHTML($: cheerio.CheerioAPI): VideoSource[] {
  const sources: VideoSource[] = [];

  $('video').each((_: number, videoEl: any) => {
    const $video = $(videoEl);
    
    const src = $video.attr('src');
    if (src && (src.includes('.mp4') || src.includes('.m3u8') || src.startsWith('http'))) {
      sources.push({
        url: src,
        quality: 'Auto',
        format: src.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
        isM3u8: src.includes('.m3u8'),
      });
    }

    $video.find('source').each((_: number, sourceEl: any) => {
      const $source = $(sourceEl);
      const srcUrl = $source.attr('src');
      if (srcUrl) {
        sources.push({
          url: srcUrl,
          quality: $source.attr('label') || $source.attr('title') || 'Auto',
          format: srcUrl.includes('.m3u8') ? 'HLS (m3u8)' : ($source.attr('type') || 'MP4'),
          isM3u8: srcUrl.includes('.m3u8'),
        });
      }
    });
  });

  $('iframe').each((_: number, el: any) => {
    const src = $(el).attr('src');
    if (src && src.includes('mixdrop')) {
      sources.push({ url: src, quality: 'Auto', format: 'Embed', isM3u8: false });
    }
  });

  return sources;
}

/**
 * Extract file info from the page
 */
function extractFileInfo($: cheerio.CheerioAPI, html: string, url: string, fileId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text()
    .replace('MixDrop - Watch ', '')
    .replace('MixDrop - ', '')
    .trim();

  const fileNameMatch = html.match(/\*\*([^*]+\.(?:mp4|mkv|avi|mov|webm|m4v))\*\*/);
  if (fileNameMatch) {
    fileName = fileNameMatch[1].trim();
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
    thumbnail = $(el).attr('content') || thumbnail;
  });

  if (!thumbnail) {
    $('img').each((_: number, el: any) => {
      const src = $(el).attr('src') || '';
      if (src.includes('mxcontent.net') && src.includes('thumbs')) {
        thumbnail = src;
      }
    });
  }

  if (!thumbnail) {
    const thumbMatch = html.match(/(https?:\/\/[^\s"'<]+\/thumbs\/[^\s"'<]+\.(?:jpg|png|webp))/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
  }

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

/**
 * Main function to parse a MixDrop page
 */
export async function parseMixDrop(url: string): Promise<VideoInfo | null> {
  if (!isMixDropUrl(url)) return null;

  const fileId = extractFileId(url);
  if (!fileId) return null;

  try {
    const response = await fetchWithFallback(url);
    const html = await response.text();
    const $ = cheerio.load(html);

    const fileInfo = extractFileInfo($, html, url, fileId);
    const htmlSources = extractVideoFromHTML($);
    const scriptSources = processScripts($);
    const textSources = extractVideoUrlsFromText(html);

    // Combine all sources, deduplicated
    const allSources = [...htmlSources];
    for (const source of [...scriptSources, ...textSources]) {
      if (!allSources.some(s => s.url === source.url)) {
        allSources.push(source);
      }
    }

    const downloadUrl = `${url}?download`;
    const downloadLinkMatch = html.match(/href="([^"]+\?download)"/i);
    if (downloadLinkMatch) {
      const dlUrl = downloadLinkMatch[1].startsWith('http')
        ? downloadLinkMatch[1]
        : `https://${new URL(url).hostname}${downloadLinkMatch[1]}`;
      if (!allSources.some(s => s.url === dlUrl)) {
        allSources.push({ url: dlUrl, quality: 'Direct', format: 'Download', isM3u8: false });
      }
    }

    if (!allSources.some(s => s.url === downloadUrl)) {
      allSources.push({ url: downloadUrl, quality: 'Direct', format: 'Download', isM3u8: false });
    }

    // Clean URLs
    for (const source of allSources) {
      source.url = source.url.replace(/&amp;/g, '&');
    }

    return {
      title: fileInfo.title || fileInfo.fileName || `MixDrop - ${fileId}`,
      fileName: fileInfo.fileName || `${fileId}.mp4`,
      fileSize: fileInfo.fileSize || 'Unknown',
      fileSizeBytes: fileInfo.fileSizeBytes,
      thumbnail: fileInfo.thumbnail || '',
      sources: allSources,
      originalUrl: url,
      downloadUrl,
    };
  } catch (error) {
    console.error('Error parsing MixDrop URL:', error);
    throw error;
  }
}
