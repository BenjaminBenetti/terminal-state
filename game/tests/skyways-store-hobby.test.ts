// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-HOBBY): GRAIN ELEVATOR MODELS — the Skyways hobby / model shop at
// layout version 3 (gen/skyways/stores/hobby.ts + hobbyDress.ts). Over several seeds (the family's only format is the hall):
//  - the model shop's own pieces: the grain-elevator railway layout table as the centrepiece with a clear viewing ring, the cash desk
//    (back counter that opens, till + register, glass display counter), the workbench corner (desk with drawers, tool chest, paint
//    rack), glass display cases, kit walls and kit aisles stocked with separate loose kit stacks on their measured tiers;
//  - storage opens (every storage kind it places is openable / an existing holder in OPENABLE_AUDIT; nothing storage-looking is a
//    sealed fake); holder loot on-theme (the store's purposes and per-holder keys, no ammunition on the sales floor);
//  - fit (inside the store, no overlapping boxes, hosted pieces on their hosts) and walking routes from the entry to the till, every
//    holder's front, the workbench and every back room; physics classes; stocked back rooms; the store's own palette.
import {describe, expect, it} from 'vitest';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../src/gen/props';
import {stockVariant} from '../src/gen/purposeShapes';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS} from '../src/levels/registry';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {compartmentTable, holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {AMMO_ITEM_IDS} from '../src/items/calibers';
import {purposeById} from '../src/gen/purposes';
import {STORE_HOBBY} from '../src/gen/skyways/stores/hobby';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {STORE_HOBBY_KINDS, STORE_HOBBY_MALL_MODELS} from '../src/gen/skyways/stores/kinds/hobby';
import {GONDOLA_TOP, HOBBY_HOLDER_PURPOSE, hobbyRoleProps, hobbyStoreDressOf, type HobbyRole, type HobbyStoreResult} from '../src/gen/skyways/stores/hobbyDress';
import {ANCHOR_STYLES, anchorStyleOf} from '../src/gen/skyways/destinations/anchorStyles';
import {MALL_KIND_ASSET} from '../src/gen/mall/kinds';
import {SKYWAYS_SHOP_FAMILIES, type SkywaysAnchor} from '../src/gen/skyways/skywaysTypes';
import {findStores, storeAreas, storeProps, type StoreHit} from './helpers/skywaysStores';

const HITS: StoreHit[] = findStores('hobby', {count: 4, maxSeed: 40});
const recOf = (h: StoreHit): HobbyStoreResult => {
  const r = hobbyStoreDressOf(h.layout).find(q => q.anchor === h.anchor.id);
  if (!r) throw new Error(`seed ${h.seed}: no hobby store record`);
  return r;
};
const role = (h: StoreHit, k: HobbyRole): PropPlacement[] => hobbyRoleProps(h.layout, recOf(h), k);
/** Every prop the store's dresser placed (all roles), as it stands in the finished layout. */
const placedOf = (h: StoreHit): PropPlacement[] => Object.keys(recOf(h).roles).flatMap(k => role(h, k as HobbyRole));
const ROLES_STORAGE: HobbyRole[] = ['backCounter', 'glassCase', 'workbench', 'toolChest', 'sideboard', 'staffCorner', 'backStorage', 'staffDesk'];
/** Items allowed in the store's holders (its purposes' rows): batteries, flares, dressings / kits, drinks, snacks, tins. */
const AMMO = new Set(AMMO_ITEM_IDS);
const isFloor = (h: StoreHit, p: PropPlacement) => !h.anchor.stock.includes(p.area);

describe('Skyways store: Grain Elevator Models (hobby)', () => {
  it('found the hobby store on several seeds at layout version 3 (the hall format)', () => {
    expect(HITS.length).toBeGreaterThanOrEqual(3);
    for (const h of HITS) expect(h.anchor.format).toBe('hall');
    expect(SKYWAYS_STORES.hobby).toBe(STORE_HOBBY);
  });

  it('the model shop: layout table centrepiece with a viewing ring, cash desk, workbench + paint rack, glass cases, kit walls and aisles', () => {
    for (const h of HITS) {
      const r = recOf(h), s = `seed ${h.seed}`;
      // the grain-elevator railway layout table (kit model) mid-floor, nothing standing within 1 m of it
      const [dio] = role(h, 'diorama');
      expect(dio?.kind, s).toBe('skyDDiorama');
      const standing = storeProps(h.layout, h.anchor).filter(p => !p.mounted && p.host === undefined && p !== dio);
      for (const p of standing) {
        const gap = Math.max(Math.abs(p.x - dio.x) - p.hx - dio.hx, Math.abs(p.z - dio.z) - p.hz - dio.hz);
        expect(gap, `${s}: ${p.kind} by the layout table`).toBeGreaterThanOrEqual(1.0);
      }
      // the cash desk: the openable back counter, the till with its register, (mostly) the glass display counter
      expect(role(h, 'backCounter').map(p => p.kind), s).toEqual(['mallCashwrapCounter']);
      expect(role(h, 'till').map(p => p.kind), s).toEqual(['shopCounter']);
      expect(role(h, 'register').map(p => p.kind), s).toEqual(['cashRegister']);
      // the workbench corner: the demo desk (drawers), the tool chest beside it, the paint rack (paint tins / tubes stock theme)
      const [desk] = role(h, 'workbench'), [chest] = role(h, 'toolChest'), racks = role(h, 'paintRack');
      expect(desk?.kind, s).toBe('desk');
      expect(chest?.kind, s).toBe('rollingToolChest');
      expect(Math.hypot(chest.x - desk.x, chest.z - desk.z), s).toBeLessThan(1.3);
      expect(racks.length, s).toBeGreaterThanOrEqual(1);
      for (const p of racks) { expect(p.kind).toBe('stockShelf'); expect(p.variant).toBe(stockVariant('parts')); expect(Math.hypot(p.x - desk.x, p.z - desk.z)).toBeLessThan(3.0); }
      expect(role(h, 'benchTop').length, s).toBeGreaterThanOrEqual(1);
      // glass display cases (glass doors that open), the greeter robot, posters
      expect(role(h, 'glassCase').length, s).toBeGreaterThanOrEqual(2);
      for (const p of role(h, 'glassCase')) expect(p.kind).toBe('glassDisplayCabinet');
      expect(role(h, 'robot').map(p => p.kind), s).toEqual(['skyDToyRobot']);
      expect(role(h, 'poster').length, s).toBeGreaterThanOrEqual(2);
      // kit walls (steel shelving) and kit aisles (back-to-back gondolas), stocked with separate loose kit stacks on real tiers
      const shelves = role(h, 'kitShelf'), gondolas = role(h, 'kitGondola'), kits = role(h, 'kitStack');
      expect(shelves.length, s).toBeGreaterThanOrEqual(4);
      expect(gondolas.length, s).toBeGreaterThanOrEqual(2);
      expect(kits.length, s).toBeGreaterThanOrEqual(30);
      const hosts = new Set([...shelves, ...gondolas]);
      for (const k of kits) {
        expect(k.kind).toBe('skyDModelKits');
        const host = h.layout.props[k.host!];
        expect(hosts.has(host), `${s}: a kit stack on a kit fixture`).toBe(true);
        const top = k.y - host.y, tiers = host.kind === 'shelf' ? SHELF_TIER_Y.slice(0, 3) : [GONDOLA_TOP.y];
        expect(tiers.some(t => Math.abs(t - top) < 1e-3), `${s}: kit on a measured tier (${top})`).toBe(true);
        expect(Math.abs(k.x - host.x) + k.hx, `${s}: kit within its host`).toBeLessThanOrEqual(host.hx + 0.01);
        expect(Math.abs(k.z - host.z) + k.hz, `${s}: kit within its host`).toBeLessThanOrEqual(host.hz + 0.01);
        expect(host.cut?.some(c => Math.abs(c.y - top) < 1e-3), `${s}: the host's loot surface gives up the kit's span`).toBe(true);
      }
      expect(r.skipped.filter(x => /diorama|cash desk|workbench|robot/.test(x)), s).toEqual([]);
    }
  });

  it('storage opens: every storage piece is openable / an existing holder (no sealed fakes); every kind is classified', () => {
    const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e]));
    expect(STORE_HOBBY_KINDS.length).toBe(0); // (no new kinds: existing, already classified kinds only)
    for (const h of HITS) {
      for (const p of storeProps(h.layout, h.anchor)) expect(audit.has(p.kind), `${p.kind} classified`).toBe(true);
      for (const k of ROLES_STORAGE) for (const p of role(h, k)) expect(['openable', 'existing'], `seed ${h.seed} ${k}: ${p.kind}`).toContain(audit.get(p.kind)!.cls);
      for (const p of placedOf(h)) {
        const e = audit.get(p.kind)!;
        expect(e.cls === 'exception' && e.role === 'storage', `${p.kind}: a storage-looking exception`).toBe(false);
      }
      // the cash desk's back counter and the workbench open (drawers / doors through the openables)
      expect(audit.get('mallCashwrapCounter')!.cls).toBe('openable');
      expect(audit.get('rollingToolChest')!.cls).toBe('openable');
      expect(audit.get('desk')!.cls).toBe('openable');
      expect(audit.get('glassDisplayCabinet')!.cls).toBe('openable');
    }
    // the Mall models it furnishes with are recorded for Skyways (levelAssets)
    for (const k of ['mallCashwrapCounter', 'glassDisplayCabinet', 'glassCounter', 'retailGondola', 'cardboardBoxFlaps', 'storageTote'] as const)
      expect(STORE_HOBBY_MALL_MODELS, k).toContain(`mall-${MALL_KIND_ASSET[k]}.glb`);
  });

  it('holder loot is on-theme: the store\'s purposes and per-holder keys, no ammunition on the sales floor', () => {
    const P = STORE_HOBBY.purposes, prof = lootProfile('skyways');
    const allowed = new Set([P.floor, P.stock, P.office, ...Object.values(HOBBY_HOLDER_PURPOSE)]);
    for (const id of allowed) expect(purposeById(id), id).toBeTruthy();
    for (const h of HITS) {
      const A = h.layout.areas;
      expect(A[h.anchor.floor].purpose).toBe(P.floor);
      for (const id of h.anchor.stock) expect(A[id].purpose).toBe(A[id].type === 'stock-room' ? P.stock : P.office);
      let holders = 0;
      const staffCorner = new Set(role(h, 'staffCorner'));
      for (const p of storeProps(h.layout, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        holders++;
        const key = p.purpose ?? A[p.area].purpose ?? A[p.area].type;
        expect(allowed.has(key), `seed ${h.seed} ${p.kind}: loot key ${key}`).toBe(true);
        const rows = [...holderTable(p.kind, key, prof).rows, ...(compartmentTable(p.kind, key, prof)?.rows ?? [])].map(r => r[0]);
        // (ammunition only where the existing staff rows deliberately carry it — a staff locker's personal rows, an office desk's
        // drawers, the back office's cabinet / safe — in the back rooms or the staff corner; never on the shop floor's fixtures)
        const staffSide = !isFloor(h, p) || staffCorner.has(p);
        if (!staffSide || !['staffLockers', 'desk', 'safe', 'cabinetTall'].includes(p.kind)) expect(rows.filter(id => AMMO.has(id)), `seed ${h.seed} ${p.kind} (${key})`).toEqual([]);
      }
      expect(holders, `seed ${h.seed}`).toBeGreaterThan(20);
      // the themed holders: the workbench / tool chest / paint rack roll craft-hardware supplies, the glass cases batteries
      for (const k of ['workbench', 'toolChest', 'paintRack'] as const) for (const p of role(h, k)) {
        expect(p.purpose).toBe(HOBBY_HOLDER_PURPOSE.workbench);
        const ids = holderTable(p.kind as HolderKind, p.purpose!, prof).rows.map(r => r[0]);
        expect(ids).toContain('battery');
        expect(ids).toContain('flare');
      }
      for (const p of [...role(h, 'glassCase'), ...role(h, 'glassCounter')]) {
        expect(p.purpose).toBe(HOBBY_HOLDER_PURPOSE.glass);
        expect(holderTable(p.kind as HolderKind, p.purpose!, prof).rows.map(r => r[0])).toContain('battery');
      }
      // the kit shelving / aisles roll the toy store's floor stock
      for (const p of [...role(h, 'kitShelf'), ...role(h, 'kitGondola')]) expect(p.purpose ?? A[p.area].purpose).toBe(P.floor);
    }
  });

  it('fit: inside the store, no overlapping boxes, hosted pieces on their hosts, mounts on the wall above the floor', () => {
    for (const h of HITS) {
      const {all} = storeAreas(h.layout, h.anchor), g = h.layout.levels[h.anchor.level].grid, s = `seed ${h.seed}`;
      const mine = placedOf(h), standing = storeProps(h.layout, h.anchor).filter(p => !p.mounted && p.host === undefined);
      for (const p of mine) {
        expect(all.has(p.area), `${s} ${p.kind} in a store area`).toBe(true);
        if (!p.mounted) for (const [x, z] of [[p.x - p.hx + 0.05, p.z - p.hz + 0.05], [p.x + p.hx - 0.05, p.z - p.hz + 0.05], [p.x - p.hx + 0.05, p.z + p.hz - 0.05], [p.x + p.hx - 0.05, p.z + p.hz - 0.05]]) {
          const [cx, cy] = g.cellOf(x, z), i = g.idx(cx, cy);
          expect(g.cells[i] === FLOOR && all.has(g.area[i]), `${s} ${p.kind} corner on the store's floor`).toBe(true);
        }
        if (p.host !== undefined) {
          const host = h.layout.props[p.host];
          expect(Math.abs(p.x - host.x) + p.hx, `${s} ${p.kind} on ${host.kind}`).toBeLessThanOrEqual(host.hx + 0.02);
          expect(Math.abs(p.z - host.z) + p.hz, `${s} ${p.kind} on ${host.kind}`).toBeLessThanOrEqual(host.hz + 0.02);
          expect(p.y, `${s} ${p.kind} above its host's base`).toBeGreaterThan(host.y);
        }
        if (p.mounted && p.kind !== 'skyDPoster') expect(p.y - (h.layout.areas[p.area].floorY ?? 0), `${s} ${p.kind} mounted above the floor`).toBeGreaterThanOrEqual(1.0);
      }
      // no two standing boxes overlap (> 1 cm) where one of them is the store's (the chair tucks under its desk by design)
      const set = new Set(mine);
      for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
        const a = standing[i], b = standing[j];
        if (!set.has(a) && !set.has(b)) continue;
        if (a.kind === 'officeSwivelChair' || b.kind === 'officeSwivelChair') continue;
        if ((a.level ?? 0) !== (b.level ?? 0)) continue;
        const ov = Math.abs(a.x - b.x) < a.hx + b.hx - 0.01 && Math.abs(a.z - b.z) < a.hz + b.hz - 0.01;
        expect(ov, `${s}: ${a.kind} @${a.x},${a.z} overlaps ${b.kind} @${b.x},${b.z}`).toBe(false);
      }
    }
  });

  it('routes: from the entry, over free floor, to the till, the workbench, every holder\'s front and every back room', () => {
    for (const h of HITS) {
      const L = h.layout, an = h.anchor, r = recOf(h), s = `seed ${h.seed}`;
      const g = L.levels[an.level].grid, {all} = storeAreas(L, an);
      const doorCells = new Set<number>();
      for (const d of L.doors) if (all.has(d.a) || all.has(d.b)) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCells.add(g.idx(x, y));
      const occ = new Uint8Array(g.w * g.h);
      for (const p of L.props) {
        if ((p.level ?? 0) !== an.level || p.mounted || p.host !== undefined || p.kind === 'officeSwivelChair' || p.kind === 'shopGlazing') continue;
        for (let cy = Math.floor((p.z - p.hz + 0.04) / CELL); cy <= Math.floor((p.z + p.hz - 0.04) / CELL); cy++)
          for (let cx = Math.floor((p.x - p.hx + 0.04) / CELL); cx <= Math.floor((p.x + p.hx - 0.04) / CELL); cx++) if (g.inBounds(cx, cy)) occ[g.idx(cx, cy)] = 1;
      }
      const ok = (i: number) => g.cells[i] === FLOOR && !occ[i] && (all.has(g.area[i]) || doorCells.has(i));
      const [sx, sy] = g.cellOf(r.entry.x, r.entry.z);
      const seen = new Uint8Array(g.w * g.h), stack = [g.idx(sx, sy)];
      expect(ok(stack[0]), `${s}: the entry is free floor`).toBe(true);
      seen[stack[0]] = 1;
      while (stack.length) {
        const c = stack.pop()!;
        for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && ok(n)) { seen[n] = 1; stack.push(n); }
      }
      const reach = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return !!seen[g.idx(cx, cy)]; };
      // (a point 0.3 m in front of a prop's front face)
      const faceCell = (p: PropPlacement): [number, number] => {
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
        return [p.x + fx * (p.hx + 0.3), p.z + fz * (p.hz + 0.3)];
      };
      for (const k of ['till', 'glassCounter', 'workbench', 'toolChest', 'paintRack', 'glassCase', 'sideboard', 'kitShelf', 'kitGondola', 'capsule', 'backCounter'] as HobbyRole[]) {
        for (const p of role(h, k)) expect(reach(...faceCell(p)), `${s}: the front of ${k} ${p.kind} @${p.x},${p.z}`).toBe(true);
      }
      for (const id of an.stock) {
        const a = L.areas[id];
        let any = false;
        for (let y = a.y; y < a.y + a.h && !any; y++) for (let x = a.x; x < a.x + a.w && !any; x++) if (seen[g.idx(x, y)]) any = true;
        expect(any, `${s}: back room ${a.label}`).toBe(true);
      }
    }
  });

  it('physics: loose / movable pieces move, fixtures are static (the shared audit classes)', () => {
    const cls = (k: string) => PROP_PHYSICS_AUDIT[k]?.cls;
    for (const k of ['skyDModelKits', 'skyDToyRobot', 'skyDAirshipModel', 'officeSwivelChair']) expect(cls(k), k).toBe('dynamic');
    for (const k of ['skyDDiorama', 'mallCashwrapCounter', 'shopCounter', 'glassCounter', 'glassDisplayCabinet', 'retailGondola', 'shelf', 'stockShelf']) expect(cls(k), k).toBe('static');
    for (const h of HITS) for (const p of placedOf(h)) expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind} classified`).toBeTruthy();
  });

  it('back rooms: shelving, cartons and openable storage in the stock room; staff lockers or a staff desk in the store', () => {
    const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e.cls]));
    for (const h of HITS) {
      const L = h.layout, s = `seed ${h.seed}`;
      expect(h.anchor.stock.length, `${s}: a back room (v3)`).toBeGreaterThanOrEqual(1);
      const inRoom = (id: number) => L.props.filter(p => p.area === id);
      for (const id of h.anchor.stock) {
        const a = L.areas[id], ps = inRoom(id);
        expect(ps.some(p => isLootHolderKind(p.kind) && ['openable', 'existing'].includes(audit.get(p.kind) ?? '')), `${s} ${a.label}: openable storage`).toBe(true);
        if (a.type === 'stock-room') {
          expect(ps.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `${s} ${a.label}: shelving`).toBe(true);
          expect(ps.some(p => p.kind === 'cartonStack' || p.kind === 'cardboardBoxFlaps'), `${s} ${a.label}: cartons`).toBe(true);
        }
      }
      const staff = storeProps(L, h.anchor).filter(p => p.kind === 'staffLockers' || (p.kind === 'desk' && h.anchor.stock.includes(p.area)));
      expect(staff.length, `${s}: staff lockers / a staff desk`).toBeGreaterThanOrEqual(1);
    }
  });

  it('palette: the store\'s own wall / floor / ceiling (wheat plaster over a barn-red board wainscot, vinyl tile, grid ceiling)', () => {
    const f = STORE_HOBBY.finish!;
    expect(f).toBeTruthy();
    expect(ANCHOR_STYLES.hobby).toEqual(anchorStyleOf(f));
    expect(f.wall.kind).toBe('wood');
    expect(f.wall.lowerTop).toBeGreaterThan(0.8);
    expect(f.wall.lowerTop).toBeLessThan(1.5);
    expect(f.floor[0]).toBe('vinyl');
    expect(f.ceil[0]).toBe('grid');
    for (const fam of SKYWAYS_SHOP_FAMILIES) if (fam !== 'hobby') {
      const o = ANCHOR_STYLES[fam];
      expect(o.wall.paint === f.wall.paint && o.wall.lower === f.wall.lower, `distinct from ${fam}`).toBe(false);
    }
  });

  it('deterministic: the same seed dresses the same store', () => {
    const h = HITS[0];
    const again = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const an2 = again.skyways!.anchors!.find(a => a.family === 'hobby') as SkywaysAnchor;
    const sig = (l: StationLayout, an: SkywaysAnchor) => storeProps(l, an).map(p => `${p.kind}@${p.x},${p.z},${p.y},${p.rot},${p.variant},${p.purpose ?? ''}`).join('|');
    expect(sig(again, an2)).toBe(sig(h.layout, h.anchor));
    expect(PROP_DEFS.skyDDiorama.w).toBeGreaterThan(2.5);
  });
});
