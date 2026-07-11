'use client';

// Sun/moon theme toggle. The pre-paint script in layout.tsx already sets
// data-theme="dark" (or "light") on <html> before first render (reading
// localStorage, falling back to prefers-color-scheme), so this component
// only needs to flip that attribute and persist the choice. Light stays
// the default — "dark" is the opt-in state, but an explicit "light" is
// still written so it can override a dark system preference.

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'gw-theme';

export default function ThemeToggle({ className = '' }: { className?: string }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
  }, []);

  const toggle = () => {
    const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // localStorage unavailable (private mode, etc.) — theme just won't persist.
    }
    setIsDark(next === 'dark');
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Switch theme"
      className={`inline-flex size-8 shrink-0 items-center justify-center border border-line text-faint transition-colors hover:text-paper hover:border-paper ${className}`}
    >
      {isDark ? (
        // moon — currently dark, click to go light
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true">
          <path
            d="M17 12.2A7 7 0 0 1 7.8 3 7.5 7.5 0 1 0 17 12.2Z"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        // sun — currently light, click to go dark
        <svg viewBox="0 0 20 20" width="15" height="15" fill="none" aria-hidden="true">
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
