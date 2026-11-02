// Task reactor-expansion-20261101 (lane CORE): THE HERO REACTOR ASSEMBLY — user: "The reactor looks WAYYYYYYYYY to simple. its basically a
// cylindar. It needs many coolant pipes, it needs a proper sturcture made up of 3d assets." (B "Industrial Service Cathedral": the vessel
// at the pit bottom ringed by circular gantries, pipes everywhere, glowing green, lighting the fog.) Pure placements (Node-testable):
// one KitPlan step (world/reactor/archKit.ts planReactorKit) from layout.reactor.coreFloor (gen/reactor/coreFloor.ts):
//  - the lead's Meshy hero models through the arch GLB-swap seam (archAssets.ts REACTOR_MODELS: one entry each — a procedural stand-in
//    when a model is not loaded): per COOLANT LOOP a steam generator (11 m, standing in the goop), a vertical reactor coolant pump on
//    its plinth and a coolant manifold on its stand; the TURBINE GENERATOR on its wall run of the outer floor;
//  - MANY PIPES (instanced cylinders with flanges in the kit's rusted pipe steel): per loop the HOT LEG (vessel -> steam generator) and
//    the COLD LEG (pump -> riser -> vessel) crossing the service ring overhead (>= 2.6 m clear), the CROSSOVER LEG (steam generator ->
//    pump: low over the goop, or high over a bridge / tower foot), the manifold's feeds and risers, the steam lines into the outer
//    STEAM HEADER ring (7.2 m up, round the pool), its columns standing in the goop, a forest of risers climbing the pit from it, the
//    turbine's steam line; every run is checked against every walkway / deck volume of every storey, the towers and the plant pieces;
//  - the CIRCULAR SERVICE GANTRY round the vessel (B's rings: grating, railing, brackets back to the vessel body), the CRDM service
//    platform on the dome with the control-rod drive housings and their cable trays;
//  - the core floor's own steel: the smooth railings round the goop (ring / outer circles, bridge sides — the cell-edge collision rails
//    there are hidden: gen/reactor/coreFloor.ts), edge plates + hazard fascia, bridge fascia / stripes / piers into the goop, concrete
//    piers under the tower legs standing in the goop.
// The DYNAMIC layer (world/reactor/coreLiquids.ts / coreVisuals.ts) reads the anchors this step records (coreHeroOf(plan)): the coolant
// flow paths + sight glasses, the pump / turbine rotors, the status lamps (core + restart sites), the glow-light points, the goop.

import * as THREE from 'three';
import type {ReactorCoreFloor, ReactorInfo} from '../../gen/reactor/reactorTypes';
import {CORE_FLOOR, planLoops} from '../../gen/reactor/coreFloor';
import {KitPlan, boxMatrix, cylMatrix, memberMatrix} from './archKit';
import {REACTOR_MODELS, type ReactorPiece} from './archAssets';

type P3 = {x: number; y: number; z: number};

/** The status-lamp groups the restart stages drive (world/reactor/coreStages.ts). */
export type CoreLampGroup = 'fuse0' | 'fuse1' | 'power' | 'valve' | 'pump' | 'key' | 'rods';
/** Coolant flow kinds: the primary loop legs carry the BLUE flow; the feeds glow with it, dimmer. */
export type CoreFlowKind = 'hot' | 'cold' | 'cross' | 'feed';

export interface CoreHeroLayout {
  cf: ReactorCoreFloor;
  /** Coolant runs (polylines) the flow sleeves follow, their pipe diameter. */
  flows: {kind: CoreFlowKind; pts: P3[]; d: number}[];
  /** Sight-glass sections (they fill when the valve opens; the flow streaks through them when the pump runs). */
  glasses: {a: P3; b: P3; d: number}[];
  /** Rotors: the pumps' flywheels (axis up), the turbine coupling (axis along the shaft). */
  wheels: {kind: 'rcp' | 'turbine'; x: number; y: number; z: number; ax: number; ay: number; az: number; r: number}[];
  /** Status lamps (centre, radius) per group; `site` = at a restart site (else at the core). */
  lamps: {group: CoreLampGroup; x: number; y: number; z: number; r: number; site: boolean}[];
  /** The reactor's own glow lights: green over the goop, blue over the coolant (world/reactor/coreLights.ts). */
  lights: {green: P3[]; blue: P3[]};
  stats: CoreHeroStats;
}

export interface CoreHeroStats {
  models: Partial<Record<ReactorPiece, number>>;
  procedural: number;
  pipes: number;
  flanges: number;
  risers: number;
  supports: number;
  blocked: number;
  railMembers: number;
  stripes: number;
  piers: number;
  gantries: number;
  crdm: number;
  lamps: number;
}

/** Hero tunables (m). */
export const CORE_HERO = {
  /** Vessel nozzle radius / heights of the hot and cold legs (the model's nozzle band is 1.66 .. 4.15 m above the floor). */
  nozzleR: 4.7, hotY: 3.3, coldY: 3.0, hotD: 0.86, coldD: 0.74, crossD: 0.72,
  /** Clearance over a walkway (bottom of anything crossing the ring / a bridge / the outer floor) and the walk volume of a deck. */
  headroom: 2.4, deckBelow: 1.3, deckAbove: 2.5,
  /** The steam header ring just outside the outer railing (above the deck: over the walkway, under the tier-4 deck steel), its
   *  offset beyond the railing, diameter; risers off it and their tallest top. */
  headerY: 3.7, headerOut: 0.55, headerD: 0.7, risers: 18, riserTop: 22,
  /** The circular service gantry round the vessel (radii, height above the deck) and the CRDM platform. */
  gantryR0: 7.0, gantryR1: 8.3, gantryY: 6.9, crdmY: 10.15, crdmR: 3.3, crdmTop: 12.6,
  /** Measured on the lead's models (probe 2026-11-02): the vertical pump's nozzle axis above its base (nozzle tips at +-2.13 along X),
   *  its motor top; the steam generator's shell radius at the hot-leg height; the turbine generator's housing top over its exciter end. */
  rcpNozzle: 1.25, rcpTop: 6.9, wheelR: 0.7, sgShellR: 2.05, turbineFanX: 4.0, turbineTop: 2.68,
} as const;

const layouts = new WeakMap<KitPlan, CoreHeroLayout>();
/** The hero anchors recorded for a plan (null: no hero planned). */
export function coreHeroOf(plan: KitPlan | null | undefined): CoreHeroLayout | null { return plan ? layouts.get(plan) ?? null : null; }

/** A core-floor record for a Reactor without one (hand-built fixtures): the generator's dimensions round info.core, no turbine. */
export function defaultCoreFloor(info: ReactorInfo): ReactorCoreFloor {
  const F = CORE_FLOOR, c = info.core, b = info.pit.bounds;
  const inscribed = Math.min(c.x - b.x0, b.x1 - c.x, c.z - b.z0, b.z1 - c.z);
  const poolR1 = Math.max(F.ringR1 + 3, Math.min(F.poolR1, Math.floor((inscribed - F.wallClear) * 2) / 2));
  const angles = [1, 3, 5, 7].map(k => (k * Math.PI) / 4);
  const towers = info.towers.map(t => ({x0: t.x - t.hx - 0.5, z0: t.z - t.hz - 0.5, x1: t.x + t.hx + 0.5, z1: t.z + t.hz + 0.5}));
  const loops = planLoops(c.x, c.z, poolR1, angles, towers).map(l => ({
    angle: l.angle, sg: l.sg ? {...l.sg, prop: -1} : null, rcp: l.rcp ? {...l.rcp, prop: -1} : null, manifold: l.manifold,
  }));
  return {
    version: 1, x: c.x, z: c.z, y: c.y0, vesselR: F.vesselR, ring: {r0: F.vesselR, r1: F.ringR1},
    pool: {r0: F.ringR1, r1: poolR1, surfaceY: c.y0 - F.depth + F.surface, floorY: c.y0 - F.depth, cells: 0},
    bridges: angles.map(a => ({angle: a, width: F.bridgeW, rail: F.bridgeW / 2 + 0.35, x0: c.x + Math.cos(a) * (F.ringR1 - 0.6), z0: c.z + Math.sin(a) * (F.ringR1 - 0.6), x1: c.x + Math.cos(a) * (poolR1 + 0.35), z1: c.z + Math.sin(a) * (poolR1 + 0.35)})),
    towers: [], loops, turbine: null, rails: {ring: F.ringR1 + 0.3, outer: poolR1 - 0.3},
  };
}

/** Plans the hero assembly into `plan` (call after the kit's own steps); records its dynamic anchors (coreHeroOf). */
export function planReactorCore(plan: KitPlan, info: ReactorInfo): CoreHeroLayout | null {
  if (!info.core || !(info.core.radius > 0.5)) return null;
  const cf = info.coreFloor ?? defaultCoreFloor(info);
  const H = CORE_HERO, F = CORE_FLOOR;
  const C = {x: cf.x, z: cf.z}, y0 = cf.y, yp = cf.pool.floorY;
  const st: CoreHeroStats = {models: {}, procedural: 0, pipes: 0, flanges: 0, risers: 0, supports: 0, blocked: 0, railMembers: 0, stripes: 0, piers: 0, gantries: 0, crdm: 0, lamps: 0};
  const out: CoreHeroLayout = {cf, flows: [], glasses: [], wheels: [], lamps: [], lights: {green: [], blue: []}, stats: st};
  const u = (a: number) => ({x: Math.cos(a), z: Math.sin(a)});
  const at = (a: number, r: number, y: number): P3 => ({x: C.x + Math.cos(a) * r, y, z: C.z + Math.sin(a) * r});
  const angOf = (x: number, z: number) => Math.atan2(z - C.z, x - C.x);
  const radOf = (x: number, z: number) => Math.hypot(x - C.x, z - C.z);

  // ---- obstacles: deck walk volumes (every storey), towers, the plant pieces ------------------------------------------------------
  const decks = info.decks.map(d => ({...d.rect, y: d.y}));
  const towerBoxes = info.towers.map(t => ({x0: t.x - t.hx, z0: t.z - t.hz, x1: t.x + t.hx, z1: t.z + t.hz, y0: t.y0, y1: t.y1}));
  const pieces: {x: number; z: number; r: number; y0: number; y1: number}[] = [];
  for (const l of cf.loops) {
    if (l.sg) pieces.push({x: l.sg.x, z: l.sg.z, r: F.sgHalf, y0: yp, y1: yp + F.sgH});
    if (l.rcp) pieces.push({x: l.rcp.x, z: l.rcp.z, r: 2.15, y0: yp, y1: yp + F.rcpLift + F.rcpH});
  }
  /** Is point p (a pipe of radius r) inside any deck walk volume, tower or plant piece (except those within `skip` m of `skipAt`)? */
  const hit = (p: P3, r: number, ignorePieces = false): boolean => {
    for (const d of decks) if (p.x > d.x0 - r - 0.15 && p.x < d.x1 + r + 0.15 && p.z > d.z0 - r - 0.15 && p.z < d.z1 + r + 0.15 && p.y > d.y - H.deckBelow - r && p.y < d.y + H.deckAbove + r) return true;
    for (const t of towerBoxes) if (p.x > t.x0 - r - 0.4 && p.x < t.x1 + r + 0.4 && p.z > t.z0 - r - 0.4 && p.z < t.z1 + r + 0.4 && p.y > t.y0 - 0.5 && p.y < t.y1 + 0.5) return true;
    if (!ignorePieces) for (const q of pieces) if (p.y > q.y0 && p.y < q.y1 + r && Math.hypot(p.x - q.x, p.z - q.z) < q.r + r + 0.1) return true;
    return false;
  };
  /** A run a -> b of a pipe of diameter d is clear (sampled every 0.4 m; the ends may touch what they connect to). */
  const clear = (a: P3, b: P3, d: number, ignorePieces = false, endSkip = 0.6): boolean => {
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.4));
    for (let k = 0; k <= n; k++) {
      const s = (k / n) * L;
      if (s < endSkip || L - s < endSkip) continue;
      const t = k / n;
      if (hit({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t}, d / 2, ignorePieces)) return false;
    }
    return true;
  };
  /** Over a walkway of the core floor (ring / bridges / outer floor) at (x, z)? (the pool and the vessel are not walkways). */
  const overWalk = (x: number, z: number): boolean => {
    const r = radOf(x, z);
    if (r < cf.vesselR) return false;
    if (r < cf.ring.r1) return true;
    for (const b of cf.bridges) {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), px = x - C.x, pz = z - C.z;
      if (Math.abs(-px * uz + pz * ux) < b.rail + 0.3 && px * ux + pz * uz > 0) return true;
    }
    return r > cf.rails.outer - 0.05;
  };
  /** On a bridge (its rail envelope + 0.3 m)? */
  const mouthAt = (p: {x: number; z: number}): boolean => cf.bridges.some(b => {
    const ux = Math.cos(b.angle), uz = Math.sin(b.angle), px = p.x - C.x, pz = p.z - C.z;
    return px * ux + pz * uz > 0 && Math.abs(-px * uz + pz * ux) < b.rail + 0.3;
  });
  /** A run a -> b of diameter d intrudes a walkway's body volume somewhere along it (sampled every 0.25 m)? */
  const intrudesWalk = (a: P3, b: P3, d: number): boolean => {
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.25));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      if (y - d / 2 < y0 + H.headroom && y + d / 2 > y0 - 0.5 && (overWalk(x, z) || overWalk(x + d / 2, z) || overWalk(x - d / 2, z) || overWalk(x, z + d / 2) || overWalk(x, z - d / 2))) return true;
    }
    return false;
  };
  /** A pipe run (+ flanges at its ends / every `fl` m); null when blocked. Pipes over a walkway keep the headroom. */
  const pipe = (a: P3, b: P3, d: number, opt: {flanges?: boolean; ignore?: boolean; endSkip?: number; mat?: 'pipe' | 'steelDark'} = {}): boolean => {
    if (!clear(a, b, d, opt.ignore, opt.endSkip ?? 0.6) || intrudesWalk(a, b, d)) { st.blocked++; return false; }
    plan.cyl('cyl', opt.mat ?? 'pipe', a, b, d);
    st.pipes++;
    if (opt.flanges !== false) {
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      if (L > 0.5) for (const s of [0.12, L - 0.12]) {
        const t0 = (s - 0.08) / L, t1 = (s + 0.08) / L;
        plan.cyl('cyl', 'steelDark', lerp(a, b, t0), lerp(a, b, t1), d * 1.28);
        st.flanges++;
      }
    }
    return true;
  };
  /** A polyline of pipes with elbow collars at the joints; the drawn part (all-or-nothing per segment) is returned. */
  const run = (pts: P3[], d: number, opt: {ignore?: boolean} = {}): P3[] | null => {
    for (let i = 0; i + 1 < pts.length; i++) if (!clear(pts[i], pts[i + 1], d, opt.ignore, i === 0 || i + 2 === pts.length ? 0.6 : 0.05) || intrudesWalk(pts[i], pts[i + 1], d)) { st.blocked++; return null; }
    for (let i = 0; i + 1 < pts.length; i++) pipe(pts[i], pts[i + 1], d, {ignore: true, endSkip: 10, flanges: i === 0 || i + 2 === pts.length});
    for (let i = 1; i + 1 < pts.length; i++) {
      const p = pts[i], q = pts[i + 1], dl = Math.hypot(q.x - p.x, q.y - p.y, q.z - p.z) || 1;
      plan.cyl('cyl', 'pipe', {x: p.x - (q.x - p.x) / dl * d * 0.55, y: p.y - (q.y - p.y) / dl * d * 0.55, z: p.z - (q.z - p.z) / dl * d * 0.55}, {x: p.x + (q.x - p.x) / dl * d * 0.55, y: p.y + (q.y - p.y) / dl * d * 0.55, z: p.z + (q.z - p.z) / dl * d * 0.55}, d * 1.12);
      st.flanges++;
    }
    return pts;
  };
  const coreBand = plan.bandOf(y0 + 0.1);
  const model = (piece: ReactorPiece, x: number, y: number, z: number, yaw: number): boolean => {
    if (!plan.usesModel(piece)) return false;
    const n = plan.modelPlacements.get(piece)?.length ?? 0;
    if (n >= REACTOR_MODELS[piece].cap) return false;
    plan.placeModel(piece, boxMatrix(x, y, z, 1, 1, 1, yaw), plan.bandOf(y + 0.1), REACTOR_MODELS[piece].dims);
    st.models[piece] = (st.models[piece] ?? 0) + 1;
    return true;
  };
  const lamp = (group: CoreLampGroup, x: number, y: number, z: number, r = 0.055, site = false) => { out.lamps.push({group, x, y, z, r, site}); st.lamps++; };

  // ---- 1. the coolant loops ---------------------------------------------------------------------------------------------------------
  const rH =cf.rails.outer + H.headerOut; // the steam header ring (over the outer floor's edge, high)
  for (const loop of cf.loops) {
    const sg = loop.sg, rcp = loop.rcp, mf = loop.manifold;
    // steam generator (11 m, standing in the goop on its skirt)
    if (sg) {
      if (!model('steamGenerator', sg.x, yp, sg.z, sg.yaw)) {
        // stand-in: skirt, lower shell, cone, upper drum, dome (the kit's pipe / vessel steel)
        plan.cyl('cyl', 'steelDark', {x: sg.x, y: yp, z: sg.z}, {x: sg.x, y: yp + 1.6, z: sg.z}, 3.6);
        plan.cyl('cyl', 'vessel', {x: sg.x, y: yp + 1.6, z: sg.z}, {x: sg.x, y: yp + 6.4, z: sg.z}, 3.4);
        plan.cyl('cyl', 'vessel', {x: sg.x, y: yp + 6.4, z: sg.z}, {x: sg.x, y: yp + 7.4, z: sg.z}, 4.0);
        plan.cyl('cyl', 'vessel', {x: sg.x, y: yp + 7.4, z: sg.z}, {x: sg.x, y: yp + 10.4, z: sg.z}, 4.5);
        plan.cyl('cyl', 'steelDark', {x: sg.x, y: yp + 10.4, z: sg.z}, {x: sg.x, y: yp + 11, z: sg.z}, 3.0);
        st.procedural++;
      }
      const a = angOf(sg.x, sg.z), r = radOf(sg.x, sg.z);
      // hot leg: vessel nozzle -> the steam generator's inner side
      const hp = [at(a, H.nozzleR, y0 + H.hotY), at(a, r - H.sgShellR + 0.15, y0 + H.hotY)];
      if (pipe(hp[0], hp[1], H.hotD, {ignore: true})) {
        out.flows.push({kind: 'hot', pts: hp, d: H.hotD});
        // a saddle hanger from the gantry ring above where it crosses it
        const gx = at(a, (H.gantryR0 + H.gantryR1) / 2, y0 + H.gantryY);
        plan.member('box', 'steelDark', {x: gx.x, y: y0 + H.hotY + H.hotD / 2, z: gx.z}, {x: gx.x, y: gx.y - 0.06, z: gx.z}, 0.08, 0.08);
        st.supports++;
      }
      // steam line: the upper drum -> the steam header ring
      const sy = y0 + H.headerY;
      pipe(at(a, r + F.sgHalf - 0.35, sy), at(a, rH, sy), 0.5, {ignore: true});
      // status lamps on the hot leg's instrument box (faces the ring walkway)
      const bx = at(a, cf.ring.r1 - 0.9, y0 + H.hotY + H.hotD / 2 + 0.2);
      plan.box('machine', bx.x, bx.y, bx.z, 0.46, 0.34, 0.3, -a);
      lamp('power', bx.x - Math.cos(a) * 0.26 - Math.sin(a) * 0.12, bx.y + 0.03, bx.z - Math.sin(a) * 0.26 + Math.cos(a) * 0.12);
      lamp('pump', bx.x - Math.cos(a) * 0.26 + Math.sin(a) * 0.12, bx.y + 0.03, bx.z - Math.sin(a) * 0.26 - Math.cos(a) * 0.12);
    }
    // vertical reactor coolant pump on its plinth, nozzles radial (inner -> cold leg, outer <- crossover)
    if (rcp) {
      const a = angOf(rcp.x, rcp.z), r = radOf(rcp.x, rcp.z), base = yp + F.rcpLift;
      plan.box('concrete', rcp.x, yp + F.rcpLift / 2, rcp.z, 2.6, F.rcpLift, 2.0, -a);
      if (!model('rcpVertical', rcp.x, base, rcp.z, rcp.yaw)) {
        plan.cyl('cyl', 'vessel', {x: rcp.x, y: base, z: rcp.z}, {x: rcp.x, y: base + 1.9, z: rcp.z}, 2.2); // casing
        plan.cyl('cyl', 'steelDark', {x: rcp.x, y: base + 1.9, z: rcp.z}, {x: rcp.x, y: base + 3.4, z: rcp.z}, 1.2); // stand
        plan.cyl('cyl', 'machine', {x: rcp.x, y: base + 3.4, z: rcp.z}, {x: rcp.x, y: base + 7, z: rcp.z}, 1.9); // motor
        st.procedural++;
      }
      const ny = base + H.rcpNozzle;
      // cold leg: the inner nozzle -> a riser in the goop -> over the ring -> the vessel
      const rr = Math.max(cf.rails.ring + H.coldD / 2 + 0.2, r - 2.45); // the riser stands in the goop, clear of the ring railing
      const cp = [at(a, r - 2.05, ny), at(a, rr, ny), at(a, rr, y0 + H.coldY), at(a, H.nozzleR, y0 + H.coldY)];
      if (run(cp, H.coldD, {ignore: true})) {
        out.flows.push({kind: 'cold', pts: cp, d: H.coldD});
        out.glasses.push({a: at(a, rr, y0 + 0.75), b: at(a, rr, y0 + 2.15), d: H.coldD});
        // the pressure gauge box on the riser (its inner face toward the ring walkway) + its lamp
        const gb = at(a, rr - H.coldD / 2 - 0.06, y0 + 2.72), gl = at(a, rr - H.coldD / 2 - 0.15, y0 + 2.72);
        plan.box('steelDark', gb.x, gb.y, gb.z, 0.12, 0.24, 0.24, -a);
        lamp('valve', gl.x, gl.y, gl.z);
      }
      // flywheel on the motor top + its status beacon
      const top = base + H.rcpTop;
      out.wheels.push({kind: 'rcp', x: rcp.x, y: top + 0.08, z: rcp.z, ax: 0, ay: 1, az: 0, r: H.wheelR});
      plan.cyl('tube', 'steelDark', {x: rcp.x, y: top - 0.05, z: rcp.z}, {x: rcp.x, y: top + 0.22, z: rcp.z}, H.wheelR * 2.25); // guard ring
      plan.cyl('cyl', 'steelDark', {x: rcp.x, y: top + 0.22, z: rcp.z}, {x: rcp.x, y: top + 0.3, z: rcp.z}, 0.3); // beacon base on the guard's hub plate
      lamp('pump', rcp.x, top + 0.38, rcp.z, 0.1);
    }
    // crossover leg: steam generator bottom -> pump outer nozzle (low over the goop, high over a bridge / tower foot)
    if (sg && rcp) {
      const aS = angOf(sg.x, sg.z), aP = angOf(rcp.x, rcp.z), rP = radOf(rcp.x, rcp.z), rS = radOf(sg.x, sg.z);
      // the low track: over the goop (its bottom 0.4 m above the surface), under the outer edge fascia, outside the pieces' skirts
      const yLow = yp + 0.8, rLow = Math.min(cf.rails.outer - 0.45, rS + 2.25);
      let dA = aP - aS;
      while (dA > Math.PI) dA -= 2 * Math.PI;
      while (dA < -Math.PI) dA += 2 * Math.PI;
      const ny = yp + F.rcpLift + H.rcpNozzle;
      const track = (y: number): P3[] => {
        const pts: P3[] = [at(aS, rS + 1.85, yLow), at(aS, rLow, yLow)];
        if (Math.abs(y - yLow) > 0.05) pts.push(at(aS, rLow, y));
        const n = Math.max(1, Math.ceil(Math.abs(dA) / (Math.PI / 24)));
        for (let k = 1; k <= n; k++) pts.push(at(aS + (dA * k) / n, rLow, y));
        if (Math.abs(y - ny) > 0.05) pts.push(at(aP, rLow, ny));
        pts.push(at(aP, rP + 2.05, ny));
        return pts;
      };
      const low = track(yLow);
      const lowOk = low.every((p, i) => i + 1 >= low.length || (clear(p, low[i + 1], H.crossD, true, 0.05) && !intrudesWalk(p, low[i + 1], H.crossD)));
      const pts = lowOk ? low : track(y0 + 3.6);
      if (run(pts, H.crossD, {ignore: true})) {
        out.flows.push({kind: 'cross', pts, d: H.crossD});
        // pipe supports down into the goop under the low run
        if (lowOk) for (let i = 2; i < pts.length - 1; i += 2) { plan.member('box', 'steelDark', {x: pts[i].x, y: yp, z: pts[i].z}, {x: pts[i].x, y: pts[i].y - H.crossD / 2, z: pts[i].z}, 0.16, 0.16); st.supports++; }
      }
    }
    // manifold on its stand (header radial), its feed into the cold leg riser and its risers up to the steam header
    if (mf) {
      const a = angOf(mf.x, mf.z), r = radOf(mf.x, mf.z), mb = y0 + F.manifoldBase;
      for (const [lx, lz] of [[-1.8, -0.55], [1.8, -0.55], [-1.8, 0.55], [1.8, 0.55]]) {
        const p = {x: mf.x + Math.cos(a) * lx - Math.sin(a) * lz, z: mf.z + Math.sin(a) * lx + Math.cos(a) * lz};
        plan.member('box', 'steelDark', {x: p.x, y: yp, z: p.z}, {x: p.x, y: mb - 0.06, z: p.z}, 0.16, 0.16);
      }
      plan.box('steelDark', mf.x, mb - 0.06, mf.z, 4.2, 0.12, 1.4, -a);
      if (!model('coolantManifold', mf.x, mb, mf.z, mf.yaw)) {
        plan.cyl('cyl', 'pipe', at(a, r - 2.2, mb + 0.9), at(a, r + 2.2, mb + 0.9), 0.6);
        for (const s of [-1.5, -0.5, 0.5, 1.5]) plan.cyl('cyl', 'pipe', at(a, r + s, mb + 0.9), at(a, r + s, mb + 2.0), 0.22);
        st.procedural++;
      }
      const ml = at(a, r - 1.95, mb);
      plan.cyl('cyl', 'steelDark', ml, {...ml, y: mb + 0.07}, 0.16);
      lamp('valve', ml.x, mb + 0.13, ml.z, 0.065);
      // feed risers from its branches up to the header (the outer end) — the manifold distributes the coolant
      for (const s of [-1.5, 1.5]) {
        const rp = [at(a, r + s, mb + 2.0), at(a, r + s, y0 + H.headerY - 0.55), at(a, rH, y0 + H.headerY - 0.55)];
        if (run(rp, 0.26)) { out.flows.push({kind: 'feed', pts: rp, d: 0.26}); st.risers++; }
      }
      // its feed into the loop's cold-leg riser (low, along the goop) — only to a pump beside it, no bridge between
      if (rcp) {
        const aP = angOf(rcp.x, rcp.z), rr = Math.max(cf.rails.ring + H.coldD / 2 + 0.2, radOf(rcp.x, rcp.z) - 2.45);
        let dA = aP - a;
        while (dA > Math.PI) dA -= 2 * Math.PI;
        while (dA < -Math.PI) dA += 2 * Math.PI;
        const between = cf.bridges.some(b => { let e = b.angle - a; while (e > Math.PI) e -= 2 * Math.PI; while (e < -Math.PI) e += 2 * Math.PI; return dA > 0 ? e > 0 && e < dA : e < 0 && e > dA; });
        if (Math.abs(dA) < 0.7 && !between) {
          const fp = [at(a, r - 2.25, mb + 0.9), at(a, rr + 0.5, mb + 0.9)];
          const n = Math.max(1, Math.ceil(Math.abs(dA) / 0.12));
          for (let k = 1; k <= n; k++) fp.push(at(a + (dA * k) / n, rr + 0.5, mb + 0.9));
          fp.push(at(aP, rr, mb + 0.9));
          if (run(fp, 0.3)) out.flows.push({kind: 'feed', pts: fp, d: 0.3});
        }
      }
    }
  }

  // ---- 2. the steam header ring round the pool, its columns in the goop, the riser forest -----------------------------------------
  {
    const n = 48, hy = y0 + H.headerY;
    let drawn = 0;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
      if (pipe(at(a0, rH, hy), at(a1, rH, hy), H.headerD, {ignore: true, endSkip: 0.05, flanges: k % 3 === 0})) drawn++;
    }
    if (drawn) st.gantries++;
    // columns: from the goop (just inside the outer railing) up to the header, an arm out under it (never on a walkway)
    const rC = cf.rails.outer - 0.3;
    for (let k = 0; k < 16; k++) {
      const a = ((k + 0.5) / 16) * Math.PI * 2, p = at(a, rC, hy);
      if (overWalk(p.x, p.z) || mouthAt(p) || mouthAt(at(a, rH, hy))) continue;
      if (!clear({x: p.x, y: yp + 0.05, z: p.z}, {x: p.x, y: hy - H.headerD / 2, z: p.z}, 0.3, false, 0.05)) continue;
      plan.member('ibeam', 'steelDark', {x: p.x, y: yp, z: p.z}, {x: p.x, y: hy + 0.1, z: p.z}, 0.3, 0.3, new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
      plan.member('ibeam', 'steelDark', at(a, rC - 0.1, hy - H.headerD / 2 - 0.12), at(a, rH + 0.3, hy - H.headerD / 2 - 0.12), 0.18, 0.24); // arm
      plan.box('steelDark', at(a, rH, 0).x, hy - H.headerD / 2 - 0.02, at(a, rH, 0).z, 0.5, 0.08, 0.9, -a); // saddle
      st.supports++;
    }
    // risers climbing the pit off the header (organ pipes round the core): up to the first deck / tower in the way
    for (let k = 0; k < H.risers; k++) {
      const a = ((k + 0.25) / H.risers) * Math.PI * 2, d = k % 3 === 0 ? 0.55 : 0.36;
      const foot = at(a, rH, hy + H.headerD / 2);
      let top = y0 + H.riserTop - (k % 4) * 2.2;
      for (let y = foot.y + 0.4; y <= top; y += 0.4) if (hit({x: foot.x, y, z: foot.z}, d / 2)) { top = y - 0.5; break; }
      if (top - foot.y < 2.5) continue;
      plan.cyl('cyl', 'pipe', foot, {x: foot.x, y: top, z: foot.z}, d);
      plan.cyl('cyl', 'steelDark', {x: foot.x, y: top, z: foot.z}, {x: foot.x, y: top + 0.25, z: foot.z}, d * 1.25); // cap
      for (let y = foot.y + 1.8; y < top - 0.4; y += 3.6) { plan.cyl('cyl', 'steelDark', {x: foot.x, y: y - 0.08, z: foot.z}, {x: foot.x, y: y + 0.08, z: foot.z}, d * 1.28); st.flanges++; }
      st.risers++;
    }
  }

  // ---- 3. the circular service gantry round the vessel + the CRDM service platform -----------------------------------------------
  {
    const steel: THREE.BufferGeometry[] = [], grate: THREE.BufferGeometry[] = [];
    const T = (g: THREE.BufferGeometry, y: number) => { g.translate(C.x, y, C.z); return g; };
    const gy = y0 + H.gantryY;
    let gantryOk = true;
    for (let k = 0; k < 24 && gantryOk; k++) if (hit(at((k / 24) * Math.PI * 2, H.gantryR1, gy), 0.3, true)) gantryOk = false;
    if (gantryOk) {
      const prof = [new THREE.Vector2(H.gantryR0, -0.06), new THREE.Vector2(H.gantryR1, -0.06), new THREE.Vector2(H.gantryR1, 0.06), new THREE.Vector2(H.gantryR0, 0.06), new THREE.Vector2(H.gantryR0, -0.06)];
      grate.push(T(new THREE.LatheGeometry(prof, 64), gy));
      for (const [r, y, t] of [[H.gantryR1, 1.05, 0.04], [H.gantryR1, 0.55, 0.03], [H.gantryR0, 1.05, 0.04]] as const) steel.push(T(new THREE.TorusGeometry(r, t, 4, 64).rotateX(Math.PI / 2), gy + y));
      steel.push(T(new THREE.CylinderGeometry(H.gantryR1 + 0.02, H.gantryR1 + 0.02, 0.3, 64, 1, true), gy - 0.2)); // fascia
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        for (const r of [H.gantryR0, H.gantryR1]) plan.member('box', 'steel', at(a, r, gy), at(a, r, gy + 1.05), 0.05, 0.05);
        if (k % 2 === 0) plan.member('box', 'steelDark', at(a, H.gantryR0 + 0.1, gy - 0.1), at(a, 5.05, gy - 1.6), 0.14, 0.14); // bracket to the body
        if (k % 4 === 0) plan.member('ibeam', 'steelDark', at(a, H.gantryR0, gy - 0.12), at(a, H.gantryR1, gy - 0.12), 0.16, 0.22);
      }
      st.gantries++;
    }
    // CRDM platform on the dome: grating disc ring, railing, brackets onto the dome, the drive housings + their cable trays
    const py = y0 + H.crdmY;
    const prof = [new THREE.Vector2(0.55, -0.06), new THREE.Vector2(H.crdmR, -0.06), new THREE.Vector2(H.crdmR, 0.06), new THREE.Vector2(0.55, 0.06), new THREE.Vector2(0.55, -0.06)];
    grate.push(T(new THREE.LatheGeometry(prof, 40), py));
    steel.push(T(new THREE.TorusGeometry(H.crdmR, 0.04, 4, 40).rotateX(Math.PI / 2), py + 1.05));
    steel.push(T(new THREE.TorusGeometry(H.crdmR, 0.03, 4, 40).rotateX(Math.PI / 2), py + 0.55));
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      plan.member('box', 'steel', at(a, H.crdmR, py), at(a, H.crdmR, py + 1.05), 0.05, 0.05);
      if (k % 2 === 0) plan.member('box', 'steelDark', at(a, H.crdmR - 0.1, py - 0.08), at(a, 3.9, y0 + F.domeBase + F.domeH * Math.sqrt(Math.max(0, 1 - (3.9 / F.domeR) ** 2)) + 0.05), 0.12, 0.12);
      lamp(k % 2 ? 'rods' : 'key', at(a, H.crdmR, py + 1.12).x, py + 1.12, at(a, H.crdmR, py + 1.12).z, 0.05);
    }
    const sp = 0.62;
    for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) {
      const x = (i + (j % 2 ? 0.5 : 0)) * sp, z = j * sp * 0.866;
      if (Math.hypot(x, z) > 2.4) continue;
      const top = y0 + H.crdmTop + ((i * 7 + j * 3) & 3) * 0.12;
      plan.cyl('tube', 'pipe', {x: C.x + x, y: py, z: C.z + z}, {x: C.x + x, y: top, z: C.z + z}, 0.2);
      plan.cyl('cyl', 'steelDark', {x: C.x + x, y: top, z: C.z + z}, {x: C.x + x, y: top + 0.28, z: C.z + z}, 0.28);
      st.crdm++;
    }
    steel.push(T(new THREE.TorusGeometry(2.75, 0.06, 4, 32).rotateX(Math.PI / 2), y0 + H.crdmTop + 0.6)); // cable-tray ring over the housings
    // cable trays from the platform out to the steam header (high, over everything)
    for (let k = 0; k < 4; k++) {
      const a = (k + 0.5) * Math.PI / 2, A = at(a, 2.75, y0 + H.crdmTop + 0.6), B = at(a, rH, y0 + H.headerY + 0.5);
      if (!clear(A, B, 0.4, false, 0.2)) { st.blocked++; continue; }
      plan.member('box', 'steelDark', A, B, 0.45, 0.07);
      for (const off of [-0.12, 0, 0.12]) plan.cyl('tube', 'cable', {x: A.x - Math.sin(a) * off, y: A.y + 0.06, z: A.z + Math.cos(a) * off}, {x: B.x - Math.sin(a) * off, y: B.y + 0.06, z: B.z + Math.cos(a) * off}, 0.06);
    }
    plan.merged.push({mat: 'grating', geos: grate, band: coreBand, name: 'reactor-core-gantries'});
    plan.merged.push({mat: 'steelDark', geos: steel, band: coreBand, name: 'reactor-core-gantry-steel'});
  }

  // ---- 4. the core floor's own steel: round railings, edge plates + hazard fascia, bridge steel, tower piers ----------------------
  {
    const plates: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
    const T = (g: THREE.BufferGeometry, y: number) => { g.translate(C.x, y, C.z); return g; };
    // edge plates covering the cell-stepped deck edges (flush, 3 cm) + the black fascia under the edge
    const ring = cf.rails.ring, outer = cf.rails.outer;
    plates.push(T(new THREE.LatheGeometry([new THREE.Vector2(ring - 0.6, 0), new THREE.Vector2(ring + 0.04, 0), new THREE.Vector2(ring + 0.04, 0.03), new THREE.Vector2(ring - 0.6, 0.03), new THREE.Vector2(ring - 0.6, 0)], 96), y0));
    plates.push(T(new THREE.LatheGeometry([new THREE.Vector2(outer - 0.04, 0), new THREE.Vector2(outer + 0.6, 0), new THREE.Vector2(outer + 0.6, 0.03), new THREE.Vector2(outer - 0.04, 0.03), new THREE.Vector2(outer - 0.04, 0)], 128), y0));
    dark.push(T(new THREE.CylinderGeometry(ring + 0.05, ring + 0.05, 0.32, 96, 1, true), y0 - 0.15));
    dark.push(T(insideOut(new THREE.CylinderGeometry(outer - 0.05, outer - 0.05, 0.32, 128, 1, true)), y0 - 0.15));
    plan.merged.push({mat: 'steel', geos: plates, band: coreBand, name: 'reactor-core-edges'});
    plan.merged.push({mat: 'black', geos: dark, band: coreBand, name: 'reactor-core-fascia'});
    // hazard stripes along both fascias
    for (const [r, sgn] of [[ring + 0.07, 1], [outer - 0.07, -1]] as const) {
      const n = Math.floor((2 * Math.PI * r) / 0.5);
      for (let k = 0; k < n; k++) {
        const a = ((k + 0.5) / n) * Math.PI * 2, p = at(a, r, y0 - 0.15);
        const nx = Math.cos(a) * sgn, nz = Math.sin(a) * sgn;
        plan.add('stripe', 'yellow', boxMatrix(p.x, p.y, p.z, 0.5, 0.27, 1, Math.atan2(nx, nz)), coreBand);
        st.stripes++;
      }
    }
    // round railings (the drawn rail = the collision envelope; gaps at the bridge mouths and the tower-foot notches)
    const towerFeet = cf.towers.map(i => info.towers[i]).filter(Boolean).map(t => ({x0: t.x - t.hx - 0.6, z0: t.z - t.hz - 0.6, x1: t.x + t.hx + 0.6, z1: t.z + t.hz + 0.6}));
    const inFoot = (p: {x: number; z: number}) => towerFeet.some(t => p.x > t.x0 && p.x < t.x1 && p.z > t.z0 && p.z < t.z1);
    const mouth = (p: {x: number; z: number}) => cf.bridges.some(b => {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), px = p.x - C.x, pz = p.z - C.z;
      return px * ux + pz * uz > 0 && Math.abs(-px * uz + pz * ux) < b.rail + 0.04;
    });
    const circleRail = (r: number, inward: number) => {
      const n = Math.max(24, Math.round((2 * Math.PI * r) / 1.25));
      for (let k = 0; k < n; k++) {
        const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
        const m = at(am, r, y0), probe = at(am, r + inward * 0.5, y0);
        if (mouth(at(a0, r, 0)) || mouth(at(a1, r, 0)) || inFoot(m) || inFoot(probe)) continue;
        railSpan(at(a0, r, y0), at(a1, r, y0));
      }
    };
    const railSpan = (a: P3, b: P3) => {
      plan.member('box', 'steel', {...a, y: a.y + 1.1}, {...b, y: b.y + 1.1}, 0.05, 0.05);
      plan.member('box', 'steel', {...a, y: a.y + 0.55}, {...b, y: b.y + 0.55}, 0.035, 0.035);
      plan.member('box', 'steelDark', {...a, y: a.y + 0.06}, {...b, y: b.y + 0.06}, 0.015, 0.11);
      plan.member('box', 'steel', a, {...a, y: a.y + 1.1}, 0.05, 0.05);
      st.railMembers += 4;
    };
    circleRail(ring, 1);
    circleRail(outer, -1);
    // bridges: straight railings at the envelope, fascia + stripes, piers into the goop
    for (const b of cf.bridges) {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), nx = -uz, nz = ux;
      const a0 = Math.max(ring, Math.hypot(b.x0 - C.x, b.z0 - C.z)), a1 = Math.min(outer, Math.hypot(b.x1 - C.x, b.z1 - C.z));
      const lenB = a1 - a0;
      if (lenB < 0.5) continue;
      for (const side of [-1, 1]) {
        const off = side * b.rail;
        const A = {x: C.x + ux * a0 + nx * off, y: y0, z: C.z + uz * a0 + nz * off}, B = {x: C.x + ux * a1 + nx * off, y: y0, z: C.z + uz * a1 + nz * off};
        const np = Math.max(1, Math.ceil(lenB / 1.25));
        for (let k = 0; k < np; k++) railSpan(lerp(A, B, k / np), lerp(A, B, (k + 1) / np));
        plan.member('box', 'steel', {...B}, {...B, y: y0 + 1.1}, 0.05, 0.05);
        const F0 = {x: A.x + nx * side * 0.03, y: y0 - 0.16, z: A.z + nz * side * 0.03}, F1 = {x: B.x + nx * side * 0.03, y: y0 - 0.16, z: B.z + nz * side * 0.03};
        plan.member('box', 'black', F0, F1, 0.04, 0.32);
        const ns = Math.floor(lenB / 0.5), yaw = Math.atan2(nx * side, nz * side);
        for (let k = 0; k < ns; k++) { const p = lerp(F0, F1, (k + 0.5) / ns); plan.add('stripe', 'yellow', boxMatrix(p.x + nx * side * 0.025, p.y, p.z + nz * side * 0.025, 0.5, 0.27, 1, yaw), coreBand); st.stripes++; }
        // piers: I-beam posts from the goop up under the bridge edge
        const npier = Math.max(1, Math.round(lenB / 2.4));
        for (let k = 0; k <= npier; k++) {
          const p = lerp(F0, F1, k / npier);
          plan.member('ibeam', 'steelDark', {x: p.x, y: yp, z: p.z}, {x: p.x, y: y0 - 0.32, z: p.z}, 0.22, 0.22, new THREE.Vector3(nx * side, 0, nz * side));
          st.piers++;
        }
      }
    }
    // concrete piers under the legs of the towers standing in the goop (the kit's foot plates sit on them at the deck height)
    for (const ti of cf.towers) {
      const t = info.towers[ti];
      if (!t) continue;
      for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const x = t.x + sx * t.hx, z = t.z + sz * t.hz, r = radOf(x, z);
        if (r < cf.vesselR || r > cf.pool.r1 + 7) continue;
        plan.box('concrete', x, (yp + y0) / 2, z, 0.95, y0 - yp, 0.95);
        st.piers++;
      }
    }
  }

  // ---- 5. the turbine generator (spins up at the restart) and its steam line --------------------------------------------------------
  const tb = cf.turbine;
  if (tb) {
    const ax = Math.cos(tb.yaw), az = -Math.sin(tb.yaw), fx = Math.sin(tb.yaw), fz = Math.cos(tb.yaw); // model +X / +Z (front)
    if (!model('turbineGenerator', tb.x, y0, tb.z, tb.yaw)) {
      plan.box('steelDark', tb.x, y0 + 0.4, tb.z, 9.6, 0.8, 2.6, tb.yaw);
      plan.cyl('cyl', 'machine', {x: tb.x - ax * 4.6, y: y0 + 2.0, z: tb.z - az * 4.6}, {x: tb.x - ax * 0.4, y: y0 + 2.0, z: tb.z - az * 0.4}, 2.6);
      plan.cyl('cyl', 'vessel', {x: tb.x + ax * 0.2, y: y0 + 1.9, z: tb.z + az * 0.2}, {x: tb.x + ax * 4.4, y: y0 + 1.9, z: tb.z + az * 4.4}, 2.3);
      st.procedural++;
    }
    // the exciter's cooling fan on the generator housing top (inside its collision box: never in the walkway)
    const fp = {x: tb.x + ax * H.turbineFanX, y: y0 + H.turbineTop, z: tb.z + az * H.turbineFanX};
    out.wheels.push({kind: 'turbine', x: fp.x, y: fp.y + 0.1, z: fp.z, ax: 0, ay: 1, az: 0, r: 0.55});
    plan.cyl('tube', 'steelDark', {...fp, y: fp.y - 0.02}, {...fp, y: fp.y + 0.22}, 1.25); // fan guard ring
    // its status panel on the pit wall behind it (above the casing), facing out
    const wx = tb.x - fx * 1.49, wz = tb.z - fz * 1.49;
    plan.box('machine', wx + fx * 0.08, y0 + 4.45, wz + fz * 0.08, 0.9, 0.55, 0.14, tb.yaw);
    lamp('power', wx + fx * 0.17 - ax * 0.22, y0 + 4.5, wz + fz * 0.17 - az * 0.22, 0.06);
    lamp('rods', wx + fx * 0.17 + ax * 0.22, y0 + 4.5, wz + fz * 0.17 + az * 0.22, 0.06);
    // steam line: from the header ring above it, down onto the casing's steam elbows
    const aT = angOf(tb.x, tb.z);
    run([at(aT, rH, y0 + H.headerY), {x: tb.x, y: y0 + H.headerY + 0.6, z: tb.z}, {x: tb.x, y: y0 + 3.95, z: tb.z}], 0.5, {ignore: true});
  }

  // ---- 6. the restart sites' status lamps: on top of the machine each control sits on ------------------------------------------------
  for (const site of info.sites) {
    const floorY = info.tiers.find(t => t.level === site.level)?.baseY;
    if (floorY === undefined) continue;
    for (const c of site.controls) {
      const g: CoreLampGroup | null = c.id === 'fuse-0' ? 'fuse0' : c.id === 'fuse-1' ? 'fuse1' : c.id === 'breaker' ? 'power' : c.id === 'valve' ? 'valve' : c.id === 'pump' ? 'pump' : c.id === 'keyswitch' ? 'key' : c.id === 'rods' ? 'rods' : null;
      if (!g) continue;
      const piece: ReactorPiece = g === 'fuse0' || g === 'fuse1' || g === 'power' ? 'switchgear' : g === 'valve' ? 'coolantValve' : g === 'pump' ? 'coolantPump' : 'controlConsole';
      const dims = REACTOR_MODELS[piece].dims;
      let bx = c.at.x - c.stand.x, bz = c.at.z - c.stand.z;
      const bl = Math.hypot(bx, bz) || 1; bx /= bl; bz /= bl;
      const x = c.at.x + bx * dims[2] * 0.5, z = c.at.z + bz * dims[2] * 0.5, y = floorY + dims[1];
      plan.cyl('cyl', 'steelDark', {x, y, z}, {x, y: y + 0.07, z}, 0.16);
      lamp(g, x, y + 0.13, z, 0.065, true);
    }
  }

  // ---- 7. the glow lights: green low over the goop in the two widest free arcs, blue over the vessel's CRDM platform -----------------
  {
    const R = (cf.ring.r1 + cf.pool.r1) / 2;
    const taken = [...cf.bridges.map(b => b.angle), ...cf.loops.flatMap(l => [l.sg, l.rcp].filter(Boolean).map(p => angOf(p!.x, p!.z)))];
    const freeAt = (a: number) => Math.min(...taken.map(t => Math.abs(((a - t + 3 * Math.PI) % (2 * Math.PI)) - Math.PI)));
    let best = 0, bv = -1;
    for (let k = 0; k < 72; k++) { const a = (k / 72) * Math.PI * 2, v = freeAt(a); if (v > bv) { bv = v; best = a; } }
    let second = best + Math.PI, sv = -1;
    for (let k = 0; k < 72; k++) { const a = (k / 72) * Math.PI * 2, d = Math.abs(((a - best + 3 * Math.PI) % (2 * Math.PI)) - Math.PI); if (d < Math.PI * 0.55) continue; const v = freeAt(a); if (v > sv) { sv = v; second = a; } }
    out.lights.green.push(at(best, R, y0 + 0.4), at(second, R, y0 + 0.4));
    out.lights.blue.push({x: C.x, y: y0 + H.crdmTop + 1.4, z: C.z});
  }
  void u;
  layouts.set(plan, out);
  return out;
}

/** A geometry turned inside out (reversed winding, negated normals): an open cylinder seen from inside. */
function insideOut(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = g.index;
  if (idx) for (let i = 0; i + 2 < idx.count; i += 3) { const b = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, b); }
  const n = g.attributes.normal;
  if (n) for (let i = 0; i < n.count; i++) n.setXYZ(i, -n.getX(i), -n.getY(i), -n.getZ(i));
  return g;
}

const lerp = (a: P3, b: P3, t: number): P3 => ({x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t});
void memberMatrix; void cylMatrix;

/** Core-floor cell kinds for the builder's surfaces (world/reactor/arch.ts): 0 other, 1 vessel, 2 goop pool, 3 grating deck. */
export const CORE_CELL = {vessel: 1, pool: 2, deck: 3} as const;

/** Per cell of the core grid: the vessel's hidden column, the pool (under the goop mesh), the ring / bridge grating decks. */
export function coreCellKinds(info: ReactorInfo, g: {w: number; h: number; cells: Uint8Array; floor: Float32Array | number[]; blocked: Uint8Array}, cell: number): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  const cf = info.coreFloor;
  if (!cf) return out;
  const R = cf.pool.r1 + 1.5;
  const x0 = Math.max(0, Math.floor((cf.x - R) / cell)), x1 = Math.min(g.w - 1, Math.ceil((cf.x + R) / cell));
  const y0 = Math.max(0, Math.floor((cf.z - R) / cell)), y1 = Math.min(g.h - 1, Math.ceil((cf.z + R) / cell));
  for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
    const i = cy * g.w + cx;
    if (g.cells[i] !== 1) continue; // FLOOR
    const px = (cx + 0.5) * cell - cf.x, pz = (cy + 0.5) * cell - cf.z, r = Math.hypot(px, pz), f = g.floor[i];
    if (Math.abs(f - cf.pool.floorY) < 1e-3) { out[i] = CORE_CELL.pool; continue; }
    if (g.blocked[i] && r <= cf.vesselR + 0.5 && f > cf.y + 0.5) { out[i] = CORE_CELL.vessel; continue; }
    if (Math.abs(f - cf.y) > 1e-3 || g.blocked[i]) continue;
    if (r < cf.ring.r1 + 0.6) { out[i] = CORE_CELL.deck; continue; }
    for (const b of cf.bridges) {
      const ux = Math.cos(b.angle), uz = Math.sin(b.angle), along = px * ux + pz * uz;
      if (along > cf.ring.r1 - 0.8 && along < cf.pool.r1 + 0.6 && Math.abs(-px * uz + pz * ux) < b.rail + 0.3) { out[i] = CORE_CELL.deck; break; }
    }
  }
  return out;
}
