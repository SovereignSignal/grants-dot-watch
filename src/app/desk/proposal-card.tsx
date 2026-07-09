'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Card, WireBadge } from '@/components/ui';
import type { Proposal, Verdict } from '@/lib/types';
import { TYPE_LABEL } from '@/proposal-lanes';
import { shortUrl, timeAgo } from './desk-format';

interface PreviewChange {
  path: string;
  content: string;
  op: 'create' | 'update' | 'append';
}

interface PreviewPayload {
  changes: PreviewChange[];
  notes: string[];
}

export function ProposalCard({
  proposal,
  onDecided,
}: {
  proposal: Proposal;
  onDecided: (id: string, decision: 'approved' | 'rejected', verdict: Verdict) => void;
}) {
  const [busy, setBusy] = useState<'approved' | 'rejected' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [result, setResult] = useState<{ decision: 'approved' | 'rejected'; commit: string | null } | null>(null);

  async function togglePreview() {
    if (preview) {
      setPreviewOpen((v) => !v);
      return;
    }
    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/desk/preview?id=${encodeURIComponent(proposal.id)}`);
      const json = await res.json();
      if (res.ok) {
        setPreview(json);
        setPreviewOpen(true);
      } else {
        setError(json.error || 'Preview failed.');
      }
    } catch {
      setError('Preview failed.');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(decision);
    setError(null);
    try {
      const res = await fetch('/api/desk/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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

  if (result) {
    return (
      <div className="flex items-center gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm">
        <span className={result.decision === 'approved' ? 'text-live' : 'text-dim'}>
          {result.decision === 'approved' ? 'Approved' : 'Rejected'}
        </span>
        <span className="flex-1 truncate text-paper">{proposal.title}</span>
        <span className="coord shrink-0">{result.commit || 'ledgered'}</span>
      </div>
    );
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <span className="coord rounded border border-line px-1.5 py-0.5">{TYPE_LABEL[proposal.type]}</span>
        {proposal.confidence != null && <span className="font-mono text-xs text-faint">{proposal.confidence}%</span>}
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
        {proposal.evidence_url && (
          <a
            href={proposal.evidence_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-dim underline decoration-line hover:text-paper"
          >
            {shortUrl(proposal.evidence_url)}
          </a>
        )}
        <span className="coord ml-auto shrink-0">{timeAgo(proposal.created_at)}</span>
      </div>

      <div>
        <button type="button" onClick={togglePreview} className="coord hover:text-dim">
          {previewLoading ? 'Loading preview…' : previewOpen ? 'Hide change preview' : 'Show change preview'}
        </button>
        {previewOpen && preview && (
          <div className="mt-2 flex flex-col gap-2">
            {preview.changes.length === 0 && (
              <p className="text-xs text-faint">{preview.notes[0] || 'No file changes.'}</p>
            )}
            {preview.changes.map((c) => (
              <div key={c.path}>
                <div className="coord mb-1">
                  {c.op} · {c.path}
                </div>
                <pre className="max-h-64 overflow-auto rounded bg-deep p-3 font-mono text-xs text-dim">{c.content}</pre>
              </div>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-closing">{error}</p>}

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
