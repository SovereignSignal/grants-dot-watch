'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Empty, Stat } from '@/components/ui';
import { tabClass } from '@/components/ui-filters';
import type { ProposalType, Verdict } from '@/lib/types';
import { PROPOSAL_TYPE_ORDER, typeCountsSummary } from '@/proposal-lanes';
import { useAdminAuth } from '../admin-auth';
import { JudgmentBar } from './action-bar';
import { BulkBar } from './bulk-bar';
import { buildDeskLog } from '@/lib/desk-log';
import { commitUrl, dateShortIso, timeAgo } from './desk-format';
import { DeskHeader } from './desk-header';
import { DEFAULT_FILTERS, type DecideBulkResponse, type FilterState, type QueueProposal } from './desk-types';
import { FiltersBar } from './filters-bar';
import { JudgmentList } from './judgment-list';
import { sortJudgmentQueue } from './judgment-queue';
import { ProposalCard } from './proposal-card';
import { ProposalGroup } from './proposal-group';
import { reviewBrief } from './review-brief';
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

function matchesSourceScore(band: FilterState['confidence'], confidence: number | undefined): boolean {
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
    if (!matchesSourceScore(filters.confidence, p.confidence)) return false;
    const brief = reviewBrief(p);
    if (filters.source === 'sourced' && brief.unsourced) return false;
    if (filters.source === 'unsourced' && !brief.unsourced) return false;
    if (filters.proposers.size > 0 && !filters.proposers.has(brief.proposer)) return false;
    if (filters.curator === 'unreviewed' && p.curator_review) return false;
    if (filters.curator !== 'all' && filters.curator !== 'unreviewed' && p.curator_review?.verdict !== filters.curator) return false;
    if (text) {
      const hay = `${p.title} ${brief.title} ${p.org_name ?? ''} ${p.org ?? ''}`.toLowerCase();
      if (!hay.includes(text)) return false;
    }
    return true;
  });
}

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(
    target.closest('input, textarea, select, [role="textbox"], [role="combobox"], [contenteditable]:not([contenteditable="false"])')
  );
}

/** Group by proposal type (a stable, spec'd order), sort within a group by
 *  org then source score descending. */
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
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const [rejectOpen, setRejectOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const [logFilter, setLogFilter] = useState<'all' | 'auto'>('all');
  const [reverting, setReverting] = useState<string | null>(null);
  const [revertError, setRevertError] = useState<string | null>(null);
  const [judgmentView, setJudgmentView] = useState<'list' | 'cards'>('list');
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const inflight = useRef(new Set<string>());
  const onRejectNote = useCallback((id: string, note: string) => {
    setRejectNotes((prev) => ({ ...prev, [id]: note }));
  }, []);

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

  const revertRow = useCallback(
    async (id: string) => {
      setReverting(id);
      setRevertError(null);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/desk/log/revert', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ id }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          setRevertError(json.error || 'Revert failed.');
          return;
        }
        await loadQueue();
      } catch {
        setRevertError('Could not reach the Desk API.');
      } finally {
        setReverting(null);
      }
    },
    [getAuthHeaders, loadQueue]
  );

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const sync = () => setPhone(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  const hideProposal = useCallback((id: string, decision: 'approved' | 'rejected') => {
    setData((prev) => {
      if (!prev) return prev;
      const decided = prev.proposals.find((p) => p.id === id);
      if (!decided || decided.state !== 'pending') return prev;
      const wasJudgment = decided.lane === 'judgment';
      return {
        ...prev,
        proposals: prev.proposals.map((p) => (p.id === id ? { ...p, state: decision } : p)),
        counts: {
          ...prev.counts,
          pendingJudgment: prev.counts.pendingJudgment - (wasJudgment ? 1 : 0),
          pendingFact: prev.counts.pendingFact - (wasJudgment ? 0 : 1),
        },
      };
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

  const restoreProposal = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      const item = prev.proposals.find((p) => p.id === id);
      if (!item || item.state === 'pending') return prev;
      const wasJudgment = item.lane === 'judgment';
      return {
        ...prev,
        proposals: prev.proposals.map((p) => (p.id === id ? { ...p, state: 'pending' } : p)),
        counts: {
          ...prev.counts,
          pendingJudgment: prev.counts.pendingJudgment + (wasJudgment ? 1 : 0),
          pendingFact: prev.counts.pendingFact + (wasJudgment ? 0 : 1),
        },
      };
    });
  }, []);

  /** Shared by the bulk bar and the Facts "apply all" button. Optimistic: marks ids decided immediately, then
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
  const reconciliationHolds = useMemo(
    () => (data ? data.proposals.filter((p) => p.state === 'applying') : []),
    [data]
  );
  const deskLog = useMemo(() => (data ? buildDeskLog(data.proposals, data.verdicts) : []), [data]);

  const filteredJudgment = useMemo(() => applyFilters(judgmentPending, filters), [judgmentPending, filters]);
  const listedJudgment = useMemo(() => sortJudgmentQueue(filteredJudgment), [filteredJudgment]);
  const groups = useMemo(() => groupAndSort(filteredJudgment), [filteredJudgment]);
  const judgmentFlatIds = useMemo(
    () => (judgmentView === 'list' ? listedJudgment.map((item) => item.id) : groups.flatMap((g) => g.items.map((i) => i.id))),
    [judgmentView, listedJudgment, groups]
  );
  const focusIndex = focusedId ? judgmentFlatIds.indexOf(focusedId) : -1;
  const focusedProposal = focusIndex >= 0 ? groups.flatMap((g) => g.items)[focusIndex] : null;
  const progressLabel = judgmentFlatIds.length === 0 ? '0 / 0' : `${Math.max(focusIndex, 0) + 1} / ${judgmentFlatIds.length}`;

  const selectedProposals = useMemo(
    () => (data ? data.proposals.filter((p) => selected.has(p.id)) : []),
    [data, selected]
  );

  const decideOne = useCallback(
    async (id: string, decision: 'approved' | 'rejected', note?: string) => {
      if (inflight.current.has(id) || bulkBusy) return;
      inflight.current.add(id);
      setFocusedId((prev) => {
        if (prev !== id) return prev;
        const idx = judgmentFlatIds.indexOf(id);
        const next = judgmentFlatIds[idx + 1] ?? judgmentFlatIds[idx - 1] ?? null;
        if (next) document.getElementById(`proposal-${next}`)?.scrollIntoView({ block: 'nearest' });
        return next;
      });
      hideProposal(id, decision);
      try {
        const headers = await getAuthHeaders();
        const res = await fetch('/api/desk/decide', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ id, decision, ...(note ? { note } : {}) }),
        });
        const json = await res.json();
        if (!res.ok) {
          restoreProposal(id);
          setBulkErrors((prev) => ({ ...prev, [id]: json.error || 'Decision failed.' }));
          setFocusedId(id);
          return;
        }
        if (json.verdict) {
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  counts: { ...prev.counts, decidedToday: prev.counts.decidedToday + 1 },
                  verdicts: [json.verdict as Verdict, ...prev.verdicts],
                }
              : prev
          );
        }
      } catch {
        restoreProposal(id);
        setBulkErrors((prev) => ({ ...prev, [id]: 'Decision failed.' }));
        setFocusedId(id);
      } finally {
        inflight.current.delete(id);
      }
    },
    [bulkBusy, getAuthHeaders, hideProposal, judgmentFlatIds, restoreProposal]
  );

  const moveFocus = useCallback((dir: 1 | -1) => {
    setRejectOpen(false);
    setFocusedId((prev) => {
      const idx = prev ? judgmentFlatIds.indexOf(prev) : -1;
      const nextIdx = dir === 1 ? Math.min(idx + 1, judgmentFlatIds.length - 1) : Math.max(idx - 1, 0);
      const nextId = judgmentFlatIds[nextIdx];
      if (!nextId || nextId === prev) return prev;
      document.getElementById(`proposal-${nextId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return nextId;
    });
  }, [judgmentFlatIds]);

  useEffect(() => {
    if (tab !== 'judgment') return;
    if (focusedId && judgmentFlatIds.includes(focusedId)) return;
    setFocusedId(judgmentFlatIds[0] ?? null);
    setRejectOpen(false);
  }, [tab, judgmentFlatIds, focusedId]);

  // j/k moves, x selects, a approves, r rejects, o opens the source.
  // Typing in a field keeps the key.
  useEffect(() => {
    if (tab !== 'judgment') return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented || e.isComposing || isInteractiveTarget(e.target)) return;
      if (judgmentFlatIds.length === 0) return;
      const key = e.key.toLowerCase();
      const plainKey = !e.altKey && !e.metaKey && !e.ctrlKey;
      if (!plainKey) return;

      if (key === 'j' || key === 'k') {
        e.preventDefault();
        moveFocus(key === 'j' ? 1 : -1);
      } else if (key === 'x') {
        if (!focusedId || !judgmentFlatIds.includes(focusedId)) return;
        e.preventDefault();
        toggleSelect(focusedId);
      } else if (key === 'a' || key === 'r') {
        if (e.repeat || bulkBusy || !focusedId || !judgmentFlatIds.includes(focusedId)) return;
        e.preventDefault();
        const note = key === 'r' ? rejectNotes[focusedId]?.trim() : undefined;
        void decideOne(focusedId, key === 'a' ? 'approved' : 'rejected', note || undefined);
      } else if (key === 'o') {
        if (!focusedId) return;
        const item = data?.proposals.find((p) => p.id === focusedId);
        const url = item ? reviewBrief(item).sources[0]?.url : undefined;
        if (!url) return;
        e.preventDefault();
        window.open(url, '_blank', 'noopener,noreferrer');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tab, judgmentFlatIds, focusedId, toggleSelect, decideOne, bulkBusy, data, rejectNotes, moveFocus]);

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
    <div className={`mx-auto max-w-6xl px-4 pt-8 ${tab === 'judgment' && judgmentView === 'cards' && judgmentPending.length > 0 ? 'pb-40' : 'pb-16'}`}>
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

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <Stat label="Pending judgment" value={data.counts.pendingJudgment} />
        <Stat label="Pending facts" value={data.counts.pendingFact} />
        <Stat label="Reconciliation hold" value={reconciliationHolds.length} />
        <Stat label="Decided today" value={data.counts.decidedToday} />
      </div>

      {reconciliationHolds.length > 0 && (
        <section className="mb-8 border border-closing/40 bg-closing/5 p-4" aria-labelledby="reconciliation-heading">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="reconciliation-heading" className="text-[13px] font-extrabold uppercase tracking-[.09em] text-paper">
              Reconciliation hold
            </h2>
            <span className="coord">{reconciliationHolds.length} blocked from another decision</span>
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-dim">
            These apply attempts did not finish cleanly. They stay locked until the durable ledger and registry are reconciled.
          </p>
          <ul className="mt-3 divide-y divide-line border-t border-line">
            {reconciliationHolds.map((proposal) => (
              <li key={proposal.id} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[90px_1fr] sm:gap-4">
                <span className="font-mono text-[11px] text-faint">{proposal.id}</span>
                <span>
                  <span className="text-paper">{proposal.title}</span>
                  {proposal.validation?.reason && <span className="mt-0.5 block text-xs text-closing">{proposal.validation.reason}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mb-6 flex gap-7 border-b border-line">
        {(['judgment', 'fact', 'log'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            aria-pressed={tab === t}
            className={tabClass(tab === t)}
          >
            {t === 'judgment'
              ? `Judgment · ${judgmentPending.length}`
              : t === 'fact'
                ? `Facts · ${factPending.length}`
                : `Log · ${deskLog.length}`}
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
                  <div className="sticky top-0 z-20 -mx-4 mb-1 flex items-baseline justify-between gap-4 border-b-[1.5px] border-paper bg-void px-4 py-2">
                    <h2 className="text-[13px] font-extrabold tracking-[.09em] text-paper uppercase">Judgment Queue</h2>
                    <span data-testid="queue-progress" className="shrink-0 font-sans text-[13px] font-bold tracking-[.08em] text-paper uppercase">
                      {judgmentView === 'list' ? `${filteredJudgment.length}` : progressLabel}
                    </span>
                  </div>
                  <div className="mt-2 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                    <span data-testid="queue-remaining" className="coord">
                      {filteredJudgment.length} remaining
                    </span>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        aria-pressed={judgmentView === 'list'}
                        onClick={() => setJudgmentView('list')}
                        className={`coord ${judgmentView === 'list' ? 'text-paper underline decoration-paper underline-offset-[3px]' : 'text-faint'}`}
                      >
                        List
                      </button>
                      <button
                        type="button"
                        aria-pressed={judgmentView === 'cards'}
                        onClick={() => setJudgmentView('cards')}
                        className={`coord ${judgmentView === 'cards' ? 'text-paper underline decoration-paper underline-offset-[3px]' : 'text-faint'}`}
                      >
                        One at a time
                      </button>
                    </div>
                    <span className="coord hidden sm:inline">j/k next · a approve · r reject · o source · x select</span>
                  </div>
                  {judgmentView === 'list' ? (
                    <JudgmentList
                      items={listedJudgment}
                      selected={selected}
                      focusedId={focusedId}
                      errors={bulkErrors}
                      disabled={bulkBusy}
                      onToggleSelect={toggleSelect}
                      onToggleSelectAll={toggleSelectGroup}
                      onFocus={setFocusedId}
                      onDecide={decideOne}
                      onRejectNote={onRejectNote}
                      rejectNotes={rejectNotes}
                    />
                  ) : phone && focusedProposal ? (
                    <div
                      className="pb-2"
                      onTouchStart={(e) => {
                        if ((e.target as Element).closest('a, button, input, textarea')) return;
                        const touch = e.touches[0];
                        swipe.current = { x: touch.clientX, y: touch.clientY };
                      }}
                      onTouchEnd={(e) => {
                        if (!swipe.current) return;
                        const touch = e.changedTouches[0];
                        const dx = touch.clientX - swipe.current.x;
                        const dy = touch.clientY - swipe.current.y;
                        swipe.current = null;
                        if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
                        moveFocus(dx < 0 ? 1 : -1);
                      }}
                    >
                      <ProposalCard
                        proposal={focusedProposal}
                        selected={selected.has(focusedProposal.id)}
                        onToggleSelect={() => toggleSelect(focusedProposal.id)}
                        focused
                        errorMessage={bulkErrors[focusedProposal.id]}
                        onDecide={decideOne}
                        onRejectNote={onRejectNote}
                        rejectNote={rejectNotes[focusedProposal.id] ?? ''}
                        disabled={bulkBusy}
                        showActions={false}
                      />
                    </div>
                  ) : (
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
                          onDecide={decideOne}
                          onRejectNote={onRejectNote}
                          rejectNotes={rejectNotes}
                          disabled={bulkBusy}
                        />
                      ))}
                    </div>
                  )}
                  {judgmentView === 'cards' && selected.size === 0 && focusedProposal && (
                    <>
                      {rejectOpen && (
                        <div
                          data-testid="reject-sheet"
                          className="fixed inset-x-0 bottom-[7.75rem] z-40 border-t border-paper bg-void px-3 py-3"
                        >
                          <div className="mx-auto max-w-6xl">
                            <label className="coord mb-1 block" htmlFor={`reject-note-${focusedProposal.id}`}>
                              Reject reason, optional
                            </label>
                            <input
                              id={`reject-note-${focusedProposal.id}`}
                              type="text"
                              value={rejectNotes[focusedProposal.id] ?? ''}
                              onChange={(e) => onRejectNote(focusedProposal.id, e.target.value)}
                              placeholder="Why reject, if you want it on the log"
                              className="mb-3 w-full border-b border-line bg-transparent px-1 py-2 text-[15px] text-paper placeholder:text-faint focus:border-paper focus:outline-none"
                            />
                            <div className="flex gap-2">
                              <button
                                type="button"
                                disabled={bulkBusy}
                                onClick={() => {
                                  const note = rejectNotes[focusedProposal.id]?.trim();
                                  setRejectOpen(false);
                                  void decideOne(focusedProposal.id, 'rejected', note || undefined);
                                }}
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
                        </div>
                      )}
                      <JudgmentBar
                        disabled={bulkBusy}
                        atStart={focusIndex <= 0}
                        atEnd={focusIndex >= judgmentFlatIds.length - 1}
                        onPrev={() => moveFocus(-1)}
                        onNext={() => moveFocus(1)}
                        onApprove={() => {
                          setRejectOpen(false);
                          void decideOne(focusedProposal.id, 'approved');
                        }}
                        onReject={() => setRejectOpen(true)}
                        onSkip={() => moveFocus(1)}
                      />
                    </>
                  )}
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
                  <ProposalCard
                    key={p.id}
                    proposal={p}
                    onDecide={decideOne}
                    onRejectNote={onRejectNote}
                    rejectNote={rejectNotes[p.id] ?? ''}
                    errorMessage={bulkErrors[p.id]}
                    disabled={bulkBusy}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'log' && (
        <div className="flex flex-col">
          <div className="mb-3 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <button
              type="button"
              aria-pressed={logFilter === 'all'}
              onClick={() => setLogFilter('all')}
              className={`coord ${logFilter === 'all' ? 'text-paper underline decoration-paper underline-offset-[3px]' : 'text-faint hover:text-dim'}`}
            >
              All
            </button>
            <button
              type="button"
              data-testid="desk-log-auto-filter"
              aria-pressed={logFilter === 'auto'}
              onClick={() => setLogFilter('auto')}
              className={`coord ${logFilter === 'auto' ? 'text-paper underline decoration-paper underline-offset-[3px]' : 'text-faint hover:text-dim'}`}
            >
              Auto-applied
            </button>
          </div>
          {revertError && <p className="coord mb-3 text-signal">{revertError}</p>}
          {deskLog.filter((row) => logFilter === 'all' || row.autoApplied).length === 0 ? (
            <Empty>{logFilter === 'auto' ? 'No auto-applied decisions.' : 'No decisions on file yet.'}</Empty>
          ) : (
            deskLog
              .filter((row) => logFilter === 'all' || row.autoApplied)
              .map((row) => {
                const label = row.action === 'approved' ? 'Approved' : row.action === 'rejected' ? 'Rejected' : 'Queued';
                return (
                  <div key={row.key} className="border-b border-line py-3 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                      <span className="coord shrink-0">{dateShortIso(row.at)}</span>
                      <span className={row.action === 'approved' ? 'font-semibold text-paper' : 'text-faint'}>{label}</span>
                      {row.actor && <span className="coord shrink-0 text-faint">{row.actor}</span>}
                      <span className="min-w-[10rem] flex-1 truncate text-dim">{row.title}</span>
                      {row.note && <span className="hidden max-w-xs truncate text-[12px] text-faint italic md:inline">{row.note}</span>}
                      {row.revertable && row.action === 'approved' && !row.reverted && row.proposalId && (
                        <button
                          type="button"
                          data-testid="desk-log-revert"
                          disabled={reverting === row.proposalId}
                          onClick={() => void revertRow(row.proposalId as string)}
                          className="coord shrink-0 underline decoration-line underline-offset-2 hover:text-dim disabled:opacity-50"
                        >
                          {reverting === row.proposalId ? 'Reverting…' : 'Revert'}
                        </button>
                      )}
                      {row.reverted && <span className="coord shrink-0">Reverted</span>}
                      {row.action === 'queued' ? (
                        <span className="coord shrink-0">queue</span>
                      ) : row.commit ? (
                        <a
                          href={commitUrl(row.commit)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="coord shrink-0 hover:text-dim"
                        >
                          {row.commit}
                        </a>
                      ) : (
                        <span className="coord shrink-0">ledgered</span>
                      )}
                      <span className="coord hidden shrink-0 sm:inline">{timeAgo(row.at)}</span>
                    </div>
                    {row.audit && (
                      <div className="coord mt-1 text-faint">
                        {row.audit.keyId}
                        {' · '}
                        {row.audit.fetchedUrl || 'no fetch'}
                        {' · '}
                        {row.audit.pageHash ? row.audit.pageHash.slice(0, 12) : 'no page'}
                        {' · '}
                        {row.audit.oldValue || 'none'}
                        {' → '}
                        {row.audit.newValue || 'none'}
                      </div>
                    )}
                    {row.awardAudit && (
                      <div className="coord mt-1 text-faint">
                        {row.awardAudit.source}
                        {' · '}
                        {row.awardAudit.sourceUrl}
                        {' · '}
                        {row.awardAudit.packId}
                        {' · '}
                        {row.awardAudit.records} records
                        {' · plan '}
                        {row.awardAudit.planDigest.slice(0, 12)}
                      </div>
                    )}
                    {row.programAudit && (
                      <div className="coord mt-1 text-faint">
                        {row.programAudit.finalUrl}
                        {row.programAudit.finalUrl !== row.programAudit.fetchedUrl ? ` (from ${row.programAudit.fetchedUrl})` : ''}
                        {' · page '}
                        {row.programAudit.pageHash.slice(0, 12)}
                        {' · name "'}
                        {row.programAudit.matchedName}
                        {'" · '}
                        {row.programAudit.matchedSignal}
                        {row.programAudit.matchedAmount ? ` · amount "${row.programAudit.matchedAmount}"` : ''}
                        {' · score '}
                        {row.programAudit.score}
                      </div>
                    )}
                    {row.destination && row.destination.length > 0 && (
                      <div className="coord mt-1">{row.destination.map((p) => `→ ${p}`).join('  ·  ')}</div>
                    )}
                  </div>
                );
              })
          )}
        </div>
      )}
    </div>
  );
}
