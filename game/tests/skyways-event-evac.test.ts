// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane EVAC): the EVACUATION CENTRE event's layout — the venue carve
// dressed as a whole-floor improvised shelter (gen/skyways/events/evacDress.ts). On evacuation-centre seeds at layout version 7:
//  - every section is there (registration, sleeping, rations, medical, barricaded) and the dormitory's cots stand in rows along a clear
//    central aisle;
//  - every opening of the shelter's public rooms is still reached by a 1.2 m path from the bridge mouths; the barricaded quarantine's
//    far side through its squeeze gap;
//  - 6-10 notes per shelter, all three story themes, each lying on a real support and readable from a reachable spot (world/skywaysNotes.ts);
//  - loot stays ordinary: a few ration pickups on the ration tables, holders with their normal themed tables (no ammo / weapons);
//  - deterministic; the Skyways validator is clean; every new kind is classified (physics / openables / damage) with a scale record.
// (Versions 1-6 regenerate unchanged: tests/skyways-dest-layout-version.test.ts.)

import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, Area} from '../src/gen/stationTypes';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {itemDef} from '../src/items/items';
import {PANTRY_ROWS} from '../src/items/lootTables';
import {skywaysAddonDressOf} from '../src/gen/skyways/addon';
import {skywaysAddonFor} from '../src/gen/skyways/frame';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {SKYWAYS_MERCH_TOP} from '../src/gen/skyways/addonKinds';
import {bandCells, portalsOf} from '../src/gen/skyways/venueDress';
import {EVAC_DORM, EVAC_RATIONS, evacPickupsOf, noteRange} from '../src/gen/skyways/events/evacDress';
import {EVAC_KINDS, EVAC_NOTE, EVAC_SCALE, EVAC_SPECS, evacNoteOf} from '../src/gen/skyways/events/evacKinds';
import {EVAC_NOTES, EVAC_NOTE_COUNT, EVAC_NOTE_THEMES} from '../src/gen/skyways/events/evacNotes';
import {EVAC_ROOM_NAMES} from '../src/gen/skyways/events/evacTypes';
import {SkywaysNotes, NOTE_READ} from '../src/world/skywaysNotes';
import {toWorld} from '../src/gen/skyways/addonFrame';

/**
 * Evacuation-centre seeds at version 7: a cordoned dormitory corner (2, 51), barricaded rooms (15; 50 with a family room; 74, a small
 * 5.5 x 4 m room). (All twelve such seeds in 1-80 — 2 7 11 14 15 25 38 50 51 64 72 74 — passed this file when it was written.)
 */
const SEEDS = [2, 15, 50, 51, 74];
const cache = new Map<number, StationLayout>();
const gen = (seed: number): StationLayout => {
  let L = cache.get(seed);
  if (!L) { L = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 7} as never) as StationLayout; cache.set(seed, L); }
  return L;
};
const PUB_ROLES = ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge'];
const evacOf = (L: StationLayout) => L.skyways!.addon.evac!;
const gridOf = (L: StationLayout) => L.levels[L.skyways!.addon.level]?.grid ?? L.grid;
const pubAreas = (L: StationLayout): Area[] => L.skyways!.addon.venue!.filter(q => PUB_ROLES.includes(q.role)).map(q => L.areas[q.area]);
const eventProps = (L: StationLayout): PropPlacement[] => skywaysAddonDressOf(L)!.event!.props;

/** BFS over floor cells (of `ids`, or any) a body of radius r stands in, from the bridge mouths' bands. */
function walk(L: StationLayout, ids: ReadonlySet<number> | null, r: number): Uint8Array {
  const g = gridOf(L), bridges = new Set((L.skyways!.bridges ?? []).map(b => b.area));
  const seen = new Uint8Array(g.w * g.h), q: number[] = [];
  const ok = (i: number) => g.cells[i] === FLOOR && (!ids || ids.has(g.area[i])) && !g.blocked[i] && g.circleClear((i % g.w + 0.5) * CELL, (Math.floor(i / g.w) + 0.5) * CELL, r);
  for (const a of pubAreas(L)) for (const p of portalsOf(L, g, a)) if (bridges.has(p.to)) for (const i of bandCells(g, a, p)) if (!seen[i] && ok(i)) { seen[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % g.w;
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) {
      if (j < 0 || j >= g.cells.length || Math.abs((j % g.w) - x) > 1 || seen[j] || !ok(j)) continue;
      seen[j] = 1; q.push(j);
    }
  }
  return seen;
}

describe('Skyways evacuation centre (layout version 7): the shelter', () => {
  it('the test seeds draw the evacuation centre at version 7 only', () => {
    for (const s of SEEDS) expect(skywaysAddonFor(s, 7), `seed ${s}`).toBe('evac-centre');
  });

  it('every section is there: registration, sleeping, rations, medical, barricaded; the rooms carry the shelter names', () => {
    for (const s of SEEDS) {
      const L = gen(s), ev = evacOf(L), roles = new Set(ev.sections.map(x => x.role));
      for (const r of ['registration', 'sleeping', 'rations', 'medical', 'barricaded'] as const) expect(roles.has(r), `seed ${s} ${r}`).toBe(true);
      expect(ev.name, `seed ${s}`).toMatch(/ (Emergency Shelter|Evacuation Centre|Reception Centre)$/);
      expect(ev.quarantine, `seed ${s}`).not.toBe(null);
      const hall = L.areas[L.skyways!.addon.venue!.find(q => q.role === 'main-hall')!.area];
      expect(hall.label).toBe(EVAC_ROOM_NAMES.hall);
      const skipped = skywaysAddonDressOf(L)!.skipped.filter(x => /evac: (quarantine|registration|medical bay|ration line|dormitory|triage)/.test(x));
      expect(skipped, `seed ${s}`).toEqual([]);
      expect(skywaysIssues(L), `seed ${s} validation`).toEqual([]);
    }
  });

  it('the dormitory: cots in rows (head to head pairs, on whole cells) along a clear central aisle', () => {
    for (const s of SEEDS) {
      const L = gen(s), ev = evacOf(L), hall = L.areas[L.skyways!.addon.venue!.find(q => q.role === 'main-hall')!.area];
      const cots = L.props.filter(p => p.kind === 'evacCot' && p.area === hall.id);
      expect(ev.dorm!.cots, `seed ${s}`).toBeGreaterThanOrEqual(20);
      expect(ev.dorm!.cots).toBeLessThanOrEqual(EVAC_DORM.maxCots);
      // rows: cots sharing one centre line across the hall and one heading, at least 3 per row; most cots stand in one
      const {ax, az, bx, bz} = ev.dorm!.spine, alongX = Math.abs(bx - ax) > Math.abs(bz - az);
      const rows = new Map<string, PropPlacement[]>();
      for (const c of cots) { const k = `${(alongX ? c.z : c.x).toFixed(2)}|${c.rot.toFixed(2)}`; rows.set(k, [...(rows.get(k) ?? []), c]); }
      const inRows = [...rows.values()].filter(r => r.length >= 3).reduce((n, r) => n + r.length, 0);
      expect(inRows / cots.length, `seed ${s} cots in rows`).toBeGreaterThanOrEqual(0.7);
      expect([...rows.values()].filter(r => r.length >= 5).length, `seed ${s} long rows`).toBeGreaterThanOrEqual(2);
      // the central aisle: no floor prop of the hall stands within 0.6 m of its line
      const along = (p: PropPlacement) => (alongX ? p.x : p.z), across = (p: PropPlacement) => (alongX ? p.z : p.x), mid = alongX ? az : ax;
      const lo = Math.min(alongX ? ax : az, alongX ? bx : bz), hi = Math.max(alongX ? ax : az, alongX ? bx : bz);
      for (const p of L.props) {
        if (p.area !== hall.id || p.host !== undefined || p.mounted || p.kind === 'evacNote') continue;
        const h = alongX ? p.hz : p.hx, u = alongX ? p.hx : p.hz;
        if (along(p) + u < lo || along(p) - u > hi) continue;
        expect(Math.abs(across(p) - mid) - h, `seed ${s} ${p.kind} in the aisle`).toBeGreaterThanOrEqual(0.6 - 1e-6);
      }
      // a row's neighbours never touch (the 0.5 m gap between cots along a row)
      for (const r of rows.values()) {
        const us = r.map(along).sort((p, q) => p - q);
        for (let k = 1; k < us.length; k++) expect(us[k] - us[k - 1], `seed ${s}`).toBeGreaterThanOrEqual(EVAC_DORM.pitch - 1e-6);
      }
    }
  });

  it('every opening of the shelter\'s public rooms is still reached by a 1.2 m path from the bridge mouths; the quarantine\'s far side too', () => {
    for (const s of SEEDS) {
      const L = gen(s), g = gridOf(L), areas = pubAreas(L);
      const seen = walk(L, new Set(areas.map(a => a.id)), 0.6);
      for (const a of areas) for (const [k, p] of portalsOf(L, g, a).entries()) {
        expect(bandCells(g, a, p).some(i => seen[i]), `seed ${s} ${a.label} opening ${k} -> ${L.areas[p.to]?.label}`).toBe(true);
      }
      // the quarantine: its record's squeeze gap is open floor; floor beyond it is reached (a 1.2 m body)
      const q = evacOf(L).quarantine!, qa = L.areas[q.area];
      const inner = (i: number) => {
        const x = (i % g.w + 0.5) * CELL, z = (Math.floor(i / g.w) + 0.5) * CELL;
        if (g.area[i] !== qa.id) return false;
        return q.corner ? x > q.corner.x0 + 0.9 && x < q.corner.x1 - 0.9 && z > q.corner.z0 + 0.9 && z < q.corner.z1 - 0.9 : Math.hypot(x - q.gap.x, z - q.gap.z) > 1.6;
      };
      const all = walk(L, null, 0.6);
      let beyond = 0;
      for (let i = 0; i < all.length; i++) if (all[i] && inner(i)) beyond++;
      expect(beyond, `seed ${s} quarantine interior reached`).toBeGreaterThan(0);
      // barricaded: the room / corner holds barricade pieces
      const pieces = L.props.filter(p => p.area === qa.id && ['crowdBarrier', 'foldingBarricade', 'cartonStack', 'trashBagPile'].includes(p.kind));
      expect(pieces.length, `seed ${s}`).toBeGreaterThanOrEqual(2);
      // the warnings: a painted warning board and (a room) an isolation plate
      expect(L.props.some(p => p.kind === 'evacWarnBoard'), `seed ${s} warning board`).toBe(true);
    }
  });

  it('the notes: 6-10 per shelter, all three themes, distinct, on real supports, readable from a reachable spot', () => {
    for (const s of SEEDS) {
      const L = gen(s), ev = evacOf(L), g = gridOf(L);
      expect(ev.notes.length, `seed ${s}`).toBeGreaterThanOrEqual(EVAC_NOTE_COUNT[0]);
      expect(ev.notes.length, `seed ${s}`).toBeLessThanOrEqual(EVAC_NOTE_COUNT[1]);
      const texts = ev.notes.map(n => n.text);
      expect(new Set(texts).size, `seed ${s} distinct`).toBe(texts.length);
      for (const t of EVAC_NOTE_THEMES) expect(texts.some(i => EVAC_NOTES[i].themes.includes(t)), `seed ${s} theme ${t}`).toBe(true);
      // one behind the quarantine's barricade, one on the notice board
      const q = ev.quarantine!;
      expect(ev.notes.some(n => n.area === q.area && (q.corner ? n.x > q.corner.x0 && n.x < q.corner.x1 && n.z > q.corner.z0 && n.z < q.corner.z1 : Math.hypot(n.x - q.gap.x, n.z - q.gap.z) > 1.0)), `seed ${s} quarantine note`).toBe(true);
      expect(ev.notes.some(n => n.on === 'board'), `seed ${s} pinned note`).toBe(true);
      const host = {player: {x: 0, y: 0, z: 0, yaw: 0}, layout: L, state: 'playing', interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
        sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[]};
      const rt = new SkywaysNotes(host).install();
      rt.build(L);
      expect(rt.notes.length, `seed ${s}`).toBe(ev.notes.length);
      const reach = walk(L, null, 0.3);
      for (const n of ev.notes) {
        const p = L.props[n.prop];
        expect(p.kind).toBe('evacNote');
        expect([p.x, p.y, p.z]).toEqual([n.x, n.y, n.z]);
        expect(EVAC_NOTES[evacNoteOf(p.variant).index].id).toBe(n.id);
        expect(evacNoteOf(p.variant).pinned).toBe(n.on === 'board');
        // on a real support
        if (n.on === 'floor') {
          const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
          expect(g.cells[i]).toBe(FLOOR);
          expect(g.blocked[i], `seed ${s} ${n.id} floor cell`).toBe(0);
          expect(Math.abs(p.y - g.floorOf(i)), `seed ${s} ${n.id} on the floor`).toBeLessThan(0.01);
        } else {
          const h = L.props[p.host!];
          const want = {table: ['skywaysConMerchTable', 'table'], desk: ['desk'], bedroll: ['bedroll'], board: ['noticeBoard']}[n.on];
          expect(want, `seed ${s} ${n.id}`).toContain(h.kind);
          expect(PROP_PHYSICS_AUDIT[h.kind]?.cls, `${h.kind} holds a note: static`).not.toBe('dynamic');
          const top = h.kind === 'skywaysConMerchTable' ? SKYWAYS_MERCH_TOP.y : h.kind === 'bedroll' ? 0.106 : PROP_DEFS[h.kind].h;
          if (n.on === 'board') {
            expect(p.y - h.y).toBeGreaterThanOrEqual(0);
            expect(p.y - h.y + EVAC_NOTE.d).toBeLessThanOrEqual(PROP_DEFS.noticeBoard.h + 1e-6);
          } else expect(Math.abs(p.y - (h.y + top)), `seed ${s} ${n.id} on its ${h.kind}`).toBeLessThan(0.002);
          // inside the support's top (host-local)
          const c = Math.cos(h.rot), sn = Math.sin(h.rot), dx = p.x - h.x, dz = p.z - h.z, lx = dx * c - dz * sn;
          const [x0, x1] = noteRange(h);
          expect(lx, `seed ${s} ${n.id} along its ${h.kind}`).toBeGreaterThanOrEqual(x0 - 0.002);
          expect(lx).toBeLessThanOrEqual(x1 + 0.002);
          expect(toWorld(h, lx, dx * sn + dz * c)[0]).toBeCloseTo(p.x, 3);
        }
        // readable: some reachable spot within reach shows this note's prompt when looking at it
        let read = false;
        const cand: number[] = [];
        const [ncx, ncy] = g.cellOf(p.x, p.z), R = Math.ceil(NOTE_READ.reach / CELL);
        for (let y = ncy - R; y <= ncy + R; y++) for (let x = ncx - R; x <= ncx + R; x++) if (g.inBounds(x, y) && reach[g.idx(x, y)]) cand.push(g.idx(x, y));
        cand.sort((a, b) => Math.hypot((a % g.w + 0.5) * CELL - p.x, (Math.floor(a / g.w) + 0.5) * CELL - p.z) - Math.hypot((b % g.w + 0.5) * CELL - p.x, (Math.floor(b / g.w) + 0.5) * CELL - p.z));
        for (const i of cand) {
          const px = (i % g.w + 0.5) * CELL, pz = (Math.floor(i / g.w) + 0.5) * CELL;
          Object.assign(host.player, {x: px, z: pz, y: g.floorOf(i), yaw: Math.atan2(-(p.x - px), -(p.z - pz))});
          rt.frame();
          if (rt.target === p) { read = true; break; }
        }
        expect(read, `seed ${s} ${n.id} (${n.on}) readable`).toBe(true);
      }
    }
  });

  it('loot stays ordinary: 2-4 rations on the ration tables, themed holders without ammo / weapons, a bounded total', () => {
    for (const s of SEEDS) {
      const L = gen(s), props = eventProps(L);
      const picks = evacPickupsOf(L).map(i => L.pickups[i]);
      expect(picks.length, `seed ${s} rations`).toBeGreaterThanOrEqual(EVAC_RATIONS[0]);
      expect(picks.length).toBeLessThanOrEqual(EVAC_RATIONS[1]);
      const pantry = new Set(PANTRY_ROWS.map(r => r[0]));
      for (const k of picks) {
        expect(pantry.has(k.itemId), `seed ${s} ${k.itemId}`).toBe(true);
        expect(k.count).toBe(1);
        const t = L.props.find(p => p.kind === 'skywaysConMerchTable' && Math.abs(k.y - (p.y + SKYWAYS_MERCH_TOP.y)) < 0.002 && (() => {
          const c = Math.cos(p.rot), sn = Math.sin(p.rot), dx = k.x - p.x, dz = k.z - p.z;
          return Math.abs(dx * c - dz * sn) <= SKYWAYS_MERCH_TOP.x && Math.abs(dx * sn + dz * c) <= SKYWAYS_MERCH_TOP.z;
        })());
        expect(t, `seed ${s} ration ${k.itemId} on a ration table`).toBeTruthy();
      }
      let holders = 0, maxLots = 0;
      for (const p of props) {
        if (!isLootHolderKind(p.kind)) continue;
        holders++;
        const a = L.areas[p.area], t = holderTable(p.kind, p.purpose ?? a.purpose ?? a.type);
        maxLots += t.lots[1];
        for (const [id] of t.rows) expect(['ammo', 'weapon'], `seed ${s} ${p.kind} (${p.purpose ?? a.type}) rolls ${id}`).not.toContain(itemDef(id).kind);
      }
      // (over the twelve evacuation-centre seeds in 1-80: 11-17 holders, at most 28-39 lots; a whole floor, no jackpot)
      expect(holders, `seed ${s} holders`).toBeLessThanOrEqual(20);
      expect(maxLots, `seed ${s} most lots`).toBeLessThanOrEqual(45);
    }
  });

  it('deterministic per seed', () => {
    const s = SEEDS[0], a = gen(s);
    const b = LEVELS.skyways.generate('main', {levelSeed: s, startWeapon: 'pistol', layoutVersion: 7} as never) as StationLayout;
    expect(JSON.stringify(b.skyways!.addon.evac)).toBe(JSON.stringify(a.skyways!.addon.evac));
    const sig = (L: StationLayout) => eventProps(L).map(p => `${p.kind}@${p.x},${p.y},${p.z},${p.rot},${p.variant}`).join(';');
    expect(sig(b)).toBe(sig(a));
  });

  it('every new kind is classified (physics / openables / damage), drawn from code parts, and has a scale record', () => {
    for (const k of EVAC_KINDS) {
      expect(PROP_DEFS[k], k).toBeTruthy();
      expect(PROP_PHYSICS_AUDIT[k], k).toBeTruthy();
      expect(OPENABLE_AUDIT.some(r => r.kind === k), k).toBe(true);
      expect(PROP_DAMAGE[k], k).toBeTruthy();
      expect(EVAC_SPECS[k].parts?.(0).length, k).toBeGreaterThan(0);
      expect(EVAC_SCALE[k], k).toMatch(/\d+\.\d+ x /);
    }
    // the light furniture moves (rule 2); the sheet / the painted board are static, honestly classified
    expect(PROP_PHYSICS_AUDIT.evacCot.cls).toBe('dynamic');
    expect(PROP_PHYSICS_AUDIT.evacScreen.cls).toBe('dynamic');
    expect(PROP_PHYSICS_AUDIT.evacNote.cls).not.toBe('dynamic');
    expect(PROP_PHYSICS_AUDIT.evacWarnBoard.cls).not.toBe('dynamic');
  });
});
