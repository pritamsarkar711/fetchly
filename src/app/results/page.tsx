'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense, useCallback } from 'react';
import { FetchResult, VideoSource } from '@/lib/types';
import Link from 'next/link';

function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const rawUrl = searchParams.get('url');
  // Sanitize: ensure URL is valid to prevent XSS
  const url = rawUrl && /^https?:\/\//i.test(rawUrl) ? rawUrl : null;

  const [result, setResult] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [watchSource, setWatchSource] = useState<VideoSource | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [newUrl, setNewUrl] = useState(url || '');

  const fetchVideo = useCallback(async (videoUrl: string) => {
    setLoading(true);
    setError('');
    setResult(null);
    setWatchSource(null);

    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(videoUrl)}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || `Server error (${res.status})`);
      }
      const data: FetchResult = await res.json();
      if (data.success && data.data) {
        setResult(data);
      } else {
        setError(data.error || 'Could not fetch video from this URL');
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'TimeoutError') {
        setError('Request timed out. The server may be unreachable.');
      } else {
        setError(err.message || 'Failed to connect. Check the URL and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!url) { setLoading(false); setError('No URL provided'); return; }
    fetchVideo(url);
  }, [url, fetchVideo]);

  const handleNewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newUrl.trim();
    if (!trimmed) return;
    const finalUrl = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? trimmed : 'https://' + trimmed;
    setNewUrl(finalUrl);
    router.push(`/results?url=${encodeURIComponent(finalUrl)}`);
  };

  const handleCopy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback for older browsers
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const handleDownload = async (source: VideoSource, fileName: string) => {
    try {
      const response = await fetch(source.url, {
        mode: 'cors',
        headers: { 'Accept': 'video/*,*/*' },
      });
      if (!response.ok) {
        window.open(source.url, '_blank');
        return;
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const ext = source.isM3u8 ? '.m3u8' : '.mp4';
      a.download = (fileName || 'video') + ext;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    } catch {
      window.open(source.url, '_blank');
    }
  };

  const handleRetry = () => {
    if (url) fetchVideo(url);
  };

  if (!url) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4 bg-white">
        <div className="text-center">
          <div className="text-4xl mb-3 text-gray-300">🔗</div>
          <h1 className="text-xl font-medium text-gray-800 mb-2">No URL provided</h1>
          <p className="text-sm text-gray-500 mb-6">Paste a MixDrop or video URL to get started</p>
          <Link href="/" className="text-blue-600 text-sm hover:underline font-medium">
            Go back home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-sm border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-3 sm:px-4 py-2 sm:py-2.5 flex items-center gap-2 sm:gap-4">
          <Link href="/" className="flex items-center gap-0 flex-shrink-0" aria-label="Fetchly Home">
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#4285f4' }}>F</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#ea4335' }}>e</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#fbbc05' }}>t</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#4285f4' }}>c</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#34a853' }}>h</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#ea4335' }}>l</span>
            <span className="text-xl sm:text-2xl font-bold select-none" style={{ color: '#4285f4' }}>y</span>
          </Link>
          <form onSubmit={handleNewSubmit} className="flex-1 min-w-0 max-w-2xl">
            <div className="flex items-center border border-gray-200 rounded-full px-3 sm:px-4 py-1 sm:py-1.5 shadow-[0_1px_4px_rgba(32,33,36,0.08)] hover:shadow-[0_1px_6px_rgba(32,33,36,0.12)] transition-shadow">
              <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-gray-400 mr-1.5 sm:mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="flex-1 outline-none text-xs sm:text-sm bg-transparent text-gray-800 min-w-0"
                placeholder="Paste video URL..."
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
        {/* Loading state */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            <div className="w-7 h-7 sm:w-8 sm:h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin mb-3"></div>
            <p className="text-gray-500 text-xs sm:text-sm">Fetching video info...</p>
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div className="text-center py-12 sm:py-16">
            <div className="text-3xl sm:text-4xl mb-3 text-gray-300">:(</div>
            <h2 className="text-base sm:text-lg font-medium text-gray-800 mb-1">Could not fetch video</h2>
            <p className="text-gray-500 text-xs sm:text-sm mb-6 max-w-md mx-auto px-4 break-words">{error}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                onClick={handleRetry}
                className="px-4 py-2 bg-[#1a73e8] text-white text-sm rounded-md hover:bg-[#1557b0] transition-colors"
              >
                Retry
              </button>
              <Link href="/" className="text-blue-600 text-sm hover:underline">
                Try another URL
              </Link>
            </div>
          </div>
        )}

        {/* Results */}
        {result?.data && !loading && (
          <div className="space-y-3 sm:space-y-4">
            {/* Video Info Card */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="p-3 sm:p-4">
                <h1 className="text-sm sm:text-base font-medium text-gray-900 truncate" title={result.data.fileName || result.data.title}>
                  {result.data.fileName || result.data.title}
                </h1>
                <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1.5 text-xs text-gray-500">
                  {result.data.fileSize && result.data.fileSize !== 'Unknown' && (
                    <span className="flex items-center gap-1">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      {result.data.fileSize}
                    </span>
                  )}
                  <span>{result.data.sources.length} source{result.data.sources.length !== 1 ? 's' : ''}</span>
                  <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">MixDrop</span>
                </div>
              </div>
              {result.data.thumbnail && !watchSource && (
                <div className="border-t border-gray-100">
                  <img
                    src={result.data.thumbnail}
                    alt="Video thumbnail"
                    className="w-full max-h-48 object-cover"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                </div>
              )}
            </div>

            {/* Watch Mode - Video Player */}
            {watchSource && (
              <div className="bg-black rounded-lg overflow-hidden">
                <div className="relative">
                  {watchSource.isM3u8 ? (
                    <div className="aspect-video flex items-center justify-center bg-gray-900">
                      <div className="text-center text-white px-4">
                        <p className="text-sm mb-1 font-medium">HLS Stream</p>
                        <p className="text-[11px] text-gray-400 mb-3">In-browser HLS not supported. Use an external player.</p>
                        <a
                          href={watchSource.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                        >
                          Open in VLC / Player
                        </a>
                      </div>
                    </div>
                  ) : (
                    <video
                      controls
                      autoPlay
                      className="w-full aspect-video bg-black"
                      src={watchSource.url}
                      playsInline
                      onError={(e) => {
                        const target = e.target as HTMLVideoElement;
                        target.poster = '';
                        // Show error fallback
                      }}
                    >
                      Your browser does not support video playback.
                    </video>
                  )}
                </div>
                <div className="px-3 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between bg-gray-900">
                  <button
                    onClick={() => setWatchSource(null)}
                    className="text-white text-xs hover:text-gray-300 transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z"/>
                    </svg>
                    Back to sources
                  </button>
                  <span className="text-gray-400 text-[10px] sm:text-xs">
                    {watchSource.quality} · {watchSource.format}
                  </span>
                </div>
              </div>
            )}

            {/* Sources / Download Links */}
            <div>
              <h2 className="text-sm font-medium text-gray-700 mb-2 sm:mb-3">
                Download Links
                {result.data.sources.length > 0 && (
                  <span className="text-gray-400 font-normal ml-1">({result.data.sources.length})</span>
                )}
              </h2>
              {result.data.sources.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-500">No downloadable sources found.</p>
                </div>
              ) : (
                <div className="space-y-1.5 sm:space-y-2">
                  {result.data.sources.map((source, index) => (
                    <div
                      key={index}
                      className={`bg-white border rounded-lg p-3 sm:p-4 transition-colors ${
                        watchSource?.url === source.url
                          ? 'border-blue-300 bg-blue-50/30'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 sm:gap-3">
                        {/* Source info */}
                        <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
                          <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                            source.isM3u8 ? 'bg-purple-100' : 'bg-green-100'
                          }`}>
                            {source.isM3u8 ? (
                              <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-purple-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.49 4.49 0 0 0 2.5-3.5zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                              </svg>
                            ) : (
                              <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-green-600" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                                <path d="M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zM17 11l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z"/>
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs sm:text-sm font-medium text-gray-800 truncate">
                              {source.isM3u8 ? 'HLS Stream' : 'Video File'}
                              {source.quality !== 'Auto' && ` · ${source.quality}`}
                            </p>
                            <p className="text-[10px] sm:text-xs text-gray-400 truncate">{source.format}</p>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
                          <button
                            onClick={() => handleCopy(source.url, index)}
                            className={`px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-md border transition-colors ${
                              copiedIndex === index
                                ? 'bg-green-50 text-green-600 border-green-200'
                                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50 active:bg-gray-100'
                            }`}
                            aria-label="Copy URL"
                          >
                            {copiedIndex === index ? 'Copied!' : 'Copy'}
                          </button>
                          <button
                            onClick={() => setWatchSource(source)}
                            className="px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-md bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100 active:bg-blue-200 transition-colors"
                            aria-label="Watch video"
                          >
                            Watch
                          </button>
                          <button
                            onClick={() => handleDownload(source, result.data?.fileName || 'video')}
                            className="px-2 sm:px-3 py-1 sm:py-1.5 text-[10px] sm:text-xs font-medium rounded-md bg-[#1a73e8] text-white hover:bg-[#1557b0] active:bg-[#124a8a] transition-colors inline-flex items-center gap-0.5 sm:gap-1"
                            aria-label="Download video"
                          >
                            <svg className="w-2.5 sm:w-3 h-2.5 sm:h-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                            </svg>
                            DL
                          </button>
                        </div>
                      </div>
                      {/* URL preview - clipped on mobile */}
                      <p className="mt-1.5 sm:mt-2 text-[10px] text-gray-400 truncate" title={source.url}>
                        {source.url}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Direct Download Button */}
            {result.data.downloadUrl && (
              <div className="pt-1 sm:pt-2">
                <a
                  href={result.data.downloadUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 sm:gap-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-[#34a853] text-white text-xs sm:text-sm font-medium rounded-md hover:bg-[#2d9249] transition-colors active:bg-[#237a3c]"
                >
                  <svg className="w-3.5 sm:w-4 h-3.5 sm:h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                  Direct Download from MixDrop
                </a>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-100 mt-8 sm:mt-12">
        <div className="max-w-5xl mx-auto px-4 py-4 sm:py-6 text-center text-xs text-gray-400">
          <p>Fetchly — Paste any video URL to get download links.</p>
        </div>
      </footer>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="text-center">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin mx-auto mb-3"></div>
          <p className="text-sm text-gray-500">Loading...</p>
        </div>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  );
}
