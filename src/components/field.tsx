'use client';

// THE FIELD — the signature deep-field canvas. Every star is a real org,
// every nebula a real system. Positions come from buildStarmap() server-side
// (via the `map` prop) so this component never invents its own layout —
// it only renders, animates, and hit-tests what it is given.

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Star, Starmap } from '@/lib/starmap';
import { STAR_DEFAULT, WIRE_HEX } from '@/lib/starmap';
import type { Wire } from '@/lib/types';
import { WireBadge } from '@/components/ui';

interface HoverInfo {
  star: Star;
  sx: number;
  sy: number;
}

function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// FNV-1a-ish phase seed, independent of starmap.ts's hash — just needs to be
// stable per-org so twinkle doesn't reshuffle every render.
function phaseOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}

function findNearest(x: number, y: number, stars: Star[], w: number, h: number): Star | null {
  let best: Star | null = null;
  let bestDist = 12 * 12;
  for (const s of stars) {
    const dx = s.x * w - x;
    const dy = s.y * h - y;
    const d2 = dx * dx + dy * dy;
    if (d2 <= bestDist) {
      bestDist = d2;
      best = s;
    }
  }
  return best;
}

export default function Field({ map }: { map: Starmap }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const router = useRouter();

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  const phases = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of map.stars) m.set(s.org, phaseOf(s.org));
    return m;
  }, [map.stars]);

  const clusterNameById = useMemo(() => new Map(map.clusters.map((c) => [c.system, c.name])), [map.clusters]);

  // Track container size.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Respect prefers-reduced-motion, including live toggles.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Cluster labels want the mono display font loaded before first paint.
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    document.fonts.ready.then(() => setFontsReady(true)).catch(() => {});
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 1 || size.h < 1) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const scale = Math.min(1.25, Math.max(0.55, size.w / 1500));

    // Dominant wire per cluster, from its member stars — tints the nebula.
    const clusterWire = new Map<string, Wire | null>();
    for (const c of map.clusters) {
      const counts = new Map<Wire, number>();
      for (const s of map.stars) {
        if (s.system === c.system && s.wire) counts.set(s.wire, (counts.get(s.wire) || 0) + 1);
      }
      let top: Wire | null = null;
      let topN = 0;
      for (const [w, n] of counts) {
        if (n > topN) {
          top = w;
          topN = n;
        }
      }
      clusterWire.set(c.system, top);
    }

    // Plan cluster labels once (not per animation frame): bigger clusters
    // claim space first, greedy-skip anything that would collide. Dense
    // starfields otherwise produce unreadable overlapping text.
    const LABEL_FONT = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.font = LABEL_FONT;
    const placedRects: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const labelPlan: { text: string; x: number; y: number }[] = [];
    const byMembers = [...map.clusters].sort((a, b) => b.members - a.members);
    for (const c of byMembers) {
      if (c.members < 3) continue;
      const cx = c.x * size.w;
      const cy = c.y * size.h;
      const rad = Math.max(30, c.r * size.w);
      const text = c.name.toUpperCase();
      const w = ctx.measureText(text).width;
      const y = Math.min(size.h - 8, Math.max(12, cy - rad - 6));
      const rect = { x0: cx - w / 2 - 5, x1: cx + w / 2 + 5, y0: y - 11, y1: y + 3 };
      const collides = placedRects.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0);
      if (!collides) {
        placedRects.push(rect);
        labelPlan.push({ text, x: cx, y });
      }
    }

    let raf = 0;
    const draw = (t: number) => {
      ctx.clearRect(0, 0, size.w, size.h);

      for (const c of map.clusters) {
        const cx = c.x * size.w;
        const cy = c.y * size.h;
        const rad = Math.max(30, c.r * size.w);
        const wire = clusterWire.get(c.system);
        const hex = wire ? WIRE_HEX[wire] : STAR_DEFAULT;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
        grad.addColorStop(0, withAlpha(hex, 0.14));
        grad.addColorStop(1, withAlpha(hex, 0));
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(cx, cy, rad, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.font = LABEL_FONT;
      ctx.fillStyle = withAlpha('#9094a8', 0.6);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      for (const l of labelPlan) ctx.fillText(l.text, l.x, l.y);

      for (const s of map.stars) {
        const sx = s.x * size.w;
        const sy = s.y * size.h;
        const r = Math.max(1.1, s.r * scale);
        const hex = s.wire ? WIRE_HEX[s.wire] : STAR_DEFAULT;

        let alpha = 0.9;
        if (!reducedMotion) {
          const phase = phases.get(s.org) ?? 0;
          const period = 2600 + phase * 3200;
          alpha = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2 + phase * Math.PI * 2));
        }

        if (s.live) {
          const glowR = r * 4.2;
          const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
          glow.addColorStop(0, withAlpha(hex, 0.35 * alpha));
          glow.addColorStop(1, withAlpha(hex, 0));
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(sx, sy, glowR, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = hex;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      if (!reducedMotion) raf = requestAnimationFrame(draw);
    };

    draw(0);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, map, phases, reducedMotion, fontsReady]);

  const handleMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const star = findNearest(x, y, map.stars, size.w, size.h);
    setHover(star ? { star, sx: star.x * size.w, sy: star.y * size.h } : null);
  };

  const handleClick = () => {
    if (hover) router.push(`/orgs/${hover.star.org}`);
  };

  const tooltipStyle: React.CSSProperties | undefined = hover
    ? {
        position: 'absolute',
        left: Math.min(Math.max(hover.sx, 92), Math.max(92, size.w - 92)),
        top: Math.max(hover.sy - 14, 8),
        transform: 'translate(-50%, -100%)',
      }
    : undefined;

  const systemName = hover?.star.system ? clusterNameById.get(hover.star.system) ?? hover.star.system : null;

  return (
    <div ref={wrapRef} className="relative h-[40vh] min-h-[300px] w-full overflow-hidden bg-void md:h-[52vh]">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        aria-hidden="true"
        style={{ cursor: hover ? 'pointer' : 'default' }}
        onMouseMove={handleMove}
        onMouseLeave={() => setHover(null)}
        onClick={handleClick}
      />
      {hover && (
        <div
          style={tooltipStyle}
          className="pointer-events-none z-10 min-w-[168px] rounded-md border border-line bg-raised/95 px-3 py-2 shadow-lg backdrop-blur-sm"
        >
          <div className="text-sm font-medium text-paper">{hover.star.name}</div>
          {systemName && <div className="coord mt-0.5">{systemName}</div>}
          <div className="mt-1.5 flex items-center gap-2">
            {hover.star.wire && <WireBadge wire={hover.star.wire} small />}
            {hover.star.live && <span className="text-[11px] font-medium text-live">Live round</span>}
          </div>
        </div>
      )}
      <a href="/orgs" className="sr-only">
        Browse organizations
      </a>
    </div>
  );
}
