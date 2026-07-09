'use client';

// THE FIELD — the signature deep-field canvas. Every star is a real org,
// every nebula a real system. Positions come from buildStarmap() server-side
// (via the `map` prop) so this component never invents its own layout —
// it only renders, animates, and hit-tests what it is given.
//
// Rendering notes (the difference between fog and a cosmos):
// - nebulas and star halos composite with 'lighter' so overlapping hues ADD
//   into luminosity instead of averaging into gray
// - stars are core+halo, big stars hold steady (only small ones twinkle,
//   and never below 0.7 alpha)
// - a hash-seeded dust layer gives the void depth without inventing data
// - cluster labels anchor NEAR their cluster with a tick line, never in a
//   clamped row along the top edge

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Star, Starmap } from '@/lib/starmap';
import { STAR_DEFAULT, WIRE_HEX } from '@/lib/starmap';
import type { Wire } from '@/lib/types';
import { WireBadge } from '@/components/ui';

// Display-layer luminous variants of the wire hues. The validated trio in
// WIRE_HEX stays the law for UI marks; on the additive canvas these lift
// luminance so cores read as starlight. Identity is still never color-alone
// (tooltip + legend carry it).
const GLOW_HEX: Record<string, string> = {
  crypto: '#eaa63f',
  ai: '#a98bff',
  oss: '#3cc4d6',
};

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

// Stable per-string pseudo-randoms (twinkle phase, dust, nebula blobs).
function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const unit = (h: number) => (h % 100000) / 100000;

function findNearest(x: number, y: number, stars: Star[], w: number, h: number): Star | null {
  let best: Star | null = null;
  let bestDist = 14 * 14;
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
    for (const s of map.stars) m.set(s.org, unit(hash32(s.org)));
    return m;
  }, [map.stars]);

  const clusterNameById = useMemo(() => new Map(map.clusters.map((c) => [c.system, c.name])), [map.clusters]);

  // Background dust: fixed count, hash-seeded, no data meaning — pure depth.
  const dust = useMemo(() => {
    const out: { x: number; y: number; r: number; a: number }[] = [];
    for (let i = 0; i < 380; i++) {
      const h1 = hash32(`dust-${i}`);
      const h2 = hash32(`dust2-${i}`);
      out.push({
        x: unit(h1),
        y: unit(h2),
        r: 0.35 + unit(hash32(`dust3-${i}`)) * 0.8,
        a: 0.10 + unit(hash32(`dust4-${i}`)) * 0.28,
      });
    }
    return out;
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

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

    const scale = Math.min(1.35, Math.max(0.6, size.w / 1400));

    // Dominant wire per cluster — tints the nebula.
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

    // Nebula blob offsets per cluster (2 satellites around the core blob),
    // hash-seeded so the shape is organic but stable.
    const blobPlan = map.clusters.map((c) => {
      const h1 = hash32(c.system);
      const h2 = hash32(c.system + '·b');
      return {
        c,
        offs: [
          { dx: 0, dy: 0, k: 1 },
          { dx: (unit(h1) - 0.5) * 0.8, dy: (unit(h2) - 0.5) * 0.6, k: 0.62 },
          { dx: (unit(h2) - 0.5) * 0.9, dy: (unit(h1) - 0.5) * 0.5, k: 0.45 },
        ],
      };
    });

    // Cluster labels: anchored just above the cluster CORE (a fraction of the
    // radius, capped), with a tick line pointing at the centroid. Bigger
    // clusters claim label space first; colliding labels are skipped.
    const LABEL_FONT = '500 10px "IBM Plex Mono", ui-monospace, monospace';
    ctx.font = LABEL_FONT;
    const placedRects: { x0: number; x1: number; y0: number; y1: number }[] = [];
    const labelPlan: { text: string; x: number; y: number }[] = [];
    const byMembers = [...map.clusters].sort((a, b) => b.members - a.members);
    for (const c of byMembers) {
      if (c.members < 2) continue;
      const cx = c.x * size.w;
      const cy = c.y * size.h;
      const rad = Math.max(26, c.r * size.w * 0.5);
      const text = c.name.toUpperCase();
      const w = ctx.measureText(text).width;
      const y = Math.min(size.h - 10, Math.max(16, cy - Math.min(rad * 0.7, 72)));
      const rect = { x0: cx - w / 2 - 6, x1: cx + w / 2 + 6, y0: y - 12, y1: y + 4 };
      const collides = placedRects.some((p) => rect.x0 < p.x1 && rect.x1 > p.x0 && rect.y0 < p.y1 && rect.y1 > p.y0);
      if (!collides) {
        placedRects.push(rect);
        labelPlan.push({ text, x: cx, y });
      }
    }

    // ---- static background layer (dust + nebulas), rendered ONCE ----
    const bg = document.createElement('canvas');
    bg.width = canvas.width;
    bg.height = canvas.height;
    const bgc = bg.getContext('2d')!;
    bgc.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const d of dust) {
      bgc.globalAlpha = d.a;
      bgc.fillStyle = '#aeb4cf';
      bgc.beginPath();
      bgc.arc(d.x * size.w, d.y * size.h, d.r, 0, Math.PI * 2);
      bgc.fill();
    }
    bgc.globalAlpha = 1;
    bgc.globalCompositeOperation = 'lighter';
    for (const { c, offs } of blobPlan) {
      const wire = clusterWire.get(c.system);
      const hex = wire ? GLOW_HEX[wire] : STAR_DEFAULT;
      const baseR = Math.max(40, c.r * size.w * 0.85);
      for (const o of offs) {
        const bx = (c.x + o.dx * c.r) * size.w;
        const by = (c.y + o.dy * c.r) * size.h;
        const br = baseR * o.k;
        const grad = bgc.createRadialGradient(bx, by, 0, bx, by, br);
        grad.addColorStop(0, withAlpha(hex, 0.085));
        grad.addColorStop(0.55, withAlpha(hex, 0.035));
        grad.addColorStop(1, withAlpha(hex, 0));
        bgc.fillStyle = grad;
        bgc.beginPath();
        bgc.arc(bx, by, br, 0, Math.PI * 2);
        bgc.fill();
      }
    }

    // ---- static foreground layer (labels + scrim + vignette), ONCE ----
    const fg = document.createElement('canvas');
    fg.width = canvas.width;
    fg.height = canvas.height;
    const fgc = fg.getContext('2d')!;
    fgc.setTransform(dpr, 0, 0, dpr, 0, 0);
    fgc.font = LABEL_FONT;
    fgc.textAlign = 'center';
    fgc.textBaseline = 'alphabetic';
    for (const l of labelPlan) {
      fgc.fillStyle = withAlpha('#9094a8', 0.78);
      fgc.fillText(l.text, l.x, l.y);
      fgc.strokeStyle = withAlpha('#9094a8', 0.3);
      fgc.lineWidth = 1;
      fgc.beginPath();
      fgc.moveTo(l.x, l.y + 4);
      fgc.lineTo(l.x, l.y + 14);
      fgc.stroke();
    }
    const scrim = fgc.createLinearGradient(0, 0, size.w * 0.62, 0);
    scrim.addColorStop(0, 'rgba(11, 14, 26, 0.82)');
    scrim.addColorStop(0.55, 'rgba(11, 14, 26, 0.35)');
    scrim.addColorStop(1, 'rgba(11, 14, 26, 0)');
    fgc.fillStyle = scrim;
    fgc.fillRect(0, 0, size.w * 0.62, size.h);
    const vign = fgc.createRadialGradient(
      size.w * 0.55, size.h * 0.42, size.h * 0.35,
      size.w * 0.55, size.h * 0.42, Math.max(size.w, size.h) * 0.85
    );
    vign.addColorStop(0, 'rgba(11, 14, 26, 0)');
    vign.addColorStop(1, 'rgba(11, 14, 26, 0.55)');
    fgc.fillStyle = vign;
    fgc.fillRect(0, 0, size.w, size.h);

    // ---- star sprites: halo+core pre-rendered once per (hex, size, live) ----
    const sprites = new Map<string, { c: HTMLCanvasElement; half: number }>();
    const sprite = (hex: string, r: number, live: boolean) => {
      const rb = Math.round(r * 4) / 4; // quarter-px buckets
      const key = `${hex}|${rb}|${live}`;
      let s = sprites.get(key);
      if (s) return s;
      const haloR = rb * (live ? 5 : 3);
      const half = Math.ceil(haloR + 2);
      const sc = document.createElement('canvas');
      sc.width = sc.height = half * 2 * dpr;
      const scc = sc.getContext('2d')!;
      scc.setTransform(dpr, 0, 0, dpr, 0, 0);
      const halo = scc.createRadialGradient(half, half, 0, half, half, haloR);
      halo.addColorStop(0, withAlpha(hex, 0.5));
      halo.addColorStop(0.4, withAlpha(hex, 0.16));
      halo.addColorStop(1, withAlpha(hex, 0));
      scc.fillStyle = halo;
      scc.beginPath();
      scc.arc(half, half, haloR, 0, Math.PI * 2);
      scc.fill();
      scc.fillStyle = hex;
      scc.beginPath();
      scc.arc(half, half, rb, 0, Math.PI * 2);
      scc.fill();
      if (rb > 2.6) {
        scc.fillStyle = withAlpha('#f5f2e8', 0.85);
        scc.beginPath();
        scc.arc(half, half, rb * 0.42, 0, Math.PI * 2);
        scc.fill();
      }
      s = { c: sc, half };
      sprites.set(key, s);
      return s;
    };

    let raf = 0;
    const draw = (t: number) => {
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, size.w, size.h);
      ctx.drawImage(bg, 0, 0, size.w, size.h);

      ctx.globalCompositeOperation = 'lighter';
      for (const s of map.stars) {
        const sx = s.x * size.w;
        const sy = s.y * size.h;
        const r = Math.max(1.2, s.r * scale);
        const hex = s.wire ? GLOW_HEX[s.wire] : STAR_DEFAULT;

        let alpha = 1;
        if (!reducedMotion && r < 3.2) {
          const phase = phases.get(s.org) ?? 0;
          const period = 2600 + phase * 3200;
          alpha = 0.7 + 0.3 * (0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2 + phase * Math.PI * 2));
        }

        const sp = sprite(hex, r, s.live);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sp.c, sx - sp.half, sy - sp.half, sp.half * 2, sp.half * 2);
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';

      // live pulse rings (cheap strokes, on top of sprites)
      for (const s of map.stars) {
        if (!s.live) continue;
        const sx = s.x * size.w;
        const sy = s.y * size.h;
        const r = Math.max(1.2, s.r * scale);
        if (!reducedMotion) {
          const pk = 0.5 + 0.5 * Math.sin(t / 900 + (phases.get(s.org) ?? 0) * Math.PI * 2);
          ctx.strokeStyle = withAlpha('#4fbf7e', 0.25 + 0.35 * pk);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 3 + pk * 2.5, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeStyle = withAlpha('#4fbf7e', 0.45);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      ctx.drawImage(fg, 0, 0, size.w, size.h);

      if (!reducedMotion) raf = requestAnimationFrame(draw);
    };

    draw(0);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, map, phases, reducedMotion, fontsReady, dust]);

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
    <div ref={wrapRef} className="relative h-[46vh] min-h-[340px] w-full overflow-hidden bg-void md:h-[58vh]">
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
