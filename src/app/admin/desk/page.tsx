'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Empty, Stat } from '@/components/ui';
import { tabClass } from '@/components/ui-filters';
import type { ProposalType, Verdict } from '@/lib/types';
import { PROPOSAL_TYPE_ORDER, typeCountsSummary } from '@/proposal-lanes';
import { useAdminAuth } from '../admin-auth';
import { BulkBar } from './bulk-bar';
import { commitUrl, dateShortIso, timeAgo } from './desk-format';
import { DeskHeader } from './desk-header';
import { DEFAULT_FILTERS, type DecideBulkResponse, type FilterState, type QueueProposal } from './desk-types';
import { FiltersBar } from './filters-bar';
import { ProposalCard } from './proposal-card';
import { ProposalGroup } from './proposal-group';
import { VerdictActions } from './verdict-actions';

type Tab = 'judgment' | 'fact' | 'log';

interface QueuePayload {
  proposals: QueueProposal[];
  counts: { pendingJudgment: number; pendingFact: number; decidedToday: number; total: number };
  verdicts: Verdict[];
  dev: boolean;
}

// /api/desk/decide-bulk caps at 60 ids/request; selections bigger than that
// (a big "select all" or the Facts "apply all") get chunked client-side.
const MAX_IDS_PER_REQUEST = 60;

function matchesConfidence(band: FilterState['confidence'], confidence: number | undefined): boolean {
  if (band === 'all') return true;
  const c = confidence ?? -1;
  if (band === 'high') return c >= 80;
  if (band === 'mid') return c >= 60 && c < 80;
  return c >= 0 && c < 60;
}

function applyFilters(list: QueueProposal[], filters: FilterState): QueueProposal[] {
  const text = filters.text.trim().toLowerCase();
  return list.filter((p) => {
    if (filters.types.size > 0 && !filters.types.has(p.type)) return false;
    if (filters.wires.size > 0 && (!p.wire || !filters.wires.has(p.wire))) return false;
    if (!matchesConfidence(filters.confidence, p.confidence)) return false;
    if (text) {
      const hay = `${p.title} ${p.org_name ?? ''} ${p.org ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

/** Group by proposal type (a stable, spec'd order), sort within a group by
 *  org then confidence desc — matches the two-line rule in the build brief. */
function groupAndSort(list: QueueProposal[]): { type: ProposalType; items: QueueProposal[] }[] {
  const map = new Map<ProposalType, QueueProposal[]>();
  for (const p of list) {
    const arr = map.get(p.type);
    if (arr) arr.push(p);
    else map.set(p.type, [p]);
  }
  return PROPOSAL_TYPE_ORDER.filter((t) => map.has(t)).map((type) => {
    const items = [...(map.get(type) as QueueProposal[])].sort((a, b) => {
      const orgA = (a.org_name || a.org || '').toLowerCase();
      const orgB = (b.org_name || b.org || '').toLowerCase();
      if (orgA !== orgB) return orgA.localeCompare(orgB);
      return (b.confidence ?? -1) - (a.confidence ?? -1);
    });
    return { type, items };
  });
}

export default function DeskPage() {
  const { getAuthHeaders } = useAdminAuth();
  const [data, setData] = useState<QueuePayload | null>(null);
  const [tab, setTab] = useState<Tab>('judgment');
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [validateMsg, setValidateMsg] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErrors, setBulkErrors] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState<string | null>(null);

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
    setSelected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setBulkErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /** Shared by the bulk bar, the Facts "apply all" button, and the a/r
   *  keyboard shortcuts. Optimistic: marks ids decided immediately, then
   *  reconciles against the server — any id the server reports as failed is
   *  put back to pending with its error attached, then a full requery keeps
   *  counts/verdicts/commit links honest. Chunks past the API's 60-id cap. */
  const bulkDecide = useCallback(
    async (ids: string[], decision: 'approved' | 'rejected', note?: string) => {
      if (ids.length === 0) return;
      setBulkBusy(true);

      const idSet = new Set(ids);
      setData((prev) =>
        prev ? { ...prev, proposals: prev.proposals.map((p) => (idSet.has(p.id) ? { ...p, state: decision } : p)) } : prev
      );
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      setBulkErrors((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });

      const failedAll: { id: string; error: string }[] = [];
      const headers = await getAuthHeaders();

      for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
        const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
        try {
          const res = await fetch('/api/desk/decide-bulk', {
            method: 'POST',
            headers: { 'content-type': 'application/json', ...headers },
            body: JSON.stringify({ ids: chunk, decision, note }),
          });
          const json = (await res.json()) as DecideBulkResponse | { error: string };
          if (res.ok && 'ok' in json) {
            failedAll.push(...json.failed);
          } else {
            const message = 'error' in json ? json.error : 'request failed';
            for (const id of chunk) failedAll.push({ id, error: message });
          }
        } catch {
          for (const id of chunk) failedAll.push({ id, error: 'network error' });
        }
      }

      if (failedAll.length > 0) {
        const failedIds = new Set(failedAll.map((f) => f.id));
        setData((prev) =>
          prev
            ? { ...prev, proposals: prev.proposals.map((p) => (failedIds.has(p.id) ? { ...p, state: 'pending' } : p)) }
            : prev
        );
        setBulkErrors((prev) => {
          const next = { ...prev };
          for (const f of failedAll) next[f.id] = f.error;
          return next;
        });
      }

      setBulkBusy(false);
      await loadQueue();
    },
    [getAuthHeaders, loadQueue]
  );

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectGroup = useCallback((ids: string[]) => {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
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

  /** POSTs /api/desk/validate — the machine runs its deterministic checks
   *  over pending proposals in both lanes, applies + commits what passes,
   *  and leaves everything else pending with a checks/reason record
   *  attached (read by ProposalCard). A full requery afterward is what
   *  makes passed items disappear from the queue and failed ones show
   *  their MACHINE CHECK FAILED line. */
  async function runValidate() {
    setValidating(true);
    setValidateMsg(null);
    try {
      const headers = await getAuthHeaders();
      const res = await fetch('/api/desk/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (res.ok) {
        setValidateMsg(`Passed ${json.passed}, failed ${json.failed}${json.skipped ? `, skipped ${json.skipped}` : ''}.`);
        await loadQueue();
      } else {
        setValidateMsg(json.error || 'Validation run failed.');
      }
    } catch {
      setValidateMsg('Validation run failed.');
    } finally {
      setValidating(false);
    }
  }

  const judgmentPending = useMemo(
    () => (data ? data.proposals.filter((p) => p.lane === 'judgment' && p.state === 'pending') : []),
    [data]
  );
  const factPending = useMemo(
    () => (data ? data.proposals.filter((p) => p.lane === 'fact' && p.state === 'pending') : []),
    [data]
  );

  const filteredJudgment = useMemo(() => applyFilters(judgmentPending, filters), [judgmentPending, filters]);
  const groups = useMemo(() => groupAndSort(filteredJudgment), [filteredJudgment]);
  const judgmentFlatIds = useMemo(() => groups.flatMap((g) => g.items.map((i) => i.id)), [groups]);

  const selectedProposals = useMemo(
    () => (data ? data.proposals.filter((p) => selected.has(p.id)) : []),
    [data, selected]
  );

  // Keyboard triage: j/k moves the focus mark, x toggles selection, a/r
  // approve/reject the focused card. Judgment tab only — it's the big queue
  // this is for; Facts leans on "apply all" instead.
  useEffect(() => {
    if (tab !== 'judgment') return;
    function onKeyDown(e: KeyboardEvent) {
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea') return;
      if (judgmentFlatIds.length === 0) return;

      if (e.key === 'j' || e.key === 'k') {
        e.preventDefault();
        setFocusedId((prev) => {
          const idx = prev ? judgmentFlatIds.indexOf(prev) : -1;
          const nextIdx = e.key === 'j' ? Math.min(idx + 1, judgmentFlatIds.length - 1) : Math.max(idx - 1, 0);
          const nextId = judgmentFlatIds[nextIdx];
          document.getElementById(`proposal-${nextId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
          return nextId;
        });
      } else if (e.key === 'x') {
        if (!focusedId || !judgmentFlatIds.includes(focusedId)) return;
        e.preventDefault();
        toggleSelect(focusedId);
      } else if (e.key === 'a' || e.key === 'r') {
        if (!focusedId || !judgmentFlatIds.includes(focusedId)) return;
        e.preventDefault();
        bulkDecide([focusedId], e.key === 'a' ? 'approved' : 'rejected');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, judgmentFlatIds, focusedId, toggleSelect, bulkDecide]);

  async function applyAllFacts() {
    if (factPending.length === 0) return;
    const summary = typeCountsSummary(factPending.map((p) => p.type));
    const proceed = window.confirm(
      `Apply all ${factPending.length} fact-lane item${factPending.length === 1 ? '' : 's'}${summary ? `: ${summary}` : ''}?\n\n` +
        `This writes the registry files and commits, right now.`
    );
    if (!proceed) return;
    await bulkDecide(
      factPending.map((p) => p.id),
      'approved'
    );
  }

  if (loadErr || !data) {
    return (
      <div className="mx-auto max-w-6xl px-4 pt-16 pb-16">
        <Empty>{loadErr || 'Loading the desk…'}</Empty>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 pb-16">
      <DeskHeader
        totalOnWire={data.counts.total}
        awaitingJudgment={data.counts.pendingJudgment}
        dev={data.dev}
        seeding={seeding}
        seedMsg={seedMsg}
        onSeed={runSeed}
        validating={validating}
        validateMsg={validateMsg}
        onValidate={runValidate}
      />

      <div className="mb-8 grid grid-cols-3 gap-3 sm:gap-4">
        <Stat label="Pending judgment" value={data.counts.pendingJudgment} />
        <Stat label="Pending facts" value={data.counts.pendingFact} />
        <Stat label="Decided today" value={data.counts.decidedToday} />
      </div>

      <div className="mb-6 flex gap-7 border-b border-line">
        {(['judgment', 'fact', 'log'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={tabClass(tab === t)}
          >
            {t === 'judgment'
              ? `Judgment · ${judgmentPending.length}`
              : t === 'fact'
                ? `Facts · ${factPending.length}`
                : `Log · ${data.verdicts.length}`}
          </button>
        ))}
      </div>

      {tab === 'judgment' && (
        <>
          {judgmentPending.length === 0 ? (
            <Empty>No judgment calls on file. The queue is caught up.</Empty>
          ) : (
            <>
              <FiltersBar items={judgmentPending} filters={filters} onChange={setFilters} />
              {groups.length === 0 ? (
                <Empty>No judgment items match these filters.</Empty>
              ) : (
                <>
                  <div className="mb-1 flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper pb-2">
                    <h2 className="text-[13px] font-extrabold tracking-[.09em] text-paper uppercase">Judgment Queue</h2>
                    <span className="coord shrink-0">
                      {filteredJudgment.length} of {judgmentPending.length} · grouped by type
                    </span>
                  </div>
                  <div className="pb-2">
                    {groups.map((g) => (
                      <ProposalGroup
                        key={g.type}
                        type={g.type}
                        items={g.items}
                        selected={selected}
                        focusedId={focusedId}
                        errors={bulkErrors}
                        onToggleSelect={toggleSelect}
                        onToggleSelectAll={toggleSelectGroup}
                        onDecided={handleDecided}
                      />
                    ))}
                  </div>
                </>
              )}
              <BulkBar
                selectedProposals={selectedProposals}
                onApprove={(note) => bulkDecide([...selected], 'approved', note)}
                onReject={(note) => bulkDecide([...selected], 'rejected', note)}
                busy={bulkBusy}
              />
            </>
          )}
        </>
      )}

      {tab === 'fact' && (
        <div className="flex flex-col gap-6">
          <p className="serif-statement max-w-[640px] text-[13.5px] leading-[1.6] text-dim">
            These apply automatically with provenance. Undo is <span className="font-mono not-italic">git revert</span>.
            Auto-apply arrives with the live feed. For now, you&apos;re the loop.
          </p>
          {factPending.length === 0 ? (
            <Empty>No fact-lane items on file.</Empty>
          ) : (
            <>
              <VerdictActions
                onApprove={applyAllFacts}
                approveLabel={bulkBusy ? 'Applying…' : `Apply all ${factPending.length} facts: set in registry`}
                disabled={bulkBusy}
              />
              <div className="flex flex-col">
                {factPending.map((p) => (
                  <ProposalCard key={p.id} proposal={p} onDecided={handleDecided} errorMessage={bulkErrors[p.id]} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'log' &&
        (data.verdicts.length === 0 ? (
          <Empty>No decisions on file yet.</Empty>
        ) : (
          <div className="flex flex-col">
            {data.verdicts.map((v, i) => {
              const proposal = data.proposals.find((p) => p.id === v.proposal_id);
              const destination = v.decision === 'approved' ? proposal?.destination : null;
              return (
                <div key={`${v.proposal_id}-${i}`} className="border-b border-line py-3 last:border-b-0">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                    <span className="coord shrink-0">{dateShortIso(v.at)}</span>
                    <span className={v.decision === 'approved' ? 'font-semibold text-paper' : 'text-faint'}>
                      {v.decision === 'approved' ? 'Approved' : 'Rejected'}
                    </span>
                    {v.by === 'machine' && <span className="coord shrink-0 text-faint">machine</span>}
                    <span className="min-w-[10rem] flex-1 truncate text-dim">{proposal?.title || v.proposal_id}</span>
                    {v.note && <span className="hidden max-w-xs truncate text-[12px] text-faint italic md:inline">{v.note}</span>}
                    {v.commit ? (
                      <a
                        href={commitUrl(v.commit)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="coord shrink-0 hover:text-dim"
                      >
                        {v.commit}
                      </a>
                    ) : (
                      <span className="coord shrink-0">ledgered</span>
                    )}
                    <span className="coord hidden shrink-0 sm:inline">{timeAgo(v.at)}</span>
                  </div>
                  {destination && destination.length > 0 && (
                    <div className="coord mt-1">{destination.map((p) => `→ ${p}`).join('  ·  ')}</div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
