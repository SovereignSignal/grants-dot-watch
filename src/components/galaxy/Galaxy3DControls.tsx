'use client';

// DOM overlay controls for the 3D scene — same visual language as
// GalaxyControls (the 2D canvas), swapping 2D pan/zoom buttons for a single
// "recenter" action since orbit/zoom is native to the WebGL scene.
import { WIRE_HEX } from '@/lib/starmap';
import { WIRE_LABEL } from '@/lib/format';
import type { Wire } from '@/lib/types';
import type { WireFilter } from './types';

const WIRE_OPTIONS: WireFilter[] = ['all', 'crypto', 'ai', 'oss'];

function chipLabel(w: WireFilter): string {
  return w === 'all' ? 'All' : WIRE_LABEL[w as Wire];
}

export default function Galaxy3DControls({
  liveOnly,
  onToggleLive,
  wireFilter,
  onSetWireFilter,
  onReset,
}: {
  liveOnly: boolean;
  onToggleLive: () => void;
  wireFilter: WireFilter;
  onSetWireFilter: (w: WireFilter) => void;
  onReset: () => void;
}) {
  return (
    <div className="absolute top-3 left-3 z-10 flex flex-col gap-2 max-w-[calc(100%-1.5rem)]">
      <div className="rounded-md border border-line bg-deep/85 p-2.5 backdrop-blur flex flex-col gap-2.5">
        <button
          type="button"
          onClick={onToggleLive}
          aria-pressed={liveOnly}
          className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-xs transition-colors ${
            liveOnly ? 'border-live/60 bg-live/10 text-paper' : 'border-line text-dim hover:border-faint hover:text-paper'
          }`}
        >
          <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: 'var(--color-live)' }} />
          Live only
        </button>

        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by wire">
          {WIRE_OPTIONS.map((w) => {
            const active = wireFilter === w;
            return (
              <button
                key={w}
                type="button"
                onClick={() => onSetWireFilter(w)}
                aria-pressed={active}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${
                  active ? 'border-signal/60 bg-signal/10 text-paper' : 'border-line text-dim hover:border-faint hover:text-paper'
                }`}
              >
                {w !== 'all' && (
                  <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: WIRE_HEX[w] }} />
                )}
                {chipLabel(w)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-md border border-line bg-deep/85 p-1.5 backdrop-blur flex items-center">
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset camera"
          className="flex h-11 items-center justify-center rounded px-3 text-dim hover:text-paper hover:bg-raised coord"
        >
          reset camera
        </button>
      </div>
    </div>
  );
}
