// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-OUTFITTER): COULEE & CANOE OUTFITTERS, the Skyways outfitter at layout
// version 3 (gen/skyways/stores/outfitter.ts + outfitterDress.ts), over several seeds and both formats (double-height / hall):
//  - THE REAL BACKPACK (user: "camping store fake backpack unacceptable"): one genuine `backpack` gear find per store on the pack wall
//    (no decoration-only pack anywhere), standing on a static support; the gear system turns it into a grounded bag (found:<layout
//    pickup index>) that opens, stores and is worn like any backpack, keeps its uid across teardown / build / save-load, and never
//    respawns once taken;
//  - storage opens (OPENABLE_AUDIT), holder loot is on theme (the store's purposes / per-holder overrides), fit (in the store's areas, no
//    overlaps, reachable from the entry: the till, the pack wall, the back-room doors, every holder's front), physics classes, the hung
//    canoe(s), stocked back rooms, the finish (anchor style) and determinism.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {findStore, findStores, storeAreas, storePickups, storeProps, type StoreHit} from './helpers/skywaysStores';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {CELL} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {BACKPACK_SLOTS, gearSpec, isAirtank, isBagItem} from '../src/items/gear';
import {installGear} from '../src/gear/system';
import {MemoryBagStore} from '../src/gear/bagStore';
import {Inventory} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import {PickupManager} from '../src/world/pickups';
import {BASE_MODIFIERS} from '../src/player/modifiers';
import {bagTarget} from '../src/world/groundBag';
import {MALL_SURFACES} from '../src/gen/mall/kinds';
import {MALL_ASSETS} from '../src/assets/mallAssets';
import {ANCHOR_STYLES, anchorStyleOf} from '../src/gen/skyways/destinations/anchorStyles';
import {STORE_OUTFITTER} from '../src/gen/skyways/stores/outfitter';
import {STORE_OUTFITTER_KINDS, STORE_OUTFITTER_MALL_MODELS} from '../src/gen/skyways/stores/kinds/outfitter';
import {OUTFITTER_FIRST_AID_PURPOSE, OUTFITTER_OFFICE_LABEL, OUTFITTER_PACK_ITEM, outfitterDressOf, type OutfitterResult} from '../src/gen/skyways/stores/outfitterDress';
import type {Game} from '../src/game';

const SKY = lootProfile('skyways');
const LIDDED: ReadonlySet<string> = new Set(['cardboardBoxFlaps', 'storageTote', 'crate']);
let hits: StoreHit[] = [];
const resOf = (h: StoreHit): OutfitterResult => outfitterDressOf(h.layout).find(r => r.anchor === h.anchor.id)!;
/** The props this dresser placed for the store (sales floor + back rooms). */
const mine = (h: StoreHit): PropPlacement[] => resOf(h).props.map(i => h.layout.props[i]);

beforeAll(() => {
  hits = findStores('outfitter', {count: 6, maxSeed: 40});
}, 600_000);

describe('Skyways outfitter (layout v3): the store', () => {
  it('both formats are covered; every store is dressed by the outfitter dresser with its purposes', () => {
    expect(hits.length).toBe(6);
    expect(new Set(hits.map(h => h.anchor.format))).toEqual(new Set(['double-height', 'hall']));
    for (const h of hits) {
      const r = resOf(h), A = storeAreas(h.layout, h.anchor);
      expect(r, `seed ${h.seed}`).toBeTruthy();
      expect(r.props.length).toBeGreaterThan(60);
      for (const id of A.floor) expect(h.layout.areas[id].purpose).toBe('mall-outdoors');
      for (const id of A.stock) expect(h.layout.areas[id].purpose).toBe('mall-outdoors-back');
      for (const id of A.stock) if (h.layout.areas[id].type === 'agent-office') expect(h.layout.areas[id].label).toBe(OUTFITTER_OFFICE_LABEL);
      // the store's set pieces: the cash desk (back counter + till), the campsite, the pack wall, the boot wall, outerwear, food, kitchen
      const kinds = new Set(storeProps(h.layout, h.anchor).map(p => p.kind));
      for (const k of ['shopCounter', 'cashRegister', 'skyDTent', 'skyDCampChair', 'skyDCanoe', 'outdoorsPlankShelving', 'shoeWallDisplay', 'clothingWallUnit',
        'garmentHangingGroup', 'stockShelf', 'shopCooler', 'campStove', 'skyDPoster'] as PropKind[]) expect(kinds.has(k), `seed ${h.seed}: ${k}`).toBe(true);
      expect(kinds.has('skyDLantern') || kinds.has('campLantern'), `seed ${h.seed}: lanterns`).toBe(true);
      expect(r.desk.counters.length).toBeGreaterThanOrEqual(1);
      expect(r.desk.register).not.toBeNull();
      expect(r.desk.back).not.toBeNull();
    }
  });

  it('no store kind of its own; every Mall model it uses is a delivered file and listed in STORE_OUTFITTER_MALL_MODELS', () => {
    expect(STORE_OUTFITTER_KINDS).toEqual([]);
    const files = new Set(Object.values(MALL_ASSETS).map(a => a.url?.replace(/^.*\//, '')).filter(Boolean));
    for (const f of STORE_OUTFITTER_MALL_MODELS) expect(files.has(f), f).toBe(true);
    const byKind: Record<string, string> = {mallCashwrapCounter: 'mall-mall-cashwrap-counter.glb', retailGondola: 'mall-retail-gondola.glb', garmentRailRound: 'mall-garment-rail-round.glb',
      garmentHangingGroup: 'mall-garment-hanging-group.glb', clothingWallUnit: 'mall-clothing-wall-unit.glb', outdoorsPlankShelving: 'mall-outdoors-plank-shelving.glb',
      storageTote: 'mall-storage-tote.glb', shoeWallDisplay: 'mall-shoe-wall-display.glb', ottoman: 'mall-try-on-ottoman.glb', tentDisplay: 'mall-camping-tent-display.glb',
      cardboardBoxFlaps: 'mall-cardboard-box-flaps.glb'};
    for (const h of hits) for (const p of mine(h)) if (byKind[p.kind]) expect(STORE_OUTFITTER_MALL_MODELS, p.kind).toContain(byKind[p.kind]);
  });
});

describe('Skyways outfitter: THE REAL BACKPACK (no fake display packs)', () => {
  it('one genuine `backpack` gear find per store, on the pack wall\'s top plank (a static support), never a lookalike prop', () => {
    expect(OUTFITTER_PACK_ITEM).toBe('backpack');
    const spec = gearSpec(OUTFITTER_PACK_ITEM)!;
    expect(spec.slot).toBe('backpack');
    expect(spec.bagSlots).toBe(BACKPACK_SLOTS);
    expect(isBagItem(OUTFITTER_PACK_ITEM)).toBe(true);
    expect(isAirtank(OUTFITTER_PACK_ITEM)).toBe(false); // (not the airtank: it has no storage)
    for (const h of hits) {
      const r = resOf(h), L = h.layout;
      // no decoration-only lookalike pack anywhere in the store
      expect(storeProps(L, h.anchor).filter(p => p.kind === 'skyDBackpack'), `seed ${h.seed}`).toEqual([]);
      // exactly one backpack find in the store, exactly the dresser's record; no airtank / other bag
      const packs = storePickups(L, h.anchor).filter(p => isBagItem(p.itemId) || isAirtank(p.itemId));
      expect(packs, `seed ${h.seed}`).toHaveLength(1);
      expect(r.backpack).not.toBeNull();
      const pk = L.pickups[r.backpack!.pickup];
      expect(packs[0]).toBe(pk);
      expect(pk.itemId).toBe('backpack');
      expect(pk.count).toBe(1);
      // on its display: the pack wall's plank shelving, the top plank (1.14 m), inside the host's footprint, the plank span cut from its loot
      const host = L.props[r.backpack!.host];
      expect(r.backpack!.display).toBe('pack wall');
      expect(host.kind).toBe('outdoorsPlankShelving');
      const top = MALL_SURFACES.outdoorsPlankShelving[2];
      expect(r.backpack!.top).toBe(top.y);
      expect(pk.y).toBeCloseTo(host.y + top.y, 3);
      expect(Math.abs(pk.x - host.x)).toBeLessThan(host.hx);
      expect(Math.abs(pk.z - host.z)).toBeLessThan(host.hz);
      expect(host.cut?.some(c => c.y === top.y)).toBe(true);
      expect(PROP_PHYSICS_AUDIT[host.kind].cls).toBe('static'); // the support never moves: the bag never floats
      expect(pk.level ?? 0).toBe(host.level ?? 0);
      expect(storeAreas(L, h.anchor).floor).toContain(pk.area);
      // not a floor pile: well above the floor
      expect(pk.y - (L.areas[pk.area].floorY ?? 0)).toBeGreaterThan(1);
      // facing the aisle (the host's front)
      expect(Math.abs(Math.sin(((pk.yaw ?? 0) - host.rot) / 2))).toBeLessThan(1e-3);
    }
  });

  it('the gear system takes it as a real bag: open, store, wear; stable id + uid through teardown / build / save-load; never respawns', () => {
    const h = hits[0];
    const r = resOf(h), idx = r.backpack!.pickup, pk = h.layout.pickups[idx];
    const store = new MemoryBagStore();
    const s = shell(h.layout, store);
    build(s);
    // generated backpack finds lie as bags: this one is `found:<its layout pickup index>`, an EMPTY 12-slot backpack, at its display pose
    expect(s.g.pickups.list.filter(p => p.stack.itemId === 'backpack')).toHaveLength(0);
    expect(s.sys.bags).toHaveLength(1);
    const bag = s.sys.bags[0];
    expect(bag.id).toBe(`found:${idx}`);
    expect(bag.stack.itemId).toBe('backpack');
    expect(bag.stack.bag).toHaveLength(BACKPACK_SLOTS);
    expect(bag.stack.bag!.every(x => x === null)).toBe(true);
    expect([bag.pose.x, bag.pose.y, bag.pose.z]).toEqual([pk.x, pk.y, pk.z]);
    const uid = bag.stack.uid;
    // targetable from the aisle in front of the pack wall (eye height, within reach, in sight)
    const host = h.layout.props[r.backpack!.host];
    const floor = host.y, fx = Math.sin(host.rot), fz = Math.cos(host.rot);
    const off = PROP_DEFS[host.kind].d / 2 + 0.85;
    const eye = new THREE.Vector3(host.x + fx * off, floor + 1.6, host.z + fz * off);
    const dir = bag.centre.clone().sub(eye).normalize();
    expect(bagTarget(s.sys.bags, eye, dir, s.levels)).toBe(bag);
    // leave and come back without taking it: the very same bag (id + uid), one only
    teardown(s);
    build(s);
    expect(s.sys.bags.map(b => [b.id, b.stack.uid])).toEqual([[`found:${idx}`, uid]]);
    // a saved run restored into a fresh game: the same bag again
    const saved = store.toJSON(), store2 = new MemoryBagStore();
    store2.loadJSON(saved);
    const s2 = shell(h.layout, store2);
    build(s2);
    expect(s2.sys.bags.map(b => [b.id, b.stack.uid])).toEqual([[`found:${idx}`, uid]]);
    // storage works: open it and put pockets stock in; wear it (the same stack, contents kept)
    const b2 = s2.sys.bags[0];
    s2.g.player.x = b2.pose.x + fx * 0.9; s2.g.player.z = b2.pose.z + fz * 0.9; s2.g.player.y = floor;
    s2.g.inv.add(s2.g.inv.makeStack('bandage', 3));
    expect(s2.sys.open(b2)).toBe(true);
    const ref = s2.g.inv.find(s2.g.inv.allStacks().find(x => x.itemId === 'bandage')!.uid)!;
    expect(s2.sys.bagView.quick(ref)).toBe(3);
    expect(b2.stack.bag!.filter(Boolean).map(x => x!.itemId)).toEqual(['bandage']);
    expect(s2.sys.wear()).toBe(true);
    const worn = s2.g.inv.worn('backpack')!;
    expect(worn.uid).toBe(uid);
    expect(worn.bag!.filter(Boolean).map(x => [x!.itemId, x!.count])).toEqual([['bandage', 3]]);
    expect(s2.sys.bags).toHaveLength(0);
    // taken: leave and come back — the display stays empty (no respawn, no second bag), even though the layout still lists the find
    teardown(s2);
    build(s2);
    expect(s2.sys.bags).toHaveLength(0);
    expect(s2.g.pickups.list.filter(p => isBagItem(p.stack.itemId))).toHaveLength(0);
    expect(s2.g.inv.allStacks(true).filter(x => x.itemId === 'backpack')).toHaveLength(1);
  });

  it('is seeded with the layout: a fresh generation of the same seed puts the same find at the same layout index (the stable bag id)', () => {
    const h = hits[1];
    const fresh = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const a = resOf(h).backpack!, b = outfitterDressOf(fresh).find(r => r.anchor === h.anchor.id)!.backpack!;
    expect(b.pickup).toBe(a.pickup);
    expect(fresh.pickups[b.pickup]).toEqual(h.layout.pickups[a.pickup]);
    // and the whole store is deterministic
    const key = (l: StationLayout) => JSON.stringify(storeProps(l, h.anchor).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? '']));
    expect(key(fresh)).toBe(key(h.layout));
  }, 120_000);
});

describe('Skyways outfitter: affordances', () => {
  it('storage opens: every storage-role kind it places is openable (no sealed fake cabinets); the cash desk\'s back counter opens', () => {
    const audit = new Map(OPENABLE_AUDIT.map(a => [a.kind, a]));
    for (const h of hits) {
      const kinds = new Set(mine(h).map(p => p.kind));
      for (const k of kinds) {
        const a = audit.get(k);
        expect(a, `${k}: classified`).toBeTruthy();
        if (a!.role === 'storage') expect(['openable', 'existing'], `${k}: ${a!.cls}`).toContain(a!.cls);
      }
      const r = resOf(h), back = h.layout.props[r.desk.back!];
      expect(['openable', 'existing']).toContain(audit.get(back.kind)!.cls);
      // openable storage per store (the back counter, coolers, cabinets, lockers, cartons, the first-aid kit)
      const open = mine(h).filter(p => ['openable', 'existing'].includes(audit.get(p.kind)?.cls ?? ''));
      expect(open.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('holder loot is on theme (outfitter stock / back-of-house / dressings / drinks); no fuel ids; the first-aid kit rolls dressings', () => {
    const OUTDOOR = new Set(['flare', 'battery', 'water', 'beans', 'noodles', 'bandage', 'medkit', 'cola', 'juice', 'chocolate', 'chips']);
    for (const h of hits) {
      for (const p of storeProps(h.layout, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        const purpose = p.purpose ?? h.layout.areas[p.area].purpose!;
        const t = holderTable(p.kind as never, purpose, SKY);
        for (const [id] of t.rows) {
          expect(id, `${p.kind}: no fuel in the store's tables (fuel is the level's own finite plan)`).not.toMatch(/fuel/);
          // (staff lockers keep their own personal table: its sidearm-ammo rows are the existing deliberate locker rule)
          if (p.kind === 'staffLockers' && id.startsWith('ammo_')) continue;
          expect(OUTDOOR.has(id), `seed ${h.seed} ${p.kind} (${purpose}): ${id}`).toBe(true);
        }
        if (p.kind === 'firstAidWallKit') {
          expect(p.purpose).toBe(OUTFITTER_FIRST_AID_PURPOSE);
          expect(t.rows.map(([id]) => id).sort()).toEqual(['bandage', 'medkit', 'water']);
        }
        if (p.kind === 'shopCooler') expect(t.rows.map(([id]) => id).sort()).toEqual(['cola', 'juice', 'water']);
      }
      // the sales floor's display stock: the outdoor outfitter rows
      const shelf = holderTable('outdoorsPlankShelving' as never, 'mall-outdoors', SKY).rows.map(([id]) => id);
      for (const id of ['flare', 'battery', 'water']) expect(shelf).toContain(id);
      expect(resOf(h).desk.firstAid, `seed ${h.seed}: first-aid kit`).not.toBeNull();
      // no loose floor piles in the store (the backpack stands on its shelf)
      const flagged = storeAreas(h.layout, h.anchor).all;
      expect(h.layout.pickups.filter(p => flagged.has(p.area) && Math.abs(p.y - (h.layout.areas[p.area].floorY ?? 0)) < 0.05)).toEqual([]);
    }
  });

  it('physics classes: loose things move (chairs, lanterns, stoves, rails, the ottoman, cartons), fixtures and holders stay put', () => {
    const dyn: PropKind[] = ['skyDCampChair', 'skyDLantern', 'campStove', 'campLantern', 'garmentRail', 'garmentRailRound', 'ottoman', 'bicycle', 'cardboardBoxFlaps', 'storageTote'];
    const stat: PropKind[] = ['skyDTent', 'skyDCanoe', 'tentDisplay', 'outdoorsPlankShelving', 'shoeWallDisplay', 'clothingWallUnit', 'retailGondola', 'shopCounter', 'mallCashwrapCounter',
      'stockShelf', 'shopCooler', 'staffLockers', 'skyDBookTable'];
    for (const k of dyn) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('dynamic');
    for (const k of stat) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
    for (const h of hits) for (const p of mine(h)) {
      expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind}: classified`).toBeTruthy();
      // decor standing on a host: a host that never moves (static), or a rail it rides (a mall rider)
      if (p.host !== undefined) {
        const host = h.layout.props[p.host];
        if (p.kind === 'garmentHangingGroup') expect(['garmentRail', 'garmentRailRound', 'clothingWallUnit']).toContain(host.kind);
        else expect(PROP_PHYSICS_AUDIT[host.kind].cls, `${p.kind} on ${host.kind}`).toBe('static');
      }
    }
  });
});

describe('Skyways outfitter: fit and circulation', () => {
  it('everything stands inside the store\'s own areas without overlapping; hosted stock sits on its host\'s support', () => {
    for (const h of hits) {
      const L = h.layout, A = storeAreas(L, h.anchor);
      for (const p of mine(h)) {
        const g = L.levels[p.level ?? 0].grid;
        if (p.host !== undefined) {
          const host = L.props[p.host];
          expect(Math.abs(p.x - host.x), `${p.kind} on ${host.kind}`).toBeLessThanOrEqual(host.hx + 0.01);
          expect(Math.abs(p.z - host.z)).toBeLessThanOrEqual(host.hz + 0.01);
          expect(p.y).toBeGreaterThanOrEqual(host.y - 1e-6);
          expect(p.y + p.h).toBeLessThanOrEqual(host.y + Math.max(host.h, PROP_DEFS[host.kind].h) + PROP_DEFS[p.kind].h + 1e-6);
          continue;
        }
        const pts = p.mounted ? [[p.x, p.z]] : [[p.x - p.hx + 0.05, p.z - p.hz + 0.05], [p.x + p.hx - 0.05, p.z - p.hz + 0.05], [p.x - p.hx + 0.05, p.z + p.hz - 0.05], [p.x + p.hx - 0.05, p.z + p.hz - 0.05]];
        for (const [x, z] of pts) {
          const [cx, cy] = g.cellOf(x, z);
          expect(A.all.has(g.area[g.idx(cx, cy)]), `seed ${h.seed}: ${p.kind} at ${x.toFixed(2)},${z.toFixed(2)} outside the store`).toBe(true);
        }
        // standing on its floor
        if (!p.mounted) expect(p.y).toBeCloseTo(L.areas[p.area].floorY ?? 0, 3);
      }
      // no two standing props of the store overlap (>1 cm), the ones it found there included
      const stand = storeProps(L, h.anchor).filter(p => p.host === undefined && !p.mounted && p.kind !== 'shopGlazing');
      const own = new Set(mine(h));
      for (let i = 0; i < stand.length; i++) for (let j = i + 1; j < stand.length; j++) {
        const a = stand[i], b = stand[j];
        if (!own.has(a) && !own.has(b)) continue;
        if ((a.level ?? 0) !== (b.level ?? 0)) continue;
        const ox = a.hx + b.hx - Math.abs(a.x - b.x), oz = a.hz + b.hz - Math.abs(a.z - b.z);
        expect(ox > 0.01 && oz > 0.01, `seed ${h.seed}: ${a.kind} overlaps ${b.kind}`).toBe(false);
      }
    }
  });

  it('reachable from the entry: the till, the staff aisle, the pack wall, the back-room doors and every holder\'s front', () => {
    for (const h of hits) {
      const L = h.layout, an = h.anchor, r = resOf(h), g = L.levels[an.level].grid, A = storeAreas(L, an);
      const doors = L.doors.filter(d => A.all.has(d.a) || A.all.has(d.b));
      const inDoor = (cx: number, cy: number) => doors.some(d => cx >= d.x && cx < d.x + d.w && cy >= d.y && cy < d.y + d.h);
      const ok = (cx: number, cy: number) => g.walkable(cx, cy) && (A.all.has(g.area[g.idx(cx, cy)]) || inDoor(cx, cy));
      // flood from the storefront entry (just inside it)
      const sf = L.storefronts[an.storefront], along = sf.oh === 1, t = ((along ? sf.ox : sf.oy) + (sf.entry[0] + sf.entry[1]) / 2) * CELL;
      const n = ({N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0]} as const)[an.front];
      const ex = (along ? t : (sf.ox + 0.5) * CELL) + n[0] * 1.25, ez = (along ? (sf.oy + 0.5) * CELL : t) + n[1] * 1.25;
      const seen = new Uint8Array(g.w * g.h), stack: number[] = [];
      const [sx, sy] = g.cellOf(ex, ez);
      expect(ok(sx, sy), `seed ${h.seed}: entry cell`).toBe(true);
      seen[g.idx(sx, sy)] = 1; stack.push(g.idx(sx, sy));
      while (stack.length) {
        const c = stack.pop()!, cx = c % g.w, cy = Math.floor(c / g.w);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (!g.inBounds(nx, ny) || seen[g.idx(nx, ny)] || !ok(nx, ny)) continue;
          seen[g.idx(nx, ny)] = 1; stack.push(g.idx(nx, ny));
        }
      }
      /** A reached cell within `r` m of (x, z). */
      const near = (x: number, z: number, rad: number): boolean => {
        const [cx, cy] = g.cellOf(x, z), k = Math.ceil(rad / CELL);
        for (let dy = -k; dy <= k; dy++) for (let dx = -k; dx <= k; dx++) {
          if (!g.inBounds(cx + dx, cy + dy) || !seen[g.idx(cx + dx, cy + dy)]) continue;
          const [wx, wz] = g.center(cx + dx, cy + dy);
          if (Math.hypot(wx - x, wz - z) <= rad) return true;
        }
        return false;
      };
      const front = (p: PropPlacement, d: number): [number, number] => [p.x + Math.sin(p.rot) * (PROP_DEFS[p.kind].d / 2 + d), p.z + Math.cos(p.rot) * (PROP_DEFS[p.kind].d / 2 + d)];
      // the till's customer side; the staff side behind the back counter (the aisle)
      const till = L.props[r.desk.counters[0]], back = L.props[r.desk.back!];
      expect(near(...front(till, 0.5), 0.6), `seed ${h.seed}: till`).toBe(true);
      expect(near(...front(back, 0.4), 0.6), `seed ${h.seed}: staff aisle`).toBe(true);
      // the backpack's pack wall
      const pw = L.props[r.backpack!.host];
      expect(near(...front(pw, 0.5), 0.6), `seed ${h.seed}: pack wall`).toBe(true);
      // the back-room doors
      for (const d of doors.filter(d => A.stock.includes(d.a) || A.stock.includes(d.b))) {
        let reached = false;
        for (let y = d.y - 1; y <= d.y + d.h && !reached; y++) for (let x = d.x - 1; x <= d.x + d.w; x++) if (g.inBounds(x, y) && seen[g.idx(x, y)]) { reached = true; break; }
        expect(reached, `seed ${h.seed}: back-room door ${d.a}-${d.b}`).toBe(true);
      }
      // every holder the dresser placed on this storey: its front (the floor in front of its face) is reached
      for (const p of mine(h)) {
        if ((p.level ?? 0) !== an.level || p.host !== undefined || p.mounted || !isLootHolderKind(p.kind)) continue;
        // (a lidded carton / tote / crate opens from above: any side will do)
        if (LIDDED.has(p.kind)) expect(near(p.x, p.z, Math.max(p.hx, p.hz) + 0.6), `seed ${h.seed}: ${p.kind} side`).toBe(true);
        else expect(near(...front(p, 0.35), 0.75), `seed ${h.seed}: ${p.kind} front`).toBe(true);
      }
      // the walking lanes reached every door of the floor
      expect(r.skipped.filter(s => s.startsWith('lane to door'))).toEqual([]);
    }
  });
});

describe('Skyways outfitter: canoes, back rooms, finish', () => {
  it('a canoe hangs overhead in every store (higher in the double-height hall, a second one above it there when it fits); nothing below it', () => {
    for (const h of hits) {
      const L = h.layout, r = resOf(h), tall = h.anchor.format === 'double-height';
      expect(r.canoes.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(1);
      for (const c of r.canoes) {
        const p = L.props[c.prop], floor = L.areas[p.area].floorY ?? 0;
        expect(p.kind).toBe('skyDCanoe');
        expect(p.mounted).toBe(true);
        expect(p.y - floor).toBeGreaterThanOrEqual(2.3);
        if (tall) expect(p.y - floor).toBeGreaterThanOrEqual(4.0);
        expect(c.cable).toBeGreaterThanOrEqual(0);
        for (const q of storeProps(L, h.anchor)) {
          if (q === p || q.mounted || (q.level ?? 0) !== (p.level ?? 0)) continue;
          if (Math.abs(q.x - p.x) < q.hx + p.hx && Math.abs(q.z - p.z) < q.hz + p.hz) expect(q.y + q.h, `seed ${h.seed}: ${q.kind} under the canoe`).toBeLessThanOrEqual(p.y - 0.3 + 1e-6);
        }
      }
    }
    expect(hits.filter(h => h.anchor.format === 'double-height').some(h => resOf(h).canoes.length === 2)).toBe(true);
  });

  it('back rooms are stocked: shelving and openable storage (crates / cartons / lockers / cabinets), staff lockers in most stores', () => {
    const OPEN = new Set(['crate', 'staffLockers', 'cabinetTall', 'cabinetLow', 'filingCabinet', 'cardboardBoxFlaps', 'storageTote', 'desk', 'safe']);
    let lockers = 0;
    for (const h of hits) {
      const L = h.layout, A = storeAreas(L, h.anchor);
      expect(A.stock.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(1);
      const props = storeProps(L, h.anchor).filter(p => A.stock.includes(p.area));
      expect(props.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `seed ${h.seed}: shelving`).toBe(true);
      expect(props.filter(p => OPEN.has(p.kind)).length, `seed ${h.seed}: openable storage`).toBeGreaterThanOrEqual(2);
      if (props.some(p => ['staffLockers', 'cabinetTall', 'filingCabinet'].includes(p.kind))) lockers++;
      for (const p of props) if (OPEN.has(p.kind)) expect(['openable', 'existing'], p.kind).toContain(OPENABLE_AUDIT.find(a => a.kind === p.kind)!.cls);
    }
    expect(lockers).toBeGreaterThanOrEqual(hits.length - 1);
  });

  it('the finish is the store\'s own rustic lodge palette (timber lower walls, a plank floor, the exposed ceiling)', () => {
    const f = STORE_OUTFITTER.finish!;
    expect(ANCHOR_STYLES.outfitter).toEqual(anchorStyleOf(f));
    expect(f.wall.kind).toBe('wood');
    expect(f.wall.lowerTop).toBeGreaterThanOrEqual(2);
    expect(f.floor[0]).toBe('wood');
    expect(f.ceil[0]).toBe('raw');
  });

  it('the hall format alone (a store without the double height) dresses the same set pieces', () => {
    const h = findStore('outfitter', {format: 'hall', maxSeed: 40});
    const r = outfitterDressOf(h.layout).find(x => x.anchor === h.anchor.id)!;
    expect(r.backpack?.display).toBe('pack wall');
    expect(r.canoes).toHaveLength(1);
  });
});

// =================================================================================================================================
// A minimal Game shell for the gear system (the pattern of tests/gear-system.test.ts), on a Skyways layout

function shell(layout: StationLayout, store: MemoryBagStore) {
  const levels = levelsOf(layout);
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  const sp = layout.playerSpawn;
  const g = {
    scene: new THREE.Scene(), modifierSources: [] as (() => object)[], frameHooks: [] as ((dt: number) => void)[],
    interactHandlers: [] as (() => boolean)[], hitListeners: [] as ((h: {amount: number}) => void)[],
    sectionHooks: [] as {build?(l: unknown): void; teardown?(): void}[], stateListeners: [] as ((s: string, p: string) => void)[],
    promptProviders: [] as (() => string | null)[], inputOwners: [] as (() => boolean)[],
    warmRegistry: {addPool: (_n: string, _f: () => readonly THREE.Object3D[]) => {}},
    invUI: {gear: null as unknown},
    input: {
      onLockChange: (_l: boolean) => {}, clears: 0, pressed: new Set<string>(), mouse: [false, false, false], mousePressed: [false, false, false], wheel: 0, locked: true,
      hit(c: string) { return this.pressed.has(c); }, unlock() {}, lock: () => Promise.resolve(true),
    },
    inv: new Inventory(), weapon: new WeaponController(), mods: {...BASE_MODIFIERS},
    player: {x: sp.x, y: 0, z: sp.z, yaw: sp.yaw, pitch: 0, climbing: false, grounded: true, alive: true, eye: 1.6},
    consumeView: {busy: false}, viewmodel: {setItem: (_id: string | null) => {}},
    sfx: {equip() {}, denied() {}, pickup() {}, search() {}}, hud: {toast: (_t: string) => {}},
    flareHold: {active: false, cancel: () => false}, syncHeld() {}, camera, levels, layout, pickups: new PickupManager({}), qa: true, state: 'playing',
  };
  const sys = installGear(g as unknown as Game);
  sys.setStore(store);
  return {g, sys, layout, levels};
}
type Shell = ReturnType<typeof shell>;
/** Builds the section like Game.buildSection: the layout's bag finds spawned (their own yaw), then the lane build hooks. */
function build(s: Shell): void {
  s.g.pickups.clear();
  for (const p of s.layout.pickups) if (isBagItem(p.itemId)) s.g.pickups.add(s.g.inv.makeStack(p.itemId, p.count), p.x, p.y, p.z, p.yaw ?? 0);
  for (const h of s.g.sectionHooks) h.build?.(s.layout);
}
const teardown = (s: Shell) => { for (const h of s.g.sectionHooks) h.teardown?.(); };
