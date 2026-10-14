'use client';

// The house theme toggle, matching sovereignsignal.com: the label names the mode
// the click will switch to, the choice lands on <html data-theme> and in
// localStorage "theme", and the theme-color meta follows the paper. The root
// layout applies a saved choice before paint; with none saved, tokens.css
// follows the system setting.
import { useEffect, useState } from 'react';

type Mode = 'light' | 'dark';
const STORAGE_KEY = 'theme';
const query = () => window.matchMedia('(prefers-color-scheme: dark)');

function current(): Mode {
  const pinned = document.documentElement.dataset.theme;
  if (pinned === 'light' || pinned === 'dark') return pinned;
  return query().matches ? 'dark' : 'light';
}

function syncThemeColor() {
  const paper = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
  const meta = document.querySelector('meta[name="theme-color"]');
  if (paper && meta) meta.setAttribute('content', paper);
}

export default function ThemeToggle() {
  // Unknown until the browser answers, so the server markup carries no label
  // and the button stays hidden until it can be right.
  const [next, setNext] = useState<Mode | null>(null);

  useEffect(() => {
    const render = () => { setNext(current() === 'dark' ? 'light' : 'dark'); syncThemeColor(); };
    render();
    const mq = query();
    mq.addEventListener('change', render);
    return () => mq.removeEventListener('change', render);
  }, []);

  const flip = () => {
    const to = current() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = to;
    try { localStorage.setItem(STORAGE_KEY, to); } catch { /* private mode: the choice lasts the page */ }
    setNext(to === 'dark' ? 'light' : 'dark');
    syncThemeColor();
  };

  return (
    <button type="button" className="theme-toggle" hidden={next === null}
      aria-label={next ? `Switch to ${next} mode` : undefined} onClick={flip}>
      {next === 'dark' ? 'Dark' : 'Light'}<span className="theme-toggle-word"> mode</span>
    </button>
  );
}
