// Track 2 — Beyond the Station (lane CONTENT): the service annexes / tunnels get their content from gen/annexContent.ts
// populateExtensions — on its own fork, APPENDED after every core record — and every core record stays the core's.
//  - dressing: existing back-of-house purposes (slot contract), lead plant rooms, per-annex prop budget, existing prop kinds only
//    (both audits classify them), grounded on the annex floor, clear of doorways, every annex area still connected;
//  - loot: the stash / picked-over / intact loot keys, the per-annex floor program on reachable floor, finite and remembered, no
//    gear / mask / weapon in an annex, the level's one gear roll and the Office roof rewards untouched;
//  - service spawns: the profile's 'service' zone budget per annex, annex areas only, appended last and tagged 'service', the core's
//    spawns / families byte-identical, no Siren in an annex, kills remembered;
//  - lights: untinted, under the annex ceilings, profiles consistent, much darker than the station, sparse tunnel fixtures;
//  - steam vents from the dressing, within the emitter's cap; dropExtensions removes the content; the cap overhang is derived.
import {describe, expect, it} from 'vitest';
import {generateStation} from '../src/gen/station';
import {generateOfficeLevel} from '../src/gen/office/index';
import {ANNEX_COMPOSE_BUDGET, ANNEX_CONTENT, extensionContentOf} from '../src/gen/annexContent';
import {ANNEX_ROOMS, ROOM_SIGNATURES, SIGNATURE_IDS, annexDoorGraph, isSolidMachine, machineBoxes} from '../src/gen/annexRooms';
import {installCanvasShim} from './helpers/canvas2d';
import {ROOM_PURPOSES} from '../src/gen/purposes';
import {coreView, dropExtensions, isExtensionArea, TRACK_EXT, trackExtConfig, type TrackExtConfig} from '../src/gen/trackExt/index';
import {CELL, FLOOR, SOLID} from '../src/gen/grid';
import {levelDistance} from '../src/gen/levelGen';
import {propBlocksDoorway} from '../src/gen/placeKit';
import {isP7Kind} from '../src/gen/props07';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {createHolderState, isContainerKind, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {PROP_DEFS} from '../src/gen/props';
import {
  ANNEX_FLOOR, ANNEX_PICKED, ANNEX_PICKED_KEY, ANNEX_STASH, ANNEX_STASH_KEY, ROOF_CACHE_KEY, ROOF_FIND_KEY, lootProfile, validateLootProfile,
} from '../src/items/lootTables';
import {ITEMS} from '../src/items/items';
import {OFFICE_SIREN_ELIGIBILITY, SERVICE_CONTEXT, SERVICE_ZONE_BUDGET, spawnContextOf, spawnProfile} from '../src/ai/spawnTables';
import {applyHolderRecord, captureHolder, createMemory, enemiesToSpawn, holderKey} from '../src/run/memory';
import {STEAM, annexVents} from '../src/world/trackExt/steam';
import {CAP_OVERHANG, CAP_SKIN} from '../src/world/trackExt/caps';
import {placeSectionGear, rollLevelGear} from '../src/gen/gearLoot';
import type {Area, StationLayout} from '../src/gen/stationTypes';

/** Seeds by annex count (deterministic; tests/track-ext.test.ts census); `hatch`: a tunnel annex + a service-hatch annex (GEN-2). */
const SUBWAY = {1: 4055629249, 2: 2563024239, none: 2027820797, hatch: 774566179};
const OFFICE = {1: 3, 2: 7922};
const cache = new Map<string, StationLayout>();
const sub = (seed: number) => { const k = `s${seed}`; let l = cache.get(k); if (!l) cache.set(k, (l = generateStation(seed))); return l; };
const off = (seed: number) => { const k = `o${seed}`; let l = cache.get(k); if (!l) cache.set(k, (l = generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}))); return l; };
const WITH = () => [sub(SUBWAY[1]), sub(SUBWAY[2]), sub(SUBWAY.hatch), off(OFFICE[1]), off(OFFICE[2])];
/**
 * The same level with NO annexes (its own track config, no annex wanted / allowed): the same core (the GEN-2 core reserve is a
 * core layout decision independent of the annexes) and tunnels but no annex content — the reference for "the core is unchanged".
 */
const noAnnex = (cfg: TrackExtConfig): TrackExtConfig => ({...cfg, annex: {...cfg.annex, max: 0, ...(cfg.annex.count ? {count: [1, 0, 0] as [number, number, number]} : {})}});
const reference = (l: StationLayout): StationLayout => (l.office
  ? generateOfficeLevel({levelSeed: [OFFICE[1], OFFICE[2]].find(s => off(s) === l)!, startWeapon: 'pistol'}, undefined, undefined, noAnnex(trackExtConfig('office')))
  : generateStation(l.seed, {trackExtensions: noAnnex(trackExtConfig('subway'))}));
const annexAreas = (l: StationLayout) => l.extensions!.annexes.flatMap(n => n.areas.map(id => l.areas[id]));
const inAnnex = (l: StationLayout) => { const s = new Set(l.extensions!.annexes.flatMap(n => n.areas)); return (r: {area: number}) => s.has(r.area); };
// (task track2-playtest-revision, lane ROOMS: + the seven room signatures and the first-aid post among the utility rooms)
const ALLOWED = new Set(['pump-room', 'electrical-room', 'workshop', 'storage', 'custodial-room', 'first-aid-room', 'janitor-closet', 'electrical-closet', 'supply-closet', 'service-corridor',
  ...SIGNATURE_IDS.map(s => ROOM_SIGNATURES[s].purpose)]);

describe('service annex dressing (existing purposes and prop kinds, appended, budgeted)', () => {
  it('every annex area takes an existing back-of-house purpose of the service set, its RoomType one of the purpose\'s slots', () => {
    expect(sub(SUBWAY.hatch).extensions!.annexes.some(n => n.tunnel === -1), 'a service-hatch annex is dressed too').toBe(true);
    for (const l of WITH()) {
      expect(l.extensions!.annexes.length).toBeGreaterThan(0);
      for (const n of l.extensions!.annexes) {
        const used = new Set<string>();
        for (const id of n.areas) {
          const a = l.areas[id];
          expect(ALLOWED.has(a.purpose!), `${l.seed} ${a.purpose}`).toBe(true);
          expect(ROOM_PURPOSES[a.purpose!].slots, `${l.seed} ${a.purpose} / ${a.type}`).toContain(a.type);
          expect(ROOM_PURPOSES[a.purpose!].kinds).toContain(a.kind);
          if (a.kind === 'service') expect(a.purpose).toBe('service-corridor');
          used.add(a.purpose!);
        }
        // (lane ROOMS) several different room signatures per annex, and at least one machinery hall
        const sigs = new Set([...used].filter(p => SIGNATURE_IDS.some(s => ROOM_SIGNATURES[s].purpose === p)));
        expect(sigs.size, `${l.seed} annex ${n.id} signatures ${[...sigs]}`).toBeGreaterThanOrEqual(4);
        expect(n.areas.some(id => l.areas[id].extHall), `${l.seed} annex ${n.id} hall`).toBe(true);
      }
    }
  });

  it('props are APPENDED after every core prop, all in annex areas, per-annex budget, existing kinds classified by both audits', () => {
    const openAudit = new Set(OPENABLE_AUDIT.map(e => e.kind));
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!, core = coreView(l);
      expect(rep.first.props).toBe(core.props.length);
      const own = inAnnex(l), tunnel = new Set(l.extensions!.tunnels.flatMap(t => t.areas));
      expect(l.props.slice(0, rep.first.props).some(p => isExtensionArea(l.areas[p.area]))).toBe(false);
      for (const p of l.props.slice(rep.first.props)) {
        expect(own(p), `${l.seed} ${p.kind} in an annex`).toBe(true);
        expect(tunnel.has(p.area)).toBe(false);
        expect(PROP_DEFS[p.kind], p.kind).toBeDefined();
        expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind} physics class`).toBeDefined();
        if (!isP7Kind(p.kind)) expect(openAudit.has(p.kind) || !isLootHolderKind(p.kind), `${p.kind} openables audit`).toBe(true);
      }
      for (const n of l.extensions!.annexes) {
        // (lane ROOMS: the machinery's collision-only boxes are budget-exempt — the dressing budget counts the rest)
        const ids = new Set(n.areas), list = l.props.slice(rep.first.props).filter(p => ids.has(p.area) && p.kind !== 'annexMachine');
        const budget = Math.round(n.areaM2 / ANNEX_CONTENT.m2PerProp);
        // (the room in progress finishes, the corridors' composition is coverage-capped, host decor follows its host: <= 1.25 x)
        expect(list.length, `${l.seed} annex ${n.id} props`).toBeLessThanOrEqual(budget * 1.25);
        // (lane ROOMS: the lean annex furniture + capped equipment props leave the budget part-used; the rooms' identity is their
        // machinery: ~40-110 dressing props per annex, was ~150)
        expect(list.length).toBeGreaterThan(budget * 0.2);
        expect(list.filter(p => p.cluster !== undefined && isP7Kind(p.kind)).length).toBeLessThanOrEqual(ANNEX_COMPOSE_BUDGET + 2);
      }
    }
  });

  it('grounded on the annex floor, under its ceiling, clear of every doorway; every annex area stays connected door to door', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!, g = l.grid;
      for (const p of l.props.slice(rep.first.props)) {
        const a = l.areas[p.area], floor = a.floorY!;
        if (p.host === undefined && !p.mounted) expect(p.y, `${l.seed} ${p.kind} on the floor`).toBeCloseTo(floor, 5);
        else expect(p.y).toBeGreaterThan(floor - 1e-6);
        expect(p.y + p.h, `${l.seed} ${p.kind} under the ceiling`).toBeLessThanOrEqual(a.ceil + 1e-6);
        expect(propBlocksDoorway(l, p.x, p.z, p.hx, p.hz, p.y + (p.lift ?? 0), p.h - (p.lift ?? 0)), `${l.seed} ${p.kind} in a doorway`).toBeNull();
      }
      // door cells walkable; each area's walkable cells one connected piece touching every one of its doors
      for (const a of annexAreas(l)) {
        const free = (x: number, y: number) => g.inBounds(x, y) && g.area[g.idx(x, y)] === a.id && g.walkable(x, y);
        // (the dresser's own rule, placeKit areaConnected: the area's walkable cells incl. its door strips, bbox +- 1)
        const cells: number[] = [];
        for (let y = a.y - 1; y <= a.y + a.h; y++) for (let x = a.x - 1; x <= a.x + a.w; x++) if (free(x, y)) cells.push(g.idx(x, y));
        expect(cells.length, `${l.seed} ${a.label}`).toBeGreaterThan(0);
        const seen = new Set([cells[0]]), q = [cells[0]];
        while (q.length) { const c = q.pop()!, x = c % g.w, y = (c - x) / g.w; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (free(x + dx, y + dy) && !seen.has(g.idx(x + dx, y + dy))) { seen.add(g.idx(x + dx, y + dy)); q.push(g.idx(x + dx, y + dy)); } }
        expect(seen.size, `${l.seed} ${a.label} split by props`).toBe(cells.length);
        for (const d of l.doors.filter(q2 => q2.a === a.id || q2.b === a.id)) {
          for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) expect(g.walkable(x, y), `${l.seed} door ${d.id}`).toBe(true);
          let touch = false;
          for (let y = d.y - 1; y <= d.y + d.h && !touch; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y) && seen.has(g.idx(x, y))) { touch = true; break; }
          expect(touch, `${l.seed} ${a.label} door ${d.id} reachable`).toBe(true);
        }
      }
    }
  });

  it('is deterministic per seed and leaves the core view equal to the level without extensions', () => {
    const a = generateStation(SUBWAY[1]), b = sub(SUBWAY[1]);
    const rep = extensionContentOf(a)!;
    expect(a.props.slice(rep.first.props).map(p => [p.kind, p.x, p.y, p.z, p.rot, p.purpose ?? ''])).toEqual(b.props.slice(rep.first.props).map(p => [p.kind, p.x, p.y, p.z, p.rot, p.purpose ?? '']));
    const ref = coreView(reference(b));
    for (const k of ['props', 'lights', 'signs', 'pickups', 'zombies'] as const) expect(coreView(a)[k].length, k).toBe(ref[k].length);
    expect(coreView(a).zombies.map(z => z.archetype)).toEqual(ref.zombies.map(z => z.archetype));
    expect(coreView(a).props.map(p => [p.kind, p.x, p.z, p.purpose ?? ''])).toEqual(ref.props.map(p => [p.kind, p.x, p.z, p.purpose ?? '']));
  });
});

// Task track2-playtest-revision-20261031 (lane ROOMS): room signatures, machinery halls and the anti-repetition rule.
describe('service annex room signatures (machinery halls, anchored machinery, anti-repetition, fewer holders)', () => {
  const sigOf = (a: Area) => SIGNATURE_IDS.find(s => ROOM_SIGNATURES[s].purpose === a.purpose);

  it('every solid machinery record is exactly its collision-only boxes; visual-only parts stay out of the walking space', () => {
    const seen = new Set<string>();
    for (const l of WITH()) {
      const recs = l.extensions!.machines!, g = l.grid, own = inAnnex(l);
      expect(recs.length).toBeGreaterThan(0);
      const boxes = l.props.filter(p => p.kind === 'annexMachine');
      expect(boxes.every(own)).toBe(true);
      let n = 0;
      for (const m of recs) {
        const a = l.areas[m.area];
        expect(own(m), `${l.seed} ${m.kind} in an annex`).toBe(true);
        // machinery only in signature rooms, at their floor
        const s = sigOf(a);
        expect(s, `${l.seed} ${m.kind} in ${a.purpose}`).toBeDefined();
        seen.add(s!);
        expect(m.y).toBeCloseTo(a.floorY!, 6);
        const bx = machineBoxes(m);
        n += bx.length;
        expect(bx.length > 0).toBe(isSolidMachine(m.kind));
        for (const b of bx) {
          const p = boxes.find(q => q.area === m.area && Math.abs(q.x - b.x) < 1e-3 && Math.abs(q.z - b.z) < 1e-3 && Math.abs(q.hx - b.hx) < 1e-3 && Math.abs(q.hz - b.hz) < 1e-3 && Math.abs(q.h - b.h) < 1e-3);
          expect(p, `${l.seed} ${m.kind} box at ${b.x},${b.z}`).toBeDefined();
          expect(p!.blocksSight).toBe(b.sight);
          expect(b.h).toBeLessThanOrEqual(a.ceil - a.floorY! + 1e-6);
          const [cx, cy] = g.cellOf(b.x, b.z);
          expect(g.blocked[g.idx(cx, cy)], `${l.seed} ${m.kind} box cell blocked`).toBe(1);
        }
        // visual-only parts: against a wall (<= 0.3 m deep), above head height, flat on the floor or over the blocked footprint
        const wallGap = Math.min(m.x - a.x * CELL, (a.x + a.w) * CELL - m.x, m.z - a.y * CELL, (a.y + a.h) * CELL - m.z);
        if (m.kind === 'header' || m.kind === 'pipeRun' || m.kind === 'louvre') { expect(m.d).toBeLessThanOrEqual(0.3); expect(wallGap).toBeLessThanOrEqual(m.d / 2 + 0.01); }
        if (m.kind === 'duct') expect(m.p![0] - m.h / 2, `${l.seed} duct headroom`).toBeGreaterThanOrEqual(2.2);
        if (m.kind === 'crane') expect(m.p![0] - 0.22).toBeGreaterThanOrEqual(2.2);
        if (m.kind === 'catwalk') expect(m.h).toBeLessThanOrEqual(0.04);
        if (m.kind === 'gate' || m.kind === 'culvert') { const [cx, cy] = g.cellOf(m.x, m.z); expect(g.blocked[g.idx(cx, cy)] === 1 || wallGap <= 0.3).toBe(true); }
      }
      expect(boxes.length, `${l.seed} one prop per box`).toBe(n);
    }
    // the corpus shows the whole vocabulary
    expect([...seen].sort()).toEqual([...SIGNATURE_IDS].sort());
  });

  it('anti-repetition: no two annex rooms within two door hops share a signature; >= 4 signatures and >= 1 hall per annex; fewer holders', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!;
      for (const n of l.extensions!.annexes) {
        const areas = n.areas.map(id => l.areas[id]), {adj} = annexDoorGraph(l, areas);
        for (const a of areas) {
          const s = sigOf(a);
          if (!s) continue;
          const d = new Map([[a.id, 0]]), q = [a.id];
          for (let h = 0; h < q.length; h++) for (const o of adj.get(q[h]) ?? []) if (!d.has(o) && d.get(q[h])! < ANNEX_ROOMS.hops) { d.set(o, d.get(q[h])! + 1); q.push(o); }
          for (const id of q) if (id !== a.id) expect(sigOf(l.areas[id]), `${l.seed} rooms ${a.id} / ${id} both ${s}`).not.toBe(s);
        }
        const r = rep.annexes.find(x => x.id === n.id)!;
        expect(Object.keys(r.signatures).length).toBeGreaterThanOrEqual(4);
        expect(r.halls).toBeGreaterThanOrEqual(1);
        // meaningful storage: ~35-60 holders per annex (was ~100-125)
        expect(r.holders, `${l.seed} annex ${n.id} holders`).toBeGreaterThanOrEqual(30);
        expect(r.holders).toBeLessThanOrEqual(70);
      }
    }
  });

  it('the machinery builds into a bounded number of merged meshes per annex in the station group', async () => {
    installCanvasShim(false);
    const THREE = await import('three');
    const {WorldMaterials} = await import('../src/world/materials');
    const {TEXTURE_FILES} = await import('../src/assets/manifest');
    const {buildAnnexMachines, MACHINE_MATS} = await import('../src/world/trackExt/machines');
    const tex: Record<string, InstanceType<typeof THREE.Texture>> = {};
    for (const k of Object.keys(TEXTURE_FILES)) tex[k] = new THREE.Texture({width: 64, height: 64} as unknown as HTMLImageElement);
    const mats = new WorldMaterials(tex as never, 7, {w: 1.2, h: 0.19, d: 0.17});
    const l = sub(SUBWAY[2]), group = new THREE.Group(), b = buildAnnexMachines(group, l, mats);
    const annexes = l.extensions!.annexes.length;
    expect(b.records).toBe(l.extensions!.machines!.length);
    expect(b.draws).toBeGreaterThan(0);
    expect(b.draws).toBeLessThanOrEqual(MACHINE_MATS.length * annexes);
    expect(b.triangles / annexes).toBeLessThan(60000);
    for (const m of b.meshes) { expect(m.parent).toBe(group); expect(m.userData.level).toBe(0); expect(m.userData.trackExt.part).toBe('machines'); }
  });
});

describe('service annex loot (finite, themed, appended, never multiplying the level\'s rewards)', () => {
  it('tables: the stash / picked-over / floor program are valid and source-backed', () => {
    expect(validateLootProfile(lootProfile('subway'))).toEqual([]);
    expect(validateLootProfile(lootProfile('office'))).toEqual([]);
    for (const [id] of [...ANNEX_STASH.items, ...ANNEX_PICKED.items]) expect(ITEMS[id], id).toBeDefined();
    expect(ANNEX_PICKED.items.some(([id]) => id.startsWith('ammo'))).toBe(false); // picked over: never ammo
    expect(ROOM_PURPOSES[ANNEX_STASH_KEY].loot.default).toBe(ANNEX_STASH);
    expect(ROOM_PURPOSES[ANNEX_PICKED_KEY].loot.default).toBe(ANNEX_PICKED);
    expect(lootProfile('subway').tables.floor.annex).toBe(ANNEX_FLOOR);
    // nothing high-tier guaranteed: every box / kit has a 0 lower bound or a keep chance < 1, every light find a chance < 1
    for (const b of ANNEX_FLOOR.boxes) expect(b.n[0]).toBe(0);
    for (const k of ANNEX_FLOOR.kept) expect(k.keep).toBeLessThan(1);
    for (const c of ANNEX_FLOOR.light) expect(c.chance).toBeLessThan(1);
    expect(ANNEX_STASH.empty).toBeGreaterThan(0);
  });

  it('holders: 1-2 stashes per annex in dead-end rooms, the deepest few intact, the rest picked over', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!;
      for (const n of l.extensions!.annexes) {
        const ids = new Set(n.areas);
        const holders = l.props.slice(rep.first.props).filter(p => ids.has(p.area) && isLootHolderKind(p.kind) && p.host === undefined);
        const stash = holders.filter(p => p.purpose === ANNEX_STASH_KEY), picked = holders.filter(p => p.purpose === ANNEX_PICKED_KEY);
        const intact = holders.filter(p => p.purpose !== ANNEX_STASH_KEY && p.purpose !== ANNEX_PICKED_KEY);
        expect(stash.length, `${l.seed} annex ${n.id} stashes`).toBeGreaterThanOrEqual(1);
        expect(stash.length).toBeLessThanOrEqual(2);
        for (const s of stash) expect(['crate', 'cabinetTall']).toContain(s.kind);
        expect(intact.length).toBeLessThanOrEqual(Math.max(1, Math.round(n.areaM2 / ANNEX_CONTENT.m2PerIntactHolder)));
        expect(picked.length).toBeGreaterThan(intact.length);
        // intact = the deepest: no picked-over holder lies deeper than the shallowest intact one
        const depth = (p: {area: number}) => l.areas[p.area].depth;
        if (intact.length && picked.length) expect(Math.max(...picked.map(depth))).toBeLessThanOrEqual(Math.min(...intact.map(depth)));
        // persistence keys (kind + storey + position) are unique
        const keys = holders.map(p => holderKey(p.kind, p.level, p.x, p.z));
        expect(new Set(keys).size).toBe(keys.length);
      }
    }
  });

  it('finite and remembered: the same lots every roll, taken lots stay taken after a re-roll (never refilled)', () => {
    const l = sub(SUBWAY[2]);
    let ci = 0, si = 0, checked = 0;
    for (const p of l.props) {
      if (!isLootHolderKind(p.kind)) continue;
      const k = p.kind as HolderKind, idx = isContainerKind(k) ? ci++ : si++;
      if (p.purpose !== ANNEX_STASH_KEY) continue;
      const a = l.areas[p.area], key = p.purpose ?? a.purpose ?? a.type, surf = holderSurfaces(k, PROP_DEFS[k]);
      const s1 = createHolderState(l.seed, idx, k, key, surf, undefined, lootProfile('subway'));
      const s2 = createHolderState(l.seed, idx, k, key, surf, undefined, lootProfile('subway'));
      expect(s2.lots).toEqual(s1.lots);
      if (!s1.lots.length) continue;
      s1.lots = s1.lots.slice(1); // the player took one lot
      const rec = captureHolder(s1), fresh = createHolderState(l.seed, idx, k, key, surf, undefined, lootProfile('subway'));
      applyHolderRecord(fresh, rec, {openable: true, container: true});
      expect(fresh.lots.map(x => x.id)).toEqual(s1.lots.map(x => x.id));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('floor finds: appended after every core pickup, on reachable annex floor, no gear / mask / weapon; the Office roof rewards stay the core\'s', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!, core = coreView(l), own = inAnnex(l), g = l.grid;
      expect(rep.first.pickups).toBe(core.pickups.length);
      const start = l.office?.start ?? {...l.playerSpawn, level: 0};
      const [sx, sy] = g.cellOf(start.x, start.z);
      const dist = levelDistance(l.levels, sx, sy, start.level ?? 0, l.levelLinks)[0];
      for (const p of l.pickups.slice(rep.first.pickups)) {
        expect(own(p)).toBe(true);
        expect(ITEMS[p.itemId].kind).not.toBe('gear');
        expect(ITEMS[p.itemId].kind).not.toBe('weapon');
        expect(p.reward).toBeUndefined();
        const [x, y] = g.cellOf(p.x, p.z), i = g.idx(x, y);
        expect(dist[i], `${l.seed} ${p.itemId} reachable`).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeCloseTo(g.floorOf(i), 6);
      }
      if (l.office) {
        expect(l.props.filter(p => p.purpose === ROOF_CACHE_KEY).length).toBe(1);
        expect(l.pickups.filter(p => p.reward === ROOF_FIND_KEY)).toEqual(core.pickups.filter(p => p.reward === ROOF_FIND_KEY));
      }
    }
  });

  it('the level\'s ONE gear roll lands exactly where it would without the annexes (never in one)', () => {
    for (const [level, seed] of [['subway', SUBWAY[2]], ['office', OFFICE[2]]] as const) {
      const live = level === 'subway' ? generateStation(seed, {startWeapon: 'pistol'}) : generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'});
      const cfg = noAnnex(trackExtConfig(level));
      const none = level === 'subway' ? generateStation(seed, {startWeapon: 'pistol', trackExtensions: cfg}) : generateOfficeLevel({levelSeed: seed, startWeapon: 'pistol'}, undefined, undefined, cfg);
      expect(live.extensions!.annexes.length).toBeGreaterThan(0);
      const items = [...rollLevelGear(seed, level, ['main']).main, ...['armor_vest', 'backpack', 'helmet', 'boots'].map(itemId => ({itemId}))];
      const a = placeSectionGear(live, items), b = placeSectionGear(none, items);
      const inCore = (q: StationLayout, p: {x: number; z: number}) => [Math.round((p.x - q.extensions!.shift.x) * 1000), Math.round((p.z - q.extensions!.shift.z) * 1000)];
      expect(a.map(p => [p.itemId, p.area, ...inCore(live, p)])).toEqual(b.map(p => [p.itemId, p.area, ...inCore(none, p)]));
      for (const p of a) expect(isExtensionArea(live.areas[p.area])).toBe(false);
    }
  });
});

describe('service spawns (the \'service\' zone context)', () => {
  it('declared per annex-bearing level: the per-annex zone budget; no family enabled by it', () => {
    for (const id of ['subway', 'office'] as const) expect(spawnProfile(id).contexts.service).toBe(SERVICE_CONTEXT);
    expect(SERVICE_CONTEXT.count).toEqual(SERVICE_ZONE_BUDGET);
    expect(OFFICE_SIREN_ELIGIBILITY.contexts).not.toContain('service');
  });

  it('appended after every core spawn, in annex areas only, tagged \'service\'; the core\'s tags / families unchanged', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!, P = spawnProfile(l.office ? 'office' : 'subway'), own = inAnnex(l);
      const none = reference(l);
      expect(rep.first.zombies).toBe(none.zombies.length);
      l.zombies.forEach((z, i) => {
        const ctx = spawnContextOf(l, P, i);
        if (i < rep.first.zombies) {
          expect(own(z)).toBe(false);
          expect(ctx).not.toBe('service');
          expect(ctx && ctx in P.contexts).toBe(true);
          expect(z.archetype ?? 'zombie').toBe(none.zombies[i].archetype ?? 'zombie');
        } else {
          expect(own(z), `${l.seed} #${i} in an annex`).toBe(true);
          expect(ctx).toBe('service');
          expect(z.archetype).not.toBe('siren');
          expect(P.families.some(([f, w]) => f === (z.archetype ?? 'zombie') && w > 0)).toBe(true);
        }
      });
    }
  });

  it('per annex: within the zone budget, >= the keep-off from its door, spaced, reachable and far from the start', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!, g = l.grid, pl = SERVICE_CONTEXT.placement;
      const start = l.office?.start ?? {...l.playerSpawn, level: 0};
      const [sx, sy] = g.cellOf(start.x, start.z);
      const dist = levelDistance(l.levels, sx, sy, start.level ?? 0, l.levelLinks)[0];
      const svc = l.zombies.slice(rep.first.zombies);
      for (const n of l.extensions!.annexes) {
        const ids = new Set(n.areas), mine = svc.filter(z => ids.has(z.area)), r = rep.annexes.find(a => a.id === n.id)!;
        expect(r.service.count).toBeGreaterThanOrEqual(SERVICE_ZONE_BUDGET[0]);
        expect(r.service.count).toBeLessThanOrEqual(SERVICE_ZONE_BUDGET[1]);
        expect(mine.length).toBe(r.service.placed);
        expect(mine.length).toBeLessThanOrEqual(r.service.count);
        for (const z of mine) {
          const [x, y] = g.cellOf(z.x, z.z), i = g.idx(x, y);
          expect(g.cells[i]).toBe(FLOOR);
          expect(dist[i]).toBeGreaterThanOrEqual(pl.startCells);
          expect(Math.hypot(z.x - n.exit.x, z.z - n.exit.z)).toBeGreaterThanOrEqual(pl.landingKeepM! - 1e-6);
          expect(g.circleClear(z.x, z.z, 0.35)).toBe(true);
          for (const w of mine) if (w !== z) expect(Math.hypot(w.x - z.x, w.z - z.z)).toBeGreaterThanOrEqual(pl.spacingM - 1e-6);
        }
      }
    }
  });

  it('no Siren ever in an Office annex; killed annex enemies are never spawned again', () => {
    for (const seed of [OFFICE[1], OFFICE[2], 222, 3333, 4242]) {
      const l = off(seed), own = inAnnex(l);
      expect(l.zombies.filter(z => own(z) && z.archetype === 'siren')).toEqual([]);
    }
    const l = sub(SUBWAY[2]), first = extensionContentOf(l)!.first.zombies;
    const mem = createMemory({level: 'subway', section: 'main'});
    mem.killed.push(first, first + 1);
    const again = enemiesToSpawn(generateStation(SUBWAY[2]).zombies.length, mem);
    expect(again).not.toContain(first);
    expect(again).not.toContain(first + 1);
    expect(again.length).toBe(l.zombies.length - 2);
  });
});

describe('extension lights, steam vents and the rest', () => {
  it('annex fixtures: untinted, under the annex ceilings, consistent profiles, the entry corridor never dark, much darker than the station', () => {
    for (const l of WITH()) {
      const rep = extensionContentOf(l)!;
      const ext = l.lights.slice(rep.first.lights);
      expect(ext.every(x => !x.tint && !x.virtual)).toBe(true);
      for (const n of l.extensions!.annexes) {
        expect(l.areas[n.areas[0]].lighting).not.toBe('dark');
        for (const id of n.areas) {
          const a = l.areas[id], own = ext.filter(x => x.area === id), steady = own.filter(x => !x.broken && !x.dying);
          expect(own.length).toBeGreaterThan(0);
          for (const x of own) { expect(x.y).toBeLessThan(a.ceil); expect(x.y).toBeGreaterThan(a.floorY!); }
          if (a.lighting === 'dark') expect(steady.length).toBe(0); else expect(steady.length).toBeGreaterThan(0);
        }
      }
      // darker: the share of steadily working fixtures in the annexes is well below the core station's
      const coreL = l.lights.slice(0, rep.first.lights).filter(x => !x.virtual), annL = ext.filter(inAnnex(l));
      const share = (L: typeof ext) => L.filter(x => !x.broken && !x.dying).length / Math.max(1, L.length);
      expect(share(annL)).toBeLessThan(share(coreL) * 0.6);
    }
  });

  it('tunnel fixtures: sparse, on the centreline, mostly dead or dying; the tunnel profile matches', () => {
    let n = 0, steady = 0;
    for (const l of [...WITH(), sub(SUBWAY.none)]) {
      const rep = extensionContentOf(l)!;
      for (const t of l.extensions!.tunnels) {
        const a = l.areas[t.areas[0]], own = l.lights.slice(rep.first.lights).filter(x => x.area === a.id);
        expect(own.length).toBeLessThanOrEqual(Math.floor(t.length / ANNEX_CONTENT.lights.tunnel.step[0]) + 1);
        for (const x of own) { expect(l.grid.area[l.grid.idx(...l.grid.cellOf(x.x, x.z))]).toBe(a.id); expect(x.tint).toBeUndefined(); }
        const s = own.filter(x => !x.broken && !x.dying).length;
        expect(a.lighting).toBe(s ? 'dim' : 'dark');
        n += own.length; steady += s;
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(steady / n).toBeLessThan(0.4);
  });

  it('steam vents come from the dressing: per annex <= the emitter cap, on an annex wall face, between floor and ceiling', () => {
    expect(ANNEX_CONTENT.ventsPerAnnex).toBeLessThanOrEqual(STEAM.perAnnex);
    for (const l of WITH()) {
      const vents = l.extensions!.vents!, g = l.grid, own = inAnnex(l);
      expect(annexVents(l)).toBe(vents);
      for (const n of l.extensions!.annexes) expect(vents.filter(v => n.areas.includes(v.area)).length).toBeLessThanOrEqual(ANNEX_CONTENT.ventsPerAnnex);
      expect(vents.length).toBeGreaterThan(0);
      for (const v of vents) {
        expect(own(v)).toBe(true);
        const a = l.areas[v.area];
        expect(v.y).toBeGreaterThan(a.floorY!);
        expect(v.y).toBeLessThan(a.ceil);
        // just behind the vent point (against its blow direction) is rock
        const [bx, by] = g.cellOf(v.x - Math.sign(v.dir.x) * 0.2, v.z - Math.sign(v.dir.z) * 0.2);
        expect(g.get(bx, by), `${l.seed} vent at ${v.x},${v.z}`).toBe(SOLID);
        expect(v.dir.y).toBeGreaterThan(0);
      }
    }
  });

  it('a level without annexes gets no annex content (tunnel fixtures only)', () => {
    const l = sub(SUBWAY.none), rep = extensionContentOf(l)!;
    expect(l.extensions!.annexes).toEqual([]);
    expect(rep.props + rep.pickups).toBe(0);
    expect(l.zombies.length).toBe(rep.first.zombies);
    expect(l.extensions!.vents).toBeUndefined();
  });

  it('dropExtensions removes the appended content with the extensions (cells back to rock, no blocked footprints left)', () => {
    const l = generateStation(SUBWAY[1]), rep = extensionContentOf(l)!;
    const cells = annexAreas(l).flatMap((a: Area) => { const out: number[] = []; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) out.push(l.grid.idx(x, y)); return out; });
    dropExtensions(l);
    for (const k of ['props', 'signs', 'lights', 'pickups', 'zombies'] as const) expect(l[k].length, k).toBe(rep.first[k]);
    for (const i of cells) { expect(l.grid.cells[i]).toBe(SOLID); expect(l.grid.blocked[i]).toBe(0); }
    expect(l.extensions!.vents).toBeUndefined();
  });

  it('the tunnel cap overhang derives from the cap rock GEN reserves (TRACK_EXT.tunnel.capDepth)', () => {
    expect(CAP_OVERHANG).toBe(TRACK_EXT.tunnel.capDepth - CAP_SKIN);
    expect(CAP_OVERHANG).toBeLessThan(TRACK_EXT.tunnel.capDepth);
    expect(CELL).toBeGreaterThan(0);
  });
});
