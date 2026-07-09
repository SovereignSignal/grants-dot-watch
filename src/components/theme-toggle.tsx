'use client';

// Sun/moon theme toggle. The pre-paint script in layout.tsx already sets
// data-theme="light" on <html> before first render (reading localStorage,
// falling back to prefers-color-scheme), so this component only needs to
// flip that attribute and persist the choice. Dark stays the default —
// "light" is the only value we ever write.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gw-theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [isLight, setIsLight] = useState(false);

  useEffect(() => {
    setIsLight(document.documentElement.getAttribute('data-theme') === 'light');
  }, []);

  const toggle = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode, etc.) — theme just won't persist.
    }
    setIsLight(next === 'light');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch theme"
      className={`inline-flex size-11 shrink-0 items-center justify-center rounded-md border border-line text-dim transition-colors hover:text-paper ${className}`}
    >
      {isLight ? (
        // moon — currently light, click to go dark
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
          <path
            d="M17 12.2A7 7 0 0 1 7.8 3 7.5 7.5 0 1 0 17 12.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // sun — currently dark, click to go light
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true">
          <circle cx="10" cy="10" r="3.6" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M10 1.8v2.2M10 16v2.2M3.6 3.6l1.55 1.55M14.85 14.85l1.55 1.55M1.8 10h2.2M16 10h2.2M3.6 16.4l1.55-1.55M14.85 5.15l1.55-1.55"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
