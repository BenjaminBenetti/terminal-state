// Task studio-reactor-playtest-round2-20261102 (lane WASTE): the waste repository's ROOM GRAPH as tests read it (layout.reactorWaste
// .graph, written by the dress hook): the coherence rules every generation keeps, and the signatures the variety tests count (user:
// "Just like the subway it should be random! with logical rooms flowing in to one another!"). Not a test file (no `.test.`).

import {CELL} from '../src/gen/grid';
import type {Rect, StationLayout} from '../src/gen/stationTypes';
import type {WasteGraph} from '../src/gen/reactor/complex/wasteTypes';

/** Spaces every repository has (by kind). */
export const WASTE_REQUIRED = ['bay', 'hp', 'lockers', 'control', 'airlock', 'corridor', 'vault', 'compactor', 'cask', 'plant'] as const;

type Pass = (d: WasteGraph['doors'][number], to: string) => boolean;

/** Spaces reachable from `from` ('deck' = the shaft deck) through the doors `pass` lets through. */
function reach(G: WasteGraph, from: string, pass: Pass): Set<string> {
  const seen = new Set([from]), q = [from];
  for (let h = 0; h < q.length; h++) {
    const k = q[h];
    for (const d of G.doors) {
      const to = d.a === k ? d.b : d.b === k ? d.a : null;
      if (to === null || seen.has(to) || !pass(d, to)) continue;
      seen.add(to); q.push(to);
    }
  }
  return seen;
}

/**
 * Coherence issues of a dressed repository (empty = coherent): the required spaces; every door record matches its layout door; all
 * connected from the deck; the entrance opens into the receiving bay; bay -> health-physics checkpoint -> change room -> airlock
 * (two heavy doors) -> a sealed corridor; the controlled area is SEALED (no personnel door crosses into it; the clean side enters it
 * only through the airlock or a goods shutter from the bay; the service side only through heavy maintenance doors); every controlled
 * space reachable through the airlock alone; the plant reached from the clean side without entering the controlled area; >= 2
 * independent loops.
 */
export function wasteCoherence(L: StationLayout, frontArea: number): string[] {
  const G = L.reactorWaste?.graph;
  if (!G) return ['no room graph'];
  const out: string[] = [];
  const kind = new Map(G.rooms.map(r => [r.key, r.kind])), zone = new Map(G.rooms.map(r => [r.key, r.zone])), area = new Map(G.rooms.map(r => [r.key, r.area]));
  const kinds = new Set(kind.values());
  for (const k of WASTE_REQUIRED) if (!kinds.has(k)) out.push(`missing ${k}`);
  for (const d of G.doors) {
    const D = L.doors[d.id], a = d.a === 'deck' ? frontArea : area.get(d.a), b = area.get(d.b);
    if (!D || !((D.a === a && D.b === b) || (D.a === b && D.b === a))) out.push(`door ${d.id} (${d.a}-${d.b}) does not match the layout`);
  }
  const all = reach(G, 'deck', () => true);
  if (all.size !== G.rooms.length + 1) out.push(`${G.rooms.length + 1 - all.size} spaces unreachable`);
  const ent = G.doors.filter(d => d.a === 'deck' || d.b === 'deck');
  if (ent.length !== 1 || kind.get(ent[0].b) !== 'bay') out.push('the entrance does not open into the receiving bay');
  const has = (a: string, b: string, k?: (d: string) => boolean) => G.doors.some(d => ((kind.get(d.a) === a && kind.get(d.b) === b) || (kind.get(d.a) === b && kind.get(d.b) === a)) && (!k || k(d.kind)));
  if (!has('bay', 'hp')) out.push('no door bay -> checkpoint');
  if (!has('hp', 'lockers')) out.push('no door checkpoint -> change room');
  const airlock = G.rooms.find(r => r.kind === 'airlock');
  if (airlock) {
    const ad = G.doors.filter(d => d.a === airlock.key || d.b === airlock.key);
    const other = (d: WasteGraph['doors'][number]) => kind.get(d.a === airlock.key ? d.b : d.a);
    if (ad.length !== 2 || ad.some(d => d.kind !== 'heavy') || !ad.some(d => other(d) === 'lockers') || !ad.some(d => other(d) === 'corridor')) out.push('the airlock is not change room =heavy= airlock =heavy= sealed corridor');
  }
  // the sealed boundary
  for (const d of G.doors) {
    if (d.a === 'deck') continue;
    const za = zone.get(d.a), zb = zone.get(d.b);
    if ((za === 'controlled') === (zb === 'controlled')) continue;
    const outer = za === 'controlled' ? d.b : d.a, inner = za === 'controlled' ? d.a : d.b;
    if (d.kind !== 'heavy' && d.kind !== 'wide') out.push(`a ${d.kind} door ${d.a}-${d.b} crosses into the controlled area`);
    if (zone.get(outer) === 'clean' && !(kind.get(outer) === 'lockers' && kind.get(inner) === 'airlock') && !(kind.get(outer) === 'bay' && d.kind === 'wide' && ['vault', 'cask'].includes(kind.get(inner)!))) out.push(`clean ${d.a}-${d.b} bypasses the airlock`);
  }
  // every controlled space through the airlock alone (no goods shutter, no maintenance door)
  const viaAirlock = reach(G, 'deck', (d, to) => {
    const from = d.a === to ? d.b : d.a;
    return zone.get(to) !== 'controlled' || zone.get(from) === 'controlled' || kind.get(to) === 'airlock';
  });
  for (const r of G.rooms) if (r.zone === 'controlled' && !viaAirlock.has(r.key)) out.push(`${r.key} not reachable through the airlock`);
  // the service side: the plant without entering the controlled area
  const clean = reach(G, 'deck', (_d, to) => zone.get(to) !== 'controlled');
  if (!G.rooms.some(r => r.kind === 'plant' && clean.has(r.key))) out.push('the plant is only reached through the controlled area');
  const internal = G.doors.filter(d => d.a !== 'deck').length;
  if (internal - G.rooms.length + 1 < 2) out.push(`${internal - G.rooms.length + 1} independent loops (< 2)`);
  return out;
}

/**
 * The guaranteed set pieces BY CONSTRUCTION: >= 1 reserved booth span and exactly 1 reserved window span, each holding its piece
 * (the model's centre inside the span), so `showers + hot cell >= 2` never depends on the shared station dresser's draws.
 */
export function wasteReservedPieces(L: StationLayout): string[] {
  const D = L.reactorWaste, G = D?.graph;
  if (!D || !G) return ['no room graph'];
  const out: string[] = [];
  const booths = G.reserve.filter(q => q.what === 'booth'), hot = G.reserve.filter(q => q.what === 'hotcell');
  if (!booths.length) out.push('no reserved booth span');
  if (hot.length !== 1) out.push(`${hot.length} reserved window spans`);
  for (const q of G.reserve) {
    const piece = q.what === 'booth' ? 'deconShower' : 'hotCellWindow';
    if (!D.models.some(m => m.piece === piece && m.x > q.x0 && m.x < q.x1 && m.z > q.z0 && m.z < q.z1)) out.push(`reserved ${q.what} span in ${q.room} empty`);
  }
  return out;
}

/** A space's centre in the slot's local frame (u along the pit wall, v inward), both normalised to [0, 1] over the region. */
function localOf(region: Rect, inward: 'N' | 'S' | 'E' | 'W', a: Rect): [number, number] {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2, ux = (cx - region.x) / region.w, uy = (cy - region.y) / region.h;
  switch (inward) {
    case 'S': return [ux, uy];
    case 'N': return [ux, 1 - uy];
    case 'E': return [uy, ux];
    default: return [uy, 1 - ux];
  }
}

export interface WasteSignature {
  /** The graph's shape: the multiset of door (kind-kind / door kind) pairs. */
  topo: string;
  /** Where the main spaces sit: each one's 3 x 3 cell of the slot (u along the wall, v inward). */
  geo: string;
  cask: string;
  plant: string;
  vault: string;
  corridors: number;
  loops: number;
  deadEnds: number;
  optional: string[];
  /** The kind of the room holding the first switchgear cabinet. */
  switchgear: string;
}

/** The signature of a dressed repository; `region` in grid cells (the slot region; grid = canvas cells in the Reactor). */
export function wasteSignature(L: StationLayout, region: Rect, inward: 'N' | 'S' | 'E' | 'W'): WasteSignature {
  const G = L.reactorWaste!.graph!, D = L.reactorWaste!;
  const kind = new Map(G.rooms.map(r => [r.key, r.kind]));
  const k = (x: string) => (x === 'deck' ? 'deck' : kind.get(x)!);
  const topo = G.doors.map(d => `${[k(d.a), k(d.b)].sort().join('-')}:${d.kind}`).sort().join(',');
  const cellOf = (kd: string) => {
    const r = G.rooms.find(q => q.kind === kd);
    if (!r) return '-';
    const [u, v] = localOf(region, inward, L.areas[r.area]);
    return `${Math.min(2, Math.floor(u * 3))}${Math.min(2, Math.floor(v * 3))}`;
  };
  const geo = ['bay', 'hp', 'control', 'vault', 'compactor', 'cask', 'plant'].map(cellOf).join('|');
  const deg = new Map<string, number>();
  for (const d of G.doors) for (const x of [d.a, d.b]) deg.set(x, (deg.get(x) ?? 0) + 1);
  const internal = G.doors.filter(d => d.a !== 'deck').length;
  const v = G.rooms.find(r => r.kind === 'vault')!, va = L.areas[v.area];
  const sg = D.models.find(m => m.piece === 'switchgear');
  let sgKind = '-';
  if (sg) {
    const g = L.levels[D.level].grid, [cx, cy] = g.cellOf(sg.x, sg.z), id = g.area[g.idx(cx, cy)];
    sgKind = G.rooms.find(r => r.area === id)?.kind ?? '?';
  }
  return {
    topo, geo, cask: cellOf('cask'), plant: cellOf('plant'), vault: `${Math.max(va.w, va.h)}x${Math.min(va.w, va.h)}`,
    corridors: G.rooms.filter(r => r.kind === 'corridor').length, loops: internal - G.rooms.length + 1,
    deadEnds: G.rooms.filter(r => deg.get(r.key) === 1).length,
    optional: [...new Set(G.rooms.map(r => r.kind).filter(x => !(WASTE_REQUIRED as readonly string[]).includes(x)))].sort(),
    switchgear: sgKind,
  };
}

/** World rect (ReactorComplexInfo.slot.region) -> grid cells. */
export const cellsOfWorld = (r: {x0: number; z0: number; x1: number; z1: number}): Rect => ({x: Math.round(r.x0 / CELL), y: Math.round(r.z0 / CELL), w: Math.round((r.x1 - r.x0) / CELL), h: Math.round((r.z1 - r.z0) / CELL)});
