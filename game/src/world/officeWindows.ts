// Iteration 16 (lane TOWER) / task office-seamless (lane LIFT): office windows — glass panes in GEN's perimeter wall openings
// of EVERY storey of the continuous tower (layout.office.windows: each span carries its storey `level` and floor `baseY`),
// with frames, mullions, transoms, an interior sill, some panes cracked (lane ASSETS' T6 window-glass texture, or a
// procedural cracked-glass fallback), some broken out (jagged shards left in the frame) and some boarded up. Built merged
// per storey and material (meshes tagged userData.level: the storey culler hides other floors' windows). Collision: the
// window cells are solid in the grid; every span also gets a collision box that the runtime enforces on the player and
// enemies of that storey (a broken pane is never a way out).
// Transparency follows the storefront glass rules (world/shapeMaterials 'glassShopfront'): transparent, depthWrite off
// — the fog march / composite read the depth BEHIND the glass (the exterior), exactly like the existing shop glazing.
//
// Task gasmask-breach-20261030 (lane GAS): every BREAKABLE pane (paneBreakable: an exterior window of a tower storey, generated
// intact or cracked) has a stable identity (paneId = `level:span:column:row`) and three pre-built looks in the merged storey
// meshes — its intact quad (generated intact only), its cracked quad and its broken shards — whose vertex ranges are recorded
// (WindowView.panes). Only the current look has area; the others are collapsed to a point (zero-area triangles draw nothing).
// setPaneLook switches looks by rewriting those positions (a partial upload): no new mesh, material or pipeline mid-play, so
// the loading-screen warm-up already covers every look. Collision is never touched (world/windowBreach.ts counts the hits).

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from '../core/rng';
import {canvasTexture} from './canvasTextures';
import {SurfaceNodeMaterial, cloneSurfaceMaterial, worldMapped, type WorldMaterials} from './materials';
import {tagReflect} from '../render/reflectTag';
import {shapeMaterial} from './shapeMaterials';
import {hash01, sideNormal, windowYs, type Rect2, type TowerInfo, type WindowSpan} from './towerShared';

export type PaneState = 'intact' | 'cracked' | 'broken' | 'boarded';

/** `col` / `row`: the pane's column along the span and its row (0 = lower; the lobby's transom splits a column in two). */
export interface PanePlan { a0: number; a1: number; y0: number; y1: number; state: PaneState; seed: number; col: number; row: number }

export interface WindowPlan {
  /** Index of the span in layout.office.windows (TowerInfo.windows). */
  index: number;
  span: WindowSpan;
  /** Storey (layout.levels index) and its floor (absolute y). */
  level: number;
  baseY: number;
  /** Outward unit normal (x, z). */
  n: [number, number];
  /** The span runs along this world axis; a0..a1 = its range. */
  along: 'x' | 'z';
  a0: number; a1: number;
  /** Glass plane coordinate on the cross axis; interior face coordinate. */
  glass: number;
  inner: number;
  y0: number; y1: number;
  /** Mullion positions (along-axis) and transom height (null: none). */
  mullions: number[];
  transom: number | null;
  panes: PanePlan[];
  /** Collision box (x/z rect) the runtime keeps bodies out of (pushed toward the interior). */
  collider: Rect2;
}

/**
 * Plans every window span of the tower (every storey): panes, states, frames, colliders (deterministic per level seed). Task
 * studio-skyways-level-20261106-054448 (lane GAS): only the spans + seed are read (world/skywaysWindows.ts plans the Skyways glazing).
 */
export function planWindows(info: Pick<TowerInfo, 'windows' | 'seed'>): WindowPlan[] {
  return info.windows.map((span, si) => {
    const n = sideNormal(span.side);
    const along: 'x' | 'z' = n[0] === 0 ? 'x' : 'z';
    const a0 = along === 'x' ? span.x0 : span.z0, a1 = along === 'x' ? span.x1 : span.z1;
    const c0 = along === 'x' ? span.z0 : span.x0, c1 = along === 'x' ? span.z1 : span.x1;
    const out = n[0] + n[1]; // +1: exterior toward +cross, -1: toward -cross
    const inner = out > 0 ? c0 : c1;
    const thick = Math.max(0.05, c1 - c0);
    const glass = inner + out * Math.min(thick * 0.55, thick - 0.03);
    const [y0, y1] = windowYs(span);
    const len = a1 - a0;
    const count = Math.max(1, Math.round(len / 1.5));
    const mullions = Array.from({length: count - 1}, (_, i) => a0 + len * (i + 1) / count);
    const entrance = span.kind === 'entrance';
    const transom = !entrance && y1 - y0 > 2.1 ? y0 + (y1 - y0) * 0.74 : null;
    const panes: PanePlan[] = [];
    for (let i = 0; i < count; i++) {
      const pa0 = a0 + len * i / count, pa1 = a0 + len * (i + 1) / count;
      const r = hash01(info.seed, si * 131 + 7, i);
      // the whole column shares boarded / broken; cracked varies per pane
      // the lobby's street doors are boarded shut (WORLD-GEN kind 'entrance')
      const col: PaneState = entrance || r < 0.09 ? 'boarded' : r < 0.21 ? 'broken' : 'intact';
      const rows: [number, number][] = transom === null ? [[y0, y1]] : [[y0, transom], [transom, y1]];
      rows.forEach(([py0, py1], j) => {
        const rc = hash01(info.seed, si * 131 + 11, i * 7 + j);
        const state: PaneState = col !== 'intact' ? col : rc < 0.42 ? 'cracked' : 'intact';
        panes.push({a0: pa0, a1: pa1, y0: py0, y1: py1, state, seed: Math.floor(rc * 1e6), col: i, row: j});
      });
    }
    // collider: the span box, at least 0.35 m thick, extended outward (never into the room)
    const cMin = out > 0 ? inner : Math.min(c0, inner - 0.35), cMax = out > 0 ? Math.max(c1, inner + 0.35) : inner;
    const collider: Rect2 = along === 'x' ? {x0: a0, x1: a1, z0: cMin, z1: cMax} : {x0: cMin, x1: cMax, z0: a0, z1: a1};
    return {index: si, span, level: span.level, baseY: span.baseY, n, along, a0, a1, glass, inner, y0, y1, mullions, transom, panes, collider};
  });
}

/** Task gasmask-breach-20261030: a pane's stable identity `level:span:column:row` (deterministic per office seed). */
export function paneId(p: WindowPlan, pane: PanePlan): string {
  return `${p.level}:${p.index}:${pane.col}:${pane.row}`;
}

/**
 * Task gasmask-breach-20261030: bullets can crack and break this pane — an exterior window (not the lobby's boarded street
 * entrance) generated intact or cracked. Generated broken / boarded panes are inert.
 */
export function paneBreakable(p: WindowPlan, pane: PanePlan): boolean {
  return (p.span.kind ?? 'window') === 'window' && (pane.state === 'intact' || pane.state === 'cracked');
}

// ---------------------------------------------------------------------------------------------
// Materials (module singletons: shared across floors, never disposed)

let crackedTex: THREE.Texture | null = null;
/** Procedural cracked, dusty glass (RGBA: alpha = dirt + crack density) — the fallback for ASSETS' T6 window-glass. */
export function crackedGlassTexture(): THREE.Texture {
  return (crackedTex ??= canvasTexture(512, 512, 16029, (ctx, w, h, rnd) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(205, 214, 210, 0.16)'; ctx.fillRect(0, 0, w, h);
    // dust bands and drips
    for (let i = 0; i < 26; i++) {
      const x = rnd() * w, y = rnd() * h, r = 30 + rnd() * 110;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(150, 140, 120, ${0.18 + rnd() * 0.22})`); g.addColorStop(1, 'rgba(150, 140, 120, 0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = 'rgba(120, 112, 96, 0.35)'; ctx.fillRect(0, h * 0.86, w, h * 0.14);
    // impact stars: radial cracks + a few concentric rings
    ctx.lineCap = 'round';
    for (let k = 0; k < 3; k++) {
      const cx = w * (0.2 + rnd() * 0.6), cy = h * (0.2 + rnd() * 0.6);
      ctx.strokeStyle = 'rgba(235, 242, 240, 0.75)';
      for (let a = 0; a < 11; a++) {
        let x = cx, y = cy, ang = (a / 11) * Math.PI * 2 + rnd() * 0.4;
        ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(x, y);
        const len = 60 + rnd() * 220;
        for (let s = 0; s < len; s += 14) { ang += (rnd() - 0.5) * 0.35; x += Math.cos(ang) * 14; y += Math.sin(ang) * 14; ctx.lineTo(x, y); }
        ctx.stroke();
      }
      for (let ring = 1; ring <= 2; ring++) {
        ctx.lineWidth = 1; ctx.beginPath();
        const rr = ring * (18 + rnd() * 16);
        for (let a = 0; a <= 12; a++) { const t = a / 12 * Math.PI * 2; const q = rr * (0.85 + rnd() * 0.3); if (a === 0) ctx.moveTo(cx + Math.cos(t) * q, cy + Math.sin(t) * q); else ctx.lineTo(cx + Math.cos(t) * q, cy + Math.sin(t) * q); }
        ctx.stroke();
      }
    }
  }));
}

const glassMats = new Map<THREE.Texture, SurfaceNodeMaterial>();
/** Cracked pane material for a glass texture (T6 when delivered, else the procedural one). */
export function crackedGlassMaterial(tex: THREE.Texture | null): SurfaceNodeMaterial {
  const t = tex ?? crackedGlassTexture();
  let m = glassMats.get(t);
  if (!m) {
    // Task office-overhaul-20261030 (lane ARCH): a faint green-grey cast (the murk outside), was 0xdfe6e4
    m = worldMapped(new SurfaceNodeMaterial({map: t, color: 0xd3ddcf, transparent: true, opacity: 0.85, depthWrite: false, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide}), {span: [1.6, 1.6], macro: 0.08});
    m.name = 'tower-glass-cracked';
    tagReflect(m, 'window'); // task studio-baked-lighting-reflections-20261114-050258-01: a pane shows the cached reflection probes (set inside its wall: read a cell out)
    glassMats.set(t, m);
  }
  return m;
}

const officeGlass = new WeakMap<WorldMaterials, THREE.Material>();
/**
 * Task office-overhaul-20261030 (lane ARCH): the tower's intact panes — the shop glazing (its maps and values) with a
 * faint green-grey cast from the infected murk outside. Its own copy: the station's shop glass is untouched. (Its reflect tag is
 * 'window', not the shop glazing's 'glass': a tag is part of three's program key, so the two no longer share one program.)
 */
export function officeGlassMaterial(mats: WorldMaterials): THREE.Material {
  let m = officeGlass.get(mats);
  if (!m) {
    const c = cloneSurfaceMaterial(shapeMaterial(mats, 'glassShopfront') as SurfaceNodeMaterial);
    c.color.setHex(0xcbd9c4);
    c.name = 'tower-window-glass-office';
    tagReflect(c, 'window'); // the pane sits inside its wall's own cell: its reflection reads the room a cell out (world/reflectionNode.ts)
    officeGlass.set(mats, (m = c));
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// three.js

/** Task gasmask-breach-20261030: what a breakable pane shows. */
export type PaneLook = 'intact' | 'cracked' | 'broken';

/** Vertex range of one pane look inside a merged storey mesh (`base`: the mesh's uncollapsed positions). */
interface LookRange { attr: THREE.BufferAttribute; base: Float32Array; start: number; count: number }

/** Task gasmask-breach-20261030: the pre-built looks of one breakable pane and the one shown. */
export interface PaneView { looks: Partial<Record<PaneLook, LookRange>>; look: PaneLook }

export interface WindowView {
  root: THREE.Group;
  /** Intact + cracked glass meshes (shown through by the exterior). */
  glass: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  /** Material of the cracked panes (its map is swapped to T6 when the texture arrives late). */
  cracked: SurfaceNodeMaterial | null;
  /** Task gasmask-breach-20261030: every breakable pane by paneId (setPaneLook). */
  panes: Map<string, PaneView>;
}

/**
 * Task gasmask-breach-20261030: show `look` on a breakable pane (the other looks collapse). Rewrites only that pane's vertex
 * ranges (partial buffer upload). False when the pane has no such look or already shows it.
 */
export function setPaneLook(view: WindowView, id: string, look: PaneLook): boolean {
  const p = view.panes.get(id);
  if (!p || p.look === look || !p.looks[look]) return false;
  for (const k of ['intact', 'cracked', 'broken'] as const) { const r = p.looks[k]; if (r) shapeLook(r, k === look, true); }
  p.look = look;
  return true;
}

/** Restore a look's positions (show) or collapse them onto its first vertex (zero-area: nothing is drawn). */
function shapeLook(r: LookRange, show: boolean, upload: boolean): void {
  const a = r.attr.array as Float32Array, s = r.start * 3, e = (r.start + r.count) * 3;
  if (show) a.set(r.base.subarray(s, e), s);
  else for (let i = s; i < e; i += 3) { a[i] = r.base[s]; a[i + 1] = r.base[s + 1]; a[i + 2] = r.base[s + 2]; }
  if (!upload) return;
  r.attr.addUpdateRange(s, e - s);
  r.attr.needsUpdate = true;
}

/** World-space quad facing `facing` (unit x, z) in the vertical plane. */
function paneQuad(p: WindowPlan, a0: number, a1: number, y0: number, y1: number, facing: [number, number], off = 0): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(a1 - a0, y1 - y0);
  // PlaneGeometry faces +z; rotate so its normal = facing
  g.rotateY(Math.atan2(facing[0], facing[1]));
  const ac = (a0 + a1) / 2, c = p.glass + off;
  if (p.along === 'x') g.translate(ac, (y0 + y1) / 2, c); else g.translate(c, (y0 + y1) / 2, ac);
  return g;
}

/** Axis box in plan coordinates: along range, cross range, y range. */
function planBox(p: WindowPlan, a0: number, a1: number, c0: number, c1: number, y0: number, y1: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(p.along === 'x' ? a1 - a0 : Math.abs(c1 - c0), y1 - y0, p.along === 'x' ? Math.abs(c1 - c0) : a1 - a0);
  const ac = (a0 + a1) / 2, cc = (c0 + c1) / 2;
  if (p.along === 'x') g.translate(ac, (y0 + y1) / 2, cc); else g.translate(cc, (y0 + y1) / 2, ac);
  return g;
}

/** Jagged shards left in a broken pane's frame (triangles along the edges). */
function shards(p: WindowPlan, pane: PanePlan, facing: [number, number]): THREE.BufferGeometry | null {
  const rnd = mulberry32(pane.seed ^ 0x51ed);
  const pos: number[] = [];
  const P = (a: number, y: number): [number, number, number] => (p.along === 'x' ? [a, y, p.glass] : [p.glass, y, a]);
  const push = (a: [number, number, number], b: [number, number, number], c: [number, number, number]) => {
    // wind so the face normal points along `facing`
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy, nz = ux * vy - uy * vx;
    if (nx * facing[0] + nz * facing[1] < 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c);
  };
  const w = pane.a1 - pane.a0, h = pane.y1 - pane.y0;
  // bottom edge teeth
  const teeth = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < teeth; i++) {
    const s0 = pane.a0 + w * (i / teeth), s1 = pane.a0 + w * ((i + 1) / teeth), tip = s0 + (s1 - s0) * (0.3 + rnd() * 0.4);
    push(P(s0, pane.y0), P(s1, pane.y0), P(tip, pane.y0 + h * (0.08 + rnd() * 0.3)));
  }
  // a top corner shard and a side sliver
  if (rnd() < 0.7) push(P(pane.a1, pane.y1), P(pane.a1 - w * (0.2 + rnd() * 0.3), pane.y1), P(pane.a1, pane.y1 - h * (0.2 + rnd() * 0.35)));
  if (rnd() < 0.5) push(P(pane.a0, pane.y1), P(pane.a0, pane.y1 - h * (0.3 + rnd() * 0.4)), P(pane.a0 + w * (0.06 + rnd() * 0.1), pane.y1 - h * 0.15));
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  // uv = (along, y) in metres (the world-mapped material ignores it, but keeps the attribute layout of the quads)
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(p.along === 'x' ? pos[i] : pos[i + 2], pos[i + 1]);
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

/** A part to merge; `tag` (`paneId|look`) records its vertex range in the merged geometry. */
interface Part { g: THREE.BufferGeometry; tag?: string }

function mergeAll(parts: readonly Part[], ranges?: Map<string, [number, number]>): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  // quads / boxes are indexed, shards are not: merge them all non-indexed when mixed
  const mixed = parts.some(p => p.g.index) && parts.some(p => !p.g.index);
  const src = mixed ? parts.map(p => (p.g.index ? p.g.toNonIndexed() : p.g)) : parts.map(p => p.g);
  // vertex ranges in merge order (mergeGeometries concatenates the attributes; indexed parts keep their own vertices)
  let at = 0;
  src.forEach((g, i) => { const n = g.getAttribute('position').count; const tag = parts[i].tag; if (tag) ranges?.set(tag, [at, n]); at += n; });
  if (src.length === 1) { if (src[0] !== parts[0].g) parts[0].g.dispose(); return src[0]; }
  const m = mergeGeometries(src, false);
  for (const p of new Set([...parts.map(q => q.g), ...src])) if (p !== m) p.dispose();
  if (!m) throw new Error('tower windows: incompatible pane geometries');
  return m;
}

/** Builds glass, frames, sills and boards for every planned span (merged per material). */
export function buildWindows(plans: readonly WindowPlan[], mats: WorldMaterials, glassTex: THREE.Texture | null): WindowView {
  const root = new THREE.Group(); root.name = 'tower-windows';
  const geometries: THREE.BufferGeometry[] = [];
  const glass: THREE.Mesh[] = [], meshes: THREE.Mesh[] = [];
  const panes = new Map<string, PaneView>();
  let cracked: SurfaceNodeMaterial | null = null;
  // merged per storey (culling) and material
  const byLevel = new Map<number, WindowPlan[]>();
  for (const p of plans) { let l = byLevel.get(p.level); if (!l) byLevel.set(p.level, (l = [])); l.push(p); }
  for (const [level, list] of byLevel) cracked = buildStorey(list, mats, glassTex, level, geometries, glass, meshes, panes) ?? cracked;
  for (const m of meshes) root.add(m);
  return {root, glass, geometries, cracked, panes};
}

/** One storey's windows, merged per material (meshes tagged with the storey). Returns the cracked-glass material if used. */
function buildStorey(plans: readonly WindowPlan[], mats: WorldMaterials, glassTex: THREE.Texture | null, level: number, geometries: THREE.BufferGeometry[], glass: THREE.Mesh[], meshes: THREE.Mesh[], panes: Map<string, PaneView>): SurfaceNodeMaterial | null {
  const intact: Part[] = [], crackedParts: Part[] = [], frames: Part[] = [], sills: Part[] = [], boards: Part[] = [];
  for (const p of plans) {
    const facing: [number, number] = [-p.n[0], -p.n[1]]; // glass faces the room
    const out = p.n[0] + p.n[1];
    const fd = 0.07, fwid = 0.06; // frame depth across the wall, frame width
    const g0 = p.glass - fd / 2, g1 = p.glass + fd / 2;
    // outer frame + mullions + transom
    const frame = (a0: number, a1: number, y0: number, y1: number) => frames.push({g: planBox(p, a0, a1, g0, g1, y0, y1)});
    frame(p.a0, p.a1, p.y0, p.y0 + fwid);
    frame(p.a0, p.a1, p.y1 - fwid, p.y1);
    frame(p.a0, p.a0 + fwid, p.y0, p.y1);
    frame(p.a1 - fwid, p.a1, p.y0, p.y1);
    for (const m of p.mullions) frame(m - fwid / 2, m + fwid / 2, p.y0, p.y1);
    if (p.transom !== null) frame(p.a0, p.a1, p.transom - fwid / 2, p.transom + fwid / 2);
    // interior sill board (laminate ledge proud of the wall face)
    const s0 = p.inner - out * 0.02, s1 = p.inner - out * 0.2;
    sills.push({g: planBox(p, p.a0 - 0.05, p.a1 + 0.05, Math.min(s0, s1), Math.max(s0, s1), p.y0 - 0.035, p.y0)});
    for (const pane of p.panes) {
      const ia0 = pane.a0 + fwid / 2, ia1 = pane.a1 - fwid / 2, iy0 = pane.y0 + fwid / 2, iy1 = pane.y1 - fwid / 2;
      if (ia1 <= ia0 + 0.05 || iy1 <= iy0 + 0.05) continue;
      if (paneBreakable(p, pane)) {
        // task gasmask-breach-20261030: every look of a breakable pane (generated cracked: no intact look); the current one
        // is the generated state, the others are collapsed once merged
        const id = paneId(p, pane);
        panes.set(id, {looks: {}, look: pane.state === 'cracked' ? 'cracked' : 'intact'});
        if (pane.state === 'intact') intact.push({g: paneQuad(p, ia0, ia1, iy0, iy1, facing), tag: `${id}|intact`});
        crackedParts.push({g: paneQuad(p, ia0, ia1, iy0, iy1, facing), tag: `${id}|cracked`});
        const s = shards(p, {...pane, a0: ia0, a1: ia1, y0: iy0, y1: iy1}, facing);
        if (s) crackedParts.push({g: s, tag: `${id}|broken`});
      } else if (pane.state === 'intact') intact.push({g: paneQuad(p, ia0, ia1, iy0, iy1, facing)});
      else if (pane.state === 'cracked') crackedParts.push({g: paneQuad(p, ia0, ia1, iy0, iy1, facing)});
      else if (pane.state === 'broken') { const s = shards(p, {...pane, a0: ia0, a1: ia1, y0: iy0, y1: iy1}, facing); if (s) crackedParts.push({g: s}); }
      else {
        // boarded: plywood planks on the room side, slightly askew (the pane behind is gone)
        const rnd = mulberry32(pane.seed ^ 0xb0a2d);
        // ~1 plank per 0.34 m of height (narrow gaps show the street through them), a little irregular
        const nb = Math.max(3, Math.round((pane.y1 - pane.y0) / 0.34)) - (rnd() < 0.3 ? 1 : 0);
        const bc0 = p.inner - out * 0.01, bc1 = p.inner - out * 0.035;
        for (let k = 0; k < nb; k++) {
          const yc = pane.y0 + (pane.y1 - pane.y0) * ((k + 0.5) / nb) + (rnd() - 0.5) * 0.08;
          const b = planBox(p, pane.a0 - 0.08, pane.a1 + 0.08, Math.min(bc0, bc1), Math.max(bc0, bc1), yc - 0.11, yc + 0.11);
          const tilt = (rnd() - 0.5) * 0.16;
          const ac = (pane.a0 + pane.a1) / 2, cc = (bc0 + bc1) / 2;
          // rotate about the board's own centre around the wall normal
          const m = new THREE.Matrix4().makeTranslation(p.along === 'x' ? ac : cc, yc, p.along === 'x' ? cc : ac)
            .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(p.n[0], 0, p.n[1]), tilt))
            .multiply(new THREE.Matrix4().makeTranslation(-(p.along === 'x' ? ac : cc), -yc, -(p.along === 'x' ? cc : ac)));
          b.applyMatrix4(m);
          boards.push({g: b});
        }
      }
    }
  }
  const mk = (parts: Part[], mat: THREE.Material, name: string, isGlass = false): void => {
    const ranges = new Map<string, [number, number]>();
    const g = mergeAll(parts, ranges);
    if (!g) return;
    geometries.push(g);
    if (ranges.size) {
      // task gasmask-breach-20261030: bounds of every look (culling never misses a look shown later), then all but the
      // current look of each pane collapse (before the first upload)
      g.computeBoundingBox();
      g.computeBoundingSphere();
      const attr = g.getAttribute('position') as THREE.BufferAttribute;
      const base = (attr.array as Float32Array).slice();
      for (const [tag, [start, count]] of ranges) {
        const [id, look] = tag.split('|') as [string, PaneLook];
        const pv = panes.get(id)!;
        const r: LookRange = {attr, base, start, count};
        pv.looks[look] = r;
        if (look !== pv.look) shapeLook(r, false, false);
      }
    }
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    m.userData.level = level;
    // glass first among the transparents: every other transparent (tube glow, particles, decals) is inside the room,
    // in front of it, and must blend over it
    if (isGlass) { m.renderOrder = -1; glass.push(m); }
    meshes.push(m);
  };
  const cracked = crackedParts.length ? crackedGlassMaterial(glassTex) : null;
  mk(frames, shapeMaterial(mats, 'shopFrame'), 'tower-window-frames');
  mk(sills, shapeMaterial(mats, 'laminate'), 'tower-window-sills');
  mk(boards, shapeMaterial(mats, 'wood'), 'tower-window-boards');
  mk(intact, officeGlassMaterial(mats), 'tower-window-glass', true);
  if (cracked) mk(crackedParts, cracked, 'tower-window-glass-cracked', true);
  return cracked;
}
