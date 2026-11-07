// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOCKEY): BLUE LINE SPORTS, the Skyways hockey store (layout version 3:
// gen/skyways/stores/hockey.ts + hockeyDress.ts, its drawn kinds stores/kinds/hockey.ts + hockeyParts.ts). Over several real seeds:
//  - a real hockey pro shop: cash desk (till + register + an openable back unit), the skate-sharpening counter (sharpener + openable
//    tool chest), the shooting lane (dasher boards + goal), team lockers (openable) + bench, the jersey wall with jerseys, the boot wall
//    with skates, helmets / gloves / shin guards on shelving and tables, stick racks with their sticks, the goalie;
//  - storage opens (OPENABLE_AUDIT), loot on-theme per holder (no ammo on the sales floor, the tool chest's hardware rows), supported
//    stock (every hosted piece on its host's real surface), fit (in the store, no overlaps), clear routes, physics classes, back rooms
//    stocked (and a staff corner when a store has none), the rink palette, the drawn kinds' sizes, determinism.
import {beforeAll, describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {CELL} from '../src/gen/grid';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {caliberOfItem} from '../src/items/calibers';
import {purposeById} from '../src/gen/purposes';
import {SHAPE_MAT_KEYS} from '../src/gen/propShapes';
import {PURPOSE_MAT_KEYS} from '../src/gen/purposeShapes';
import {MALL_SURFACES} from '../src/gen/mall/kinds';
import {SKYWAYS_DEST_SPECS} from '../src/gen/skyways/destinations/registry';
import {ANCHOR_STYLES, anchorStyleOf} from '../src/gen/skyways/destinations/anchorStyles';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {STORE_HOCKEY} from '../src/gen/skyways/stores/hockey';
import {HOCKEY_PURPOSE} from '../src/gen/skyways/stores/hockeyDress';
import {HK_STICK_RACK} from '../src/gen/skyways/stores/hockeyParts';
import {STORE_HOCKEY_KINDS, STORE_HOCKEY_MALL_MODELS, STORE_HOCKEY_SPECS} from '../src/gen/skyways/stores/kinds/hockey';
import {SKYWAYS_SHOP_FAMILIES} from '../src/gen/skyways/skywaysTypes';
import type {StationLayout} from '../src/gen/stationTypes';
import {findStores, storeAreas, storeProps, type StoreHit} from './helpers/skywaysStores';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PROFILE = lootProfile('skyways');
let hits: StoreHit[] = [];
beforeAll(() => { hits = findStores('hockey', {count: 8, maxSeed: 40}); }, 600_000);

const kinds = (ps: readonly PropPlacement[], k: string) => ps.filter(p => p.kind === k);
/** The store's sales-floor props (its floor pieces), the back rooms' separately. */
function split(l: StationLayout, hit: StoreHit) {
  const A = storeAreas(l, hit.anchor), floor = new Set(A.floor), stock = new Set(A.stock);
  const all = storeProps(l, hit.anchor);
  return {A, all, floor: all.filter(p => floor.has(p.area)), back: all.filter(p => stock.has(p.area))};
}
/** A store big enough for the whole program (no inset stock room cutting the floor, >= 120 m2 of floor). */
function roomy(l: StationLayout, hit: StoreHit): boolean {
  const A = storeAreas(l, hit.anchor);
  const m2 = A.floor.reduce((s, id) => s + l.areas[id].w * l.areas[id].h * CELL * CELL, 0);
  return A.floor.length === 1 && m2 >= 120;
}

describe('Skyways store: Blue Line Sports (hockey)', () => {
  it('finds hockey stores on several seeds (version 3), both plain and inset-back-room footprints', () => {
    expect(hits.length).toBeGreaterThanOrEqual(6);
    expect(hits.filter(h => roomy(h.layout, h)).length).toBeGreaterThanOrEqual(3);
  });

  it('is a real hockey pro shop: cash desk, sharpening counter, lane, lockers, jerseys, skates, gear, sticks, goalie', () => {
    let lanes = 0, roomyN = 0;
    for (const h of hits) {
      const {floor} = split(h.layout, h), why = `seed ${h.seed}`;
      // the cash desk: a till with its register and an openable back unit behind it
      expect(kinds(floor, 'shopCounter').length, why).toBeGreaterThanOrEqual(2);
      expect(kinds(floor, 'cashRegister').length, why).toBe(1);
      expect(kinds(floor, 'mallCashwrapCounter').length + kinds(floor, 'cabinetTall').length, why).toBeGreaterThanOrEqual(1);
      // the sharpening counter: the sharpener and the openable tool chest (its own hardware loot key)
      expect(kinds(floor, 'benchGrinderStand').length, why).toBe(1);
      const chest = kinds(floor, 'rollingToolChest');
      expect(chest.length, why).toBe(1);
      expect(chest[0].purpose, why).toBe(HOCKEY_PURPOSE.tools);
      // stick racks with their sticks, the goalie
      const racks = kinds(floor, 'hkStickRack'), sticks = kinds(floor, 'hkSticks');
      expect(sticks.length, why).toBe(racks.length);
      expect(kinds(floor, 'skyDGoalieMannequin').length, why).toBe(1);
      // the boot wall's skates and the gear (helmets / gloves / shin guards)
      if (kinds(floor, 'hkSkates').length) expect(kinds(floor, 'wallBay').length, why).toBeGreaterThanOrEqual(2);
      const lane = kinds(floor, 'hkRinkBoard').length >= 2 && kinds(floor, 'skyDHockeyNet').length >= 1;
      if (lane) lanes++;
      if (!roomy(h.layout, h)) continue;
      roomyN++;
      // a roomy store has the whole program
      expect(racks.length, why).toBeGreaterThanOrEqual(2);
      expect(kinds(floor, 'hkSkates').length, why).toBeGreaterThanOrEqual(6);
      expect(kinds(floor, 'hkHelmet').length + kinds(floor, 'hkGloves').length + kinds(floor, 'hkShinPads').length, why).toBeGreaterThanOrEqual(3);
      expect(kinds(floor, 'staffLockers').length, why).toBeGreaterThanOrEqual(2);
      expect(kinds(floor, 'mallBench').length, why).toBe(1);
      expect(kinds(floor, 'clothingWallUnit').length, why).toBeGreaterThanOrEqual(1);
      expect(kinds(floor, 'hkJersey').length, why).toBeGreaterThanOrEqual(2);
    }
    expect(roomyN).toBeGreaterThanOrEqual(3);
    // the shooting lane finds a back corner or a wall in most stores
    expect(lanes, `lanes ${lanes} / ${hits.length}`).toBeGreaterThanOrEqual(Math.ceil(hits.length * 0.6));
  });

  it('storage opens: every storage kind the store uses is openable (OPENABLE_AUDIT), its drawn kinds are classified honestly', () => {
    const audit = new Map(OPENABLE_AUDIT.map(r => [r.kind, r]));
    const storage = ['staffLockers', 'mallCashwrapCounter', 'rollingToolChest', 'cabinetTall', 'firstAidWallKit', 'cardboardBoxFlaps', 'storageTote', 'shopCooler'];
    for (const k of storage) expect(['openable', 'existing'], k).toContain(audit.get(k)?.cls);
    for (const h of hits) for (const p of split(h.layout, h).all) if (storage.includes(p.kind)) expect(['openable', 'existing']).toContain(audit.get(p.kind)?.cls);
    for (const k of STORE_HOCKEY_KINDS) {
      const r = audit.get(k);
      expect(r, k).toBeTruthy();
      expect(['none', 'exception'], k).toContain(r!.cls);
      expect(r!.how.length, k).toBeGreaterThan(10);
      expect(r!.role, k).not.toBe('storage');
    }
  });

  it('loot is on-theme per holder: the sales floor sports stock (no ammo), the tool chest hardware, the back rooms the sports stock room', () => {
    expect(purposeById(HOCKEY_PURPOSE.floor)).toBeTruthy();
    expect(purposeById(HOCKEY_PURPOSE.back)).toBeTruthy();
    expect(purposeById(HOCKEY_PURPOSE.tools)).toBeTruthy();
    expect(STORE_HOCKEY.purposes).toEqual({floor: 'mall-sports', stock: 'mall-sports-back', office: 'mall-sports-back'});
    const FLOOR_OK = new Set(['water', 'bandage', 'chocolate', 'juice', 'cola', 'chips', 'medkit']);
    const TOOLS_OK = new Set(['battery', 'flare', 'water', 'bandage']);
    let holders = 0;
    for (const h of hits) {
      const l = h.layout, {floor} = split(l, h);
      for (const p of floor) {
        if (!isLootHolderKind(p.kind)) continue;
        holders++;
        const key = p.purpose ?? l.areas[p.area].purpose!;
        const t = holderTable(p.kind, key, PROFILE);
        const items = t.rows.map(r => r[0]);
        for (const id of items) expect(caliberOfItem(id), `seed ${h.seed} ${p.kind} ${id}`).toBeNull();
        if (p.kind === 'rollingToolChest') { expect(key).toBe('mall-hardware'); for (const id of items) expect(TOOLS_OK.has(id), id).toBe(true); continue; }
        expect(key, p.kind).toBe('mall-sports');
        for (const id of items) expect(FLOOR_OK.has(id), `${p.kind}: ${id}`).toBe(true);
      }
      for (const id of storeAreas(l, h.anchor).stock) expect(l.areas[id].purpose).toBe('mall-sports-back');
    }
    expect(holders).toBeGreaterThan(hits.length * 8);
  });

  it('fit: every store prop stands in the store, floor props never overlap, hosted stock sits on its host\'s real surface', () => {
    for (const h of hits) {
      const l = h.layout, {A, all} = split(l, h);
      const g = l.levels[h.anchor.level].grid;
      for (const p of all) {
        if (p.mounted || p.host !== undefined) continue;
        // its footprint cells are the store's floor (its own area)
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(A.all.has(g.area[g.idx(cx, cy)]), `seed ${h.seed} ${p.kind}`).toBe(true);
      }
      const floorProps = all.filter(p => !p.mounted && p.host === undefined && p.kind !== 'shopGlazing');
      for (let i = 0; i < floorProps.length; i++) for (let j = i + 1; j < floorProps.length; j++) {
        const a = floorProps[i], b = floorProps[j];
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(ox > 0.02 && oz > 0.02 && oy > 0.02, `seed ${h.seed}: ${a.kind} x ${b.kind}`).toBe(false);
      }
      // hosted stock: on its host, at the host's surface height, inside the host's footprint
      for (const p of all) {
        if (!p.kind.startsWith('hk') || p.host === undefined) continue;
        const host = l.props[p.host];
        const want: Record<string, string[]> = {hkSticks: ['hkStickRack'], hkJersey: ['clothingWallUnit'], hkSkates: ['wallBay'], hkHelmet: ['wallBay', 'merchTable'], hkGloves: ['wallBay', 'merchTable'], hkShinPads: ['wallBay', 'merchTable']};
        expect(want[p.kind], p.kind).toContain(host.kind);
        const top = r3(p.y - host.y);
        const tops = p.kind === 'hkSticks' ? [HK_STICK_RACK.trayY] : p.kind === 'hkJersey' ? [r3(1.915 - PROP_DEFS.hkJersey.h)]
          : (MALL_SURFACES[host.kind as 'wallBay' | 'merchTable']).map(s => s.y);
        expect(tops.some(t => Math.abs(t - top) < 0.002), `${p.kind} at ${top} on ${host.kind}`).toBe(true);
        expect(Math.abs(p.x - host.x) <= host.hx + 1e-3 && Math.abs(p.z - host.z) <= host.hz + 1e-3, `${p.kind} inside ${host.kind}`).toBe(true);
        expect(PROP_DEFS[host.kind].physics?.dynamic ?? false, `${host.kind} static`).toBe(false);
      }
    }
  });

  it('clear routes: from the storefront to every door, every floor piece and the till / lockers / sharpening counter / lane mouth', () => {
    for (const h of hits) {
      const l = h.layout, {A, floor} = split(l, h), g = l.levels[h.anchor.level].grid;
      const doorCells = new Set<number>();
      const storeDoors = l.doors.filter(d => A.all.has(d.a) || A.all.has(d.b));
      for (const d of storeDoors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCells.add(g.idx(x, y));
      const ok = (i: number) => g.cells[i] === 1 && !g.blocked[i] && (A.all.has(g.area[i]) || doorCells.has(i));
      const sf = storeDoors.find(d => d.shopfront)!;
      expect(sf, `seed ${h.seed} storefront door`).toBeTruthy();
      const seen = new Uint8Array(g.w * g.h), stack: number[] = [];
      for (let y = sf.y; y < sf.y + sf.h; y++) for (let x = sf.x; x < sf.x + sf.w; x++) { const i = g.idx(x, y); if (ok(i)) { seen[i] = 1; stack.push(i); } }
      while (stack.length) {
        const i = stack.pop()!, x = i % g.w, y = (i - x) / g.w;
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) { if (!g.inBounds(nx, ny)) continue; const j = g.idx(nx, ny); if (!seen[j] && ok(j)) { seen[j] = 1; stack.push(j); } }
      }
      const reach = (x: number, z: number, r = 1) => { const [cx, cy] = g.cellOf(x, z); for (let oy = -r; oy <= r; oy++) for (let ox = -r; ox <= r; ox++) if (g.inBounds(cx + ox, cy + oy) && seen[g.idx(cx + ox, cy + oy)]) return true; return false; };
      for (const d of storeDoors) if (!d.shopfront) expect(reach((d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL), `seed ${h.seed} door ${d.a}-${d.b}`).toBe(true);
      for (const id of A.floor) { const a = l.areas[id]; let any = false; for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w && !any; x++) any = !!seen[g.idx(x, y)]; expect(any, `piece ${id}`).toBe(true); }
      const front = (p: PropPlacement, off: number) => reach(p.x + Math.sin(p.rot) * (PROP_DEFS[p.kind].d / 2 + off), p.z + Math.cos(p.rot) * (PROP_DEFS[p.kind].d / 2 + off), 0);
      for (const p of [...kinds(floor, 'shopCounter'), ...kinds(floor, 'staffLockers'), ...kinds(floor, 'wallBay'), ...kinds(floor, 'clothingWallUnit')]) expect(front(p, 0.3), `seed ${h.seed} front of ${p.kind}`).toBe(true);
      for (const n of kinds(floor, 'skyDHockeyNet')) expect(front(n, 0.6), `seed ${h.seed} goal mouth`).toBe(true);
    }
  });

  it('physics: the loose gear is dynamic on-host decor, the rack / sticks / jerseys / boards static with their reasons', () => {
    for (const k of ['hkSkates', 'hkHelmet', 'hkGloves', 'hkShinPads'] as const) {
      const row = PROP_PHYSICS_AUDIT[k];
      expect(row?.cls, k).toBe('dynamic');
      expect(row?.onHost, k).toBe(true);
      expect(row?.mat, k).toBe('pad');
      expect(PROP_DEFS[k].physics?.dynamic, k).toBe(true);
      expect(PROP_DEFS[k].physics!.mass, k).toBeGreaterThan(0.3);
      expect(PROP_DEFS[k].physics!.mass, k).toBeLessThan(3);
    }
    for (const k of ['hkStickRack', 'hkSticks', 'hkJersey', 'hkRinkBoard'] as const) {
      const row = PROP_PHYSICS_AUDIT[k];
      expect(row?.cls, k).toBe('static');
      expect(PROP_DEFS[k].physics?.dynamic ?? false, k).toBe(false);
    }
    expect((SKYWAYS_DEST_SPECS.hkStickRack.phys as {why: string}).why).toBe('fixture');
    expect((SKYWAYS_DEST_SPECS.hkSticks.phys as {why: string}).why).toBe('host decor');
    expect((SKYWAYS_DEST_SPECS.hkJersey.phys as {why: string}).why).toBe('host decor');
    expect((SKYWAYS_DEST_SPECS.hkRinkBoard.phys as {why: string}).why).toBe('anchored');
  });

  it('back rooms are stocked: shelving / cartons from the station plus openable storage of the store', () => {
    let rooms = 0;
    for (const h of hits) {
      const l = h.layout, {A, back} = split(l, h);
      for (const id of A.stock) {
        if (l.areas[id].type !== 'stock-room') continue;
        rooms++;
        const here = back.filter(p => p.area === id);
        expect(here.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `seed ${h.seed} shelving`).toBe(true);
        expect(here.filter(p => ['cardboardBoxFlaps', 'storageTote', 'staffLockers', 'crate', 'cabinetTall'].includes(p.kind)).length, `seed ${h.seed} openable storage`).toBeGreaterThanOrEqual(1);
      }
    }
    expect(rooms).toBeGreaterThanOrEqual(hits.length);
  });

  it('a store with no back room gets a staff stock corner (shelving + openable storage, the back-of-house loot key)', () => {
    const orig = STORE_HOCKEY.dress;
    let l: StationLayout;
    try {
      (STORE_HOCKEY as {dress: typeof orig}).dress = (layout, rng, an) => orig(layout, rng, {...an, stock: []});
      l = LEVELS.skyways.generate('main', {levelSeed: hits[0].seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    } finally { (STORE_HOCKEY as {dress: typeof orig}).dress = orig; }
    const an = l.skyways!.anchors!.find(a => a.family === 'hockey')!;
    const corner = storeProps(l, an).filter(p => p.purpose === HOCKEY_PURPOSE.back && storeAreas(l, an).floor.includes(p.area));
    expect(corner.some(p => p.kind === 'stockShelf')).toBe(true);
    expect(corner.some(p => p.kind === 'cabinetTall' || p.kind === 'cardboardBoxFlaps')).toBe(true);
  }, 120_000);

  it('the rink palette: its own finish feeds the anchor styles, distinct from the other stores', () => {
    const f = STORE_HOCKEY.finish!;
    expect(ANCHOR_STYLES.hockey).toEqual(anchorStyleOf(f));
    expect(f.wall.kind).toBe('paint');
    expect(f.floor[0]).toBe('vinyl');
    // a dark rubber floor under white boards with a blue dado
    const lum = (c: number) => ((c >> 16) & 255) * 0.2126 + ((c >> 8) & 255) * 0.7152 + (c & 255) * 0.0722;
    expect(lum(f.floor[1]!)).toBeLessThan(70);
    expect(lum(f.wall.paint)).toBeGreaterThan(200);
    for (const fam of SKYWAYS_SHOP_FAMILIES) {
      if (fam === 'hockey') continue;
      const o = ANCHOR_STYLES[fam];
      expect(o.wall.paint === f.wall.paint && o.wall.lower === f.wall.lower && o.floor.kind === f.floor[0], fam).toBe(false);
    }
    expect(SKYWAYS_STORES.hockey).toBe(STORE_HOCKEY);
  });

  it('the drawn kinds: their parts fit their boxes (real sizes), valid materials, every variant drawn; the Mall models exist', () => {
    const mats = new Set<string>([...SHAPE_MAT_KEYS, ...PURPOSE_MAT_KEYS]);
    for (const k of STORE_HOCKEY_KINDS) {
      const spec = STORE_HOCKEY_SPECS[k], def = PROP_DEFS[k];
      expect(spec.parts, k).toBeTruthy();
      expect(spec.model, k).toBeUndefined();
      for (let v = 0; v < 6; v++) {
        const parts = spec.parts!(v);
        expect(parts.length, k).toBeGreaterThan(3);
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const q of parts) {
          expect(mats.has(q.m), `${k} ${q.m}`).toBe(true);
          x0 = Math.min(x0, q.p[0] - q.s[0] / 2); x1 = Math.max(x1, q.p[0] + q.s[0] / 2);
          y0 = Math.min(y0, q.p[1] - q.s[1] / 2); y1 = Math.max(y1, q.p[1] + q.s[1] / 2);
          z0 = Math.min(z0, q.p[2] - q.s[2] / 2); z1 = Math.max(z1, q.p[2] + q.s[2] / 2);
        }
        // grounded at the prop's base (a jersey hangs: its hem 4 cm under its hook frame), inside the declared box
        expect(y0, k).toBeGreaterThanOrEqual(-1e-6);
        expect(y0, k).toBeLessThan(0.05);
        expect(x1 - x0, k).toBeLessThanOrEqual(def.w + 0.01);
        expect(z1 - z0, k).toBeLessThanOrEqual(def.d + 0.01);
        expect(y1, k).toBeLessThanOrEqual(def.h + 0.01);
        expect(y1, k).toBeGreaterThan(def.h * 0.85);
      }
    }
    // real sizes: senior sticks ~1.5 m, dasher boards 1.07-1.1 m under their glass, skates ~0.2 m tall
    expect(PROP_DEFS.hkSticks.h).toBeCloseTo(1.5, 1);
    expect(PROP_DEFS.hkRinkBoard.h).toBeCloseTo(1.88, 2);
    expect(PROP_DEFS.hkSkates.h).toBeLessThan(0.25);
    for (const f of STORE_HOCKEY_MALL_MODELS) expect(fs.existsSync(path.join(__dirname, '../public/assets/models', f)), f).toBe(true);
  });

  it('is deterministic (the same seed dresses the same store)', () => {
    const h = hits[0];
    const a = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const an = a.skyways!.anchors!.find(x => x.family === 'hockey')!;
    const sig = (l: StationLayout, ps: PropPlacement[]) => ps.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? ''].join(',')).join(';');
    expect(sig(a, storeProps(a, an))).toBe(sig(h.layout, storeProps(h.layout, h.anchor)));
  }, 120_000);
});

const r3 = (v: number) => Math.round(v * 1000) / 1000;
