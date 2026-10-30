// Task office-overhaul-20261030 (lane STRUCT, feedback item 10): the ROOF of the office tower — the final place you can visit,
// reached by a real access ladder. Pure data (carving into the generator Kit, then post-crop records / dressing / validation).
//
// - Storey: layout level OFFICE_ROOF_LEVEL (9, role 'roof'), its deck one storey height (4.4 m) above floor 8, over the whole
//   tower interior; an OPEN-SKY storey (Level.sky): the band top is a nominal ROOF.sky above the deck (headroom / light field
//   only) — nothing is built there and rays fly out above it and above the parapet line. The perimeter wall ring stays SOLID
//   (walking bodies are stopped at any height: nobody walks or jumps off) and renders as a 1.1 m parapet with coping; the
//   elevator shaft stays SOLID (the 2.8 m overrun housing; the elevator still serves L-8 only).
// - Access: on floor 8 one core closet of the south strip (the electrical riser, else the janitor / supply closet) becomes
//   "Roof access": a caged steel ladder fixed to its north wall climbs 4.4 m through a 1 x 1 m ceiling hatch (the floor-8 band of
//   the four hatch cells rises into the sky; on the roof grid they are an aperture, so the deck around the opening gets guard
//   rails). The climb is the existing scripted ladder climb with the existing controls ([E] at the ladder / at the hatch edge,
//   Space / S lets go): a traversal.ladders entry of kind 'roof' (no grid nav link) plus a LevelLink {kind: 'ladder', 8 -> 9}
//   WITHOUT traversalId — player reachability follows it, the AI path graph never does (enemies stay on their storeys; 0-2 may
//   already be up there).
// - Dressing (after the station / office dressers, which never touch the roof: its cells are held): roof plant on plinths
//   (TENANTS' roofHvac / waterTower / satelliteDish kinds) plus existing maintenance props, vent stacks / mushroom vents / drains /
//   cable trays / a mast (geometry listed in RoofInfo.structures, collision by hidden railings), and fixture-less overcast daylight
//   over the deck (baked light field; no runtime light). layout.office.roof (RoofInfo); validation roofIssues.

import {Rng, hashString} from '../../core/rng'; // (task gas-mask-roof-feedback-20261030: the roof find's own roll stream)
import {CELL, FLOOR, SOLID} from '../grid';
import type {Kit} from '../stationKit';
import {LADDER, type Ladder} from '../traversal';
import type {LevelLink, LevelSky, RailRun} from '../levels';
import {makePlaceCtx, tryPlaceProp} from '../placeKit';
import {cellsOfBox} from '../placeKit'; // lane ROOF (office-interactions-layout-20261030)
import {PROP_DEFS, type PropKind} from '../props';
import type {Area, LightPlacement, StationLayout} from '../stationTypes';
import type {RoofInfo} from './overhaulTypes';
import {FLOOR_HEIGHT, MARGIN, OFFICE_ROOF_LEVEL, OFFICE_TOP_FLOOR, ROOF, type CoreUnit, type TowerFrame} from './frame';
// Task office-interactions-layout-20261030 (lane ROOF): the roof reward cache (placeRoofReward / roofRewardIssues / roofRewardPose).
import {footprint, type PropPlacement} from '../props';
import {ROOF_CACHE_KEY, ROOF_FIND_KEY, rewardFind, type LootProfile, type RewardFind} from '../../items/lootTables';
// Task gas-mask-roof-feedback-20261030 (item 10): the roof FIND (placeRoofFind) — a weapon's own ammo box follows the weapon-find convention.
import {WEAPON_FIND_AMMO} from '../weaponFinds';

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
/** World metres of a tower-local cell edge. */
const W = (t: number): number => (t + MARGIN) * CELL;
/** Overcast sky through the green haze (linear RGB, ~unit luminance) for the roof's fixture-less daylight. */
export const ROOF_SKY_TINT: readonly [number, number, number] = [0.84, 1.02, 0.84];
/** Keep-clear radius (m) around the hatch / ladder head on the roof and around the ladder foot on floor 8. */
export const HATCH_CLEAR = 1.6;
/** Plinth height (m) under roof plant. */
const PLINTH = 0.2;

/** A rooftop structure the render builds (RoofInfo.structures), with the extra sizes the builder needs. */
export interface RoofStructure { kind: string; x: number; z: number; yaw: number; w?: number; d?: number; h?: number; len?: number; y?: number }

export interface RoofCarve {
  /** The roof deck (level 9) and the floor-8 roof access closet. */
  area: Area;
  closet: Area;
  unit: CoreUnit;
  /** Hatch cells (tower-local): columns [hx0, hx1), rows [hy0, hy1); the ladder column centre (a tower-local cell edge). */
  hx0: number; hx1: number; hy0: number; hy1: number; lc: number;
  base8: number; base9: number;
}

/** The core unit repurposed as the roof access closet (the electrical riser, else the janitor / supply closet). */
export function roofUnit(f: TowerFrame): CoreUnit {
  // Task office-interactions-layout-20261030 (lane LAYOUT): floor 8's plan carves its own ROOF ACCESS room in the core strip (purpose,
  // label and door plate assigned at carve time, gen/office/tower.ts UNIT_SPEC.roof); the old closet pick stays as a fallback only.
  const own = f.plans?.[OFFICE_TOP_FLOOR]?.units.find(u => u.kind === 'roof');
  if (own) return own;
  return f.units.find(u => u.kind === 'riser') ?? f.units.find(u => u.kind === 'janitor') ?? f.units.find(u => u.kind === 'supply') ?? f.units[f.units.length - 1];
}

/**
 * Carves the roof deck (canvas offset ox, oy = tower-local 0, 0) into the kit's roof grid, keeps the shaft solid, opens the hatch
 * (solid on the roof grid, the floor-8 band of its cells rising into the sky) and relabels the floor-8 closet. After floor 8.
 */
export function carveRoof(k: Kit, f: TowerFrame, ox: number, oy: number, base8: number, base9: number): RoofCarve {
  const L = OFFICE_ROOF_LEVEL, g9 = k.grid(L), g8 = k.grid(OFFICE_TOP_FLOOR);
  const unit = roofUnit(f);
  const closet = k.areas[g8.area[g8.idx(ox + unit.x0 + 1, oy + f.sy0 + 3)]];
  closet.label = 'Roof access';
  // Lane LAYOUT (item 4): the room's PURPOSE follows its new use too (normally already set at carve time) — a relabelled riser
  // kept 'electrical-closet', so the dresser plated its door ELECTRICAL under the ROOF ACCESS plate.
  closet.purpose = 'office-roof-access';
  // (parent: the closet — the roof is reached through it; its depth keeps the station's lighting pass from picking the deck)
  const area = k.addArea({x: ox, y: oy, w: f.TW, h: f.TD}, 'room', 'office-roof', r2(base9 + ROOF.sky), closet.id,
    {level: L, floorY: base9, label: 'Roof', publicSpace: false});
  area.lighting = 'dark';
  // A preset purpose without rules keeps the label and keeps the station's purpose assignment off the deck.
  area.purpose = 'office-stair';
  const solid = (x: number, y: number) => { const i = g9.idx(ox + x, oy + y); g9.cells[i] = SOLID; g9.area[i] = -1; g9.floor[i] = 0; g9.ceil[i] = 0; };
  for (let y = f.shaft.y; y < f.shaft.y + f.shaft.h; y++) for (let x = f.shaft.x; x < f.shaft.x + f.shaft.w; x++) solid(x, y);
  const lc = Math.floor((unit.x0 + unit.x1) / 2);
  const hx0 = lc - ROOF.hatch / 2, hx1 = lc + ROOF.hatch / 2, hy0 = f.sy0, hy1 = f.sy0 + ROOF.hatch;
  for (let y = hy0; y < hy1; y++) for (let x = hx0; x < hx1; x++) {
    solid(x, y);
    g8.ceil[g8.idx(ox + x, oy + y)] = r2(base9 + ROOF.sky);
  }
  return {area, closet, unit, hx0, hx1, hy0, hy1, lc, base8, base9};
}

// ---------------------------------------------------------------------------------------------
// After the crop: sky, ladder, link

/** The roof's open-sky rule (Level.sky): parapet coping everywhere closed, the overrun over the elevator shaft. */
export function roofSky(layout: StationLayout, f: TowerFrame, rc: RoofCarve): LevelSky {
  const g = layout.levels[OFFICE_ROOF_LEVEL].grid;
  const tops = new Float32Array(g.w * g.h);
  for (let y = f.shaft.y; y < f.shaft.y + f.shaft.h; y++) for (let x = f.shaft.x; x < f.shaft.x + f.shaft.w; x++) tops[g.idx(x + MARGIN, y + MARGIN)] = r2(rc.base9 + ROOF.overrun);
  return {y: rc.base9, ceil: r2(rc.base9 + ROOF.sky), top: r2(rc.base9 + ROOF.parapet), tops};
}

/** The roof access ladder (world: on the closet's north wall, climbing north over the hatch edge) and its player-only link. */
export function roofLadder(layout: StationLayout, rc: RoofCarve): {ladder: Ladder; link: LevelLink} {
  const x = W(rc.lc), faceZ = W(rc.hy0);
  const dir = -1 as const; // the roof deck the climber steps onto lies north (-z) of the ladder's wall plane
  const bottom = {x, y: rc.base8, z: r3(faceZ - dir * LADDER.standOff)};
  const top = {x, y: rc.base9, z: r3(faceZ + dir * LADDER.topIn)};
  const ladder: Ladder = {
    id: layout.traversal.ladders.length, trench: -1, platform: rc.area.id, x, faceZ, dir, bottomY: rc.base8, topY: rc.base9,
    bottom, top, pair: -1, link: -1, kind: 'roof', level: OFFICE_TOP_FLOOR, topLevel: OFFICE_ROOF_LEVEL,
  };
  const link: LevelLink = {id: layout.levelLinks.length, kind: 'ladder', lower: OFFICE_TOP_FLOOR, upper: OFFICE_ROOF_LEVEL, bottom: {...bottom}, top: {...top}, cost: LADDER.cost};
  return {ladder, link};
}

/** World rect of the hatch opening. */
export function hatchRect(rc: RoofCarve): {x0: number; z0: number; x1: number; z1: number} {
  return {x0: W(rc.hx0), z0: W(rc.hy0), x1: W(rc.hx1), z1: W(rc.hy1)};
}

/** Cells held blocked while the station / office dressers run: the whole deck and the roof access closet. */
export function roofHold(layout: StationLayout, rc: RoofCarve): {level: number; cells: number[]}[] {
  const g9 = layout.levels[OFFICE_ROOF_LEVEL].grid, g8 = layout.levels[OFFICE_TOP_FLOOR].grid;
  const deck: number[] = [], closet: number[] = [];
  for (let i = 0; i < g9.cells.length; i++) if (g9.cells[i] === FLOOR) deck.push(i);
  const c = rc.closet;
  for (let y = c.y; y < c.y + c.h; y++) for (let x = c.x; x < c.x + c.w; x++) if (g8.cells[g8.idx(x, y)] === FLOOR) closet.push(g8.idx(x, y));
  return [{level: OFFICE_ROOF_LEVEL, cells: deck}, {level: OFFICE_TOP_FLOOR, cells: closet}];
}

/** Roof cells over the tower core (stairwell, shaft face, landing strips below): enemies / loot never stand there. */
export function roofCoreCells(layout: StationLayout, f: TowerFrame): {level: number; cells: number[]}[] {
  const g = layout.levels[OFFICE_ROOF_LEVEL].grid, cells: number[] = [];
  for (let y = f.cy0 - 5; y < f.cy1 + 1; y++) for (let x = f.cx0 - 1; x < f.cx1 + 1; x++) { const i = g.idx(x + MARGIN, y + MARGIN); if (g.cells[i] === FLOOR) cells.push(i); }
  return [{level: OFFICE_ROOF_LEVEL, cells}];
}

/**
 * After the dressers: drop whatever they hung on the roof (the deck was held, but room rules still add fixtures / plates) and any
 * fixture or plate that landed in the hatch shaft or in front of the ladder on floor 8.
 */
export function roofStrip(layout: StationLayout, rc: RoofCarve): void {
  const h = hatchRect(rc), L = OFFICE_ROOF_LEVEL;
  const inHatch = (x: number, z: number, pad = 0) => x > h.x0 - pad && x < h.x1 + pad && z > h.z0 - pad && z < h.z1 + pad;
  const lvOf = (o: {level?: number; area?: number}) => o.level ?? layout.areas[o.area ?? -1]?.level ?? 0;
  layout.lights = layout.lights.filter(l => lvOf(l) !== L && !(lvOf(l) === OFFICE_TOP_FLOOR && inHatch(l.x, l.z, 0.4)));
  layout.signs = layout.signs.filter(s => lvOf(s) !== L && !(lvOf(s) === OFFICE_TOP_FLOOR && inHatch(s.x, s.z, 0.6)));
  // (Props are indexed by hosts / composition clusters, so none are removed here: the held deck / closet cells keep them out —
  // roofIssues rejects any that got through.)
}

// ---------------------------------------------------------------------------------------------
// Dressing

/** Tower-local rect test helper. */
interface Box { x0: number; y0: number; x1: number; y1: number }
const inside = (b: Box, x: number, y: number) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;

/**
 * Roof plant and clutter (after the dressers, absolute heights), the open-air fixtures (RoofInfo.structures) with their hidden
 * collision railings, and the overcast daylight. Keeps clear: the core box (elevator overrun, stairwell, landing strips below:
 * the tower's keep-clear rules hold on every storey), HATCH_CLEAR around the hatch and the ladder head, a walkway along the
 * parapet. Returns the structures and the hidden railings.
 */
export function dressRoof(layout: StationLayout, f: TowerFrame, rc: RoofCarve, rng: Rng): {structures: RoofStructure[]; rails: RailRun[]} {
  const L = OFFICE_ROOF_LEVEL, g = layout.levels[L].grid, base = rc.base9;
  const ctx = makePlaceCtx(layout, rng.fork('roof-place'), L);
  const A = rc.area;
  // (the core box reaches north over the elevator landing strip: the tower's keep-clear rules hold on every storey)
  const core: Box = {x0: f.cx0 - 1, y0: f.cy0 - 5, x1: f.cx1 + 1, y1: f.cy1 + 1};
  const hatch = hatchRect(rc);
  const hcx = (hatch.x0 + hatch.x1) / 2, hcz = (hatch.z0 + hatch.z1) / 2;
  // Keep-clear cells: the core box and the hatch surroundings (held in the context's keep mask for the placements below).
  for (let y = 0; y < f.TD; y++) for (let x = 0; x < f.TW; x++) {
    const i = g.idx(x + MARGIN, y + MARGIN);
    const [cx, cz] = g.center(x + MARGIN, y + MARGIN);
    if (inside(core, x, y) || Math.hypot(cx - hcx, cz - hcz) < HATCH_CLEAR + 0.8 || x < 2 || y < 2 || x >= f.TW - 2 || y >= f.TD - 2) ctx.keep[i] = 1;
  }
  const structures: RoofStructure[] = [];
  const rails: RailRun[] = [];
  const placed: {x: number; z: number; hx: number; hz: number}[] = [];
  /** Tower-local candidate spots (cell centres, every 2 cells) in a region, shuffled. */
  const spots = (b: Box): [number, number][] => {
    const out: [number, number][] = [];
    for (let y = b.y0; y < b.y1; y += 2) for (let x = b.x0; x < b.x1; x += 2) out.push([x, y]);
    return rng.shuffle(out);
  };
  const place = (kind: PropKind, regions: Box[], tries: number, plinth: number, ring = 0.9): boolean => {
    const def = PROP_DEFS[kind];
    for (const b of regions) {
      let t = 0;
      for (const [x, y] of spots(b)) {
        if (t++ > tries) break;
        const rot = def.w > def.d + 0.3 && rng.chance(0.5) ? Math.PI / 2 : 0;
        const p = tryPlaceProp(ctx, A, kind, W(x) + CELL / 2, W(y) + CELL / 2, rot, {checkZone: false, ring});
        if (!p) continue;
        p.y = r3(base + plinth);
        if (plinth > 0) structures.push({kind: 'plinth', x: p.x, z: p.z, yaw: 0, w: r3(2 * p.hx + 0.2), d: r3(2 * p.hz + 0.2), h: plinth, y: base});
        placed.push({x: p.x, z: p.z, hx: p.hx, hz: p.hz});
        return true;
      }
    }
    return false;
  };
  const {TW, TD, cx0, cx1, cy0, cy1} = f;
  const N: Box = {x0: 3, y0: 3, x1: TW - 3, y1: cy0 - 2}, S: Box = {x0: 3, y0: cy1 + 2, x1: TW - 3, y1: TD - 3};
  const Wz: Box = {x0: 3, y0: cy0 - 1, x1: cx0 - 2, y1: cy1 + 1}, Ez: Box = {x0: cx1 + 2, y0: cy0 - 1, x1: TW - 3, y1: cy1 + 1};
  const corners: Box[] = rng.shuffle([
    {x0: 3, y0: 3, x1: 14, y1: 12}, {x0: TW - 14, y0: 3, x1: TW - 3, y1: 12},
    {x0: 3, y0: TD - 12, x1: 14, y1: TD - 3}, {x0: TW - 14, y0: TD - 12, x1: TW - 3, y1: TD - 3},
  ]);
  // The landmark first: one water tower on a concrete pad near a corner.
  place('waterTower', corners, 30, 0.15, 1.2);
  // Roof plant: 2-4 packaged HVAC units on plinths (beside the core where ducts drop into the risers, else the bands).
  const hvac = rng.int(2, 4);
  for (let n = 0; n < hvac; n++) place('roofHvac', rng.shuffle([Wz, Ez, N, S]), 40, PLINTH);
  // Dishes near the parapet (1-2), facing out over the city.
  const dishes = rng.int(1, 2);
  for (let n = 0; n < dishes; n++) place('satelliteDish', rng.shuffle([{...S, y0: TD - 7}, {...N, y1: 7}]), 30, 0.1);
  // Existing maintenance kit: pump skid by the tank, a valve manifold, a transformer, an abandoned work site.
  place('waterPumpSkid', corners, 30, 0.1);
  place('pipeValveManifold', rng.shuffle([Wz, Ez]), 30, 0);
  if (rng.chance(0.6)) place('dryTransformer', rng.shuffle([N, S, Ez, Wz]), 30, 0.1);
  for (const kind of rng.shuffle(['portableGenerator', 'gasCylinderCart', 'tripodWorkLight', 'trashBagPile', 'airCompressor'] as PropKind[]).slice(0, rng.int(2, 3))) place(kind, rng.shuffle([N, S]), 30, 0, 0.6);

  // --- Geometry fixtures (RoofInfo.structures) ------------------------------------------------------------------------------
  const free = (x: number, z: number, r: number): boolean => {
    const [cx, cy] = g.cellOf(x, z);
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const i = g.idx(cx + ox, cy + oy); if (g.cells[i] !== FLOOR || g.blocked[i] || ctx.keep[i]) return false; }
    return !placed.some(p => Math.abs(p.x - x) < p.hx + r + 0.6 && Math.abs(p.z - z) < p.hz + r + 0.6);
  };
  const ring = (x: number, z: number, r: number) => {
    // Collision: a hidden square of railings round a small fixture; nav: its cell blocked.
    for (const [ax, az, bx, bz, nx, nz] of [[x - r, z - r, x + r, z - r, 0, -1], [x - r, z + r, x + r, z + r, 0, 1], [x - r, z - r, x - r, z + r, -1, 0], [x + r, z - r, x + r, z + r, 1, 0]] as const)
      rails.push({level: L, x0: r3(ax), z0: r3(az), x1: r3(bx), z1: r3(bz), y0: base, y1: base, nx, nz, kind: 'railing', h: 1.0, hidden: true});
    const [cx, cy] = g.cellOf(x, z);
    g.blocked[g.idx(cx, cy)] = 1;
    placed.push({x, z, hx: r, hz: r});
  };
  const fixture = (kind: string, r: number, n: number, h: number) => {
    let made = 0;
    for (const [tx, ty] of spots({x0: 3, y0: 3, x1: TW - 3, y1: TD - 3})) {
      if (made >= n) break;
      const x = W(tx) + CELL / 2, z = W(ty) + CELL / 2;
      if (!free(x, z, r)) continue;
      structures.push({kind, x: r3(x), z: r3(z), yaw: r3(rng.range(-Math.PI, Math.PI)), h, y: base});
      ring(x, z, r + 0.05);
      made++;
    }
  };
  fixture('mushroomVent', 0.25, rng.int(3, 5), 0.55);
  fixture('ventStack', 0.1, rng.int(4, 7), 1.1);
  // Roof drains (flush grates, no collision) near the parapet.
  for (const [tx, ty] of [[4, 4], [TW - 5, 4], [4, TD - 5], [TW - 5, TD - 5]]) structures.push({kind: 'drain', x: r3(W(tx)), z: r3(W(ty)), yaw: 0, y: base});
  // The hatch housing (curb + open lid + guard rails are the derived aperture rails), the overrun, a mast on the overrun roof.
  structures.push({kind: 'hatch', x: r3(hcx), z: r3(hcz), yaw: 0, w: r3(hatch.x1 - hatch.x0), d: r3(hatch.z1 - hatch.z0), y: base});
  structures.push({kind: 'overrun', x: r3((W(f.shaft.x) + W(f.shaft.x + f.shaft.w)) / 2), z: r3((W(f.shaft.y) + W(f.shaft.y + f.shaft.h)) / 2), yaw: 0,
    w: f.shaft.w * CELL, d: f.shaft.h * CELL, h: ROOF.overrun, y: base});
  // Cable trays on low brackets along two stretches of the parapet (inside its face, out of the walking line).
  for (const side of rng.shuffle(['N', 'S', 'W', 'E'] as const).slice(0, 2)) {
    const alongX = side === 'N' || side === 'S';
    const len = (alongX ? TW : TD) * CELL * rng.range(0.35, 0.6);
    const start = (alongX ? W(0) : W(0)) + rng.range(2, (alongX ? TW : TD) * CELL - len - 2);
    const off = 0.16;
    const fixed = side === 'N' ? W(0) + off : side === 'S' ? W(TD) - off : side === 'W' ? W(0) + off : W(TW) - off;
    structures.push({kind: 'cableTray', x: r3(alongX ? start : fixed), z: r3(alongX ? fixed : start), yaw: alongX ? 0 : Math.PI / 2, len: r3(len), y: base + 0.32});
  }
  return {structures, rails};
}

/** Fixture-less overcast daylight over the deck (after applyLighting: steady), about every 5.5 m, 4.2 m up (below the band top). */
export function roofDaylight(layout: StationLayout, f: TowerFrame, rc: RoofCarve): number {
  const g = layout.levels[OFFICE_ROOF_LEVEL].grid;
  let n = 0;
  const nx = Math.max(2, Math.round(f.TW * CELL / 5.5)), nz = Math.max(2, Math.round(f.TD * CELL / 5.5));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = W(0) + f.TW * CELL * (i + 0.5) / nx, z = W(0) + f.TD * CELL * (j + 0.5) / nz;
    const [cx, cy] = g.cellOf(x, z);
    if (g.cells[g.idx(cx, cy)] !== FLOOR) continue;
    const l: LightPlacement = {
      x: r3(x), y: r2(rc.base9 + 4.2), z: r3(z), rot: 0, area: g.area[g.idx(cx, cy)], broken: false, flicker: false, warm: false,
      power: 0.8, dying: false, virtual: true, tint: ROOF_SKY_TINT, level: OFFICE_ROOF_LEVEL,
    };
    layout.lights.push(l);
    n++;
  }
  return n;
}

/**
 * The layout.office.roof record. Lane ROOF (office-interactions-layout-20261030): `reward` = placeRoofReward's result (undefined:
 * no roof reward for this profile -> no field; null: no spot -> `reward: null`, rejected by roofIssues).
 */
export function roofInfo(layout: StationLayout, rc: RoofCarve, ladder: Ladder, structures: readonly RoofStructure[], reward?: RoofReward | null, find?: RoofFind | null): RoofInfo {
  const props = layout.props.filter(p => p.level === OFFICE_ROOF_LEVEL);
  const info: RoofInfo = {
    level: OFFICE_ROOF_LEVEL, baseY: rc.base9, parapet: ROOF.parapet,
    ladder: {bottom: {...ladder.bottom}, top: {...ladder.top}, yaw: ladder.dir > 0 ? Math.PI : 0, hatch: hatchRect(rc), link: ladder.id},
    structures: [
      ...structures,
      ...props.filter(p => p.kind === 'roofHvac' || p.kind === 'waterTower' || p.kind === 'satelliteDish').map(p => ({kind: p.kind, x: p.x, z: p.z, yaw: p.rot})),
    ],
  };
  if (reward !== undefined) info.reward = reward && {kind: reward.prop.kind, key: ROOF_CACHE_KEY, x: reward.prop.x, y: reward.prop.y, z: reward.prop.z, rot: reward.prop.rot, anchor: reward.anchor};
  if (find !== undefined) info.find = find; // task gas-mask-roof-feedback-20261030 (item 10)
  return info;
}

// ---------------------------------------------------------------------------------------------
// Task office-interactions-layout-20261030 (lane ROOF): THE ROOF REWARD (user 2026-10-30: "There is no loot on the roof. The roof
// is sorta the 'end' of the level so I think there should at least be good item up there.")

/** Roof plant the cache is tucked against, by preference tier: the landmark water tower, the HVAC units / pump skid, the rest. */
export const ROOF_CACHE_ANCHORS: readonly (readonly PropKind[])[] = [
  ['waterTower'], ['roofHvac', 'waterPumpSkid'], ['dryTransformer', 'pipeValveManifold', 'portableGenerator', 'airCompressor', 'gasCylinderCart'],
];
/** Least clear gap (m) between the cache and its anchor's plinth (roof plant stands on plinths 0.1 m wider than its footprint). */
const CACHE_GAP = 0.08;
/** Open access strip (m) kept in front of the cache's lid side: the player stands there to open it. */
export const CACHE_FRONT = 0.8;

/** A placed roof reward: the holder prop (loot key ROOF_CACHE_KEY) and the kind of the plant it is tucked against ('' = open deck). */
export interface RoofReward { prop: PropPlacement; anchor: string }

/**
 * Places the roof reward holder (after dressRoof; its own rng fork; depends only on the roof deck, its plant and structures): the
 * profile's ROOF_CACHE_KEY reward table names the holder kind (a crate). It is tucked against the roof plant — the water tower
 * first, else an HVAC unit / the pump skid, else other plant —, its back to the plant, lid side out with a CACHE_FRONT access strip,
 * clear of the core box, the hatch / ladder head (the same keep-clear rules as dressRoof), the parapet walkway, every plinth / vent /
 * structure, the deck staying connected (tryPlaceProp). Fallback: any free deck spot. The holder gets `purpose = ROOF_CACHE_KEY`, so
 * ContainerManager rolls the curated reward (items/lootTables.ts ROOF_CACHE) ONCE; run memory keeps what was taken (holderKey).
 * Returns undefined when the profile has no roof reward, null when no spot was found (roofIssues rejects the attempt).
 */
export function placeRoofReward(layout: StationLayout, f: TowerFrame, rc: RoofCarve, structures: readonly RoofStructure[], rng: Rng, loot: LootProfile): RoofReward | null | undefined {
  const reward = loot.tables.rewards?.[ROOF_CACHE_KEY];
  if (!reward || !(reward.holder in PROP_DEFS)) return undefined;
  const kind = reward.holder as PropKind;
  const L = OFFICE_ROOF_LEVEL, g = layout.levels[L].grid, A = rc.area;
  const ctx = makePlaceCtx(layout, rng.fork('place'), L);
  const core: Box = {x0: f.cx0 - 1, y0: f.cy0 - 5, x1: f.cx1 + 1, y1: f.cy1 + 1};
  const hatch = hatchRect(rc), hcx = (hatch.x0 + hatch.x1) / 2, hcz = (hatch.z0 + hatch.z1) / 2;
  for (let y = 0; y < f.TD; y++) for (let x = 0; x < f.TW; x++) {
    const [cx, cz] = g.center(x + MARGIN, y + MARGIN);
    if (inside(core, x, y) || Math.hypot(cx - hcx, cz - hcz) < HATCH_CLEAR + 0.8 || x < 2 || y < 2 || x >= f.TW - 2 || y >= f.TD - 2) ctx.keep[g.idx(x + MARGIN, y + MARGIN)] = 1;
  }
  // Structure footprints (plinths, vents, hatch, overrun; drains are flush and cable trays hug the parapet): never overlapped.
  const solids = structures.filter(s => s.kind !== 'drain' && s.kind !== 'cableTray')
    .map(s => ({x: s.x, z: s.z, hx: s.w !== undefined ? s.w / 2 : 0.35, hz: s.d !== undefined ? s.d / 2 : 0.35}));
  const clear = (x: number, z: number, hx: number, hz: number) => solids.every(s => Math.abs(s.x - x) >= s.hx + hx + 0.05 || Math.abs(s.z - z) >= s.hz + hz + 0.05);
  const put = (x: number, z: number, rot: number): PropPlacement | null => {
    const {hx, hz} = footprint(kind, rot);
    if (!clear(x, z, hx, hz)) return null;
    const p = tryPlaceProp(ctx, A, kind, r3(x), r3(z), rot, {checkZone: false, front: CACHE_FRONT});
    if (!p) return null;
    p.y = r3(rc.base9);
    p.purpose = ROOF_CACHE_KEY;
    return p;
  };
  // Sides of an anchor: [rot (the cache's front faces away from the plant), outward x, outward z]
  const SIDES: readonly [number, number, number][] = [[0, 0, 1], [Math.PI, 0, -1], [Math.PI / 2, 1, 0], [-Math.PI / 2, -1, 0]];
  const plant = layout.props.filter(p => (p.level ?? 0) === L);
  for (const tier of ROOF_CACHE_ANCHORS) {
    for (const a of rng.shuffle(plant.filter(p => tier.includes(p.kind)))) {
      // The plant's outer edge per side: beyond its plinth + CACHE_GAP and beyond its blocked cells (whole cells, up to 0.5 m past
      // its box), so the cache's own cells are free floor right beside it.
      const pad = 0.1 + CACHE_GAP, [bx0, by0, bx1, by1] = cellsOfBox(a.x, a.z, a.hx, a.hz);
      const out = {e: Math.max((bx1 + 1) * CELL + 0.02, a.x + a.hx + pad), w: Math.min(bx0 * CELL - 0.02, a.x - a.hx - pad),
        s: Math.max((by1 + 1) * CELL + 0.02, a.z + a.hz + pad), n: Math.min(by0 * CELL - 0.02, a.z - a.hz - pad)};
      for (const s of rng.shuffle([0, 1, 2, 3])) {
        const [rot, ox, oz] = SIDES[s];
        const {hx, hz} = footprint(kind, rot);
        // slide along the side: its centre, its ends (tucked in by a corner of the plant) or the quarter points, in seeded order
        const reach = Math.max(0, ox ? a.hz - hz : a.hx - hx);
        for (const t of rng.shuffle([0, 1, -1, 0.5, -0.5])) {
          const x = ox ? (ox > 0 ? out.e + hx : out.w - hx) : a.x + t * reach;
          const z = oz ? (oz > 0 ? out.s + hz : out.n - hz) : a.z + t * reach;
          const p = put(x, z, rot);
          if (p) return {prop: p, anchor: a.kind};
        }
      }
    }
  }
  // Fallback: any free deck spot (cell centres every 2 cells), facing a random way.
  for (const [tx, ty] of rng.shuffle(Array.from({length: Math.ceil(f.TW / 2) * Math.ceil(f.TD / 2)}, (_, i) => [2 * (i % Math.ceil(f.TW / 2)), 2 * Math.floor(i / Math.ceil(f.TW / 2))] as [number, number]))) {
    const p = put(W(tx) + CELL / 2, W(ty) + CELL / 2, SIDES[rng.int(0, 3)][0]);
    if (p) return {prop: p, anchor: ''};
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Task gas-mask-roof-feedback-20261030 (user item 10): THE ROOF FIND — "Roof also needs more loot. I got just a med kit in this run
// ... It should have at least 1 gear or weapon item up there." The cache keeps its medicine + ammo box; beside it lies ONE curated
// find (items/lootTables.ts ROOF_FIND): a non-starter long gun with a box of its own caliber, or a protective gear piece.

/** Clear half-size (m) round a find's spot: no prop / plinth / structure / wall within it (a 0.9-1.0 m long gun at any yaw). */
export const FIND_CLEAR = 0.48;
/** Clear half-size (m) round the paired ammo box and its distance band (m) from the gun. */
export const FIND_AMMO_CLEAR = 0.22;
export const FIND_AMMO_GAP: readonly [number, number] = [0.5, 1.1];
/** Rows (cell distance) of deck searched round the cache before the whole deck is scanned (the fallback). */
const FIND_NEAR_M = 4;

/** A placed roof find (the RoofInfo.find record; its pickups carry `reward: ROOF_FIND_KEY`). */
export type RoofFind = NonNullable<RoofInfo['find']>;

/**
 * The roof find's item, rolled ONCE per logical Office level on its own stream (key `reward-find:roof-find` x the level's layout
 * seed: independent of the generation attempt, every storey's draws and the rare-gear roll), from the find's rows minus any row
 * naming the run's start weapon (the starter kit has it). A weapon row brings its own caliber box (WEAPON_FIND_AMMO) when the find
 * pairs ammo. Null: no placeable row.
 */
export function rollRoofFind(layoutSeed: number, find: RewardFind, startWeapon: string): {itemId: string; ammo: {itemId: string; count: number} | null} | null {
  const rows = find.items.filter(([id, w]) => w > 0 && id !== startWeapon);
  if (!rows.length) return null;
  const itemId = new Rng(hashString(`reward-find:${ROOF_FIND_KEY}`, layoutSeed >>> 0)).weighted(rows);
  const pair = find.pairedAmmo ? WEAPON_FIND_AMMO[itemId] : undefined;
  return {itemId, ammo: pair ? {itemId: pair[0], count: pair[1]} : null};
}

/**
 * Lays the profile's roof find on the deck (after every other population: the earlier pickups keep their indices, the find's one or
 * two pickups come last). Spots are VERIFIED, not assumed: a walkable deck cell reachable from the start (`dist`, the ladder link
 * included) under the whole clear square, clear of every roof prop + plinth / vent / hatch / overrun footprint, of the core box and
 * the hatch / ladder head keep-clear radius (findSpotTest). Preference: right beside the roof cache — on the
 * deck at its sides / front corners, so opening the cache shows it —, then the nearest verified deck spots round it, then any
 * verified deck spot (seeded order). A gun's ammo box must fit beside it too, or the gun spot is skipped. Returns undefined when
 * the profile has no roof find, null when nothing fits (roofRewardIssues rejects the attempt: the generator retries).
 */
export function placeRoofFind(layout: StationLayout, f: TowerFrame, rc: RoofCarve, structures: readonly RoofStructure[], dist: readonly Int32Array[], rng: Rng, loot: LootProfile): RoofFind | null | undefined {
  const find = rewardFind(loot, ROOF_FIND_KEY);
  if (!find) return undefined;
  const pick = rollRoofFind(layout.seed, find, layout.startWeapon ?? 'rifle');
  if (!pick) return null;
  const L = OFFICE_ROOF_LEVEL, g = layout.levels[L].grid, d = dist[L];
  const ok = findSpotTest(layout, f, hatchRect(rc), structures, d);
  const r = FIND_CLEAR, ra = FIND_AMMO_CLEAR;
  /** The ammo box spot beside a gun at (x, z): the ring FIND_AMMO_GAP round it, away from the cache first. */
  const ammoSpot = (x: number, z: number, away: number): [number, number] | null => {
    for (const gap of [FIND_AMMO_GAP[0], (FIND_AMMO_GAP[0] + FIND_AMMO_GAP[1]) / 2, FIND_AMMO_GAP[1]]) {
      for (let k = 0; k < 12; k++) {
        const a = away + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 6);
        const ax = r3(x + Math.sin(a) * gap), az = r3(z + Math.cos(a) * gap);
        if (ok(ax, az, ra)) return [ax, az];
      }
    }
    return null;
  };
  const tryAt = (x: number, z: number, away: number): RoofFind | null => {
    x = r3(x); z = r3(z);
    if (!ok(x, z, r)) return null;
    const a = pick.ammo ? ammoSpot(x, z, away) : null;
    if (pick.ammo && !a) return null;
    const y = r3(rc.base9), area = rc.area.id;
    layout.pickups.push({itemId: pick.itemId, count: 1, x, y, z, area, level: L, reward: ROOF_FIND_KEY});
    if (pick.ammo && a) layout.pickups.push({itemId: pick.ammo.itemId, count: pick.ammo.count, x: a[0], y, z: a[1], area, level: L, reward: ROOF_FIND_KEY});
    return {key: ROOF_FIND_KEY, itemId: pick.itemId, x, y, z, ammo: pick.ammo && a ? {...pick.ammo, x: a[0], z: a[1]} : null};
  };
  const cache = layout.props.find(p => p.purpose === ROOF_CACHE_KEY && (p.level ?? 0) === L);
  if (cache) {
    // beside the cache: its two sides (a little forward of its centre) and its two front corners, in seeded order
    const fx = Math.sin(cache.rot), fz = Math.cos(cache.rot), sx = Math.cos(cache.rot), sz = -Math.sin(cache.rot);
    const def = PROP_DEFS[cache.kind as PropKind], hw = (def?.w ?? 0.6) / 2, hd = (def?.d ?? 0.45) / 2;
    const side = rng.chance(0.5) ? 1 : -1;
    const beside: [number, number][] = [];
    for (const s of [side, -side]) beside.push([s * (hw + r + 0.08), 0.15], [s * (hw + r * 0.6), hd + r + 0.2]);
    for (const [a, b] of beside) {
      const x = cache.x + sx * a + fx * b, z = cache.z + sz * a + fz * b;
      const p = tryAt(x, z, Math.atan2(x - cache.x, z - cache.z));
      if (p) return p;
    }
    // the nearest verified deck spots round it (cell centres within FIND_NEAR_M, nearest first)
    const [ccx, ccy] = g.cellOf(cache.x, cache.z), n = Math.ceil(FIND_NEAR_M / CELL), ring: [number, number, number][] = [];
    for (let oy = -n; oy <= n; oy++) for (let ox = -n; ox <= n; ox++) {
      const [x, z] = g.center(ccx + ox, ccy + oy), dd = Math.hypot(x - cache.x, z - cache.z);
      if (dd <= FIND_NEAR_M) ring.push([x, z, dd]);
    }
    ring.sort((p, q) => p[2] - q[2] || p[0] - q[0] || p[1] - q[1]);
    for (const [x, z] of ring) { const p = tryAt(x, z, Math.atan2(x - cache.x, z - cache.z)); if (p) return p; }
  }
  // fallback: any verified deck spot (cell centres of the tower interior, seeded order)
  const all: [number, number][] = [];
  for (let y = 0; y < f.TD; y++) for (let x = 0; x < f.TW; x++) all.push(g.center(x + MARGIN, y + MARGIN));
  for (const [x, z] of rng.shuffle(all)) { const p = tryAt(x, z, rng.range(-Math.PI, Math.PI)); if (p) return p; }
  return null;
}

const SQUARE: readonly (readonly [number, number])[] = [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * The roof find's spot test (placement and validation share it): (x, z) with a clear square of half-size `r` — every cell under it
 * a walkable deck cell of the tower interior reachable from the start (`d`), none in the core box (the parapet walkway is fine: a
 * find lying there is in plain view), outside the hatch / ladder head keep-clear radius, clear of every roof prop (+ its 0.1 m
 * plinth margin) and structure footprint.
 */
function findSpotTest(layout: StationLayout, f: TowerFrame, hatch: {x0: number; z0: number; x1: number; z1: number}, structures: readonly {kind: string; x: number; z: number; w?: number; d?: number}[], d: Int32Array | undefined): (x: number, z: number, r: number) => boolean {
  const L = OFFICE_ROOF_LEVEL, g = layout.levels[L].grid;
  const core: Box = {x0: f.cx0 - 1, y0: f.cy0 - 5, x1: f.cx1 + 1, y1: f.cy1 + 1};
  const hcx = (hatch.x0 + hatch.x1) / 2, hcz = (hatch.z0 + hatch.z1) / 2;
  const solids = [
    ...structures.filter(s => s.kind !== 'drain' && s.kind !== 'cableTray').map(s => ({x: s.x, z: s.z, hx: s.w !== undefined ? s.w / 2 : 0.35, hz: s.d !== undefined ? s.d / 2 : 0.35})),
    ...layout.props.filter(p => (p.level ?? 0) === L).map(p => ({x: p.x, z: p.z, hx: p.hx + 0.1, hz: p.hz + 0.1})),
  ];
  const cellOk = (x: number, z: number) => {
    const [cx, cy] = g.cellOf(x, z);
    if (!g.walkable(cx, cy) || (d && d[g.idx(cx, cy)] < 0)) return false;
    const tx = cx - MARGIN, ty = cy - MARGIN;
    return !inside(core, tx, ty) && tx >= 0 && ty >= 0 && tx < f.TW && ty < f.TD;
  };
  // the centre, the corners and the edge midpoints of the clear square (cells are 0.5 m: no gap between samples ≤ r)
  return (x, z, r) => {
    for (const [ox, oz] of SQUARE) if (!cellOk(x + ox * r, z + oz * r)) return false;
    return Math.hypot(x - hcx, z - hcz) >= HATCH_CLEAR + 0.8 + r && solids.every(s => Math.abs(s.x - x) >= s.hx + r || Math.abs(s.z - z) >= s.hz + r);
  };
}

/**
 * Roof reward invariants (roofIssues): exactly the one recorded holder, on the deck, its access strip reachable (`dist`); task
 * gas-mask-roof-feedback-20261030: the recorded roof find is exactly its pickups (`reward: ROOF_FIND_KEY`: the item, + its ammo box),
 * on the deck, never the start weapon, and — with the tower frame `f` — on spots that pass the placement's own spot test (clear
 * of props / structures / hatch / core / walkway; reachable when `dist` is given).
 */
export function roofRewardIssues(layout: StationLayout, dist?: Int32Array[], f?: TowerFrame): string[] {
  const info = layout.office?.roof;
  if (!info) return [];
  return [...roofCacheIssues(layout, dist), ...roofFindIssues(layout, dist, f)];
}

function roofCacheIssues(layout: StationLayout, dist?: Int32Array[]): string[] {
  const info = layout.office!.roof!;
  const caches = layout.props.filter(p => p.purpose === ROOF_CACHE_KEY);
  if (info.reward === undefined) return caches.length ? [`${caches.length} roof reward holders without a roof reward`] : [];
  if (info.reward === null) return ['roof reward: no spot on the deck'];
  if (caches.length !== 1) return [`${caches.length} roof reward holders`];
  const c = caches[0], R = layout.levels[OFFICE_ROOF_LEVEL], g = R.grid, issues: string[] = [];
  if ((c.level ?? 0) !== OFFICE_ROOF_LEVEL || c.kind !== info.reward.kind || Math.abs(c.x - info.reward.x) > 1e-6 || Math.abs(c.z - info.reward.z) > 1e-6) issues.push('roof reward record');
  if (Math.abs(c.y - R.baseY) > 1e-3) issues.push(`roof reward at y ${c.y}`);
  // the middle of the access strip in front of the lid side (world: front = (sin rot, cos rot); hx / hz are the rotated half extents)
  const fx = Math.round(Math.sin(c.rot)), fz = Math.round(Math.cos(c.rot));
  const [sx, sy] = g.cellOf(c.x + fx * (c.hx + CACHE_FRONT / 2), c.z + fz * (c.hz + CACHE_FRONT / 2));
  if (!g.walkable(sx, sy) || (dist && dist[OFFICE_ROOF_LEVEL][g.idx(sx, sy)] < 0)) issues.push('roof reward access strip blocked / unreachable');
  return issues;
}

function roofFindIssues(layout: StationLayout, dist?: Int32Array[], f?: TowerFrame): string[] {
  const info = layout.office!.roof!, L = OFFICE_ROOF_LEVEL;
  const finds = layout.pickups.filter(p => p.reward === ROOF_FIND_KEY);
  if (info.find === undefined) return finds.length ? [`${finds.length} roof find pickups without a roof find`] : [];
  if (info.find === null) return ['roof find: no verified spot on the deck'];
  const F = info.find, issues: string[] = [];
  const main = finds.filter(p => p.itemId === F.itemId && p.count === 1 && Math.abs(p.x - F.x) < 1e-6 && Math.abs(p.z - F.z) < 1e-6);
  const ammo = F.ammo ? finds.filter(p => p.itemId === F.ammo!.itemId && p.count === F.ammo!.count && Math.abs(p.x - F.ammo!.x) < 1e-6 && Math.abs(p.z - F.ammo!.z) < 1e-6) : [];
  if (main.length !== 1 || (F.ammo ? ammo.length !== 1 : false) || finds.length !== 1 + (F.ammo ? 1 : 0)) return [`roof find pickups (${finds.map(p => `${p.itemId} x${p.count}`).join(', ')}) vs record ${F.itemId}${F.ammo ? ` + ${F.ammo.itemId} x${F.ammo.count}` : ''}`];
  if (F.itemId === (layout.startWeapon ?? 'rifle')) issues.push('roof find is the start weapon');
  const R = layout.levels[L], g = R.grid;
  for (const p of finds) {
    if ((p.level ?? 0) !== L || Math.abs(p.y - R.baseY) > 1e-3) issues.push(`roof find ${p.itemId} off the deck`);
    const [cx, cy] = g.cellOf(p.x, p.z);
    if (!g.walkable(cx, cy) || (dist && dist[L][g.idx(cx, cy)] < 0)) issues.push(`roof find ${p.itemId} not on a walkable / reachable deck cell`);
  }
  // re-verify the spots with the placement's own test (the recorded structures, the frame's core box / walkway)
  if (f) {
    const test = findSpotTest(layout, f, info.ladder.hatch, info.structures, dist?.[L]);
    if (!test(F.x, F.z, FIND_CLEAR)) issues.push(`roof find ${F.itemId} spot not clear`);
    if (F.ammo && !test(F.ammo.x, F.ammo.z, FIND_AMMO_CLEAR)) issues.push(`roof find ammo ${F.ammo.itemId} spot not clear`);
  }
  return issues;
}

/** QA (the browser spot check; the primary wires it into qa.ts): a pose in front of the roof cache, facing it, looking at its lid. */
export function roofRewardPose(layout: StationLayout): {x: number; y: number; z: number; yaw: number; pitch: number; level: number} | null {
  const r = layout.office?.roof?.reward;
  if (!r) return null;
  const d = (PROP_DEFS[r.kind as PropKind]?.d ?? 0.5) / 2, away = d + 0.8;
  return {x: r3(r.x + Math.sin(r.rot) * away), y: r.y, z: r3(r.z + Math.cos(r.rot) * away), yaw: r.rot, pitch: -0.8, level: OFFICE_ROOF_LEVEL};
}

// ---------------------------------------------------------------------------------------------
// QA helpers (the browser spot check: the primary wires them into qa.ts)

/**
 * A pose at the roof ladder: 'bottom' = on floor 8 in the roof access closet, 0.5 m back from the ladder, facing it ("[E] Climb
 * ladder"); 'top' = on the roof deck beside the hatch, facing it, looking down ("[E] Climb down ladder").
 */
export function roofLadderPose(layout: StationLayout, end: 'bottom' | 'top' = 'bottom'): {x: number; y: number; z: number; yaw: number; pitch: number; level: number} | null {
  const l = layout.traversal.ladders.find(q => q.kind === 'roof');
  if (!l) return null;
  // Facing the wall from the closet = facing +dir (north, -z: yaw 0); from the deck the hatch lies -dir (south, +z: yaw PI).
  if (end === 'bottom') return {x: l.bottom.x, y: l.bottomY, z: r3(l.bottom.z - l.dir * 0.5), yaw: l.dir < 0 ? 0 : Math.PI, pitch: 0.35, level: l.level ?? 0};
  return {x: l.top.x, y: l.topY, z: r3(l.top.z + l.dir * 0.45), yaw: l.dir < 0 ? Math.PI : 0, pitch: -0.9, level: l.topLevel ?? 0};
}

// ---------------------------------------------------------------------------------------------
// Validation

/** Roof invariants (generation retry guard + tests). `dist` = the walking distance field from the start (ladders included). */
export function roofIssues(layout: StationLayout, f: TowerFrame, dist: Int32Array[]): string[] {
  const issues: string[] = [];
  const info = layout.office?.roof;
  const L = layout.levels[OFFICE_ROOF_LEVEL], L8 = layout.levels[OFFICE_TOP_FLOOR];
  if (!info || !L) return ['no roof'];
  if (L.role !== 'roof' || !L.sky) issues.push('roof level role / sky');
  if (Math.abs(L.baseY - (L8.baseY + FLOOR_HEIGHT)) > 1e-3 || Math.abs(info.baseY - L.baseY) > 1e-6) issues.push(`roof deck at ${L.baseY}`);
  if (layout.office!.storeys.some(s => s.levelId === OFFICE_ROOF_LEVEL) || layout.office!.elevator.stops.some(s => s.levelId === OFFICE_ROOF_LEVEL)) issues.push('roof is an elevator stop / storey');
  const g = L.grid, g8 = L8.grid;
  // The ladder: a traversal ladder of kind 'roof' without a nav link, a player-only LevelLink, nothing in the AI graph.
  const lads = layout.traversal.ladders.filter(l => l.kind === 'roof');
  if (lads.length !== 1) return [...issues, `${lads.length} roof ladders`];
  const lad = lads[0];
  if (lad.link !== -1 || lad.level !== OFFICE_TOP_FLOOR || lad.topLevel !== OFFICE_ROOF_LEVEL || info.ladder.link !== lad.id) issues.push('roof ladder record');
  const link = layout.levelLinks.find(k => k.kind === 'ladder' && k.upper === OFFICE_ROOF_LEVEL);
  if (!link || link.lower !== OFFICE_TOP_FLOOR || link.traversalId !== undefined) issues.push('roof ladder link (player-only, 8 -> roof)');
  if (layout.levels.some(M => M.grid.links.some(k => k.id === lad.id && (k.pa.y >= L8.baseY - 0.1)))) issues.push('roof ladder in a nav graph');
  // Reachable: the ladder foot from the start by stairs, the whole deck through the ladder.
  const [fx, fy] = g8.cellOf(lad.bottom.x, lad.bottom.z);
  if (dist[OFFICE_TOP_FLOOR][g8.idx(fx, fy)] < 0) issues.push('roof ladder foot unreachable');
  let bad = 0, deck = 0;
  for (let i = 0; i < g.cells.length; i++) if (g.cells[i] === FLOOR && !g.blocked[i]) { deck++; if (dist[OFFICE_ROOF_LEVEL][i] < 0) bad++; }
  if (bad) issues.push(`roof: ${bad} walkable cells unreachable`);
  if (deck * CELL * CELL < 300) issues.push(`roof deck only ${(deck * CELL * CELL).toFixed(0)} m2`);
  // Parapet closed: no walkable roof cell outside the tower interior; every deck edge cell's outside neighbour solid (or the hatch).
  const h = info.ladder.hatch;
  const inHatch = (x: number, z: number, pad = 0) => x > h.x0 - pad && x < h.x1 + pad && z > h.z0 - pad && z < h.z1 + pad;
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) {
    const i = g.idx(x, y);
    const interior = x >= MARGIN && x < MARGIN + f.TW && y >= MARGIN && y < MARGIN + f.TD;
    if (g.cells[i] !== SOLID && !interior) { issues.push(`roof cell ${x},${y} outside the parapet`); y = g.h; break; }
    if (interior) continue;
    // ring / outside: solid on the roof grid
  }
  for (let x = MARGIN - 1; x <= MARGIN + f.TW; x++) for (const y of [MARGIN - 1, MARGIN + f.TD]) if (g.cells[g.idx(x, y)] !== SOLID) issues.push('roof parapet open (N / S)');
  for (let y = MARGIN - 1; y <= MARGIN + f.TD; y++) for (const x of [MARGIN - 1, MARGIN + f.TW]) if (g.cells[g.idx(x, y)] !== SOLID) issues.push('roof parapet open (W / E)');
  // The hatch: closed on the roof grid, the floor-8 band of its cells open into the sky (the climb's free column).
  for (let z = h.z0 + CELL / 2; z < h.z1; z += CELL) for (let x = h.x0 + CELL / 2; x < h.x1; x += CELL) {
    const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
    if (g.cells[i] !== SOLID || g8.cells[i] !== FLOOR || g8.ceil[i] < L.sky!.ceil - 1e-3) issues.push('roof hatch column not open from floor 8 to the sky');
  }
  if (!(lad.top.z < h.z0 || lad.top.z > h.z1) || !inHatch(lad.bottom.x, lad.bottom.z)) issues.push('roof ladder head / foot vs hatch');
  // Nothing in the hatch / ladder zones: props, enemies, pickups.
  for (const p of layout.props) {
    const lv = p.level ?? 0;
    const near = (x: number, z: number, r: number) => Math.abs(p.x - x) < p.hx + r && Math.abs(p.z - z) < p.hz + r;
    if (lv === OFFICE_ROOF_LEVEL && (inHatch(p.x, p.z, p.hx + 1.0) || near(lad.top.x, lad.top.z, 1.0))) issues.push(`prop ${p.kind} in the roof hatch zone`);
    if (lv === OFFICE_TOP_FLOOR && near(lad.bottom.x, lad.bottom.z, 0.9)) issues.push(`prop ${p.kind} at the roof ladder foot`);
    if (lv === OFFICE_ROOF_LEVEL && p.y + p.h > L.sky!.ceil - 0.05) issues.push(`prop ${p.kind} above the roof band`);
  }
  const roofZ = layout.zombies.filter(z => z.level === OFFICE_ROOF_LEVEL);
  if (roofZ.length > 2) issues.push(`${roofZ.length} enemies on the roof`);
  for (const z of roofZ) if (inHatch(z.x, z.z, 2.5)) issues.push('enemy at the roof hatch');
  if (layout.pickups.some(p => p.level === OFFICE_ROOF_LEVEL && inHatch(p.x, p.z, 1))) issues.push('pickup in the roof hatch zone');
  if (!layout.lights.some(l => l.level === OFFICE_ROOF_LEVEL && l.virtual)) issues.push('roof has no daylight');
  issues.push(...roofRewardIssues(layout, dist, f)); // Task office-interactions-layout-20261030 (lane ROOF) + the roof find (gas-mask-roof-feedback-20261030)
  return issues;
}
