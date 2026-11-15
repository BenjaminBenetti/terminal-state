// Task studio-skywalk-events-20261115-193624-01 (lane EXPO; layout version 7): the TECHNOLOGY EXPO event (add-on 'tech-expo').
//  - the expo's new kinds (gen/skyways/events/expoKinds.ts): registered, classified in the physics / openables / damage audits, a scale
//    record each (rule 5), drawn by buildWorld as prop-<kind>-... meshes; every face's painter exists (world/skywaysExpoDraw.ts) and
//    paints readable content (not one flat colour) for its variants;
//  - the dresser (gen/skyways/events/expoDress.ts) on real expo seeds: the keynote hall (the convention's stage + treads, the LED wall
//    laced into its truss, the lectern on the deck, display screens, the crowd barrier, audience rows facing the stage), exhibitor booths
//    (distinct fictional exhibitors), demo theatres (a title slide screen, audience facing it), registration (badge counters, queue posts
//    with ropes in addon.queues), totems and wayfinding; loose items on real static hosts, nothing floating, hung signs under the ceiling;
//    circulation (a 1.2 m path from every bridge mouth to every room door, the hall and the stage steps; door strips clear); the holders'
//    loot purposes are named loot tables; the reused kinds' models are allowed in the Skyways; addon.expo; deterministic per seed.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {skywaysAddonFor} from '../src/gen/skyways/frame';
import {skywaysAddonDressOf} from '../src/gen/skyways/addon';
import {SKYWAYS_STAGE} from '../src/gen/skyways/addonKinds';
import {SKYWAYS_STAGE_SURFACES, stageWorldXZ} from '../src/gen/skyways/stageSupport';
import {VENUE_ROUTE_R, arrowDir, portalsOf} from '../src/gen/skyways/venueDress';
import {SKYWAYS_EVENT_KINDS} from '../src/gen/skyways/events/kinds';
import {EXPO_KINDS, EXPO_LED_IN_TRUSS, EXPO_SCALE, EXPO_SPECS, type ExpoKind} from '../src/gen/skyways/events/expoKinds';
import {EXPO_EXHIBITORS, EXPO_NAMES} from '../src/gen/skyways/events/expoTypes';
import {EXPO_CASE_PURPOSE, EXPO_HOLDER_PURPOSE, type ExpoDressResult} from '../src/gen/skyways/events/expoDress';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {PROP_DEFS, type PropKind, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {MALL_SALVAGE} from '../src/items/lootTables';
import {officeModelKeysFor} from '../src/gen/office/index';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {SKYWAYS_ADDON_MODEL_FILES, skywaysAddonModelKeysFor} from '../src/gen/skyways/addonKinds';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {SKYWAYS_EVENT_PAINTER_IDS} from '../src/world/skywaysEventDraw';
import {EXPO_PAINTERS} from '../src/world/skywaysExpoDraw';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {ShimCanvas, installCanvasShim} from './helpers/canvas2d';
import type {Area, StationLayout} from '../src/gen/stationTypes';

/** Expo seeds (skywaysAddonFor(seed, 7) === 'tech-expo'; 10 and 20 carve the developer lounge too). */
const SEEDS = [6, 10, 20, 27, 30];
const cache = new Map<number, StationLayout>();
const gen = (seed: number): StationLayout => {
  if (!cache.has(seed)) cache.set(seed, LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', layoutVersion: 7} as never));
  return cache.get(seed)!;
};
const expoOf = (L: StationLayout) => skywaysAddonDressOf(L)!.event as ExpoDressResult;
const deg = (r: number) => (r * 180) / Math.PI;
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** World point -> host-local (x, z). */
function local(host: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
const facing = (p: PropPlacement, x: number, z: number) => Math.sin(p.rot) * (x - p.x) + Math.cos(p.rot) * (z - p.z) > 0;
const inRect = (a: Area, x: number, z: number, pad = 0) => x >= a.x * CELL - pad && x <= (a.x + a.w) * CELL + pad && z >= a.y * CELL - pad && z <= (a.y + a.h) * CELL + pad;

/** BFS over FLOOR cells of the allowed areas whose disc of radius r is clear (a 2r wide body), from the cells near `from`. */
function reachable(L: StationLayout, level: number, allowed: ReadonlySet<number>, from: [number, number], r: number): Uint8Array {
  const g = L.levels[level].grid, seen = new Uint8Array(g.w * g.h), q: number[] = [];
  const ok = (i: number) => g.cells[i] === FLOOR && allowed.has(g.area[i]) && !g.blocked[i] && g.circleClear((i % g.w + 0.5) * CELL, (Math.floor(i / g.w) + 0.5) * CELL, r);
  const [sx, sy] = g.cellOf(from[0], from[1]);
  for (let y = sy - 3; y <= sy + 3; y++) for (let x = sx - 3; x <= sx + 3; x++) if (g.inBounds(x, y) && ok(g.idx(x, y))) { seen[g.idx(x, y)] = 1; q.push(g.idx(x, y)); }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    for (const j of [i - 1, i + 1, i - g.w, i + g.w]) if (!seen[j] && ok(j)) { seen[j] = 1; q.push(j); }
  }
  return seen;
}
/** Some reached cell within `rad` m of (x, z)? */
function near(L: StationLayout, level: number, seen: Uint8Array, x: number, z: number, rad: number): boolean {
  const g = L.levels[level].grid, [cx, cy] = g.cellOf(x, z), k = Math.ceil(rad / CELL);
  for (let y = cy - k; y <= cy + k; y++) for (let xx = cx - k; xx <= cx + k; xx++) {
    if (!g.inBounds(xx, y) || !seen[g.idx(xx, y)]) continue;
    if (Math.hypot((xx + 0.5) * CELL - x, (y + 0.5) * CELL - z) <= rad) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------

describe('the expo kinds: registered, classified, scale-checked, drawn, painted', () => {
  it('every expo kind is an event kind with a footprint, a damage class, one openables row (nothing to open) and a physics row matching its spec', () => {
    for (const k of EXPO_KINDS) {
      expect(SKYWAYS_EVENT_KINDS, k).toContain(k);
      expect(/^[A-Za-z]+$/.test(k), `${k}: prop-<kind> mesh names`).toBe(true);
      const def = PROP_DEFS[k as PropKind];
      expect(def.w * def.d * def.h, k).toBeGreaterThan(0);
      expect(PROP_DAMAGE[k as PropKind], k).toBeTruthy();
      const open = OPENABLE_AUDIT.filter(r => r.kind === k);
      expect(open.length, k).toBe(1);
      expect(open[0].cls, `${k}: no doors / lids / drawers drawn`).toBe('none');
      const spec = EXPO_SPECS[k], row = PROP_PHYSICS_AUDIT[k];
      expect(row, k).toBeTruthy();
      expect(row.cls, k).toBe(spec.phys.dynamic ? 'dynamic' : 'static');
      expect(propPhysics(k).dynamic, k).toBe(spec.phys.dynamic);
      if (spec.phys.dynamic) { expect(row.mass!, k).toBeGreaterThan(0.5); expect(row.mass!, k).toBeLessThanOrEqual(50); } else expect(row.why, k).toBeTruthy();
      expect(EXPO_SCALE[k], `${k}: scale record (rule 5)`).toMatch(/\d\.\d+ x \d\.\d+ x \d\.\d+ m/);
    }
    // the hosts of loose devices stay static (rule 2: a prop something rests on never moves); the movable pieces move
    for (const k of ['skyExpoDemoCounter', 'skyExpoDemoTable', 'skyExpoPlinth'] as const) expect(propPhysics(k).dynamic, k).toBe(false);
    for (const k of ['skyExpoScreenStand', 'skyExpoSignStand', 'skyExpoTowerPc', 'skyExpoLectern'] as const) expect(propPhysics(k).dynamic, k).toBe(true);
  });

  it('every face paint id has a painter (in the event registry), and each paints readable content for its variants', () => {
    const ids = new Set<string>();
    for (const k of EXPO_KINDS) for (const v of [0, 1, 5, 13]) for (const f of EXPO_SPECS[k].faces?.(v) ?? []) ids.add(f.paint);
    expect([...ids].sort()).toEqual(Object.keys(EXPO_PAINTERS).sort());
    for (const id of ids) expect(SKYWAYS_EVENT_PAINTER_IDS, id).toContain(id);
    const variants: Record<string, number[]> = {
      'expo-led': [0, 1, 2, 3 * 5 + 2], 'expo-header': [0, 7, 13], 'expo-graphic': [0, 6, 12], 'expo-counter': [0, 9, 100, 105],
      'expo-hang': [0, 11], 'expo-slide': [0, 4, 100, 105, 200, 203], 'expo-totem': [0, 16, 32 + 4, 48 + 5], 'expo-lectern': [0, 5],
    };
    for (const [id, vs] of Object.entries(variants)) for (const v of vs) {
      const p = EXPO_PAINTERS[id], c = new ShimCanvas(true);
      [c.width, c.height] = p.px;
      const ctx = c.getContext() as unknown as CanvasRenderingContext2D;
      expect(() => p.draw(ctx, c.width, c.height, v), `${id} v${v}`).not.toThrow();
      const img = (ctx as unknown as {getImageData: (x: number, y: number, w: number, h: number) => {data: ArrayLike<number>}}).getImageData(0, 0, c.width, c.height).data;
      const colours = new Set<number>();
      for (let i = 0; i < img.length && colours.size < 3; i += 4 * 97) colours.add((img[i] << 16) | (img[i + 1] << 8) | img[i + 2]);
      expect(colours.size, `${id} v${v}: drawn content`).toBeGreaterThanOrEqual(3);
    }
  });

  it('buildWorld draws every expo kind (prop-<kind>-... meshes; faces included)', () => {
    const W = 80, H = 40, g = new Grid(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); g.cells[i] = x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? SOLID : FLOOR; g.area[i] = 0; g.ceil[i] = 6; g.floor[i] = 0; }
    const props: PropPlacement[] = [];
    let x = 3;
    for (const k of EXPO_KINDS) {
      const d = PROP_DEFS[k as PropKind];
      for (const v of [0, 3]) props.push({kind: k as PropKind, x: x + d.w / 2, z: 6 + v * 2, y: k === 'skyExpoHangSign' ? 4 : 0, rot: 0, area: 0, hx: d.w / 2, hz: d.d / 2, h: d.h, blocksSight: false, variant: v,
        ...(k === 'skyExpoHangSign' || k === 'skyExpoLedWall' ? {mounted: true} : {})});
      x += d.w + 1;
    }
    const layout = {
      seed: 3, name: 'expo kinds', props, grid: g, areas: [{id: 0, x: 1, y: 1, w: W - 2, h: H - 2, kind: 'concourse', type: 'concourse', label: 'Hall', ceil: 6, parent: -1, depth: 0, publicSpace: true, lighting: 'lit'} as unknown as Area],
      doors: [], playerSpawn: {x: 2, z: 2, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [], trench: {floorY: -1.15}, trenches: [],
      attempt: 0, towards: ['A', 'B'], platform: 0, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, rails: [], levelLinks: [],
    } as unknown as StationLayout;
    const restore = installCanvasShim(false);
    let w: ReturnType<typeof buildWorld>;
    try { w = buildWorld(layout, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), {}); } finally { restore(); }
    const names: string[] = [];
    w.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) names.push(o.name); });
    for (const k of EXPO_KINDS) {
      expect(names.some(n => n.startsWith(`prop-${k}-`)), `${k} drawn`).toBe(true);
      const faces = EXPO_SPECS[k as ExpoKind].faces?.(0) ?? [];
      if (faces.length) expect(names.some(n => n.startsWith(`prop-${k}-v0-face`)), `${k} face drawn`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('the tech expo on real version-7 seeds', () => {
  it('the fixture seeds draw the tech expo', () => {
    for (const s of SEEDS) expect(skywaysAddonFor(s, 7), `seed ${s}`).toBe('tech-expo');
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: keynote, booths, theatres, registration, hosts, circulation, wayfinding, record`, () => {
      const L = gen(seed), info = L.skyways!, ad = info.addon, lv = ad.level, g = L.levels[lv].grid, base = info.storeys[lv].baseY;
      expect(ad.id).toBe('tech-expo');
      const venue = ad.venue!, roleOf = (id: number) => venue.find(v => v.area === id)?.role;
      const ex = expoOf(L);
      const mine = new Set(ex.props);
      const idx = (p: PropPlacement) => L.props.indexOf(p);
      for (const p of ex.props) { expect(idx(p), `${p.kind} in the layout`).toBeGreaterThanOrEqual(0); expect(p.level, p.kind).toBe(lv); }

      // --- the record ---
      const rec = ad.expo!;
      expect(rec, 'addon.expo').toBeTruthy();
      expect(rec.name).toBe(EXPO_NAMES[rec.nameIdx].name);
      expect(rec.booths.length).toBe(ex.booths.length);

      // --- the keynote hall: the stage (+ treads), the LED wall in its truss, the lectern on the deck, screens, barrier, audience ---
      const hall = venue.find(v => v.role === 'main-hall')!.area;
      const st = ex.stage!;
      expect(st, `seed ${seed}: keynote stage`).toBeTruthy();
      expect([st.kind, st.variant, st.area]).toEqual(['skywaysConStage', 0, hall]);
      expect(ex.treads.map(t => [t.kind, t.variant])).toEqual([['skywaysConStage', 1], ['skywaysConStage', 1]]);
      expect(rec.keynote).toEqual({area: hall, x: st.x, z: st.z});
      const led = ex.led!;
      expect(led.kind).toBe('skyExpoLedWall');
      expect([led.host, led.mounted, led.rot]).toEqual([idx(st), true, st.rot]);
      expect(led.y - st.y).toBeCloseTo(SKYWAYS_STAGE.deckY + EXPO_LED_IN_TRUSS.y0, 3);
      expect(Math.floor(led.variant / 3)).toBe(rec.nameIdx);
      const [lx, lz] = local(st, led.x, led.z);
      expect(Math.abs(lx) + PROP_DEFS.skyExpoLedWall.w / 2, 'the LED wall within the stage width').toBeLessThanOrEqual(PROP_DEFS.skywaysConStage.w / 2 + 1e-3);
      expect(Math.abs(lz), 'the LED wall over the deck').toBeLessThan(st.hz + 1e-3);
      const lec = ex.lectern!;
      expect([lec.kind, lec.host]).toEqual(['skyExpoLectern', idx(st)]);
      expect(lec.y).toBeCloseTo(st.y + st.h, 3);
      expect(ex.screens.length, `seed ${seed}: side screens`).toBeGreaterThanOrEqual(1);
      expect(ex.chairs.length, `seed ${seed}: keynote audience`).toBeGreaterThanOrEqual(30);
      expect(ex.chairs.length).toBeLessThanOrEqual(140);
      expect(ex.chairs.filter(c => facing(c, st.x, st.z)).length / ex.chairs.length, 'the audience faces the stage').toBeGreaterThanOrEqual(0.8);
      expect(ex.barrier.length, `seed ${seed}: crowd barrier`).toBeGreaterThanOrEqual(2);

      // --- the booths: distinct fictional exhibitors, each a real booth (its wall + fixtures, or an island counter + screen) ---
      expect(ex.booths.length, `seed ${seed}: booths`).toBeGreaterThanOrEqual(2);
      expect(new Set(ex.booths.map(b => b.exhibitor)).size, 'distinct exhibitors').toBe(ex.booths.length);
      for (const b of ex.booths) {
        expect(roleOf(b.area)).toBe('exhibitors');
        expect(b.theme).toBe(EXPO_EXHIBITORS[b.exhibitor].theme);
        const floor = b.props.filter(p => p.host === undefined && !p.mounted);
        if (b.island) {
          expect(floor.map(p => p.kind)).toEqual(expect.arrayContaining(['skyExpoDemoCounter', 'skyExpoScreenStand']));
        } else {
          const wall = b.props.find(p => p.kind === 'skyExpoBoothWall')!;
          expect(wall, 'the booth wall').toBeTruthy();
          expect(wall.variant).toBe(b.exhibitor);
          expect(floor.filter(p => p.kind !== 'skyExpoBoothWall').length, `${EXPO_EXHIBITORS[b.exhibitor].name}: fixtures`).toBeGreaterThanOrEqual(b.compact ? 1 : 2);
        }
      }

      // --- demo theatres: the talk's title slide, the presenter table, the audience facing the screen ---
      const panels = venue.filter(v => v.role === 'panel').map(v => v.area);
      expect(ex.theatres.map(t => t.area).sort()).toEqual([...panels].sort());
      expect(rec.theatres.sort()).toEqual([...panels].sort());
      for (const t of ex.theatres) {
        expect(t.screen, `theatre ${t.area} screen`).toBeTruthy();
        expect(t.screen!.variant).toBeGreaterThanOrEqual(100);
        expect(t.screen!.variant).toBeLessThan(200);
        expect(t.chairs.length, `theatre ${t.area} audience`).toBeGreaterThanOrEqual(4);
        expect(t.chairs.filter(c => facing(c, t.screen!.x, t.screen!.z)).length / t.chairs.length).toBeGreaterThanOrEqual(0.8);
        expect(facing(t.screen!, t.chairs[0].x, t.chairs[0].z), 'the screen faces the audience').toBe(true);
      }

      // --- registration: badge counters, queue posts with rope chains (addon.queues), the welcome totem ---
      const counters = ex.desks.filter(d => d.kind === 'skyExpoDemoCounter');
      expect(counters.length, `seed ${seed}: badge counters`).toBeGreaterThanOrEqual(1);
      for (const c of counters) { expect(['registration', 'exhibitors']).toContain(roleOf(c.area)); expect(c.variant).toBe(100 + rec.nameIdx); }
      expect(ad.queues?.length, `seed ${seed}: rope chains`).toBeGreaterThanOrEqual(1);
      for (const chain of ad.queues!) {
        expect(chain.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < chain.length; i++) {
          expect(L.props[chain[i]].kind).toBe('skywaysPrizeStanchion');
          expect(mine.has(L.props[chain[i]])).toBe(true);
          if (i) expect(Math.hypot(L.props[chain[i]].x - L.props[chain[i - 1]].x, L.props[chain[i]].z - L.props[chain[i - 1]].z)).toBeLessThanOrEqual(2.9);
        }
      }
      expect(ex.totems.some(t => t.kind === 'skyExpoSignStand' && t.variant === rec.nameIdx), `seed ${seed}: welcome totem`).toBe(true);

      // --- hosts and floors: loose items on real static hosts (inside the top), floor props on the floor, hung signs under the ceiling ---
      for (const p of ex.props) {
        if (propPhysics(p.kind).onHost) expect(p.host, `${p.kind}: on-host decor always has its host`).toBeDefined();
        if (p.host !== undefined) {
          const h = L.props[p.host];
          expect(h, `${p.kind}: host`).toBeTruthy();
          expect(propPhysics(h.kind).dynamic, `${p.kind} on ${h.kind}: a static host`).toBe(false);
          if (p.kind === 'skyExpoLedWall') continue;
          expect(p.y, `${p.kind} on ${h.kind}`).toBeCloseTo(h.y + h.h, 3);
          const [hx, hz] = local(h, p.x, p.z);
          expect(Math.abs(hx) <= h.hx + 1e-3 && Math.abs(hz) <= h.hz + 1e-3 || Math.abs(hx) <= h.hz + 1e-3 && Math.abs(hz) <= h.hx + 1e-3, `${p.kind}: centre on ${h.kind}'s top`).toBe(true);
          continue;
        }
        const [cx, cy] = g.cellOf(p.x, p.z);
        if (p.kind === 'skyExpoHangSign') {
          expect(p.y - base, 'clear under the hanging sign').toBeGreaterThanOrEqual(2.5);
          expect(p.y + p.h, 'hung from the ceiling').toBeLessThanOrEqual(g.ceilAt(p.x, p.z) + 1e-3);
          expect(p.y + p.h).toBeGreaterThan(g.ceilAt(p.x, p.z) - 0.05);
          continue;
        }
        if (p.mounted) continue;
        if (p.kind === 'skywaysConStage') continue; // (the stage and its tread boxes: the floor under the hall)
        expect(p.y, `${p.kind} on the floor`).toBeCloseTo(g.floorOf(g.idx(cx, cy)), 6);
      }
      // the holders' loot: named loot tables (finite, never a jackpot: the electronics salvage rows)
      for (const p of ex.props) if (p.purpose) {
        expect([EXPO_HOLDER_PURPOSE, EXPO_CASE_PURPOSE]).toContain(p.purpose);
        expect(MALL_SALVAGE.purposes?.[p.purpose], p.purpose).toBeTruthy();
        expect(OPENABLE_AUDIT.find(r => r.kind === p.kind)?.cls, `${p.kind}: a holder`).not.toBe('none');
      }

      // --- circulation: from every bridge mouth a 1.2 m path to every room door, the hall's doors and the stage steps' foot ---
      const pubRoles = ['main-hall', 'registration', 'exhibitors', 'panel', 'photo-lounge'];
      const pub = venue.filter(v => pubRoles.includes(v.role)).map(v => L.areas[v.area]);
      const wash = venue.filter(v => v.role === 'washrooms').map(v => v.area);
      const allowed = new Set([...pub.map(a => a.id), ...wash]);
      const mouths = pub.filter(a => roleOf(a.id) === 'registration').flatMap(a => portalsOf(L, g, a).filter(p => info.bridges.some(b => b.area === p.to)));
      expect(mouths.length, `seed ${seed}: a bridge into registration`).toBeGreaterThanOrEqual(1);
      const hallDoors = L.doors.filter(d => (d.a === hall || d.b === hall) && allowed.has(d.a) && allowed.has(d.b));
      const roomDoors = L.doors.filter(d => [d.a, d.b].some(id => roleOf(id) === 'panel' || roleOf(id) === 'photo-lounge'));
      const sf = SKYWAYS_STAGE_SURFACES[2], foot = stageWorldXZ(st, (sf.x0 + sf.x1) / 2, sf.z1 + 0.8);
      for (const m of mouths) {
        const seen = reachable(L, lv, allowed, [m.x + m.nx * 1.0, m.z + m.nz * 1.0], VENUE_ROUTE_R);
        for (const d of [...roomDoors, ...hallDoors]) expect(near(L, lv, seen, (d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL, 1.3), `seed ${seed}: bridge mouth -> door ${d.a}/${d.b}`).toBe(true);
        expect(near(L, lv, seen, foot[0], foot[1], 0.9), `seed ${seed}: bridge mouth -> the stage steps`).toBe(true);
      }
      // 1.2 m clear in front of every public venue door (no expo floor prop in the strip)
      for (const a of pub) for (const p of portalsOf(L, g, a).filter(q => q.door)) {
        const along = p.side === 'N' || p.side === 'S';
        const strip = {x: p.x + p.nx * 0.85, z: p.z + p.nz * 0.85, hx: along ? p.half - 0.05 : 0.6, hz: along ? 0.6 : p.half - 0.05};
        for (const q of ex.props) if (!q.mounted && q.host === undefined && q.area === a.id) {
          expect(Math.abs(q.x - strip.x) < q.hx + strip.hx && Math.abs(q.z - strip.z) < q.hz + strip.hz, `seed ${seed}: ${q.kind} in front of door ${p.door!.a}/${p.door!.b}`).toBe(false);
        }
      }

      // --- wayfinding in the expo's own style: names on the sign system, arrows along the route, no prize-car words ---
      const texts = ex.signs.map(s => s.sign.text).join(' | ');
      for (const w of ['KEYNOTE HALL', 'DEMO THEATRE', 'REGISTRATION', 'WASHROOMS']) expect(texts, `seed ${seed}: ${w}`).toContain(w);
      for (const s of ex.signs) {
        expect(L.signs).toContainEqual(s.sign);
        expect(s.sign.level).toBe(lv);
        expect(s.sign.style?.bg).toBe(0x0b1f3a);
        expect(s.sign.text).not.toMatch(/\b(driv\w*|test[- ]?drive|car|prize)\b/i);
        if (s.sign.hang && s.sign.arrow && s.target) {
          const [ax, az] = arrowDir(s.sign.rot, s.sign.arrow), dx = s.target.x - s.sign.x, dz = s.target.z - s.sign.z;
          expect(deg(angDiff(Math.atan2(ax, az), Math.atan2(dx, dz))), `seed ${seed}: "${s.sign.text}" (${s.sign.arrow}) along its route`).toBeLessThan(75);
          expect(inRect(L.areas[s.sign.area], s.target.x, s.target.z, 0.6)).toBe(true);
          expect(s.sign.y - base).toBeGreaterThanOrEqual(2.2);
        }
      }

      // --- the reused kinds' models are allowed in the Skyways (the game's own key hooks; never another level's art) ---
      const sub = {props: ex.props};
      const keys = [...officeModelKeysFor(sub), ...p7ModelKeysFor(sub as never), ...skywaysAddonModelKeysFor(sub)];
      const cat = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...MALL_MODEL_FILES, ...SKYWAYS_ADDON_MODEL_FILES};
      const sel = selectLevelKeys('skyways', keys, cat);
      expect(sel.foreign, `seed ${seed}: foreign models`).toEqual([]);
      for (const k of ['skywaysConStage', 'foldingChair', 'skywaysPrizeStanchion'] as const) if (ex.props.some(p => p.kind === k)) expect(keys.length).toBeGreaterThan(0);
    });
  }

  it('booths across the fixture seeds: a substantial floor (on average 4+ exhibitors per expo)', () => {
    const total = SEEDS.reduce((t, s) => t + expoOf(gen(s)).booths.length, 0);
    expect(total / SEEDS.length).toBeGreaterThanOrEqual(4);
  });

  it('deterministic per seed (two generations of seed 10 dress the expo identically)', () => {
    const a = expoOf(gen(10)).props, b = expoOf(LEVELS.skyways.generate('main', {levelSeed: 10, startWeapon: 'pistol', layoutVersion: 7} as never)).props;
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
  });
});
