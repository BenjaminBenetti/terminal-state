// Task studio-alpha-skyways-shops-20261107-054512-01 (lane STORE-DESIGN): LARCH & LOOM HOME — the Skyways design store at layout v3
// (gen/skyways/stores/design.ts + designDress.ts, kinds/design.ts; world/skywaysStoreDesignDraw.ts). Over several seeds of both formats
// (two-level, hall): the showroom's pieces (design desk, textiles band, kitchen display, living / dining / bedroom vignettes on rugs, the
// lighting gallery, the bedroom + lighting storey), storage that opens, on-theme holder loot, fit (in-area, grounded, no overlaps,
// supported decor, rugs on open floor), clear routes, physics classes, stocked back rooms, the finish, the rug / textile renderer.
import * as THREE from 'three';
import {beforeAll, describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {buildBoth} from './helpers/tslShaders';
import {findStores, storeAreas, storeProps, type StoreHit} from './helpers/skywaysStores';
import {LEVELS} from '../src/levels/registry';
import {Rng} from '../src/core/rng';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import type {StationLayout} from '../src/gen/stationTypes';
import {purposeById} from '../src/gen/purposes';
import {SKYWAYS_STORES} from '../src/gen/skyways/stores/index';
import {STORE_DESIGN} from '../src/gen/skyways/stores/design';
import {DESIGN_LIGHTING_PURPOSE, designPitch, skywaysDesignDressOf, type DesignResult} from '../src/gen/skyways/stores/designDress';
import {DESIGN_RUG, DESIGN_RUGS, DESIGN_TEXTILES, STORE_DESIGN_KINDS, STORE_DESIGN_MALL_MODELS, designRugParts, designTextileParts} from '../src/gen/skyways/stores/kinds/design';
import {ANCHOR_STYLES, ANCHOR_STYLE_DEFAULTS} from '../src/gen/skyways/destinations/anchorStyles';
import {AnchorKit} from '../src/gen/skyways/destinations/skywaysShopsAKit';
import {MALL_KIND_ASSET} from '../src/gen/mall/kinds';
import {MALL_ASSETS} from '../src/assets/mallAssets';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {RenderIndex} from '../src/damage/propDamage';
import {holderTable, isLootHolderKind} from '../src/items/loot';
import {lootProfile} from '../src/items/lootTables';
import {WorldMaterials} from '../src/world/materials';
import {OfficeSurfaceMaterial} from '../src/world/officeArch';
import {buildSkywaysDestProp} from '../src/world/skywaysDestinations';
import {designTextileMaterial} from '../src/world/skywaysStoreDesignDraw';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

installCanvasShim(false);

const TWO = findStores('design', {format: 'two-level', count: 4, maxSeed: 120});
const HALL = findStores('design', {format: 'hall', count: 4, maxSeed: 120});
const ALL: StoreHit[] = [...TWO, ...HALL];
const resOf = (h: StoreHit): DesignResult => skywaysDesignDressOf(h.layout).find(r => r.anchor === h.anchor.id)!;
const mine = (h: StoreHit): PropPlacement[] => resOf(h).props.map(i => h.layout.props[i]);
const audit = new Map(OPENABLE_AUDIT.map(e => [e.kind, e]));
const profile = lootProfile('skyways');

/** Kinds that read as storage in this store: they must open (existing openable / holder kinds). */
const STORAGE = ['dresserDrawers', 'kitchenette', 'mallCashwrapCounter', 'glassDisplayCabinet', 'bookstoreBookcase', 'footlocker', 'cardboardBoxFlaps', 'storageTote',
  'staffLockers', 'fridge', 'cabinetTall', 'cabinetLow', 'stockShelf'];

describe('Larch & Loom Home (design store): spec, kinds, finish', () => {
  it('the sample covers both formats', () => {
    expect(TWO.length).toBeGreaterThanOrEqual(3);
    expect(HALL.length).toBeGreaterThanOrEqual(3);
  });

  it('the spec: its own dresser, existing Mall home purposes, its own finish (pale timber wainscot, larch boards, plain pale ceiling)', () => {
    expect(SKYWAYS_STORES.design).toBe(STORE_DESIGN);
    expect(STORE_DESIGN.purposes).toEqual({floor: 'mall-home', upper: 'mall-home', stock: 'mall-home-back'});
    for (const id of [...Object.values(STORE_DESIGN.purposes), DESIGN_LIGHTING_PURPOSE]) expect(purposeById(id), id).toBeTruthy();
    const st = ANCHOR_STYLES.design;
    expect(st.wall.kind).toBe('wood');
    expect(st.wall.lowerTop).toBeGreaterThan(0.9);
    expect(st.wall.lowerTop).toBeLessThan(2); // a wainscot, not full-height panelling (the bookshop's dark oak)
    expect(st.floor.kind).toBe('wood');
    expect(st.ceiling.kind).toBe('plain');
    expect(st.upper?.wall?.paint).not.toBe(st.wall.paint); // the bedroom + lighting storey: its own (sage) plaster
    const lum = (h: number) => 0.2126 * ((h >> 16) & 255) + 0.7152 * ((h >> 8) & 255) + 0.0722 * (h & 255);
    expect(lum(st.wall.lower)).toBeGreaterThan(lum(ANCHOR_STYLES.books.wall.lower) + 60); // pale timber, unlike the bookshop
    expect(lum(st.floor.tint!)).toBeGreaterThan(130);
    expect(st).not.toEqual(ANCHOR_STYLE_DEFAULTS.design);
  });

  it('the store kinds: in PROP_DEFS, both audits (rug flat / static, textiles light on-host decor), nothing to open', () => {
    expect([...STORE_DESIGN_KINDS]).toEqual(['skyDsRug', 'skyDsTextiles']);
    for (const k of STORE_DESIGN_KINDS) {
      expect(PROP_DEFS[k], k).toBeTruthy();
      expect(audit.get(k)?.cls, k).toBe('none');
      expect(PROP_PHYSICS_AUDIT[k], k).toBeTruthy();
    }
    expect(PROP_PHYSICS_AUDIT.skyDsRug).toMatchObject({cls: 'static', why: 'flat'});
    expect(PROP_PHYSICS_AUDIT.skyDsTextiles).toMatchObject({cls: 'dynamic', onHost: true});
    expect(PROP_DEFS.skyDsRug.h).toBeLessThanOrEqual(0.02); // flat: the walk / support code ignores it (q.h <= 0.02)
    // parts stay inside the kind's box: the textile stacks (every variant) and a rug (its band inside its rect)
    for (let v = 0; v < DESIGN_TEXTILES.variants; v++) for (const p of designTextileParts(v)) {
      expect(Math.abs(p.p[0]) + p.s[0] / 2).toBeLessThanOrEqual(DESIGN_TEXTILES.w / 2 + 1e-6);
      expect(Math.abs(p.p[2]) + p.s[2] / 2).toBeLessThanOrEqual(DESIGN_TEXTILES.d / 2 + 1e-6);
      expect(p.p[1] + p.s[1] / 2).toBeLessThanOrEqual(DESIGN_TEXTILES.h + 1e-6);
      expect(p.p[1] - p.s[1] / 2).toBeGreaterThanOrEqual(-1e-6);
    }
    for (const p of designRugParts(1.4, 1.1, 2)) { expect(Math.abs(p.p[0]) + p.s[0] / 2).toBeLessThanOrEqual(1.4 + 1e-6); expect(Math.abs(p.p[2]) + p.s[2] / 2).toBeLessThanOrEqual(1.1 + 1e-6); expect(p.p[1] + p.s[1] / 2).toBeLessThanOrEqual(DESIGN_RUG.h + 1e-6); }
    expect(designPitch(1.8)).toBe(2.0);
  });

  it('every Mall model the store places is listed (STORE_DESIGN_MALL_MODELS) and exists', () => {
    const used = new Set<string>();
    for (const h of ALL) for (const p of mine(h)) {
      const id = (MALL_KIND_ASSET as Record<string, string | undefined>)[p.kind];
      const url = id ? MALL_ASSETS[id]?.url : null;
      if (url) used.add(path.basename(url));
    }
    expect(used.size).toBeGreaterThan(3);
    for (const f of used) expect(STORE_DESIGN_MALL_MODELS, f).toContain(f);
    for (const f of STORE_DESIGN_MALL_MODELS) expect(fs.existsSync(path.join(fileURLToPath(new URL('../public/assets/models/', import.meta.url)), f)), f).toBe(true);
  });
});

describe('Larch & Loom Home: the showroom (layout v3, both formats)', () => {
  it('a home-design showroom: design desk, textiles band, kitchen display, living / dining / bedroom vignettes on rugs, the lighting gallery', () => {
    let lighting = 0, dining = 0;
    for (const h of ALL) {
      const r = resOf(h), L = h.layout.props;
      const sets = (k: string) => r.sets.filter(s => s.kind === k);
      const kinds = (k: string) => sets(k).flatMap(s => s.props.map(p => p.kind));
      const at = `seed ${h.seed} ${h.anchor.format}`;
      // the design desk: the cash-wrap back counter (drawers + cupboard) and the service counter with its till
      expect(kinds('desk'), at).toContain('mallCashwrapCounter');
      expect(kinds('desk'), at).toContain('shopCounter');
      expect(mine(h).some(p => p.kind === 'cashRegister'), at).toBe(true);
      // textiles: display tables carrying folded throws / towels (each stack ON a table)
      const tables = sets('textiles').flatMap(s => s.props);
      expect(tables.length, at).toBeGreaterThanOrEqual(2);
      const stacks = mine(h).filter(p => p.kind === 'skyDsTextiles');
      expect(stacks.length, at).toBeGreaterThanOrEqual(6);
      for (const s of stacks) expect(['merchTable', 'dresserDrawers'], at).toContain(L[s.host!].kind);
      // the kitchen display: a run of kitchenettes (cupboards with doors) and the island
      expect(kinds('kitchen').filter(k => k === 'kitchenette').length, at).toBeGreaterThanOrEqual(2);
      expect(kinds('kitchen'), at).toContain('merchTable');
      // the vignettes, each on its own rug
      for (const [k, need] of [['living', ['skyDSofa', 'ottoman']], ['bedroom', ['skyDShowroomBed', 'dresserDrawers']]] as const) {
        const ss = sets(k);
        expect(ss.length, `${at}: ${k}`).toBeGreaterThanOrEqual(1);
        for (const n of need) expect(kinds(k), `${at}: ${k}`).toContain(n);
        expect(ss.some(s => s.rug), `${at}: ${k} rug`).toBe(true);
      }
      if (sets('dining').some(s => s.props.some(p => p.kind === 'skyDDiningTable') && s.rug)) dining++;
      if (sets('lighting').some(s => s.props.filter(p => p.kind === 'skyDArcLamp').length >= 2)) lighting++;
      // every bedroom: a bedside chest of drawers (openable) beside the bed, its blanket chest / bedside table where they fit
      for (const s of sets('bedroom')) expect(s.props.some(p => p.kind === 'dresserDrawers'), at).toBe(true);
      // rugs lie under their vignette: the set's main piece overlaps its rug
      for (const s of r.sets.filter(q => q.rug)) {
        const g = s.rug!, m = s.props[0];
        expect(Math.abs(m.x - g.x) < m.hx + g.hx && Math.abs(m.z - g.z) < m.hz + g.hz, `${at}: ${s.kind} on its rug`).toBe(true);
      }
      // two-level: the other storey is the bedroom + lighting showroom
      if (h.anchor.format === 'two-level') {
        expect(sets('bedroom').filter(s => s.level === r.other).length, at).toBeGreaterThanOrEqual(1);
        expect(sets('lighting').filter(s => s.level === r.other).length, at).toBe(1);
        expect(mine(h).some(p => (p.level ?? 0) === r.other && p.kind === 'skyDPoster'), at).toBe(true);
      }
    }
    expect(dining).toBeGreaterThanOrEqual(ALL.length - 1);
    expect(lighting).toBeGreaterThanOrEqual(ALL.length - 1);
  }, 600_000);

  it('storage opens: every dresser / chest / sideboard / kitchen cupboard / cash-wrap / vitrine / carton the store places is an openable or holder kind', () => {
    const seen = new Set<string>();
    for (const h of ALL) for (const p of mine(h)) {
      const e = audit.get(p.kind);
      expect(e, p.kind).toBeTruthy();
      if (e!.role === 'storage' || STORAGE.includes(p.kind)) {
        expect(['openable', 'existing', 'open'], `${p.kind} (${e!.cls})`).toContain(e!.cls);
        seen.add(p.kind);
      }
      // no sealed look-alike storage of this store's own
      if (e!.role === 'storage') expect(e!.cls, p.kind).not.toBe('exception');
    }
    for (const k of ['dresserDrawers', 'kitchenette', 'mallCashwrapCounter', 'bookstoreBookcase', 'footlocker', 'cardboardBoxFlaps', 'storageTote', 'glassDisplayCabinet']) expect(seen, k).toContain(k);
    for (const k of ['dresserDrawers', 'kitchenette', 'mallCashwrapCounter', 'footlocker', 'cardboardBoxFlaps', 'storageTote', 'glassDisplayCabinet', 'bookstoreBookcase']) expect(audit.get(k)!.cls, k).toBe('openable');
  }, 600_000);

  it('purposes and holder loot: the Mall home tables on the floors / mall-home-back in the stock room, the lighting gallery its cells; every holder on theme', () => {
    const HOME = new Set(['water', 'cola', 'juice', 'chocolate', 'chips', 'beans', 'noodles', 'bandage', 'battery', 'flare', 'medkit']);
    const AMMO = /^ammo_/;
    let lightingHolders = 0;
    for (const h of ALL) {
      const {layout: l, anchor: an} = h, A = storeAreas(l, an);
      for (const id of [...A.floor, ...A.upper]) expect(l.areas[id].purpose, `seed ${h.seed} area ${id}`).toBe('mall-home');
      for (const id of A.stock) if (l.areas[id].type === 'stock-room') expect(l.areas[id].purpose).toBe('mall-home-back');
      const office = new Set(A.stock.filter(id => l.areas[id].type !== 'stock-room'));
      for (const p of storeProps(l, an)) {
        if (!isLootHolderKind(p.kind) || office.has(p.area)) continue;
        const key = p.purpose ?? l.areas[p.area].purpose ?? '';
        const t = holderTable(p.kind, key, profile);
        expect(t.source, `${p.kind} in ${key}`).not.toBe('legacy');
        for (const [id] of t.rows) {
          expect(id, `${p.kind} in ${key}`).not.toBe('fuel_can');
          // ammo only by the deliberate rule: the staff lockers' personal kit (the Mall's back-room rule)
          if (AMMO.test(id)) { expect(p.kind, `${id} in ${p.kind}`).toBe('staffLockers'); continue; }
          expect(HOME.has(id), `${id} in ${p.kind} (${key})`).toBe(true);
        }
        if (p.purpose === DESIGN_LIGHTING_PURPOSE) {
          lightingHolders++;
          expect(t.rows.some(([id]) => id === 'battery'), p.kind).toBe(true);
        }
      }
    }
    expect(lightingHolders).toBeGreaterThanOrEqual(ALL.length - 1);
    // the kitchen display's cupboards hold pantry food; a showroom bedside chest bandages / leftovers (the home store's rows)
    expect(holderTable('kitchenette', 'mall-home', profile).rows.map(r => r[0])).toEqual(expect.arrayContaining(['noodles', 'beans']));
    expect(holderTable('dresserDrawers', 'mall-home', profile).rows.map(r => r[0])).toContain('bandage');
    expect(holderTable('fridge', 'mall-home-back', profile).rows.map(r => r[0])).toEqual(expect.arrayContaining(['juice', 'water']));
  }, 600_000);

  it('fit: in its areas, grounded, no overlapping boxes, decor on its host\'s top, rugs on open sales floor and apart', () => {
    for (const h of ALL) {
      const {layout: l, anchor: an} = h, A = storeAreas(l, an), at = `seed ${h.seed}`;
      const ps = mine(h);
      for (const p of ps) {
        expect(A.all.has(p.area), `${at}: ${p.kind} area`).toBe(true);
        expect(p.level ?? 0, `${at}: ${p.kind} storey`).toBe(l.areas[p.area].level ?? 0);
      }
      // standing props (store-wide: the dresser's and the station dresser's back-room pieces) never overlap
      const standing = storeProps(l, an).filter(p => !p.mounted && p.host === undefined), own = new Set(ps);
      for (let i = 0; i < standing.length; i++) for (let j = i + 1; j < standing.length; j++) {
        const a = standing[i], b = standing[j];
        if ((a.level ?? 0) !== (b.level ?? 0) || (!own.has(a) && !own.has(b))) continue;
        const ov = Math.abs(a.x - b.x) < a.hx + b.hx - 0.011 && Math.abs(a.z - b.z) < a.hz + b.hz - 0.011;
        expect(ov, `${at}: ${a.kind} x ${b.kind} at ${a.x},${a.z}`).toBe(false);
      }
      for (const p of ps) {
        const g = l.levels[p.level ?? 0].grid, [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        if (p.host !== undefined) {
          // on-top decor: inside its host's footprint, at a support height of the host
          const host = l.props[p.host];
          expect(host, `${at}: ${p.kind} host`).toBeTruthy();
          expect(Math.abs(p.x - host.x) + p.hx, `${at}: ${p.kind} on ${host.kind}`).toBeLessThanOrEqual(host.hx + 0.02);
          expect(Math.abs(p.z - host.z) + p.hz, `${at}: ${p.kind} on ${host.kind}`).toBeLessThanOrEqual(host.hz + 0.02);
          expect(p.y).toBeGreaterThan(host.y);
          expect(p.y).toBeLessThanOrEqual(host.y + host.h + 0.01);
          expect(PROP_PHYSICS_AUDIT[host.kind]?.cls, `${at}: ${host.kind} host is static`).toBe('static');
          continue;
        }
        if (p.mounted && p.kind !== 'skyDsRug') continue; // (the wall posters)
        expect(Math.abs(p.y - g.floorOf(i)), `${at}: ${p.kind} grounded`).toBeLessThan(0.02);
      }
      // rugs: every cell under them open floor of the store's sales areas; never two over one another
      const rugs = ps.filter(p => p.kind === 'skyDsRug');
      expect(rugs.length, at).toBeGreaterThanOrEqual(3);
      const sales = new Set([...A.floor, ...A.upper]);
      for (const r of rugs) {
        expect(r.mounted).toBe(true);
        expect(r.variant).toBeLessThan(DESIGN_RUGS.length);
        expect(Math.min(r.hx, r.hz) * 2).toBeGreaterThanOrEqual(1.4 - 1e-6);
        const g = l.levels[r.level ?? 0].grid;
        for (let cy = Math.floor((r.z - r.hz + 0.01) / CELL); cy <= Math.floor((r.z + r.hz - 0.01) / CELL); cy++) for (let cx = Math.floor((r.x - r.hx + 0.01) / CELL); cx <= Math.floor((r.x + r.hx - 0.01) / CELL); cx++) {
          const i = g.idx(cx, cy);
          expect(g.cells[i] === FLOOR && sales.has(g.area[i]) && g.rampIdx[i] < 0, `${at}: rug cell ${cx},${cy}`).toBe(true);
        }
        for (const q of rugs) if (q !== r && (q.level ?? 0) === (r.level ?? 0)) expect(Math.abs(q.x - r.x) < q.hx + r.hx - 0.01 && Math.abs(q.z - r.z) < q.hz + r.hz - 0.01).toBe(false);
      }
    }
  }, 600_000);

  it('clear routes: from the entry to the service counter, every staff door and the stair; every free cell of each storey and back room reachable', () => {
    for (const h of ALL) {
      const {layout: l, anchor: an} = h, A = storeAreas(l, an), at = `seed ${h.seed}`;
      const kit = new AnchorKit(l, new Rng(1), an);
      const reach = (level: number, ids: Set<number>, from: [number, number]): {seen: Uint8Array; free: (i: number) => boolean; g: StationLayout['grid']} => {
        const g = l.levels[level].grid, free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && ids.has(g.area[i]);
        const seen = new Uint8Array(g.w * g.h), [cx, cy] = g.cellOf(from[0], from[1]);
        let start = -1;
        for (let r = 0; r <= 4 && start < 0; r++) for (let dy = -r; dy <= r && start < 0; dy++) for (let dx = -r; dx <= r; dx++) { const i = g.idx(cx + dx, cy + dy); if (free(i)) { start = i; break; } }
        expect(start, `${at}: a free start cell`).toBeGreaterThanOrEqual(0);
        const st = [start];
        seen[start] = 1;
        while (st.length) { const c = st.pop()!; for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && free(n)) { seen[n] = 1; st.push(n); } }
        return {seen, free, g};
      };
      const near = (R: ReturnType<typeof reach>, x: number, z: number, r = 1) => { const [cx, cy] = R.g.cellOf(x, z); for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (R.seen[R.g.idx(cx + dx, cy + dy)]) return true; return false; };
      const floorIds = new Set([...A.floor, ...A.zones]);
      const R = reach(an.level, floorIds, kit.inside(1.25));
      // every free cell of the sales floor (its pieces round the stair well) is reachable from the entry
      for (let i = 0; i < R.seen.length; i++) if (R.free(i)) expect(R.seen[i], `${at}: floor cell ${i % R.g.w},${Math.floor(i / R.g.w)}`).toBe(1);
      // the customer side of each service counter
      for (const c of resOf(h).sets.filter(s => s.kind === 'desk').flatMap(s => s.props).filter(p => p.kind === 'shopCounter')) {
        const [x, z] = [c.x + Math.sin(c.rot) * (PROP_DEFS.shopCounter.d / 2 + 0.4), c.z + Math.cos(c.rot) * (PROP_DEFS.shopCounter.d / 2 + 0.4)];
        expect(near(R, x, z), `${at}: in front of the counter`).toBe(true);
      }
      // every staff door (inside the floor) and, through it, every free cell of its back room
      for (const sid of A.stock) {
        const door = l.doors.find(d => (d.a === sid && floorIds.has(d.b)) || (d.b === sid && floorIds.has(d.a)));
        expect(door, `${at}: back room ${sid} door`).toBeTruthy();
        const p = kit.doorIn(door!, an.level, 0.75)!;
        expect(near(R, p.x, p.z), `${at}: staff door ${sid}`).toBe(true);
        const q = kit.doorIn(door!, an.level, 0.75, sid) ?? (() => { const cx = (door!.x + door!.w / 2) * CELL, cz = (door!.y + door!.h / 2) * CELL; return {x: cx, z: cz}; })();
        const B = reach(l.areas[sid].level ?? 0, new Set([sid]), [q.x, q.z]);
        for (let i = 0; i < B.seen.length; i++) if (B.free(i)) expect(B.seen[i], `${at}: back room ${sid} cell`).toBe(1);
      }
      if (an.upper !== undefined) {
        const lower = kit.mouths.get(an.level)!, upper = kit.mouths.get(kit.other!)!;
        expect(near(R, lower.x, lower.z, 3), `${at}: the stair`).toBe(true); // (the stand point is on the landing: the floor within 1.5 m)
        const U = reach(kit.other!, new Set(A.upper), [upper.x, upper.z]);
        for (let i = 0; i < U.seen.length; i++) if (U.free(i)) expect(U.seen[i], `${at}: other storey cell`).toBe(1);
      }
    }
  }, 600_000);

  it('physics classes: loose furniture dynamic (chairs, ottomans, lamps, side tables, plants, totes, cartons), heavy pieces static, textiles on hosts', () => {
    for (const h of ALL) for (const p of mine(h)) {
      const row = PROP_PHYSICS_AUDIT[p.kind];
      expect(row, p.kind).toBeTruthy();
      if (['cafeChair', 'ottoman', 'loungeArmchair', 'skyDEggChair', 'skyDArcLamp', 'cafeBistroTable', 'pottedPlantSmall', 'storageTote', 'cardboardBoxFlaps', 'skyDsTextiles', 'draftingLamp'].includes(p.kind)) expect(row.cls, p.kind).toBe('dynamic');
      if (['skyDSofa', 'skyDDiningTable', 'skyDShowroomBed', 'dresserDrawers', 'kitchenette', 'mallCashwrapCounter', 'bookstoreBookcase', 'merchTable', 'shopCounter', 'skyDsRug'].includes(p.kind)) expect(row.cls, p.kind).toBe('static');
      if (p.kind === 'skyDsTextiles') expect(p.host, 'textiles stand on a host').toBeDefined();
    }
  }, 600_000);

  it('back rooms stocked: flat-pack cartons and totes (openable) beside the station dresser\'s shelving; every v3 store has one', () => {
    for (const h of ALL) {
      const {layout: l, anchor: an} = h, at = `seed ${h.seed}`;
      expect(an.stock.length, at).toBeGreaterThanOrEqual(1);
      const stock = an.stock.filter(id => l.areas[id].type === 'stock-room');
      expect(stock.length, at).toBeGreaterThanOrEqual(1);
      for (const id of stock) {
        const ps = l.props.filter(p => p.area === id);
        expect(ps.filter(p => p.kind === 'cardboardBoxFlaps').length, `${at}: cartons`).toBeGreaterThanOrEqual(2);
        expect(ps.filter(p => audit.get(p.kind)?.cls === 'openable' || audit.get(p.kind)?.cls === 'existing').length, `${at}: openable storage`).toBeGreaterThanOrEqual(3);
        expect(ps.some(p => ['stockShelf', 'shelf', 'outdoorsPlankShelving'].includes(p.kind)), `${at}: shelving`).toBe(true);
      }
      expect(resOf(h).back.flatMap(b => b.props).length, at).toBeGreaterThanOrEqual(3);
    }
  }, 600_000);

  it('deterministic: the same seed dresses the store identically', () => {
    const h = ALL[0];
    const again = LEVELS.skyways.generate('main', {levelSeed: h.seed, startWeapon: 'pistol', layoutVersion: 3} as never) as StationLayout;
    const an = again.skyways!.anchors!.find(a => a.family === 'design')!;
    const fp = (l: StationLayout, a: typeof an) => JSON.stringify(storeProps(l, a).map(p => [p.kind, p.x, p.z, p.y, p.rot, p.variant, p.host ?? -1, p.purpose ?? '']));
    expect(fp(again, an)).toBe(fp(h.layout, h.anchor));
  }, 600_000);
});

describe('Larch & Loom Home: the rug / textile renderer', () => {
  let mats: WorldMaterials;
  beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); });

  it('rugs: a mesh per rug and tint (flat, never casters); textiles instance per variant / tint; the render index finds every rug / stack; both backends build cleanly', () => {
    const h = ALL[0], l = h.layout;
    const rugs = mine(h).filter(p => p.kind === 'skyDsRug'), stacks = mine(h).filter(p => p.kind === 'skyDsTextiles');
    const group = new THREE.Group();
    const inst = (() => { throw new Error('no model kinds here'); }) as never;
    expect(buildSkywaysDestProp(group, 'skyDsRug', rugs, mats, inst, {}, l)).toBe(rugs.length);
    expect(buildSkywaysDestProp(group, 'skyDsTextiles', stacks, mats, inst, {}, l)).toBe(stacks.length);
    const meshes = group.children as THREE.Mesh[];
    const rugMeshes = meshes.filter(m => m.name.startsWith('prop-skyDsRug-')), texMeshes = meshes.filter(m => m.name.startsWith('prop-skyDsTextiles-'));
    expect(rugMeshes.length).toBe(2 * rugs.length);
    for (const m of rugMeshes) { expect(m.castShadow).toBe(false); expect(m.material).toBeInstanceOf(OfficeSurfaceMaterial); expect(typeof m.userData.level).toBe('number'); }
    for (const m of texMeshes) expect((m as unknown as THREE.InstancedMesh).isInstancedMesh).toBe(true);
    // the tinted office carpet: one continuous pile (no carpet-tile seams), one material per tint
    const mat = designTextileMaterial(mats, 'sage');
    expect(mat.ofP.z).toBe(0);
    expect(mat).toBe(designTextileMaterial(mats, 'sage'));
    expect(mat.name.startsWith('skyways-')).toBe(false);
    // the prop render index (damage / loose-prop physics) finds each stack's instance
    const ri = new RenderIndex();
    ri.build([group], [...stacks, ...rugs], new Set());
    for (const s of stacks) expect(ri.inst.get(s)?.length, 'a stack\'s instances').toBeGreaterThan(0);
    for (const r of rugs) expect(ri.inst.get(r)?.length, 'a rug\'s field + band').toBe(2);
    const lights = () => [new THREE.PointLight(0xffffff, 1, 8)];
    for (const m of [rugMeshes[0], texMeshes[0]]) for (const sh of buildBoth(m, {lights: lights()})) expect(sh.errors, `${m.name} (${sh.backend})`).toEqual([]);
  }, 600_000);
});
