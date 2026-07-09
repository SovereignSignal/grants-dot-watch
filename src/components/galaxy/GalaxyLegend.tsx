import { WIRE_HEX } from '@/lib/starmap';
import { WIRE_LABEL } from '@/lib/format';
import type { Wire } from '@/lib/types';

const WIRES: Wire[] = ['crypto', 'ai', 'oss'];

/** Bottom-right legend — static, no data dependency beyond the fixed wire set. */
export default function GalaxyLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-10 rounded-md border border-line bg-deep/85 px-3 py-2.5 backdrop-blur">
      <ul className="flex flex-col gap-1">
        {WIRES.map((w) => (
          <li key={w} className="flex items-center gap-1.5 text-xs text-dim">
            <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: WIRE_HEX[w] }} />
            {WIRE_LABEL[w]}
          </li>
        ))}
      </ul>
      <div className="starline mt-2 pt-1.5 flex flex-col gap-0.5">
        <span className="coord">size = funding activity</span>
        <span className="coord">glow = live round</span>
      </div>
    </div>
  );
}
