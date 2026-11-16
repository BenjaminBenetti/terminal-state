// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane GEN): SURFACE RUN's GROUND CARVE — the frame and block plans stamped into
// the district Kit's street-level grid (level 0): junctions, street segments, sidewalks (raised KERB), lots (plazas / parks / parking /
// yards / alleys / the rail corridor), driveways (kerb cuts to grade). Building footprints stay SOLID (their interiors are carved by the
// interior planner, gen/surface/rooms). Every outdoor area is a 'street' area with an open-sky ceiling; the areas are DISJOINT rects
// (junctions + segments partition the carriageways, four strips per block partition its sidewalks, the lot plans tile its lot).

import {FLOOR, SOLID} from '../grid';
import type {Kit} from '../stationKit';
import type {Area, Side} from '../stationTypes';
import {crArea, crContains, type CR, type CityFrame, type FrameBlock} from './cityFrame';
import {KERB, type BlockPlans, type LotPlan} from './cityBlocks';

/** Open-sky band top over outdoor cells (absolute m: headroom / the light field only; LOOK draws the sky). */
export const SKY_CEIL = 40;

/** Ground classes of the street level (GroundMap.cls). */
export const G = {none: 0, junction: 1, road: 2, sidewalk: 3, lot: 4, rail: 5, driveway: 6} as const;

export interface GroundMap {
  /** Per level-0 cell: its G class. */
  cls: Uint8Array;
  /** Outdoor area ids (every one), and per frame record. */
  outdoor: number[];
  /** Area per junction id (a jogged line's two crossings of an avenue overlap: they share ONE merged junction area). */
  junctionArea: number[];
  /** Junction id -> its merged group (the road graph's node) and each group's rect. */
  junctionGroup: number[];
  groupRect: CR[];
  segmentArea: number[];
  lotArea: number[];
  /** Block sidewalk strips: area id per `${block}${side}`. */
  sidewalk: Map<string, number>;
  outerArea: number[];
  /** Area id -> its lot plan (lots only). */
  lotOfArea: Map<number, LotPlan>;
  /** Area id -> the street (line) name it belongs to (segments, junctions, sidewalks). */
  streetOfArea: Map<number, string>;
  /** Driveway cuts (cell rects on the sidewalks, at grade) and the lot side each serves. */
  driveways: (CR & {side: Side})[];
  /** The rail corridor rects (cells) from the cordon to the shed. */
  rail: CR[];
}

const toRect = (r: CR) => ({x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0});

function stampFloor(kit: Kit, r: CR, y: number): void {
  const g = kit.g;
  for (let yy = r.y0; yy < r.y1; yy++) for (let x = r.x0; x < r.x1; x++) g.floor[g.idx(x, yy)] = y;
}

function addOutdoor(kit: Kit, m: GroundMap, r: CR, label: string, cls: number, floorY: number): Area {
  const a = kit.addArea(toRect(r), 'concourse', 'street', SKY_CEIL, -1, {label, publicSpace: true});
  if (floorY !== 0) { stampFloor(kit, r, floorY); a.floorY = floorY; }
  const g = kit.g;
  for (let y = r.y0; y < r.y1; y++) for (let x = r.x0; x < r.x1; x++) m.cls[g.idx(x, y)] = cls;
  m.outdoor.push(a.id);
  return a;
}

/** Block sidewalk strips (N / S span the kerb rect's width, W / E between them). */
export function sidewalkStrips(b: FrameBlock): Record<Side, CR> {
  const k = b.kerb, s = b.sw;
  return {
    N: {x0: k.x0, x1: k.x1, y0: k.y0, y1: k.y0 + s.N},
    S: {x0: k.x0, x1: k.x1, y0: k.y1 - s.S, y1: k.y1},
    W: {x0: k.x0, x1: k.x0 + s.W, y0: k.y0 + s.N, y1: k.y1 - s.S},
    E: {x0: k.x1 - s.E, x1: k.x1, y0: k.y0 + s.N, y1: k.y1 - s.S},
  };
}

/** The sidewalk cells between a lot edge (side `s`) and the carriageway, over the lot's span (or null when the lot is not on that edge). */
export function frontageStrip(b: FrameBlock, r: CR, s: Side): CR | null {
  const lot = b.lot, k = b.kerb;
  if (s === 'N' && r.y0 === lot.y0) return {x0: r.x0, x1: r.x1, y0: k.y0, y1: lot.y0};
  if (s === 'S' && r.y1 === lot.y1) return {x0: r.x0, x1: r.x1, y0: lot.y1, y1: k.y1};
  if (s === 'W' && r.x0 === lot.x0) return {x0: k.x0, x1: lot.x0, y0: r.y0, y1: r.y1};
  if (s === 'E' && r.x1 === lot.x1) return {x0: lot.x1, x1: k.x1, y0: r.y0, y1: r.y1};
  return null;
}

export function carveGround(kit: Kit, f: CityFrame, plans: BlockPlans): GroundMap {
  const g = kit.g;
  const m: GroundMap = {cls: new Uint8Array(g.w * g.h), outdoor: [], junctionArea: [], junctionGroup: [], groupRect: [], segmentArea: [], lotArea: [], sidewalk: new Map(),
    outerArea: [], lotOfArea: new Map(), streetOfArea: new Map(), driveways: [], rail: []};
  const strip = (id: number) => f.strips[id];
  // junction groups: overlapping crossings (a jogged line meets the avenue twice, its two halves' carriageways overlapping) merge into
  // one rect (both lie in the avenue's carriageway, same across-range: the union is a rect)
  const overlaps = (a: CR, b: CR) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  for (const j of f.junctions) {
    const k = m.groupRect.findIndex(r => overlaps(r, j.r));
    if (k < 0) { m.junctionGroup[j.id] = m.groupRect.length; m.groupRect.push({...j.r}); continue; }
    const r = m.groupRect[k];
    m.groupRect[k] = {x0: Math.min(r.x0, j.r.x0), y0: Math.min(r.y0, j.r.y0), x1: Math.max(r.x1, j.r.x1), y1: Math.max(r.y1, j.r.y1)};
    m.junctionGroup[j.id] = k;
  }
  const groupArea: number[] = [];
  m.groupRect.forEach((r, k) => {
    const j = f.junctions.find(q => m.junctionGroup[q.id] === k)!;
    const a = addOutdoor(kit, m, r, `${strip(j.zs).line.name} & ${strip(j.xs).line.name}`, G.junction, 0);
    groupArea.push(a.id);
    m.streetOfArea.set(a.id, strip(j.xs).line.rank === 'avenue' ? strip(j.xs).line.name : strip(j.zs).line.name);
  });
  for (const j of f.junctions) m.junctionArea[j.id] = groupArea[m.junctionGroup[j.id]];
  for (const s of f.segments) {
    const a = addOutdoor(kit, m, s.r, s.line.name, G.road, 0);
    m.segmentArea.push(a.id);
    m.streetOfArea.set(a.id, s.line.name);
  }
  const outerNames = [f.zl[0][0].name, f.zl[0][8].name, f.xl[0][0].name, f.xl[0][8].name];
  f.outer.forEach((r, k) => {
    const a = addOutdoor(kit, m, r, `${outerNames[k]} sidewalk`, G.sidewalk, KERB);
    m.outerArea.push(a.id);
    m.streetOfArea.set(a.id, outerNames[k]);
  });
  for (const b of f.blocks) {
    const st = sidewalkStrips(b);
    for (const s of ['N', 'S', 'W', 'E'] as const) {
      if (crArea(st[s]) <= 0) continue;
      const a = addOutdoor(kit, m, st[s], `${b.lines[s].name} sidewalk`, G.sidewalk, KERB);
      m.sidewalk.set(`${b.id}${s}`, a.id);
      m.streetOfArea.set(a.id, b.lines[s].name);
    }
  }
  for (const l of plans.lots) {
    const a = addOutdoor(kit, m, l.r, l.label, l.use === 'rail' ? G.rail : G.lot, l.grade);
    m.lotArea.push(a.id);
    m.lotOfArea.set(a.id, l);
    if (l.diagonal) (a as Area & {diagonal?: boolean}).diagonal = true;
  }
  // building footprints: SOLID (an outdoor stamp never reached them; re-assert for safety)
  for (const b of plans.buildings) for (let y = b.r.y0; y < b.r.y1; y++) for (let x = b.r.x0; x < b.r.x1; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== SOLID) { g.cells[i] = SOLID; g.area[i] = -1; g.ceil[i] = 0; g.floor[i] = 0; m.cls[i] = G.none; }
  }
  // driveways: a kerb cut at grade through the sidewalk in front of each at-grade lot side that asks for one
  for (const l of plans.lots) {
    const b = f.blocks[l.block];
    for (const s of l.driveways) {
      const fs = frontageStrip(b, l.r, s);
      if (!fs) continue;
      const alongX = s === 'N' || s === 'S';
      const span = alongX ? fs.x1 - fs.x0 : fs.y1 - fs.y0;
      const full = l.use === 'alley' || l.use === 'rail';
      const w = full ? span : Math.min(span - 2, 16);
      if (w < 8) continue;
      const o = Math.floor((span - w) / 2);
      const cut: CR = alongX ? {x0: fs.x0 + o, x1: fs.x0 + o + w, y0: fs.y0, y1: fs.y1} : {x0: fs.x0, x1: fs.x1, y0: fs.y0 + o, y1: fs.y0 + o + w};
      stampFloor(kit, cut, 0);
      for (let y = cut.y0; y < cut.y1; y++) for (let x = cut.x0; x < cut.x1; x++) m.cls[g.idx(x, y)] = l.use === 'rail' ? G.rail : G.driveway;
      m.driveways.push({...cut, side: s});
    }
  }
  // the rail corridor: from the cordon edge to the shed's spur face (at grade across sidewalks; the streets are at grade already)
  const D = f.blocks[plans.depot], sp = plans.spur;
  const lot = D.lot;
  const yardSide = sp.dir;
  const corridor: CR = sp.dir === 'W' ? {x0: f.ext.x0, x1: lot.x0, y0: sp.v - sp.half, y1: sp.v + sp.half}
    : sp.dir === 'E' ? {x0: lot.x1, x1: f.ext.x1, y0: sp.v - sp.half, y1: sp.v + sp.half}
    : sp.dir === 'N' ? {x0: sp.v - sp.half, x1: sp.v + sp.half, y0: f.ext.y0, y1: lot.y0}
    : {x0: sp.v - sp.half, x1: sp.v + sp.half, y0: lot.y1, y1: f.ext.y1};
  void yardSide;
  for (let y = corridor.y0; y < corridor.y1; y++) for (let x = corridor.x0; x < corridor.x1; x++) {
    const i = g.idx(x, y);
    if (g.cells[i] !== FLOOR) continue;
    g.floor[i] = 0;
    m.cls[i] = G.rail;
  }
  m.rail.push(corridor);
  return m;
}

/** Is level-0 cell (x, y) an outdoor walkable cell (FLOOR of an outdoor area)? */
export function isOutdoorCell(kit: Kit, m: GroundMap, x: number, y: number, outdoorSet: ReadonlySet<number>): boolean {
  const g = kit.g;
  if (!g.inBounds(x, y)) return false;
  const i = g.idx(x, y);
  return g.cells[i] === FLOOR && outdoorSet.has(g.area[i]) && m.cls[i] !== G.none;
}

export {crContains};
