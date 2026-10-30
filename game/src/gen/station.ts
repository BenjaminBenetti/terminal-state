// Deterministic station generator. Pure data: no three.js, so it can be tested in Node.
//
// Iteration 04: the seed first picks a macro ARCHETYPE (archetypes.ts) — side platforms with a
// long or twin mezzanine, island reached from its ends with a ring concourse, four-track express,
// two-line interchange with a transfer passage, split shallow station with fare controls on both
// sides, or deep station with a long escalator hall — each with its own randomized district
// pattern (food court / arcade / exit hall placement). Iteration 08 (Lane A): right after its
// track block each archetype carves the station's MULTI-LEVEL program (gen/levelGen.ts) — stair
// cores, an upper concourse with crossover bridges and light wells over the tracks, a lower service
// crossing beneath them — into stacked level grids (layout.levels). Then, on the main level: sealed
// street exits, the agent office,
// washrooms, STOREFRONT BAYS carved into the hall walls (storefronts.ts) with service corridors
// and stock rooms behind the food court, staff corridors behind platforms, seeded back-of-house
// growth and loops. The canvas is cropped to the station, then dressed, spawned and lit.

import {Rng, hashString} from '../core/rng';
import {CELL, FLOOR, Grid, SOLID} from './grid';
import {buildSkeleton} from './archetypes';
import {Kit, ROOM_LABEL, type Wing} from './stationKit';
import {carveStorefronts} from './storefronts';
import {
  DOOR_HEIGHT,
  type Archetype, type Area, type AreaKind, type Rect, type RoomType, type Side, type StationLayout,
} from './stationTypes';
import {applyLighting, clearAround, dress, placeSpawns} from './stationDress';
import {FIND_MAX_PER_WEAPON, FIND_MIN_SPAWN_M, findWeaponsFor, placeWeaponFinds, type StartWeaponId} from './weaponFinds';
import {finishTraversal, placeLadders, shiftFlight, shiftRamp, traversalIssues} from './traversal';
import {doorwayIssues} from './doorways';
import {assignEnemyArchetypes} from '../ai/creatureSpawn';
import {acceptedPlaced, spawnContext, spawnProfile, type SpawnProfile} from '../ai/spawnTables'; // Task enemy-spawn-tables-20261030 (lane SPAWN)
import {buildLevelLinks, buildLevels, deriveRails, levelDistance, levelIssues, registerApertures, shiftPlan} from './levelGen';
import {dressLevels, lightServiceLevel, placeLevelSpawns} from './levelGenDress';
import {lootProfile, type LootProfile} from '../items/lootTables'; // Task loot-tables-20261030 (lane LOOT)

export * from './stationTypes';
export {ROOM_LABEL};

const STREETS = ['Hollis', 'Wexford', 'Garnet', 'Linden', 'Carver', 'Dorset', 'Marlowe', 'Ashby', 'Kessler', 'Fulton', 'Bramley', 'Ostend', 'Pruitt', 'Calder', 'Halsey', 'Juniper', 'Rowan', 'Tilden'];
const SUFFIX = ['Street', 'Avenue', 'Square', 'Park', 'Junction', 'Yards', 'Heights', 'Road'];
const TERMINALS = ['Northgate', 'Harbourfront', 'Elm Park', 'Union Yards', 'Kingsway', 'Lakeshore', 'Bayview', 'Westmount', 'Riverdale', 'Cedar Hill', 'Port Ellis', 'Midtown'];

const WING_ROOMS: Record<Wing, RoomType[]> = {
  food: ['stock-room', 'stock-room', 'storage', 'stock-room', 'crew-room', 'utility', 'storage'],
  north: ['crew-room', 'utility', 'storage', 'utility', 'storage', 'crew-room'],
  agent: ['storage', 'utility', 'crew-room'],
  misc: ['utility', 'storage', 'crew-room', 'storage', 'utility', 'stock-room'],
};
const REQUIRED_ROOMS: RoomType[] = ['stock-room', 'storage', 'crew-room', 'utility', 'agent-office'];

const ARCH_WEIGHTS: [Archetype, number][] = [['side-mezzanine', 1.1], ['island-ends', 1], ['express', 0.9], ['interchange', 0.9], ['split', 1], ['deep', 1]];

/** The macro archetype a seed produces (stable across generation retries). */
export function pickArchetype(seed: number): Archetype {
  return new Rng(hashString('archetype', seed >>> 0)).weighted(ARCH_WEIGHTS);
}

/**
 * Pistol lane: `startWeapon` (default 'rifle') decides which weapons are seeded map finds; deterministic per seed for a given option.
 * Task loot-tables-20261030 (lane LOOT): `loot` = the logical level's loot profile for the generated floor finds (default: the
 * Subway's; a future level built on this generator passes its own).
 * Task enemy-spawn-tables-20261030 (lane SPAWN): `spawns` = the logical level's enemy spawn profile (ai/spawnTables.ts; default:
 * the Subway's) — context 'station', the storey moves and the room modifiers; validation reads the same profile.
 */
export function generateStation(seed: number, opts: {archetype?: Archetype; startWeapon?: StartWeaponId; loot?: LootProfile; spawns?: SpawnProfile} = {}): StationLayout {
  const arch = opts.archetype ?? pickArchetype(seed);
  const sw = opts.startWeapon ?? 'rifle';
  const loot = opts.loot ?? lootProfile('subway');
  const spawns = opts.spawns ?? spawnProfile('subway');
  for (let attempt = 0; attempt < 24; attempt++) {
    const s = attempt === 0 ? seed >>> 0 : hashString('retry' + attempt, seed);
    const layout = tryGenerate(s, seed >>> 0, attempt, arch, sw, loot, spawns);
    if (layout && validateLayout(layout, spawns).length === 0) return layout;
  }
  // Extremely unlikely; fall back to a deterministic layout even with warnings.
  for (let attempt = 24; attempt < 60; attempt++) {
    const layout = tryGenerate(hashString('retry' + attempt, seed), seed >>> 0, attempt, attempt < 40 ? arch : 'side-mezzanine', sw, loot, spawns);
    if (layout) return layout;
  }
  throw new Error('station generation failed');
}

/**
 * Iteration 07 (Lane DW): one raw generation attempt exactly as generateStation would try it, with
 * no validation retry — tests use it to catch issues (e.g. decor in doorways) that a retry would
 * otherwise hide by silently picking another layout.
 */
export function generateAttempt(seed: number, attempt = 0, arch: Archetype = pickArchetype(seed), startWeapon: StartWeaponId = 'rifle', loot: LootProfile = lootProfile('subway'), spawns: SpawnProfile = spawnProfile('subway')): StationLayout | null {
  return tryGenerate(attempt === 0 ? seed >>> 0 : hashString('retry' + attempt, seed), seed >>> 0, attempt, arch, startWeapon, loot, spawns);
}

function tryGenerate(genSeed: number, seed: number, attempt: number, arch: Archetype, startWeapon: StartWeaponId = 'rifle', loot: LootProfile = lootProfile('subway'), spawns: SpawnProfile = spawnProfile('subway')): StationLayout | null {
  const rng = new Rng(genSeed);
  const k = new Kit(rng);
  const {areas, doors, wing} = k;
  const name = `${rng.pick(STREETS)} ${rng.pick(SUFFIX)}`;
  const terms = rng.shuffle(TERMINALS.slice());
  const plan = buildSkeleton(k, arch, terms);
  if (!plan) return null;

  // --- Sealed street exits: dead-end stair halls with a locked grille (no outside, no travel) ---
  const EXL = 20; // 4 m landing + 6 m stair
  const exits: Area[] = [];
  const maxExits = rng.int(3, 5);
  const addExit = (parent: Area, side: Side, frac: number): boolean => {
    const wallLen = side === 'N' || side === 'S' ? parent.w : parent.h;
    if (wallLen < 14) return false;
    for (const df of [0, 0.15, -0.15, 0.3, -0.3]) {
      const f = Math.min(0.85, Math.max(0.15, frac + df));
      const r = k.adjacent(parent, side, 8, EXL, Math.round((f - 0.5) * (wallLen - 12)));
      if (!k.rectFree(r)) continue;
      const a = k.addArea(r, 'passage', 'exit-stair', 5.0, parent.id);
      const gap: Rect = side === 'S' ? {x: r.x, y: r.y - 1, w: 8, h: 1} : side === 'N' ? {x: r.x, y: r.y + r.h, w: 8, h: 1}
        : side === 'W' ? {x: r.x + r.w, y: r.y, w: 1, h: 8} : {x: r.x - 1, y: r.y, w: 1, h: 8};
      k.carveDoor(gap, parent, a, 3.2, true);
      exits.push(a);
      return true;
    }
    return false;
  };
  const tried = new Set<string>();
  for (const e of [...plan.exits, ...plan.lateExits]) {
    if (exits.length >= maxExits) break;
    const key = `${e.parent.id}${e.side}`;
    if (tried.has(key) && exits.length >= 2) continue;
    tried.add(key);
    addExit(e.parent, e.side, e.frac);
  }
  if (exits.length < 2) return null;

  // --- Station agent office beside the main ticket hall ---------------------------------------
  {
    const T = plan.ticketHalls[0];
    let office: Area | null = null;
    for (const side of rng.shuffle(['S', 'W', 'E', 'N'] as Side[])) {
      for (let t = 0; t < 4 && !office; t++) {
        const wallLen = side === 'N' || side === 'S' ? T.w : T.h;
        const a = k.attach(T, side, rng.int(10, 14), rng.int(10, 12), rng.int(-Math.floor(wallLen / 2) + 8, Math.floor(wallLen / 2) - 8), 'room', 'agent-office', 2.8, T.id, {}, false);
        if (!a) continue;
        if (!k.connect(T, a, 3, DOOR_HEIGHT, {arch: false, extra: {staff: true}})) { k.undoLast(a); continue; }
        office = a;
        wing.set(a.id, 'agent');
      }
      if (office) break;
    }
    if (!office) return null;
  }

  // --- Washrooms (men's / women's) off an arcade, exit hall or ticket hall -----------------------
  {
    const place = (host: Area): boolean => {
      for (const side of rng.shuffle(['S', 'N', 'E', 'W'] as Side[])) {
        const ww = rng.int(10, 12), wh = rng.int(12, 14);
        const along = ww * 2 + 1;
        const wallLen = side === 'N' || side === 'S' ? host.w : host.h;
        if (wallLen < along + 6) continue;
        for (let t = 0; t < 5; t++) {
          const half = Math.floor((wallLen - along) / 2) - 3;
          const r = k.adjacent(host, side, along, wh, rng.int(-half, half));
          if (!k.rectFree(r)) continue;
          const alongX = side === 'N' || side === 'S';
          const ra: Rect = alongX ? {x: r.x, y: r.y, w: ww, h: wh} : {x: r.x, y: r.y, w: wh, h: ww};
          const rb: Rect = alongX ? {x: r.x + ww + 1, y: r.y, w: ww, h: wh} : {x: r.x, y: r.y + ww + 1, w: wh, h: ww};
          const men = k.addArea(ra, 'room', 'washroom', 2.8, host.id, {label: "Men's washroom", publicSpace: true});
          const women = k.addArea(rb, 'room', 'washroom', 2.8, host.id, {label: "Women's washroom", publicSpace: true});
          if (!k.connect(host, men, 3, DOOR_HEIGHT, {arch: false, pick: 0.85}) || !k.connect(host, women, 3, DOOR_HEIGHT, {arch: false, pick: 0.15})) return false;
          return true;
        }
      }
      return false;
    };
    const hosts = rng.shuffle(plan.washHosts.slice());
    if (!hosts.some(h => place(h))) return null;
  }

  // --- Storefront bays in the hall walls (food court perimeter first) ---------------------------
  const usedNames = new Set<string>();
  const shops = carveStorefronts(k, plan.frontages, usedNames, STREETS);

  // --- Back-of-house: attach rooms/closets/corridors through doors --------------------------------
  let rooms = 0, closets = 0;
  const typeCounter = new Map<Wing, number>();
  const nextRoomType = (w: Wing): RoomType => {
    const n = typeCounter.get(w) ?? 0;
    typeCounter.set(w, n + 1);
    const list = WING_ROOMS[w];
    return n < list.length ? list[n] : rng.pick(list);
  };
  const tryAttach = (parent: Area, kind: 'room' | 'closet' | 'service', sides: Side[], forced?: RoomType): Area | null => {
    const side = rng.pick(sides);
    let w: number, h: number;
    if (kind === 'room') { w = rng.int(10, 16); h = rng.int(10, 14); }
    else if (kind === 'closet') { w = rng.int(5, 7); h = rng.int(5, 7); }
    else {
      const long = rng.int(16, 36), wide = 6;
      if (side === 'N' || side === 'S') { w = wide; h = long; } else { w = long; h = wide; }
    }
    if (forced === 'stock-room') { w = rng.int(14, 20); h = rng.int(12, 16); }
    const doorW = kind === 'closet' ? 2 : 3;
    const minOv = doorW + 2;
    let r: Rect;
    if (side === 'N' || side === 'S') {
      const y = side === 'S' ? parent.y + parent.h + 1 : parent.y - 1 - h;
      const lo = parent.x - w + minOv, hi = parent.x + parent.w - minOv;
      if (hi < lo) return null;
      r = {x: rng.int(lo, hi), y, w, h};
    } else {
      const x = side === 'E' ? parent.x + parent.w + 1 : parent.x - 1 - w;
      const lo = parent.y - h + minOv, hi = parent.y + parent.h - minOv;
      if (hi < lo) return null;
      r = {x, y: rng.int(lo, hi), w, h};
    }
    if (!k.rectFree(r)) return null;
    let type: RoomType, ceil: number, areaKind: AreaKind;
    const pw = wing.get(parent.id) ?? 'misc';
    if (kind === 'room') { type = forced ?? nextRoomType(pw); ceil = type === 'stock-room' || type === 'storage' ? 3.0 : 2.8; areaKind = 'room'; }
    else if (kind === 'closet') { type = rng.chance(0.5) ? 'supply-closet' : 'janitor-closet'; ceil = 2.6; areaKind = 'closet'; }
    else { type = 'service-corridor'; ceil = 2.8; areaKind = 'service'; }
    const child = k.addArea(r, areaKind, type, ceil, parent.id);
    wing.set(child.id, pw);
    const gap = k.wallGap(parent, child, doorW);
    if (!gap) { k.undoLast(child); return null; }
    k.carveDoor(gap, parent, child, kind === 'service' ? 2.6 : DOOR_HEIGHT, false, {staff: parent.publicSpace});
    if (kind === 'room') rooms++; else if (kind === 'closet') closets++;
    return child;
  };
  const awayFrom = (C: Area, from: Area): Side[] => {
    if (C.w >= C.h) return C.y > from.y ? ['S'] : ['N'];
    return C.x > from.x ? ['E'] : ['W'];
  };

  // Stock rooms behind the food-court service corridors.
  let stock = 0;
  for (const C of shops.corridors) {
    const sfOf = shops.storefronts.find(s => s.unit === C.parent);
    const hall = areas[sfOf ? sfOf.hall : C.parent];
    const out = awayFrom(C, hall);
    for (let t = 0; t < 24 && stock < 2; t++) if (tryAttach(C, 'room', out, 'stock-room')) stock++;
    for (let t = 0; t < 8; t++) if (tryAttach(C, 'room', [...out, ...(C.w >= C.h ? ['E', 'W'] as Side[] : ['N', 'S'] as Side[])])) break;
  }

  // Staff corridors along platform back walls (signal & crew rooms).
  for (const [P, side] of plan.staffWalls) {
    const SL = rng.int(50, 100);
    if (P.w < SL + 20) continue;
    for (let t = 0; t < 4; t++) {
      const sx = P.x + rng.int(8, P.w - SL - 8);
      const r: Rect = side === 'N' ? {x: sx, y: P.y - 7, w: SL, h: 6} : {x: sx, y: P.y + P.h + 1, w: SL, h: 6};
      if (!k.rectFree(r)) continue;
      const S = k.addArea(r, 'service', 'service-corridor', 2.8, P.id, {label: 'Signal & crew corridor'});
      wing.set(S.id, 'north');
      const row = side === 'N' ? P.y - 1 : P.y + P.h;
      const d0 = rng.int(sx + 2, sx + Math.floor(SL / 2) - 4);
      k.carveDoor({x: d0, y: row, w: 3, h: 1}, P, S, DOOR_HEIGHT, false, {staff: true});
      if (rng.chance(0.5)) k.carveDoor({x: rng.int(sx + Math.floor(SL / 2) + 2, sx + SL - 5), y: row, w: 3, h: 1}, P, S, DOOR_HEIGHT, false, {staff: true});
      let n = 0;
      for (let q = 0; q < 24 && n < 3; q++) if (tryAttach(S, 'room', side === 'N' ? ['N', 'N', 'E', 'W'] : ['S', 'S', 'E', 'W'])) n++;
      break;
    }
  }
  // Platform ends without an underpass / end passage get a staff corridor.
  for (const [P, side] of plan.openEnds) for (let t = 0; t < 6; t++) { const s = tryAttach(P, 'service', [side]); if (s) { wing.set(s.id, 'north'); break; } }

  // Seeded growth.
  const targetRooms = rng.int(10, 13);
  const targetClosets = rng.int(3, 6);
  let services = 0;
  const maxService = rng.int(1, 3);
  const paidHalls = new Set(plan.paidHalls.map(a => a.id));
  const unpaidHalls = new Set([...plan.ticketHalls, ...plan.exitHalls].map(a => a.id));
  const parentWeight = (a: Area): number => {
    // Iteration 08 (Lane A): back-of-house grows on the main level only (not off stair cores or level areas).
    if (a.level || a.type === 'stair-core') return 0;
    if (a.kind === 'service') return 3.2;
    if (a.kind === 'room') return a.type === 'washroom' || a.type === 'eatery' || a.type === 'shop' ? 0 : 1.4;
    if (a.type === 'passage') return 0.8;
    if (paidHalls.has(a.id)) return 0.6;
    if (unpaidHalls.has(a.id)) return 0.3;
    return 0;
  };
  const sidesFor = (a: Area): Side[] => {
    if (a.type === 'passage') return a.w >= a.h ? ['N', 'S'] : ['E', 'W'];
    return ['N', 'S', 'E', 'W'];
  };
  for (let it = 0; it < 900 && (rooms < targetRooms || closets < targetClosets); it++) {
    const cands = areas.map(a => [a, parentWeight(a)] as [Area, number]).filter(c => c[1] > 0);
    const parent = rng.weighted(cands);
    let kind: 'room' | 'closet' | 'service';
    if (parent.kind === 'room') kind = rng.chance(0.65) ? 'closet' : 'room';
    else kind = rng.weighted([['room', 0.6], ['service', services < maxService && parent.kind === 'service' ? 0.25 : services < maxService ? 0.12 : 0], ['closet', 0.2]] as const);
    if (kind === 'room' && rooms >= targetRooms) kind = 'closet';
    if (kind === 'closet' && closets >= targetClosets) { if (rooms >= targetRooms) continue; kind = 'room'; }
    const child = tryAttach(parent, kind, sidesFor(parent));
    if (child && kind === 'service') services++;
  }
  // Every station has the full back-of-house set.
  for (const need of REQUIRED_ROOMS) {
    if (areas.some(a => a.type === need && !a.level)) continue;
    const counts = new Map<RoomType, number>();
    for (const a of areas) if (a.kind === 'room' && !a.level) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
    const donor = areas.find(a => a.kind === 'room' && !a.level && !a.publicSpace && a.type !== 'agent-office' && (counts.get(a.type) ?? 0) >= 2);
    if (!donor) return null;
    donor.type = need;
    donor.label = ROOM_LABEL[need];
  }
  if (areas.filter(a => a.kind === 'room' && !a.publicSpace && !a.level).length < 6) return null;

  // --- Loops: extra doors between back-of-house neighbours separated by one wall ----------------
  const connected = new Set(doors.map(d => `${Math.min(d.a, d.b)}:${Math.max(d.a, d.b)}`));
  const loopOk = (a: Area) => !a.publicSpace || a.type === 'food-court' || a.type === 'retail-arcade' || a.type === 'passage';
  // Iteration 08 (Lane A): loops join main-level neighbours only (level areas share X/Z, not walls).
  const mainAreas = areas.filter(a => !a.level && a.type !== 'stair-core');
  for (const a of mainAreas) {
    for (const b of mainAreas) {
      if (a.id >= b.id || !loopOk(a) || !loopOk(b) || (a.publicSpace && b.publicSpace)) continue;
      if (a.paid !== b.paid && (a.publicSpace || b.publicSpace)) continue;
      if (connected.has(`${a.id}:${b.id}`)) continue;
      const p = (a.publicSpace || b.publicSpace) ? 0.2 : (a.kind === 'room' && b.kind === 'room') ? 0.35 : (a.kind === 'closet' || b.kind === 'closet') ? 0.08 : 0.45;
      const gap = k.wallGap(a, b, 3, 'mid');
      if (!gap || !rng.chance(p)) continue;
      let ok = true;
      for (let y = gap.y; y < gap.y + gap.h && ok; y++) for (let x = gap.x; x < gap.x + gap.w; x++) if (k.g.get(x, y) !== SOLID) { ok = false; break; }
      if (!ok) continue;
      const [pa, pb] = a.publicSpace ? [a, b] : [b, a];
      k.carveDoor(gap, pa, pb, DOOR_HEIGHT, false, {staff: pa.publicSpace});
      connected.add(`${a.id}:${b.id}`);
    }
  }

  // --- Crop the canvas to the station (iteration 08: every level grid, same bounds) ----------------
  const srcs = k.levelGrids;
  const src = k.g;
  let x0 = src.w, y0 = src.h, x1 = 0, y1 = 0;
  // Every carved cell of every level lies in an area, a door or a track bed rect (cheaper than scanning three canvases).
  for (const r of [...areas, ...doors, ...k.trenches.map(t => ({x: t.x0, y: t.y0, w: t.x1 - t.x0, h: t.y1 - t.y0}))]) {
    if (r.w <= 0 || r.h <= 0) continue;
    x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w - 1); y1 = Math.max(y1, r.y + r.h - 1);
  }
  const ox = x0 - 2, oy = y0 - 2;
  const grids = srcs.map(sg => {
    const out = new Grid(x1 - x0 + 5, y1 - y0 + 5);
    for (let y = 0; y < out.h; y++) {
      const s = (y + oy) * sg.w + ox, d = y * out.w;
      out.cells.set(sg.cells.subarray(s, s + out.w), d);
      out.area.set(sg.area.subarray(s, s + out.w), d);
      out.ceil.set(sg.ceil.subarray(s, s + out.w), d);
      // Lane T (iteration 05): floor heights + stair ramps travel with the crop.
      out.floor.set(sg.floor.subarray(s, s + out.w), d);
      out.rampIdx.set(sg.rampIdx.subarray(s, s + out.w), d);
    }
    out.voidFloor = sg.voidFloor;
    return out;
  });
  const g = grids[0];
  // One shared ramps list: a stair between levels has the same ramp index in every level grid.
  const ramps = src.ramps.map(r => shiftRamp(r, ox, oy));
  for (const lg of grids) lg.ramps = ramps;
  for (const a of areas) { a.x -= ox; a.y -= oy; }
  for (const d of doors) { d.x -= ox; d.y -= oy; }
  for (const sf of shops.storefronts) { sf.ox -= ox; sf.oy -= oy; sf.ux -= ox; sf.uy -= oy; }
  const trenches = k.trenches.map(t => Kit.trenchWorld(t, ox, oy));

  const layout: StationLayout = {
    seed, attempt, name, archetype: arch, towards: [terms[0], terms[1]], grid: g, areas, doors,
    props: [], lights: [], signs: [], pickups: [], zombies: [], storefronts: shops.storefronts, decor: [],
    playerSpawn: {x: 0, z: 0, yaw: 0},
    trench: trenches[0], trenches,
    platform: plan.P1.id,
    platforms: plan.platforms.map(p => p.id),
    // Lane T (iteration 05): stair flights + underpasses from the kit; rescue ladders (grid nav links) on every platform face.
    traversal: {stairs: k.flights.map(f => shiftFlight(f, ox, oy)), ladders: [], underpasses: k.underpasses},
    levels: [], levelLinks: [], rails: [],
  };
  // Iteration 08 (Lane A): stacked levels (main / upper / lower), stair links, apertures and railings.
  const lplan = k.levelPlan ? shiftPlan(k.levelPlan, ox, oy) : null;
  if (lplan) { layout.levelPlan = lplan; layout.spawnEnd = lplan.spawnEnd; }
  layout.levels = buildLevels(grids, lplan);
  layout.levelLinks = buildLevelLinks(lplan, layout.traversal.stairs);
  registerApertures(layout.levels);
  layout.rails = deriveRails(layout.levels);
  layout.traversal.ladders = placeLadders(layout);
  dress(layout, rng.fork('dress'));
  // Lane A: wayfinding on and between the levels, high-bay lights over the wells (absolute y, after the dressing lift).
  dressLevels(layout, rng.fork('levels'));
  placeSpawns(layout, rng.fork('spawns'), loot, spawns);
  // Lane A: a weighted share of the zombies / loose supplies onto the upper and lower levels (totals kept).
  placeLevelSpawns(layout, rng.fork('levelSpawns'), spawns);
  // Pistol lane: the non-starting weapons (+ matching ammo) as seeded map finds, away from the spawn, on any storey.
  layout.startWeapon = startWeapon;
  placeWeaponFinds(layout, rng.fork('weaponFinds'), startWeapon);
  // After spawns so fixtures around the player spawn can be guaranteed working.
  applyLighting(layout, rng.fork('lighting'));
  // Lane A: the service level stays dark-moody but readable — sparse working dim lamps (crossing, gallery, stair feet, plant-room doors).
  lightServiceLevel(layout, rng.fork('serviceLights'));
  // Lane T: fixtures follow stepped ceilings, loot/props lifted to local floors, never on stairs; underpass + ladder signs.
  finishTraversal(layout);
  // Iteration 07 (Lane Q): per-spawn seed-weighted enemy archetype (~5 % rat/dog), keyed on the station seed.
  assignEnemyArchetypes(layout, spawns); // lane SPAWN: the level's pool, per the spawn's room
  return layout;
}

// ---------------------------------------------------------------------------------------
// Validation (used by tests and as a generation retry guard)

export function validateLayout(layout: StationLayout, spawns: SpawnProfile = spawnProfile('subway')): string[] {
  const issues: string[] = [];
  const g = layout.grid;
  const [sx, sy] = g.cellOf(layout.playerSpawn.x, layout.playerSpawn.z);
  if (!clearAround(g, sx, sy, 1)) issues.push('player spawn not clear');
  if (!g.circleClear(layout.playerSpawn.x, layout.playerSpawn.z, 0.35)) issues.push('player spawn intersects geometry');
  // Iteration 08 (Lane A): reachability over every level (stairs carved into two grids, ladders).
  const levels = layout.levels?.length ? layout.levels : [{id: 0, role: 'main' as const, grid: g, baseY: 0}];
  const dists = levelDistance(levels, sx, sy);
  const dist = dists[0];
  const gridOf = (lv: number | undefined) => levels[lv ?? 0]?.grid ?? g;
  let walk = 0, reached = 0;
  for (let i = 0; i < g.cells.length; i++) {
    if (g.cells[i] === FLOOR && !g.blocked[i]) { walk++; if (dist[i] >= 0) reached++; }
  }
  if (walk !== reached) issues.push(`unreachable walkable cells: ${walk - reached}`);
  for (const a of layout.areas) {
    const ag = gridOf(a.level), ad = dists[a.level ?? 0] ?? dist;
    let any = false;
    for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w; x++) if (ad[ag.idx(x, y)] >= 0) { any = true; break; }
    if (!any) issues.push(`area ${a.id} (${a.type}) unreachable`);
  }
  // Lane SPAWN: the accepted placed count and keep-away are the profile's station context (min 8; 36 cells = MIN_ZOMBIE_SPAWN_CELLS).
  const sc = spawnContext(spawns, 'station'), acc = acceptedPlaced(sc);
  if (acc.min !== null && layout.zombies.length < acc.min) issues.push(`too few zombies: ${layout.zombies.length}`);
  if (acc.max !== null && layout.zombies.length > acc.max) issues.push(`too many zombies: ${layout.zombies.length}`);
  for (const z of layout.zombies) {
    const zg = gridOf(z.level), zd = dists[z.level ?? 0] ?? dist;
    const [x, y] = zg.cellOf(z.x, z.z);
    const d = zd[zg.idx(x, y)];
    if (d < 0) issues.push('zombie on unreachable cell');
    else if (d < sc.placement.startCells) issues.push('zombie too close to player');
    if (!zg.circleClear(z.x, z.z, 0.35)) issues.push('zombie spawn intersects geometry');
  }
  for (const p of layout.pickups) {
    if (!p.level && p.y > 0) continue;
    const pg = gridOf(p.level), pd = dists[p.level ?? 0] ?? dist;
    const [x, y] = pg.cellOf(p.x, p.z);
    if (pd[pg.idx(x, y)] < 0) issues.push(`pickup ${p.itemId} unreachable`);
  }
  // Pistol lane: the start weapon never lies in the station; each find weapon at most FIND_MAX_PER_WEAPON copies,
  // each >= FIND_MIN_SPAWN_M (straight line) from the spawn (reachability is checked above). Zero copies is allowed.
  {
    const start = layout.startWeapon ?? 'rifle', sp = layout.playerSpawn;
    if (layout.pickups.some(p => p.itemId === start)) issues.push(`start weapon ${start} placed as a pickup`);
    if (start !== 'pistol' && layout.pickups.some(p => p.itemId === 'pistol')) issues.push('pistol pickup without the pistol start');
    for (const w of findWeaponsFor(start)) {
      const ws = layout.pickups.filter(p => p.itemId === w);
      if (ws.length > FIND_MAX_PER_WEAPON) issues.push(`too many ${w} pickups: ${ws.length}`);
      for (const p of ws) if (Math.hypot(p.x - sp.x, p.z - sp.z) < FIND_MIN_SPAWN_M - 1e-6) issues.push(`${w} pickup too close to the spawn`);
    }
  }
  const plat = layout.areas[layout.platform];
  if (plat.w * CELL < 94) issues.push(`platform too short: ${plat.w * CELL} m`);
  for (const t of ['concourse', 'fare-hall', 'food-court', 'washroom', 'stock-room', 'storage', 'crew-room', 'utility', 'agent-office'] as const) {
    if (!layout.areas.some(a => a.type === t)) issues.push(`missing ${t}`);
  }
  if (layout.areas.filter(a => a.type === 'exit-stair').length < 2) issues.push('fewer than 2 street exits');
  const count = (k: string) => layout.props.filter(p => p.kind === k).length;
  const food = layout.areas.filter(a => a.type === 'food-court').map(a => a.id);
  const fcUnits = layout.storefronts.filter(s => food.includes(s.hall));
  if (fcUnits.length < 4) issues.push(`too few food-court units: ${fcUnits.length}`);
  if (layout.storefronts.filter(s => s.food && s.unit >= 0 && s.shutter !== 'closed').length < 3) issues.push('too few enterable food counters');
  if (layout.props.filter(p => p.kind === 'table' && food.includes(p.area)).length < 6) issues.push('food court seating missing');
  if (count('shopCounter') + count('shopDisplay') < 6) issues.push(`too few service counters: ${count('shopCounter') + count('shopDisplay')}`);
  if (count('vending') < 4) issues.push(`too few vending machines: ${count('vending')}`);
  // Lane R (iteration 05): store / stock-room shelving is the purpose-themed `stockShelf`.
  if (count('shelf') + count('stockShelf') < 6) issues.push(`too few shelves: ${count('shelf') + count('stockShelf')}`);
  if (count('fareGate') < 5) issues.push('no fare line');
  if (count('exitStair') < 2) issues.push('exit stairs not dressed');
  // Lane T (iteration 05): walkable flights, clear ladder heads/feet, a ladder near every track-bed cell.
  issues.push(...traversalIssues(layout));
  // Iteration 07 (Lane DW): every walk-through opening is free of decor (rails, plates, panels, props).
  issues.push(...doorwayIssues(layout));
  // Iteration 08 (Lane A): stacked levels — overlap, slabs / headroom, stairs, railings, placements, reachability.
  if (layout.levels?.length) issues.push(...levelIssues(layout, dists));
  return issues;
}

/** Macro metrics for tests and the QA map tool (cells → metres where noted). */
export function layoutMetrics(l: StationLayout): Record<string, number | string> {
  const typeCount = (t: string) => l.areas.filter(a => a.type === t).length;
  const food = l.areas.find(a => a.type === 'food-court')!;
  const sp = l.playerSpawn;
  const fc = {x: (food.x + food.w / 2) * CELL, z: (food.y + food.h / 2) * CELL};
  return {
    archetype: l.archetype,
    widthM: l.grid.w * CELL, depthM: l.grid.h * CELL,
    platforms: l.platforms.length,
    tracks: l.trenches.reduce((n, t) => n + t.tracks.length, 0),
    fareLines: l.doors.filter(d => d.fare).length,
    ticketHalls: typeCount('fare-hall'),
    paidHalls: l.areas.filter(a => a.paid && a.kind === 'concourse').length,
    arcades: typeCount('retail-arcade'),
    exits: typeCount('exit-stair'),
    storefronts: l.storefronts.length,
    openShops: l.storefronts.filter(s => s.shutter !== 'closed').length,
    foodCourtM2: Math.round(food.w * food.h * CELL * CELL),
    spawnToFoodM: Math.round(Math.hypot(fc.x - sp.x, fc.z - sp.z)),
    areas: l.areas.length,
  };
}
