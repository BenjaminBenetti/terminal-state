// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-GARDEN): GLASSHOUSE GARDEN CO. — the garden store at layout version 3
// (gen/skyways/stores/garden.ts + gardenDress.ts + kinds/garden.ts; world/skywaysStoreGarden.ts), over several seeds of both formats
// (double-height glasshouse, hall):
//  - a real garden centre: tiered plant benches with pots, big planters, seed racks, the potting / tool wall (pegboards over potting
//    cabinets, a tool chest), soil pallets, back-wall supply shelving, a cash desk with its openable back counter, hanging-basket rails
//    over the benches in the tall glasshouse (baskets in the rings, the rods up to the ceiling), a stocked potting shed;
//  - openables: every storage-looking kind it places opens (OPENABLE_AUDIT), each back room holds openable storage;
//  - loot: every holder rolls an existing purpose table (area or per-holder purpose), on theme, never ammo, no floor piles;
//  - fit: every standing prop inside the store, no overlaps, the entry reaches the cash desk, the potting benches and every back room;
//  - physics classes; the palette (ANCHOR_STYLES); the two new kinds (audits, measured parts, drawn in Node); determinism.
import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {findStores, storeAreas, storeProps, storePickups, type StoreHit} from './helpers/skywaysStores';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {PROP_DEFS, footprint, type PropKind, type PropPlacement} from '../src/gen/props';
import {Rng} from '../src/core/rng';
import {LEVELS} from '../src/levels/registry';
import {holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {SKYWAYS_DEST_KINDS} from '../src/gen/skyways/destinations/registry';
import {ANCHOR_STYLES, ANCHOR_STYLE_DEFAULTS} from '../src/gen/skyways/destinations/anchorStyles';
import {AnchorKit} from '../src/gen/skyways/destinations/skywaysShopsAKit';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {GARDEN_PURPOSES} from '../src/gen/skyways/stores/garden';
import {GARDEN_HOLDER_PURPOSE, GARDEN_LAST} from '../src/gen/skyways/stores/gardenDress';
import {BASKET_RAIL, BASKET_RAIL_H, BASKET_RAIL_PARTS, GARDEN_RAIL_CLEAR, GARDEN_SCALE, SOIL_PALLET_H, SOIL_PALLET_PARTS, STORE_GARDEN_KINDS, STORE_GARDEN_MALL_MODELS, type GardenPart} from '../src/gen/skyways/stores/kinds/garden';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {basketRailRods} from '../src/world/skywaysStoreGarden';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import type {Area, StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const DH = findStores('garden', {format: 'double-height', count: 4, maxSeed: 40});
const HALL = findStores('garden', {format: 'hall', count: 5, maxSeed: 40});
const ALL: StoreHit[] = [...DH, ...HALL];
const tag = (h: StoreHit) => `seed ${h.seed} (${h.anchor.format})`;
const AUDIT = new Map(OPENABLE_AUDIT.map(a => [a.kind, a]));
const PROFILE = lootProfile('skyways');
const standing = (p: PropPlacement) => !p.mounted && p.host === undefined;
const of = (props: readonly PropPlacement[], ...kinds: PropKind[]) => props.filter(p => kinds.includes(p.kind));
const hostOf = (l: StationLayout, p: PropPlacement) => (p.host !== undefined ? l.props[p.host] : undefined);
/** Storage kinds (things a player reads as openable): every one placed must open. */
const STORAGE: readonly PropKind[] = ['cabinetLow', 'cabinetTall', 'rollingToolChest', 'mallCashwrapCounter', 'shopCooler', 'fridge', 'staffLockers', 'storageTote', 'cardboardBoxFlaps', 'firstAidWallKit', 'crate', 'desk', 'safe', 'filingCabinet'];

describe('Glasshouse Garden Co.: the seeds', () => {
  it('both formats are found (double-height glasshouse and hall)', () => {
    expect(DH.length, 'double-height seeds').toBeGreaterThanOrEqual(2);
    expect(HALL.length, 'hall seeds').toBeGreaterThanOrEqual(2);
    for (const h of ALL) expect(GARDEN_LAST.get(h.layout), tag(h)).toBeTruthy();
  });
});

describe('Glasshouse Garden Co.: a real garden centre', () => {
  it('plants: plant benches with pots on their tops, big planters, small potted plants, flower stands', () => {
    for (const h of ALL) {
      const ps = storeProps(h.layout, h.anchor), t = tag(h);
      const benches = of(ps, 'skyDPlantBench'), area = storeAreas(h.layout, h.anchor).floor.reduce((s, id) => s + h.layout.areas[id].w * h.layout.areas[id].h * CELL * CELL, 0);
      // plant benches in runs (a floor cut up round an inset back room: tiered flower stands as islands instead)
      expect(benches.length + of(ps, 'flowerStand').length, `${t} plant displays (${area} m2)`).toBeGreaterThanOrEqual(area >= 120 ? 3 : 2);
      if (area >= 120) expect(benches.length, `${t} plant benches (${area} m2)`).toBeGreaterThanOrEqual(2);
      const potted = new Set(of(ps, 'skyDGeraniumPot').map(p => hostOf(h.layout, p)).filter(Boolean));
      for (const b of benches) expect(potted.has(b), `${t} pots on every bench`).toBe(true);
      expect(of(ps, 'planterTree', 'skyDPottedPalm').length, `${t} big planters`).toBeGreaterThanOrEqual(area >= 120 ? 2 : 1);
      expect(of(ps, 'flowerStand').length + of(ps, 'pottedPlantSmall').length, `${t} stands / small plants`).toBeGreaterThanOrEqual(2);
    }
  });

  it('seed racks by the entry, the potting / tool wall (pegboards over potting cabinets, pots on their worktops, a tool chest), soil pallets, supply shelving', () => {
    for (const h of ALL) {
      const ps = storeProps(h.layout, h.anchor), t = tag(h), A = storeAreas(h.layout, h.anchor);
      const floor = new Set(A.floor);
      expect(of(ps, 'spinnerRack').length, `${t} seed racks`).toBeGreaterThanOrEqual(1);
      const potting = of(ps, 'cabinetLow').filter(p => floor.has(p.area));
      expect(potting.length, `${t} potting benches`).toBeGreaterThanOrEqual(1);
      const boards = of(ps, 'toolPegboard');
      expect(boards.length, `${t} tool pegboards`).toBeGreaterThanOrEqual(1);
      const g = h.layout.levels[h.anchor.level].grid;
      let over = 0;
      for (const b of boards) {
        expect(b.mounted, t).toBe(true);
        expect(b.y - g.floorOf(g.idx(...g.cellOf(b.x, b.z))), `${t} pegboard height`).toBeGreaterThanOrEqual(1.1);
        // over a potting bench: clear of its worktop and its pots
        const under = potting.find(c => Math.hypot(c.x - b.x, c.z - b.z) < 0.6);
        if (under) { over++; expect(b.y, t).toBeGreaterThan(under.y + PROP_DEFS.cabinetLow.h + PROP_DEFS.skyDGeraniumPot.h - 0.05); }
      }
      expect(over, `${t} a pegboard over a potting bench`).toBeGreaterThanOrEqual(1);
      expect(of(ps, 'skyDGeraniumPot').some(p => hostOf(h.layout, p)?.kind === 'cabinetLow'), `${t} pots on a potting bench`).toBe(true);
      expect(of(ps, 'rollingToolChest').length, `${t} tool chest`).toBeGreaterThanOrEqual(1);
      expect(of(ps, 'storeGardenSoilPallet').length, `${t} soil pallets`).toBeGreaterThanOrEqual(1);
      expect(of(ps, 'stockShelf', 'outdoorsPlankShelving').filter(p => floor.has(p.area)).length, `${t} supply shelving`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the cash desk: counters facing the shop with the till, the Mall back counter (drawers + cupboard) behind them, a drinks cooler', () => {
    for (const h of ALL) {
      const ps = storeProps(h.layout, h.anchor), t = tag(h), res = GARDEN_LAST.get(h.layout)!;
      expect(res.cash, `${t} cash desk`).toBeTruthy();
      const till = h.layout.props[res.cash!.till], back = h.layout.props[res.cash!.back];
      expect(of(ps, 'cashRegister').some(r => hostOf(h.layout, r) === till), `${t} register on the till`).toBe(true);
      expect(back.kind).toBe('mallCashwrapCounter');
      expect(back.rot, `${t} both face the shop`).toBeCloseTo(till.rot, 5);
      // the staff aisle between them >= 1 m
      const gap = Math.abs(Math.sin(till.rot)) > 0.5 ? Math.abs(till.x - back.x) - till.hx - back.hx : Math.abs(till.z - back.z) - till.hz - back.hz;
      expect(gap, `${t} staff aisle`).toBeGreaterThanOrEqual(0.95);
      expect(of(ps, 'shopCooler').length, `${t} drinks cooler`).toBeGreaterThanOrEqual(1);
    }
  });

  it('the hanging-basket zone: rails over the benches in the double-height glasshouse (baskets in the rings, >= 2.4 m clear, rods up to the ceiling); one or two in a hall', () => {
    for (const h of ALL) {
      const ps = storeProps(h.layout, h.anchor), t = tag(h), L = h.layout;
      const rails = of(ps, 'storeGardenBasketRail');
      if (h.anchor.format === 'double-height') expect(rails.length, `${t} rails`).toBeGreaterThanOrEqual(2);
      else expect(rails.length, `${t} rails`).toBeLessThanOrEqual(2);
      const g = L.levels[h.anchor.level].grid;
      for (const r of rails) {
        expect(r.mounted, t).toBe(true);
        const f = g.floorOf(g.idx(...g.cellOf(r.x, r.z)));
        expect(r.y - f, `${t} basket bottoms clear`).toBeGreaterThanOrEqual(GARDEN_RAIL_CLEAR - 1e-6);
        const baskets = of(ps, 'skyDGeraniumPot').filter(p => hostOf(L, p) === r);
        expect(baskets.length, `${t} baskets on a rail`).toBeGreaterThanOrEqual(2);
        for (const b of baskets) {
          expect(b.y, t).toBeCloseTo(r.y, 3);
          const lx = (b.x - r.x) * Math.cos(r.rot) - (b.z - r.z) * Math.sin(r.rot);
          expect(BASKET_RAIL.slots.some(s => Math.abs(s - lx) < 1e-3), `${t} basket on a hook slot`).toBe(true);
        }
        const rods = basketRailRods(r, L);
        expect(rods.length, `${t} two rods`).toBe(2);
        for (const rod of rods) expect(rod.y + rod.len, `${t} rod reaches the ceiling`).toBeCloseTo(g.ceilAt(rod.x, rod.z), 3);
        // over a bench run, nothing standing reaches into it
        for (const p of ps) if (standing(p) && Math.abs(p.x - r.x) < p.hx + r.hx && Math.abs(p.z - r.z) < p.hz + r.hz) expect(p.y + p.h, `${t} ${p.kind} under a rail`).toBeLessThan(r.y);
      }
      if (h.anchor.format === 'double-height') expect(rails.some(r => of(ps, 'skyDPlantBench').some(b => Math.hypot(b.x - r.x, b.z - r.z) < 0.6)), `${t} a rail over a bench`).toBe(true);
    }
  });

  it('the back rooms: the potting shed keeps its shelving and gains a tool locker / chest, a staff fridge, a first-aid kit and lidded storage', () => {
    for (const h of ALL) {
      const t = tag(h), L = h.layout;
      expect(h.anchor.stock.length, `${t} back rooms`).toBeGreaterThanOrEqual(1);
      for (const id of h.anchor.stock) {
        const a = L.areas[id], ps = (L.props as PropPlacement[]).filter(p => p.area === id);
        const open = ps.filter(p => STORAGE.includes(p.kind) && ['openable', 'existing'].includes(AUDIT.get(p.kind)?.cls ?? ''));
        expect(open.length, `${t} ${a.type}: openable storage`).toBeGreaterThanOrEqual(2);
        expect(ps.some(p => p.kind === 'firstAidWallKit' && p.purpose === GARDEN_HOLDER_PURPOSE.firstAid), `${t} ${a.type}: first-aid kit`).toBe(true);
        if (a.type === 'stock-room') {
          expect(ps.some(p => ['stockShelf', 'shelf'].includes(p.kind)), `${t} shed shelving`).toBe(true);
          expect(ps.some(p => ['cabinetTall', 'staffLockers', 'rollingToolChest'].includes(p.kind)), `${t} shed tool locker`).toBe(true);
        }
      }
    }
  });
});

describe('Glasshouse Garden Co.: openables, loot, physics', () => {
  it('every storage-looking kind placed opens (OPENABLE_AUDIT openable / existing); the soil pallet is the one honest exception', () => {
    for (const h of ALL) {
      const t = tag(h);
      let n = 0;
      for (const p of storeProps(h.layout, h.anchor)) {
        const a = AUDIT.get(p.kind);
        expect(a, `${t} ${p.kind} classified`).toBeTruthy();
        if (STORAGE.includes(p.kind)) { expect(['openable', 'existing'], `${t} ${p.kind}`).toContain(a!.cls); n++; }
        if (a!.cls === 'exception') expect(['storeGardenSoilPallet', 'cashRegister', 'cartonStack', 'keyCabinet', 'microwaveOven', 'waterCooler'], `${t} ${p.kind} exception`).toContain(p.kind);
      }
      expect(n, `${t} openable storage pieces`).toBeGreaterThanOrEqual(8);
    }
  });

  it('loot: the areas take the garden purposes; every holder rolls an existing purpose table on theme (never ammo); no floor piles', () => {
    expect(SKYWAYS_STORES.garden.purposes).toEqual(GARDEN_PURPOSES);
    for (const h of ALL) {
      const t = tag(h), L = h.layout, A = storeAreas(L, h.anchor);
      for (const id of A.floor) expect(L.areas[id].purpose, t).toBe('mall-hardware');
      for (const id of A.stock) expect(L.areas[id].purpose, t).toBe(L.areas[id].type === 'stock-room' ? 'mall-hardware-back' : 'mall-management');
      for (const p of storeProps(L, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        const key = p.purpose ?? L.areas[p.area].purpose!, tab = holderTable(p.kind as HolderKind, key, PROFILE), ids = tab.rows.map(r => r[0]);
        expect(tab.source, `${t} ${p.kind} (${key})`).not.toBe('legacy');
        expect(ids.length, `${t} ${p.kind} (${key}) rows`).toBeGreaterThan(0);
        expect(ids.some(i => i.startsWith('ammo')), `${t} ${p.kind} (${key}) no ammo: ${ids}`).toBe(false);
        if (p.kind === 'fridge' || p.kind === 'shopCooler') expect(ids.every(i => ['water', 'cola', 'juice', 'beans', 'noodles', 'chocolate', 'chips'].includes(i)), `${t} ${p.kind}: ${ids}`).toBe(true);
        if (p.kind === 'firstAidWallKit') expect(ids, `${t} first aid`).toContain('bandage');
        if (p.kind === 'outdoorsPlankShelving') { expect(key, t).toBe(GARDEN_HOLDER_PURPOSE.plankShelving); expect(ids, t).toContain('flare'); }
        if (['cabinetLow', 'rollingToolChest', 'stockShelf'].includes(p.kind) && A.floor.includes(p.area)) expect(ids.includes('battery') || ids.includes('flare'), `${t} ${p.kind} garden supplies: ${ids}`).toBe(true);
      }
      // no loose floor piles in the store's areas
      expect(storePickups(L, h.anchor).filter(q => Math.abs(q.y - (L.areas[q.area].floorY ?? 0)) < 0.05), t).toEqual([]);
    }
  });

  it('physics classes: the loose plants / barrow / seed racks / baskets move, the fixtures and holders stay, the new kinds static with their reasons', () => {
    for (const k of ['skyDGeraniumPot', 'skyDPottedPalm', 'pottedPlantSmall', 'skyDWheelbarrow', 'spinnerRack', 'stepLadder', 'basketStack'] as const) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('dynamic');
    for (const k of ['skyDPlantBench', 'planterTree', 'flowerStand', 'cabinetLow', 'rollingToolChest', 'mallCashwrapCounter', 'shopCounter', 'toolPegboard', 'storeGardenSoilPallet', 'storeGardenBasketRail'] as const) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('static');
    expect(PROP_PHYSICS_AUDIT.storeGardenSoilPallet.why).toBe('too heavy');
    expect(PROP_PHYSICS_AUDIT.storeGardenBasketRail.why).toBe('mounted');
    // loose decor only rests on static hosts (a pot never floats off a moved host)
    for (const h of ALL) for (const p of storeProps(h.layout, h.anchor)) {
      const host = hostOf(h.layout, p);
      if (host) expect(PROP_PHYSICS_AUDIT[host.kind].cls, `${tag(h)} ${p.kind} on ${host.kind}`).toBe('static');
    }
  });
});

describe('Glasshouse Garden Co.: fit and routes', () => {
  it('every standing prop inside the store\'s areas, no two standing boxes overlapping', () => {
    for (const h of ALL) {
      const t = tag(h), L = h.layout, A = storeAreas(L, h.anchor), g = L.levels[h.anchor.level].grid;
      const mine = new Set(GARDEN_LAST.get(L)!.props.map(i => L.props[i]));
      const ps = storeProps(L, h.anchor).filter(p => standing(p) && p.kind !== 'shopGlazing' && mine.has(p));
      for (const p of ps) {
        for (let cy = Math.floor((p.z - p.hz + 0.04) / CELL); cy <= Math.floor((p.z + p.hz - 0.04) / CELL); cy++) for (let cx = Math.floor((p.x - p.hx + 0.04) / CELL); cx <= Math.floor((p.x + p.hx - 0.04) / CELL); cx++) {
          const i = g.idx(cx, cy);
          expect(g.cells[i] === FLOOR && A.all.has(g.area[i]), `${t} ${p.kind} at ${p.x},${p.z} inside`).toBe(true);
        }
      }
      const all = storeProps(L, h.anchor).filter(p => standing(p) && p.kind !== 'shopGlazing');
      for (const p of ps) for (const q of all) {
        if (p === q) continue;
        const ox = Math.min(p.x + p.hx, q.x + q.hx) - Math.max(p.x - p.hx, q.x - q.hx), oz = Math.min(p.z + p.hz, q.z + q.hz) - Math.max(p.z - p.hz, q.z - q.hz);
        expect(ox > 0.01 && oz > 0.01, `${t} ${p.kind} overlaps ${q.kind}`).toBe(false);
      }
    }
  });

  it('routes: from the entry the walkable floor reaches the till\'s customer side, every potting bench and every back room (and each back room\'s storage)', () => {
    for (const h of ALL) {
      const t = tag(h), L = h.layout, A = storeAreas(L, h.anchor), g = L.levels[h.anchor.level].grid;
      const kit = new AnchorKit(L, new Rng(1), h.anchor), [ex, ez] = kit.inside(1.25);
      const seen = new Uint8Array(g.w * g.h), st: number[] = [];
      const [sx, sy] = g.cellOf(ex, ez);
      // (the entry cell may sit in the storefront strip: start from the nearest walkable store cell)
      let start = -1;
      for (let r = 0; r <= 4 && start < 0; r++) for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) if (g.walkable(sx + dx, sy + dy) && A.all.has(g.area[g.idx(sx + dx, sy + dy)])) { start = g.idx(sx + dx, sy + dy); break; }
      expect(start, t).toBeGreaterThanOrEqual(0);
      seen[start] = 1; st.push(start);
      while (st.length) { const c = st.pop()!; for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && g.cells[n] === FLOOR && !g.blocked[n] && A.all.has(g.area[n])) { seen[n] = 1; st.push(n); } }
      const reach = (x: number, z: number, r = 1) => { const [cx, cy] = g.cellOf(x, z); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (seen[g.idx(cx + dx, cy + dy)]) return true; return false; };
      const front = (p: PropPlacement, d: number): [number, number] => [p.x + Math.round(Math.sin(p.rot)) * (PROP_DEFS[p.kind].d / 2 + d), p.z + Math.round(Math.cos(p.rot)) * (PROP_DEFS[p.kind].d / 2 + d)];
      const res = GARDEN_LAST.get(L)!;
      expect(reach(...front(L.props[res.cash!.till], 0.5)), `${t} the till's customer side`).toBe(true);
      for (const c of of(storeProps(L, h.anchor), 'cabinetLow', 'rollingToolChest', 'shopCooler', 'fridge', 'cabinetTall', 'staffLockers')) expect(reach(...front(c, 0.4)), `${t} ${c.kind} front`).toBe(true);
      for (const id of A.stock) {
        const d = L.doors.find(q => (q.a === id || q.b === id) && !q.shopfront)!;
        expect(d, `${t} back room door`).toBeTruthy();
        let ok = false;
        for (let y = d.y - 1; y <= d.y + d.h && !ok; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (seen[g.idx(x, y)]) { ok = true; break; }
        expect(ok, `${t} back room ${id} reached`).toBe(true);
      }
    }
  });

  it('deterministic: the same seed dresses the same garden', () => {
    const h = DH[0];
    const fp = (l: StationLayout, an: StoreHit['anchor']) => JSON.stringify(storeProps(l, an).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? '', p.host ?? -1]));
    const l2 = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const an2 = l2.skyways!.anchors!.find(a => a.family === 'garden')!;
    expect(fp(l2, an2)).toBe(fp(h.layout, h.anchor));
  }, 120_000);
});

describe('Glasshouse Garden Co.: palette, kinds, drawing', () => {
  it('the palette: brick-red tile walls to the ceiling, terracotta pavers, a timber-toned raw ceiling (its own, not the lead default)', () => {
    const s = ANCHOR_STYLES.garden;
    expect(s.wall.kind).toBe('tile');
    expect(s.wall.lowerTop).toBeGreaterThanOrEqual(3.5);
    expect(s.floor.kind).toBe('tile');
    expect(s.ceiling.kind).toBe('raw');
    expect(s).not.toEqual(ANCHOR_STYLE_DEFAULTS.garden);
    // warm hues: the brick and the pavers red-dominant
    for (const c of [s.wall.lower, s.floor.tint!]) expect((c >> 16) & 255, c.toString(16)).toBeGreaterThan(c & 255);
  });

  it('the new kinds: registered, classified in both audits with honest reasons, their parts measured to their boxes, scale recorded', () => {
    const bounds = (parts: readonly GardenPart[]) => {
      const b = new THREE.Box3();
      for (const p of parts) { const g = new THREE.BoxGeometry(...p.s); if (p.rx) g.rotateX(p.rx); g.translate(...p.p); g.computeBoundingBox(); b.union(g.boundingBox!); }
      return b;
    };
    for (const k of STORE_GARDEN_KINDS) {
      expect(SKYWAYS_DEST_KINDS, k).toContain(k);
      expect(AUDIT.get(k)?.how.length, k).toBeGreaterThan(20);
      expect(PROP_PHYSICS_AUDIT[k]?.how.length, k).toBeGreaterThan(20);
      expect(GARDEN_SCALE[k].length, k).toBeGreaterThan(20);
    }
    expect(AUDIT.get('storeGardenSoilPallet')!.cls).toBe('exception');
    expect(AUDIT.get('storeGardenBasketRail')!.cls).toBe('none');
    const sp = bounds(SOIL_PALLET_PARTS), d = PROP_DEFS.storeGardenSoilPallet;
    expect(sp.min.y).toBeCloseTo(0, 3);
    expect(sp.max.y).toBeCloseTo(SOIL_PALLET_H, 2);
    expect(sp.max.x - sp.min.x).toBeLessThanOrEqual(d.w + 0.06);
    expect(sp.max.z - sp.min.z).toBeLessThanOrEqual(d.d + 0.06);
    const rp = bounds(BASKET_RAIL_PARTS), r = PROP_DEFS.storeGardenBasketRail;
    expect(rp.max.y).toBeCloseTo(BASKET_RAIL_H, 2);
    expect(rp.max.x - rp.min.x).toBeLessThanOrEqual(r.w + 0.07);
    expect(rp.max.z - rp.min.z).toBeLessThanOrEqual(r.d + 0.01);
    // the rings hold a geranium pot (its footprint inside the ring)
    expect(BASKET_RAIL.ring.w).toBeGreaterThan(PROP_DEFS.skyDGeraniumPot.w);
    expect(BASKET_RAIL.ring.d).toBeGreaterThan(PROP_DEFS.skyDGeraniumPot.d);
    // the Mall models it loads exist
    for (const f of STORE_GARDEN_MALL_MODELS) expect(fs.existsSync(fileURLToPath(new URL(`../public/assets/models/${f}`, import.meta.url))), f).toBe(true);
  });

  it('drawn in Node: prop-<kind>-<material> instances per storey, the bags tinted per variant, the rail rods up to the ceiling', () => {
    const W = 40, H = 30, CEIL = 7.5, g = new Grid(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); g.cells[i] = x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? SOLID : FLOOR; g.area[i] = 0; g.ceil[i] = CEIL; g.floor[i] = 0; }
    const place = (kind: PropKind, x: number, z: number, o: Partial<PropPlacement> = {}): PropPlacement => { const {hx, hz} = footprint(kind, 0); return {kind, x, z, y: 0, rot: 0, area: 0, hx, hz, h: PROP_DEFS[kind].h, blocksSight: false, variant: 0, ...o}; };
    const props = [place('storeGardenSoilPallet', 4, 4), place('storeGardenSoilPallet', 7, 4, {variant: 1}), place('storeGardenBasketRail', 10, 8, {y: 3, mounted: true})];
    const layout = {seed: 1, name: 'garden', props, grid: g, areas: [{id: 0, x: 1, y: 1, w: W - 2, h: H - 2, kind: 'room', type: 'shop', label: 'Garden', ceil: CEIL, parent: -1, depth: 0, publicSpace: true, lighting: 'lit'} as unknown as Area],
      doors: [], playerSpawn: {x: 2, z: 2, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [], trench: {floorY: -1.15}, trenches: [],
      attempt: 0, towards: ['A', 'B'], platform: 0, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, rails: [], levelLinks: []} as unknown as StationLayout;
    const w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {});
    const ims: THREE.InstancedMesh[] = [];
    w.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh && o.name.startsWith('prop-storeGarden')) ims.push(o as THREE.InstancedMesh); });
    const names = ims.map(m => m.name).sort();
    expect(names).toEqual(expect.arrayContaining(['prop-storeGardenSoilPallet-wood', 'prop-storeGardenSoilPallet-accent', 'prop-storeGardenSoilPallet-counter', 'prop-storeGardenBasketRail-steelBright', 'prop-storeGardenBasketRail-steelDark', 'prop-storeGardenBasketRail-rod']));
    const bags = ims.find(m => m.name === 'prop-storeGardenSoilPallet-accent')!;
    expect(bags.count).toBe(2);
    expect(bags.instanceColor).toBeTruthy();
    const c0 = new THREE.Color(), c1 = new THREE.Color();
    bags.getColorAt(0, c0); bags.getColorAt(1, c1);
    expect(c0.equals(c1)).toBe(false);
    const rods = ims.find(m => m.name === 'prop-storeGardenBasketRail-rod')!;
    expect(rods.count).toBe(2);
    const m = new THREE.Matrix4();
    for (let i = 0; i < rods.count; i++) {
      rods.getMatrixAt(i, m);
      const b = new THREE.Box3().setFromBufferAttribute(rods.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(m);
      expect(b.max.y).toBeCloseTo(CEIL, 3);
      expect(b.min.y).toBeCloseTo(3 + BASKET_RAIL_H, 3);
    }
    for (const im of ims) expect(im.userData.level, im.name).toBe(0);
  });
});
