'use client';

import { WIRE_HEX } from '@/lib/starmap';
import { WIRE_LABEL } from '@/lib/format';
import type { Wire } from '@/lib/types';
import { ZOOM_MAX, ZOOM_MIN } from './geometry';
import type { WireFilter } from './types';

const WIRE_OPTIONS: WireFilter[] = ['all', 'crypto', 'ai', 'oss'];

function chipLabel(w: WireFilter): string {
  return w === 'all' ? 'All' : WIRE_LABEL[w as Wire];
}

export default function GalaxyControls({
  liveOnly,
  onToggleLive,
  wireFilter,
  onSetWireFilter,
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  liveOnly: boolean;
  onToggleLive: () => void;
  wireFilter: WireFilter;
  onSetWireFilter: (w: WireFilter) => void;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
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

      <div className="rounded-md border border-line bg-deep/85 p-1.5 backdrop-blur flex items-center gap-1.5">
        <button
          type="button"
          onClick={onZoomOut}
          disabled={zoom <= ZOOM_MIN}
          aria-label="Zoom out"
          className="flex size-11 items-center justify-center rounded text-dim hover:text-paper hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-dim font-mono text-lg"
        >
          −
        </button>
        <button
          type="button"
          onClick={onReset}
          aria-label="Reset view"
          className="flex h-11 items-center justify-center rounded px-3 text-dim hover:text-paper hover:bg-raised coord"
        >
          reset
        </button>
        <button
          type="button"
          onClick={onZoomIn}
          disabled={zoom >= ZOOM_MAX}
          aria-label="Zoom in"
          className="flex size-11 items-center justify-center rounded text-dim hover:text-paper hover:bg-raised disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-dim font-mono text-lg"
        >
          +
        </button>
      </div>
    </div>
  );
}
