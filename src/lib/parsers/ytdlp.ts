import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat, chmod, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VideoInfo, VideoSource } from '../types';

const execFileAsync = promisify(execFile);

// Store the path to the downloaded binary
const BINARY_PATH = join(tmpdir(), 'yt-dlp_linux');

let downloadPromise: Promise<boolean> | null = null;

/** Check if yt-dlp is available or needs to be downloaded */
async function ensureYtdlp(): Promise<boolean> {
  try {
    const info = await stat(BINARY_PATH);
    if (info.isFile()) return true;
  } catch {
    // Missing, needs download
  }

  if (downloadPromise) return downloadPromise;

  downloadPromise = (async () => {
    try {
      console.log('Downloading yt-dlp binary to', BINARY_PATH);
      const response = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux', {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });

      if (!response.ok || !response.body) {
        console.error('Failed to download yt-dlp', response.status);
        return false;
      }

      if (typeof response.arrayBuffer === 'function') {
        const buffer = await response.arrayBuffer();
        await writeFile(BINARY_PATH, Buffer.from(buffer));
      } else {
        return false;
      }

      await chmod(BINARY_PATH, 0o755);
      return true;
    } catch (err) {
      console.error('Error downloading yt-dlp:', err);
      return false;
    } finally {
      downloadPromise = null;
    }
  })();

  return downloadPromise;
}

export async function parseWithYtDlp(url: string, referer?: string): Promise<VideoInfo | null> {
  // Validate URL to avoid injection
  try {
    new URL(url);
  } catch {
    return null;
  }

  const isAvailable = await ensureYtdlp();
  if (!isAvailable) return null;

  try {
    const args = [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      '--ignore-errors',
      '--geo-bypass',
      '--impersonate', 'chrome', // Crucial for WAF/Cloudflare bypass
      '--add-header', 'Sec-Fetch-Mode: navigate',
      '--add-header', 'Sec-Fetch-Site: none',
      '--add-header', 'Sec-Fetch-Dest: document',
      '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      '--format', 'best[ext=mp4]/best',
    ];

    if (referer) {
      args.push('--referer', referer);
    }

    if (process.env.PROXY_URL) {
      args.push('--proxy', process.env.PROXY_URL);
    }

    args.push(url);

    const { stdout } = await execFileAsync(BINARY_PATH, args, { timeout: 25000 }); // 25s timeout

    const data = JSON.parse(stdout.trim());
    if (!data) return null;

    const sources: VideoSource[] = [];
    const pushSource = (fmt: any) => {
      if (fmt.url && /^https?:\/\//i.test(fmt.url)) {
        sources.push({
          url: fmt.url,
          quality: fmt.format_note || (fmt.height ? `${fmt.height}p` : 'HD'),
          format: fmt.ext?.toUpperCase() || 'Video',
          isM3u8: !!(fmt.protocol?.includes('m3u8') || fmt.url.includes('.m3u8')),
        });
      }
    };

    if (data.formats && Array.isArray(data.formats)) {
      // Prioritize mp4 or m3u8
      const sorted = [...data.formats].sort((a, b) => {
        const hA = a.height || 0;
        const hB = b.height || 0;
        return hB - hA;
      });
      // Pick best ones
      const uniqueQualities = new Set();
      for (const fmt of sorted) {
        // filter out formats without video or pure audio
        if (fmt.vcodec === 'none' && fmt.acodec !== 'none') continue;
        const q = fmt.format_note || String(fmt.height);
        if (!uniqueQualities.has(q)) {
          uniqueQualities.add(q);
          pushSource(fmt);
        }
      }
    }
    
    // Add the selected format if no formats array
    if (sources.length === 0 && data.url) {
      pushSource(data);
    }

    if (sources.length === 0) return null;

    const fileName = data.title ? `${data.title.replace(/[^a-zA-Z0-9.\-_ ]/g, '_')}.mp4` : 'video.mp4';

    return {
      title: data.title || fileName,
      fileName,
      fileSize: 'Unknown',
      fileSizeBytes: 0,
      thumbnail: data.thumbnail || '',
      sources,
      originalUrl: url,
      downloadUrl: sources[0].url,
    };
  } catch (error) {
    console.error('yt-dlp error:', error);
    return null;
  }
}
