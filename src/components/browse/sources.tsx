// Footnote-style source citations — a superscript marker chain to drop at the
// end of a standfirst/profile paragraph, plus the numbered footnote list it
// points at. Per design/mocks/c-orgcard.html's .cite / .sources. The registry
// schema only carries a flat sources: string[] (no per-claim attribution), so
// citations mark "this profile draws on N sources," not a specific sentence.

function hostPath(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

const CITE_CAP = 4;

/** Superscript "¹ ² ³" citation markers, each linking straight to its source. */
export function SourceCitations({ sources }: { sources: string[] | undefined }) {
  if (!sources || sources.length === 0) return null;
  const shown = sources.slice(0, CITE_CAP);
  return (
    <sup className="ml-0.5 text-[10px] leading-none font-bold text-faint not-italic">
      {shown.map((src, i) => (
        <a key={src} href={src} target="_blank" rel="noreferrer" className="hover:text-paper">
          {i > 0 ? ',' : ''}
          {i + 1}
        </a>
      ))}
    </sup>
  );
}

/** The numbered footnote list itself — every provenance URL on file. */
export function SourcesList({ sources, label = 'Sources' }: { sources: string[] | undefined; label?: string }) {
  if (!sources || sources.length === 0) return null;
  return (
    <div className="mt-6">
      <div className="coord mb-2.5">{label}</div>
      <ol className="flex flex-col">
        {sources.map((src, i) => (
          <li key={src} className={`flex gap-2 py-2 text-[11.5px] leading-relaxed text-dim ${i > 0 ? 'border-t border-line' : ''}`}>
            <span aria-hidden className="shrink-0 font-bold text-faint">
              {i + 1}.
            </span>
            <a
              href={src}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 border-b border-line break-words text-dim hover:border-paper hover:text-paper"
            >
              {hostPath(src)}
            </a>
          </li>
        ))}
      </ol>
    </div>
  );
}
