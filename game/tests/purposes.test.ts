// Iteration 05 (Lane R): room / store PURPOSE registry and its use by the level generator.
import {describe, expect, it} from 'vitest';
import {generateStation, type Area, type StationLayout} from '../src/gen/station';
import {FLOOR} from '../src/gen/grid';
import {
  PROP_DEFS, PURPOSE_HOLDER_KINDS, PURPOSE_SURFACES, SHOP_COOLER_SURFACES, SHOP_DISPLAY_CASE, SHOP_DISPLAY_SURFACES,
  isPurposePropKind, type PropKind, type PropPlacement,
} from '../src/gen/props';
import {
  ALL_PURPOSES, ROOM_PURPOSES, STORE_PURPOSES, assignRoomPurposes, purposeById, purposeLoot,
  type RoomSlot, type StorePurpose,
} from '../src/gen/purposes';
import {STOCK_THEMES, stockVariant} from '../src/gen/purposeShapes';
import {ITEMS} from '../src/items/items';
import {createHolderState, isContainerKind, isLootHolderKind, rollLootItems, type HolderKind} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';

const SEEDS = Array.from({length: 14}, (_, i) => (i * 2654435761 + 777) >>> 0);
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => { let l = cache.get(seed); if (!l) cache.set(seed, (l = generateStation(seed))); return l; };
const SAMPLE = () => SEEDS.map(gen);

const FOOD = new Set(['chocolate', 'chips', 'beans', 'noodles']);
const DRINK = new Set(['water', 'cola', 'juice']);
const MED = new Set(['bandage', 'medkit']);
const isAmmo = (id: string) => id.startsWith('ammo_');

/** Holder contents exactly as world/containers.ts rolls them (index per group, purpose key). */
function rolledLots(l: StationLayout): {p: PropPlacement; items: string[]}[] {
  let ci = 0, si = 0;
  const out: {p: PropPlacement; items: string[]}[] = [];
  for (const p of l.props) {
    if (!isLootHolderKind(p.kind)) continue;
    const kind = p.kind as HolderKind;
    const index = isContainerKind(kind) ? ci++ : si++;
    const a = l.areas[p.area];
    const st = createHolderState(l.seed, index, kind, p.purpose ?? a.purpose ?? a.type, holderSurfaces(kind, PROP_DEFS[kind]));
    out.push({p, items: st.lots.map(x => x.itemId)});
  }
  return out;
}

function itemsOf(spec: {items: readonly (readonly [string, number])[]} | undefined): Set<string> {
  return new Set((spec?.items ?? []).map(r => r[0]));
}

describe('purpose registry (data validity)', () => {
  it('every purpose references real props, holders, items and slots', () => {
    for (const P of ALL_PURPOSES) {
      for (const [holder, spec] of Object.entries(P.loot)) {
        if (holder !== 'default') expect(isLootHolderKind(holder), `${P.id} loot holder ${holder}`).toBe(true);
        for (const [id, w] of spec!.items) {
          expect(ITEMS[id], `${P.id}/${holder} item ${id}`).toBeDefined();
          expect(w).toBeGreaterThan(0);
        }
        if (spec!.lots) expect(spec!.lots[0]).toBeLessThanOrEqual(spec!.lots[1]);
      }
      if (P.light) expect(P.light.reduce((a, b) => a + b, 0)).toBeGreaterThan(0.99);
      if (P.stock) expect(STOCK_THEMES).toContain(P.stock);
    }
    for (const P of Object.values(ROOM_PURPOSES)) {
      expect(P.slots.length, P.id).toBeGreaterThan(0);
      for (const r of P.props) {
        expect(PROP_DEFS[r.kind], `${P.id} prop ${r.kind}`).toBeDefined();
        expect(r.n[0]).toBeLessThanOrEqual(r.n[1]);
        // Loot holders a room places have a loot entry (or deliberately fall back to its other rows).
        if (isLootHolderKind(r.kind)) expect(purposeLoot(P.id, r.kind), `${P.id} ${r.kind} has loot`).toBeDefined();
      }
    }
    for (const P of Object.values(STORE_PURPOSES)) {
      expect(P.names.length, P.id).toBeGreaterThanOrEqual(3);
      expect(P.colors.length).toBeGreaterThan(0);
      if (P.category === 'food') {
        expect(P.menu, `${P.id} menu`).toBeDefined();
        expect(P.kitchen?.length, `${P.id} kitchen`).toBeGreaterThan(0);
        for (const [k] of P.kitchen!) expect(PROP_DEFS[k]).toBeDefined();
      }
      for (const r of P.extras ?? []) expect(PROP_DEFS[r.kind]).toBeDefined();
    }
    // Holder kinds and their measured surfaces agree.
    expect(Object.keys(PURPOSE_SURFACES).sort()).toEqual([...PURPOSE_HOLDER_KINDS].sort());
    for (const k of PURPOSE_HOLDER_KINDS) {
      const d = PROP_DEFS[k];
      for (const s of PURPOSE_SURFACES[k]) {
        expect(Math.max(Math.abs(s.x0), Math.abs(s.x1)), k).toBeLessThanOrEqual(d.w / 2);
        expect(Math.max(Math.abs(s.z0), Math.abs(s.z1)), k).toBeLessThanOrEqual(d.d / 2);
        expect(s.y + s.clear, k).toBeLessThanOrEqual(d.h);
      }
    }
  });

  it('loot is plausible for what the place is (no armory in every shop)', () => {
    for (const P of Object.values(STORE_PURPOSES)) {
      const all = new Set(Object.values(P.loot).flatMap(s => [...itemsOf(s)]));
      for (const id of all) expect(isAmmo(id), `${P.id} sells ${id}`).toBe(false);
      if (P.category === 'food') for (const id of all) expect(FOOD.has(id) || DRINK.has(id), `${P.id}: ${id}`).toBe(true);
    }
    const only = (id: string, ok: (x: string) => boolean) => {
      for (const x of Object.values(purposeById(id)!.loot).flatMap(s => [...itemsOf(s)])) expect(ok(x), `${id}: ${x}`).toBe(true);
    };
    only('florist', x => x === 'water');
    only('tech', x => FOOD.has(x) || DRINK.has(x));
    only('pharmacy', x => MED.has(x) || DRINK.has(x));
    only('newsstand', x => FOOD.has(x) || DRINK.has(x));
    only('convenience', x => FOOD.has(x) || DRINK.has(x));
    only('janitor-closet', x => !isAmmo(x));
    only('first-aid-room', x => MED.has(x) || DRINK.has(x));
    // Gun lockers: ammo (and the odd first-aid kit), never food.
    for (const x of itemsOf(ROOM_PURPOSES['security-office'].loot.gunLocker)) expect(isAmmo(x) || x === 'medkit').toBe(true);
    const rolled = Array.from({length: 120}, (_, i) => rollLootItems(5, i, 'gunLocker', 'security-office')).flat();
    expect(rolled.filter(e => isAmmo(e.itemId)).length / rolled.length).toBeGreaterThan(0.85);
    // Pharmacy shelves are mostly dressings; cooler in a juice bar is juice-heavy.
    const ph = Array.from({length: 120}, (_, i) => rollLootItems(6, i, 'stockShelf', 'pharmacy')).flat();
    expect(ph.filter(e => MED.has(e.itemId)).length / ph.length).toBeGreaterThan(0.75);
  });

  it('assigns every back-of-house slot a purpose: required first, caps, sizes, variety', () => {
    const slots: RoomSlot[] = [
      {id: 0, type: 'agent-office', kind: 'room', wing: 'agent', wM: 6, hM: 5},
      ...['crew-room', 'storage', 'utility', 'storage', 'utility', 'crew-room', 'stock-room'].map((type, i) => ({id: i + 1, type: type as RoomSlot['type'], kind: 'room' as const, wing: 'misc' as const, wM: 6, hM: 5.5})),
      ...['janitor-closet', 'supply-closet', 'supply-closet'].map((type, i) => ({id: 20 + i, type: type as RoomSlot['type'], kind: 'closet' as const, wing: 'misc' as const, wM: 3, hM: 3})),
    ];
    for (let seed = 0; seed < 30; seed++) {
      let s = seed + 1;
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
      const m = assignRoomPurposes(slots, rnd);
      expect(m.size).toBe(slots.length);
      const ids = [...m.values()];
      for (const req of ['agent-office', 'staff-room', 'security-office', 'electrical-room', 'janitor-closet']) expect(ids, `seed ${seed}`).toContain(req);
      for (const [slot, pid] of m) {
        const sl = slots.find(x => x.id === slot)!;
        expect(ROOM_PURPOSES[pid].slots).toContain(sl.type);
        expect(ROOM_PURPOSES[pid].kinds).toContain(sl.kind);
      }
      expect(new Set(ids).size).toBeGreaterThanOrEqual(8);
      for (const pid of new Set(ids)) expect(ids.filter(x => x === pid).length).toBeLessThanOrEqual(ROOM_PURPOSES[pid].max ?? 2);
    }
  });
});

describe('purposes in generated levels', () => {
  it('is deterministic per seed (purposes, labels, store uses)', () => {
    const a = generateStation(31337), b = generateStation(31337);
    expect(a.areas.map(x => [x.purpose, x.label])).toEqual(b.areas.map(x => [x.purpose, x.label]));
    expect(a.storefronts.map(s => s.use)).toEqual(b.storefronts.map(s => s.use));
    expect(a.props.map(p => [p.kind, p.variant, p.purpose])).toEqual(b.props.map(p => [p.kind, p.variant, p.purpose]));
  });

  it('every back-of-house room, closet and corridor has a purpose with its signature fixture', () => {
    const SIGNATURE: Record<string, PropKind[]> = {
      'staff-room': ['kitchenette', 'fridge'], 'locker-room': ['staffLockers'], 'first-aid-room': ['medCabinet'],
      'security-office': ['gunLocker'], 'electrical-room': ['electricalPanel'], 'signal-room': ['signalRack'],
      'janitor-closet': ['mopSink'], 'electrical-closet': ['electricalPanel'], 'stock-room': ['stockShelf'],
      'storage': ['stockShelf', 'shelf'], 'supply-closet': ['stockShelf', 'medCabinet'], 'agent-office': ['desk'],
    };
    let rooms = 0, signed = 0;
    for (const l of SAMPLE()) {
      for (const a of l.areas) {
        if (a.storefront !== undefined || (a.publicSpace && a.type !== 'washroom')) continue;
        expect(a.purpose, `${l.seed} ${a.type} ${a.label}`).toBeDefined();
        expect(ROOM_PURPOSES[a.purpose!].slots).toContain(a.type);
        const sig = SIGNATURE[a.purpose!];
        if (!sig) continue;
        rooms++;
        if (l.props.some(p => p.area === a.id && sig.includes(p.kind))) signed++;
      }
      // One security office with a gun locker, a staff room with its kitchen, a janitor closet with a mop sink.
      const has = (pid: string, k: PropKind) => l.areas.some(a => a.purpose === pid && l.props.some(p => p.area === a.id && p.kind === k));
      expect(has('security-office', 'gunLocker'), `${l.seed} gun locker`).toBe(true);
      expect(has('staff-room', 'kitchenette') || has('staff-room', 'fridge'), `${l.seed} staff kitchen`).toBe(true);
      expect(has('janitor-closet', 'mopSink'), `${l.seed} mop sink`).toBe(true);
      // Gun lockers only in the security office.
      for (const p of l.props.filter(q => q.kind === 'gunLocker')) expect(l.areas[p.area].purpose).toBe('security-office');
    }
    expect(signed / rooms).toBeGreaterThan(0.95);
  });

  it('store names, fixtures and stock all come from the same purpose', () => {
    const BASE = new Set<string>(['shopCounter', 'shopDisplay', 'shopCooler', 'shopBackbar', 'shopGlazing', 'shopShutter']);
    const LAYOUT: Record<StorePurpose['layout'], PropKind[]> = {
      food: [], aisles: ['stockShelf', 'snackRack'], newsstand: ['magazineRack', 'stockShelf', 'snackRack'],
      showroom: ['showcase', 'deviceWall', 'techDisplay'], service: ['stockShelf'], florist: ['flowerStand'],
    };
    const SIGN: Record<StorePurpose['layout'], PropKind[]> = {
      food: [], aisles: ['stockShelf'], newsstand: ['magazineRack', 'stockShelf'], showroom: ['deviceWall', 'techDisplay', 'showcase'],
      service: ['repairBench', 'stockShelf'], florist: ['flowerStand'],
    };
    let units = 0, signed = 0;
    for (const l of SAMPLE()) {
      const lots = rolledLots(l);
      for (const sf of l.storefronts) {
        if (sf.unit < 0) continue;
        const P = STORE_PURPOSES[sf.use];
        const unit = l.areas[sf.unit];
        expect(unit.purpose).toBe(sf.use);
        expect(P.names.some(n => sf.name === n) || sf.name.endsWith(P.names[0].split(' ').slice(-1)[0]), `${sf.name} is a ${sf.use} name`).toBe(true);
        const allowed = new Set<string>([...BASE, ...LAYOUT[P.layout], ...(P.kitchen ?? []).map(k => k[0]), ...(P.extras ?? []).map(r => r.kind)]);
        const props = l.props.filter(p => p.area === unit.id);
        for (const p of props) {
          expect(allowed.has(p.kind), `${l.seed} ${sf.name} (${sf.use}) has a ${p.kind}`).toBe(true);
          if (p.kind === 'stockShelf') {
            const ok = [P.stock ? stockVariant(P.stock) : -1, sf.use === 'convenience' ? stockVariant('snacks') : -1];
            expect(ok, `${sf.name} shelf theme`).toContain(p.variant);
          }
        }
        if (sf.shutter !== 'closed') {
          units++;
          const sig = P.layout === 'food' ? [...(P.kitchen ?? []).map(k => k[0]), 'shopCooler'] : SIGN[P.layout];
          if (props.some(p => sig.includes(p.kind))) signed++;
        }
        // Stock matches the sign: every rolled item comes from this purpose's tables.
        const stocked = new Set(Object.values(P.loot).flatMap(s => [...itemsOf(s)]));
        for (const h of lots.filter(x => x.p.area === unit.id)) for (const id of h.items) expect(stocked.has(id), `${sf.name} (${sf.use}) holds ${id}`).toBe(true);
      }
      // Purpose props in food units: the cuisine's own back line (pizza oven only in pizzerias …).
      for (const p of l.props) {
        if (!['pizzaOven', 'espressoBar', 'wokLine', 'blenderBar', 'grillLine', 'deliLine'].includes(p.kind)) continue;
        const a = l.areas[p.area];
        const P = STORE_PURPOSES[a.purpose as keyof typeof STORE_PURPOSES];
        expect(P?.kitchen?.some(k => k[0] === p.kind), `${p.kind} in ${a.label}`).toBe(true);
      }
    }
    expect(signed / units).toBeGreaterThan(0.9);
  });

  it('holders never carry implausible loot in the built level', () => {
    for (const l of SAMPLE()) {
      for (const {p, items} of rolledLots(l)) {
        const a = l.areas[p.area];
        const pid = p.purpose ?? a.purpose;
        if (pid && STORE_PURPOSES[pid as keyof typeof STORE_PURPOSES]) for (const id of items) expect(isAmmo(id), `${pid} ${p.kind} ${id}`).toBe(false);
        if (p.kind === 'gunLocker') for (const id of items) expect(FOOD.has(id) || DRINK.has(id), `gun locker ${id}`).toBe(false);
        if (p.kind === 'shopCooler') for (const id of items) expect(DRINK.has(id), `cooler ${id}`).toBe(true);
      }
    }
  });

  it('walkways: islands keep >= 0.9 m clear all round, holder fronts and doors stay open', () => {
    for (const l of SAMPLE()) {
      const g = l.grid;
      const free = (x: number, z: number) => { const [cx, cy] = g.cellOf(x, z); return g.walkable(cx, cy); };
      for (const p of l.props) {
        const a: Area = l.areas[p.area];
        const island = p.kind === 'techDisplay' || (p.kind === 'table' && !a.publicSpace) || (p.kind === 'bench' && a.purpose === 'locker-room' && !touchesWall(l, p));
        if (island) {
          // Sample the walkway 0.55 m and 0.95 m out from every side (past the island's own grid cell).
          for (const off of [0.55, 0.95]) {
            for (let t = -1; t <= 1; t += 0.5) {
              expect(free(p.x + (p.hx + off), p.z + t * p.hz), `${l.seed} ${p.kind} E`).toBe(true);
              expect(free(p.x - (p.hx + off), p.z + t * p.hz), `${l.seed} ${p.kind} W`).toBe(true);
              expect(free(p.x + t * p.hx, p.z + (p.hz + off)), `${l.seed} ${p.kind} S`).toBe(true);
              expect(free(p.x + t * p.hx, p.z - (p.hz + off)), `${l.seed} ${p.kind} N`).toBe(true);
            }
          }
        }
        if (isPurposePropKind(p.kind) && PURPOSE_HOLDER_KINDS.includes(p.kind as never) && p.y === 0) {
          // The first grid cell past a holder's front face is open floor (you can reach it).
          const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
          const d = (fx ? p.hx : p.hz) + 0.55;
          expect(free(p.x + fx * d, p.z + fz * d), `${l.seed} ${p.kind} front in ${l.areas[p.area].label}`).toBe(true);
        }
      }
      // Door cells and the cells just inside each side stay walkable.
      for (const d of l.doors) {
        if (d.fare || d.shopfront) continue;
        const horiz = d.h === 1;
        for (let k = 0; k < (horiz ? d.w : d.h); k++) {
          const x = horiz ? d.x + k : d.x, y = horiz ? d.y : d.y + k;
          for (const s of [-1, 0, 1]) expect(g.walkable(horiz ? x : x + s, horiz ? y + s : y), `${l.seed} door ${d.id}`).toBe(true);
        }
      }
    }
  });

  it('varies: many distinct purposes per level, few repeats, variety across seeds', () => {
    const backSets: number[] = [], storeSets: number[] = [];
    const seenStores = new Set<string>(), seenBack = new Set<string>();
    for (const l of SAMPLE()) {
      const back = l.areas.filter(a => a.purpose && !STORE_PURPOSES[a.purpose as keyof typeof STORE_PURPOSES] && a.purpose !== 'washroom' && a.purpose !== 'service-corridor').map(a => a.purpose!);
      backSets.push(new Set(back).size);
      back.forEach(b => seenBack.add(b));
      const uses = l.storefronts.filter(s => s.unit >= 0).map(s => s.use);
      storeSets.push(new Set(uses).size);
      uses.forEach(u => seenStores.add(u));
      // Balanced ("deck") choice: no purpose repeats much more than the frontage count forces.
      const cap = Math.max(2, Math.ceil(l.storefronts.length / Object.keys(STORE_PURPOSES).length) + 1);
      for (const u of new Set(uses)) expect(uses.filter(x => x === u).length, `${l.seed} ${u} repeats`).toBeLessThanOrEqual(cap);
    }
    expect(Math.min(...backSets)).toBeGreaterThanOrEqual(7);
    expect(Math.min(...storeSets)).toBeGreaterThanOrEqual(6);
    expect(seenStores.size).toBeGreaterThanOrEqual(16);
    expect(seenBack.size).toBe(Object.keys(ROOM_PURPOSES).length - 2);
  });

  it('coolers / display cases: loot sits on the measured open-front shelves (Lane A), never in front of the glass', () => {
    const cool = holderSurfaces('shopCooler', PROP_DEFS.shopCooler);
    expect(cool.map(s => Math.round((s.y - 0.002) * 100) / 100)).toEqual([0.26, 0.66, 1.06, 1.46]);
    for (const s of cool) {
      expect(s.z1).toBeLessThanOrEqual(0.263);
      expect(s.y + s.clear).toBeLessThanOrEqual(1.7);
      expect(Math.max(-s.x0, s.x1)).toBeLessThanOrEqual(0.3);
    }
    expect(cool[3].clear).toBeLessThanOrEqual(0.22);
    const disp = holderSurfaces('shopDisplay', PROP_DEFS.shopDisplay);
    expect(disp.map(s => Math.round((s.y - 0.002 - SHOP_DISPLAY_CASE.baseY) * 1000) / 1000)).toEqual([0.22, 0.432]);
    for (const [i, s] of disp.entries()) {
      const spec = SHOP_DISPLAY_SURFACES[i];
      expect(s.y + s.clear).toBeLessThanOrEqual(SHOP_DISPLAY_CASE.baseY + SHOP_DISPLAY_CASE.h);
      expect(s.x1).toBe(spec.x1);
    }
    expect(SHOP_COOLER_SURFACES.length).toBe(4);
  });
});

function touchesWall(l: StationLayout, p: PropPlacement): boolean {
  const g = l.grid;
  for (const [dx, dz] of [[p.hx + 0.3, 0], [-p.hx - 0.3, 0], [0, p.hz + 0.3], [0, -p.hz - 0.3]]) {
    const [cx, cy] = g.cellOf(p.x + dx, p.z + dz);
    if (g.cells[g.idx(cx, cy)] !== FLOOR) return true;
  }
  return false;
}
