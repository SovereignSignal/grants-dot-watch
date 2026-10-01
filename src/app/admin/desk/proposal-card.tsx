'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAdminAuth } from '../admin-auth';
import { ChangePreview } from './change-preview';
import { timeAgo } from './desk-format';
import { DESTINATION_NOTE } from './desk-voice';
import type { PreviewPayload, QueueProposal } from './desk-types';
import { EvidenceBlock } from './evidence-block';
import { InkCheckbox } from './ink-checkbox';
import { reviewBrief, type ReviewFact } from './review-brief';
import { SlugLine } from './slug-line';
import { VerdictActions } from './verdict-actions';

const META_FACTS = new Set(['Kind', 'Wire']);

function visibleFacts(facts: ReviewFact[], title: string): ReviewFact[] {
  return facts.filter((fact) => {
    if (!fact.value || fact.value === 'Not on file') return false;
    if (META_FACTS.has(fact.label)) return false;
    if (fact.label === 'Name' && fact.value === title) return false;
    return true;
  });
}

/** One judgment, short enough for a phone: title, pill, chips, a two-column
 *  fact grid. The write path and the owner note stay behind Show record.
 *  Judgment uses the page's sticky bar; other lanes keep buttons on the card. */
export function ProposalCard({
  proposal,
  onDecide,
  onRejectNote,
  rejectNote = '',
  selected = false,
  onToggleSelect,
  focused = false,
  errorMessage,
  disabled = false,
  showActions = true,
  detailsOnly = false,
}: {
  proposal: QueueProposal;
  onDecide: (id: string, decision: 'approved' | 'rejected', note?: string) => void;
  onRejectNote?: (id: string, note: string) => void;
  rejectNote?: string;
  selected?: boolean;
  onToggleSelect?: () => void;
  focused?: boolean;
  errorMessage?: string;
  disabled?: boolean;
  showActions?: boolean;
  /** Record, evidence, and facts only. The list row already shows the summary. */
  detailsOnly?: boolean;
}) {
  const { getAuthHeaders } = useAdminAuth();
  const [showRecord, setShowRecord] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const brief = reviewBrief(proposal);
  const facts = visibleFacts(brief.facts, brief.title);

  useEffect(() => {
    if (!showRecord || preview || previewError) return;
    let cancelled = false;
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetch(`/api/desk/preview?id=${encodeURIComponent(proposal.id)}`, { headers });
        const json = await res.json();
        if (cancelled) return;
        if (res.ok) setPreview(json);
        else setPreviewError(json.error || 'Preview failed.');
      } catch {
        if (!cancelled) setPreviewError('Preview failed.');
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showRecord, proposal.id]);

  function reject() {
    const trimmed = rejectNote.trim();
    setRejectOpen(false);
    onDecide(proposal.id, 'rejected', trimmed || undefined);
  }

  const destination = proposal.destination;

  return (
    <div
      id={detailsOnly ? undefined : `proposal-${proposal.id}`}
      data-testid={detailsOnly ? 'desk-card-details' : 'desk-card'}
      className={
        detailsOnly
          ? 'border-t border-line pt-3'
          : `border-b border-line border-l-2 py-4 pl-3 transition-colors last:border-b-0 sm:py-5 sm:pl-4 ${
              focused ? 'border-l-paper' : 'border-l-transparent'
            }`
      }
    >
      {!detailsOnly && <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {onToggleSelect && (
            <span className="mt-1.5">
              <InkCheckbox checked={selected} onChange={onToggleSelect} label={`Select ${brief.title}`} />
            </span>
          )}
          <h3 className="display min-w-0 text-[22px] leading-[1.15] text-paper sm:text-[28px]">{brief.title}</h3>
        </div>
        <span className="coord shrink-0">{timeAgo(proposal.created_at)}</span>
      </div>}

      {!detailsOnly && <div className="mt-2 flex items-center gap-2">
        <p
          data-testid="review-call"
          className="inline-flex shrink-0 items-center rounded-full border border-paper px-2 py-0.5 font-sans text-[10px] font-bold tracking-[.08em] text-paper uppercase"
        >
          {brief.pill}
        </p>
        <p className="min-w-0 flex-1 truncate text-[14px] leading-snug text-dim" title={brief.reason}>
          {brief.reason}
        </p>
      </div>}

      {!detailsOnly && (
      <div className="mt-2">
        <SlugLine proposal={proposal} proposer={brief.proposer} />
      </div>
      )}

      <EvidenceBlock brief={brief} />

      {facts.length > 0 && (
        <dl className="mt-3 grid max-w-[720px] grid-cols-2 gap-x-3 gap-y-2">
          {facts.map((fact) => (
            <div key={fact.label} className="min-w-0" data-testid={fact.corrected ? 'corrected-fact' : undefined}>
              <dt className="coord">{fact.label}</dt>
              <dd className={`text-[14px] leading-snug break-words text-paper ${fact.corrected ? 'border-l-2 border-paper pl-1.5' : ''}`}>
                {fact.href ? (
                  fact.href.startsWith('/') ? (
                    <Link href={fact.href} className="underline decoration-line underline-offset-2 hover:text-dim">
                      {fact.value}
                    </Link>
                  ) : (
                    <a href={fact.href} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-dim">
                      {fact.value}
                    </a>
                  )
                ) : (
                  fact.value
                )}
                {fact.corrected && <span className="mt-0.5 block font-sans text-[10px] font-bold tracking-[.08em] text-paper uppercase">Corrected</span>}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowRecord((open) => !open)}
          aria-expanded={showRecord}
          className="coord underline decoration-line underline-offset-2 hover:text-dim"
        >
          {showRecord ? 'Hide record' : 'Show record'}
        </button>
        {showRecord && (
          <div className="mt-3 max-w-[820px]">
            {previewError ? (
              <p className="text-[12.5px] text-closing">{previewError}</p>
            ) : preview ? (
              <ChangePreview changes={preview.changes} notes={preview.notes} />
            ) : (
              <p className="text-[12.5px] text-faint italic">Loading record…</p>
            )}
            <p className="serif-statement mt-3 text-[12px] text-faint">
              {destination === null ? (
                <span className="not-italic text-closing">{proposal.destination_error || 'Destination could not be resolved.'}</span>
              ) : destination.length === 0 ? (
                <span>No files change. Recorded as a decision only.</span>
              ) : (
                <>
                  Writes {DESTINATION_NOTE[proposal.type]}{' '}
                  <span className="font-mono text-[11.5px] font-semibold not-italic break-all text-dim">{destination.join(' · ')}</span>
                </>
              )}
            </p>
            {proposal.validation && (
              <p className="coord mt-2">
                {proposal.validation.never_auto ? (
                  <span className="text-faint">Needs the owner</span>
                ) : (
                  <span className="text-closing">Machine check failed: {proposal.validation.reason}</span>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      {errorMessage && <p className="mt-2 text-[12.5px] text-closing">Could not decide: {errorMessage}</p>}

      {showActions && (
        <div className="mt-4 max-w-[640px]">
          {rejectOpen && (
            <div className="mb-3 border border-paper bg-void p-3" data-testid="reject-sheet">
              <label className="coord mb-1 block" htmlFor={`reject-note-${proposal.id}`}>
                Reject reason, optional
              </label>
              <input
                id={`reject-note-${proposal.id}`}
                type="text"
                value={rejectNote}
                onChange={(e) => onRejectNote?.(proposal.id, e.target.value)}
                placeholder="Why reject, if you want it on the log"
                className="mb-3 w-full border-b border-line bg-transparent px-1 py-2 text-[15px] text-paper placeholder:text-faint focus:border-paper focus:outline-none"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={reject}
                  disabled={disabled}
                  className="inline-flex min-h-11 flex-1 items-center justify-center bg-paper px-3 font-sans text-[12px] font-bold tracking-[.12em] text-void uppercase disabled:opacity-50"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => setRejectOpen(false)}
                  className="inline-flex min-h-11 flex-1 items-center justify-center border border-paper px-3 font-sans text-[12px] font-bold tracking-[.12em] text-paper uppercase"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          <VerdictActions
            variant="buttons"
            onApprove={() => onDecide(proposal.id, 'approved')}
            onReject={() => setRejectOpen(true)}
            approveLabel="Approve"
            rejectLabel="Reject"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
}
