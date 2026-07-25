'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';

export default function Home() {
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const validateUrl = (url: string): boolean => {
    if (!url.trim()) {
      setError('Please enter a URL');
      return false;
    }
    const trimmed = url.trim();
    try {
      const hasProtocol = trimmed.startsWith('http://') || trimmed.startsWith('https://');
      const urlObj = new URL(hasProtocol ? trimmed : 'https://' + trimmed);
      if (!urlObj.hostname.includes('.')) {
        setError('Please enter a valid URL');
        return false;
      }
    } catch {
      setError('Please enter a valid URL (e.g. https://mixdrop.co/f/xxx)');
      return false;
    }
    return true;
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const url = query.trim();
    if (!validateUrl(url)) return;
    setError('');
    router.push(`/results?url=${encodeURIComponent(url)}`);
  };

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Main content - clean, no Google-like header/footer */}
      <main className="flex-1 flex flex-col items-center justify-center px-4">
        {/* Logo */}
        <div className="mb-5 sm:mb-6">
          <div className="flex items-center gap-0">
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#4285f4' }}>F</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#ea4335' }}>e</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#fbbc05' }}>t</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#4285f4' }}>c</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#34a853' }}>h</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#ea4335' }}>l</span>
            <span className="text-5xl sm:text-[80px] font-bold leading-none tracking-tight select-none" style={{ color: '#4285f4' }}>y</span>
          </div>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="w-full max-w-[584px]" role="search">
          <div className="relative">
            <div className="flex items-center w-full h-11 sm:h-11 border border-gray-200 rounded-full px-4 sm:px-5 shadow-[0_1px_6px_rgba(32,33,36,0.1)] hover:shadow-[0_1px_6px_rgba(32,33,36,0.18)] focus-within:shadow-[0_1px_6px_rgba(32,33,36,0.18)] transition-shadow">
              <svg className="w-4 sm:w-5 h-4 sm:h-5 text-gray-400 mr-2 sm:mr-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); if (error) setError(''); }}
                placeholder="Paste video URL..."
                className="flex-1 outline-none text-base bg-transparent text-gray-800 placeholder-gray-400 min-w-0"
                autoComplete="off"
                spellCheck={false}
                autoFocus
              />
              {query && (
                <button
                  type="button"
                  onClick={() => { setQuery(''); setError(''); }}
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 ml-2 hover:bg-gray-300 transition-colors"
                  aria-label="Clear search"
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="#5f6368">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-xs sm:text-sm mt-2 text-center" role="alert">{error}</p>
          )}

          <div className="mt-5 flex justify-center sm:mt-6">
            <button
              type="submit"
              className="rounded-md border border-[#f8f9fa] bg-[#f8f9fa] px-5 py-2 text-sm font-medium text-[#3c4043] transition-all hover:border-gray-200 hover:shadow-sm active:bg-gray-100"
            >
              Fetch Video
            </button>
          </div>
        </form>


      </main>
    </div>
  );
}
