import { FetchResult, VideoInfo, VideoSource } from '../types';
import { parseMixDrop, isMixDropUrl } from './mixdrop';
import { parseLuluStream, isLuluStreamUrl } from './lulustream';
import { parseVidara, isVidaraUrl } from './vidara';
import { parseFireStream, isFireStreamUrl } from './firestream';
import { parsePlaymate, isPlaymateUrl } from './playmate';
import { parseStreamTape, isStreamTapeUrl } from './streamtape';
import { parseGeneric } from './generic';

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
      referer: directReferrer(url),
    }],
    originalUrl: url,
    downloadUrl: url,
  };
}

function sourceKey(source: VideoSource): string {
  return source.url.trim().toLowerCase();
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
): Promise<VideoInfo | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      parser(),
      new Promise<null>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Parser timeout')), 13_000);
      }),
    ]);
  } catch (error) {
    setLastError(error);
    return null;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function parseUrl(url: string): Promise<FetchResult> {
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
    return { success: true, data: directVideo(normalizedUrl) };
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
  if (!data) data = await attemptParser(() => parseGeneric(normalizedUrl), captureError);
  if (!data) data = await attemptParser(() => genericFetch(normalizedUrl), captureError);

  if (!data?.sources?.length) {
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
        referer: source.referer || normalizedUrl,
      };
    });

  if (!data.sources.length) return { success: false, error: 'No playable video was found.' };

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
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Fetchly/1.0)' },
      redirect: 'follow',
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
