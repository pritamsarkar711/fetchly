'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { FetchResult, VideoSource } from '@/lib/types';

function proxiedStream(source: VideoSource): string {
  const params = new URLSearchParams({ url: source.url });
  if (source.referer) params.set('ref', source.referer);
  return `/api/stream?${params.toString()}`;
}

function proxiedDownload(source: VideoSource, filename: string): string {
  const params = new URLSearchParams({ url: source.url, filename });
  if (source.referer) params.set('ref', source.referer);
  return `/api/download?${params.toString()}`;
}

function downloadName(source: VideoSource, originalName: string): string {
  const fallback = source.isM3u8 ? 'video.m3u8' : 'video.mp4';
  const name = (originalName || fallback).replace(/[\\/]/g, '_');
  if (!source.isM3u8) return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.mp4`;
  return name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.m3u8';
}

function Logo({ small = false }: { small?: boolean }) {
  const size = small ? 'text-xl sm:text-2xl' : 'text-5xl sm:text-[80px]';
  const letters = [
    ['F', '#4285f4'], ['e', '#ea4335'], ['t', '#fbbc05'], ['c', '#4285f4'],
    ['h', '#34a853'], ['l', '#ea4335'], ['y', '#4285f4'],
  ];
  return <div className={`flex items-center gap-0 font-bold leading-none tracking-tight select-none ${size}`} aria-label="Fetchly">{
    letters.map(([letter, color]) => <span key={letter} style={{ color }}>{letter}</span>)
  }</div>;
}

function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const requestedUrl = searchParams.get('url');
  const url = requestedUrl && /^https?:\/\//i.test(requestedUrl) ? requestedUrl : null;

  const [result, setResult] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(Boolean(url));
  const [error, setError] = useState(url ? '' : 'Paste a video URL to continue.');
  const [input, setInput] = useState(url || '');
  const [watching, setWatching] = useState<VideoSource | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<{ destroy: () => void } | null>(null);

  const fetchVideo = useCallback(async (videoUrl: string) => {
    setLoading(true);
    setError('');
    setResult(null);
    setWatching(null);
    setPlaybackError('');

    try {
      const response = await fetch(`/api/fetch?url=${encodeURIComponent(videoUrl)}`, { signal: AbortSignal.timeout(35_000) });
      const data: FetchResult = await response.json().catch(() => ({ success: false, error: 'Could not fetch this video.' }));
      if (!response.ok || !data.success || !data.data) throw new Error(data.error || 'Could not fetch this video.');
      setResult(data);
    } catch (caught: unknown) {
      const message = caught instanceof Error ? caught.message : '';
      setError(/timeout|abort/i.test(message) ? 'This link took too long.' : (message || 'Could not fetch this video.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) return;
    const timer = window.setTimeout(() => fetchVideo(url), 0);
    return () => window.clearTimeout(timer);
  }, [url, fetchVideo]);

  useEffect(() => {
    if (!watching || !videoRef.current) return;
    let cancelled = false;
    const video = videoRef.current;
    setPlaybackError('');

    const clearPlayer = () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
    clearPlayer();

    if (!watching.isM3u8) {
      video.src = proxiedStream(watching);
      video.load();
      video.play().catch(() => undefined);
      return clearPlayer;
    }

    const streamUrl = proxiedStream(watching);
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = streamUrl;
      video.load();
      video.play().catch(() => undefined);
      return clearPlayer;
    }

    import('hls.js').then(({ default: Hls }) => {
      if (cancelled) return;
      if (!Hls.isSupported()) {
        setPlaybackError('This browser cannot play this stream.');
        return;
      }
      const hls = new Hls();
      hlsRef.current = hls;
      hls.loadSource(streamUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => undefined));
      hls.on(Hls.Events.ERROR, (_event, details) => {
        if (details.fatal) setPlaybackError('This stream could not be played.');
      });
    }).catch(() => setPlaybackError('Player could not be loaded.'));

    return () => {
      cancelled = true;
      clearPlayer();
    };
  }, [watching]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    router.push(`/results?url=${encodeURIComponent(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)}`);
  };

  const copy = async (source: VideoSource, index: number) => {
    try {
      await navigator.clipboard.writeText(source.url);
      setCopied(index);
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      setError('Could not copy the link.');
    }
  };

  const download = (source: VideoSource) => {
    const filename = downloadName(source, result?.data?.fileName || 'video');
    const anchor = document.createElement('a');
    anchor.href = proxiedDownload(source, filename);
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  return (
    <div className="min-h-screen bg-white">
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-2.5">
          <Link href="/" aria-label="Fetchly home"><Logo small /></Link>
          <form onSubmit={submit} className="flex min-w-0 flex-1 items-center rounded-full border border-gray-200 px-3 py-1.5 shadow-sm focus-within:border-blue-400">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              aria-label="Video URL"
              placeholder="Paste video URL"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              autoComplete="off"
              spellCheck={false}
            />
            <button className="ml-2 text-xs font-medium text-blue-600" type="submit">Fetch</button>
          </form>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
        {loading && (
          <div className="py-20 text-center text-sm text-gray-500">
            <div className="mx-auto mb-3 h-7 w-7 animate-spin rounded-full border-[3px] border-gray-200 border-t-blue-500" />
            Fetching video…
          </div>
        )}

        {!loading && error && (
          <section className="mx-auto max-w-md py-16 text-center">
            <h1 className="text-lg font-semibold text-gray-900">Couldn’t fetch video</h1>
            <p className="mt-1 text-sm text-gray-500">{error}</p>
            <div className="mt-5 flex justify-center gap-3">
              <button onClick={() => url && fetchVideo(url)} className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">Retry</button>
              <Link href="/" className="rounded-md border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">New URL</Link>
            </div>
          </section>
        )}

        {!loading && result?.data && (
          <div className="space-y-5">
            <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
                </div>
                <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900" title={result.data.fileName || result.data.title}>{result.data.fileName || result.data.title}</h1>
                {result.data.fileSize && result.data.fileSize !== 'Unknown' && <span className="text-xs text-gray-400">{result.data.fileSize}</span>}
              </div>
              {result.data.thumbnail && !watching && (
                // Native image avoids routing untrusted thumbnails through an image optimizer.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={result.data.thumbnail} alt="Video thumbnail" className="max-h-64 w-full object-cover" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              )}
            </section>

            {watching && (
              <section className="overflow-hidden rounded-xl bg-black">
                <video ref={videoRef} controls playsInline autoPlay className="aspect-video w-full bg-black" onError={() => setPlaybackError('This stream could not be played.')} />
                <div className="flex items-center justify-between bg-gray-900 px-3 py-2">
                  <button onClick={() => { setWatching(null); setPlaybackError(''); }} className="text-xs text-gray-200 hover:text-white">Close</button>
                  {playbackError && <span className="text-xs text-red-300">{playbackError}</span>}
                </div>
              </section>
            )}

            <section className="space-y-2">
              {result.data.sources.map((source, index) => (
                <div key={`${source.url}-${index}`} className={`flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-3 ${watching?.url === source.url ? 'border-blue-300 bg-blue-50/30' : 'border-gray-200'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${source.isM3u8 ? 'bg-purple-500' : 'bg-green-500'}`} />
                    <span className="text-sm font-medium text-gray-800">{source.isM3u8 ? `${source.quality && source.quality !== 'Auto' && !/hls/i.test(source.quality) ? `${source.quality} ` : ''}HLS` : 'Video file'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => copy(source, index)} className="rounded-md border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50">{copied === index ? 'Copied' : 'Copy'}</button>
                    <button onClick={() => setWatching(source)} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100">Watch</button>
                    <button onClick={() => download(source)} className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">Download</button>
                  </div>
                </div>
              ))}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}

export default function ResultsPage() {
  return <Suspense fallback={<div className="min-h-screen bg-white" />}><ResultsContent /></Suspense>;
}
