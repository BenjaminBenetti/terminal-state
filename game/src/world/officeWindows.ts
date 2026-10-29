// Iteration 16 (lane TOWER): office windows — glass panes in WORLD-GEN's perimeter wall openings
// (layout.office.windows), with frames, mullions, transoms, an interior sill, some panes cracked (lane ASSETS' T6
// window-glass texture, or a procedural cracked-glass fallback), some broken out (jagged shards left in the frame) and
// some boarded up. Collision: the window cells are solid in the grid; every span also gets a collision box that the
// runtime enforces on the player and enemies (a broken pane is never a way out).
// Transparency follows the storefront glass rules (world/shapeMaterials 'glassShopfront'): transparent, depthWrite off
// — the fog march / composite read the depth BEHIND the glass (the exterior), exactly like the existing shop glazing.

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';
import {mulberry32} from '../core/rng';
import {canvasTexture} from './canvasTextures';
import {SurfaceNodeMaterial, worldMapped, type WorldMaterials} from './materials';
import {shapeMaterial} from './shapeMaterials';
import {hash01, sideNormal, windowYs, type Rect2, type TowerInfo, type WindowSpan} from './towerShared';

export type PaneState = 'intact' | 'cracked' | 'broken' | 'boarded';

export interface PanePlan { a0: number; a1: number; y0: number; y1: number; state: PaneState; seed: number }

export interface WindowPlan {
  span: WindowSpan;
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

/** Plans every window span of a section: panes, states, frames, colliders (deterministic per section seed). */
export function planWindows(info: TowerInfo): WindowPlan[] {
  return info.windows.map((span, si) => {
    const n = sideNormal(span.side);
    const along: 'x' | 'z' = n[0] === 0 ? 'x' : 'z';
    const a0 = along === 'x' ? span.x0 : span.z0, a1 = along === 'x' ? span.x1 : span.z1;
    const c0 = along === 'x' ? span.z0 : span.x0, c1 = along === 'x' ? span.z1 : span.x1;
    const out = n[0] + n[1]; // +1: exterior toward +cross, -1: toward -cross
    const inner = out > 0 ? c0 : c1;
    const thick = Math.max(0.05, c1 - c0);
    const glass = inner + out * Math.min(thick * 0.55, thick - 0.03);
    const [y0, y1] = windowYs(span, info.baseY);
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
        panes.push({a0: pa0, a1: pa1, y0: py0, y1: py1, state, seed: Math.floor(rc * 1e6)});
      });
    }
    // collider: the span box, at least 0.35 m thick, extended outward (never into the room)
    const cMin = out > 0 ? inner : Math.min(c0, inner - 0.35), cMax = out > 0 ? Math.max(c1, inner + 0.35) : inner;
    const collider: Rect2 = along === 'x' ? {x0: a0, x1: a1, z0: cMin, z1: cMax} : {x0: cMin, x1: cMax, z0: a0, z1: a1};
    return {span, n, along, a0, a1, glass, inner, y0, y1, mullions, transom, panes, collider};
  });
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
    m = worldMapped(new SurfaceNodeMaterial({map: t, color: 0xdfe6e4, transparent: true, opacity: 0.85, depthWrite: false, roughness: 0.3, metalness: 0.1, side: THREE.DoubleSide}), {span: [1.6, 1.6], macro: 0.08});
    m.name = 'tower-glass-cracked';
    glassMats.set(t, m);
  }
  return m;
}

// ---------------------------------------------------------------------------------------------
// three.js

export interface WindowView {
  root: THREE.Group;
  /** Intact + cracked glass meshes (shown through by the exterior). */
  glass: THREE.Mesh[];
  geometries: THREE.BufferGeometry[];
  /** Material of the cracked panes (its map is swapped to T6 when the texture arrives late). */
  cracked: SurfaceNodeMaterial | null;
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

function mergeAll(parts: THREE.BufferGeometry[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  // quads / boxes are indexed, shards are not: merge them all non-indexed when mixed
  const mixed = parts.some(p => p.index) && parts.some(p => !p.index);
  const src = mixed ? parts.map(p => (p.index ? p.toNonIndexed() : p)) : parts;
  const m = mergeGeometries(src, false);
  for (const p of new Set([...parts, ...src])) if (p !== m) p.dispose();
  if (!m) throw new Error('tower windows: incompatible pane geometries');
  return m;
}

/** Builds glass, frames, sills and boards for every planned span (merged per material). */
export function buildWindows(plans: readonly WindowPlan[], mats: WorldMaterials, glassTex: THREE.Texture | null): WindowView {
  const root = new THREE.Group(); root.name = 'tower-windows';
  const geometries: THREE.BufferGeometry[] = [];
  const intact: THREE.BufferGeometry[] = [], crackedParts: THREE.BufferGeometry[] = [], frames: THREE.BufferGeometry[] = [], sills: THREE.BufferGeometry[] = [], boards: THREE.BufferGeometry[] = [];
  for (const p of plans) {
    const facing: [number, number] = [-p.n[0], -p.n[1]]; // glass faces the room
    const out = p.n[0] + p.n[1];
    const fd = 0.07, fwid = 0.06; // frame depth across the wall, frame width
    const g0 = p.glass - fd / 2, g1 = p.glass + fd / 2;
    // outer frame + mullions + transom
    frames.push(planBox(p, p.a0, p.a1, g0, g1, p.y0, p.y0 + fwid));
    frames.push(planBox(p, p.a0, p.a1, g0, g1, p.y1 - fwid, p.y1));
    frames.push(planBox(p, p.a0, p.a0 + fwid, g0, g1, p.y0, p.y1));
    frames.push(planBox(p, p.a1 - fwid, p.a1, g0, g1, p.y0, p.y1));
    for (const m of p.mullions) frames.push(planBox(p, m - fwid / 2, m + fwid / 2, g0, g1, p.y0, p.y1));
    if (p.transom !== null) frames.push(planBox(p, p.a0, p.a1, g0, g1, p.transom - fwid / 2, p.transom + fwid / 2));
    // interior sill board (laminate ledge proud of the wall face)
    const s0 = p.inner - out * 0.02, s1 = p.inner - out * 0.2;
    sills.push(planBox(p, p.a0 - 0.05, p.a1 + 0.05, Math.min(s0, s1), Math.max(s0, s1), p.y0 - 0.035, p.y0));
    for (const pane of p.panes) {
      const ia0 = pane.a0 + fwid / 2, ia1 = pane.a1 - fwid / 2, iy0 = pane.y0 + fwid / 2, iy1 = pane.y1 - fwid / 2;
      if (ia1 <= ia0 + 0.05 || iy1 <= iy0 + 0.05) continue;
      if (pane.state === 'intact') intact.push(paneQuad(p, ia0, ia1, iy0, iy1, facing));
      else if (pane.state === 'cracked') crackedParts.push(paneQuad(p, ia0, ia1, iy0, iy1, facing));
      else if (pane.state === 'broken') { const s = shards(p, {...pane, a0: ia0, a1: ia1, y0: iy0, y1: iy1}, facing); if (s) crackedParts.push(s); }
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
          boards.push(b);
        }
      }
    }
  }
  const glass: THREE.Mesh[] = [];
  const mk = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string, isGlass = false): void => {
    const g = mergeAll(parts);
    if (!g) return;
    geometries.push(g);
    const m = new THREE.Mesh(g, mat);
    m.name = name;
    // glass first among the transparents: every other transparent (tube glow, particles, decals) is inside the room,
    // in front of it, and must blend over it
    if (isGlass) { m.renderOrder = -1; glass.push(m); }
    root.add(m);
  };
  const cracked = crackedParts.length ? crackedGlassMaterial(glassTex) : null;
  mk(frames, shapeMaterial(mats, 'shopFrame'), 'tower-window-frames');
  mk(sills, shapeMaterial(mats, 'laminate'), 'tower-window-sills');
  mk(boards, shapeMaterial(mats, 'wood'), 'tower-window-boards');
  mk(intact, shapeMaterial(mats, 'glassShopfront'), 'tower-window-glass', true);
  if (cracked) mk(crackedParts, cracked, 'tower-window-glass-cracked', true);
  return {root, glass, geometries, cracked};
}
