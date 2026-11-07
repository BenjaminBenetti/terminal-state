// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): the GLAZED BRIDGE ROOFS of layout version 3 — every bridge with a
// `roof` record (gen/skyways/carve.ts bridgeRoofOf: style, springing / apex y, rib spacing) gets a glass tube over its deck in its own
// cross-section (the reference: a faceted / vaulted glass skybridge with steel ribs every ~1.5-2 m, purlins, city views):
//  - 'vault': a smooth barrel (an elliptical arch in VAULT_K segments); 'faceted': a polygonal tube (FACET_K flat facets, fuller
//    shoulders); 'gable': a pitched glass roof (two slopes and a ridge); 'flat': a near-flat glass roof on deep transverse beams;
//  - the springing line = the side glazing's head (the GAS lane's spans stop there): the roof spans the deck between the inner faces
//    of its side walls, from springY up to apexY (the deck area's ceiling, which the builder no longer draws: SkywaysArch.ceilKey);
//  - steel: a RIB at every `rib` m (both ends included: round(length / rib) bays), each rib following the profile under the glass, a
//    gusset knee brace + foot at both springings; longitudinal PURLINS at every facet joint (and the pane joints of long facets); a
//    wall plate / gutter on top of each side wall (covers the wall cells' tops); the vault / faceted tubes take a light putty-grey
//    paint (the reference), the gable / flat roofs the pedway's dark steel;
//  - glass: one pane per bay per facet (long facets split), uv laid so the glass program's bars fall on the ribs and the joints; an
//    INTACT roof glass (grime and haze, no open panes: in Skyways only a BREACHED span looks broken — the GAS lane's rule) and, over a
//    breached bridge, the mall roof glass with its few open panes (gas already flows across that bridge);
//  - budget: ONE glass mesh + ONE steel mesh per bridge (merged; frustum-culled per bridge), tagged with the skyway storey for the
//    level culler; the glass is transparent, depth-writing and never a shadow caster. Bridges without `roof` (layout v1 / v2) get none.
// Pure plan (bridgeRoofPlan / bridgeRoofProfile: tests) + the three.js build (buildBridgeRoofs).

import * as THREE from 'three';
import {MeshBasicNodeMaterial} from 'three/webgpu';
import {abs, cameraPosition, clamp, dot, float, floor, fract, max, min, mix, normalWorld, normalize, positionWorld, smoothstep, uv, vec2, vec3} from 'three/tsl';
import {CELL} from '../gen/grid';
import type {SkywaysBridge, SkywaysBridgeRoof} from '../gen/skyways/skywaysTypes';
import {hazeSat} from './mallExterior';
import {wmHash} from './surfaceNodes';
import {Quads} from './skywaysArch';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/** Profile segments per style. */
export const VAULT_K = 10, FACET_K = 6;
/** Steel sizes (m): rib (along x depth under the glass), purlin, wall plate, knee brace. */
export const BRIDGE_ROOF_STEEL = {ribW: 0.1, ribD: 0.16, purlin: 0.07, purlinD: 0.09, plateW: 0.12, plateH: 0.18, brace: 0.07, braceDrop: 0.55, braceRun: 0.45} as const;
/** Longest glass pane across a facet before it is split by a purlin (m). */
export const BRIDGE_PANE_MAX = 1.4;
/** Light putty-grey roof steel (sRGB): the faceted / vaulted tubes; the gable / flat roofs take the pedway's dark steel. */
export const BRIDGE_STEEL_LIGHT = 0x9a988f;

export interface RoofPoint { a: number; y: number }

/** A bridge roof's plan: axis, along / across ranges (the deck), heights, profile points, rib positions, purlin points. */
export interface BridgeRoofPlan {
  bridge: string;
  style: SkywaysBridgeRoof['style'];
  alongX: boolean;
  l0: number; l1: number; a0: number; a1: number;
  springY: number; apexY: number;
  /** Profile from (a0, springY) over the apex to (a1, springY). */
  profile: RoofPoint[];
  /** Rib positions along the bridge (both ends included). */
  ribs: number[];
  /** Pane joints across: per profile segment k, its sub-pane split count. */
  split: number[];
  breached: boolean;
}

/** The cross-section of a style between the deck's inner faces (absolute across coordinate + y). */
export function bridgeRoofProfile(style: SkywaysBridgeRoof['style'], a0: number, a1: number, springY: number, apexY: number): RoofPoint[] {
  const mid = (a0 + a1) / 2, half = (a1 - a0) / 2, rise = Math.max(0.05, apexY - springY);
  if (style === 'gable' || style === 'flat') return [{a: a0, y: springY}, {a: mid, y: apexY}, {a: a1, y: springY}];
  const K = style === 'vault' ? VAULT_K : FACET_K;
  // the faceted tube: a superellipse (fuller shoulders: steep lower facets, a flatter crown, the reference's polygonal glass tube)
  const e = style === 'vault' ? 1 : 0.72;
  const out: RoofPoint[] = [];
  for (let k = 0; k <= K; k++) {
    const th = Math.PI * k / K, c = Math.cos(th), s = Math.sin(th);
    out.push({a: mid - Math.sign(c) * Math.pow(Math.abs(c), e) * half, y: springY + Math.pow(Math.max(0, s), e) * rise});
  }
  out[0] = {a: a0, y: springY}; out[K] = {a: a1, y: springY};
  return out;
}

/** The plan of one bridge's roof (null: no `roof` record — layout v1 / v2 — or a degenerate deck). */
export function bridgeRoofPlan(b: Pick<SkywaysBridge, 'id' | 'axis' | 'rect' | 'roof' | 'breached'>): BridgeRoofPlan | null {
  const r = b.roof;
  if (!r) return null;
  const alongX = b.axis === 'x';
  const l0 = alongX ? b.rect.x0 : b.rect.z0, l1 = alongX ? b.rect.x1 : b.rect.z1;
  const a0 = alongX ? b.rect.z0 : b.rect.x0, a1 = alongX ? b.rect.z1 : b.rect.x1;
  if (l1 - l0 < 1 || a1 - a0 < 1 || !(r.apexY > r.springY)) return null;
  const profile = bridgeRoofProfile(r.style, a0, a1, r.springY, r.apexY);
  const bays = bridgeRoofBays(l1 - l0, r.rib);
  const ribs = Array.from({length: bays + 1}, (_, i) => l0 + (l1 - l0) * i / bays);
  const split = profile.slice(1).map((p, k) => Math.max(1, Math.round(Math.hypot(p.a - profile[k].a, p.y - profile[k].y) / BRIDGE_PANE_MAX)));
  return {bridge: b.id, style: r.style, alongX, l0, l1, a0, a1, springY: r.springY, apexY: r.apexY, profile, ribs, split, breached: b.breached};
}

/** Bays of a roof of `length` m with ribs every `rib` m (at least one). The rib count = bays + 1. */
export const bridgeRoofBays = (length: number, rib: number): number => Math.max(1, Math.round(length / Math.max(0.5, rib)));

/** Inward unit normal of profile segment k (toward the tube's axis / down). */
function segNormal(p: RoofPoint, q: RoofPoint): {a: number; y: number} {
  const da = q.a - p.a, dy = q.y - p.y, n = Math.hypot(da, dy) || 1;
  // the profile runs a0 -> a1 over the top: the left-hand normal (dy, -da) points into the tube
  return {a: dy / n, y: -da / n};
}

// ---------------------------------------------------------------------------------------------
// three.js

/** One bridge roof's built meshes and counts. */
export interface BridgeRoofStats { bridge: string; style: string; ribs: number; panes: number; purlins: number; meshes: number; triangles: number }

/** Glass + steel of one roof into two Quads. */
export function roofGeometry(p: BridgeRoofPlan, glass: Quads, steel: Quads): {panes: number; purlins: number} {
  const P3 = (l: number, a: number, y: number): [number, number, number] => (p.alongX ? [l, y, a] : [a, y, l]);
  const V = (l: number, a: number, y: number) => new THREE.Vector3(...P3(l, a, y));
  const S = BRIDGE_ROOF_STEEL;
  const ribStep = (p.l1 - p.l0) / (p.ribs.length - 1);
  // --- glass: per bay, per facet, per sub-pane (uv: the bars of the glass program at 1.5 x 1.2 units fall on ribs and joints) ---
  let panes = 0, vRow = 0;
  const joints: RoofPoint[] = [];
  for (let k = 0; k + 1 < p.profile.length; k++) {
    const A = p.profile[k], B = p.profile[k + 1], m = p.split[k];
    const n = segNormal(A, B), out = [-n.a, -n.y];
    for (let j = 0; j < m; j++) {
      const t0 = j / m, t1 = (j + 1) / m;
      const pa = {a: A.a + (B.a - A.a) * t0, y: A.y + (B.y - A.y) * t0}, pb = {a: A.a + (B.a - A.a) * t1, y: A.y + (B.y - A.y) * t1};
      if (j > 0 || k > 0) joints.push(pa);
      for (let i = 0; i + 1 < p.ribs.length; i++) {
        const la = p.ribs[i], lb = p.ribs[i + 1];
        const ua = (la - p.l0) / ribStep * 1.5, ub = (lb - p.l0) / ribStep * 1.5;
        glass.quad([P3(la, pa.a, pa.y), P3(lb, pa.a, pa.y), P3(lb, pb.a, pb.y), P3(la, pb.a, pb.y)], p.alongX ? [0, out[1], out[0]] : [out[0], out[1], 0],
          [[ua, vRow * 1.2], [ub, vRow * 1.2], [ub, (vRow + 1) * 1.2], [ua, (vRow + 1) * 1.2]]);
        panes++;
      }
      vRow++;
    }
  }
  // --- ribs: under the glass along every segment (offset inward by half the rib depth), + knee braces / feet at the springings ---
  for (const l of p.ribs) {
    const lc = Math.min(p.l1 - S.ribW / 2, Math.max(p.l0 + S.ribW / 2, l));
    for (let k = 0; k + 1 < p.profile.length; k++) {
      const A = p.profile[k], B = p.profile[k + 1], n = segNormal(A, B), o = S.ribD / 2 + 0.01;
      // extend each piece a little past its ends so the joints close at the facet knees
      const da = B.a - A.a, dy = B.y - A.y, len = Math.hypot(da, dy) || 1, ext = Math.min(0.06, len * 0.1);
      steel.beam(V(lc, A.a + n.a * o - da / len * ext, A.y + n.y * o - dy / len * ext), V(lc, B.a + n.a * o + da / len * ext, B.y + n.y * o + dy / len * ext), S.ribW, S.ribD);
    }
    for (const side of [0, 1] as const) {
      const sg = side === 0 ? 1 : -1, wall = side === 0 ? p.a0 : p.a1;
      const foot = {a: wall + sg * 0.05, y: p.springY - S.braceDrop};
      // the brace meets the rib a little up the first / last facet
      const seg = side === 0 ? [p.profile[0], p.profile[1]] : [p.profile[p.profile.length - 1], p.profile[p.profile.length - 2]];
      const t = Math.min(0.9, S.braceRun / (Math.hypot(seg[1].a - seg[0].a, seg[1].y - seg[0].y) || 1));
      const top = {a: seg[0].a + (seg[1].a - seg[0].a) * t, y: seg[0].y + (seg[1].y - seg[0].y) * t - S.ribD * 0.5};
      steel.beam(V(lc, foot.a, foot.y), V(lc, top.a, top.y), S.brace, S.ribW * 0.8);
      steel.beam(V(lc, wall + sg * 0.05, foot.y - 0.05), V(lc, wall + sg * 0.05, p.springY + 0.05), S.brace, S.ribW);
    }
  }
  // --- purlins at every joint (facet knees and pane splits; the ridge on the gable / flat / faceted), inward under the glass ---
  for (const q of joints) {
    let n = {a: 0, y: -1};
    const k = p.profile.findIndex(r => Math.abs(r.a - q.a) < 1e-6 && Math.abs(r.y - q.y) < 1e-6);
    if (k > 0 && k < p.profile.length - 1) { const n0 = segNormal(p.profile[k - 1], p.profile[k]), n1 = segNormal(p.profile[k], p.profile[k + 1]); n = {a: (n0.a + n1.a) / 2, y: (n0.y + n1.y) / 2}; }
    else { const s = p.profile.findIndex((r, i) => i + 1 < p.profile.length && Math.min(r.a, p.profile[i + 1].a) <= q.a + 1e-6 && Math.max(r.a, p.profile[i + 1].a) >= q.a - 1e-6); if (s >= 0) n = segNormal(p.profile[s], p.profile[s + 1]); }
    const nn = Math.hypot(n.a, n.y) || 1, o = S.purlinD / 2 + 0.01;
    steel.beam(V(p.l0, q.a + n.a / nn * o, q.y + n.y / nn * o), V(p.l1, q.a + n.a / nn * o, q.y + n.y / nn * o), S.purlin, S.purlinD);
  }
  // --- wall plates / gutters on the side walls' tops (the wall cells' depth: the builder draws no wall top) ---
  for (const [wall, sg] of [[p.a0, -1], [p.a1, 1]] as const) {
    const ain = wall - sg * 0.1, aout = wall + sg * (CELL + 0.03);
    const amid = (ain + aout) / 2, w = Math.abs(aout - ain);
    const g = new THREE.BoxGeometry(...(p.alongX ? [p.l1 - p.l0, S.plateH, w] : [w, S.plateH, p.l1 - p.l0]) as [number, number, number]);
    const c = P3((p.l0 + p.l1) / 2, amid, p.springY - 0.03 + S.plateH / 2);
    g.translate(c[0], c[1], c[2]);
    steel.add(g);
  }
  return {panes, purlins: joints.length};
}

const glassCache = new Map<string, MeshBasicNodeMaterial>();
/**
 * The bridge roof glass: the mall roof glass program (unlit murk-tinted panes, steel bars on the uv grid, grimy panes, fresnel) —
 * `intact`: no open panes (nothing looks broken where no gas flows); else the mall's ~5 % open panes (a breached bridge).
 */
export function bridgeRoofGlass(intact: boolean): MeshBasicNodeMaterial {
  const key = intact ? 'intact' : 'breached';
  let m = glassCache.get(key);
  if (m) return m;
  m = new MeshBasicNodeMaterial({transparent: true, depthWrite: true, side: THREE.DoubleSide});
  m.name = `skyways-bridge-roof-glass-${key}`;
  const U = (uv() as AnyNode).div(vec2(1.5, 1.2));
  const cell = floor(U) as AnyNode;
  const f = fract(U) as AnyNode;
  const e = min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus()));
  const bar = float(1).sub(smoothstep(0.018, 0.035, e));
  const r = wmHash(vec3(cell.x, cell.y, 67)) as AnyNode;
  const open = intact ? float(0) : float(1).sub(smoothstep(0.049, 0.051, r));
  const grime = smoothstep(0.5, 0.95, r).mul(0.36);
  const v = normalize(cameraPosition.sub(positionWorld) as AnyNode);
  const fres = float(1).sub(abs(dot(normalize(normalWorld as AnyNode), v))).pow(3);
  const murk = hazeSat() as AnyNode;
  const pane = mix(murk.mul(1.7), murk.mul(1.05), grime.mul(2.2));
  m.colorNode = mix(pane, vec3(0.62, 0.64, 0.6), bar);
  m.opacityNode = clamp(max(bar.mul(0.96), float(0.12).add(grime).add(fres.mul(0.3)).mul(float(1).sub(open))), 0, 1);
  m.userData.skywaysGlass = 'bridge-roof';
  glassCache.set(key, m);
  return m;
}

/** Builds every roofed bridge's glass + steel into `group` (one glass + one steel mesh per bridge). Returns per-bridge stats. */
export function buildBridgeRoofs(group: THREE.Group, bridges: readonly SkywaysBridge[], steelOf: (light: boolean) => THREE.Material, levels: readonly number[]): BridgeRoofStats[] {
  const out: BridgeRoofStats[] = [];
  for (const b of bridges) {
    const p = bridgeRoofPlan(b);
    if (!p) continue;
    const glass = new Quads(), steel = new Quads();
    const {panes, purlins} = roofGeometry(p, glass, steel);
    const st: BridgeRoofStats = {bridge: b.id, style: p.style, ribs: p.ribs.length, panes, purlins, meshes: 0, triangles: 0};
    const light = p.style === 'vault' || p.style === 'faceted';
    for (const m of [glass.mesh(bridgeRoofGlass(!p.breached), `skyways-bridge-roof-glass-${b.id}`, levels), steel.mesh(steelOf(light), `skyways-bridge-roof-steel-${b.id}`, levels)]) {
      if (!m) continue;
      m.userData.skywaysBridge = b.id;
      group.add(m);
      st.meshes++;
      st.triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    }
    out.push(st);
  }
  return out;
}

/** The deck's side wall planes of a roofed bridge (the builder's faces above its springing line are not drawn: the roof is there). */
export function roofedSideWalls(bridges: readonly SkywaysBridge[]): {area: number; alongX: boolean; planes: [number, number]; l0: number; l1: number; springY: number}[] {
  return bridges.filter(b => b.roof).map(b => ({area: b.area, alongX: b.axis === 'x', planes: b.axis === 'x' ? [b.rect.z0, b.rect.z1] : [b.rect.x0, b.rect.x1],
    l0: b.axis === 'x' ? b.rect.x0 : b.rect.z0, l1: b.axis === 'x' ? b.rect.x1 : b.rect.z1, springY: b.roof!.springY}));
}
