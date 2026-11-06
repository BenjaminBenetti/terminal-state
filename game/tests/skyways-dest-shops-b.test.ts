// Task studio-skyways-destinations-20261106-170011-01 (lane SHOPS-B (C)): the Skyways DESTINATION anchor interiors of this lane's families —
// Glasshouse Garden Co., Starfall Arcade, Aurora Picture House, Big Sky Wonders, Blue Line Sports (gen/skyways/destinations/shopsB.ts, its
// kinds in kindsShopsB.ts). On REAL generated levels (LEVELS.skyways.generate; the seeds where each family occurs):
//  - the kinds: classified in both audits (physics affordance, openables), damage spec, footprints = the measured kit model table,
//    plausible dynamic bodies, the model files present;
//  - each family's signature pieces in its anchor (the cinema's screen on the auditorium's FAR wall, the seat rows facing it);
//  - everything inside the anchor's areas, standing on the floor or on its host's measured top (pots on the benches, kits on the display
//    tables, the till's register), mounted / hung pieces where they belong, no overlaps;
//  - clear >= 1.2 m lanes from the storefront entry to every zone / back-room door;
//  - the holders roll the family's base-use tables (finite loot present); validation stays clean; deterministic per seed.
import {beforeAll, describe, expect, it} from 'vitest';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout, Area} from '../src/gen/stationTypes';
import type {SkywaysAnchor} from '../src/gen/skyways/skywaysTypes';
import {skywaysIssues} from '../src/gen/skyways/validate';
import {ANCHOR_FAMILIES} from '../src/gen/skyways/carve';
import {CELL, FLOOR} from '../src/gen/grid';
import {PROP_DEFS, SHOP_COUNTER_TOP_Y, type PropKind, type PropPlacement} from '../src/gen/props';
import {doorSide} from '../src/gen/placeKit';
import {PROP_DAMAGE, PHYS_MATS, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {holderFinds, holderTable, isLootHolderKind, type HolderKind} from '../src/items/loot';
import {SKYWAYS_DEST_PROPS, type SkywaysDestProp} from '../src/assets/skywaysDestProps.generated';
import {DEST_POSTERS_OF} from '../src/gen/skyways/destinations/art';
import {HUNG_CLEAR, PLANET_MOBILE_HANG, PLANT_BENCH_TOP, SHOPS_B_KINDS, SHOPS_B_MODEL, SHOPS_B_SCALE, SHOPS_B_SPECS, SKYD_SCREEN_PARTS} from '../src/gen/skyways/destinations/kindsShopsB';
import {SHOPS_B_FAMILIES} from '../src/gen/skyways/destinations/shopsB';

const pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const near = (a: number, b: number, eps = 1e-3) => Math.abs(a - b) <= eps;

/** Every kind this lane's dressers place (the anchors also hold a few props of the station's earlier passes). */
const MINE: ReadonlySet<string> = new Set([...SHOPS_B_KINDS, 'shopCounter', 'shopDisplay', 'shopBackbar', 'shopCooler', 'stockShelf', 'snackRack', 'showcase', 'cashRegister',
  'flowerStand', 'planterTree', 'pottedPlantSmall', 'arcadeCabinet', 'capsuleToyMachine', 'vending', 'giantTeddy', 'skywaysPrizeStanchion', 'bench', 'merchTable',
  'labMicroscope', 'labFlaskLarge', 'labTubeRack', 'labBottleRack', 'satelliteModel', 'garmentRail', 'fittingBench', 'treadmill', 'bicycle', 'skyDPoster']);
/** Host tops (m above the host's base) of the hosts this lane stacks on. */
const TOP: Readonly<Partial<Record<PropKind, number>>> = {skyDPlantBench: PLANT_BENCH_TOP(), merchTable: PROP_DEFS.merchTable.h, shopCounter: SHOP_COUNTER_TOP_Y};

interface Shop { seed: number; layout: StationLayout; an: SkywaysAnchor; areas: Area[]; props: PropPlacement[] }
const SEEDS = Array.from({length: 14}, (_, i) => i + 1);
const layouts = new Map<number, StationLayout>();
const shops: Shop[] = [];
const ofFamily = (f: string) => shops.filter(s => s.an.family === f);

beforeAll(() => {
  for (const seed of SEEDS) {
    const layout = LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol'});
    layouts.set(seed, layout);
    for (const an of layout.skyways?.anchors ?? []) {
      if (!SHOPS_B_FAMILIES.includes(an.family)) continue;
      const ids = new Set([an.floor, ...an.zones]);
      shops.push({seed, layout, an, areas: [...ids].map(id => layout.areas[id]), props: layout.props.filter(p => ids.has(p.area))});
    }
  }
});

describe('Skyways destinations, lane SHOPS-B: kinds', () => {
  it('every kind: measured footprint, both audits, damage spec, plausible physics, its model file', () => {
    for (const k of SHOPS_B_KINDS) {
      const s = SHOPS_B_SPECS[k], def = PROP_DEFS[k], m = SHOPS_B_MODEL[k];
      expect(def, k).toBe(s.def);
      if (m) {
        const row: SkywaysDestProp = SKYWAYS_DEST_PROPS[m];
        expect(row.planned, k).toBeFalsy();
        expect([def.w, def.h, def.d], k).toEqual([row.w, row.h, row.d].map(v => Math.round(v * 1000) / 1000));
        expect(existsSync(pub(row.url)), `${k} ${row.url}`).toBe(true);
        // rule 5: its scale check beside the zombie recorded (dims + grounded contact / hang point)
        expect((SHOPS_B_SCALE as Record<string, string>)[k], k).toMatch(/\d+\.\d+ x \d+\.\d+ x \d+\.\d+ m.*(grounded|hung)/);
      } else {
        expect(k).toBe('skyDCinemaScreen');
        // the code-drawn screen: its parts inside its box (frame + projection face)
        for (const {p, s} of SKYD_SCREEN_PARTS) {
          expect(Math.abs(p[0]) + s[0] / 2, k).toBeLessThanOrEqual(def.w / 2 + 1e-6);
          expect(p[1] - s[1] / 2, k).toBeGreaterThanOrEqual(-1e-6);
          expect(p[1] + s[1] / 2, k).toBeLessThanOrEqual(def.h + 1e-6);
          expect(Math.abs(p[2]) + s[2] / 2, k).toBeLessThanOrEqual(def.d / 2 + 1e-6);
        }
      }
      const a = PROP_PHYSICS_AUDIT[k];
      expect(a, k).toBeTruthy();
      expect(a.cls, k).toBe(s.phys.dynamic ? 'dynamic' : 'static');
      expect(a.how.length, k).toBeGreaterThan(20);
      if (s.phys.dynamic) {
        const ph = propPhysics(k);
        expect(ph.dynamic && ph.contact, k).toBe(true);
        expect(ph.mass, k).toBeGreaterThan(0.5);
        expect(ph.mass, k).toBeLessThanOrEqual(50);
        expect(Object.keys(PHYS_MATS)).toContain(ph.mat);
        if (!ph.onHost) expect(['castor', 'pad'], k).toContain(ph.mat);
      } else expect(a.why, k).toBeTruthy();
      const o = OPENABLE_AUDIT.filter(r => r.kind === k);
      expect(o.length, k).toBe(1);
      expect(o[0].how.length, k).toBeGreaterThan(10);
      expect(PROP_DAMAGE[k], k).toBeTruthy();
    }
    // the heavy coin-op machines, the booth, the seats and the mounted pieces stay put; the loose / light pieces move; only the pots ride a host
    for (const k of ['skyDPinball', 'skyDAirHockey', 'skyDClawCrane', 'skyDTicketBooth', 'skyDCinemaSeats', 'skyDPlanetMobile', 'skyDCinemaScreen', 'skyDPlantBench'] as const) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('static');
    for (const k of ['skyDPottedPalm', 'skyDGeraniumPot', 'skyDWheelbarrow', 'skyDPopcornCart', 'skyDTelescope', 'skyDGiantGlobe', 'skyDRocketModel', 'skyDHockeyNet', 'skyDGoalieMannequin'] as const) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('dynamic');
    expect(SHOPS_B_KINDS.filter(k => propPhysics(k).onHost)).toEqual(['skyDGeraniumPot']);
  });
});

describe('Skyways destinations, lane SHOPS-B: the anchors on real levels', () => {
  it('each family occurs on the sample and its layouts validate', () => {
    for (const f of SHOPS_B_FAMILIES) expect(ofFamily(f).length, f).toBeGreaterThanOrEqual(2);
    for (const [seed, l] of layouts) expect(skywaysIssues(l), `seed ${seed}`).toEqual([]);
  });

  it('every family\'s signature pieces are in its anchor', () => {
    const count = (s: Shop, k: string, area?: number) => s.props.filter(p => p.kind === k && (area === undefined || p.area === area)).length;
    const posters = (s: Shop) => s.props.filter(p => p.kind === 'skyDPoster' && DEST_POSTERS_OF[s.an.family].includes(p.variant)).length;
    for (const s of shops) {
      const tag = `seed ${s.seed} ${s.an.family} ${s.an.format}`;
      expect(count(s, 'shopCounter'), `${tag}: a till / prize / concession counter`).toBeGreaterThanOrEqual(1);
      expect(count(s, 'cashRegister'), tag).toBeGreaterThanOrEqual(1);
      expect(posters(s), `${tag}: the family's poster`).toBeGreaterThanOrEqual(1);
      switch (s.an.family) {
        case 'garden':
          expect(count(s, 'skyDPlantBench'), tag).toBeGreaterThanOrEqual(2);
          expect(count(s, 'skyDGeraniumPot'), tag).toBeGreaterThanOrEqual(4);
          expect(count(s, 'skyDPottedPalm') + count(s, 'planterTree'), tag).toBeGreaterThanOrEqual(2);
          expect(count(s, 'skyDWheelbarrow'), tag).toBe(1);
          break;
        case 'arcade':
          expect(count(s, 'skyDPinball'), tag).toBeGreaterThanOrEqual(4);
          expect(count(s, 'skyDAirHockey'), tag).toBeGreaterThanOrEqual(1);
          expect(count(s, 'skyDClawCrane'), tag).toBeGreaterThanOrEqual(1);
          expect(count(s, 'arcadeCabinet'), tag).toBeGreaterThanOrEqual(6);
          expect(count(s, 'showcase') + count(s, 'giantTeddy'), `${tag}: the prize counter`).toBeGreaterThanOrEqual(1);
          break;
        case 'cinema': {
          const aud = s.an.zones[0];
          expect(s.an.format).toBe('multi-zone');
          for (const k of ['skyDTicketBooth', 'skyDPopcornCart']) expect(count(s, k, s.an.floor), `${tag} ${k}`).toBe(1);
          expect(count(s, 'skywaysPrizeStanchion', s.an.floor), `${tag}: the queue`).toBeGreaterThanOrEqual(2);
          expect(posters(s), tag).toBeGreaterThanOrEqual(2);
          expect(count(s, 'skyDCinemaScreen', aud), tag).toBe(1);
          expect(count(s, 'skyDCinemaSeats', aud), tag).toBeGreaterThanOrEqual(8);
          break;
        }
        case 'science':
          expect(count(s, 'skyDRocketModel'), tag).toBe(1);
          expect(count(s, 'skyDTelescope'), tag).toBeGreaterThanOrEqual(1);
          expect(count(s, 'skyDGiantGlobe'), tag).toBeGreaterThanOrEqual(1);
          expect(count(s, 'merchTable'), `${tag}: display tables`).toBeGreaterThanOrEqual(2);
          // the planet mobile hangs wherever the room keeps its clear underside (the double-height emporium)
          if (s.areas[0].ceil - (s.areas[0].floorY ?? 0) >= PLANET_MOBILE_HANG() + HUNG_CLEAR + 0.02 + 1e-6) expect(count(s, 'skyDPlanetMobile'), tag).toBe(1);
          break;
        case 'hockey':
          expect(count(s, 'skyDHockeyNet'), tag).toBeGreaterThanOrEqual(1);
          expect(count(s, 'skyDGoalieMannequin'), tag).toBe(1);
          expect(count(s, 'stockShelf'), tag).toBeGreaterThanOrEqual(2);
          break;
      }
    }
    // the double-height stores get their extra height: the mobile over the science centrepiece, more palms / trees in the glasshouse
    expect(ofFamily('science').some(s => s.an.format === 'double-height' && s.props.some(p => p.kind === 'skyDPlanetMobile'))).toBe(true);
  });

  it('the cinema: the screen on the auditorium\'s far wall (facing the lobby door), the seat rows facing it, aisles kept', () => {
    for (const s of ofFamily('cinema')) {
      const aud = s.layout.areas[s.an.zones[0]], tag = `seed ${s.seed}`;
      const door = s.layout.doors.find(d => (d.a === s.an.floor && d.b === aud.id) || (d.b === s.an.floor && d.a === aud.id))!;
      const far = ({N: 'S', S: 'N', E: 'W', W: 'E'} as const)[doorSide(door, aud)];
      const screen = s.props.find(p => p.kind === 'skyDCinemaScreen')!;
      const wall = far === 'N' ? aud.y * CELL : far === 'S' ? (aud.y + aud.h) * CELL : far === 'W' ? aud.x * CELL : (aud.x + aud.w) * CELL;
      const off = far === 'N' || far === 'S' ? Math.abs(screen.z - wall) : Math.abs(screen.x - wall);
      expect(off, `${tag}: on the far wall`).toBeLessThan(0.2);
      expect(screen.mounted, tag).toBe(true);
      expect(screen.y + screen.h, `${tag}: under the ceiling`).toBeLessThanOrEqual(aud.ceil - 0.05 + 1e-6);
      expect(screen.y - (aud.floorY ?? 0), tag).toBeGreaterThanOrEqual(0.5 - 1e-6);
      const seats = s.props.filter(p => p.kind === 'skyDCinemaSeats');
      const toward = {N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0]}[far];
      for (const q of seats) {
        expect(q.area, tag).toBe(aud.id);
        expect(Math.sin(q.rot) * toward[0] + Math.cos(q.rot) * toward[1], `${tag}: seat row faces the screen`).toBeGreaterThan(0.99);
        const dist = far === 'N' || far === 'S' ? Math.abs(q.z - wall) : Math.abs(q.x - wall);
        expect(dist, `${tag}: first row >= 3 m off the screen`).toBeGreaterThanOrEqual(3.0);
      }
    }
  });

  it('everything inside its area, standing on the floor or on its host\'s measured top; mounted / hung pieces in place; no overlaps', () => {
    for (const s of shops) {
      const tag = `seed ${s.seed} ${s.an.family}`;
      const mine = s.props.filter(p => MINE.has(p.kind));
      for (const p of mine) {
        const a = s.layout.areas[p.area], f = a.floorY ?? 0, t = `${tag} ${p.kind} @${p.x},${p.z}`;
        expect(p.x - p.hx >= a.x * CELL - 1e-3 && p.x + p.hx <= (a.x + a.w) * CELL + 1e-3 && p.z - p.hz >= a.y * CELL - 1e-3 && p.z + p.hz <= (a.y + a.h) * CELL + 1e-3, `${t}: inside its area`).toBe(true);
        expect(p.level ?? 0, t).toBe(s.an.level);
        if (p.host !== undefined) {
          const h = s.layout.props[p.host], top = TOP[h.kind];
          expect(top, `${t}: host ${h.kind}`).toBeDefined();
          expect(near(p.y, h.y + top!), `${t}: on its host's top (${p.y} vs ${h.y + top!})`).toBe(true);
          expect(p.x - p.hx >= h.x - h.hx - 1e-3 && p.x + p.hx <= h.x + h.hx + 1e-3 && p.z - p.hz >= h.z - h.hz - 1e-3 && p.z + p.hz <= h.z + h.hz + 1e-3, `${t}: over its host`).toBe(true);
          expect(propPhysics(h.kind).dynamic, `${t}: a static host`).toBe(false);
          if (isLootHolderKind(h.kind)) expect(h.cut?.length, `${t}: its span cut out of the host's loot top`).toBeGreaterThan(0);
        } else if (p.kind === 'skyDPlanetMobile') {
          expect(p.mounted, t).toBe(true);
          expect(p.y - f, `${t}: clear underside`).toBeGreaterThanOrEqual(HUNG_CLEAR - 1e-6);
          expect(p.y + p.h, `${t}: under the ceiling`).toBeLessThanOrEqual(a.ceil + 1e-6);
        } else if (p.kind === 'skyDPoster' || p.kind === 'skyDCinemaScreen') {
          expect(p.mounted, t).toBe(true);
          expect(p.y - f, t).toBeGreaterThan(0.4);
        } else expect(near(p.y, f), `${t}: on the floor (${p.y} vs ${f})`).toBe(true);
      }
      // pairwise: no two boxes intersect (a prop and its host touch at the host's top only)
      const solid = s.props.filter(p => p.kind !== 'shopGlazing');
      for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i], b = solid[j];
        if (!MINE.has(a.kind) && !MINE.has(b.kind)) continue;
        const ox = Math.min(a.x + a.hx, b.x + b.hx) - Math.max(a.x - a.hx, b.x - b.hx), oz = Math.min(a.z + a.hz, b.z + b.hz) - Math.max(a.z - a.hz, b.z - b.hz);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y + (a.lift ?? 0), b.y + (b.lift ?? 0));
        expect(ox <= 0.02 || oz <= 0.02 || oy <= 0.02, `${tag}: ${a.kind} @${a.x},${a.z} / ${b.kind} @${b.x},${b.z} overlap`).toBe(true);
      }
    }
  });

  it('the pots stand on the plant benches\' measured tops, spaced apart', () => {
    let pots = 0;
    for (const s of ofFamily('garden')) for (const b of s.props.filter(p => p.kind === 'skyDPlantBench')) {
      const hi = s.layout.props.indexOf(b), on = s.layout.props.filter(p => p.host === hi);
      expect(on.every(p => p.kind === 'skyDGeraniumPot')).toBe(true);
      expect(on.length, `seed ${s.seed}: >= 2 pots per bench`).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) expect(Math.abs(on[i].x - on[j].x) >= 0.25 || Math.abs(on[i].z - on[j].z) >= 0.19, `seed ${s.seed}: pots apart`).toBe(true);
      pots += on.length;
    }
    expect(pots).toBeGreaterThan(20);
  });

  it('clear >= 1.2 m lanes from the storefront entry to every zone / back-room door', () => {
    for (const s of shops) {
      const g = s.layout.levels[s.an.level].grid, own = new Set(s.areas.map(a => a.id));
      const doors = s.layout.doors.filter(d => own.has(d.a) || own.has(d.b));
      const doorCell = new Set<number>();
      for (const d of doors) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) doorCell.add(g.idx(x, y));
      const free = (i: number) => g.cells[i] === FLOOR && !g.blocked[i] && (own.has(g.area[i]) || doorCell.has(i));
      // a lane cell has free floor on all four sides (a corridor >= 3 cells = 1.5 m wide); door cells pass as they are
      const pass = (i: number) => free(i) && (doorCell.has(i) || [i - 1, i + 1, i - g.w, i + g.w].every(free));
      const sf = doors.filter(d => d.shopfront && (d.a === s.an.floor || d.b === s.an.floor));
      const start = sf.flatMap(d => { const out: number[] = []; for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) if (free(g.idx(x, y))) out.push(g.idx(x, y)); return out; });
      expect(start.length, `seed ${s.seed} ${s.an.family}: an open entry`).toBeGreaterThan(0);
      const seen = new Uint8Array(g.w * g.h), q = [...start];
      for (const i of start) seen[i] = 1;
      while (q.length) { const c = q.pop()!; for (const n of [c - 1, c + 1, c - g.w, c + g.w]) if (!seen[n] && pass(n)) { seen[n] = 1; q.push(n); } }
      for (const d of doors) {
        if (d.shopfront) continue;
        let hit = false;
        for (let y = d.y; y < d.y + d.h && !hit; y++) for (let x = d.x; x < d.x + d.w; x++) if (seen[g.idx(x, y)]) { hit = true; break; }
        expect(hit, `seed ${s.seed} ${s.an.family}: lane to the door at ${d.x},${d.y}`).toBe(true);
      }
    }
  });

  it('the holders roll the family\'s base-use tables (finite loot: stocked tables in every anchor, finds in every family)', () => {
    const finds = new Map<string, number>();
    for (const s of shops) {
      const use = ANCHOR_FAMILIES[s.an.family].use, tag = `seed ${s.seed} ${s.an.family}`;
      for (const a of s.areas) expect(a.purpose, tag).toBe(use);
      const holders = s.props.filter(p => MINE.has(p.kind) && isLootHolderKind(p.kind));
      expect(holders.length, tag).toBeGreaterThanOrEqual(2);
      let stocked = 0;
      holders.forEach((p, i) => {
        const key = p.purpose ?? s.layout.areas[p.area].purpose!, t = holderTable(p.kind as HolderKind, key);
        expect(t.source, `${tag} ${p.kind}`).toBe('purpose');
        if (t.rows.length && t.empty < 1 && t.lots[1] > 0) stocked++;
        // (the scarcity economy keeps only some of a holder's roll: finds are counted per family)
        for (let k = 0; k < 4; k++) finds.set(s.an.family, (finds.get(s.an.family) ?? 0) + holderFinds(s.layout.seed + k, i, p.kind as HolderKind, key).length);
      });
      expect(stocked, `${tag}: stocked holders`).toBeGreaterThanOrEqual(2);
    }
    for (const f of SHOPS_B_FAMILIES) expect(finds.get(f) ?? 0, `${f}: finite loot found`).toBeGreaterThan(0);
  });

  it('deterministic per seed', () => {
    const s = shops[0];
    const again = LEVELS.skyways.generate('main', {levelSeed: s.seed, startWeapon: 'pistol'});
    const ids = new Set([s.an.floor, ...s.an.zones]);
    expect(JSON.stringify(again.props.filter(p => ids.has(p.area)))).toBe(JSON.stringify(s.props));
  });
});
