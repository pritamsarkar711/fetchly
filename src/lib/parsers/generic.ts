/* eslint-disable @typescript-eslint/no-explicit-any */
import * as cheerio from 'cheerio';
import { VideoInfo, VideoSource } from '../types';
import { fetchPublicUrl, readResponseText } from '../proxy-utils';
import { detectPacked, unpackAllLayers } from './unpacker';

const FETCH_TIMEOUT = 22_000;

async function fetchWithFallback(url: string, referer?: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const ref = referer || url;
    
    // Attempt FlareSolverr bypass if configured
    if (process.env.FLARESOLVERR_URL) {
      try {
        const fsResponse = await fetch(process.env.FLARESOLVERR_URL + '/v1', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cmd: 'request.get',
            url: url,
            maxTimeout: 10000
          })
        });
        if (fsResponse.ok) {
          const fsData = await fsResponse.json();
          if (fsData.solution?.response) {
            return new Response(fsData.solution.response, {
              status: 200,
              headers: { 'content-type': 'text/html' }
            });
          }
        }
      } catch (err) {
        console.error('FlareSolverr error:', err);
      }
    }

    const response = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.8',
        'Referer': ref,
        'Cache-Control': 'no-cache',
      },
    });
    if (!response.ok) throw new Error(`Source returned ${response.status}`);
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeUrl(raw: string, baseUrl?: string): string {
  let url = raw
    .replace(/&amp;/g, '&')
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\x26/gi, '&')
    .trim();
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  if (baseUrl && !url.startsWith('http') && !url.startsWith('//') && !url.startsWith('data:') && !url.startsWith('blob:')) {
    try {
      url = new URL(url, baseUrl).toString();
    } catch {}
  }
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

function extractFileInfo($: cheerio.CheerioAPI, html: string, url: string, fallbackId: string) {
  let title = '';
  let fileName = '';
  let fileSize = '';
  let fileSizeBytes = 0;
  let thumbnail = '';

  title = $('title').text().trim();
  // Clean common suffixes
  title = title.replace(/\s*[|·-]\s*(Watch|Video|Streamtape|LuluStream|Vidara|FireStream|Playmate|MixDrop).*$/i, '').trim();
  if (!title || title.length < 2 || title.toLowerCase() === 'video' || title.toLowerCase().includes('not found')) {
    title = $('meta[property="og:title"]').attr('content') || $('meta[name="twitter:title"]').attr('content') || '';
  }
  if (!title) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300) title = h1;
  }

  // FileName from title or og
  fileName = title || $('meta[property="og:video"]').attr('content')?.split('/').pop() || '';
  if (!fileName) {
    const h1 = $('h1').first().text().trim();
    if (h1 && h1.length < 300) fileName = h1;
  }

  // Size
  const sizeMatch = html.match(/([\d.]+)\s*(MB|GB|KB|MiB|GiB)/i);
  if (sizeMatch) {
    fileSize = sizeMatch[0].trim();
    const num = parseFloat(sizeMatch[1]);
    const unit = sizeMatch[2].toUpperCase();
    if (unit.startsWith('GB') || unit.startsWith('GI')) fileSizeBytes = num * 1024 * 1024 * 1024;
    else if (unit.startsWith('MB') || unit.startsWith('MI')) fileSizeBytes = num * 1024 * 1024;
    else if (unit.startsWith('KB') || unit.startsWith('KI')) fileSizeBytes = num * 1024;
  }

  // Thumbnail
  thumbnail = $('meta[property="og:image"]').attr('content') || $('meta[name="twitter:image"]').attr('content') || $('link[rel="image_src"]').attr('href') || '';
  if (!thumbnail) {
    // Try first image that looks like thumb/poster
    $('img').each((_: number, el: any) => {
      if (thumbnail) return;
      const src = $(el).attr('src') || '';
      const alt = ($(el).attr('alt') || '').toLowerCase();
      if (src && (src.includes('thumb') || src.includes('poster') || src.includes('preview') || alt.includes('thumb') || src.match(/\.(jpg|jpeg|png|webp)$/i))) {
        if (src.startsWith('http')) thumbnail = src;
        else if (src.startsWith('//')) thumbnail = 'https:' + src;
      }
    });
  }
  if (!thumbnail) {
    const thumbMatch = html.match(/(https?:\/\/[^\s"'<]+\.(?:jpg|jpeg|png|webp))/i);
    if (thumbMatch) thumbnail = thumbMatch[1];
  }

  if (!fileName) fileName = title || `${fallbackId}.mp4`;
  if (!title) title = fileName;

  // Ensure extension
  if (!fileName.includes('.')) fileName += '.mp4';

  return { title, fileName, fileSize, fileSizeBytes, thumbnail };
}

function extractVideoSourcesFromHtml($: cheerio.CheerioAPI, html: string, baseUrl: string): VideoSource[] {
  const sources: VideoSource[] = [];
  const seen = new Set<string>();

  const addSource = (rawUrl: string, quality = 'HD', format?: string) => {
    if (!rawUrl) return;
    const url = normalizeUrl(rawUrl, baseUrl);
    if (!url || !url.startsWith('http')) return;
    // Filter out obviously non-video
    const lower = url.toLowerCase();
    if (lower.match(/\.(css|js|json|xml|html|php)(\?|$)/) && !lower.includes('.m3u8') && !lower.includes('.mp4')) return;
    // Must contain video-like extension or known patterns
    const isVideo = lower.includes('.mp4') || lower.includes('.m3u8') || lower.includes('.webm') || lower.includes('.mov') || lower.includes('.avi') || lower.includes('.mkv') || lower.includes('.m4v') || lower.includes('.ts') || lower.includes('get_video') || lower.includes('/videos/') || lower.includes('master.m3u8') || lower.includes('.urlset') || lower.includes('hls') || lower.includes('mp4') || lower.includes('m3u8');
    if (!isVideo) return;
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const isM3u8 = lower.includes('.m3u8');
    const isMp4 = lower.includes('.mp4');
    sources.push({
      url,
      quality,
      format: format || (isM3u8 ? 'HLS (m3u8)' : isMp4 ? 'MP4' : 'Video'),
      isM3u8,
    });
  };

  // 1. <video> and <source> tags
  $('video').each((_: number, videoEl: any) => {
    const $video = $(videoEl);
    const src = $video.attr('src');
    if (src) addSource(src);
    $video.find('source').each((_: number, sourceEl: any) => {
      const $source = $(sourceEl);
      const srcUrl = $source.attr('src');
      const label = $source.attr('label') || $source.attr('title') || $source.attr('res') || 'HD';
      if (srcUrl) addSource(srcUrl, label);
    });
  });

  $('source').each((_: number, el: any) => {
    const src = $(el).attr('src');
    if (src) {
      const label = $(el).attr('label') || $(el).attr('title') || 'HD';
      addSource(src, label);
    }
  });

  // 2. Open Graph video meta
  const ogVideo = $('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]').attr('content');
  if (ogVideo) addSource(ogVideo);

  const twitterStream = $('meta[name="twitter:player:stream"], meta[property="twitter:player:stream"]').attr('content');
  if (twitterStream) addSource(twitterStream);

  // 3. JSON-LD
  $('script[type="application/ld+json"]').each((_: number, el: any) => {
    try {
      const text = $(el).html() || '';
      if (!text) return;
      const json = JSON.parse(text);
      const objs = Array.isArray(json) ? json : [json];
      for (const obj of objs) {
        if (!obj) continue;
        // Check common fields
        const candidates = [
          obj.contentUrl,
          obj.embedUrl,
          obj.url,
          obj.video?.contentUrl,
          obj.video?.embedUrl,
        ];
        for (const c of candidates) {
          if (typeof c === 'string') addSource(c);
        }
        // If @graph
        if (obj['@graph']) {
          for (const g of obj['@graph']) {
            if (g.contentUrl) addSource(g.contentUrl);
            if (g.embedUrl) addSource(g.embedUrl);
          }
        }
      }
    } catch {}
  });

  // 4. Search for common player setups in scripts (jwplayer, videojs, playerjs, etc)
  const scriptPatterns = [
    /sources:\s*\[{file:\s*["']([^"']+)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /file:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi,
    /src:\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /hlsUrl["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /videoUrl["']?\s*[:=]\s*["']([^"']+)["']/gi,
    /source["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.(?:mp4|m3u8)[^"']*)["']/gi,
    /mp4["']?\s*[:=]\s*["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi,
    /(?:file|src|source)["']?\s*[:=]\s*["'](https?:\/\/[^"']+\/(?:hls|hls2)\/[^"']+\.txt[^"']*)["']/gi,
  ];

  const allScriptText: string[] = [];
  $('script').each((_: number, el: any) => {
    const txt = $(el).html() || $(el).text() || '';
    if (txt) allScriptText.push(txt);
  });
  allScriptText.push(html); // also search whole html

  for (const scriptText of allScriptText) {
    // JSON embedded in pages often escapes URL slashes and ampersands.
    let workingText = scriptText.replace(/\\\//g, '/').replace(/\\u0026/gi, '&').replace(/\\x26/gi, '&');
    // Unpack if packed
    if (scriptText.includes('eval(function') || scriptText.includes('function(p,a,c,k,e,')) {
      try {
        if (detectPacked(scriptText)) {
          const unpacked = unpackAllLayers(scriptText, 3);
          if (unpacked) workingText = unpacked + '\n' + scriptText;
        }
      } catch {}
    }

    for (const pat of scriptPatterns) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(workingText)) !== null) {
        if (m[1]) addSource(m[1]);
      }
    }

    // Generic URL regex for mp4, m3u8, webm, mov, etc.
    const genericPatterns = [
      /(https?:\/\/[^\s"'<>]+\.m3u8(?:\?[^\s"'<>]*)?)/gi,
      /(https?:\/\/[^\s"'<>]+\.mp4(?:\?[^\s"'<>]*)?)/gi,
      /(https?:\/\/[^\s"'<>]+\.webm(?:\?[^\s"'<>]*)?)/gi,
      /(https?:\/\/[^\s"'<>]+\.(?:mov|avi|mkv|m4v)(?:\?[^\s"'<>]*)?)/gi,
      /(https?:\/\/[^\s"'<>]*\/get_video\?id=[^\s"'<>]+)/gi,
      /(https?:\/\/[^\s"'<>]*\.urlset\/master\.m3u8[^\s"'<>]*)/gi,
      /(https?:\/\/[^\s"'<>]*\/(?:hls|hls2)\/[^\s"'<>]+\.txt(?:\?[^\s"'<>]*)?)/gi,
    ];

    for (const pat of genericPatterns) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(workingText)) !== null) {
        const url = m[1] || m[0];
        addSource(url);
      }
    }

    // Try decoding Base64 strings that look long enough to be URLs
    const b64Regex = /(?:["']|atob\()([a-zA-Z0-9+/]{30,}={0,2})(?:["']|\))/g;
    let b64Match: RegExpExecArray | null;
    while ((b64Match = b64Regex.exec(workingText)) !== null) {
      try {
        const decoded = Buffer.from(b64Match[1], 'base64').toString('utf8');
        if (decoded.startsWith('http') && (decoded.includes('.mp4') || decoded.includes('.m3u8') || decoded.includes('.webm') || decoded.includes('.txt'))) {
          addSource(decoded);
        }
      } catch {}
    }

    // Protocol-relative
    const protoPatterns = [
      /(\/\/[^\s"'<>]*\.m3u8(?:\?[^\s"'<>]*)?)/gi,
      /(\/\/[^\s"'<>]*\.mp4(?:\?[^\s"'<>]*)?)/gi,
      /(\/\/[^\s"'<>]*\/get_video\?id=[^\s"'<>]+)/gi,
    ];
    for (const pat of protoPatterns) {
      pat.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = pat.exec(workingText)) !== null) {
        const url = m[1] || m[0];
        addSource(url);
      }
    }
  }

  // 5. Iframe embedding – collect iframe src that might be video host
  $('iframe, div, span, video, source').each((_: number, el: any) => {
    const attrs = ['src', 'data-src', 'data-url', 'data-video', 'data-file', 'data-hls'];
    for (const attr of attrs) {
      const src = $(el).attr(attr);
      if (src && src.startsWith('http') && !src.includes('google') && !src.includes('facebook') && !src.includes('twitter') && !src.includes('recaptcha')) {
        const normalized = normalizeUrl(src, baseUrl);
        
        // If it looks like a direct video link, add it as a source
        if (normalized.includes('.mp4') || normalized.includes('.m3u8') || normalized.includes('get_video')) {
          addSource(normalized);
        }
      }
    }
  });

  return sources;
}

async function tryIframeExtraction($: cheerio.CheerioAPI, baseUrl: string, depth = 0): Promise<VideoSource[]> {
  if (depth > 1) return []; // limit recursion
  const iframeSources: VideoSource[] = [];
  const iframes: string[] = [];

  $('iframe, div, span').each((_: number, el: any) => {
    const attrs = ['src', 'data-src', 'data-url', 'data-video', 'data-file', 'data-hls'];
    for (const attr of attrs) {
      const src = $(el).attr(attr);
      if (src) {
        const normalized = normalizeUrl(src, baseUrl);
        if (normalized.startsWith('http') && !normalized.includes('google') && !normalized.includes('facebook') && !normalized.includes('twitter') && !normalized.includes('recaptcha')) {
          iframes.push(normalized);
        }
      }
    }
  });

  // Try first 2 iframes
  for (const iframeUrl of iframes.slice(0, 2)) {
    try {
      const res = await fetchWithFallback(iframeUrl, baseUrl);
      const html = await readResponseText(res, 2_000_000);
      if (!html) continue;
      const $inner = cheerio.load(html);
      const innerSources = extractVideoSourcesFromHtml($inner, html, iframeUrl);
      iframeSources.push(...innerSources);

      // Recurse one more level if needed and no sources found yet
      if (innerSources.length === 0 && depth === 0) {
        const deeper = await tryIframeExtraction($inner, iframeUrl, depth + 1);
        iframeSources.push(...deeper);
      }
    } catch {}
  }

  return iframeSources;
}

export async function parseGeneric(url: string, parentReferer?: string): Promise<VideoInfo | null> {
  // Validate URL
  try {
    new URL(url);
  } catch {
    return null;
  }

  const fileId = url.split('/').pop()?.split('?')[0] || 'video';

  try {
    const response = await fetchWithFallback(url, parentReferer);
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const isHlsResponse = contentType.includes('mpegurl') || contentType.includes('vnd.apple.mpegurl');
    const isVideoResponse = contentType.startsWith('video/');

    // A direct URL need not include a file extension. Do not buffer a media
    // response into memory just to identify it.
    if (isVideoResponse || isHlsResponse) {
      const fileName = url.split('/').pop()?.split('?')[0] || (isHlsResponse ? 'video.m3u8' : 'video.mp4');
      const length = Number.parseInt(response.headers.get('content-length') || '0', 10);
      return {
        title: fileName,
        fileName,
        fileSize: length > 0 ? `${Math.round(length / 1024 / 1024)} MB` : 'Unknown',
        fileSizeBytes: Number.isFinite(length) ? length : 0,
        thumbnail: '',
        sources: [{ url, quality: 'Direct', format: isHlsResponse ? 'HLS' : 'Video', isM3u8: isHlsResponse }],
        originalUrl: url,
        downloadUrl: url,
      };
    }

    const html = await readResponseText(response, 2_000_000);
    if (!html) return null;

    if (html.trimStart().startsWith('#EXTM3U')) {
      const fileName = url.split('/').pop()?.split('?')[0] || 'video.m3u8';
      return {
        title: fileName,
        fileName,
        fileSize: 'Unknown',
        fileSizeBytes: 0,
        thumbnail: '',
        sources: [{ url, quality: 'HLS', format: 'HLS', isM3u8: true }],
        originalUrl: url,
        downloadUrl: url,
      };
    }

    if (html.length < 50) return null;

    const lower = html.toLowerCase();
    if (lower.includes('file not found') || lower.includes('video not found') || lower.includes('404 not found') && lower.includes('not here')) {
      // Don't immediately fail, try to still extract but if no sources then error
    }

    const $ = cheerio.load(html);

    const fileInfo = extractFileInfo($, html, url, fileId);

    let allSources = extractVideoSourcesFromHtml($, html, url);

    // Try iframe extraction if no sources found
    if (allSources.length === 0) {
      const iframeSources = await tryIframeExtraction($, url, 0);
      allSources.push(...iframeSources);
    }

    // If still no sources, try to look for HLS master directly via <link rel="preload" as="fetch" href="...m3u8">
    if (allSources.length === 0) {
      $('link[rel="preload"]').each((_: number, el: any) => {
        const href = $(el).attr('href');
        if (href && (href.includes('.m3u8') || href.includes('.mp4'))) {
          allSources.push({
            url: normalizeUrl(href, url),
            quality: 'HD',
            format: href.includes('.m3u8') ? 'HLS (m3u8)' : 'MP4',
            isM3u8: href.includes('.m3u8'),
          });
        }
      });
    }

    allSources = allSources.map(s => ({ ...s, url: normalizeUrl(s.url, url) }));
    allSources = deduplicateSources(allSources);

    // Filter to true video URLs (at least contains .mp4/.m3u8/get_video)
    const videoSources = allSources.filter(s => {
      const l = s.url.toLowerCase();
      return l.includes('.mp4') || l.includes('.m3u8') || l.includes('get_video') || l.includes('.webm') || l.includes('.mov') || l.includes('master.m3u8') || l.includes('.urlset') || l.includes('/videos/') || l.includes('hls');
    });

    const iframeUrls: string[] = [];
    $('iframe, div, span').each((_: number, el: any) => {
      const attrs = ['src', 'data-src', 'data-url', 'data-video', 'data-file', 'data-hls'];
      for (const attr of attrs) {
        const src = $(el).attr(attr);
        if (src) {
          const normalized = normalizeUrl(src, url);
          if (normalized.startsWith('http') && !normalized.includes('google') && !normalized.includes('facebook') && !normalized.includes('twitter') && !normalized.includes('recaptcha')) {
            iframeUrls.push(normalized);
          }
        }
      }
    });

    if (videoSources.length === 0) {
      if (iframeUrls.length > 0) {
        return {
          title: fileInfo.title,
          fileName: fileInfo.fileName,
          fileSize: fileInfo.fileSize || 'Unknown',
          fileSizeBytes: fileInfo.fileSizeBytes,
          thumbnail: fileInfo.thumbnail,
          sources: [],
          originalUrl: url,
          downloadUrl: null,
          iframeUrls,
        };
      }
      return null;
    }

    // Sort: mp4 first for download, but keep m3u8 master first for HLS
    videoSources.sort((a, b) => {
      const aMaster = a.url.includes('master.m3u8');
      const bMaster = b.url.includes('master.m3u8');
      if (aMaster && !bMaster) return -1;
      if (!aMaster && bMaster) return 1;
      if (a.isM3u8 && !b.isM3u8) return 1;
      if (!a.isM3u8 && b.isM3u8) return -1;
      return 0;
    });

    const primary = videoSources.find(s => s.url.includes('.mp4')) || videoSources[0];

    return {
      title: fileInfo.title,
      fileName: fileInfo.fileName,
      fileSize: fileInfo.fileSize || 'Unknown',
      fileSizeBytes: fileInfo.fileSizeBytes,
      thumbnail: fileInfo.thumbnail,
      sources: videoSources,
      originalUrl: url,
      downloadUrl: primary?.url || null,
      iframeUrls,
    };
  } catch (e) {
    console.error('Generic parser error for', url, e);
    return null;
  }
}
