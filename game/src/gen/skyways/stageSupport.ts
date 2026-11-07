// Task studio-skyways-rework-20261107-054512-01 (lane VENUE; user: "anime stage stairs must be walkable"): the convention STAGE as a
// real walkable surface. The stage model (assets/models/skyways-con-stage.glb) draws a 1.03 m deck and three steps; until now its
// collision was the deck box plus a full-height box over the steps, and props are solid columns for walking bodies (core/physics.ts:
// nobody stands on a prop), so neither the steps nor the deck could be climbed.
//
// The fix is RUNTIME support built from the stage placement, so it reaches every layout version without touching generation (the
// frozen GAME77 generator's layouts keep their fingerprints): `applySkywaysStageSupport(layout)` — called once per built level AFTER
// the world is drawn (game.ts buildSection: the floor under the stage is never visible, the model draws the deck and the steps) and
// BEFORE the Levels / prop index / path finder / physics are built — lifts the floor of every grid cell under the drawn deck and
// steps to the surface the model draws there (sampled at the cell centre: the upper tread 0.68 m, the lower tread 0.325 m, the deck
// 1.029 m; three risers of 0.33-0.36 m, each within the walking step-up STEP_UP 0.45 and the snap-down 0.4). So:
//  - the real player (and any walker) steps up the treads onto the deck, crosses it and steps / drops back down (gen/levels.ts
//    support, collision: a lifted cell is a ledge from the floor beside it); bullets / sight / physics see the solid stage below the
//    deck; the path finder sees the steps (NAV_STEP) and lets chasing zombies follow up them (the deck edge is a one-way drop);
//  - the stage's own collision boxes (the deck, the steps) stand UNDER the lifted surface: the prop index no longer finds them at a
//    floor (core/physics.ts PropIndex), so they stop blocking the body that walks on them; the deck-top props (the cheer statue)
//    now stand on a floor and collide at deck height;
//  - the truss line at the back of the deck (the goalpost uprights and the backdrop vinyl between them) gets collision-only boxes on
//    the deck (variant 2 of the stage kind, hosted on it; the model draws them), so a body on the deck never walks through the truss.
// The drawn geometry and the support agree to the cell: layout version 3 stands the stage with its deck edge on a cell line
// (gen/skyways/addonConvention.ts), so the deck edge and the riser between the treads land exactly on cell lines and only the
// bottom riser is 8 cm off; the frozen v1 / v2 stages (deck box front on the cell line) are within 0.15 m.

import {CELL, FLOOR} from '../grid';
import type {PropPlacement} from '../props';
import type {StationLayout} from '../stationTypes';
import {SKYWAYS_STAGE, SKYWAYS_STAGE_MODEL_SHIFT} from './addonKinds';

/** A walkable surface of the stage model (model frame: front +Z, x centred, grounded; measured on the cooked GLB 2026-11-07). */
export interface StageSurface { name: string; x0: number; x1: number; z0: number; z1: number; top: number }
/** Deck top (x +-3.95 m, z -2.586 .. 1.665) and the two treads of the front steps (x 2.26 .. 3.54 m). */
export const SKYWAYS_STAGE_SURFACES: readonly StageSurface[] = [
  {name: 'deck', x0: -3.95, x1: 3.95, z0: -2.586, z1: 1.665, top: SKYWAYS_STAGE.deckY},
  {name: 'upper-tread', x0: 2.26, x1: 3.54, z0: 1.665, z1: 2.165, top: 0.682},
  {name: 'lower-tread', x0: 2.26, x1: 3.54, z0: 2.165, z1: 2.586, top: 0.325},
];
/** The deck's front edge (model z): layout version 3 stands it on a cell line. */
export const SKYWAYS_STAGE_DECK_EDGE = 1.665;
/** Floor cells behind the deck's back (within this, m) are lifted to the deck too: no pit between the stage and the wall. */
export const SKYWAYS_STAGE_BACK_FILL = 0.75;
/**
 * Collision-only boxes on the deck (model frame; h above the deck): the backline (the truss back and the backdrop vinyl laced into it)
 * and the two goalpost uprights (|x| 3.47 .. 3.91, z -2.38 .. -1.75 measured; nothing else stands on the deck below 1.9 m).
 */
export const SKYWAYS_STAGE_TRUSS_BOXES: readonly {x0: number; x1: number; z0: number; z1: number; h: number}[] = [
  {x0: -3.95, x1: 3.95, z0: -2.586, z1: -2.34, h: 3.3},
  {x0: -3.93, x1: -3.44, z0: -2.586, z1: -1.73, h: 3.37},
  {x0: 3.44, x1: 3.93, z0: -2.586, z1: -1.73, h: 3.37},
];
/** Variant of the stage kind for the truss boxes (0 = the deck, 1 = the steps' collision; neither draws: the stage model does). */
export const SKYWAYS_STAGE_TRUSS_VARIANT = 2;

export interface StageSupport {
  stage: PropPlacement;
  level: number;
  /** Absolute floor under the stage. */
  base: number;
  /** Lifted cells (grid index, surface name, absolute floor). */
  cells: {i: number; name: string; floor: number}[];
  /** The collision-only truss boxes added on the deck. */
  truss: PropPlacement[];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** World (x, z) -> the stage model's frame (the inverse of the renderer's placement * model shift). */
export function stageModelXZ(st: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(st.rot), s = Math.sin(st.rot), dx = x - st.x, dz = z - st.z;
  return [dx * c - dz * s, dx * s + dz * c - SKYWAYS_STAGE_MODEL_SHIFT];
}
/** Stage model frame -> world (x, z). */
export function stageWorldXZ(st: {x: number; z: number; rot: number}, mx: number, mz: number): [number, number] {
  const c = Math.cos(st.rot), s = Math.sin(st.rot), lz = mz + SKYWAYS_STAGE_MODEL_SHIFT;
  return [st.x + mx * c + lz * s, st.z - mx * s + lz * c];
}
/** The surface the model draws at model (mx, mz), or null (the floor). */
export function stageSurfaceAt(mx: number, mz: number): StageSurface | null {
  for (const s of SKYWAYS_STAGE_SURFACES) if (mx >= s.x0 && mx <= s.x1 && mz >= s.z0 && mz <= s.z1) return s;
  const d = SKYWAYS_STAGE_SURFACES[0];
  if (mx >= d.x0 && mx <= d.x1 && mz < d.z0 && mz >= d.z0 - SKYWAYS_STAGE_BACK_FILL) return {...d, name: 'back-fill'};
  return null;
}

const APPLIED = new WeakMap<StationLayout, StageSupport[]>();

/**
 * Lifts the floor under every convention stage of a built Skyways layout and adds its truss boxes (idempotent per layout). Call after
 * the world is drawn and before levelsOf / PropIndex / PathFinder / physics read the grid. No-op on any other layout.
 */
export function applySkywaysStageSupport(layout: StationLayout): StageSupport[] {
  const done = APPLIED.get(layout);
  if (done) return done;
  const out: StageSupport[] = [];
  APPLIED.set(layout, out);
  if (!layout.skyways || !layout.levels?.length) return out;
  const n0 = layout.props.length;
  for (let si = 0; si < n0; si++) {
    const st = layout.props[si];
    if (st.kind !== 'skywaysConStage' || st.variant !== 0) continue;
    const level = st.level ?? 0, g = layout.levels[level]?.grid;
    if (!g) continue;
    const base = st.y, sup: StageSupport = {stage: st, level, base, cells: [], truss: []};
    // the cells round the stage (its model is 8 x 5.2 m; + the back fill)
    const R = 6.5;
    const cx0 = Math.floor((st.x - R) / CELL), cx1 = Math.floor((st.x + R) / CELL), cy0 = Math.floor((st.z - R) / CELL), cy1 = Math.floor((st.z + R) / CELL);
    const lifted = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      if (!g.inBounds(cx, cy)) continue;
      const i = g.idx(cx, cy);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.area[i] !== st.area || Math.abs(g.floorOf(i) - base) > 0.05) continue;
      const [mx, mz] = stageModelXZ(st, (cx + 0.5) * CELL, (cy + 0.5) * CELL);
      const s = stageSurfaceAt(mx, mz);
      if (!s) continue;
      const f = base + s.top;
      g.floor[i] = f;
      lifted.add(i);
      sup.cells.push({i, name: s.name, floor: r3(f)});
    }
    // the truss line: collision-only boxes hosted on the deck
    for (const b of SKYWAYS_STAGE_TRUSS_BOXES) {
      const corners = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]].map(([mx, mz]) => stageWorldXZ(st, mx, mz));
      const xs = corners.map(c => c[0]), zs = corners.map(c => c[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
      const p: PropPlacement = {kind: 'skywaysConStage', x: r3((x0 + x1) / 2), z: r3((z0 + z1) / 2), y: r3(base + SKYWAYS_STAGE.deckY), rot: st.rot, area: st.area,
        hx: r3((x1 - x0) / 2), hz: r3((z1 - z0) / 2), h: b.h, blocksSight: false, variant: SKYWAYS_STAGE_TRUSS_VARIANT, host: si, ...(level ? {level} : {})};
      layout.props.push(p);
      sup.truss.push(p);
    }
    // path finding: the lifted surface is walkable floor (zombies follow up the steps); the truss line, the back fill behind it and
    // whatever stands on the deck (the cheer statue's plinth) stay blocked
    const onDeck = layout.props.filter((p, k) => p.host === si && k < n0 && p.kind !== 'skywaysConBackdrop' && p.h > 0);
    const under = (i: number, list: readonly PropPlacement[], pad: number) => {
      const x = (i % g.w + 0.5) * CELL, z = (Math.floor(i / g.w) + 0.5) * CELL;
      return list.some(p => Math.abs(p.x - x) < p.hx + pad && Math.abs(p.z - z) < p.hz + pad);
    };
    for (const i of lifted) {
      const c = sup.cells.find(q => q.i === i)!;
      g.blocked[i] = c.name === 'back-fill' || under(i, sup.truss, CELL / 2 - 0.04) || under(i, onDeck, CELL / 2 - 0.04) ? 1 : 0;
    }
    out.push(sup);
  }
  return out;
}
