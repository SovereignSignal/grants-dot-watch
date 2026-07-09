'use client';

// THE GALAXY — the full interactive register. Every star is a real org,
// every nebula a real system, positions come from buildStarmap() server-side
// (via the `map` prop). This component owns the camera (pan/zoom), hit
// testing, and the DOM overlays (controls, legend, status, tooltip); it
// never invents layout of its own.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { Star, Starmap } from '@/lib/starmap';
import { STAR_DEFAULT, WIRE_HEX } from '@/lib/starmap';
import { WireBadge } from '@/components/ui';
import type { GalaxyMeta, WireFilter } from './types';
import {
  DEFAULT_CAMERA,
  centerOn,
  clampZoom,
  dominantWireByCluster,
  hashUnit,
  hexToRgba,
  worldToScreen,
  zoomAroundPoint,
  type Camera,
} from './geometry';
import GalaxyControls from './GalaxyControls';
import GalaxyLegend from './GalaxyLegend';

const LIVE_HEX = '#4fbf7e'; // mirrors --color-live (globals.css)
const SIGNAL_HEX = '#e8b44f'; // mirrors --color-signal — used for the focus pulse ring
const CLUSTER_LABEL_HEX = '#5b5f73'; // mirrors --color-faint

const FOCUS_ZOOM = 2.4;
const DRAG_THRESHOLD = 3; // px before a pointer-down reads as a drag, not a tap
const HOVER_MARGIN = 30; // px, offscreen culling margin for star draws
const TOOLTIP_W = 224;
const TOOLTIP_H = 92;

interface Hovered {
  star: Star;
  px: number;
  py: number;
}

interface PinchState {
  startDist: number;
  startZoom: number;
  startPanX: number;
  startPanY: number;
}

function tooltipStyle(px: number, py: number, w: number, h: number): CSSProperties {
  let left = px + 16;
  let top = py + 16;
  if (left + TOOLTIP_W > w) left = px - TOOLTIP_W - 16;
  if (top + TOOLTIP_H > h) top = py - TOOLTIP_H - 16;
  left = Math.max(6, Math.min(left, Math.max(6, w - TOOLTIP_W - 6)));
  top = Math.max(6, Math.min(top, Math.max(6, h - TOOLTIP_H - 6)));
  return { left, top };
}

export default function GalaxyCanvas({ map, meta, focusOrgId }: { map: Starmap; meta: GalaxyMeta; focusOrgId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const router = useRouter();

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [camera, setCamera] = useState<Camera>(DEFAULT_CAMERA);
  const [liveOnly, setLiveOnly] = useState(false);
  const [wireFilter, setWireFilter] = useState<WireFilter>('all');
  const [hovered, setHovered] = useState<Hovered | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  const sizeRef = useRef(size);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const pinchRef = useRef<PinchState | null>(null);
  const pulseOrgRef = useRef<string | null>(null);
  const pulseStartRef = useRef<number | null>(null);
  const appliedFocusRef = useRef(false);

  const clusterWire = useMemo(() => dominantWireByCluster(map.clusters, map.stars), [map.clusters, map.stars]);
  const clusterNameById = useMemo(() => new Map(map.clusters.map((c) => [c.system, c.name])), [map.clusters]);

  // Track container size.
  useEffect(() => {
    const el = containerRef.current;
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

  // Cluster labels want the mono font metrics settled before first paint.
  useEffect(() => {
    if (typeof document === 'undefined' || !('fonts' in document)) return;
    document.fonts.ready.then(() => setFontsReady(true)).catch(() => {});
  }, []);

  // Resize the backing buffer (devicePixelRatio-aware) whenever the CSS size changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w < 1 || size.h < 1) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctxRef.current = ctx;
    }
  }, [size.w, size.h]);

  // Center + pulse on ?focus=<org-id>, once, as soon as we know the viewport size.
  useEffect(() => {
    if (appliedFocusRef.current || !focusOrgId || size.w < 1 || size.h < 1) return;
    appliedFocusRef.current = true;
    const star = map.stars.find((s) => s.org === focusOrgId);
    if (!star) return;
    setCamera(centerOn(star.x, star.y, clampZoom(FOCUS_ZOOM), size.w, size.h));
    if (!reducedMotion) {
      pulseOrgRef.current = star.org;
      pulseStartRef.current = performance.now();
    }
  }, [focusOrgId, size.w, size.h, map.stars, reducedMotion]);

  const draw = useCallback(() => {
    const ctx = ctxRef.current;
    const { w, h } = size;
    if (!ctx || w < 1 || h < 1) return;
    const t = performance.now();

    ctx.clearRect(0, 0, w, h);

    for (const c of map.clusters) {
      const pos = worldToScreen(c.x, c.y, w, h, camera);
      const radius = c.r * Math.min(w, h) * camera.zoom;
      if (radius < 1 || pos.x + radius < -40 || pos.x - radius > w + 40 || pos.y + radius < -40 || pos.y - radius > h + 40) continue;

      const wire = clusterWire.get(c.system);
      const tint = wire ? WIRE_HEX[wire] : STAR_DEFAULT;
      const rr = Math.max(6, radius);
      const grad = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, rr);
      grad.addColorStop(0, hexToRgba(tint, 0.12));
      grad.addColorStop(1, hexToRgba(tint, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, rr, 0, Math.PI * 2);
      ctx.fill();

      if (c.members >= 2 && (camera.zoom > 1.4 || c.r > 0.11)) {
        ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace';
        ctx.fillStyle = CLUSTER_LABEL_HEX;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const ly = Math.min(h - 6, Math.max(12, pos.y - rr - 6));
        ctx.fillText(c.name.toUpperCase(), pos.x, ly);
      }
    }

    for (const s of map.stars) {
      const pos = worldToScreen(s.x, s.y, w, h, camera);
      const r = Math.max(0.8, s.r * camera.zoom);
      if (pos.x < -HOVER_MARGIN || pos.x > w + HOVER_MARGIN || pos.y < -HOVER_MARGIN || pos.y > h + HOVER_MARGIN) continue;

      let alpha = 1;
      if (liveOnly && !s.live) alpha *= 0.25;
      if (wireFilter !== 'all' && s.wire !== wireFilter) alpha *= 0.22;

      if (!reducedMotion) {
        const phase = hashUnit(s.org);
        const period = 2600 + phase * 3200;
        alpha *= 0.82 + 0.18 * (0.5 + 0.5 * Math.sin((t / period) * Math.PI * 2 + phase * Math.PI * 2));
      }

      const hex = s.wire ? WIRE_HEX[s.wire] : STAR_DEFAULT;

      if (s.live) {
        const glowR = r * 2.4 + 5;
        const glow = ctx.createRadialGradient(pos.x, pos.y, 0, pos.x, pos.y, glowR);
        glow.addColorStop(0, hexToRgba(LIVE_HEX, 0.32 * alpha));
        glow.addColorStop(1, hexToRgba(LIVE_HEX, 0));
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, glowR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (pulseOrgRef.current === s.org && pulseStartRef.current != null) {
        const elapsed = t - pulseStartRef.current;
        const cycle = 750;
        if (elapsed < cycle * 2) {
          const ct = (elapsed % cycle) / cycle;
          ctx.strokeStyle = hexToRgba(SIGNAL_HEX, (1 - ct) * 0.7);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, r + 3 + ct * 20, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          pulseStartRef.current = null;
          pulseOrgRef.current = null;
        }
      }
    }
  }, [map, clusterWire, camera, liveOnly, wireFilter, reducedMotion, fontsReady, size]);

  // Always-fresh pointer to the latest draw(), for the twinkle loop below.
  const drawRef = useRef(draw);
  useEffect(() => {
    drawRef.current = draw;
    draw();
  }, [draw]);

  // Continuous rAF loop only while twinkling is allowed; otherwise every
  // redraw above is one-shot, triggered by an actual state change.
  useEffect(() => {
    if (reducedMotion) return;
    let raf = 0;
    const loop = () => {
      drawRef.current();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion]);

  const hitTest = useCallback(
    (clientX: number, clientY: number): Star | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const px = clientX - rect.left;
      const py = clientY - rect.top;
      let best: Star | null = null;
      let bestD = Infinity;
      for (const s of map.stars) {
        const pos = worldToScreen(s.x, s.y, size.w, size.h, camera);
        const screenR = Math.max(1.4, s.r * camera.zoom);
        const d = Math.hypot(pos.x - px, pos.y - py);
        const threshold = Math.max(12, screenR + 3);
        if (d <= threshold && d < bestD) {
          bestD = d;
          best = s;
        }
      }
      return best;
    },
    [map.stars, size.w, size.h, camera]
  );

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    canvasRef.current?.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      dragRef.current = { startX: e.clientX, startY: e.clientY, moved: false };
    } else if (pointers.current.size === 2) {
      const pts = [...pointers.current.values()];
      pinchRef.current = {
        startDist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1,
        startZoom: camera.zoom,
        startPanX: camera.panX,
        startPanY: camera.panY,
      };
      dragRef.current = null;
    }
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) {
      const star = hitTest(e.clientX, e.clientY);
      if (star) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) setHovered({ star, px: e.clientX - rect.left, py: e.clientY - rect.top });
      } else {
        setHovered(null);
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pinchRef.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1;
      const newZoom = clampZoom(pinchRef.current.startZoom * (dist / pinchRef.current.startDist));
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const midX = (pts[0].x + pts[1].x) / 2 - rect.left;
      const midY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const base: Camera = { zoom: pinchRef.current.startZoom, panX: pinchRef.current.startPanX, panY: pinchRef.current.startPanY };
      setCamera(zoomAroundPoint(base, newZoom, midX, midY, size.w, size.h));
      return;
    }

    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
        dragRef.current.moved = true;
        setIsDragging(true);
      }
      dragRef.current.startX = e.clientX;
      dragRef.current.startY = e.clientY;
      setCamera((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
      setHovered(null);
    }
  };

  const endGesture = (pointerId: number) => {
    pointers.current.delete(pointerId);
    if (pinchRef.current && pointers.current.size < 2) pinchRef.current = null;
    if (pointers.current.size === 0) {
      dragRef.current = null;
      setIsDragging(false);
    }
  };

  const handlePointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const wasTap = pointers.current.size === 1 && dragRef.current && !dragRef.current.moved && !pinchRef.current;
    if (wasTap) {
      const star = hitTest(e.clientX, e.clientY);
      if (star) router.push(`/orgs/${star.org}`);
    }
    endGesture(e.pointerId);
  };

  const handlePointerCancel = (e: ReactPointerEvent<HTMLCanvasElement>) => endGesture(e.pointerId);

  const handleDoubleClick = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setCamera((prev) => zoomAroundPoint(prev, prev.zoom * 1.8, mx, my, size.w, size.h));
  };

  // Wheel needs a non-passive native listener — React's synthetic onWheel is
  // passive by default, so e.preventDefault() there would just warn and no-op.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = Math.exp(-e.deltaY * 0.0016);
      setCamera((prev) => zoomAroundPoint(prev, prev.zoom * factor, mx, my, sizeRef.current.w, sizeRef.current.h));
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const zoomBy = (factor: number) =>
    setCamera((prev) => zoomAroundPoint(prev, prev.zoom * factor, sizeRef.current.w / 2, sizeRef.current.h / 2, sizeRef.current.w, sizeRef.current.h));

  const systemName = hovered?.star.system ? clusterNameById.get(hovered.star.system) ?? null : null;
  const hoveredAwards = hovered ? meta.awardsByOrg[hovered.star.org] : undefined;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-void">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Interactive galaxy map: ${meta.starCount} organizations across ${meta.clusterCount} funding systems. A list alternative is available above.`}
        style={{ touchAction: 'none', cursor: isDragging ? 'grabbing' : hovered ? 'pointer' : 'grab' }}
        className="block h-full w-full"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => setHovered(null)}
        onDoubleClick={handleDoubleClick}
      />

      {hovered && (
        <div
          className="pointer-events-none absolute z-20 w-56 rounded-md border border-line bg-raised/95 px-3 py-2 shadow-lg backdrop-blur-sm"
          style={tooltipStyle(hovered.px, hovered.py, size.w, size.h)}
        >
          <div className="truncate text-sm font-medium text-paper">{hovered.star.name}</div>
          {systemName && <div className="coord mt-0.5 truncate">{systemName}</div>}
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {hovered.star.wire && <WireBadge wire={hovered.star.wire} small />}
            {hovered.star.live && <span className="text-[11px] font-medium text-live">Live round</span>}
          </div>
          {typeof hoveredAwards === 'number' && hoveredAwards > 0 && <div className="coord mt-1.5">awards: {hoveredAwards}</div>}
        </div>
      )}

      <GalaxyControls
        liveOnly={liveOnly}
        onToggleLive={() => setLiveOnly((v) => !v)}
        wireFilter={wireFilter}
        onSetWireFilter={setWireFilter}
        zoom={camera.zoom}
        onZoomIn={() => zoomBy(1.35)}
        onZoomOut={() => zoomBy(1 / 1.35)}
        onReset={() => setCamera(DEFAULT_CAMERA)}
      />

      <GalaxyLegend />

      <div className="pointer-events-none absolute top-3 right-3 z-10 coord">
        {meta.starCount} orgs · {meta.clusterCount} systems
      </div>

      {meta.starCount === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="pointer-events-auto rounded-md border border-dashed border-line bg-deep/70 p-8 text-center text-dim backdrop-blur">
            No organizations on file yet. The register is still filling in.
          </div>
        </div>
      )}
    </div>
  );
}
