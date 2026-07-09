'use client';

import { useCallback, useEffect, useState } from 'react';
import { Coord, Empty, PageHeader, Stat } from '@/components/ui';
import type { Proposal, Verdict } from '@/lib/types';
import { useAdminAuth } from '../admin-auth';
import { timeAgo } from './desk-format';
import { ProposalCard } from './proposal-card';

type Tab = 'judgment' | 'fact' | 'log';

interface QueuePayload {
  proposals: Proposal[];
  counts: { pendingJudgment: number; pendingFact: number; decidedToday: number; total: number };
  verdicts: Verdict[];
  dev: boolean;
}

export default function DeskPage() {
  const { getAuthHeaders } = useAdminAuth();
  const [data, setData] = useState<QueuePayload | null>(null);
  const [tab, setTab] = useState<Tab>('judgment');
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoadErr(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/queue', { cache: 'no-store', headers });
      if (!res.ok) {
        setLoadErr(res.status === 401 ? 'Not authorized.' : 'Could not load the queue.');
        return;
      }
      const payload = (await res.json()) as QueuePayload;
      setData(payload);
    } catch {
      setLoadErr('Could not reach the Desk API.');
    }
  }, [getAuthHeaders]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  const handleDecided = useCallback((id: string, decision: 'approved' | 'rejected', verdict: Verdict) => {
    setData((prev) => {
      if (!prev) return prev;
      const decided = prev.proposals.find((p) => p.id === id);
      const proposals = prev.proposals.map((p) => (p.id === id ? { ...p, state: decision } : p));
      const wasJudgment = decided?.lane === 'judgment';
      const counts = {
        ...prev.counts,
        pendingJudgment: prev.counts.pendingJudgment - (wasJudgment ? 1 : 0),
        pendingFact: prev.counts.pendingFact - (wasJudgment ? 0 : 1),
        decidedToday: prev.counts.decidedToday + 1,
      };
      const verdicts = verdict ? [verdict, ...prev.verdicts] : prev.verdicts;
      return { ...prev, proposals, counts, verdicts };
    });
  }, []);

  async function runSeed() {
    setSeeding(true);
    setSeedMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/seed', { method: 'POST', headers });
      const json = await res.json();
      if (res.ok) {
        setSeedMsg(`Imported ${json.imported}, skipped ${json.skipped}.`);
        await loadQueue();
      } else {
        setSeedMsg(json.error || 'Import failed.');
      }
    } catch {
      setSeedMsg('Import failed.');
    } finally {
      setSeeding(false);
    }
  }

  if (loadErr || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-16">
        <Empty>{loadErr || 'Loading the desk…'}</Empty>
      </div>
    );
  }

  const judgmentPending = data.proposals.filter((p) => p.lane === 'judgment' && p.state === 'pending');
  const factPending = data.proposals.filter((p) => p.lane === 'fact' && p.state === 'pending');

  return (
    <>
      <PageHeader
        eyebrow="THE DESK"
        title="The Desk"
        sub="The owner's gate. Approve or reject what the wires found before it lands in the registry."
        right={
          <button
            type="button"
            onClick={runSeed}
            disabled={seeding}
            className="coord rounded border border-line px-3 py-2 hover:border-faint disabled:opacity-50"
          >
            {seeding ? 'Importing…' : 'Import new proposals'}
          </button>
        }
      />
      <div className="mx-auto max-w-6xl px-4 pb-16">
        {data.dev && (
          <p className="coord mb-6 rounded border border-dashed border-line px-3 py-2 text-signal">
            Dev mode: ADMIN_TOKEN unset, the gate is open.
          </p>
        )}
        {seedMsg && <p className="coord mb-6">{seedMsg}</p>}

        <div className="mb-8 grid grid-cols-3 gap-3 sm:gap-4">
          <Stat label="Pending judgment" value={data.counts.pendingJudgment} />
          <Stat label="Pending facts" value={data.counts.pendingFact} />
          <Stat label="Decided today" value={data.counts.decidedToday} />
        </div>

        <div className="starline mb-6 flex gap-1 pt-4">
          {(['judgment', 'fact', 'log'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm ${tab === t ? 'border-b-2 border-signal text-paper' : 'text-dim hover:text-paper'}`}
            >
              {t === 'judgment'
                ? `Judgment (${judgmentPending.length})`
                : t === 'fact'
                  ? `Facts (${factPending.length})`
                  : `Log (${data.verdicts.length})`}
            </button>
          ))}
        </div>

        {tab === 'judgment' &&
          (judgmentPending.length === 0 ? (
            <Empty>No judgment calls on file. The queue is caught up.</Empty>
          ) : (
            <div className="flex flex-col gap-3">
              {judgmentPending.map((p) => (
                <ProposalCard key={p.id} proposal={p} onDecided={handleDecided} />
              ))}
            </div>
          ))}

        {tab === 'fact' && (
          <div className="flex flex-col gap-4">
            <p className="rounded-md border border-line bg-surface p-4 text-sm text-dim">
              These apply automatically with provenance; undo is <span className="font-mono">git revert</span>. Auto-apply
              arrives with the live feed; for now you&apos;re the loop.
            </p>
            {factPending.length === 0 ? (
              <Empty>No fact-lane items on file.</Empty>
            ) : (
              <div className="flex flex-col gap-3">
                {factPending.map((p) => (
                  <ProposalCard key={p.id} proposal={p} onDecided={handleDecided} />
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'log' &&
          (data.verdicts.length === 0 ? (
            <Empty>No decisions on file yet.</Empty>
          ) : (
            <div className="flex flex-col divide-y divide-line rounded-md border border-line bg-surface">
              {data.verdicts.map((v, i) => {
                const proposal = data.proposals.find((p) => p.id === v.proposal_id);
                return (
                  <div key={`${v.proposal_id}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={v.decision === 'approved' ? 'text-live' : 'text-dim'}>
                      {v.decision === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                    <span className="flex-1 truncate text-paper">{proposal?.title || v.proposal_id}</span>
                    {v.note && <span className="hidden max-w-xs truncate text-xs text-faint md:inline">{v.note}</span>}
                    <span className="coord shrink-0">{v.commit || 'ledgered'}</span>
                    <span className="coord hidden shrink-0 sm:inline">{timeAgo(v.at)}</span>
                  </div>
                );
              })}
            </div>
          ))}
      </div>
    </>
  );
}
