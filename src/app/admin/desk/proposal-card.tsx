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
import { reviewBrief } from './review-brief';
import { SlugLine } from './slug-line';
import { VerdictActions } from './verdict-actions';

/** One judgment, readable without opening the YAML: recommendation, source,
 *  and the facts in words. The proposed record stays behind Show record.
 *  Approve and Reject call the same decide path as before. */
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
}) {
  const { getAuthHeaders } = useAdminAuth();
  const [showRecord, setShowRecord] = useState(false);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const brief = reviewBrief(proposal);

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
    onDecide(proposal.id, 'rejected', trimmed || undefined);
  }

  const destination = proposal.destination;
  const callLabel = brief.call === 'approve' ? 'Approve' : brief.call === 'reject' ? 'Reject' : 'Check';

  return (
    <div
      id={`proposal-${proposal.id}`}
      data-testid="desk-card"
      className={`border-b border-line border-l-2 py-6 pl-3 transition-colors last:border-b-0 sm:py-8 sm:pl-4 ${
        focused ? 'border-l-paper' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {onToggleSelect && (
            <span className="mt-1">
              <InkCheckbox checked={selected} onChange={onToggleSelect} label={`Select ${brief.title}`} />
            </span>
          )}
          <div className="min-w-0">
            <p data-testid="review-call" className="font-sans text-[12px] font-extrabold tracking-[.14em] text-paper uppercase">
              {callLabel}
            </p>
            <p className="serif-statement mt-1 max-w-[720px] text-[17px] leading-snug text-paper sm:text-[18px]">{brief.reason}</p>
          </div>
        </div>
        <span className="coord shrink-0">{timeAgo(proposal.created_at)}</span>
      </div>

      <h3 className="display mt-4 max-w-[820px] text-[26px] leading-[1.2] text-paper sm:text-[32px]">{brief.title}</h3>
      <div className="mt-2">
        <SlugLine proposal={proposal} proposer={brief.proposer} />
      </div>

      <EvidenceBlock brief={brief} />

      <dl className="mt-5 grid max-w-[720px] grid-cols-1 gap-y-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:gap-x-4 sm:gap-y-1">
        {brief.facts.map((fact) => (
          <div key={fact.label} className="contents">
            <dt className="coord pt-0.5">{fact.label}</dt>
            <dd className="mb-1 min-w-0 text-[15px] leading-snug break-words text-paper sm:mb-0">
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
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-4">
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
          </div>
        )}
      </div>

      <div className="serif-statement mt-3 text-[12px] text-faint">
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
      </div>

      {errorMessage && <p className="mt-2 text-[12.5px] text-closing">Could not decide: {errorMessage}</p>}

      {proposal.validation && (
        <p className="coord mt-3">
          {proposal.validation.never_auto ? (
            <span className="text-faint">Needs the owner</span>
          ) : (
            <span className="text-closing">Machine check failed: {proposal.validation.reason}</span>
          )}
        </p>
      )}

      <div className="mt-5 max-w-[640px]">
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
        <VerdictActions
          variant="buttons"
          onApprove={() => onDecide(proposal.id, 'approved')}
          onReject={reject}
          approveLabel="Approve"
          rejectLabel="Reject"
          disabled={disabled}
        />
      </div>
    </div>
  );
}
