'use client';

// THE GALAXY, v2 — a real 3D relational scene (docs/galaxy-3d-direction.md).
// Funder orgs as glowing spheres, systems as faint wireframe hubs, co-funding
// overlap as luminous edges. Built on 3d-force-graph/three.js; this component
// owns the WebGL scene lifecycle, hover/click, filters, and the DOM overlays.
// Rendered only via a client-only (`ssr: false`) dynamic import from
// src/app/galaxy/page.tsx — three.js needs a browser.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import ForceGraph3D, { type ForceGraph3DInstance } from '3d-force-graph';
import { WIRE_LABEL, money } from '@/lib/format';
import type { Wire } from '@/lib/types';
import type { GalaxyGraph, GalaxyLink, GalaxyGranteeNode, GalaxyNode, GalaxyOrgNode, GalaxySystemNode } from '@/lib/galaxy-graph';
import { hexToRgba } from './geometry';
import type { WireFilter } from './types';
import Galaxy3DControls from './Galaxy3DControls';
import GalaxyLegend from './GalaxyLegend';
import GalaxyFallbackList from './GalaxyFallbackList';

// Brighter emissive variants for the WebGL canvas — the validated dark-surface
// wire trio (WIRE_HEX) stays reserved for UI chrome (chips, legend, tooltip
// dot) so identity is never color-alone. See docs/galaxy-3d-direction.md.
const GLOW_HEX: Record<Wire, string> = {
  crypto: '#eaa63f',
  ai: '#a98bff',
  oss: '#3cc4d6',
};
const NODE_DEFAULT_HEX = '#8f93a8';
const GRANTEE_HEX = '#8f93a8'; // dim paper-white — recipients carry no wire hue
const GRANTEE_BRIDGE_HEX = '#c8a06e'; // subtle warm tint for grantees with >=2 funders (the bridges)
const SYSTEM_HEX = '#5b5f73';
const SYSTEM_GLOW_HEX = '#9094a8';
const LIVE_HEX = '#4fbf7e';
const SIGNAL_HEX = '#e8b44f';
const PAPER_HEX = '#e8e6df';
const VOID_HEX = '#0b0e1a';

// Label discipline (docs/galaxy-3d-direction.md: the screenshot showed a
// center pileup from too many always-on labels). Only the biggest funders and
// system hubs earn a persistent sprite label; every grantee and every other
// funder is hover-only.
const TOP_LABEL_COUNT = 5;
const DIM_FACTOR = 0.15;
const AUTO_ROTATE_SPEED = 0.5; // OrbitControls units; tuned to read as ~0.4deg/s
const FOCUS_ZOOM_MARGIN = 130;
const TEMP_PULSE_MS = 1500;
// Always-on labels fade with camera distance — full strength inside
// LABEL_FADE_NEAR, floored (not zeroed, so hubs stay findable) beyond
// LABEL_FADE_FAR. Opacity-only: cheap (no texture regeneration).
const LABEL_FADE_NEAR = 220;
const LABEL_FADE_FAR = 650;
const LABEL_FADE_FLOOR = 0.12;

type G3DNode = GalaxyNode & { x?: number; y?: number; z?: number };
// Deliberately NOT `GalaxyLink & {...}` — intersecting GalaxyLink's
// `source: string` with `{ source: string | G3DNode }` collapses to plain
// `string` (an object type can never intersect with `string`), which then
// makes every `typeof l.source === 'object'` branch type as `never`.
interface G3DLink {
  source: string | G3DNode;
  target: string | G3DNode;
  weight: number;
  kind: 'cofunding' | 'system' | 'award';
}

interface HoverInfo {
  node: G3DNode;
  px: number;
  py: number;
}

const TOOLTIP_W = 224;
const TOOLTIP_H = 100;

function tooltipStyle(px: number, py: number, w: number, h: number): CSSProperties {
  let left = px + 16;
  let top = py + 16;
  if (left + TOOLTIP_W > w) left = px - TOOLTIP_W - 16;
  if (top + TOOLTIP_H > h) top = py - TOOLTIP_H - 16;
  left = Math.max(6, Math.min(left, Math.max(6, w - TOOLTIP_W - 6)));
  top = Math.max(6, Math.min(top, Math.max(6, h - TOOLTIP_H - 6)));
  return { left, top };
}

function detectWebGL(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return !!gl;
  } catch {
    return false;
  }
}

// Cached radial-gradient sprite textures for node halos — one per hex color,
// reused across every live node (and the temporary focus pulse).
const HALO_CACHE = new Map<string, THREE.Texture>();
function haloTexture(hex: string): THREE.Texture {
  let tex = HALO_CACHE.get(hex);
  if (tex) return tex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, hexToRgba(hex, 0.5));
  grad.addColorStop(0.45, hexToRgba(hex, 0.16));
  grad.addColorStop(1, hexToRgba(hex, 0));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  tex = new THREE.CanvasTexture(c);
  HALO_CACHE.set(hex, tex);
  return tex;
}

// Thin ring texture (as opposed to the filled halo) — used for the temporary
// "you are here" pulse on ?focus=<org-id>.
const RING_CACHE = new Map<string, THREE.Texture>();
function ringTexture(hex: string): THREE.Texture {
  let tex = RING_CACHE.get(hex);
  if (tex) return tex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.strokeStyle = hexToRgba(hex, 0.9);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.stroke();
  tex = new THREE.CanvasTexture(c);
  RING_CACHE.set(hex, tex);
  return tex;
}

export default function Galaxy3D({ focusOrgId }: { focusOrgId: string | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance<G3DNode, G3DLink> | null>(null);
  const router = useRouter();

  const [webglOk, setWebglOk] = useState<boolean | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const [graphData, setGraphData] = useState<GalaxyGraph | null>(null);
  const [loadErr, setLoadErr] = useState(false);
  const [liveOnly, setLiveOnly] = useState(false);
  const [wireFilter, setWireFilter] = useState<WireFilter>('all');
  const [reducedMotion, setReducedMotion] = useState(false);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Live-read refs so accessor closures (called deep inside the three-forcegraph
  // digest cycle) always see current filter/hover state without needing new
  // function identities wired through React re-renders.
  const liveOnlyRef = useRef(liveOnly);
  const wireFilterRef = useRef(wireFilter);
  const reducedMotionRef = useRef(reducedMotion);
  const highlightLinksRef = useRef<Set<G3DLink>>(new Set());
  const topLabelIdsRef = useRef<Set<string>>(new Set());
  const focusOrgIdRef = useRef(focusOrgId);

  useEffect(() => {
    liveOnlyRef.current = liveOnly;
  }, [liveOnly]);
  useEffect(() => {
    wireFilterRef.current = wireFilter;
  }, [wireFilter]);
  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);
  useEffect(() => {
    focusOrgIdRef.current = focusOrgId;
  }, [focusOrgId]);

  useEffect(() => {
    setWebglOk(detectWebGL());
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
    let cancelled = false;
    fetch('/api/galaxy-graph')
      .then((r) => {
        if (!r.ok) throw new Error(`galaxy-graph ${r.status}`);
        return r.json();
      })
      .then((d: GalaxyGraph) => {
        if (!cancelled) setGraphData(d);
      })
      .catch(() => {
        if (!cancelled) setLoadErr(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const orgCount = useMemo(() => (graphData ? graphData.nodes.filter((n) => n.kind === 'org').length : 0), [graphData]);
  const granteeCount = useMemo(
    () => (graphData ? graphData.nodes.filter((n) => n.kind === 'grantee').length : 0),
    [graphData]
  );
  const cofundingCount = useMemo(
    () => (graphData ? graphData.links.filter((l) => l.kind === 'cofunding').length : 0),
    [graphData]
  );
  const awardLinkCount = useMemo(
    () => (graphData ? graphData.links.filter((l) => l.kind === 'award').length : 0),
    [graphData]
  );

  useEffect(() => {
    if (!graphData) return;
    topLabelIdsRef.current = new Set(
      graphData.nodes
        .filter((n): n is GalaxyOrgNode => n.kind === 'org')
        .slice()
        .sort((a, b) => b.size - a.size)
        .slice(0, TOP_LABEL_COUNT)
        .map((n) => n.id)
    );
  }, [graphData]);

  const dimMatches = useCallback((node: { wire?: Wire | null; live?: boolean }): boolean => {
    if (liveOnlyRef.current && !node.live) return false;
    if (wireFilterRef.current !== 'all' && node.wire !== wireFilterRef.current) return false;
    return true;
  }, []);

  // ---- node visuals ----
  const nodeThreeObject = useCallback(
    (node: G3DNode): THREE.Object3D => {
      const group = new THREE.Group();

      if (node.kind === 'system') {
        // System hubs carry no wire/live dimension of their own — they stay
        // put as structure regardless of the active filters.
        const sys = node as GalaxySystemNode;
        const geo = new THREE.IcosahedronGeometry(Math.max(4, sys.size), 1);
        const mat = new THREE.MeshBasicMaterial({
          color: SYSTEM_HEX,
          wireframe: true,
          transparent: true,
          opacity: 0.4,
        });
        group.add(new THREE.Mesh(geo, mat));

        const label = new SpriteText(sys.name.toUpperCase());
        label.color = SYSTEM_GLOW_HEX;
        label.fontFace = "'IBM Plex Mono', ui-monospace, monospace";
        label.fontWeight = '600';
        label.fontSize = 34;
        label.textHeight = Math.max(2.6, sys.size * 0.5);
        label.position.set(0, sys.size + label.textHeight * 1.15, 0);
        label.material.transparent = true;
        label.material.opacity = 0.85;
        label.material.depthWrite = false;
        label.userData.labelFade = { baseOpacity: 0.85 };
        group.add(label);

        group.userData.nodeId = sys.id;
        return group;
      }

      if (node.kind === 'grantee') {
        // Recipients, not identity-bearing wire members: small, dim,
        // paper-white spheres with no wire hue. Bridge grantees (>=2
        // funders — the actual connective tissue of the web) get a subtle
        // warm tint and a touch more size so the flow through them reads.
        const grantee = node as GalaxyGranteeNode;
        const isBridge = grantee.funders >= 2;
        const hex = isBridge ? GRANTEE_BRIDGE_HEX : GRANTEE_HEX;
        const radius = Math.max(1.1, grantee.size * (isBridge ? 1.5 : 1.15));

        const geo = new THREE.SphereGeometry(radius, 12, 10);
        const mat = new THREE.MeshBasicMaterial({
          color: hex,
          transparent: true,
          opacity: isBridge ? 0.6 : 0.4,
        });
        group.add(new THREE.Mesh(geo, mat));

        // A faint halo only for bridges — plain satellites stay pinpricks on
        // purpose, keeping visual weight on funders and bridge grantees.
        if (isBridge) {
          const haloMat = new THREE.SpriteMaterial({
            map: haloTexture(hex),
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            opacity: 0.14,
          });
          const halo = new THREE.Sprite(haloMat);
          const haloScale = radius * 2.2;
          halo.scale.set(haloScale, haloScale, 1);
          group.add(halo);
        }

        group.userData.nodeId = grantee.id;
        return group;
      }

      const org = node as GalaxyOrgNode;
      const dim = !dimMatches(org);
      const glowHex = org.wire ? GLOW_HEX[org.wire] : NODE_DEFAULT_HEX;
      const radius = Math.max(2.4, org.size * 2.6);

      // Self-illuminated (MeshBasicMaterial, not Lambert) — a lit sphere this
      // small, this far from camera, reads as a grey pinprick once fog and
      // ambient falloff have their say. The glow hex IS the surface color;
      // bloom does the rest.
      const geo = new THREE.SphereGeometry(radius, 20, 16);
      const mat = new THREE.MeshBasicMaterial({
        color: glowHex,
        transparent: true,
        opacity: dim ? DIM_FACTOR : 0.95,
      });
      const mesh = new THREE.Mesh(geo, mat);
      group.add(mesh);

      // Every org gets a soft halo (bloom's real surface area — a bare sphere
      // this small reads as a pinprick even emissive); live rounds get a
      // second, brighter, pulsing ring on top.
      const haloMat = new THREE.SpriteMaterial({
        map: haloTexture(glowHex),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: dim ? DIM_FACTOR : 0.26,
      });
      const halo = new THREE.Sprite(haloMat);
      const haloScale = radius * 2.6;
      halo.scale.set(haloScale, haloScale, 1);
      group.add(halo);

      if (org.live) {
        const tex = haloTexture(glowHex);
        const spriteMat = new THREE.SpriteMaterial({
          map: tex,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          opacity: dim ? DIM_FACTOR : 0.85,
        });
        const sprite = new THREE.Sprite(spriteMat);
        const s = radius * 3.2; // was 5.2 — additive stack clipped live nodes to white
        sprite.scale.set(s, s, 1);
        sprite.userData.pulse = { baseScale: s, baseOpacity: dim ? DIM_FACTOR : 0.35, phase: Math.random() * Math.PI * 2 };
        group.add(sprite);
      }

      if (topLabelIdsRef.current.has(org.id)) {
        const label = new SpriteText(org.name);
        label.color = PAPER_HEX;
        label.fontFace = "'Instrument Sans', system-ui, sans-serif";
        label.fontSize = 24; // modest — always-on labels are now reserved for the top ~10 funders
        label.textHeight = Math.max(1.9, radius * 0.9);
        label.position.set(0, radius + label.textHeight * 0.85, 0);
        label.material.transparent = true;
        label.material.opacity = dim ? DIM_FACTOR : 0.92;
        label.material.depthWrite = false;
        label.userData.labelFade = { baseOpacity: dim ? DIM_FACTOR : 0.92 };
        group.add(label);
      }

      group.userData.nodeId = org.id;
      return group;
    },
    [dimMatches]
  );

  // ---- link visuals ----
  // Award edges (funder->grantee, the bulk of the graph — ~500-600 of them)
  // stay faint, scaled by weight (award count toward that grantee).
  // Co-funding edges (the 34 direct-overlap accents) run brighter, so the
  // sparse-but-real direct relationships still read against the flow web.
  const linkBaseAlpha = useCallback((link: G3DLink): number => {
    if (link.kind === 'system') return 0.04;
    if (link.kind === 'award') return Math.max(0.07, Math.min(0.24, 0.07 + link.weight * 0.014));
    return Math.max(0.14, Math.min(0.42, 0.14 + link.weight * 0.02));
  }, []);

  const linkEndpointsMatch = useCallback(
    (link: G3DLink): boolean => {
      const s = link.source as G3DNode;
      const t = link.target as G3DNode;
      const sOrg = typeof s === 'object' && s.kind === 'org' ? (s as GalaxyOrgNode) : null;
      const tOrg = typeof t === 'object' && t.kind === 'org' ? (t as GalaxyOrgNode) : null;
      const sDim = sOrg ? !dimMatches(sOrg) : false;
      const tDim = tOrg ? !dimMatches(tOrg) : false;
      // Award edges have exactly one org endpoint (the other is a grantee,
      // which carries no wire/live of its own) — follow that funder's filter
      // state directly rather than requiring both sides to agree.
      if (sOrg && !tOrg) return !sDim;
      if (tOrg && !sOrg) return !tDim;
      // Structural/co-funding links dim only when BOTH org endpoints would
      // dim (a system hub or the other org keeps it from vanishing entirely).
      return !(sDim && tDim);
    },
    [dimMatches]
  );

  const linkColorFn = useCallback(
    (link: G3DLink): string => {
      if (highlightLinksRef.current.has(link)) {
        const s = link.source as G3DNode;
        const wire = typeof s === 'object' && s.kind === 'org' ? (s as GalaxyOrgNode).wire : null;
        return hexToRgba(wire ? GLOW_HEX[wire] : SIGNAL_HEX, 0.6);
      }
      const alpha = linkBaseAlpha(link);
      const dimmed = !linkEndpointsMatch(link);
      const baseHex = link.kind === 'cofunding' ? SIGNAL_HEX : PAPER_HEX;
      return hexToRgba(baseHex, dimmed ? alpha * DIM_FACTOR : alpha);
    },
    [linkBaseAlpha, linkEndpointsMatch]
  );

  const linkWidthFn = useCallback(
    (link: G3DLink): number => {
      if (highlightLinksRef.current.has(link)) return 1.4;
      return link.kind === 'cofunding' ? 0.9 : 0.7;
    },
    []
  );

  const linkParticlesFn = useCallback(
    (link: G3DLink): number => (highlightLinksRef.current.has(link) && !reducedMotionRef.current ? 2 : 0),
    []
  );

  const linkParticleColorFn = useCallback((link: G3DLink): string => {
    const s = link.source as G3DNode;
    const wire = typeof s === 'object' && s.kind === 'org' ? (s as GalaxyOrgNode).wire : null;
    return wire ? GLOW_HEX[wire] : SIGNAL_HEX;
  }, []);

  const refreshLinkVisuals = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.linkColor(graph.linkColor()).linkWidth(graph.linkWidth()).linkDirectionalParticles(graph.linkDirectionalParticles());
  }, []);

  const refreshNodeVisuals = useCallback(() => {
    const graph = graphRef.current;
    if (!graph) return;
    graph.nodeThreeObject(graph.nodeThreeObject());
  }, []);

  // filter changes re-run the accessor functions (which read the refs above)
  useEffect(() => {
    refreshNodeVisuals();
    refreshLinkVisuals();
  }, [liveOnly, wireFilter, refreshNodeVisuals, refreshLinkVisuals]);

  const findNodeLinks = useCallback((node: G3DNode, links: G3DLink[]): Set<G3DLink> => {
    // Compare by id, not object identity: three-forcegraph resolves
    // link.source/target from a raw id string to the node object only once
    // the force engine has processed the data, so an id-based match is safe
    // regardless of timing.
    const out = new Set<G3DLink>();
    for (const l of links) {
      const sId = typeof l.source === 'object' ? l.source.id : l.source;
      const tId = typeof l.target === 'object' ? l.target.id : l.target;
      if (sId === node.id || tId === node.id) out.add(l);
    }
    return out;
  }, []);

  // ---- mount the scene ----
  useEffect(() => {
    if (!graphData || webglOk !== true || !containerRef.current) return;
    const el = containerRef.current;
    let disposed = false;
    let raf = 0;
    let ro: ResizeObserver | null = null;
    let framed = false;

    try {
      const nodes: G3DNode[] = graphData.nodes.map((n) => ({ ...n }));
      const links: G3DLink[] = graphData.links.map((l) => ({ ...l }));

      // The library's default export is typed as a non-generic constructor
      // (its generics live on the interface, not the exported const), so the
      // node/link element types have to be asserted rather than passed at
      // the `new` call site.
      const graph = new ForceGraph3D(el, { controlType: 'orbit' }) as unknown as ForceGraph3DInstance<G3DNode, G3DLink>;
      graphRef.current = graph;

      graph
        .backgroundColor('rgba(0,0,0,0)')
        .showNavInfo(false)
        // The scene has a fixed, physics-settled layout — nothing here is
        // meant to be dragged. This also sidesteps a real three.js bug: its
        // DragControls and OrbitControls share the same canvas element, and
        // a click that navigates away (unmounting the canvas mid-gesture)
        // makes the browser fire a native `pointercancel`, which the two
        // controls don't handle defensively between each other and throws.
        // Not needed here since dragging is off; not worth patching upstream.
        .enableNodeDrag(false)
        .nodeId('id')
        .nodeLabel(() => '')
        .nodeThreeObject(nodeThreeObject)
        .nodeThreeObjectExtend(false)
        .nodeVal((n) => (n.kind === 'system' ? n.size * 2.2 : n.size))
        .linkColor(linkColorFn)
        .linkWidth(linkWidthFn)
        .linkOpacity(1)
        .linkDirectionalParticles(linkParticlesFn)
        .linkDirectionalParticleSpeed(0.006)
        .linkDirectionalParticleWidth(1.6)
        .linkDirectionalParticleColor(linkParticleColorFn)
        .cooldownTicks(120)
        .width(el.clientWidth)
        .height(el.clientHeight)
        .graphData({ nodes, links });

      // fog for depth — mapofzones-style falloff into the void. Kept light:
      // dense enough to read as atmosphere at the far edge of the cluster,
      // not so dense it desaturates the glow the whole scene depends on.
      graph.scene().fog = new THREE.FogExp2(VOID_HEX, 0.0009);

      // orbit + slow auto-rotate, stopping permanently on the first pointer interaction
      const controls = graph.controls() as unknown as {
        autoRotate: boolean;
        autoRotateSpeed: number;
        enableDamping: boolean;
        enabled: boolean;
        addEventListener: (evt: string, cb: () => void) => void;
      };
      controls.enableDamping = true;
      if (!reducedMotionRef.current) {
        controls.autoRotate = true;
        controls.autoRotateSpeed = AUTO_ROTATE_SPEED;
        const stopRotate = () => {
          controls.autoRotate = false;
        };
        controls.addEventListener('start', stopRotate);
      }

      // bloom — THE mapofzones glow. Guarded: a failure here degrades to the
      // plain (already-good) scene rather than breaking the page.
      try {
        void import('three/examples/jsm/postprocessing/UnrealBloomPass.js').then(({ UnrealBloomPass }) => {
          if (disposed) return;
          const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 1.05, 0.65, 0.12);
          graph.postProcessingComposer().addPass(bloom);
        });
      } catch {
        // no bloom — scene still renders fine without it
      }

      // Layout tuning. Co-funding data is sparse by nature (docs/DESIGN.md:
      // most orgs are curated funders, not every pair shares grantees) and a
      // majority of nodes carry a `systems` membership but plenty don't —
      // left to stock d3-force-3d, those unconnected nodes get flung out by
      // charge with nothing pulling them back, and zoomToFit then has to
      // frame that whole sparse cloud, shrinking the real cluster to
      // pinpricks. Softer charge + short link distances + a flat radial
      // "gravity" (pulls every node toward the origin a little, connected or
      // not) keeps the whole scene in one readable, orbit-able ball. Casts:
      // d3-force-3d's Link/ManyBody forces aren't reflected in the library's
      // generic ForceFn typing.
      try {
        const linkForce = graph.d3Force('link') as unknown as {
          distance?: (fn: (l: G3DLink) => number) => void;
          strength?: (fn: (l: G3DLink) => number) => void;
        };
        // v2 adds ~500-600 award edges (funder->grantee) on top of the
        // sparser cofunding/system links — award distance/strength stay
        // short and loose so grantees cluster near their funders instead of
        // stretching the whole scene; cofunding keeps its longer, stronger
        // pull since those are the fewer, truer direct relationships.
        linkForce?.distance?.((l) => (l.kind === 'system' ? 30 : l.kind === 'award' ? 38 : 65));
        linkForce?.strength?.((l) => (l.kind === 'system' ? 0.9 : l.kind === 'award' ? 0.3 : 0.25));
        const chargeForce = graph.d3Force('charge') as unknown as { strength?: (n: number) => void };
        chargeForce?.strength?.(-14);

        const simNodes = nodes as unknown as { x?: number; y?: number; z?: number; vx?: number; vy?: number; vz?: number }[];
        graph.d3Force(
          'radial',
          ((alpha: number) => {
            const k = 0.02 * alpha;
            for (const n of simNodes) {
              if (n.x != null) n.vx = (n.vx || 0) - n.x * k;
              if (n.y != null) n.vy = (n.vy || 0) - n.y * k;
              if (n.z != null) n.vz = (n.vz || 0) - n.z * k;
            }
          }) as never
        );
      } catch {
        // default forces are fine too
      }

      graph.onNodeClick((node) => {
        if (node.kind === 'org') router.push(`/orgs/${node.id}`);
        else if (node.kind === 'grantee') {
          const grantee = node as GalaxyGranteeNode;
          router.push(grantee.orgId ? `/orgs/${grantee.orgId}` : `/grantees/${grantee.slug}`);
        } else router.push(`/systems/${node.id.replace(/^sys:/, '')}`);
      });

      graph.onNodeHover((node) => {
        highlightLinksRef.current = node ? findNodeLinks(node, links) : new Set();
        refreshLinkVisuals();
        if (node) {
          el.style.cursor = 'pointer';
          setHover((prev) => (prev && prev.node.id === node.id ? prev : { node, px: prev?.px ?? el.clientWidth / 2, py: prev?.py ?? el.clientHeight / 2 }));
        } else {
          el.style.cursor = 'grab';
          setHover(null);
        }
      });

      const onPointerMove = (e: PointerEvent) => {
        const rect = el.getBoundingClientRect();
        setHover((prev) => (prev ? { ...prev, px: e.clientX - rect.left, py: e.clientY - rect.top } : prev));
      };
      el.addEventListener('pointermove', onPointerMove);

      graph.onEngineStop(() => {
        if (framed) return;
        framed = true;
        graph.zoomToFit(700, 60);
        if (focusOrgIdRef.current) {
          window.setTimeout(() => applyFocus(focusOrgIdRef.current!), 750);
        }
      });

      function applyFocus(id: string) {
        const target = nodes.find((n) => n.id === id);
        if (!target || target.x == null || target.y == null || target.z == null) return;
        const distance = 140;
        const dir = new THREE.Vector3(target.x, target.y, target.z).normalize();
        if (dir.lengthSq() === 0) dir.set(0, 0, 1);
        const camPos = {
          x: target.x + dir.x * distance,
          y: target.y + dir.y * distance + FOCUS_ZOOM_MARGIN * 0.1,
          z: target.z + dir.z * distance,
        };
        graph.cameraPosition(camPos, { x: target.x, y: target.y, z: target.z }, reducedMotionRef.current ? 0 : 1400);

        if (!reducedMotionRef.current) {
          const nodeObj = (target as unknown as { __threeObj?: THREE.Object3D }).__threeObj;
          if (nodeObj) {
            const tex = ringTexture(SIGNAL_HEX);
            const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.9 });
            const ring = new THREE.Sprite(mat);
            const base = Math.max(4, (target as GalaxyOrgNode).size ? (target as GalaxyOrgNode).size * 1.6 : 6);
            ring.scale.set(base, base, 1);
            ring.userData.tempPulse = { start: performance.now(), base };
            nodeObj.add(ring);
          }
        }
      }

      // resize
      ro = new ResizeObserver(() => {
        graph.width(el.clientWidth).height(el.clientHeight);
      });
      ro.observe(el);

      // pulse / temp-highlight / label-distance-fade animation loop (skipped
      // entirely under reduced motion)
      if (!reducedMotionRef.current) {
        const camera = graph.camera();
        const labelWorldPos = new THREE.Vector3();
        const projected = new THREE.Vector3();
        const frameLabels: { sprite: THREE.Sprite; opacity: number }[] = [];
        const loop = () => {
          const t = performance.now();
          graph.scene().traverse((obj) => {
            const pulse = obj.userData.pulse as { baseScale: number; baseOpacity: number; phase: number } | undefined;
            if (pulse && obj instanceof THREE.Sprite) {
              const k = 1 + 0.14 * Math.sin(t / 900 + pulse.phase);
              obj.scale.set(pulse.baseScale * k, pulse.baseScale * k, 1);
              (obj.material as THREE.SpriteMaterial).opacity = pulse.baseOpacity * (0.72 + 0.28 * Math.sin(t / 900 + pulse.phase));
            }
            const temp = obj.userData.tempPulse as { start: number; base: number } | undefined;
            if (temp && obj instanceof THREE.Sprite) {
              const elapsed = t - temp.start;
              const cycle = 750;
              if (elapsed < TEMP_PULSE_MS) {
                const ct = (elapsed % cycle) / cycle;
                const s = temp.base + ct * temp.base * 2.2;
                obj.scale.set(s, s, 1);
                (obj.material as THREE.SpriteMaterial).opacity = (1 - ct) * 0.85;
              } else {
                obj.parent?.remove(obj);
                (obj.material as THREE.SpriteMaterial).map?.dispose();
                (obj.material as THREE.SpriteMaterial).dispose();
              }
            }
            // Label discipline part 2a: collect always-on labels (top funders +
            // system hubs) with their distance fade; the collision pass below
            // decides final visibility — the biggest funders cluster spatially,
            // so distance fade alone still produced a center pileup.
            const labelFade = obj.userData.labelFade as { baseOpacity: number } | undefined;
            if (labelFade && obj instanceof THREE.Sprite) {
              obj.getWorldPosition(labelWorldPos);
              const dist = camera.position.distanceTo(labelWorldPos);
              const span = LABEL_FADE_FAR - LABEL_FADE_NEAR;
              const near1 = span > 0 ? Math.max(0, Math.min(1, (LABEL_FADE_FAR - dist) / span)) : 1;
              const k = LABEL_FADE_FLOOR + (1 - LABEL_FADE_FLOOR) * near1;
              frameLabels.push({ sprite: obj, opacity: labelFade.baseOpacity * k });
            }
          });
          // Label discipline part 2b: screen-space AABB suppression. Project
          // each label, keep by priority (bigger sprite first), zero-out any
          // label whose box overlaps one already kept this frame.
          frameLabels.sort((a, b) => b.sprite.scale.x - a.sprite.scale.x);
          const kept: { x0: number; x1: number; y0: number; y1: number }[] = [];
          for (const { sprite, opacity } of frameLabels) {
            sprite.getWorldPosition(labelWorldPos);
            projected.copy(labelWorldPos).project(camera);
            if (projected.z > 1) {
              (sprite.material as THREE.SpriteMaterial).opacity = 0;
              continue;
            }
            // approximate on-screen half-extents from sprite scale vs camera distance
            const dist = camera.position.distanceTo(labelWorldPos);
            const halfW = (sprite.scale.x / Math.max(dist, 1)) * 1.1;
            const halfH = (sprite.scale.y / Math.max(dist, 1)) * 1.4;
            const box = { x0: projected.x - halfW, x1: projected.x + halfW, y0: projected.y - halfH, y1: projected.y + halfH };
            const collides = kept.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0);
            (sprite.material as THREE.SpriteMaterial).opacity = collides ? 0 : opacity;
            if (!collides) kept.push(box);
          }
          frameLabels.length = 0;
          raf = requestAnimationFrame(loop);
        };
        raf = requestAnimationFrame(loop);
      }

      return () => {
        disposed = true;
        if (raf) cancelAnimationFrame(raf);
        ro?.disconnect();
        el.removeEventListener('pointermove', onPointerMove);
        // A click that navigates away (onNodeClick -> router.push) can still
        // have a pointer gesture in flight inside OrbitControls when React
        // unmounts us; disabling controls first, and swallowing whatever
        // _destructor() throws while it tears down a mid-gesture listener,
        // keeps that a no-op instead of an uncaught console error.
        try {
          controls.enabled = false;
        } catch {
          // already gone
        }
        try {
          graph._destructor();
        } catch {
          // scene is being torn down anyway
        }
        graphRef.current = null;
      };
    } catch {
      setRenderFailed(true);
      return undefined;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, webglOk]);

  const resetCamera = useCallback(() => {
    graphRef.current?.zoomToFit(600, 60);
  }, []);

  const showFallback = webglOk === false || renderFailed;
  const wireLabel = hover?.node.kind === 'org' ? (hover.node as GalaxyOrgNode).wire : null;

  return (
    <div className="relative h-full w-full overflow-hidden bg-void">
      <div ref={containerRef} className="h-full w-full" style={{ cursor: 'grab' }} />

      {showFallback && <GalaxyFallbackList visible />}

      {!showFallback && loadErr && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="pointer-events-auto rounded-md border border-dashed border-line bg-deep/70 p-8 text-center text-dim backdrop-blur">
            Couldn&apos;t load the galaxy graph. Try refreshing.
          </div>
        </div>
      )}

      {!showFallback && hover && containerRef.current && (
        <div
          className="pointer-events-none absolute z-20 w-56 rounded-md border border-line bg-raised/95 px-3 py-2 shadow-lg backdrop-blur-sm"
          style={tooltipStyle(hover.px, hover.py, containerRef.current.clientWidth, containerRef.current.clientHeight)}
        >
          <div className="truncate text-sm font-medium text-paper">{hover.node.name}</div>
          {hover.node.kind === 'system' && (
            <div className="coord mt-0.5">{(hover.node as GalaxySystemNode).memberCount} funders anchored here</div>
          )}
          {hover.node.kind === 'org' && (
            <>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {wireLabel && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-dim">
                    <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: `var(--color-${wireLabel})` }} />
                    {WIRE_LABEL[wireLabel]}
                  </span>
                )}
                {(hover.node as GalaxyOrgNode).live && <span className="text-[11px] font-medium text-live">Live round</span>}
              </div>
              <div className="coord mt-1.5">awards: {(hover.node as GalaxyOrgNode).awards}</div>
            </>
          )}
          {hover.node.kind === 'grantee' && (
            <>
              <div className="coord mt-1.5">
                {(hover.node as GalaxyGranteeNode).funders} funder{(hover.node as GalaxyGranteeNode).funders === 1 ? '' : 's'} ·{' '}
                {money((hover.node as GalaxyGranteeNode).totalUsd)} known
              </div>
              <div className="coord mt-0.5 text-dim">derived from the ledger</div>
            </>
          )}
        </div>
      )}

      {!showFallback && (
        <>
          <Galaxy3DControls
            liveOnly={liveOnly}
            onToggleLive={() => setLiveOnly((v) => !v)}
            wireFilter={wireFilter}
            onSetWireFilter={setWireFilter}
            onReset={resetCamera}
          />
          <GalaxyLegend extra={['hubs = systems', 'dim nodes = grantees', 'edges = awards + co-funding']} />
          <div className="pointer-events-none absolute top-3 right-3 z-10 coord">
            shown: {orgCount} funders · {granteeCount} grantees · {awardLinkCount} awards · {cofundingCount} co-funding links
          </div>
        </>
      )}

      {!showFallback && graphData && graphData.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center px-6">
          <div className="pointer-events-auto rounded-md border border-dashed border-line bg-deep/70 p-8 text-center text-dim backdrop-blur">
            No organizations on file yet. The register is still filling in.
          </div>
        </div>
      )}
    </div>
  );
}
