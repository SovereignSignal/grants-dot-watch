'use client';

// The Ledger search keeps the existing lazy index and keyboard navigation.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { SearchIndexItem } from '@/app/api/search-index/route';

type ItemType = SearchIndexItem['t'];

const GROUP_ORDER: ItemType[] = ['system', 'org', 'program'];
const GROUP_LABEL: Record<ItemType, string> = {
  system: 'Systems',
  org: 'Organizations',
  program: 'Programs',
};
const HREF: Record<ItemType, (id: string) => string> = {
  system: (id) => `/systems/${id}`,
  org: (id) => `/orgs/${id}`,
  program: (id) => `/programs/${id}`,
};

const MAX_RESULTS = 8;

function optionId(item: SearchIndexItem): string {
  return `search-option-${item.t}-${item.id}`;
}

/** 0 = no match, higher = better. */
function matchTier(text: string, q: string): number {
  if (!text) return 0;
  const t = text.toLowerCase();
  if (t === q) return 4;
  if (t.startsWith(q)) return 3;
  if (t.split(/\s+/).some((w) => w.startsWith(q))) return 2;
  if (t.includes(q)) return 1;
  return 0;
}

/** Name matches beat aka matches of the same tier, but a strong aka match
 *  still beats a weak name match (aka startsWith > name includes). */
function scoreItem(item: SearchIndexItem, q: string): number {
  const nameTier = matchTier(item.n, q);
  let akaTier = 0;
  if (item.a) for (const alt of item.a) akaTier = Math.max(akaTier, matchTier(alt, q));
  if (nameTier === 0 && akaTier === 0) return 0;
  return Math.max(nameTier * 10, akaTier * 10 - 3);
}

export default function Search({ label }: { label: string }) {
  const router = useRouter();
  const [items, setItems] = useState<SearchIndexItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLFormElement>(null);
  const fetchedRef = useRef(false);

  async function ensureIndex() {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/search-index');
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as SearchIndexItem[];
      setItems(data);
    } catch {
      fetchedRef.current = false; // allow a retry on next focus
      setError('Search index unavailable.');
    } finally {
      setLoading(false);
    }
  }

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!items || !q) return [];
    const scored = items
      .map((item) => ({ item, score: scoreItem(item, q) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.item.n.localeCompare(b.item.n))
      .slice(0, MAX_RESULTS)
      .map((x) => x.item);

    const byType = new Map<ItemType, SearchIndexItem[]>();
    for (const t of GROUP_ORDER) byType.set(t, []);
    for (const item of scored) byType.get(item.t)!.push(item);
    return GROUP_ORDER.map((t) => ({ type: t, items: byType.get(t)! })).filter((g) => g.items.length > 0);
  }, [items, query]);

  const flatResults = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const awardQuery = query.trim();
  const hasAwardAction = awardQuery.length > 0;
  const awardOptionId = 'search-option-awards-query';
  const awardIndex = hasAwardAction ? flatResults.length : -1;
  const navCount = flatResults.length + (hasAwardAction ? 1 : 0);
  const panelOpen = open && (loading || error !== null || query.trim().length > 0);

  function resetSearch() {
    setQuery('');
    setOpen(false);
    setActiveIndex(-1);
    inputRef.current?.blur();
  }

  function go(item: SearchIndexItem) {
    router.push(HREF[item.t](item.id));
    resetSearch();
  }

  function goAwards() {
    router.push(`/awards?q=${encodeURIComponent(awardQuery)}`);
    resetSearch();
  }

  function closePanel() {
    setOpen(false);
    setActiveIndex(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      if (navCount === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % navCount);
    } else if (e.key === 'ArrowUp') {
      if (navCount === 0) return;
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? navCount - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (hasAwardAction && activeIndex === awardIndex) {
        e.preventDefault();
        goAwards();
        return;
      }
      const target = flatResults[activeIndex >= 0 ? activeIndex : 0];
      if (target) {
        e.preventDefault();
        go(target);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePanel();
      inputRef.current?.blur();
    }
  }

  // Cmd/Ctrl+K focuses the search from anywhere on the page.
  useEffect(() => {
    function onGlobalKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        requestAnimationFrame(() => inputRef.current?.focus());
      }
    }
    window.addEventListener('keydown', onGlobalKey);
    return () => window.removeEventListener('keydown', onGlobalKey);
  }, []);

  // Click outside closes the suggestions.
  useEffect(() => {
    if (!panelOpen) return;
    function onDocMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closePanel();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [panelOpen, query]);

  return (
    <form ref={containerRef} className="ledger-search" role="search" action="/programs"
      onSubmit={(event) => {
        event.preventDefault();
        setOpen(false);
        router.push(`/programs?q=${encodeURIComponent(query.trim())}`);
      }}>
      <label htmlFor="hero-search">{label}</label>
      <div className="ledger-search-controls">
        <input
          ref={inputRef}
          id="hero-search"
          name="q"
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => {
            setOpen(true);
            ensureIndex();
          }}
          onBlur={() => closePanel()}
          onKeyDown={onKeyDown}
          placeholder="Try zero-knowledge, Mozilla or AI safety"
          role="combobox"
          aria-expanded={panelOpen}
          aria-controls="search-results"
          aria-autocomplete="list"
          aria-activedescendant={panelOpen && activeIndex >= 0 ? (activeIndex === awardIndex ? awardOptionId : optionId(flatResults[activeIndex])) : undefined}
          aria-label="Search the register"
        />
        <button type="submit" className="ink-button">Search</button>
      </div>
      {panelOpen && (
        <div
          id="search-results"
          role="listbox"
          className="search-results"
        >
          {loading && <div className="px-3 py-3 text-sm text-dim">Loading…</div>}
          {!loading && error && (
            <div className="flex items-center justify-between gap-3 px-3 py-3 text-sm text-dim" role="status">
              <span>{error}</span>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => ensureIndex()}
                className="shrink-0 border-b border-line font-semibold text-paper hover:border-paper"
              >
                Retry
              </button>
            </div>
          )}
          {!loading && !error && items && query.trim() && groups.length === 0 && (
            <div className="px-3 py-3 text-sm text-dim">No matches on file.</div>
          )}
          {!loading && !error &&
            groups.map((g) => (
              <div key={g.type}>
                <div className="coord px-3 pt-2.5 pb-1">{GROUP_LABEL[g.type]}</div>
                {g.items.map((item) => {
                  const idx = flatResults.indexOf(item);
                  const active = idx === activeIndex;
                  return (
                    <button
                      key={`${item.t}-${item.id}`}
                      id={optionId(item)}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseDown={(e) => e.preventDefault()}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => go(item)}
                      className={`block w-full truncate px-3 py-1.5 text-left text-sm transition-colors ${
                        active ? 'bg-line text-paper' : 'text-dim hover:bg-line/60 hover:text-paper'
                      }`}
                    >
                      {item.n}
                    </button>
                  );
                })}
              </div>
            ))}
          {hasAwardAction && (
            <button
              id={awardOptionId}
              type="button"
              role="option"
              aria-selected={activeIndex === awardIndex}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(awardIndex)}
              onClick={() => goAwards()}
              className={`block w-full truncate border-t border-line px-3 py-2 text-left text-sm transition-colors ${
                activeIndex === awardIndex ? 'bg-line text-paper' : 'text-dim hover:bg-line/60 hover:text-paper'
              }`}
            >
              Search awards for {awardQuery}
            </button>
          )}
        </div>
      )}
    </form>
  );
}
