// Task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (primary contract; lane PLANT owns the body): THE REACTOR'S
// SURFACE PLANT — a pure, seeded, deterministic plan (no three.js) of the purpose-built ventilation facility round the ONE roof aperture:
// the concrete collar / apron / retaining walls / buttresses / service walkways round the yard and one or two VENT TOWERS carrying the
// Reactor's existing big extraction fans (world/reactor/archAssets.ts REACTOR_MODELS.fanHousing + the procedural 'blade' rotor).
// The city (surfacePlan.ts planSurfaceCity) never builds on `reserved`; the builder (surfacePlant.ts, lane PLANT) draws the plan.
// Contract: everything stands OFF the walkable cells (site.walk) and outside the aperture's keep-off radius (site.hole.keepR), the
// opening stays open (one aperture, the beam unobstructed); nothing here changes the generator, the grid, collision or navigation.
//
// User (2026-11-03): "It should have more concrete structure around the hole to make it sorta seem purpose built. there should be a
// ventilation tower or two, visible, use the existing big fan assets to build this. The fans must spin."
//
// Lane PLANT's design (every piece beyond the plaza's parapet line — lane ENDING's walkable deck reaches the aperture's railing ring:
// its walk boundary lies 8.49..9.0 m from the centre of the 8.4 m opening, so a raised collar on the apron ring would stand on
// walkable cells; the yard is framed from OUTSIDE instead):
//  - THE COMPOUND WALL: buttressed concrete PIERS along every parapet edge (~6 m rhythm), flush with the parapet's inner face and
//    rising above it, each with a raking buttress on the city side — the plaza parapet reads as a heavy purpose-built retaining wall;
//  - TWO VENT TOWERS (one when only one fits) in the ring road just beyond the parapet: the side OPPOSITE the stair head house (the
//    first view when stepping out) and one lateral side, offset off the aperture's axis (never behind the beam from the exit). Each a
//    concrete stack on a plinth with corner pilasters, string courses, a cap and a steel louvred discharge cowl, side intake grilles,
//    and ONE big extraction fan on the face toward the plaza (axis horizontal, the housing's +Z), a steel service platform under it
//    and a caged ladder;
//  - THE DUCT RUN linking each tower to the yard: a concrete PLENUM against the parapet's outer face (an intake grille above the
//    parapet line, facing the plaza) and a steel duct on concrete sleepers into the tower's base.
// Footprints are oriented rects (surfacePlan.ts CityFootprint); the towers / plenums / ducts are `reserved` for the city.

import {mulberry32} from '../../core/rng';
import type {ReactorRect} from '../../gen/reactor/reactorTypes';
import {footprintsOverlap, type CityFootprint} from './surfacePlan';
import type {SurfaceSite} from './surfaceSite';

/** One vent tower: its footprint centre / yaw, the stack's size (m) and its fan (radius, hub world y, axis: 'up' = blowing skyward). */
export interface VentTowerPlan {
  id: number;
  x: number; z: number; yaw: number;
  /** Plinth / stack half extents and height (m above the deck). */
  hw: number; hd: number; h: number;
  fan: {radius: number; hubY: number; axis: 'up' | 'side'};
  /**
   * (lane PLANT) The stack's frame: (x, z) = the STACK's centre, yaw = three.js rotation.y whose local +Z is the fan's facing (toward
   * the plaza); hw / hd = the stack's half extents along local x / z. Which plaza side it stands on (the parapet's outward normal).
   */
  side: {nx: number; nz: number};
  /** World y of the deck / city ground the plinth stands on (site.y). */
  y: number;
  /** The plinth (half extents, height above the deck) under the stack. */
  plinth: {hw: number; hd: number; h: number};
  /** Distance from the stack's front face to the parapet's outer face (the duct run's length, m). */
  reach: number;
  /** The fan's housing scale (REACTOR_MODELS.fanHousing at scale 1 has ring radius 0.7), rotor radius, spin (rev / s at full), phase. */
  fanScale: number;
  bladeR: number;
  rev: number;
  phase: number;
  /** The whole tower's footprint (plinth + fan overhang + the duct run to the parapet): reserved. */
  footprint: CityFootprint;
}

/** A concrete / steel structure of the plant (an oriented box; a buttress is a wedge falling from y1 at its inner end to y1b). */
export interface PlantPart extends CityFootprint {
  kind: 'pier' | 'buttress' | 'plenum' | 'duct' | 'sleeper';
  y0: number;
  y1: number;
  /** Buttress: the top at its outer (local +Z far) end. */
  y1b?: number;
  /** The tower it serves (-1: the compound wall). */
  tower: number;
}

export interface SurfacePlantPlan {
  towers: VentTowerPlan[];
  /** Footprints the city must leave free (towers, plant structures beyond the parapet). */
  reserved: CityFootprint[];
  /** (lane PLANT) The compound wall's piers / buttresses and the duct runs (plenum, duct, sleepers). */
  parts: PlantPart[];
  stats: {towers: number; piers: number; tried: number; why: Record<string, number>};
}

/** The plant's tunables (m, rev / s). */
export const SURFACE_PLANT = {
  /** Towers wanted (fewer when the yard has no room). */
  towers: 2,
  /** The fan's rotor-ring radius (seeded); the stack's width = the housing plate (3.714 x radius) + this margin; its depth; height. */
  fanR: [1.8, 2.0] as readonly [number, number],
  stackMargin: [1.4, 1.8] as readonly [number, number],
  stackD: [6.0, 7.0] as readonly [number, number],
  height: [22, 27] as readonly [number, number],
  /** The fan hub's height above the deck (clamped so the housing clears the duct run and the stack's top). */
  hub: [8.6, 10.2] as readonly [number, number],
  /** Plinth: margin round the stack, height. */
  plinthPad: 1.0, plinthH: 1.0,
  /** The parapet's outer face -> the plinth's front (the duct run; the fan housing overhangs it high up). */
  gap: [4.2, 5.4] as readonly [number, number],
  /** Tower centre offset along its side from the aperture's projection (off the beam's axis). */
  lateral: [9, 15] as readonly [number, number],
  /** Plenum (against the parapet's outer face): half width, depth, height above the deck. Duct: width, height, bottom. */
  plenum: {hw: 2.7, d: 1.7, h: 3.1},
  duct: {w: 3.4, h: 2.2, bottom: 1.15},
  /** Compound wall: pier rhythm (m), width along the edge, depth beyond the parapet, height over the parapet line; buttress length / width. */
  pierEvery: 6, pierW: 0.62, pierOut: 0.42, pierUp: 0.85, buttress: 1.35, buttressW: 0.42,
  /** The lane SURFACE parapet's thickness (surfacePlan.ts SURFACE_CITY.parapetT): the piers' depth starts behind it. */
  parapetT: 0.32,
  /** Inner faces stand this far off the walk boundary (never on a walkable cell). */
  clear: 0.012,
  /** Two towers stand at least this far apart (footprint gap). */
  towerGap: 6,
  /** Rotor speed at full power (rev / s, seeded per tower) and the spin-up time constant (s). */
  rev: [1.0, 1.2] as readonly [number, number],
  spinUpS: 2.6,
} as const;

/** REACTOR_MODELS.fanHousing anchors (archAssets.ts, probed from the cooked GLB): ring radius / height, back flange, blades. */
export const FAN_ANCHORS = {ringR: 0.7, ringY: 1.256, back: -0.679, bladeZ: 0.14, bladeR: 0.66, plateW: 2.6, plateH: 2.5124, depth: 1.3571} as const;

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Local (lx, lz) of a frame (x, z, yaw) -> world (three.js rotation.y). */
export const plantLocal = (f: {x: number; z: number; yaw: number}, lx: number, lz: number): [number, number] => {
  const c = Math.cos(f.yaw), s = Math.sin(f.yaw);
  return [f.x + lx * c + lz * s, f.z - lx * s + lz * c];
};

/** A footprint vs a rect grown by `pad` (true = overlapping by more than `eps`). */
const hitsRect = (p: CityFootprint, r: ReactorRect, pad = 0, eps = 0.001) =>
  footprintsOverlap(p, {x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, yaw: 0, hw: (r.x1 - r.x0) / 2 + pad, hd: (r.z1 - r.z0) / 2 + pad}, eps);

/** On (overlapping) any walkable cell rect. */
export const plantOnWalk = (site: Pick<SurfaceSite, 'walk'>, p: CityFootprint, pad = 0): boolean => site.walk.some(w => hitsRect(p, w, pad));

type Side = {nx: number; nz: number};
const SIDES: readonly Side[] = [{nx: -1, nz: 0}, {nx: 1, nz: 0}, {nx: 0, nz: -1}, {nx: 0, nz: 1}];
const sideKey = (s: Side) => `${s.nx},${s.nz}`;

/**
 * Plan the plant (same inputs, same plan). `pit` (the pit's roof rect) is unused by the placement (the plaza edges already enclose it)
 * and kept for the contract's signature.
 */
export function planSurfacePlant(site: SurfaceSite, seed: number, _pit?: ReactorRect): SurfacePlantPlan {
  const P = SURFACE_PLANT, rnd = mulberry32((seed ^ 0x9a17e5) >>> 0);
  const between = (a: readonly [number, number]) => a[0] + (a[1] - a[0]) * rnd();
  const why: Record<string, number> = {};
  const no = (k: string): null => { why[k] = (why[k] ?? 0) + 1; return null; };
  const B = site.bounds, h = site.hole, y = site.y, T = P.parapetT;
  const towers: VentTowerPlan[] = [];
  const parts: PlantPart[] = [];
  let tried = 0;
  // --- which side is the exit's (the stair head house): the towers face it / flank it, never stand on it ---
  const outward = (s: Side, x: number, z: number) => (s.nx ? (s.nx > 0 ? x - B.x1 : B.x0 - x) : (s.nz > 0 ? z - B.z1 : B.z0 - z));
  const sh = site.shelters[0]?.rect;
  const exitSide = sh ? SIDES.reduce((a, s) => (outward(s, (sh.x0 + sh.x1) / 2, (sh.z0 + sh.z1) / 2) > outward(a, (sh.x0 + sh.x1) / 2, (sh.z0 + sh.z1) / 2) ? s : a)) : null;
  const opposite = exitSide ? SIDES.find(s => s.nx === -exitSide.nx && s.nz === -exitSide.nz)! : SIDES[Math.floor(rnd() * 4)];
  const laterals = SIDES.filter(s => s !== opposite && (!exitSide || sideKey(s) !== sideKey(exitSide)));
  if (rnd() < 0.5) laterals.reverse();
  // (no exit side known: the lateral list holds the exit-less remaining sides; the opposite stays first)
  // --- a tower on side s at lateral coordinate t (along the side) ---
  const tryTower = (s: Side, t: number): VentTowerPlan | null => {
    tried++;
    const alongX = s.nx === 0; // a z-side runs along x
    // the parapet edge it stands behind: an edge with this outward normal whose span covers the plenum (+0.5), the outermost first
    const PH = P.plenum.hw + 0.5;
    const edges = site.edges.filter(e => e.nx === s.nx && e.nz === s.nz)
      .filter(e => { const lo = alongX ? Math.min(e.x0, e.x1) : Math.min(e.z0, e.z1), hi = alongX ? Math.max(e.x0, e.x1) : Math.max(e.z0, e.z1); return t - PH >= lo && t + PH <= hi; })
      .sort((a, b) => (alongX ? (b.z0 - a.z0) * s.nz : (b.x0 - a.x0) * s.nx));
    const e = edges[0];
    if (!e) return no('edge');
    const line = alongX ? e.z0 : e.x0;
    const R = between(P.fanR), fanScale = R / FAN_ANCHORS.ringR;
    const hw = r3((FAN_ANCHORS.plateW * fanScale + between(P.stackMargin)) / 2), hd = r3(between(P.stackD) / 2);
    const H = r3(between(P.height)), gap = between(P.gap);
    const hub = Math.min(Math.max(between(P.hub), P.duct.bottom + P.duct.h + 0.9 + FAN_ANCHORS.ringY * fanScale), H - 6 - (FAN_ANCHORS.plateH - FAN_ANCHORS.ringY) * fanScale);
    // the stack's centre: the parapet's outer face + the gap to the plinth + the plinth pad + half the stack's depth, outward
    const out = T + gap + P.plinthPad + hd;
    const cx = alongX ? t : line + s.nx * out, cz = alongX ? line + s.nz * out : t;
    const yaw = Math.atan2(-s.nx, -s.nz); // local +Z = into the yard (the fan's facing)
    const reach = gap + P.plinthPad;
    // the whole tower: from the plinth's back to the parapet's outer face (the plenum / duct / the fan's overhang), the plinth's width
    const back = hd + P.plinthPad, front = hd + reach, half = hw + P.plinthPad;
    const [fx, fz] = plantLocal({x: cx, z: cz, yaw}, 0, (front - back) / 2);
    const footprint: CityFootprint = {x: r3(fx), z: r3(fz), yaw, hw: r3(half), hd: r3((front + back) / 2)};
    if (plantOnWalk(site, footprint, 0.05)) return no('walk');
    if (site.shelters.some(q => hitsRect(footprint, q.rect, 1.5))) return no('shelter');
    if (Math.hypot(fx - h.x, fz - h.z) < h.keepR + footprint.hd + footprint.hw) return no('hole');
    if (towers.some(o => footprintsOverlap(footprint, {...o.footprint, hw: o.footprint.hw + P.towerGap / 2, hd: o.footprint.hd + P.towerGap / 2}))) return no('tower');
    return {
      id: towers.length, x: r3(cx), z: r3(cz), yaw, hw, hd, h: H,
      fan: {radius: r3(R), hubY: r3(y + hub), axis: 'side'},
      side: {nx: s.nx, nz: s.nz}, y, plinth: {hw: r3(hw + P.plinthPad), hd: r3(hd + P.plinthPad), h: P.plinthH}, reach: r3(reach),
      fanScale: r3(fanScale), bladeR: r3(FAN_ANCHORS.bladeR * fanScale), rev: r3(between(P.rev)), phase: r3(rnd() * Math.PI * 2), footprint,
    };
  };
  /** Lateral candidates on side s: off the aperture's axis by the seeded offset (preferred sign first), then wider / narrower. */
  const place = (s: Side, sign: number): VentTowerPlan | null => {
    const t0 = s.nx === 0 ? h.x : h.z, off = between(P.lateral);
    for (const d of [0, 3, -3, 6, -5, 9]) for (const sg of [sign, -sign]) {
      const t = tryTower(s, t0 + sg * Math.max(4, off + d));
      if (t) return t;
    }
    return null;
  };
  const first = place(opposite, rnd() < 0.5 ? 1 : -1);
  if (first) towers.push(first);
  for (const s of first ? laterals : [...laterals, opposite]) {
    if (towers.length >= P.towers) break;
    // (the lateral tower leans toward the far half of its side: away from the exit, so both stand in the exit's view)
    const sign = exitSide ? -(s.nx === 0 ? exitSide.nx : exitSide.nz) || 1 : 1;
    const t = place(s, sign);
    if (t) towers.push({...t, id: towers.length});
  }
  // --- the duct run of each tower: plenum against the parapet, the duct on sleepers into the stack's base ---
  for (const tw of towers) {
    const fr = {x: tw.x, z: tw.z, yaw: tw.yaw}, zFace = tw.hd, zPar = tw.hd + tw.reach; // local z of the stack face / the parapet's outer face
    const box = (kind: PlantPart['kind'], lx: number, lz0: number, lz1: number, hwx: number, y0: number, y1: number) => {
      const [x, z] = plantLocal(fr, lx, (lz0 + lz1) / 2);
      parts.push({kind, x: r3(x), z: r3(z), yaw: tw.yaw, hw: r3(hwx), hd: r3(Math.abs(lz1 - lz0) / 2), y0: r3(y0), y1: r3(y1), tower: tw.id});
    };
    const pz0 = zPar - P.clear, pz1 = zPar - P.plenum.d; // the plenum's plaza face just off the parapet's outer face
    box('plenum', 0, pz1, pz0, P.plenum.hw, y - 0.1, y + P.plenum.h);
    box('duct', 0, zFace - 0.05, pz1 + 0.05, P.duct.w / 2, y + P.duct.bottom, y + P.duct.bottom + P.duct.h);
    // (sleepers from the plinth's front: the duct clears the plinth's top)
    const s0 = zFace + P.plinthPad, L = pz1 - s0;
    for (let k = 0, n = Math.max(1, Math.round(L / 2.2)); k < n; k++) {
      const lz = s0 + (L * (k + 0.5)) / n;
      box('sleeper', 0, lz - 0.3, lz + 0.3, P.duct.w / 2 + 0.25, y - 0.1, y + P.duct.bottom);
    }
  }
  // --- the compound wall: piers flush with the parapet's inner face, rising over it, a raking buttress behind each ---
  const reservedTowers = towers.map(t => t.footprint);
  const wholes: CityFootprint[] = [];
  let piers = 0;
  for (const e of site.edges) {
    const L = Math.hypot(e.x1 - e.x0, e.z1 - e.z0);
    if (L < 3) continue;
    const ux = (e.x1 - e.x0) / L, uz = (e.z1 - e.z0) / L, yaw = Math.atan2(e.nx, e.nz);
    const n = Math.max(1, Math.round((L - 2.4) / P.pierEvery));
    for (let k = 0; k <= n; k++) {
      const a = L < 5 ? L / 2 : 1.2 + ((L - 2.4) * k) / n;
      if (L < 5 && k > 0) break;
      const ex = e.x0 + ux * a, ez = e.z0 + uz * a;
      const d0 = P.clear, d1 = T + P.pierOut, b1 = d1 + P.buttress;
      const pier: PlantPart = {kind: 'pier', x: r3(ex + e.nx * (d0 + d1) / 2), z: r3(ez + e.nz * (d0 + d1) / 2), yaw, hw: P.pierW / 2, hd: r3((d1 - d0) / 2), y0: r3(y - 0.1), y1: r3(site.parapetY + P.pierUp), tower: -1};
      const but: PlantPart = {kind: 'buttress', x: r3(ex + e.nx * (d1 + b1) / 2), z: r3(ez + e.nz * (d1 + b1) / 2), yaw, hw: P.buttressW / 2, hd: r3((b1 - d1) / 2), y0: r3(y - 0.1), y1: r3(site.parapetY + 0.35), y1b: r3(y + 0.25), tower: -1};
      const whole: CityFootprint = {x: ex + e.nx * (d0 + b1) / 2, z: ez + e.nz * (d0 + b1) / 2, yaw, hw: P.pierW / 2, hd: (b1 - d0) / 2};
      if (plantOnWalk(site, whole)) { no('pier-walk'); continue; }
      if (site.shelters.some(q => hitsRect(whole, q.rect, 0.6))) { no('pier-shelter'); continue; }
      if (reservedTowers.some(r => footprintsOverlap(whole, {...r, hw: r.hw + 0.4, hd: r.hd + 0.4}))) { no('pier-tower'); continue; }
      if (wholes.some(q => footprintsOverlap(whole, {...q, hw: q.hw + 0.3, hd: q.hd + 0.3}))) { no('pier-pier'); continue; }
      wholes.push(whole);
      parts.push(pier, but);
      piers++;
    }
  }
  return {towers, reserved: [...reservedTowers], parts, stats: {towers: towers.length, piers, tried, why}};
}
