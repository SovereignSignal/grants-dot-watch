'use client';

import { useEffect, useState } from 'react';

const DISMISSED_KEY = 'gw_desk_explainer_dismissed';

/** The Desk's standing header (canon: design/mocks/c-desk.html) — a byline of
 *  wire volume plus a short, dismissible, mechanics-only orientation
 *  paragraph (what Approve does, what Reject does, the two lanes — no
 *  aphorisms; the owner: "display/serif statements must describe the product or
 *  state fact"). The byline is always on; the paragraph is dismissible
 *  (localStorage, per-viewer, not a server preference). */
export function DeskHeader({
  totalOnWire,
  awaitingJudgment,
  dev,
  seeding,
  seedMsg,
  onSeed,
  validating,
  validateMsg,
  onValidate,
}: {
  totalOnWire: number;
  awaitingJudgment: number;
  dev: boolean;
  seeding: boolean;
  seedMsg: string | null;
  onSeed: () => void;
  validating: boolean;
  validateMsg: string | null;
  onValidate: () => void;
}) {
  return (
    <div className="mb-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-2.5">
        <span className="coord">
          <span className="font-bold text-dim">{totalOnWire.toLocaleString()}</span> items on the wire ·{' '}
          <span className="font-bold text-dim">{awaitingJudgment.toLocaleString()}</span> awaiting judgment
        </span>
        <span className="flex max-w-full flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
          <button
            type="button"
            onClick={onValidate}
            disabled={validating}
            className="coord shrink-0 underline decoration-line underline-offset-2 hover:text-dim disabled:opacity-50"
          >
            {validating ? 'Running checks…' : 'Run validation'}
          </button>
          <button
            type="button"
            onClick={onSeed}
            disabled={seeding}
            className="coord shrink-0 underline decoration-line underline-offset-2 hover:text-dim disabled:opacity-50"
          >
            {seeding ? 'Importing…' : 'Import new proposals'}
          </button>
        </span>
      </div>

      {dev && <p className="serif-statement mt-3 text-[12.5px] text-signal">Dev mode. ADMIN_TOKEN unset, the gate is open.</p>}
      {seedMsg && <p className="coord mt-3">{seedMsg}</p>}
      {validateMsg && <p className="coord mt-3">{validateMsg}</p>}

      <div className="border-b border-line pt-7 pb-6">
        <div className="coord mb-3.5">The owner&apos;s daily curation gate</div>
        <ExplainerParagraph />
      </div>
    </div>
  );
}

function ExplainerParagraph() {
  // Default hidden until we know localStorage says otherwise, so it never
  // flashes on repeat visits.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISSED_KEY) === '1');
  }, []);

  if (dismissed) return null;

  return (
    <div className="mt-1 flex max-w-[760px] items-start gap-4">
      <p className="flex-1 text-[13.5px] leading-[1.6] text-dim">
        Two queues. Judgment (a new organization, a merge, a new program, or written profile text) needs your call.
        Approve writes the change to the registry and commits it. Reject records the decision and changes nothing.
        Facts (round dates, deadlines, sourced awards) use the same two buttons for now, ahead of automatic apply.
      </p>
      <button
        type="button"
        onClick={() => {
          window.localStorage.setItem(DISMISSED_KEY, '1');
          setDismissed(true);
        }}
        className="coord shrink-0 underline decoration-line underline-offset-2 hover:text-dim"
        aria-label="Dismiss explainer"
      >
        Got it
      </button>
    </div>
  );
}
