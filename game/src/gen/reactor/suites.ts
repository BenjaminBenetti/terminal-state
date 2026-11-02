// Task reactor-playtest-round2-20261102 (lane ARRIVAL, Reactor-wide flow variety): THE ROCK SUITES — user (play test 2): "the layout of
// reactor / reactor side areas is much to normal right now. Just like the subway it should be random! with logical rooms flowing in to
// one another! It should feel exploring a coherent space for the first time every time you play a new generation of the map!".
//
// The restart rooms (switchgear, control room, pump hall, rim office, the three maintenance stores) keep their direct deck doors (the
// restart sites are framed on their pit wall). Everything else cut into the rock round the pit is a seeded GRAPH GRAMMAR of suites, per
// storey (rim, tiers 1-4, the core floor):
//   suite    := entry corridor (a staff door in the pit wall from a deck, straight into the rock)
//               + cross corridor (a T or an L at its end, parallel to the wall)
//               + rooms on either side of the cross corridor (each with its door onto it)
//               [+ loop: a return corridor from the cross corridor's end back to the pit wall, a second deck door — a through route]
//               [+ enfilade doors between neighbouring rooms]  [+ a back door into a neighbouring restart room / store]
//   rooms    := a themed program per storey role (crew facilities up top, instruments / valves mid-shaft, the electrical annex deep, health
//               physics on the core floor, crane services on the rim) — logical neighbours in their program order.
// Count, wall, position along it, corridor lengths / widths, T vs L, room sizes / count / sides, loops and links all vary with the seed.
// Pure data, canvas cells (before the crop); draws only from its own fork. Every rect keeps a 1-cell rock wall to everything it does not
// join, stays out of the side-complex regions of its storey, keeps a slab to every other storey's open cells (band-safe), and keeps the
// first two rock rows behind the pit wall free outside its doorway corridors (the extraction fans' duct housings need them).

import type {Rng} from '../../core/rng';
import {CELL, FLOOR, SOLID, type Grid} from '../grid';
import {SLAB} from '../levelGen';
import type {Kit} from '../stationKit';
import type {Area, AreaKind, Rect, RoomType} from '../stationTypes';
import type {ReactorSuiteInfo} from './reactorTypes';
import {CLEAR, CORE_LEVEL, ORG, reactorStoreyLabel} from './frame';

type WallId = 'stair' | 'organ' | 'N' | 'S';

/** A carved suite (canvas cells; the crop origin is (0, 0), so these are grid cells too). */
export interface SuiteRec {
  level: number;
  wall: WallId;
  theme: string;
  /** Corridor areas (entry first), room areas (program order). */
  corridors: number[];
  rooms: number[];
  /** Deck doors (canvas rects): the entry's first; a loop adds a second. */
  deckDoors: Rect[];
  /** Doors inside the suite (room <-> corridor, enfilade, back doors), as [a, b] area pairs. */
  links: [number, number][];
  loop: boolean;
  shape: 'T' | 'L';
}

export interface SuiteInput {
  k: Kit;
  rng: Rng;
  bases: readonly number[];
  PX0: number; PZ0: number; PW: number; PD: number;
  coreW: number; coreH: number;
  cx: (px: number) => number;
  rectC: (px: number, pz: number, w: number, h: number) => Rect;
  /** Deck area ids (a suite's deck door opens onto one of them). */
  deckIds: ReadonlySet<number>;
  /** A rect of storey `lv` that may not be used (a side-complex region). */
  blocked: (r: Rect, lv: number) => boolean;
  /** The restart rooms / stores already carved (a suite may open a back door into one). */
  rooms: readonly {key: string; level: number; area: number; rect: Rect}[];
}

/** Suite counts per storey (rim, tiers 1-4, the core floor). */
export const SUITE_COUNT: readonly [number, number][] = [[0, 1], [1, 2], [1, 2], [1, 2], [1, 2], [1, 2]];

interface RoomDef { type: RoomType; label: string; purpose: string; kind?: AreaKind; ceil?: number; small?: boolean }
const R = (type: RoomType, label: string, purpose: string, o: Partial<RoomDef> = {}): RoomDef => ({type, label, purpose, ...o});
/** Themed programs by storey role: the anchor first (always placed when a room fits), then the rest in a seeded order. */
const THEMES: Record<'rim' | 'upper' | 'middle' | 'deep' | 'core', {name: string; rooms: RoomDef[]}[]> = {
  rim: [
    {name: 'Crane services', rooms: [R('crew-room', "Crane operators' room", 'staff-room'), R('storage', 'Rigging store', 'storage', {ceil: 3.2}), R('utility', 'Crane switch room', 'electrical-room')]},
  ],
  upper: [
    {name: 'Crew facilities', rooms: [R('crew-room', 'Locker room', 'locker-room'), R('washroom', 'Wash room', 'washroom'), R('crew-room', 'Mess room', 'staff-room'), R('utility', 'First-aid post', 'first-aid-room'), R('janitor-closet', 'Cleaner\'s closet', 'janitor-closet', {kind: 'closet', small: true})]},
    {name: 'Maintenance', rooms: [R('utility', 'Workshop', 'workshop'), R('storage', 'Tool store', 'storage', {ceil: 3.2}), R('crew-room', 'Fitters\' room', 'staff-room'), R('supply-closet', 'Parts closet', 'supply-closet', {kind: 'closet', small: true})]},
  ],
  middle: [
    {name: 'Valve gallery', rooms: [R('utility', 'Valve room', 'pump-room'), R('utility', 'Instrument workshop', 'workshop'), R('storage', 'Gasket store', 'storage', {ceil: 3.2}), R('janitor-closet', 'Electrical closet', 'electrical-closet', {kind: 'closet', small: true})]},
    {name: 'Cable vaults', rooms: [R('utility', 'Cable vault', 'electrical-room'), R('utility', 'Relay room', 'signal-room'), R('storage', 'Cable drum store', 'storage', {ceil: 3.2})]},
  ],
  deep: [
    {name: 'Electrical annex', rooms: [R('utility', 'Battery room', 'electrical-room'), R('utility', 'Protection relay room', 'signal-room'), R('crew-room', 'Shift office', 'staff-room'), R('storage', 'Filter store', 'storage', {ceil: 3.2})]},
    {name: 'Coolant services', rooms: [R('utility', 'Make-up pump room', 'pump-room'), R('utility', 'Sampling workshop', 'workshop'), R('storage', 'Chemical store', 'custodial-room', {ceil: 3.2})]},
  ],
  core: [
    {name: 'Health physics', rooms: [R('agent-office', 'Health physics office', 'agent-office'), R('washroom', 'Decontamination showers', 'washroom'), R('utility', 'Sample lab', 'first-aid-room'), R('storage', 'Spares store', 'storage', {ceil: 3.2})]},
    {name: 'Reactor services', rooms: [R('utility', 'Rod drive workshop', 'workshop'), R('utility', 'Instrument room', 'signal-room'), R('crew-room', 'Operators\' rest room', 'staff-room'), R('supply-closet', 'Supply closet', 'supply-closet', {kind: 'closet', small: true})]},
  ],
};
const roleOf = (lv: number) => (lv === 0 ? 'rim' : lv === CORE_LEVEL ? 'core' : lv <= 2 ? 'upper' : lv === 3 ? 'middle' : 'deep') as keyof typeof THEMES;

/** Why suite attempts failed (QA / tests). */
export const SUITE_STATS = {tries: 0, placed: 0, misses: {} as Record<string, number>};
const miss = (why: string) => { SUITE_STATS.misses[why] = (SUITE_STATS.misses[why] ?? 0) + 1; };

/** Carves every storey's suites. Called by carveReactor after the restart rooms (before the core floor and the column stack). */
export function carveSuites(inp: SuiteInput): SuiteRec[] {
  const out: SuiteRec[] = [];
  for (let lv = 0; lv < inp.bases.length; lv++) {
    const rng = inp.rng.fork(`suites-${lv}`);
    const want = rng.int(...SUITE_COUNT[lv]);
    const themes = rng.shuffle(THEMES[roleOf(lv)].slice());
    for (let n = 0, tries = 0; n < want && tries < 40; tries++) {
      SUITE_STATS.tries++;
      const s = trySuite(inp, lv, themes[n % themes.length], rng);
      if (s) { out.push(s); n++; SUITE_STATS.placed++; }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

/** Wall-local cell frame: a along the wall (0 .. len), d inward from it (d = -1 the wall row, d = -2 the deck's first row). */
function canon(inp: SuiteInput, w: WallId, a: number, d: number): [number, number] {
  switch (w) {
    case 'stair': return [-2 - d, a];
    case 'organ': return [inp.PW + 1 + d, a];
    case 'N': return [a, -2 - d];
    default: return [a, inp.PD + 1 + d];
  }
}
function wrect(inp: SuiteInput, w: WallId, a0: number, wa: number, d0: number, dd: number): Rect {
  const [pa, pb] = canon(inp, w, a0, d0), [qa, qb] = canon(inp, w, a0 + wa - 1, d0 + dd - 1);
  return inp.rectC(Math.min(pa, qa), Math.min(pb, qb), Math.abs(pa - qa) + 1, Math.abs(pb - qb) + 1);
}
const wallLen = (inp: SuiteInput, w: WallId) => (w === 'stair' || w === 'organ' ? inp.PD : inp.PW);

interface Plan { a0: number; wa: number; d0: number; dd: number; rect: Rect }

function trySuite(inp: SuiteInput, lv: number, theme: {name: string; rooms: RoomDef[]}, rng: Rng): SuiteRec | null {
  const {k} = inp, g = k.grid(lv), base = inp.bases[lv];
  const walls = rng.shuffle<WallId>(['stair', 'organ', 'N', 'S']);
  const w = walls[0], L = wallLen(inp, w);
  const at = (a: number, d: number) => { const [px, pz] = canon(inp, w, a, d); return g.idx(inp.cx(px), inp.PZ0 + pz); };
  /** Wall-local rect + 1-cell margin: rock on this storey except cells of `allow`; band-safe on the others; inside the core canvas. */
  const planned: Rect[] = [];
  const fits = (p: Plan, allow: ReadonlySet<number>, ceil: number, joins: readonly Rect[] = []): boolean => {
    const r = p.rect;
    if (r.x < ORG + 2 || r.y < ORG + 2 || r.x + r.w > inp.coreW - ORG - 2 || r.y + r.h > inp.coreH - ORG - 2) return false;
    if (inp.blocked(r, lv)) return false;
    for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
      const i = g.idx(x, y), inner = x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
      if (g.cells[i] !== SOLID && !(!inner && allow.has(g.area[i]))) return false;
      // this suite's earlier rects: only the ones it joins may touch it
      if (!inner) for (const q of planned) if (!joins.includes(q) && x >= q.x && y >= q.y && x < q.x + q.w && y < q.y + q.h) return false;
    }
    for (const q of planned) if (r.x < q.x + q.w && q.x < r.x + r.w && r.y < q.y + q.h && q.y < r.y + r.h) return false;
    // band-safe: a slab to every other storey's open cells in these columns (+ the margin)
    for (let L = 0; L < inp.bases.length; L++) {
      if (L === lv) continue;
      const gL = k.grid(L), above = inp.bases[L] > base;
      for (let y = r.y - 1; y <= r.y + r.h; y++) for (let x = r.x - 1; x <= r.x + r.w; x++) {
        const i = gL.idx(x, y);
        if (gL.cells[i] === SOLID) continue;
        if (above ? gL.floorOf(i) < ceil + SLAB + 0.05 : gL.ceil[i] > base - SLAB - 0.05) return false;
      }
    }
    return true;
  };
  const plan = (a0: number, wa: number, d0: number, dd: number): Plan => ({a0, wa, d0, dd, rect: wrect(inp, w, a0, wa, d0, dd)});
  /** Deck front cells (d = -2) of [a0, a0 + n) + one each side: flat floor of ONE deck area of this storey. */
  const deckFront = (a0: number, n: number): number => {
    let front = -1;
    for (let t = -1; t <= n; t++) {
      if (a0 + t < 0 || a0 + t >= L) return -1;
      const i = at(a0 + t, -2);
      if (g.cells[i] !== FLOOR || g.rampIdx[i] >= 0 || g.blocked[i] || Math.abs(g.floor[i] - base) > 0.01 || !inp.deckIds.has(g.area[i])) return -1;
      if (t >= 0 && t < n) { if (front >= 0 && g.area[i] !== front) return -1; front = g.area[i]; }
    }
    return front;
  };

  // --- entry corridor --------------------------------------------------------------------------------------------------------------
  const cw = rng.int(5, 6), Lc = rng.int(9, 15);
  const starts: number[] = [];
  for (let a = 2; a + cw <= L - 2; a++) starts.push(a);
  rng.shuffle(starts);
  let entry: Plan | null = null, front = -1, doorA = 0;
  const DW = 4;
  for (const a of starts.slice(0, 60)) {
    const da = a + Math.floor((cw - DW) / 2), f = deckFront(da, DW);
    if (f < 0) continue;
    const p = plan(a, cw, 0, Lc);
    if (!fits(p, new Set(), base + 3.0)) continue;
    entry = p; front = f; doorA = da;
    break;
  }
  if (!entry) { miss('entry'); return null; }
  planned.push(entry.rect);
  // --- cross corridor (T or L) -----------------------------------------------------------------------------------------------------
  const cw2 = rng.int(4, 5);
  const shape: 'T' | 'L' = rng.chance(0.55) ? 'T' : 'L';
  let eL = shape === 'T' ? rng.int(6, 16) : 0, eR = shape === 'T' ? rng.int(6, 16) : rng.int(14, 26);
  if (shape === 'L' && rng.chance(0.5)) { eL = eR; eR = 0; }
  let cross: Plan | null = null;
  for (let shrink = 0; shrink < 4 && !cross; shrink++) {
    const l = Math.max(0, eL - shrink * 4), r = Math.max(0, eR - shrink * 4);
    if (l + r < 8) break;
    const p = plan(entry.a0 - l, cw + l + r, Lc, cw2);
    if (fits(p, new Set(), base + 3.0, [entry.rect])) cross = p;
  }
  if (!cross) { planned.pop(); miss('cross'); return null; }
  planned.push(cross.rect);

  // --- rooms along the cross corridor (far side, then the near side between it and the pit wall) ----------------------------------
  type RoomPlan = {p: Plan; def: RoomDef; side: 'far' | 'near'};
  const program = [theme.rooms[0], ...rng.shuffle(theme.rooms.slice(1))];
  const roomPlans: RoomPlan[] = [];
  const nearDepth = Lc - 3; // rows d in [2, Lc - 1): the two rock rows behind the pit wall stay rock
  const sides: ('far' | 'near')[] = nearDepth >= 6 && rng.chance(0.6) ? ['far', 'near'] : ['far'];
  for (const side of sides) {
    let a = cross.a0 + rng.int(0, 2);
    const aEnd = cross.a0 + cross.wa;
    while (a < aEnd - 4 && program.length) {
      const def = program[0];
      // rooms >= 5 x 5 m (the purposes' minimum furnished sizes; a deep storey's room is a Siren's dark alcove: >= 100 cells)
      const wa = Math.min(def.small ? rng.int(5, 6) : rng.int(10, 15), aEnd - a);
      if (wa < (def.small ? 5 : 10)) break;
      const dd = side === 'far' ? (def.small ? rng.int(5, 6) : rng.int(10, 12)) : Math.min(nearDepth, def.small ? 6 : rng.int(8, 11));
      const d0 = side === 'far' ? Lc + cw2 + 1 : Lc - 1 - dd;
      // near side: never across the entry corridor's span
      const p = plan(a, wa, d0, dd);
      const crossesEntry = side === 'near' && a < entry.a0 + entry.wa + 1 && entry.a0 - 1 < a + wa;
      if (!crossesEntry && dd >= (def.small ? 5 : 6) && fits(p, new Set(), base + (def.ceil ?? 3.4))) {
        roomPlans.push({p, def, side});
        planned.push(p.rect);
        program.shift();
        a += wa + 1;
      } else a += 2;
    }
  }
  if (!roomPlans.length) { planned.length = 0; miss('rooms'); return null; }

  // --- loop: a return corridor from the cross corridor's end back to the pit wall (a second deck door) -----------------------------
  let ret: Plan | null = null, retFront = -1, retDoorA = 0;
  if (rng.chance(0.45)) {
    const ends = rng.shuffle([cross.a0, cross.a0 + cross.wa - cw]);
    for (const a of ends) {
      if (Math.abs(a - entry.a0) < cw + 6) continue; // a real loop, not a second door beside the first
      const da = a + Math.floor((cw - DW) / 2), f = deckFront(da, DW);
      if (f < 0) continue;
      const p = plan(a, cw, 0, Lc);
      // it may touch the cross corridor only (rooms keep their wall)
      if (!fits(p, new Set(), base + 3.0, [cross.rect])) continue;
      ret = p; retFront = f; retDoorA = da;
      planned.push(p.rect);
      break;
    }
  }

  // --- commit ----------------------------------------------------------------------------------------------------------------------
  const tag = reactorStoreyLabel(lv);
  const lvOpt = lv ? {level: lv, floorY: base} : {};
  const corridor = (p: Plan, label: string): Area => {
    const a = k.addArea(p.rect, 'service', 'service-corridor', Math.round((base + 3.0) * 100) / 100, front, {...lvOpt, label, publicSpace: false, role: 'reactor-room'});
    a.purpose = 'service-corridor';
    return a;
  };
  const deck = k.areas[front];
  const eA = corridor(entry, `${theme.name} · ${tag}`);
  const cA = corridor(cross, `${theme.name} corridor · ${tag}`);
  const deckDoors: Rect[] = [];
  const links: [number, number][] = [];
  const dDoor = wrect(inp, w, doorA, DW, -1, 1);
  k.carveDoor(dDoor, deck, eA, CLEAR.door, false, {staff: true});
  deckDoors.push(dDoor);
  let rA: Area | null = null;
  if (ret) {
    rA = corridor(ret, `${theme.name} · ${tag}`);
    const r2 = wrect(inp, w, retDoorA, DW, -1, 1);
    k.carveDoor(r2, k.areas[retFront], rA, CLEAR.door, false, {staff: true});
    deckDoors.push(r2);
  }
  const rooms: Area[] = [];
  for (const rp of roomPlans) {
    const def = rp.def;
    const A = k.addArea(rp.p.rect, def.kind ?? 'room', def.type, Math.round((base + (def.ceil ?? 3.4)) * 100) / 100, cA.id, {...lvOpt, label: def.label, publicSpace: false, role: 'reactor-room'});
    A.purpose = def.purpose;
    rooms.push(A);
    // its door onto the cross corridor: the wall row between them, inside both along spans
    const lo = Math.max(rp.p.a0, cross.a0) + 1, hi = Math.min(rp.p.a0 + rp.p.wa, cross.a0 + cross.wa) - 1;
    const dw = Math.min(def.small ? 3 : 4, hi - lo);
    const da = lo + rng.int(0, Math.max(0, hi - lo - dw));
    const dRow = rp.side === 'far' ? Lc + cw2 : Lc - 1;
    k.carveDoor(wrect(inp, w, da, dw, dRow, 1), cA, A, CLEAR.door, false, {});
    links.push([cA.id, A.id]);
  }
  // enfilade: neighbouring rooms on the same side (one wall between them) share a door now and then
  for (let i = 0; i + 1 < roomPlans.length; i++) {
    const p = roomPlans[i], q = roomPlans[i + 1];
    if (p.side !== q.side || q.p.a0 !== p.p.a0 + p.p.wa + 1 || !rng.chance(0.4)) continue;
    const d0 = Math.max(p.p.d0, q.p.d0) + 1, d1 = Math.min(p.p.d0 + p.p.dd, q.p.d0 + q.p.dd) - 1;
    if (d1 - d0 < 3) continue;
    const dw = Math.min(3, d1 - d0), dd0 = d0 + rng.int(0, d1 - d0 - dw);
    k.carveDoor(wrect(inp, w, p.p.a0 + p.p.wa, 1, dd0, dw), rooms[i], rooms[i + 1], CLEAR.door, false, {});
    links.push([rooms[i].id, rooms[i + 1].id]);
  }
  // a back door into a restart room / store of this storey that the cross corridor runs along (one wall cell between them)
  for (const rr of inp.rooms) {
    // stores only: the restart rooms' machines stand against their walls (a back door there could open onto a switchgear bank)
    if (rr.level !== lv || !rr.key.startsWith('store') || !rng.chance(0.7)) continue;
    const door = sharedDoor(cross.rect, rr.rect, 3);
    if (!door) continue;
    k.carveDoor(door, cA, k.areas[rr.area], CLEAR.door, false, {staff: true});
    links.push([cA.id, rr.area]);
    break;
  }
  return {
    level: lv, wall: w, theme: theme.name, corridors: [eA.id, cA.id, ...(rA ? [rA.id] : [])], rooms: rooms.map(a => a.id), deckDoors, links, loop: !!rA, shape,
  };
}

/** A door rect (width `n`) in the one-cell wall between two rects, centred on their overlap; null when they do not share such a wall. */
function sharedDoor(a: Rect, b: Rect, n: number): Rect | null {
  if (a.y + a.h + 1 === b.y || b.y + b.h + 1 === a.y) {
    const s0 = Math.max(a.x, b.x) + 1, s1 = Math.min(a.x + a.w, b.x + b.w) - 1;
    if (s1 - s0 < n) return null;
    return {x: Math.floor((s0 + s1 - n) / 2), y: a.y + a.h + 1 === b.y ? a.y + a.h : b.y + b.h, w: n, h: 1};
  }
  if (a.x + a.w + 1 === b.x || b.x + b.w + 1 === a.x) {
    const s0 = Math.max(a.y, b.y) + 1, s1 = Math.min(a.y + a.h, b.y + b.h) - 1;
    if (s1 - s0 < n) return null;
    return {x: a.x + a.w + 1 === b.x ? a.x + a.w : b.x + b.w, y: Math.floor((s0 + s1 - n) / 2), w: 1, h: n};
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// After the crop

/** Cells held prop-free through the station dresser: 2 m either side of every deck door (the deck apron and the entry's first rows). */
export function suiteHolds(layout: {levels: readonly {grid: Grid}[]}, suites: readonly SuiteRec[]): {level: number; cells: number[]}[] {
  return suites.map(s => {
    const g = layout.levels[s.level].grid, cells: number[] = [];
    for (const d of s.deckDoors) for (let y = d.y - 4; y < d.y + d.h + 4; y++) for (let x = d.x - 4; x < d.x + d.w + 4; x++) {
      if (!g.inBounds(x, y)) continue;
      const i = g.idx(x, y);
      if (g.cells[i] === FLOOR) cells.push(i);
    }
    return {level: s.level, cells};
  });
}

/**
 * After the dressers (before the populations): free floor of `ids` that a flood from `seeds` (door cells) over free cells of `ids` cannot
 * reach is BLOCKED — a corner walled off by furniture (nobody walks, spawns or drops loot there). The office's sealPockets rule
 * (gen/office/companyDress.ts); without it every extra furnished room is another chance of a 2-cell pocket rejecting the attempt.
 */
export function sealPockets(g: Grid, areas: readonly (Rect & {id: number})[], seeds: readonly Rect[]): number {
  const ids = new Set(areas.map(a => a.id));
  const free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && g.rampIdx[i] < 0 && ids.has(g.area[i]);
  const seen = new Uint8Array(g.w * g.h), stack: number[] = [];
  for (const r of seeds) for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
    if (!g.inBounds(x, y)) continue;
    const i = g.idx(x, y);
    if (free(i) && !seen[i]) { seen[i] = 1; stack.push(i); }
  }
  if (!stack.length) return 0;
  while (stack.length) {
    const i = stack.pop()!;
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (j >= 0 && j < seen.length && !seen[j] && free(j)) { seen[j] = 1; stack.push(j); }
  }
  let n = 0;
  for (const a of areas) for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) {
    const i = g.idx(x, y);
    if (g.area[i] === a.id && free(i) && !seen[i]) { g.blocked[i] = 1; n++; }
  }
  return n;
}

/** The record (layout.reactor.suites): world rects of the deck doors. */
export function suiteRecord(suites: readonly SuiteRec[]): ReactorSuiteInfo[] {
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  return suites.map(s => ({
    level: s.level, wall: s.wall, theme: s.theme, corridors: s.corridors.slice(), rooms: s.rooms.slice(), links: s.links.map(([a, b]) => [a, b] as [number, number]),
    loop: s.loop, shape: s.shape, deckDoors: s.deckDoors.map(d => ({x0: r3(d.x * CELL), z0: r3(d.y * CELL), x1: r3((d.x + d.w) * CELL), z1: r3((d.y + d.h) * CELL)})),
  }));
}
