// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): THE FLEERS' REFUGES — where a market person runs and hides once the settlement
// turns hostile (user: "Fleeing survivors must hide in homes, not disappear/despawn"). Pure (the levels' grids + the layout's areas; no
// three.js), seeded on its own hash stream (no game / generator RNG draw).
//  - REFUGES, by preference tier: 0 the homes (layout v2 / v3 'Home' / 'Ground-floor home' containers, on both storeys); 1 a bunk room;
//    2 the store room / storage containers; 3 any other private room (the water point, the latrine, the generator shed, the workshop, the
//    kitchen, the tea / repair counters — and version 1's under-deck workshop / bunk room / kitchen, the only rooms an old market has).
//    Never a stall's area (the traders' shops, the bar), a lane, a catwalk, a gate, a stair, the platform or anything public.
//  - MOUTHS: the refuge's floor cells that open onto another area's floor (a door's cells, an open front). HIDE SLOTS are clear standing
//    points inside, at least `mouthGap` from every mouth cell (nobody stands in a doorway), ranked out of the doorway's line first (no line
//    of sight from a doorway / just outside it at eye height to a cowering head), then the deepest; at most `maxSlots` by floor area,
//    `slotGap` apart. A refuge without a mouth or a slot is no refuge (no fake hidden place).
//  - ASSIGNMENT (RefugeBook): one slot per person, seeded per station + person, homes first, near the person's own place (where it lives /
//    works when the station is built), spread over the refuges (a load penalty); a blocked way home falls back to the next refuge with a
//    free slot (tier, then distance).
import {CELL, FLOOR, type Grid} from '../../gen/grid';
import type {Levels} from '../../gen/levels';
import type {Area} from '../../gen/stationTypes';
import type {MarketLayout} from '../../gen/market/marketTypes';
import {marketStandOk} from '../../gen/market/spots';
import {hashString} from '../../core/rng';

/** Tuning (metres). */
export const REFUGE = {
  /** A slot is at least this far from every mouth cell's centre. */
  mouthGap: 1.25,
  /** Slots of one refuge keep this far apart. */
  slotGap: 0.85,
  /** A slot's body circle clear of walls / blocking props (the people's path radius is 0.34). */
  clear: 0.36,
  /**
   * Viewpoints (someone outside looking in): in front of each doorway (sampled every `viewEvery` along a wide opening), `viewOut` and
   * 2.2 x `viewOut` straight out and `viewOut` out + `viewOut` to either side, at `eye` above its floor.
   */
  viewOut: 1.6, viewEvery: 2.0, eye: 1.6,
  /** A cowering person's head above the floor. */
  head: 0.9,
  /** One slot per this much floor (m²), 1..maxSlots. */
  perM2: 5, maxSlots: 4,
  /** Assignment: metres of detour worth one more person already in a refuge; vertical metres count x3. */
  load: 25, climb: 3,
} as const;

export type RefugeKind = 'home' | 'bunks' | 'store' | 'room';
const TIER: Readonly<Record<RefugeKind, number>> = {home: 0, bunks: 1, store: 2, room: 3};
/** A refuge id ('<kind>:<area>', stable for the layout version a station keeps): record.ts REFUGE_ID. */
export {REFUGE_ID} from '../combat/record';

export interface RefugeSlot {
  x: number; y: number; z: number;
  /** HumanActor yaw facing the nearest mouth (forward = (sin, cos)): the cowering person watches the doorway. */
  yaw: number;
  /** No viewpoint sees the cowering head. */
  hidden: boolean;
}

export interface Refuge {
  id: string;
  kind: RefugeKind;
  tier: number;
  area: number;
  level: number;
  label: string;
  /** The mouth cells' centres (world x / z). */
  mouths: {x: number; z: number}[];
  /** Ranked hide slots (best first). */
  slots: RefugeSlot[];
  /** Mean slot position (assignment distance). */
  cx: number; cy: number; cz: number;
}

/** A refuge's kind by its area (null: not a refuge). */
export function refugeKindOf(a: Area, stallAreas: ReadonlySet<number>): RefugeKind | null {
  if (a.kind !== 'room' || a.publicSpace || stallAreas.has(a.id)) return null;
  const l = (a.label ?? '').trim();
  if (/home$/i.test(l)) return 'home';
  if (/^bunk/i.test(l)) return 'bunks';
  if (/^(store room|storage)$/i.test(l)) return 'store';
  return 'room';
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** The market's refuges (empty without layout.market). Deterministic for a layout. */
export function marketRefuges(layout: {areas: readonly Area[]; market?: MarketLayout}, levels: Levels): Refuge[] {
  const M = layout.market;
  if (!M) return [];
  const stallAreas = new Set(M.stalls.map(s => s.area));
  const out: Refuge[] = [];
  for (const a of layout.areas) {
    const kind = refugeKindOf(a, stallAreas);
    if (!kind) continue;
    const level = a.level ?? 0;
    if (level < 0 || level >= levels.count) continue;
    const r = refugeOf(a, kind, level, levels);
    if (r) out.push(r);
  }
  return out;
}

function refugeOf(a: Area, kind: RefugeKind, level: number, levels: Levels): Refuge | null {
  const G = levels.grid(level);
  // its floor cells (the rect + its door cells in the wall ring: a carved door joins the room) and its mouth cells
  const cells: number[] = [], mouths: number[] = [];
  const outward = new Map<number, [number, number]>();
  for (let y = a.y - 1; y <= a.y + a.h; y++) for (let x = a.x - 1; x <= a.x + a.w; x++) {
    if (!G.inBounds(x, y)) continue;
    const i = G.idx(x, y);
    if (G.area[i] !== a.id || G.cells[i] !== FLOOR) continue;
    cells.push(i);
    let ox = 0, oy = 0;
    for (const [dx, dy] of N4) {
      const nx = x + dx, ny = y + dy;
      if (!G.inBounds(nx, ny)) continue;
      const j = G.idx(nx, ny);
      if (G.cells[j] === FLOOR && G.area[j] !== a.id && Math.abs(G.floorOf(j) - G.floorOf(i)) < 0.5) { ox += dx; oy += dy; }
    }
    if (ox || oy) { mouths.push(i); outward.set(i, [ox, oy]); }
  }
  if (!mouths.length) return null;
  const at = (i: number) => G.center(i % G.w, Math.floor(i / G.w));
  const mouthPts = mouths.map(i => { const [x, z] = at(i); return {x, z}; });
  // viewpoints: someone outside looking in — in front of each doorway (thinned along a wide opening) straight out at two distances and
  // obliquely to either side, at eye height
  const views: {x: number; y: number; z: number}[] = [];
  const picked: {x: number; z: number}[] = [];
  for (const i of mouths) {
    const [x, z] = at(i);
    if (picked.some(p => Math.hypot(p.x - x, p.z - z) < REFUGE.viewEvery)) continue;
    picked.push({x, z});
    const [ox0, oy0] = outward.get(i)!, ol = Math.hypot(ox0, oy0) || 1, ox = ox0 / ol, oz = oy0 / ol, y = G.floorOf(i) + REFUGE.eye;
    const o = REFUGE.viewOut;
    views.push({x: x + ox * o, y, z: z + oz * o}, {x: x + ox * o * 2.2, y, z: z + oz * o * 2.2},
      {x: x + (ox - oz) * o, y, z: z + (oz + ox) * o}, {x: x + (ox + oz) * o, y, z: z + (oz - ox) * o});
  }
  // hide candidates: clear standing points inside the rect, off the doorways
  const cands: {x: number; y: number; z: number; seen: number; deep: number; i: number; mx: number; mz: number}[] = [];
  for (const i of cells) {
    const cx = i % G.w, cy = Math.floor(i / G.w);
    if (cx < a.x || cx >= a.x + a.w || cy < a.y || cy >= a.y + a.h) continue; // (not a door cell in the wall ring)
    const [x, z] = G.center(cx, cy);
    if (!marketStandOk(G, x, z) || !G.circleClear(x, z, REFUGE.clear)) continue;
    let deep = Infinity, mx = 0, mz = 0;
    for (const m of mouthPts) { const d = Math.hypot(m.x - x, m.z - z); if (d < deep) { deep = d; mx = m.x; mz = m.z; } }
    if (deep < REFUGE.mouthGap) continue;
    const y = G.floorOf(i);
    let seen = 0;
    for (const v of views) if (levels.lineOfSight(v, {x, y: y + REFUGE.head, z})) seen++;
    cands.push({x, y, z, seen, deep, i, mx, mz});
  }
  if (!cands.length) return null;
  cands.sort((p, q) => p.seen - q.seen || q.deep - p.deep || p.i - q.i);
  const cap = Math.max(1, Math.min(REFUGE.maxSlots, Math.round(cells.length * CELL * CELL / REFUGE.perM2)));
  const slots: RefugeSlot[] = [];
  for (const c of cands) {
    if (slots.length >= cap) break;
    if (slots.some(s => Math.hypot(s.x - c.x, s.z - c.z) < REFUGE.slotGap)) continue;
    slots.push({x: r3(c.x), y: r3(c.y), z: r3(c.z), yaw: r4(Math.atan2(c.mx - c.x, c.mz - c.z)), hidden: c.seen === 0});
  }
  const n = slots.length;
  return {
    id: `${kind}:${a.id}`, kind, tier: TIER[kind], area: a.id, level, label: a.label ?? '', mouths: mouthPts, slots,
    cx: slots.reduce((s, q) => s + q.x, 0) / n, cy: slots.reduce((s, q) => s + q.y, 0) / n, cz: slots.reduce((s, q) => s + q.z, 0) / n,
  };
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

/** A person's place in a refuge. */
export interface RefugeClaim { refuge: Refuge; slot: number }

/** Who hides where (one slot per person, one person per slot). */
export class RefugeBook {
  private readonly claims = new Map<string, RefugeClaim>();
  private readonly owners = new Map<string, string>();
  private readonly ids = new Map<string, Refuge>();

  constructor(readonly refuges: readonly Refuge[], private readonly levels: Levels) {
    for (const r of refuges) this.ids.set(r.id, r);
  }

  byId(id: string): Refuge | undefined { return this.ids.get(id); }
  claimOf(person: string): RefugeClaim | undefined { return this.claims.get(person); }
  slotOf(person: string): RefugeSlot | undefined { const c = this.claims.get(person); return c ? c.refuge.slots[c.slot] : undefined; }
  /** People holding a slot of `r`. */
  load(r: Refuge): number { let n = 0; for (const c of this.claims.values()) if (c.refuge === r) n++; return n; }
  /** Free slot indices of `r` (best first); `person`'s own counts as free for it. */
  free(r: Refuge, person?: string): number[] {
    const out: number[] = [];
    for (let k = 0; k < r.slots.length; k++) { const o = this.owners.get(`${r.id}#${k}`); if (o === undefined || o === person) out.push(k); }
    return out;
  }

  claim(person: string, r: Refuge, slot: number): void {
    const key = `${r.id}#${slot}`, o = this.owners.get(key);
    if (o !== undefined && o !== person) throw new Error(`refuge slot ${key} is ${o}'s`);
    this.release(person);
    this.claims.set(person, {refuge: r, slot});
    this.owners.set(key, person);
  }

  release(person: string): void {
    const c = this.claims.get(person);
    if (!c) return;
    this.owners.delete(`${c.refuge.id}#${c.slot}`);
    this.claims.delete(person);
  }

  /** Claim the free slot of `r` nearest (x, z) (a recorded hider keeps its corner); false when `r` is full. */
  claimNear(person: string, r: Refuge, x: number, z: number): boolean {
    const free = this.free(r, person);
    if (!free.length) return false;
    let best = free[0], bd = Infinity;
    for (const k of free) { const s = r.slots[k], d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = k; } }
    this.claim(person, r, best);
    return true;
  }

  /**
   * The seeded assignment of `people` without a claim (stable per station + person): in a per-person hash order, each takes the cheapest
   * refuge with a free slot — homes first (tier), then the distance from its own place, plus a load penalty (spread) — and that refuge's
   * best free slot. Nobody when every slot is taken.
   */
  assign(seed: number, people: readonly {id: string; x: number; y: number; z: number}[]): void {
    const order = people.filter(p => !this.claims.has(p.id)).map(p => ({p, k: hashString(`market-refuge:${p.id}`, seed >>> 0)}))
      .sort((a, b) => a.k - b.k || (a.p.id < b.p.id ? -1 : 1));
    const load = new Map(this.refuges.map(r => [r, this.load(r)]));
    for (const {p} of order) {
      let best: Refuge | null = null, bc = Infinity;
      for (const r of this.refuges) {
        if (!this.free(r).length) continue;
        const c = r.tier * 1e4 + Math.hypot(r.cx - p.x, r.cz - p.z, (r.cy - p.y) * REFUGE.climb) + load.get(r)! * REFUGE.load;
        if (c < bc - 1e-9) { bc = c; best = r; }
      }
      if (!best) return;
      this.claim(p.id, best, this.free(best)[0]);
      load.set(best, load.get(best)! + 1);
    }
  }

  /**
   * Where `person` (now at x, y, z) may run: its claim first, then every other refuge with a free slot (tier, then distance), each with
   * its best free slot — at most `max`.
   */
  options(person: string, x: number, y: number, z: number, max = 4): RefugeClaim[] {
    const out: RefugeClaim[] = [];
    const own = this.claims.get(person);
    if (own) out.push(own);
    const rest = this.refuges.filter(r => r !== own?.refuge && this.free(r).length)
      .map(r => ({r, c: r.tier * 1e4 + Math.hypot(r.cx - x, r.cz - z, (r.cy - y) * REFUGE.climb)}))
      .sort((a, b) => a.c - b.c || (a.r.id < b.r.id ? -1 : 1));
    for (const {r} of rest) { if (out.length >= max) break; out.push({refuge: r, slot: this.free(r)[0]}); }
    return out.slice(0, max);
  }

  /** (x, y, z) stands inside refuge `r` (its own floor cells, its storey). */
  inside(r: Refuge, x: number, y: number, z: number): boolean {
    const G: Grid = this.levels.grid(r.level);
    const [cx, cy] = G.cellOf(x, z);
    if (!G.inBounds(cx, cy)) return false;
    const i = G.idx(cx, cy);
    return G.area[i] === r.area && Math.abs(G.floorOf(i) - y) < 0.6;
  }
}
