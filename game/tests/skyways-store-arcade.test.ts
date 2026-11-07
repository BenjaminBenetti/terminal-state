// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-ARCADE): the STARFALL ARCADE at layout version 3
// (gen/skyways/stores/arcade.ts + arcadeDress.ts) over several seeds (the hall format; inset-stock-room L shapes included):
//  - a whole arcade: prize counter (glass prize cases, till + register) with OPENABLE cabinets behind it, token changers, claw cranes,
//    arcade cabinet banks and back-to-back rows, air hockey / pinball, capsule toys, the teddy prize, posters, the technician's workshop;
//  - storage opens (OPENABLE_AUDIT), holder loot on theme (existing purposes / per-holder overrides; no ammo), fit (in-area, no overlaps,
//    a 1 m wide walkable route from the storefront to every holder and back-room door), physics classes, stocked back rooms, palette,
//    the Mall models registered, deterministic, the prize-car add-on untouched.
import {describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {findStores, storeAreas, storeProps, type StoreHit} from './helpers/skywaysStores';
import {ARCADE_FLOOR_KINDS, ARCADE_HOLDER_PURPOSE, ARCADE_LAST} from '../src/gen/skyways/stores/arcadeDress';
import {STORE_ARCADE} from '../src/gen/skyways/stores/arcade';
import {STORE_ARCADE_KINDS, STORE_ARCADE_MALL_MODELS} from '../src/gen/skyways/stores/kinds/arcade';
import {ANCHOR_STYLES, anchorStyleOf} from '../src/gen/skyways/destinations/anchorStyles';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {compartmentTable, holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {AMMO_ITEM_IDS} from '../src/items/calibers';
import {MALL_KIND_ASSET} from '../src/gen/mall/kinds';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {CELL, FLOOR} from '../src/gen/grid';
import {purposeById} from '../src/gen/purposes';
import type {StationLayout} from '../src/gen/stationTypes';

const HITS: StoreHit[] = findStores('arcade', {format: 'hall', count: 6, maxSeed: 40});
const AUDIT = new Map(OPENABLE_AUDIT.map(e => [e.kind, e]));
const roles = (h: StoreHit) => ARCADE_LAST.get(h.layout)!.roles;
const count = (h: StoreHit, ...rs: string[]) => rs.reduce((n, r) => n + (roles(h)[r]?.length ?? 0), 0);
const kindsIn = (ps: readonly PropPlacement[]) => new Set(ps.map(p => p.kind));
const lootKey = (l: StationLayout, p: PropPlacement) => p.purpose ?? l.areas[p.area]?.purpose ?? l.areas[p.area]?.type ?? 'default';
/** A placement's value signature (the level's later passes copy the placement objects). */
const sig = (p: PropPlacement) => `${p.kind}|${p.x}|${p.z}|${p.y}|${p.rot}`;

describe('Skyways store: Starfall Arcade (layout version 3)', () => {
  it('has seeds with the arcade, one dressing result each', () => {
    expect(HITS.length).toBeGreaterThanOrEqual(5);
    for (const h of HITS) expect(ARCADE_LAST.get(h.layout), `seed ${h.seed}`).toBeTruthy();
    // (inset stock rooms: some arcades are L-shaped — a second floor piece beside the stock room)
    expect(HITS.some(h => storeAreas(h.layout, h.anchor).floor.length > 1)).toBe(true);
  });

  it('is a whole arcade: prize counter + openable cabinets behind it, tokens, claws, cabinets, games, prizes, posters, workshop', () => {
    for (const h of HITS) {
      const r = roles(h), s = `seed ${h.seed}`;
      expect(kindsIn(r.counter ?? []).has('shopCounter') || kindsIn(r.counter ?? []).has('glassCounter'), `${s}: counter`).toBe(true);
      expect(r.register?.length, `${s}: register`).toBe(1);
      expect((r.counterBack ?? []).some(p => AUDIT.get(p.kind)?.cls === 'openable'), `${s}: openable cabinet behind the counter`).toBe(true);
      expect(count(h, 'token'), `${s}: token changer`).toBeGreaterThanOrEqual(1);
      expect(count(h, 'claw'), `${s}: claw cranes`).toBeGreaterThanOrEqual(1);
      expect(count(h, 'cabinet', 'cabinetRow'), `${s}: arcade cabinets`).toBeGreaterThanOrEqual(5);
      expect(count(h, 'capsule'), `${s}: capsule / gumball machines`).toBeGreaterThanOrEqual(2);
      expect(count(h, 'teddy'), `${s}: giant teddy prize`).toBe(1);
      expect(count(h, 'poster'), `${s}: posters`).toBeGreaterThanOrEqual(1);
      expect(count(h, 'vending'), `${s}: vending`).toBe(1);
      const ws = kindsIn(r.workshop ?? []);
      expect(ws.has('repairBench') || ws.has('desk'), `${s}: technician's bench`).toBe(true);
      expect(kindsIn([...(r.workshop ?? []), ...(r.staff ?? [])]).has('staffLockers'), `${s}: staff lockers`).toBe(true);
      // every role's props are this store's
      // every role's props are this store's (the level's later passes copy the placements: matched by value)
      const own = new Set(storeProps(h.layout, h.anchor).map(sig));
      for (const [role, ps] of Object.entries(r)) for (const p of ps) expect(own.has(sig(p)), `${s}: ${role} ${p.kind} in the store`).toBe(true);
    }
    // across the seeds: the games and the party zone show up
    expect(HITS.filter(h => count(h, 'airHockey') > 0).length).toBeGreaterThanOrEqual(HITS.length - 1);
    expect(HITS.some(h => count(h, 'pinball') > 0)).toBe(true);
    expect(HITS.some(h => count(h, 'cabinetRow') > 0)).toBe(true);
    expect(HITS.some(h => count(h, 'party') > 0)).toBe(true);
    expect(HITS.filter(h => count(h, 'kiddie') > 0).length).toBeGreaterThanOrEqual(HITS.length - 1);
    expect(HITS.filter(h => (roles(h).workshop ?? []).some(p => p.kind === 'rollingToolChest')).length).toBeGreaterThanOrEqual(HITS.length - 1);
  }, 600_000);

  it('prize counter: the back units stand against the wall behind the counter (a staff aisle >= 0.95 m between)', () => {
    for (const h of HITS) {
      const r = roles(h), mods = r.counter ?? [], backs = r.counterBack ?? [];
      for (const b of backs) {
        // the nearest module faces the same way, its back face >= 0.95 m from the unit's front face
        const m = mods.slice().sort((p, q) => Math.hypot(p.x - b.x, p.z - b.z) - Math.hypot(q.x - b.x, q.z - b.z))[0];
        expect(Math.abs(Math.cos(m.rot - b.rot) - 1), `seed ${h.seed}: facing`).toBeLessThan(1e-6);
        const fx = Math.sin(b.rot), fz = Math.cos(b.rot);
        const gap = ((m.x - b.x) * fx + (m.z - b.z) * fz) - PROP_DEFS[m.kind].d / 2 - PROP_DEFS[b.kind].d / 2;
        expect(gap, `seed ${h.seed}: staff aisle`).toBeGreaterThanOrEqual(0.95);
      }
      // the prize cases / cabinet roll the prize loot key
      for (const p of [...mods, ...backs]) if (p.kind === 'glassCounter' || p.kind === 'glassDisplayCabinet') expect(p.purpose).toBe(ARCADE_HOLDER_PURPOSE.prize);
    }
  });

  it('cabinet rows stand back to back (backs touching), banks against the walls with their play strips', () => {
    let pairs = 0;
    for (const h of HITS) {
      const rows = roles(h).cabinetRow ?? [];
      for (const p of rows) {
        const twin = rows.find(q => q !== p && Math.abs(Math.cos(q.rot - p.rot) + 1) < 1e-6 && Math.hypot(q.x - p.x, q.z - p.z) < PROP_DEFS.arcadeCabinet.d + 0.02);
        if (twin) pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(4);
  });

  it('storage opens: every storage piece is an openable / existing / open holder (OPENABLE_AUDIT); every kind is classified', () => {
    for (const h of HITS) for (const p of storeProps(h.layout, h.anchor)) {
      const e = AUDIT.get(p.kind);
      expect(e, `seed ${h.seed}: ${p.kind} classified`).toBeTruthy();
      if (e!.role === 'storage') expect(['openable', 'existing', 'open'], `seed ${h.seed}: ${p.kind}`).toContain(e!.cls);
    }
    for (const k of ['mallCashwrapCounter', 'glassDisplayCabinet', 'staffLockers', 'rollingToolChest', 'desk', 'storageTote', 'cardboardBoxFlaps', 'shopCooler']) {
      expect(AUDIT.get(k)?.cls, k).toBe('openable');
    }
    expect(STORE_ARCADE_KINDS.length).toBe(0); // (no new kinds: existing classified kinds only)
  });

  it('loot: the store purposes and per-holder overrides are existing purposes; holders roll on-theme rows, never ammo', () => {
    for (const id of [...Object.values(STORE_ARCADE.purposes), ...Object.values(ARCADE_HOLDER_PURPOSE)]) expect(purposeById(id), id).toBeTruthy();
    const ammo = new Set(AMMO_ITEM_IDS);
    let holders = 0;
    for (const h of HITS) {
      const l = h.layout, A = storeAreas(l, h.anchor);
      for (const id of A.floor) expect(l.areas[id].purpose).toBe('mall-arcade');
      for (const id of A.stock) expect(l.areas[id].purpose).toBe(l.areas[id].type === 'stock-room' ? 'mall-arcade-back' : 'mall-management');
      for (const p of storeProps(l, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        holders++;
        // (the store's purpose tables never add ammo; a container's OWN existing table keeps its deliberate personal-stash rows: the
        // staff lockers' / desk drawers' few loose rounds, like every level's)
        const t = holderTable(p.kind as HolderKind, lootKey(l, p));
        if (t.source !== 'own') for (const [item] of t.rows) expect(ammo.has(item), `seed ${h.seed}: ${p.kind} (${lootKey(l, p)}) rolls ${item}`).toBe(false);
        if (l.areas[p.area]?.type === 'shop' && p.kind !== 'staffLockers') for (const [item] of t.rows) expect(ammo.has(item), `seed ${h.seed}: sales floor ${p.kind} rolls ${item}`).toBe(false);
        // (a desk's drawers: their own table narrowed to the key's desk rows — the workshop bench holds no rounds)
        const inside = compartmentTable(p.kind as HolderKind, lootKey(l, p));
        if (inside && p.kind !== 'staffLockers') for (const [item] of inside.rows) expect(ammo.has(item), `seed ${h.seed}: ${p.kind} drawers roll ${item}`).toBe(false);
      }
      // the overrides sit on the right holders
      for (const p of roles(h).party ?? []) if (p.kind === ARCADE_FLOOR_KINDS.partyTable) expect(p.purpose).toBe(ARCADE_HOLDER_PURPOSE.party);
      for (const p of [...(roles(h).workshop ?? []), ...(roles(h).staff ?? [])]) {
        if (p.kind === 'rollingToolChest' || p.kind === 'desk') expect(p.purpose).toBe(ARCADE_HOLDER_PURPOSE.tech);
        if (p.kind === 'staffLockers') expect(p.purpose).toBe(ARCADE_HOLDER_PURPOSE.staff);
      }
    }
    expect(holders).toBeGreaterThan(HITS.length * 6);
    // the themes: the sales floor's counters / prize cases roll arcade / toy stock (batteries, sweets, drinks); the lockers personal rows
    const rows = (k: HolderKind, key: string) => new Set(holderTable(k, key).rows.map(([i]) => i));
    expect(rows('shopCounter', 'mall-arcade').has('battery') || rows('shopCounter', 'mall-arcade').has('chocolate')).toBe(true);
    expect(rows('glassCounter', ARCADE_HOLDER_PURPOSE.prize).has('chocolate')).toBe(true);
    expect(rows('vending', 'mall-arcade').has('cola')).toBe(true);
    expect(rows('foodCourtTableSet' as HolderKind, ARCADE_HOLDER_PURPOSE.party).has('chips')).toBe(true);
    expect(rows('rollingToolChest', ARCADE_HOLDER_PURPOSE.tech).has('battery')).toBe(true);
  });

  it('fit: every piece in a store area, no two floor pieces overlap, a 1 m route from the storefront to every holder and back-room door', () => {
    for (const h of HITS) {
      const l = h.layout, an = h.anchor, A = storeAreas(l, an), g = l.levels[an.level].grid, s = `seed ${h.seed}`;
      const res = ARCADE_LAST.get(l)!, mine = res.props;
      const floorProps = storeProps(l, an).filter(p => !p.mounted && p.host === undefined && p.kind !== 'shopGlazing');
      for (const p of mine) expect(A.all.has(p.area), `${s}: ${p.kind} area`).toBe(true);
      for (let i = 0; i < floorProps.length; i++) for (let j = i + 1; j < floorProps.length; j++) {
        const a = floorProps[i], b = floorProps[j];
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        expect(ox > 0.02 && oz > 0.02, `${s}: ${a.kind} overlaps ${b.kind}`).toBe(false);
      }
      // walkable cells: the store's floor cells not under a prop, + its door cells; blocks of 2 x 2 free cells (1 m) are the route
      const doors = l.doors.filter(d => A.all.has(d.a) || A.all.has(d.b));
      const doorCells = new Set<number>();
      for (const d of doors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCells.add(g.idx(x, y));
      const free = (x: number, y: number) => {
        if (!g.inBounds(x, y)) return false;
        const i = g.idx(x, y);
        return g.cells[i] === FLOOR && !g.blocked[i] && (A.all.has(g.area[i]) || doorCells.has(i));
      };
      const blk = (x: number, y: number) => free(x, y) && free(x + 1, y) && free(x, y + 1) && free(x + 1, y + 1);
      const sf = l.storefronts[an.storefront], front = doors.find(d => d.shopfront && (d.a === an.floor || d.b === an.floor))!;
      expect(front, `${s}: storefront door`).toBeTruthy();
      const seen = new Set<number>(), stack: number[] = [];
      for (let y = front.y - 2; y <= front.y + front.h + 1; y++) for (let x = front.x - 2; x <= front.x + front.w + 1; x++) if (blk(x, y)) { seen.add(g.idx(x, y)); stack.push(g.idx(x, y)); }
      expect(stack.length, `${s}: entry`).toBeGreaterThan(0);
      while (stack.length) {
        const i = stack.pop()!, x = i % g.w, y = Math.floor(i / g.w);
        for (const [nx, ny] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) if (blk(nx, ny) && !seen.has(g.idx(nx, ny))) { seen.add(g.idx(nx, ny)); stack.push(g.idx(nx, ny)); }
      }
      // a reached block touching each target's cells (within one cell)
      const reached = (x0: number, y0: number, x1: number, y1: number) => {
        for (let y = y0 - 2; y <= y1 + 1; y++) for (let x = x0 - 2; x <= x1 + 1; x++) if (g.inBounds(x, y) && seen.has(g.idx(x, y))) return true;
        return false;
      };
      for (const d of doors.filter(q => !q.shopfront)) expect(reached(d.x, d.y, d.x + d.w - 1, d.y + d.h - 1), `${s}: door ${d.id}`).toBe(true);
      // (the arcade's own holders: the station dresser's stock-room pieces keep their own placement rules)
      for (const p of mine) {
        if (!isLootHolderKind(p.kind) || p.host !== undefined) continue;
        const [x0, y0] = g.cellOf(p.x - p.hx, p.z - p.hz), [x1, y1] = g.cellOf(p.x + p.hx - 0.01, p.z + p.hz - 0.01);
        expect(reached(x0, y0, x1, y1), `${s}: ${p.kind} at ${p.x},${p.z} reachable`).toBe(true);
      }
      void sf; void CELL;
    }
  }, 600_000);

  it('physics: heavy coin-ops static, light prizes / loose boxes dynamic with plausible masses, on-top decor on static hosts', () => {
    for (const k of [ARCADE_FLOOR_KINDS.cabinet, ARCADE_FLOOR_KINDS.claw, ARCADE_FLOOR_KINDS.airHockey, ARCADE_FLOOR_KINDS.pinball, ARCADE_FLOOR_KINDS.token, ARCADE_FLOOR_KINDS.kiddie, ARCADE_FLOOR_KINDS.jukebox]) {
      expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
    }
    for (const k of [ARCADE_FLOOR_KINDS.teddy, ARCADE_FLOOR_KINDS.gumball, 'storageTote', 'cardboardBoxFlaps']) {
      const r = PROP_PHYSICS_AUDIT[k];
      expect(r?.cls, k).toBe('dynamic');
      expect(r && r.cls === 'dynamic' ? r.mass : 0, k).toBeGreaterThan(1);
      expect(r && r.cls === 'dynamic' ? r.mass : 99, k).toBeLessThan(30);
    }
    for (const h of HITS) for (const p of storeProps(h.layout, h.anchor)) {
      expect(PROP_PHYSICS_AUDIT[p.kind], `${p.kind} classified`).toBeTruthy();
      if (p.host === undefined) continue;
      const host = h.layout.props[p.host];
      expect(host, `seed ${h.seed}: ${p.kind} host`).toBeTruthy();
      expect(PROP_PHYSICS_AUDIT[host.kind]?.cls, `seed ${h.seed}: ${p.kind} on ${host.kind}`).toBe('static');
      expect(p.y, `seed ${h.seed}: ${p.kind} supported`).toBeGreaterThan(host.y);
      expect(p.y, `seed ${h.seed}: ${p.kind} on its host top`).toBeLessThanOrEqual(host.y + host.h + 0.01);
    }
  });

  it('back rooms are stocked: shelving, openable storage, the technician\'s pieces', () => {
    for (const h of HITS) {
      const l = h.layout;
      expect(h.anchor.stock.length, `seed ${h.seed}`).toBeGreaterThanOrEqual(1);
      for (const id of h.anchor.stock) {
        const ps = l.props.filter(p => p.area === id), s = `seed ${h.seed} ${l.areas[id].type}`;
        expect(ps.length, s).toBeGreaterThanOrEqual(4);
        expect(ps.filter(p => ['openable', 'existing'].includes(AUDIT.get(p.kind)?.cls ?? '')).length, `${s}: openable storage`).toBeGreaterThanOrEqual(2);
        if (l.areas[id].type === 'stock-room') expect(ps.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `${s}: shelving`).toBe(true);
      }
    }
  });

  it('finish: a dark arcade — night-blue carpet, dark walls with a violet rail, the ceiling painted out', () => {
    const st = ANCHOR_STYLES.arcade;
    expect(st).toEqual(anchorStyleOf(STORE_ARCADE.finish!));
    const lum = (c: number) => (0.2126 * ((c >> 16) & 255) + 0.7152 * ((c >> 8) & 255) + 0.0722 * (c & 255)) / 255;
    expect(st.floor.kind).toBe('carpet');
    expect(st.ceiling.kind).toBe('raw');
    expect(lum(st.ceiling.tint!)).toBeLessThan(0.1);
    expect(lum(st.wall.paint)).toBeLessThan(0.15);
    expect(lum(st.floor.tint!)).toBeLessThan(0.15);
    expect((st.floor.tint! & 255) > ((st.floor.tint! >> 16) & 255)).toBe(true); // blue over red: the night sky
  });

  it('the Mall models it places are registered for Skyways (STORE_ARCADE_MALL_MODELS)', () => {
    const files = new Set(STORE_ARCADE_MALL_MODELS);
    for (const h of HITS) for (const p of storeProps(h.layout, h.anchor)) {
      const id = (MALL_KIND_ASSET as Record<string, string | undefined>)[p.kind];
      if (id) expect(files.has(`mall-${id}.glb`), `${p.kind} -> mall-${id}.glb`).toBe(true);
    }
  });

  it('deterministic; the prize-car add-on and its prize kinds are untouched by the arcade', () => {
    const h = HITS[0];
    const again = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const sig = (l: StationLayout) => JSON.stringify(ARCADE_LAST.get(l)!.props.map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.purpose ?? '']));
    expect(sig(again)).toBe(sig(h.layout));
    for (const x of HITS) for (const p of ARCADE_LAST.get(x.layout)!.props) expect(p.kind.startsWith('skywaysPrize'), p.kind).toBe(false);
  }, 600_000);
});
