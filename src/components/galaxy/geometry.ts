// Pure camera math for the galaxy canvas: pan + zoom around the viewport
// center, plus zoom-toward-a-point and center-on-a-star helpers. No DOM,
// no React — easy to reason about and reuse from event handlers.

import type { GalaxyCluster, Star } from '@/lib/starmap';
import type { Wire } from '@/lib/types';

export interface Camera {
  zoom: number; // interactive zoom factor, ZOOM_MIN..ZOOM_MAX
  panX: number; // screen-space px offset
  panY: number;
}

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 6;

export const DEFAULT_CAMERA: Camera = { zoom: 1, panX: 0, panY: 0 };

export function clampZoom(z: number): number {
  if (Number.isNaN(z)) return DEFAULT_CAMERA.zoom;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

/** Map a starmap point (0..1 layout space) to screen px for the current camera + viewport. */
export function worldToScreen(nx: number, ny: number, w: number, h: number, cam: Camera): { x: number; y: number } {
  const baseX = nx * w;
  const baseY = ny * h;
  return {
    x: (baseX - w / 2) * cam.zoom + w / 2 + cam.panX,
    y: (baseY - h / 2) * cam.zoom + h / 2 + cam.panY,
  };
}

/** Inverse of worldToScreen — screen px back to starmap (0..1) space. */
export function screenToWorld(sx: number, sy: number, w: number, h: number, cam: Camera): { nx: number; ny: number } {
  const baseX = (sx - cam.panX - w / 2) / cam.zoom + w / 2;
  const baseY = (sy - cam.panY - h / 2) / cam.zoom + h / 2;
  return { nx: w === 0 ? 0.5 : baseX / w, ny: h === 0 ? 0.5 : baseY / h };
}

/** Change zoom while keeping the world point currently under (sx,sy) fixed on screen. */
export function zoomAroundPoint(cam: Camera, newZoomRaw: number, sx: number, sy: number, w: number, h: number): Camera {
  const zoom = clampZoom(newZoomRaw);
  const k = zoom / cam.zoom;
  const panX = sx - (sx - w / 2 - cam.panX) * k - w / 2;
  const panY = sy - (sy - h / 2 - cam.panY) * k - h / 2;
  return { zoom, panX, panY };
}

/** Center the viewport on a starmap point at a given zoom (used by ?focus=). */
export function centerOn(nx: number, ny: number, zoom: number, w: number, h: number): Camera {
  const z = clampZoom(zoom);
  return {
    zoom: z,
    panX: -(nx * w - w / 2) * z,
    panY: -(ny * h - h / 2) * z,
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// FNV-1a — same algorithm as starmap.ts, kept local so this module has no
// dependency other than plain numbers. Used to seed each star's twinkle phase
// so they don't all pulse in lockstep.
export function hashUnit(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** Dominant wire per cluster, by member-star frequency — tints the nebula. */
export function dominantWireByCluster(clusters: GalaxyCluster[], stars: Star[]): Map<string, Wire | null> {
  const out = new Map<string, Wire | null>();
  for (const c of clusters) {
    const counts = new Map<Wire, number>();
    for (const s of stars) {
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
    out.set(c.system, top);
  }
  return out;
}
