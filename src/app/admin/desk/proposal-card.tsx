'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Verdict } from '@/lib/types';
import { useAdminAuth } from '../admin-auth';
import { ChangePreview } from './change-preview';
import { commitUrl, timeAgo } from './desk-format';
import { DESTINATION_NOTE } from './desk-voice';
import type { PreviewPayload, QueueProposal } from './desk-types';
import { EvidenceBlock } from './evidence-block';
import { InkCheckbox } from './ink-checkbox';
import { SlugLine } from './slug-line';
import { VerdictActions } from './verdict-actions';

/** One item on the wire: a broadsheet block on hairlines answering, without a
 *  click, WHAT (the change preview), VALIDATE (the evidence block), and WHERE
 *  (the destination line) — canon: design/mocks/c-desk.html. Only "see the
 *  rest of a long diff" needs an interaction.
 *
 *  Bulk-triage additions (all optional, default off — Facts-tab cards don't
 *  use them): a selection checkbox, a keyboard-driven focus mark, and an
 *  inline error line for an id that came back in a bulk decide's `failed`
 *  list (the id stays visible in the pending list; this is how it explains
 *  why). */
export function ProposalCard({
  proposal,
  onDecided,
  selected = false,
  onToggleSelect,
  focused = false,
  errorMessage,
}: {
  proposal: QueueProposal;
  onDecided: (id: string, decision: 'approved' | 'rejected', verdict: Verdict) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  focused?: boolean;
  errorMessage?: string;
}) {
  const { getAuthHeaders } = useAdminAuth();
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<{ decision: 'approved' | 'rejected'; commit: string | null } | null>(null);

  useEffect(() => {
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
  }, [proposal.id]);

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(decision);
    setError(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ id: proposal.id, decision }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Decision failed.');
        setBusy(null);
        return;
      }
      setResult({ decision, commit: json.commit ?? null });
      onDecided(proposal.id, decision, json.verdict as Verdict);
    } catch {
      setError('Decision failed.');
      setBusy(null);
    }
  }

  const destination = proposal.destination;

  if (result) {
    return (
      <div id={`proposal-${proposal.id}`} className="border-b border-line py-4 last:border-b-0">
        <div className="flex items-center gap-3 text-[13px]">
          <span className={result.decision === 'approved' ? 'font-semibold text-paper' : 'text-faint'}>
            {result.decision === 'approved' ? 'Approved' : 'Rejected'}
          </span>
          <span className="flex-1 truncate text-dim">{proposal.title}</span>
          {result.commit ? (
            <a
              href={commitUrl(result.commit)}
              target="_blank"
              rel="noopener noreferrer"
              className="coord shrink-0 hover:text-dim"
            >
              {result.commit}
            </a>
          ) : (
            <span className="coord shrink-0">ledgered</span>
          )}
        </div>
        {result.decision === 'approved' && destination && destination.length > 0 && (
          <div className="coord mt-1">{destination.map((p) => `→ ${p}`).join('  ·  ')}</div>
        )}
      </div>
    );
  }

  return (
    <div
      id={`proposal-${proposal.id}`}
      className={`-ml-4 border-b border-line border-l-2 py-[30px] pl-4 transition-colors last:border-b-0 ${
        focused ? 'border-l-paper' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {onToggleSelect && <InkCheckbox checked={selected} onChange={onToggleSelect} label={`Select ${proposal.title}`} />}
          <SlugLine proposal={proposal} />
        </div>
        <span className="coord shrink-0">{timeAgo(proposal.created_at)}</span>
      </div>

      <h3 className="display mt-3 max-w-[820px] text-[22px] leading-[1.32] text-paper sm:text-[26px]">{proposal.title}</h3>

      {proposal.org && (
        <div className="mt-2">
          <Link href={`/orgs/${proposal.org}`} className="coord underline decoration-line underline-offset-2 hover:text-dim">
            {proposal.org_name || proposal.org}
          </Link>
        </div>
      )}

      <EvidenceBlock proposal={proposal} />

      <div className="mt-[22px] max-w-[820px]">
        {previewError ? (
          <p className="text-[12.5px] text-closing">{previewError}</p>
        ) : preview ? (
          <ChangePreview changes={preview.changes} notes={preview.notes} />
        ) : (
          <p className="text-[12.5px] italic text-faint">Loading preview…</p>
        )}
      </div>

      <div className="serif-statement mt-3 text-[12px] text-faint">
        {destination === null ? (
          <span className="not-italic text-closing">{proposal.destination_error || 'Destination could not be resolved.'}</span>
        ) : destination.length === 0 ? (
          <span>No files change — recorded as a decision only.</span>
        ) : (
          <>
            Destination — {DESTINATION_NOTE[proposal.type]}{' '}
            <span className="font-mono text-[11.5px] font-semibold not-italic text-dim">{destination.join(' · ')}</span>
          </>
        )}
      </div>

      {error && <p className="mt-2 text-[12.5px] text-closing">{error}</p>}
      {errorMessage && <p className="mt-2 text-[12.5px] text-closing">Bulk decide failed: {errorMessage}</p>}

      <div className="mt-[22px]">
        <VerdictActions
          onApprove={() => decide('approved')}
          onReject={() => decide('rejected')}
          approveLabel={busy === 'approved' ? 'Approving…' : 'Approve — set in registry'}
          rejectLabel={busy === 'rejected' ? 'Rejecting…' : 'Reject'}
          disabled={busy !== null}
        />
      </div>
    </div>
  );
}
