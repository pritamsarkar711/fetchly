import { VideoInfo, FetchResult } from '../types';
import { parseMixDrop, isMixDropUrl } from './mixdrop';
import { parseLuluStream, isLuluStreamUrl } from './lulustream';
import { parseVidara, isVidaraUrl } from './vidara';
import { parseFireStream, isFireStreamUrl } from './firestream';
import { parsePlaymate, isPlaymateUrl } from './playmate';

/**
 * Detect which site the URL belongs to and return the appropriate parser
 */
export async function parseUrl(url: string): Promise<FetchResult> {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { success: false, error: 'Please provide a valid URL' };
  }

  let normalizedUrl = url.trim();

  if (!normalizedUrl.startsWith('http://') && !normalizedUrl.startsWith('https://')) {
    normalizedUrl = 'https://' + normalizedUrl;
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return { success: false, error: 'Invalid URL format. Please enter a valid URL.' };
  }

  try {
    let data: VideoInfo | null = null;

    if (isMixDropUrl(normalizedUrl)) {
      data = await parseMixDrop(normalizedUrl);
    }

    if (!data && isLuluStreamUrl(normalizedUrl)) {
      data = await parseLuluStream(normalizedUrl);
    }

    if (!data && isVidaraUrl(normalizedUrl)) {
      data = await parseVidara(normalizedUrl);
    }

    if (!data && isFireStreamUrl(normalizedUrl)) {
      data = await parseFireStream(normalizedUrl);
    }

    if (!data && isPlaymateUrl(normalizedUrl)) {
      data = await parsePlaymate(normalizedUrl);
    }

    if (!data) {
      data = await genericFetch(normalizedUrl);
    }

    if (!data || !data.sources || data.sources.length === 0) {
      return {
        success: false,
        error: 'Could not find any video sources at this URL. The site may not be supported or the file may not exist.',
      };
    }

    const seenUrls = new Set<string>();
    data.sources = data.sources.filter(source => {
      const key = source.url.toLowerCase().trim();
      if (seenUrls.has(key)) return false;
      seenUrls.add(key);
      return true;
    });

    if (data.sources.length === 0) {
      return {
        success: false,
        error: 'No video sources found. This URL may be invalid or the file has been removed.',
      };
    }

    return { success: true, data };
  } catch (error: any) {
    console.error('Parser error:', error);
    return {
      success: false,
      error: error.message || 'An unexpected error occurred while fetching the video.',
    };
  }
}

async function genericFetch(url: string): Promise<VideoInfo | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      redirect: 'follow',
    });

    clearTimeout(timeout);

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') || '';

    if (contentType.startsWith('video/')) {
      const fileName = url.split('/').pop()?.split('?')[0] || 'video.mp4';
      const isM3u8 = url.includes('.m3u8');
      const contentLength = response.headers.get('content-length');

      return {
        title: fileName,
        fileName,
        fileSize: contentLength ? formatBytes(parseInt(contentLength)) : 'Unknown',
        fileSizeBytes: parseInt(contentLength || '0'),
        thumbnail: '',
        sources: [{
          url,
          quality: 'Auto',
          format: isM3u8 ? 'HLS (m3u8)' : 'Video',
          isM3u8,
        }],
        originalUrl: url,
        downloadUrl: url,
      };
    }

    if (contentType.includes('mpegurl') || url.includes('.m3u8')) {
      const text = await response.text();
      if (text.includes('#EXTM3U')) {
        const fileName = url.split('/').pop()?.split('?')[0] || 'video.m3u8';
        return {
          title: fileName,
          fileName: fileName.replace('.m3u8', '.mp4'),
          fileSize: 'Unknown',
          fileSizeBytes: 0,
          thumbnail: '',
          sources: [{
            url,
            quality: 'Auto',
            format: 'HLS (m3u8)',
            isM3u8: true,
          }],
          originalUrl: url,
          downloadUrl: url,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
