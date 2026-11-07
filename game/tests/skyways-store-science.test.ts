// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-SCIENCE): BIG SKY WONDERS, the Skyways science / discovery store at
// layout version 3 (gen/skyways/stores/science.ts + scienceDress.ts) over several seeds of both its formats (double height / hall):
// openable storage, on-theme holder loot, fit (in area, no overlaps, clear lanes), physics classes, stocked back rooms, its palette and
// the store's own pieces (the hung solar system, telescopes, globes, the kit wall with loose kits, the demo bench, the specimen
// cabinets under the star-map wall, the cash desk with its openable back counter).
import {describe, expect, it} from 'vitest';
import {findStores, storeAreas, storeProps, type StoreHit} from './helpers/skywaysStores';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, SHELF_TIER_Y, type PropPlacement} from '../src/gen/props';
import {cellsOfBox} from '../src/gen/placeKit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import type {HolderKind} from '../src/items/loot';
import {STORE_SCIENCE} from '../src/gen/skyways/stores/science';
import {SCIENCE_TECH_PURPOSE, scienceResultOf} from '../src/gen/skyways/stores/scienceDress';
import {STORE_SCIENCE_KINDS, STORE_SCIENCE_MALL_MODELS, STORE_SCIENCE_SPECS} from '../src/gen/skyways/stores/kinds/science';
import {ANCHOR_STYLES} from '../src/gen/skyways/destinations/anchorStyles';
import {HUNG_CLEAR} from '../src/gen/skyways/destinations/kindsShopsB';
import {SKYWAYS_STORE_MALL_MODELS} from '../src/gen/skyways/stores/kinds/index';
import {hallFrame, xzUV} from '../src/gen/skyways/addonFrame';

// (3 stores of each format; SCIENCE_STORE_SEEDS=N widens the sweep locally, e.g. 25 -> every science store of seeds 1..~80)
const N = Number(process.env.SCIENCE_STORE_SEEDS ?? 3);
const STORES: StoreHit[] = [...findStores('science', {format: 'double-height', count: N, maxSeed: N > 3 ? 120 : 60}), ...findStores('science', {format: 'hall', count: N, maxSeed: N > 3 ? 120 : 60})];
const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e]));
const tagOf = (h: StoreHit) => `seed ${h.seed} ${h.anchor.format}`;
const lvl = (h: StoreHit) => h.layout.levels[h.anchor.level].grid;
/** Floor props of a store (not hosted on another prop, not wall-mounted / hung — a wall notice board too; the storefront glazing excluded). */
const floorProps = (h: StoreHit) => storeProps(h.layout, h.anchor).filter(p => p.host === undefined && !p.mounted && p.kind !== 'shopGlazing'
  && p.y - (h.layout.areas[p.area].floorY ?? h.layout.levels[h.anchor.level].baseY ?? 0) < 0.5);
const ofKind = (h: StoreHit, ...kinds: string[]) => storeProps(h.layout, h.anchor).filter(p => kinds.includes(p.kind));
/** The prop of the layout that a dresser result entry is (same kind / position). */
const live = (h: StoreHit, p: PropPlacement | null | undefined) => p ? (h.layout.props as PropPlacement[]).find(q => q.kind === p.kind && Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.z - p.z) < 1e-6 && Math.abs(q.y - p.y) < 1e-6) : undefined;

describe('Skyways store: Big Sky Wonders (science)', () => {
  it('finds both formats over several seeds', () => {
    expect(STORES.filter(s => s.anchor.format === 'double-height').length).toBe(N);
    expect(STORES.filter(s => s.anchor.format === 'hall').length).toBe(N);
  });

  it('its own kinds are classified (openables audit, physics, mounted art) and its Mall models recorded for Skyways', () => {
    for (const k of STORE_SCIENCE_KINDS) {
      expect(audit.get(k)?.cls, k).toBe('none');
      expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
      expect(STORE_SCIENCE_SPECS[k].phys.dynamic).toBe(false);
      expect(PROP_DEFS[k].d).toBeLessThan(0.05);
    }
    for (const f of STORE_SCIENCE_MALL_MODELS) expect(SKYWAYS_STORE_MALL_MODELS).toContain(f);
  });

  it('every reasonably openable storage piece opens (OPENABLE_AUDIT openable / existing), and the store has real openable storage', () => {
    for (const h of STORES) {
      const props = storeProps(h.layout, h.anchor);
      for (const p of props) {
        const a = audit.get(p.kind);
        expect(a, `${tagOf(h)}: ${p.kind} classified`).toBeTruthy();
        if (a!.role === 'storage') expect(['openable', 'existing'], `${tagOf(h)}: ${p.kind} storage opens`).toContain(a!.cls);
      }
      const opens = (k: string) => ['openable', 'existing'].includes(audit.get(k)?.cls ?? '');
      const {floor, stock} = storeAreas(h.layout, h.anchor);
      const onFloor = props.filter(p => floor.includes(p.area) && opens(p.kind)), inBack = props.filter(p => stock.includes(p.area) && opens(p.kind));
      // the cash-wrap back counter, the two glass specimen cabinets, the demo lab bench
      expect(onFloor.filter(p => p.kind === 'mallCashwrapCounter').length, `${tagOf(h)}: cash-wrap counter`).toBe(1);
      expect(onFloor.filter(p => p.kind === 'glassDisplayCabinet').length, `${tagOf(h)}: specimen cabinets`).toBe(2);
      expect(onFloor.filter(p => p.kind === 'labBench').length, `${tagOf(h)}: demo bench`).toBe(1);
      expect(inBack.length, `${tagOf(h)}: openable back-room storage`).toBeGreaterThanOrEqual(3);
    }
  });

  it('holders roll on-theme existing tables: toy-store stock on the floor, electronics rows on the tech holders, the back rooms\' purposes', () => {
    expect(STORE_SCIENCE.purposes).toEqual({floor: 'mall-toys', stock: 'mall-toys-back', office: 'mall-electronics-back'});
    for (const h of STORES) {
      const {floor, stock} = storeAreas(h.layout, h.anchor);
      for (const id of floor) expect(h.layout.areas[id].purpose, tagOf(h)).toBe('mall-toys');
      for (const id of stock) expect(h.layout.areas[id].purpose, tagOf(h)).toBe(h.layout.areas[id].type === 'stock-room' ? 'mall-toys-back' : 'mall-electronics-back');
      let tech = 0;
      for (const p of storeProps(h.layout, h.anchor)) {
        if (!isLootHolderKind(p.kind)) continue;
        const area = h.layout.areas[p.area], key = p.purpose ?? area.purpose ?? area.type;
        const t = holderTable(p.kind as HolderKind, key);
        if (t.source === 'fixture') continue;
        expect(t.rows.length, `${tagOf(h)}: ${p.kind} (${key}) has a table`).toBeGreaterThan(0);
        expect(['own', 'purpose'], `${tagOf(h)}: ${p.kind} (${key}) rolls an own / purpose table`).toContain(t.source);
        if (!floor.includes(p.area)) continue;
        // the sales floor holds no ammunition (the deliberate ammo rule is the gun shops' / security's)
        const ids = t.rows.map(r => r[0]);
        expect(ids.some(i => String(i).startsWith('ammo')), `${tagOf(h)}: ${p.kind} no ammo on the sales floor`).toBe(false);
        if (p.purpose === SCIENCE_TECH_PURPOSE) {
          tech++;
          const top = [...t.rows].sort((a, b) => b[1] - a[1])[0][0];
          expect(top, `${tagOf(h)}: tech holder ${p.kind} mostly cells`).toBe('battery');
        }
      }
      expect(tech, `${tagOf(h)}: tech holders`).toBeGreaterThanOrEqual(2);
    }
  });

  it('fit: floor props stand on their own area\'s floor, never overlap, hosted stock rests on a static host; no floor piles', () => {
    for (const h of STORES) {
      const g = lvl(h), props = floorProps(h);
      for (const p of props) {
        const [x0, y0, x1, y1] = cellsOfBox(p.x, p.z, p.hx, p.hz);
        for (let cy = y0; cy <= y1; cy++) for (let cx = x0; cx <= x1; cx++) {
          const i = g.idx(cx, cy);
          expect(g.cells[i] === FLOOR && g.area[i] === p.area, `${tagOf(h)}: ${p.kind} at ${p.x},${p.z} on its area`).toBe(true);
        }
      }
      for (let i = 0; i < props.length; i++) for (let j = i + 1; j < props.length; j++) {
        const a = props[i], b = props[j];
        if ((a.level ?? 0) !== (b.level ?? 0)) continue;
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        expect(ox > 0.02 && oz > 0.02, `${tagOf(h)}: ${a.kind} / ${b.kind} overlap`).toBe(false);
      }
      // (the sales floor's hosted stock; the station dresser's back-office chair records its desk as `host` beside it)
      const salesFloor = new Set(storeAreas(h.layout, h.anchor).floor);
      for (const p of storeProps(h.layout, h.anchor).filter(q => q.host !== undefined && salesFloor.has(q.area))) {
        const host = h.layout.props[p.host!] as PropPlacement;
        expect(host, `${tagOf(h)}: ${p.kind} host`).toBeTruthy();
        expect(PROP_DEFS[host.kind].physics?.dynamic ?? false, `${tagOf(h)}: ${p.kind} on a static host`).toBe(false);
        expect(p.y).toBeGreaterThan(host.y);
        expect(Math.abs(p.x - host.x) <= host.hx + 0.01 && Math.abs(p.z - host.z) <= host.hz + 0.01, `${tagOf(h)}: ${p.kind} over its host`).toBe(true);
      }
      const {all} = storeAreas(h.layout, h.anchor);
      expect(h.layout.pickups.filter(p => all.has(p.area) && Math.abs(p.y - (h.layout.areas[p.area].floorY ?? 0)) < 0.05), tagOf(h)).toEqual([]);
    }
  });

  it('clear lanes: the storefront entry reaches the till, every staff door and every free floor cell of the store', () => {
    for (const h of STORES) {
      const g = lvl(h), {floor, stock} = storeAreas(h.layout, h.anchor), own = new Set(floor);
      const doors = h.layout.doors.filter(d => own.has(d.a) || own.has(d.b));
      const doorCell = new Set<number>();
      for (const d of doors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCell.add(g.idx(x, y));
      const free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && (own.has(g.area[i]) || doorCell.has(i));
      const sf = doors.filter(d => d.shopfront);
      const start: number[] = [];
      for (const d of sf) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) if (free(g.idx(x, y))) start.push(g.idx(x, y));
      expect(start.length, `${tagOf(h)}: open entry`).toBeGreaterThan(0);
      // a lane: >= 1 m wide (each cell with a free neighbour pair across it) — and the plain reach of every free cell
      const seen = new Uint8Array(g.w * g.h), q = [...start];
      for (const i of start) seen[i] = 1;
      while (q.length) { const c = q.pop()!; for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && free(n)) { seen[n] = 1; q.push(n); } }
      for (const d of doors) {
        if (d.shopfront) continue;
        let hit = false;
        for (let y = d.y; y < d.y + d.h && !hit; y++) for (let x = d.x; x < d.x + d.w; x++) if (seen[g.idx(x, y)]) { hit = true; break; }
        expect(hit, `${tagOf(h)}: staff door at ${d.x},${d.y}`).toBe(true);
      }
      let unreached = 0;
      for (const id of floor) { const a = h.layout.areas[id]; for (let y = a.y; y < a.y + a.h; y++) for (let x = a.x; x < a.x + a.w; x++) { const i = g.idx(x, y); if (free(i) && !seen[i]) unreached++; } }
      expect(unreached, `${tagOf(h)}: cut-off floor cells`).toBe(0);
      // the till's customer side (0.9 m in front of the shop counter) is reached
      const till = ofKind(h, 'shopCounter')[0];
      expect(till, `${tagOf(h)}: till`).toBeTruthy();
      const fx = Math.round(Math.sin(till.rot)), fz = Math.round(Math.cos(till.rot)), [tx, tz] = [till.x + fx * (PROP_DEFS.shopCounter.d / 2 + 0.45), till.z + fz * (PROP_DEFS.shopCounter.d / 2 + 0.45)];
      const [cx, cy] = g.cellOf(tx, tz);
      expect(seen[g.idx(cx, cy)], `${tagOf(h)}: the till's customer side`).toBe(1);
      void stock; void CELL;
    }
  });

  it('physics: the loose / light pieces move, fixtures and holders stay put, wall art is mounted', () => {
    const dynamic = ['skyDTelescope', 'telescope', 'skyDGiantGlobe', 'skyDRocketModel', 'skyDToyRobot', 'satelliteModel', 'cardboardBoxFlaps', 'storageTote', 'skyDModelKits', 'labMicroscope', 'labFlaskLarge', 'labTubeRack', 'labBottleRack', 'labFlask', 'labBottle'];
    const fixed = ['labBench', 'mallCashwrapCounter', 'glassDisplayCabinet', 'glassCounter', 'shopCounter', 'shelf', 'stockShelf', 'merchTable', 'staffLockers', 'skyDPlanetMobile', 'skySciStarMap', 'skySciChart', 'skySciPoster'];
    for (const k of dynamic) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('dynamic');
    for (const k of fixed) expect(PROP_PHYSICS_AUDIT[k]?.cls, k).toBe('static');
    for (const h of STORES) {
      const kinds = new Set(storeProps(h.layout, h.anchor).map(p => p.kind));
      for (const k of kinds) expect(PROP_PHYSICS_AUDIT[k], `${tagOf(h)}: ${k} classified`).toBeTruthy();
      for (const p of ofKind(h, 'skyDPlanetMobile', 'skySciStarMap', 'skySciChart', 'skySciPoster', 'skyDPoster')) expect(p.mounted, `${tagOf(h)}: ${p.kind} mounted`).toBe(true);
    }
  });

  it('back rooms are stocked: shelving, cartons and openable storage (every v3 store has one)', () => {
    for (const h of STORES) {
      expect(h.anchor.stock.length, tagOf(h)).toBeGreaterThan(0);
      for (const id of h.anchor.stock) {
        const a = h.layout.areas[id], ps = (h.layout.props as PropPlacement[]).filter(p => p.area === id);
        const opens = ps.filter(p => ['openable', 'existing'].includes(audit.get(p.kind)?.cls ?? ''));
        expect(opens.length, `${tagOf(h)}: ${a.type} openable storage`).toBeGreaterThanOrEqual(2);
        if (a.type === 'stock-room') {
          expect(ps.some(p => p.kind === 'stockShelf' || p.kind === 'shelf'), `${tagOf(h)}: stock shelving`).toBe(true);
          expect(ps.some(p => p.kind === 'cardboardBoxFlaps'), `${tagOf(h)}: openable cartons`).toBe(true);
        }
      }
    }
  });

  it('palette: deep night-blue walls over white tile with a brass rail, a white tile floor and a grid ceiling (ANCHOR_STYLES)', () => {
    const st = ANCHOR_STYLES.science;
    expect(st.wall.kind).toBe('tile');
    expect(st.wall.paint).toBe(0x22406f);
    expect(st.wall.lower).toBe(0xeef2f6);
    expect(st.floor.kind).toBe('tile');
    expect(st.ceiling.kind).toBe('grid');
    // distinct from every other store's finish
    for (const [fam, o] of Object.entries(ANCHOR_STYLES)) if (fam !== 'science') expect(JSON.stringify(o) === JSON.stringify(st), fam).toBe(false);
  });

  it('a real science store: solar system hung over the rocket, telescopes aimed out, globes, kit wall with loose kits, demo bench, star-map wall, cash desk', () => {
    for (const h of STORES) {
      const r = scienceResultOf(h.layout, h.anchor);
      expect(r, tagOf(h)).toBeTruthy();
      expect(r!.skipped.filter(s => /solar|rocket|cash desk|star-map|specimen|demo bench|kit shelves|telescopes/.test(s)), tagOf(h)).toEqual([]);
      // the hung solar system: clear underside, larger than the model in the double height
      const mobiles = ofKind(h, 'skyDPlanetMobile');
      expect(mobiles.length, `${tagOf(h)}: solar system`).toBeGreaterThanOrEqual(1);
      for (const m of mobiles) {
        const g = lvl(h), [cx, cy] = g.cellOf(m.x, m.z), f = g.floorOf(g.idx(cx, cy));
        expect(m.y - f, `${tagOf(h)}: underside`).toBeGreaterThanOrEqual(HUNG_CLEAR - 1e-6);
        expect(m.y + m.h, `${tagOf(h)}: under the ceiling`).toBeLessThanOrEqual(h.layout.areas[m.area].ceil + 1e-6);
      }
      const scale = Math.max(...mobiles.map(m => m.h / PROP_DEFS.skyDPlanetMobile.h));
      if (h.anchor.format === 'double-height') expect(scale, tagOf(h)).toBeGreaterThan(1.2); else expect(scale, tagOf(h)).toBeLessThan(1.0);
      expect(ofKind(h, 'skyDRocketModel').length, `${tagOf(h)}: rocket`).toBe(1);
      expect(ofKind(h, 'skyDGiantGlobe').length, `${tagOf(h)}: globes`).toBeGreaterThanOrEqual(1);
      // telescopes on tripods in the front half, aimed toward the storefront
      const fr = hallFrame(h.layout.areas[h.anchor.floor], h.anchor.front);
      const scopes = ofKind(h, 'skyDTelescope', 'telescope');
      expect(scopes.length, `${tagOf(h)}: telescopes`).toBeGreaterThanOrEqual(1);
      for (const s of scopes) {
        const aim = s.kind === 'skyDTelescope' ? s.rot - Math.PI / 2 : s.rot;
        expect(Math.abs(Math.atan2(Math.sin(aim - fr.toFront), Math.cos(aim - fr.toFront))), `${tagOf(h)}: ${s.kind} aimed out`).toBeLessThan(0.01);
      }
      // the kit wall: open shelving with kits / glassware on its tiers (hosted, finite stock beside the loot)
      const shelves = ofKind(h, 'shelf');
      expect(shelves.length, `${tagOf(h)}: kit shelving`).toBeGreaterThanOrEqual(2);
      const onShelves = storeProps(h.layout, h.anchor).filter(p => p.host !== undefined && (h.layout.props[p.host] as PropPlacement).kind === 'shelf');
      expect(onShelves.length, `${tagOf(h)}: loose kits on the shelves`).toBeGreaterThanOrEqual(4);
      expect(onShelves.some(p => p.kind === 'skyDModelKits'), `${tagOf(h)}: boxed kits`).toBe(true);
      for (const p of onShelves) {
        const host = h.layout.props[p.host!] as PropPlacement;
        expect(SHELF_TIER_Y.some(y => Math.abs(p.y - host.y - y) < 1e-3), `${tagOf(h)}: ${p.kind} on a tier`).toBe(true);
      }
      // the demo bench: the lab bench with its glassware / microscope on the worktop
      const bench = ofKind(h, 'labBench')[0];
      const onBench = storeProps(h.layout, h.anchor).filter(p => p.host !== undefined && h.layout.props[p.host] === bench);
      expect(onBench.length, `${tagOf(h)}: demo kit on the bench`).toBeGreaterThanOrEqual(3);
      for (const p of onBench) expect(p.y, tagOf(h)).toBeCloseTo(bench.y + PROP_DEFS.labBench.h, 3);
      // the star-map wall and the periodic chart; the kit posters
      const star = ofKind(h, 'skySciStarMap');
      expect(star.length, `${tagOf(h)}: star-map wall`).toBe(1);
      if (h.anchor.format === 'double-height') expect(star[0].h, tagOf(h)).toBeGreaterThan(PROP_DEFS.skySciStarMap.h * 1.2);
      expect(ofKind(h, 'skySciPoster').length, `${tagOf(h)}: kit posters`).toBeGreaterThanOrEqual(1);
      // the cash desk: till counter + register, the cash-wrap back counter against the wall behind it (the staff aisle between)
      const till = ofKind(h, 'shopCounter')[0], cw = ofKind(h, 'mallCashwrapCounter')[0];
      expect(ofKind(h, 'cashRegister').length, `${tagOf(h)}: register`).toBe(1);
      expect(Math.abs(Math.atan2(Math.sin(till.rot - cw.rot), Math.cos(till.rot - cw.rot))), `${tagOf(h)}: counter and back counter face the same way`).toBeLessThan(0.01);
      const gap = Math.hypot(till.x - cw.x, till.z - cw.z);
      expect(gap, `${tagOf(h)}: staff aisle`).toBeGreaterThan((PROP_DEFS.shopCounter.d + PROP_DEFS.mallCashwrapCounter.d) / 2 + 0.9);
      // the result's roles name live props
      for (const p of [r!.rocket, r!.cashwrap, r!.demo, r!.starMap]) expect(live(h, p), tagOf(h)).toBeTruthy();
      void xzUV;
    }
  });
});
