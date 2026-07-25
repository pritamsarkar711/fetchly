import { FetchResult, VideoInfo, VideoSource } from '../types';
import { parseMixDrop, isMixDropUrl } from './mixdrop';
import { parseLuluStream, isLuluStreamUrl } from './lulustream';
import { parseVidara, isVidaraUrl } from './vidara';
import { parseFireStream, isFireStreamUrl } from './firestream';
import { parsePlaymate, isPlaymateUrl } from './playmate';
import { parseStreamTape, isStreamTapeUrl } from './streamtape';
import { parseDoodStream, isDoodStreamUrl } from './doodstream';
import { parseGeneric } from './generic';
import { parseWithYtDlp } from './ytdlp';
import { fetchPublicUrl, getHeadersForUrl, readResponseText } from '../proxy-utils';

const VIDEO_EXTENSIONS = /\.(?:mp4|m4v|webm|mov|mkv|avi|ogv)(?:$|[?#])/i;
const HLS_EXTENSION = /\.m3u8(?:$|[?#])/i;

function isDirectVideoUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    return VIDEO_EXTENSIONS.test(path) || HLS_EXTENSION.test(path) || (path.endsWith('.txt') && /\/(?:hls|hls2)\//.test(path));
  } catch {
    return false;
  }
}

function filenameFromUrl(url: string, isHls: boolean): string {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'video');
    if (name && name !== '/') return name;
  } catch {
    // Use the fallback below.
  }
  return isHls ? 'video.m3u8' : 'video.mp4';
}

function directReferrer(url: string): string {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes('tnmr.org')) return 'https://luluvdo.com/';
  if (host.includes('handitrrel')) return 'https://playmate.to/';
  if (host.includes('s1q2105.com') || host.includes('97bf1.com')) return 'https://vidara.to/';
  if (host.includes('mxcontent') || host.includes('mxdcontent')) return 'https://miiiixdrop.net/';
  if (host.includes('firestream')) return 'https://firestream.to/';
  return url;
}

function directVideo(url: string): VideoInfo {
  const isM3u8 = HLS_EXTENSION.test(url) || /\/(?:hls|hls2)\/.*\.txt(?:$|[?#])/i.test(url);
  const fileName = filenameFromUrl(url, isM3u8);
  return {
    title: fileName,
    fileName,
    fileSize: 'Unknown',
    fileSizeBytes: 0,
    thumbnail: '',
    sources: [{
      url,
      quality: isM3u8 ? 'HLS' : 'Direct',
      format: isM3u8 ? 'HLS' : 'Video',
      isM3u8,
      referer: referrerOrigin(directReferrer(url)),
    }],
    originalUrl: url,
    downloadUrl: url,
  };
}

function sourceKey(source: VideoSource): string {
  return source.url.trim().toLowerCase();
}

function referrerOrigin(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return value;
  }
}

function isHlsSource(source: VideoSource): boolean {
  return source.isM3u8 || HLS_EXTENSION.test(source.url) || /\/(?:hls|hls2)\/.*\.txt(?:$|[?#])/i.test(source.url);
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/\b403\b|access denied|forbidden/i.test(message)) return 'This host denied the request.';
  if (/timeout|abort/i.test(message)) return 'This host took too long to respond.';
  return 'No playable video was found.';
}

/**
 * Try a host parser without allowing one site's temporary outage to prevent the
 * generic parser from running. Host templates change frequently, while an
 * embedded or direct media URL can still be valid.
 */
async function attemptParser(
  parser: () => Promise<VideoInfo | null>,
  setLastError: (error: unknown) => void,
  timeoutMs = 13_000
): Promise<VideoInfo | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      parser(),
      new Promise<null>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Parser timeout')), timeoutMs);
      }),
    ]);
  } catch (error) {
    setLastError(error);
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function hlsQuality(attributes: string): string {
  const resolution = attributes.match(/(?:^|,)RESOLUTION=\d+x(\d+)(?:,|$)/i)?.[1];
  if (resolution) return `${resolution}p`;
  const bandwidth = Number.parseInt(attributes.match(/(?:^|,)BANDWIDTH=(\d+)/i)?.[1] || '0', 10);
  return bandwidth > 0 ? `${Math.round(bandwidth / 1000)} kbps` : 'Auto';
}

async function expandHlsVariants(sources: VideoSource[]): Promise<VideoSource[]> {
  const expanded: VideoSource[] = [];
  const seen = new Set(sources.map(source => source.url));
  let inspected = 0;

  for (const source of sources) {
    expanded.push(source);
    if (!isHlsSource(source) || inspected >= 2) continue;
    inspected += 1;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6_000);
    try {
      const response = await fetchPublicUrl(source.url, {
        headers: getHeadersForUrl(source.url, source.referer),
        signal: controller.signal,
      });
      if (!response.ok) continue;
      const manifest = await readResponseText(response);
      if (!manifest?.trimStart().startsWith('#EXTM3U')) continue;

      const lines = manifest.split(/\r?\n/);
      for (let index = 0; index < lines.length && expanded.length < 16; index += 1) {
        const marker = lines[index].trim();
        if (!marker.startsWith('#EXT-X-STREAM-INF:')) continue;
        const next = lines.slice(index + 1).find(line => line.trim() && !line.trim().startsWith('#'))?.trim();
        if (!next) continue;
        const variantUrl = new URL(next, source.url).toString();
        if (seen.has(variantUrl)) continue;
        seen.add(variantUrl);
        expanded.push({
          url: variantUrl,
          quality: hlsQuality(marker.slice('#EXT-X-STREAM-INF:'.length)),
          format: 'HLS',
          isM3u8: true,
          referer: source.referer,
        });
      }
    } catch {
      // The master stream remains usable even when quality discovery is blocked.
    } finally {
      clearTimeout(timeout);
    }
  }

  return expanded;
}

export async function parseUrl(url: string, depth = 0, referer?: string): Promise<FetchResult> {
  if (depth > 2) {
    return { success: false, error: 'Maximum redirection depth exceeded.' };
  }

  if (!url || typeof url !== 'string' || !url.trim()) {
    return { success: false, error: 'Enter a valid URL.' };
  }

  const normalizedUrl = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  try {
    new URL(normalizedUrl);
  } catch {
    return { success: false, error: 'Enter a valid URL.' };
  }

  // Never download a media file just to discover that it is a media file.
  // This also makes signed direct MP4/HLS links resolve immediately.
  if (isDirectVideoUrl(normalizedUrl)) {
    const data = directVideo(normalizedUrl);
    if (data.sources[0].isM3u8) data.sources = await expandHlsVariants(data.sources);
    return { success: true, data };
  }

  let data: VideoInfo | null = null;
  let lastError: unknown;
  const captureError = (error: unknown) => { lastError = error; };

  if (isMixDropUrl(normalizedUrl)) data = await attemptParser(() => parseMixDrop(normalizedUrl), captureError);
  if (!data && isLuluStreamUrl(normalizedUrl)) data = await attemptParser(() => parseLuluStream(normalizedUrl), captureError);
  if (!data && isVidaraUrl(normalizedUrl)) data = await attemptParser(() => parseVidara(normalizedUrl), captureError);
  if (!data && isFireStreamUrl(normalizedUrl)) data = await attemptParser(() => parseFireStream(normalizedUrl), captureError);
  if (!data && isPlaymateUrl(normalizedUrl)) data = await attemptParser(() => parsePlaymate(normalizedUrl), captureError);
  if (!data && isStreamTapeUrl(normalizedUrl)) data = await attemptParser(() => parseStreamTape(normalizedUrl), captureError);
  if (!data && isDoodStreamUrl(normalizedUrl)) data = await attemptParser(() => parseDoodStream(normalizedUrl), captureError);
  // yt-dlp is highly reliable, try it before generic parsing
  if (!data) data = await attemptParser(() => parseWithYtDlp(normalizedUrl, referer), captureError, 28_000);
  if (!data) data = await attemptParser(() => parseGeneric(normalizedUrl, referer), captureError);
  if (!data) data = await attemptParser(() => genericFetch(normalizedUrl), captureError);

  if (!data?.sources?.length) {
    if (data?.iframeUrls && data.iframeUrls.length > 0) {
      // Try to parse the first few iframes
      for (const iframeUrl of data.iframeUrls.slice(0, 3)) {
        try {
          const result = await parseUrl(iframeUrl, depth + 1, normalizedUrl);
          if (result.success && result.data && result.data.sources.length > 0) {
            return result;
          }
        } catch {
          // ignore error and try next iframe
        }
      }
    }
    return { success: false, error: friendlyError(lastError) };
  }

  const seen = new Set<string>();
  data.sources = data.sources
    .filter(source => {
      const key = sourceKey(source);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return /^https?:\/\//i.test(source.url);
    })
    .map(source => {
      const isM3u8 = isHlsSource(source);
      return {
        ...source,
        isM3u8,
        format: isM3u8 ? 'HLS' : source.format,
        referer: referrerOrigin(source.referer || normalizedUrl),
      };
    });

  if (!data.sources.length) return { success: false, error: 'No playable video was found.' };

  data.sources = await expandHlsVariants(data.sources);

  data.sources.sort((a, b) => {
    if (a.isM3u8 !== b.isM3u8) return a.isM3u8 ? 1 : -1;
    return 0;
  });
  data.downloadUrl = data.sources.find(source => !source.isM3u8)?.url || data.sources[0].url;

  return { success: true, data };
}

async function genericFetch(url: string): Promise<VideoInfo | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchPublicUrl(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fetchly/1.0)' },
    });
    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';
    if (!contentType.startsWith('video/') && !contentType.includes('mpegurl')) return null;

    const isM3u8 = contentType.includes('mpegurl');
    const fileName = filenameFromUrl(url, isM3u8);
    const contentLength = Number.parseInt(response.headers.get('content-length') || '0', 10);
    return {
      title: fileName,
      fileName,
      fileSize: contentLength > 0 ? formatBytes(contentLength) : 'Unknown',
      fileSizeBytes: Number.isFinite(contentLength) ? contentLength : 0,
      thumbnail: '',
      sources: [{ url, quality: 'Direct', format: isM3u8 ? 'HLS' : 'Video', isM3u8, referer: url }],
      originalUrl: url,
      downloadUrl: url,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${Number((bytes / 1024 ** index).toFixed(1))} ${units[index]}`;
}
