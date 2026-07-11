'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Card, WireBadge } from '@/components/ui';
import type { Verdict } from '@/lib/types';
import { TYPE_LABEL } from '@/proposal-lanes';
import { useAdminAuth } from '../admin-auth';
import { ChangePreview } from './change-preview';
import { commitUrl, timeAgo } from './desk-format';
import type { PreviewPayload, QueueProposal } from './desk-types';
import { EvidenceBlock } from './evidence-block';

/** Three questions, answered on every card without a click: WHAT (change
 *  preview, loaded on mount, collapsed to ~10 lines), VALIDATE (the wire
 *  signal behind it), WHERE (the destination path, already computed by the
 *  queue). Only "see the rest of a long diff" needs an interaction.
 *
 *  Bulk-triage additions (all optional, default off — Facts-tab cards don't
 *  use them): a selection checkbox, a keyboard-driven focus ring, and an
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
      <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface px-4 py-3 text-sm">
        <div className="flex items-center gap-3">
          <span className={result.decision === 'approved' ? 'text-live' : 'text-dim'}>
            {result.decision === 'approved' ? 'Approved' : 'Rejected'}
          </span>
          <span className="flex-1 truncate text-paper">{proposal.title}</span>
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
          <div className="coord">
            {destination.map((p) => (
              <div key={p}>→ {p}</div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <Card id={`proposal-${proposal.id}`} className={`flex flex-col gap-3 ${focused ? 'ring-2 ring-signal' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {onToggleSelect && (
            <input
              type="checkbox"
              checked={selected}
              onChange={onToggleSelect}
              aria-label={`Select ${proposal.title}`}
              className="size-4 shrink-0"
            />
          )}
          <span className="coord rounded border border-line px-1.5 py-0.5">{TYPE_LABEL[proposal.type]}</span>
        </div>
        <span className="coord shrink-0">{timeAgo(proposal.created_at)}</span>
      </div>

      <div>
        <h3 className="font-medium leading-snug text-paper">{proposal.title}</h3>
        <p className="mt-1 text-sm text-dim">{proposal.summary}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {proposal.wire && <WireBadge wire={proposal.wire} small />}
        {proposal.org && (
          <Link href={`/orgs/${proposal.org}`} className="text-dim underline decoration-line hover:text-paper">
            {proposal.org_name || proposal.org}
          </Link>
        )}
      </div>

      <EvidenceBlock proposal={proposal} />

      <div>
        <div className="coord mb-1.5">Where</div>
        {destination === null ? (
          <p className="text-xs text-closing">{proposal.destination_error || 'Destination could not be resolved.'}</p>
        ) : destination.length === 0 ? (
          <p className="text-xs text-faint">No files change — recorded as a decision only.</p>
        ) : (
          <div className="coord">
            {destination.map((p) => (
              <div key={p}>→ {p}</div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="coord mb-1.5">What</div>
        {previewError ? (
          <p className="text-xs text-closing">{previewError}</p>
        ) : preview ? (
          <ChangePreview changes={preview.changes} notes={preview.notes} />
        ) : (
          <p className="text-xs text-faint">Loading preview…</p>
        )}
      </div>

      {error && <p className="text-xs text-closing">{error}</p>}
      {errorMessage && <p className="text-xs text-closing">Bulk decide failed: {errorMessage}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => decide('approved')}
          disabled={busy !== null}
          className="min-h-11 flex-1 rounded-md border border-live bg-live/15 font-medium text-live disabled:opacity-50"
        >
          {busy === 'approved' ? 'Approving…' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => decide('rejected')}
          disabled={busy !== null}
          className="min-h-11 flex-1 rounded-md border border-line font-medium text-dim disabled:opacity-50"
        >
          {busy === 'rejected' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>
    </Card>
  );
}
