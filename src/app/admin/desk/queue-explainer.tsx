'use client';

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'gw_desk_explainer_dismissed';

/** One-paragraph orientation atop the queue: what a proposal is, the two
 *  lanes, and what each button actually does. Dismissible — once Sov has
 *  read it, it stays out of the way on this browser (localStorage, not a
 *  server preference; the explainer is per-viewer, not per-account). */
export function QueueExplainer() {
  const [dismissed, setDismissed] = useState(true); // default hidden until we know localStorage says otherwise, so it never flashes on repeat visits

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1');
  }, []);

  if (dismissed) return null;

  return (
    <div className="mb-6 flex items-start gap-3 rounded-md border border-line bg-surface px-4 py-3 text-sm text-dim">
      <p className="flex-1 leading-relaxed">
        <strong className="text-paper">Each card below is a proposal:</strong> a single change the wires found, waiting on
        your call. The <strong className="text-paper">Judgment</strong> lane is editorial — new orgs, merges, anything that
        needs a read, not just a fact-check. The <strong className="text-paper">Facts</strong> lane is machine-verifiable —
        a round, deadline, or award with a source URL attached. <strong className="text-live">Approve</strong> writes the
        file shown under WHAT to the path shown under WHERE and commits it, right now, no second step.{' '}
        <strong className="text-dim">Reject</strong> only records a verdict — no file changes, nothing to undo.
      </p>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(DISMISSED_KEY, '1');
          setDismissed(true);
        }}
        className="coord shrink-0 rounded border border-line px-2 py-1 hover:border-faint hover:text-paper"
        aria-label="Dismiss explainer"
      >
        Got it
      </button>
    </div>
  );
}
