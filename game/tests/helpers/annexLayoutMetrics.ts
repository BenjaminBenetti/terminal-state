// Task studio-alpha-track2-round3-20261031-01 (lane LAYOUT): LAYOUT LOGIC metrics of the service annexes (user, round 3: "layout feels
// like it is not logical … a logical arrangement matching what a real service area would be like … There must always be 1 cache room
// generated at least"). Pure functions over a generated layout (door graph + rects + purposes) shared by the CI test
// (tests/annex-layout.test.ts) and its opt-in broad sample / plan pictures.
import {CELL} from '../../src/gen/grid';
import {SIGNATURE_OF_PURPOSE} from '../../src/gen/annexRooms';
import type {ServiceAnnex} from '../../src/gen/trackExt/types';
import type {Area, StationLayout} from '../../src/gen/stationTypes';

/** Partner purposes a signature room should have within two door hops (next door, or across its corridor). */
export const ADJACENCY: Readonly<Record<string, readonly string[]>> = {
  'generator-room': ['electrical-room', 'electrical-closet'],
  'sewage-room': ['pump-room', 'overflow-chamber', 'spillway'],
  'overflow-chamber': ['sewage-room', 'pump-room', 'spillway'],
  'spillway': ['sewage-room', 'overflow-chamber', 'pump-room'],
  'boiler-room': ['pump-room', 'storage', 'workshop'],
  'turbine-hall': ['generator-room', 'electrical-room', 'electrical-closet', 'spillway', 'overflow-chamber', 'sewage-room'],
};
/** Staff / maintenance purposes (the zone near the entry; maintenance storage is left out: it is also the plant's and the deep end's stores). */
export const STAFF = new Set(['workshop', 'custodial-room', 'first-aid-room']);

/** The hideout rule of the round-3 brief: a room (not closet / corridor / hall / signature), >= 3.5 x 4 m and >= 14 m², deep third. */
export const HIDEOUT_MIN = {short: 3.5, long: 4, m2: 14};

export interface AnnexLayoutMetrics {
  tag: string; annex: number; hatch: boolean;
  areaM2: number; gridCells: number;
  areas: number; corridors: number; rooms: number; closets: number; halls: number;
  /** Rooms (incl. halls) / closets with at least one door onto a corridor. */
  roomsOnCorridor: number; closetsOnCorridor: number;
  /** Rooms / closets / halls whose every door leads into another room (reached only through rooms), and the longest such chain. */
  viaRooms: number; maxRoomChain: number;
  /** Longest straight run of in-line corridor segments (m). */
  longestStraightM: number;
  /** Corridors with a single door (true dead ends), corridors serving no room, corridors leading to exactly one room and nothing else. */
  deadEndCorridors: number; corridorsNoRoom: number; singleRoomCorridors: number;
  /** The entry passage carries no room of its own (a plain passage into the main corridor). */
  entryBare: number;
  /** Door hops from the annex door (entry corridor = 1): the deepest room, and the mean over rooms. */
  maxHops: number; meanHops: number;
  /** Functional adjacency: signature rooms with a partner rule, and how many have a partner within 2 hops. */
  adjPairs: number; adjOk: number;
  /** Signature purposes without their partner (count per purpose). */
  adjMiss: Record<string, number>;
  /** Ventilation plants at a corridor end (door in its corridor's end wall) or in the deep band / all ventilation plants. */
  ventEnd: number; vents: number;
  /** Staff rooms in the entry half of the depth range / staff rooms; signature rooms in the entry third. */
  staffNear: number; staff: number; sigEntry: number; sigs: number;
  /** The hideout record (ServiceAnnex.hideout) and whether it (or, without the record, any room) meets the rule. */
  hideout: number | undefined; hideoutOk: boolean; candidateExists: boolean; hideoutDeadEnd: boolean;
  signatures: number;
}

const sigOf = (a: Area) => SIGNATURE_OF_PURPOSE[a.purpose ?? ''];
const isRoomish = (a: Area) => a.kind === 'room' || a.kind === 'closet';

/** Depth band (0 entry / 1 middle / 2 deep) of the annex door-hop range — the formula gen/annexCache.ts / pickOver use. */
export function bandOf(depth: number, dMin: number, dMax: number): number {
  return dMax <= dMin ? 0 : Math.min(2, Math.floor((3 * (depth - dMin)) / (dMax - dMin + 1e-9)));
}

/** Whether an annex area meets the hideout rule (purposes must be assigned: signature rooms are refused). */
export function hideoutOk(layout: StationLayout, n: ServiceAnnex, id: number): boolean {
  const a = layout.areas[id];
  if (!a || !n.areas.includes(id) || a.kind !== 'room' || a.extHall || sigOf(a)) return false;
  const s = Math.min(a.w, a.h) * CELL, l = Math.max(a.w, a.h) * CELL;
  if (s < HIDEOUT_MIN.short - 1e-6 || l < HIDEOUT_MIN.long - 1e-6 || a.w * a.h * CELL * CELL < HIDEOUT_MIN.m2 - 1e-6) return false;
  const ds = n.areas.map(i => layout.areas[i].depth);
  return bandOf(a.depth, Math.min(...ds), Math.max(...ds)) === 2;
}

/** Metrics of one annex (see AnnexLayoutMetrics). */
export function annexLayoutMetrics(layout: StationLayout, n: ServiceAnnex, tag = ''): AnnexLayoutMetrics {
  const areas = n.areas.map(id => layout.areas[id]);
  const ids = new Set(n.areas), byId = new Map(areas.map(a => [a.id, a]));
  const adj = new Map<number, number[]>(areas.map(a => [a.id, []]));
  const doorsOf = new Map<number, number>(areas.map(a => [a.id, 0]));
  const entryDoor = layout.doors[n.door];
  for (const d of layout.doors) {
    if (!ids.has(d.a) && !ids.has(d.b)) continue;
    if (ids.has(d.a)) doorsOf.set(d.a, doorsOf.get(d.a)! + 1);
    if (ids.has(d.b) && d.b !== d.a) doorsOf.set(d.b, doorsOf.get(d.b)! + 1);
    if (d.a === d.b || !ids.has(d.a) || !ids.has(d.b)) continue;
    adj.get(d.a)!.push(d.b); adj.get(d.b)!.push(d.a);
  }
  const entry = entryDoor.b;
  const hops = new Map<number, number>([[entry, 1]]), q = [entry];
  for (let h = 0; h < q.length; h++) for (const o of adj.get(q[h])!) if (!hops.has(o)) { hops.set(o, hops.get(q[h])! + 1); q.push(o); }
  const corr = areas.filter(a => a.kind === 'service'), rooms = areas.filter(a => a.kind === 'room'), closets = areas.filter(a => a.kind === 'closet');
  const isCorr = (id: number) => byId.get(id)?.kind === 'service';
  const onCorr = (a: Area) => adj.get(a.id)!.some(isCorr);
  // rooms reached only through rooms: BFS over room-room doors from the rooms on a corridor
  const via = areas.filter(a => isRoomish(a) && !onCorr(a));
  const chain = new Map<number, number>();
  const rq: number[] = [];
  for (const a of areas) if (isRoomish(a) && onCorr(a)) { chain.set(a.id, 0); rq.push(a.id); }
  for (let h = 0; h < rq.length; h++) for (const o of adj.get(rq[h])!) if (!chain.has(o) && !isCorr(o)) { chain.set(o, chain.get(rq[h])! + 1); rq.push(o); }
  // straight runs: in-line corridors joined by a door through the one wall cell between their ends
  const axisX = (a: Area) => a.w >= a.h;
  const inline = (p: Area, c: Area): boolean => {
    if (axisX(p) !== axisX(c)) return false;
    if (axisX(p)) return Math.max(p.y, c.y) < Math.min(p.y + p.h, c.y + c.h) - 1 && (p.x + p.w + 1 === c.x || c.x + c.w + 1 === p.x);
    return Math.max(p.x, c.x) < Math.min(p.x + p.w, c.x + c.w) - 1 && (p.y + p.h + 1 === c.y || c.y + c.h + 1 === p.y);
  };
  let longest = 0;
  const seen = new Set<number>();
  for (const c of corr) {
    if (seen.has(c.id)) continue;
    const comp = [c]; seen.add(c.id);
    for (let h = 0; h < comp.length; h++) for (const o of adj.get(comp[h].id)!) { const oa = byId.get(o)!; if (oa.kind === 'service' && !seen.has(o) && inline(comp[h], oa)) { seen.add(o); comp.push(oa); } }
    const ax = axisX(c);
    const lo = Math.min(...comp.map(a => (ax ? a.x : a.y))), hi = Math.max(...comp.map(a => (ax ? a.x + a.w : a.y + a.h)));
    longest = Math.max(longest, (hi - lo) * CELL);
  }
  const roomDoorsOf = (c: Area) => adj.get(c.id)!.filter(o => !isCorr(o)).length;
  const deadEnd = corr.filter(c => doorsOf.get(c.id)! <= 1).length;
  // (the entry passage is counted apart: a short passage from the tunnel / bed straight into the main corridor is a real service-area plan)
  const noRoom = corr.filter(c => c.id !== entry && roomDoorsOf(c) === 0).length, entryBare = roomDoorsOf(byId.get(entry)!) === 0 ? 1 : 0;
  const single = corr.filter(c => roomDoorsOf(c) === 1 && adj.get(c.id)!.filter(isCorr).length + (c.id === entry ? 1 : 0) <= 1).length;
  const roomHops = [...rooms, ...closets].map(a => hops.get(a.id) ?? 0);
  // adjacency within 2 hops
  const within2 = (id: number): Area[] => {
    const out: Area[] = [];
    for (const o of adj.get(id)!) { out.push(byId.get(o)!); for (const o2 of adj.get(o)!) if (o2 !== id) out.push(byId.get(o2)!); }
    return out;
  };
  let adjPairs = 0, adjOk = 0, vents = 0, ventEnd = 0;
  const adjMiss: Record<string, number> = {};
  const ds = areas.map(a => a.depth), dMin = Math.min(...ds), dMax = Math.max(...ds);
  for (const a of areas) {
    const want = ADJACENCY[a.purpose ?? ''];
    if (want) { adjPairs++; if (within2(a.id).some(o => want.includes(o.purpose ?? ''))) adjOk++; else adjMiss[a.purpose!] = (adjMiss[a.purpose!] ?? 0) + 1; }
    if (a.purpose === 'ventilation-plant') {
      vents++;
      const atEnd = adj.get(a.id)!.some(o => { const c = byId.get(o)!; if (c.kind !== 'service') return false; return axisX(c) ? (a.x >= c.x + c.w || a.x + a.w <= c.x) : (a.y >= c.y + c.h || a.y + a.h <= c.y); });
      if (atEnd || bandOf(a.depth, dMin, dMax) === 2) ventEnd++;
    }
  }
  const staff = areas.filter(a => a.kind === 'room' && STAFF.has(a.purpose ?? ''));
  const sigs = areas.filter(a => sigOf(a));
  const hid = (n as ServiceAnnex & {hideout?: number}).hideout;
  const candidateExists = rooms.some(a => hideoutOk(layout, n, a.id));
  return {
    tag, annex: n.id, hatch: n.tunnel < 0, areaM2: n.areaM2, gridCells: layout.grid.w * layout.grid.h,
    areas: areas.length, corridors: corr.length, rooms: rooms.length, closets: closets.length, halls: rooms.filter(a => a.extHall).length,
    roomsOnCorridor: rooms.filter(onCorr).length, closetsOnCorridor: closets.filter(onCorr).length,
    viaRooms: via.length, maxRoomChain: Math.max(0, ...[...chain.values()]) + (via.length ? 0 : 0),
    longestStraightM: longest, deadEndCorridors: deadEnd, corridorsNoRoom: noRoom, singleRoomCorridors: single, entryBare,
    maxHops: Math.max(...roomHops), meanHops: roomHops.reduce((s, v) => s + v, 0) / Math.max(1, roomHops.length),
    adjPairs, adjOk, adjMiss, ventEnd, vents,
    staffNear: staff.filter(a => (a.depth - dMin) <= (dMax - dMin) / 2).length, staff: staff.length,
    sigEntry: sigs.filter(a => bandOf(a.depth, dMin, dMax) === 0).length, sigs: sigs.length,
    hideout: hid, hideoutOk: hid !== undefined ? hideoutOk(layout, n, hid) : candidateExists, candidateExists,
    hideoutDeadEnd: hid !== undefined ? doorsOf.get(hid) === 1 : false,
    signatures: new Set(sigs.map(sigOf)).size,
  };
}

/** Aggregate (sums / means / extremes) of a list of per-annex metrics, as table rows. */
export function summarize(list: readonly AnnexLayoutMetrics[]): Record<string, string> {
  const sum = (f: (m: AnnexLayoutMetrics) => number) => list.reduce((s, m) => s + f(m), 0);
  const mean = (f: (m: AnnexLayoutMetrics) => number) => sum(f) / Math.max(1, list.length);
  const max = (f: (m: AnnexLayoutMetrics) => number) => Math.max(...list.map(f));
  const min = (f: (m: AnnexLayoutMetrics) => number) => Math.min(...list.map(f));
  const pct = (a: number, b: number) => `${(100 * a / Math.max(1, b)).toFixed(1)} %`;
  const f1 = (v: number) => v.toFixed(1);
  return {
    'annexes': `${list.length} (${list.filter(m => m.hatch).length} via a hatch)`,
    'rooms (incl. halls) with a door onto a corridor': pct(sum(m => m.roomsOnCorridor), sum(m => m.rooms)),
    'closets with a door onto a corridor': pct(sum(m => m.closetsOnCorridor), sum(m => m.closets)),
    'rooms / closets reached only through other rooms (per annex: mean / max)': `${f1(mean(m => m.viaRooms))} / ${max(m => m.viaRooms)} (${pct(sum(m => m.viaRooms), sum(m => m.rooms + m.closets))})`,
    'longest room-only chain (rooms traversed)': `${max(m => m.maxRoomChain)}`,
    'corridors per annex (mean / min / max)': `${f1(mean(m => m.corridors))} / ${min(m => m.corridors)} / ${max(m => m.corridors)}`,
    'longest straight corridor run, m (mean / max)': `${f1(mean(m => m.longestStraightM))} / ${f1(max(m => m.longestStraightM))}`,
    'dead-end corridors (one door) per annex (mean / max)': `${f1(mean(m => m.deadEndCorridors))} / ${max(m => m.deadEndCorridors)}`,
    'corridors serving no room (total; entry passages apart)': `${sum(m => m.corridorsNoRoom)} (+ ${sum(m => m.entryBare)} plain entry passages)`,
    'corridors leading to one room and nothing else, per annex (mean / max)': `${f1(mean(m => m.singleRoomCorridors))} / ${max(m => m.singleRoomCorridors)}`,
    'door hops to the deepest room (mean / max)': `${f1(mean(m => m.maxHops))} / ${max(m => m.maxHops)}`,
    'mean door hops over rooms (mean of annexes)': f1(mean(m => m.meanHops)),
    'functional adjacency pairs satisfied': `${sum(m => m.adjOk)} / ${sum(m => m.adjPairs)} (${pct(sum(m => m.adjOk), sum(m => m.adjPairs))})`,
    'signature rooms without their partner, by purpose': JSON.stringify(list.reduce((t, m) => { for (const [k, v] of Object.entries(m.adjMiss)) t[k] = (t[k] ?? 0) + v; return t; }, {} as Record<string, number>)),
    'ventilation plants at a corridor end / deep band': `${sum(m => m.ventEnd)} / ${sum(m => m.vents)}`,
    'staff rooms (workshop / custodial / first aid) in the entry half': `${pct(sum(m => m.staffNear), sum(m => m.staff))}`,
    'signature rooms in the entry third': `${pct(sum(m => m.sigEntry), sum(m => m.sigs))}`,
    'distinct signatures per annex (min / mean)': `${min(m => m.signatures)} / ${f1(mean(m => m.signatures))}`,
    'halls per annex (min / mean / max)': `${min(m => m.halls)} / ${f1(mean(m => m.halls))} / ${max(m => m.halls)}`,
    'areas per annex (mean)': f1(mean(m => m.areas)),
    'annex m² (min / mean / max)': `${Math.round(min(m => m.areaM2))} / ${Math.round(mean(m => m.areaM2))} / ${Math.round(max(m => m.areaM2))}`,
    'grid cells per level (max)': `${max(m => m.gridCells)}`,
    'annexes with a hideout room meeting the rule (record / any candidate)': `${sum(m => (m.hideoutOk ? 1 : 0))} / ${sum(m => (m.candidateExists ? 1 : 0))} of ${list.length}`,
  };
}
