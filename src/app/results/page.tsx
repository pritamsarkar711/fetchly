'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { FetchResult, VideoSource } from '@/lib/types';
import Link from 'next/link';

function ResultsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const url = searchParams.get('url');

  const [result, setResult] = useState<FetchResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [watchMode, setWatchMode] = useState(false);
  const [selectedSource, setSelectedSource] = useState<VideoSource | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [newUrl, setNewUrl] = useState(url || '');

  useEffect(() => {
    if (!url) { setLoading(false); setError('No URL provided'); return; }
    fetchVideo(url);
  }, [url]);

  const fetchVideo = async (videoUrl: string) => {
    setLoading(true);
    setError('');
    setResult(null);
    setWatchMode(false);
    setSelectedSource(null);

    try {
      const res = await fetch(`/api/fetch?url=${encodeURIComponent(videoUrl)}`);
      const data: FetchResult = await res.json();
      if (data.success && data.data) {
        setResult(data);
        const preferred = data.data.sources.find(s => !s.isM3u8 && s.format !== 'Download') || data.data.sources[0];
        setSelectedSource(preferred);
      } else {
        setError(data.error || 'Could not fetch video');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  };

  const handleNewSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUrl.trim()) return;
    router.push(`/results?url=${encodeURIComponent(newUrl.trim())}`);
  };

  const handleCopy = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  if (!url) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="text-center">
          <h1 className="text-2xl font-medium text-gray-800 mb-4">No URL provided</h1>
          <Link href="/" className="text-blue-600 hover:underline">Go back home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <Link href="/" className="flex items-center gap-0 flex-shrink-0">
            <span className="text-2xl font-bold" style={{ color: '#4285f4' }}>F</span>
            <span className="text-2xl font-bold" style={{ color: '#ea4335' }}>e</span>
            <span className="text-2xl font-bold" style={{ color: '#fbbc05' }}>t</span>
            <span className="text-2xl font-bold" style={{ color: '#4285f4' }}>c</span>
            <span className="text-2xl font-bold" style={{ color: '#34a853' }}>h</span>
            <span className="text-2xl font-bold" style={{ color: '#ea4335' }}>l</span>
            <span className="text-2xl font-bold" style={{ color: '#4285f4' }}>y</span>
          </Link>
          <form onSubmit={handleNewSubmit} className="flex-1 max-w-2xl">
            <div className="flex items-center border border-gray-200 rounded-full px-4 py-1.5 shadow-[0_1px_4px_rgba(32,33,36,0.08)] hover:shadow-[0_1px_6px_rgba(32,33,36,0.12)] transition-shadow">
              <svg className="w-4 h-4 text-gray-400 mr-2 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                type="text"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="flex-1 outline-none text-sm bg-transparent text-gray-800"
                placeholder="Paste video URL..."
              />
            </div>
          </form>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {loading && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin mb-3"></div>
            <p className="text-gray-500 text-sm">Fetching video info...</p>
          </div>
        )}

        {error && !loading && (
          <div className="text-center py-16">
            <div className="text-4xl mb-3 text-gray-300">:(</div>
            <h2 className="text-lg font-medium text-gray-800 mb-1">Could not fetch video</h2>
            <p className="text-gray-500 text-xs mb-6 max-w-md mx-auto">{error}</p>
            <Link href="/" className="text-blue-600 text-sm hover:underline">Try another URL</Link>
          </div>
        )}

        {result?.data && !loading && (
          <div className="space-y-4">
            {/* Video Info */}
            <div className="bg-white border border-gray-200 rounded-lg">
              <div className="p-4">
                <h1 className="text-base font-medium text-gray-900 truncate">
                  {result.data.fileName || result.data.title}
                </h1>
                <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                  {result.data.fileSize && <span>{result.data.fileSize}</span>}
                  <span>{result.data.sources.length} source{result.data.sources.length !== 1 ? 's' : ''}</span>
                  <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">MixDrop</span>
                </div>
              </div>
              {result.data.thumbnail && !watchMode && (
                <div className="border-t border-gray-100">
                  <img src={result.data.thumbnail} alt="" className="w-full max-h-48 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
              )}
            </div>

            {/* Watch Mode */}
            {watchMode && selectedSource && (
              <div className="bg-black rounded-lg overflow-hidden">
                {selectedSource.isM3u8 ? (
                  <div className="aspect-video flex items-center justify-center bg-gray-900">
                    <div className="text-center text-white px-4">
                      <p className="text-sm mb-1">HLS Stream</p>
                      <p className="text-[11px] text-gray-400 mb-3">Use external player</p>
                      <a href={selectedSource.url} target="_blank" rel="noopener noreferrer"
                        className="inline-block px-3 py-1.5 bg-blue-600 text-white text-xs rounded hover:bg-blue-700">
                        Open in VLC
                      </a>
                    </div>
                  </div>
                ) : (
                  <video controls autoPlay className="w-full aspect-video bg-black" src={selectedSource.url} playsInline />
                )}
                <div className="px-3 py-1.5 flex items-center justify-between bg-gray-900">
                  <button onClick={() => setWatchMode(false)} className="text-white text-xs hover:text-gray-300">
                    &larr; Back
                  </button>
                  <span className="text-gray-400 text-[10px]">{selectedSource.quality} · {selectedSource.format}</span>
                </div>
              </div>
            )}

            {/* Sources */}
            <div>
              <h2 className="text-sm font-medium text-gray-700 mb-2">Download Links</h2>
              <div className="space-y-1.5">
                {result.data.sources.map((source, index) => (
                  <div key={index} className="bg-white border border-gray-200 rounded-lg p-3 hover:border-gray-300 transition-colors">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                          source.isM3u8 ? 'bg-purple-100' : 'bg-green-100'
                        }`}>
                          {source.isM3u8 ? (
                            <svg className="w-3 h-3 text-purple-600" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8.5v7a4.49 4.49 0 0 0 2.5-3.5zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
                            </svg>
                          ) : (
                            <svg className="w-3 h-3 text-green-600" viewBox="0 0 24 24" fill="currentColor">
                              <path d="M18 15v3H6v-3H4v3c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-3h-2zM17 11l-1.41-1.41L13 12.17V4h-2v8.17L8.41 9.59 7 11l5 5 5-5z"/>
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-medium text-gray-800 truncate">
                            {source.isM3u8 ? 'HLS Stream' : 'Video File'}
                            {source.quality !== 'Auto' && ` \u00b7 ${source.quality}`}
                          </p>
                          <p className="text-[10px] text-gray-400 truncate">{source.format}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <button onClick={() => handleCopy(source.url, index)}
                          className={`px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                            copiedIndex === index
                              ? 'bg-green-50 text-green-600 border-green-200'
                              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                          }`}>
                          {copiedIndex === index ? 'Copied!' : 'Copy'}
                        </button>
                        {!watchMode && (
                          <button onClick={() => { setSelectedSource(source); setWatchMode(true); }}
                            className="px-2 py-1 text-[10px] font-medium rounded bg-blue-50 text-blue-600 border border-blue-200 hover:bg-blue-100">
                            Watch
                          </button>
                        )}
                        <a href={source.url} target="_blank" rel="noopener noreferrer" download
                          className="px-2 py-1 text-[10px] font-medium rounded bg-[#1a73e8] text-white hover:bg-[#1557b0] inline-flex items-center gap-0.5">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                          </svg>
                          DL
                        </a>
                      </div>
                    </div>
                    <p className="mt-1 text-[10px] text-gray-400 truncate">{source.url}</p>
                  </div>
                ))}
              </div>
            </div>

            {result.data.downloadUrl && (
              <div className="pt-1">
                <a href={result.data.downloadUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#34a853] text-white text-xs font-medium rounded hover:bg-[#2d9249] transition-colors">
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                  </svg>
                  Direct Download from MixDrop
                </a>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function ResultsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-gray-200 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    }>
      <ResultsContent />
    </Suspense>
  );
}
