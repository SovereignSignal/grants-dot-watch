'use client';
import { useState, type ReactNode } from 'react';

export function FilterPanel({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return <div className="filter-disclosure">
    <button type="button" className="filter-toggle" aria-expanded={open} aria-controls="opportunity-filters" onClick={() => setOpen(!open)}>Refine your search <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    <noscript><style>{'.filter-content{display:block!important}.filter-toggle{display:none!important}'}</style></noscript>
    <div id="opportunity-filters" className={`filter-content${open ? ' is-open' : ''}`}>{children}</div>
  </div>;
}
