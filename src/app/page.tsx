'use client';

import { useState, useRef, useEffect, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function Home() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const url = query.trim();
    
    if (!url) {
      setError('Please enter a URL');
      return;
    }

    setError('');
    setLoading(true);

    // Navigate to results page
    router.push(`/results?url=${encodeURIComponent(url)}`);
  };

  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="flex items-center justify-end px-6 py-3 gap-4">
        <a href="#" className="text-sm text-[#1a0dab] hover:underline">Gmail</a>
        <a href="#" className="text-sm text-[#1a0dab] hover:underline">Images</a>
        <button className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#5f6368">
            <path d="M12,8c1.1,0,2-0.9,2-2s-0.9-2-2-2s-2,0.9-2,2S10.9,8,12,8z M12,10c-1.1,0-2,0.9-2,2s0.9,2,2,2s2-0.9,2-2 S13.1,10,12,10z M12,16c-1.1,0-2,0.9-2,2s0.9,2,2,2s2-0.9,2-2S13.1,16,12,16z"/>
          </svg>
        </button>
        <button className="bg-[#1a73e8] text-white text-sm px-5 py-2 rounded-md hover:bg-[#1557b0] transition-colors font-medium">
          Sign in
        </button>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col items-center justify-center px-4 -mt-20">
        {/* Logo */}
        <div className="mb-6">
          <div className="flex items-center gap-0">
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#4285f4' }}>F</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#ea4335' }}>e</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#fbbc05' }}>t</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#4285f4' }}>c</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#34a853' }}>h</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#ea4335' }}>l</span>
            <span className="text-[60px] sm:text-[80px] font-bold leading-none tracking-tight" style={{ color: '#4285f4' }}>y</span>
          </div>
        </div>

        {/* Search form */}
        <form onSubmit={handleSubmit} className="w-full max-w-[584px]">
          <div className="relative">
            <div className="flex items-center w-full h-12 sm:h-11 border border-gray-200 rounded-full px-5 shadow-[0_1px_6px_rgba(32,33,36,0.1)] hover:shadow-[0_1px_6px_rgba(32,33,36,0.18)] focus-within:shadow-[0_1px_6px_rgba(32,33,36,0.18)] transition-shadow">
              <svg className="w-5 h-5 text-gray-400 mr-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => { setQuery(e.target.value); setError(''); }}
                placeholder="Paste video URL..."
                className="flex-1 outline-none text-base bg-transparent text-gray-800 placeholder-gray-400"
                autoComplete="off"
                spellCheck={false}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 ml-2 hover:bg-gray-300 transition-colors"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="#5f6368">
                    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                  </svg>
                </button>
              )}
            </div>
          </div>

          {error && (
            <p className="text-red-500 text-sm mt-2 text-center">{error}</p>
          )}

          <div className="flex justify-center gap-3 mt-6">
            <button
              type="submit"
              disabled={loading}
              className="bg-[#f8f9fa] text-[#3c4043] text-sm px-5 py-2.5 rounded-md border border-[#f8f9fa] hover:border-gray-200 hover:shadow-sm transition-all font-medium"
            >
              {loading ? 'Fetching...' : 'Fetch Video'}
            </button>
            <button
              type="button"
              onClick={() => setQuery('')}
              className="bg-[#f8f9fa] text-[#3c4043] text-sm px-5 py-2.5 rounded-md border border-[#f8f9fa] hover:border-gray-200 hover:shadow-sm transition-all font-medium"
            >
              Clear
            </button>
          </div>
        </form>

        {/* Supported sites */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-500 mb-2">Supported sites</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <span className="text-xs text-gray-600 bg-gray-50 px-3 py-1 rounded-full border border-gray-100">MixDrop</span>
            <span className="text-xs text-gray-400 bg-gray-50 px-3 py-1 rounded-full border border-gray-100">Direct URLs</span>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#f2f2f2] text-sm text-gray-600">
        <div className="px-8 py-3 border-b border-gray-200">
          <span>United States</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center justify-between px-8 py-3">
          <div className="flex gap-6">
            <a href="#" className="hover:underline">About</a>
            <a href="#" className="hover:underline">Advertising</a>
            <a href="#" className="hover:underline">Business</a>
          </div>
          <div className="flex gap-6 mt-2 sm:mt-0">
            <a href="#" className="hover:underline">Privacy</a>
            <a href="#" className="hover:underline">Terms</a>
            <a href="#" className="hover:underline">Settings</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
