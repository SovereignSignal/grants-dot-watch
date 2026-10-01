import type { ReviewBrief } from './review-brief';

/** The source the owner can open: domain first, then the verbatim quote.
 *  No URL at all is an unsourced badge, not a grey aside. */
export function EvidenceBlock({ brief }: { brief: ReviewBrief }) {
  if (brief.unsourced) {
    return (
      <div className="mt-4">
        <span className="inline-flex items-center border border-paper px-2 py-1 font-sans text-[11px] font-bold tracking-[.14em] text-paper uppercase">
          Unsourced
        </span>
        <p className="mt-2 text-[13.5px] leading-relaxed text-dim">No official source or verbatim quote is on file.</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex max-w-[740px] flex-col gap-4">
      {brief.sources.map((source) => (
        <div key={source.url}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="block text-paper no-underline hover:underline"
          >
            <span className="block font-sans text-[18px] font-semibold tracking-tight sm:text-[20px]">{source.domain}</span>
            <span className="mt-0.5 block truncate font-sans text-[12px] text-faint">{source.url.replace(/^https:\/\//, '')}</span>
          </a>
          {source.quotes.length > 0 ? (
            <div className="mt-2 flex flex-col gap-2 border-l border-line pl-4">
              {source.quotes.map((quote) => (
                <blockquote key={quote} className="serif-statement text-[15.5px] leading-[1.55] break-words text-dim">
                  &ldquo;{quote}&rdquo;
                </blockquote>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-[13px] text-dim">No verbatim quote on file.</p>
          )}
        </div>
      ))}
    </div>
  );
}
