// Task studio-skyways-rework-20261107-054512-01 (lane VENUE): the convention as a whole EVENT FLOOR and a walkable stage, on the real
// layout-version-3 seeds with a convention (4, 5, 7, 9, 13) and, for the stage, the frozen GAME77 (layout version 2) stages too:
//  - the venue's roles (gen/skyways/carve.ts carveVenue) are all there, and every public area is dressed with its signature pieces
//    (gen/skyways/venueDress.ts): registration desks + a stanchion queue (rope chains in addon.queues) + the greeter facing the bridge
//    mouth + the welcome sign; artist-alley tables with real loose stock on their tops + pop-up exhibits; panel tables, panelists and
//    audience rows facing them; the photo lounge's backdrop, posed statue and seats; nothing floats;
//  - circulation: from every bridge mouth a 1.2 m wide path (cells whose 0.6 m disc is clear) reaches every panel / photo lounge door,
//    the main stage hall, the foot of the stage's steps and the washrooms door; 1.2 m clear in front of every venue door;
//  - wayfinding: MAIN STAGE / PANEL ROOM / WASHROOMS / REGISTRATION / ARTIST ALLEY on the sign system, door plates at the doors they
//    name, hanging arrows pointing along the route;
//  - the stage (gen/skyways/stageSupport.ts): the drawn treads / deck heights of the cooked stage model are the support heights; a REAL
//    Player walks floor -> steps -> deck -> across -> steps -> floor with every step within STEP_UP and never falling, cannot walk up
//    the deck's side or through the truss line, and (layout version 3) the deck edge stands on a cell line; the stage's own boxes stop
//    blocking the body standing on them while the deck-top statue blocks at deck height; chasing zombies' paths reach the deck by the
//    steps; deterministic.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {SKYWAYS_VENUE_ART} from '../src/assets/skywaysVenueArt.generated';
import {levelOfAsset} from '../src/assets/levelAssets';
import {LEVELS} from '../src/levels/registry';
import {skywaysAddonDressOf} from '../src/gen/skyways/addon';
import {SKYWAYS_STAGE} from '../src/gen/skyways/addonKinds';
import {SKYWAYS_STAGE_DECK_EDGE, SKYWAYS_STAGE_SURFACES, SKYWAYS_STAGE_TRUSS_VARIANT, applySkywaysStageSupport, stageModelXZ, stageSurfaceAt, stageWorldXZ}
  from '../src/gen/skyways/stageSupport';
import {VENUE_ROUTE_R, arrowDir, portalsOf} from '../src/gen/skyways/venueDress';
import {SKYWAYS_MESHY_PROPS} from '../src/assets/skywaysMeshyProps.generated';
import {SKYWAYS_MERCH_TOP, SKYWAYS_TABLE_BANNER} from '../src/gen/skyways/addonKinds';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {CELL, FLOOR, PathFinder, STEP_UP} from '../src/gen/grid';
import {levelsOf, type Levels} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player} from '../src/player/player';
import {loadStripped} from './helpers/openablesFixture';
import type {Area, StationLayout} from '../src/gen/stationTypes';

const SEEDS = [4, 5, 7, 9, 13, 29]; // (29: a carve that fits the photo lounge)
const DT = 1 / 60;
const cache = new Map<string, StationLayout>();
const gen = (seed: number, layoutVersion?: number): StationLayout => {
  const key = `${seed}/${layoutVersion ?? 3}`;
  if (!cache.has(key)) cache.set(key, LEVELS.skyways.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion ? {layoutVersion} : {})} as never));
  return cache.get(key)!;
};
const deg = (r: number) => (r * 180) / Math.PI;
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
/** World point -> host-local (x, z). */
function local(host: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
const inRect = (a: Area, x: number, z: number, pad = 0) => x >= a.x * CELL - pad && x <= (a.x + a.w) * CELL + pad && z >= a.y * CELL - pad && z <= (a.y + a.h) * CELL + pad;

class Keys { held = new Set<string>(); down(c: string) { return this.held.has(c); } hit() { return false; } }
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
/** Steps a real Player toward (tx, tz) with W; per-step |dy| max and the lowest vy (a fall). */
function walkTo(p: Player, L: Levels, idx: PropIndex, tx: number, tz: number, cap = 60 * 15, tol = 0.25) {
  const keys = new Keys(); keys.held.add('KeyW');
  let maxDy = 0, minVy = 0, steps = 0;
  while (steps < cap && Math.hypot(tx - p.x, tz - p.z) > tol) {
    p.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    const y0 = p.y;
    p.update(DT, keys, L, idx, OPTS);
    maxDy = Math.max(maxDy, Math.abs(p.y - y0)); minVy = Math.min(minVy, p.vy);
    steps++;
  }
  return {reached: Math.hypot(tx - p.x, tz - p.z) <= tol, maxDy, minVy};
}

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

describe('the convention venue floor (layout version 3) on the real seeds', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: roles, dressing, circulation, wayfinding`, () => {
      const L = gen(seed), info = L.skyways!, ad = info.addon, lv = ad.level, g = L.levels[lv].grid, base = info.storeys[lv].baseY;
      expect(ad.id).toBe('convention');
      const venue = ad.venue!;
      const roles = new Set(venue.map(v => v.role));
      for (const r of ['main-hall', 'registration', 'exhibitors', 'panel', 'washrooms', 'backstage'] as const) expect(roles.has(r), `seed ${seed}: ${r}`).toBe(true);
      for (const v of venue) expect(L.areas[v.area].level ?? 0, `${v.role} on the venue storey`).toBe(lv);
      const roleOf = (id: number) => venue.find(v => v.area === id)?.role;
      const res = skywaysAddonDressOf(L)!, vr = res.venue!;
      expect(vr, `seed ${seed}: venue dressed`).toBeTruthy();
      expect(vr.skipped, `seed ${seed}: skipped`).toEqual([]);
      const pub = venue.filter(v => !['main-hall', 'washrooms', 'backstage', 'storage'].includes(v.role)).map(v => L.areas[v.area]);
      const venueProps = pub.flatMap(a => vr.byArea[a.id] ?? []);

      // --- nothing floats: floor props on the floor under them, hosted ones on their host, mounted ones on a wall ---
      for (const p of venueProps) {
        expect(p.level, p.kind).toBe(lv);
        if (p.mounted && p.host === undefined) { expect(p.y - base, `${p.kind} wall height`).toBeGreaterThan(0.5); continue; }
        if (p.host !== undefined) continue;
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(p.y, `${p.kind} on the floor`).toBeCloseTo(g.floorOf(g.idx(cx, cy)), 6);
      }

      // --- registration: desks, the queue line (rope chains of stanchions), the greeter facing a bridge mouth, the welcome sign ---
      const mouths = pub.filter(a => roleOf(a.id) === 'registration').flatMap(a => portalsOf(L, g, a).filter(p => info.bridges.some(b => b.area === p.to)));
      expect(mouths.length, `seed ${seed}: a bridge leads straight into registration`).toBeGreaterThanOrEqual(1);
      expect(vr.desks.length).toBeGreaterThanOrEqual(1);
      for (const d of vr.desks) expect(['registration', 'exhibitors']).toContain(roleOf(d.area));
      expect(ad.queues?.length, `seed ${seed}: queue line`).toBeGreaterThanOrEqual(1);
      for (const chain of ad.queues!) {
        expect(chain.length).toBeGreaterThanOrEqual(2);
        for (let i = 0; i < chain.length; i++) {
          expect(L.props[chain[i]].kind).toBe('skywaysPrizeStanchion');
          if (i) expect(Math.hypot(L.props[chain[i]].x - L.props[chain[i - 1]].x, L.props[chain[i]].z - L.props[chain[i - 1]].z)).toBeLessThanOrEqual(2.9);
        }
      }
      const greeter = vr.statues.find(s => s.role === 'registration-wave')!;
      expect(greeter, `seed ${seed}: greeter`).toBeTruthy();
      expect(greeter.pose).toBe('wave');
      const gm = mouths.map(m => ({m, d: Math.hypot(m.x - greeter.prop.x, m.z - greeter.prop.z)})).sort((p, q) => p.d - q.d)[0];
      expect(gm.d, `seed ${seed}: greeter by the bridge mouth`).toBeLessThan(14);
      expect(vr.welcome.length).toBe(1);
      const recs = ad.convention!.statues;
      expect(recs.some(s => s.role === 'registration-wave' && s.x === greeter.prop.x && s.z === greeter.prop.z)).toBe(true);

      // --- the exhibitors' floor: vendor tables with real loose stock on their tops, the pop-up exhibits ---
      // (seed 5's court is mostly its escalator well and run-outs: three tables)
      expect(vr.tables.length, `seed ${seed}: artist alley tables`).toBeGreaterThanOrEqual(3);
      for (const t of vr.tables) expect(roleOf(t.area)).toBe('exhibitors');
      const onTable = new Map<number, PropPlacement[]>();
      for (const m of vr.merch) {
        expect(['skywaysConFigureBox', 'skywaysConPlush', 'skywaysConPrintCard']).toContain(m.kind);
        const t = L.props[m.host!];
        expect(t.kind).toBe('skywaysConMerchTable');
        expect(m.y).toBeCloseTo(t.y + SKYWAYS_MERCH_TOP.y, 3);
        const [lx, lz] = local(t, m.x, m.z), d = PROP_DEFS[m.kind];
        expect(Math.abs(lx) + d.w / 2).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.x + 1e-6);
        expect(Math.abs(lz) + d.d / 2).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.z + 1e-6);
        const l = onTable.get(m.host!); if (l) l.push(m); else onTable.set(m.host!, [m]);
      }
      for (const t of vr.tables) expect((onTable.get(L.props.indexOf(t)) ?? []).length, 'stock on every vendor table').toBeGreaterThanOrEqual(3);
      for (const items of onTable.values()) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const t = L.props[items[i].host!], [ax, az] = local(t, items[i].x, items[i].z), [bx, bz] = local(t, items[j].x, items[j].z);
        const A = PROP_DEFS[items[i].kind], B = PROP_DEFS[items[j].kind];
        expect(Math.abs(ax - bx) >= (A.w + B.w) / 2 - 1e-6 || Math.abs(az - bz) >= (A.d + B.d) / 2 - 1e-6, 'merch overlaps').toBe(true);
      }
      expect(vr.exhibits.length, `seed ${seed}: pop-up exhibits`).toBeGreaterThanOrEqual(2);
      // the studios' booth banners: on the front of a vendor table's cloth, hosted on it
      expect(vr.banners.length, `seed ${seed}: booth banners`).toBeGreaterThanOrEqual(3);
      for (const b of vr.banners) {
        expect(b.kind).toBe('skywaysVenueTableBanner');
        const t = L.props[b.host!];
        expect(vr.tables).toContainEqual(t);
        const [lx, lz] = local(t, b.x, b.z);
        expect(Math.abs(lx)).toBeLessThan(1e-3);
        expect(lz).toBeCloseTo(SKYWAYS_TABLE_BANNER.z, 3);
        expect(b.rot).toBe(t.rot);
        expect(b.y - t.y).toBeCloseTo(SKYWAYS_TABLE_BANNER.y0, 3);
        expect(b.y - t.y + b.h, 'under the table top').toBeLessThan(SKYWAYS_MERCH_TOP.y);
      }
      // the registration sign on the wall behind the badge desks (above the staff)
      expect(vr.regSigns.length, `seed ${seed}: registration sign`).toBe(1);
      for (const r of vr.regSigns) { expect(r.mounted).toBe(true); expect(r.y - base).toBeCloseTo(1.3, 3); expect(Math.min(...vr.desks.map(d => Math.hypot(d.x - r.x, d.z - r.z)))).toBeLessThan(3.5); }

      // --- panel rooms (every carved one, compact ones too): the panel table, panelists behind it, audience rows facing it, its slide ---
      const panels = venue.filter(v => v.role === 'panel');
      expect(vr.panels.map(p => p.area).sort()).toEqual(panels.map(p => p.area).sort());
      for (const p of vr.panels) {
        expect(p.tables.length).toBeGreaterThanOrEqual(1);
        expect(p.panelists.length).toBeGreaterThanOrEqual(2);
        expect(p.chairs.length, `seed ${seed}: panel ${p.area} audience`).toBeGreaterThanOrEqual(4);
        const tx = p.tables.reduce((t, q) => t + q.x, 0) / p.tables.length, tz = p.tables.reduce((t, q) => t + q.z, 0) / p.tables.length;
        const facing = p.chairs.filter(c => Math.sin(c.rot) * (tx - c.x) + Math.cos(c.rot) * (tz - c.z) > 0).length;
        expect(facing / p.chairs.length, 'the audience faces the panel (a chair knocked askew now and then)').toBeGreaterThanOrEqual(0.75);
        for (const t of p.tables) expect(Math.sin(t.rot) * (p.chairs[0].x - t.x) + Math.cos(t.rot) * (p.chairs[0].z - t.z), 'the panel faces the audience').toBeGreaterThan(0);
        // the panel's title slide: on a tripod screen (deep / wide rooms) or a screen fixed to the wall behind the panel (compact rooms)
        expect(p.screen, `seed ${seed}: panel ${p.area} screen`).toBeTruthy();
        expect(['skywaysVenueScreen', 'skywaysVenueWallScreen']).toContain(p.screen!.kind);
        const sc = p.screen!;
        expect(Math.sin(sc.rot) * (p.chairs[0].x - sc.x) + Math.cos(sc.rot) * (p.chairs[0].z - sc.z), 'the screen faces the audience').toBeGreaterThan(0);
        // each room its own slide: the carve's letter (Panel room A / B)
        expect(sc.variant).toBe(L.areas[p.area].label.endsWith(' B') ? 1 : 0);
      }
      // --- the photo lounge (when the carve fitted one): the photo-op wall, seats, the posed statue (where it fits) facing its door ---
      const lounge = venue.find(v => v.role === 'photo-lounge');
      if (lounge) {
        expect(vr.photo?.area).toBe(lounge.area);
        expect(vr.photo!.backdrop.map(b => b.kind)).toEqual(['skywaysVenuePhotoWall']);
        expect(vr.photo!.seats.filter(q => q.kind !== 'pottedPlantSmall').length, 'lounge seating').toBeGreaterThanOrEqual(1);
        const pose = vr.statues.find(s => s.role === 'photo-pose');
        const door = portalsOf(L, g, L.areas[lounge.area]).find(q => q.door)!;
        if (pose) expect(deg(angDiff(pose.prop.rot, Math.atan2(door.x - pose.prop.x, door.z - pose.prop.z))), 'the pose faces the door').toBeLessThan(30);
      }

      // --- circulation: from every bridge mouth a 1.2 m path to every room door, the stage hall, the steps' foot, the washrooms ---
      const hall = venue.find(v => v.role === 'main-hall')!.area, wash = venue.filter(v => v.role === 'washrooms').map(v => v.area);
      const allowed = new Set([...pub.map(a => a.id), hall, ...wash]);
      const hallDoors = L.doors.filter(d => (d.a === hall || d.b === hall));
      const washDoor = hallDoors.find(d => wash.includes(d.a) || wash.includes(d.b))!;
      const stage = res.convention!.stage!;
      const foot = stageWorldXZ(stage, (SKYWAYS_STAGE_SURFACES[2].x0 + SKYWAYS_STAGE_SURFACES[2].x1) / 2, SKYWAYS_STAGE_SURFACES[2].z1 + 0.8);
      const roomDoors = L.doors.filter(d => [d.a, d.b].some(id => roleOf(id) === 'panel' || roleOf(id) === 'photo-lounge'));
      for (const m of mouths) {
        const seen = reachable(L, lv, allowed, [m.x + m.nx * 1.0, m.z + m.nz * 1.0], VENUE_ROUTE_R);
        for (const d of [...roomDoors, ...hallDoors.filter(q => !wash.includes(q.a) && !wash.includes(q.b) && (allowed.has(q.a) && allowed.has(q.b))), washDoor]) {
          expect(near(L, lv, seen, (d.x + d.w / 2) * CELL, (d.y + d.h / 2) * CELL, 1.3), `seed ${seed}: bridge mouth -> door ${d.a}/${d.b}`).toBe(true);
        }
        expect(near(L, lv, seen, foot[0], foot[1], 0.9), `seed ${seed}: bridge mouth -> the stage steps`).toBe(true);
      }
      // 1.2 m clear in front of every venue door (no floor prop in the strip)
      for (const a of pub) for (const p of portalsOf(L, g, a).filter(q => q.door)) {
        const along = p.side === 'N' || p.side === 'S';
        const strip = {x: p.x + p.nx * (0.25 + 0.6), z: p.z + p.nz * (0.25 + 0.6), hx: along ? p.half - 0.05 : 0.6, hz: along ? 0.6 : p.half - 0.05}; // (5 cm: props snap to cells)
        for (const q of venueProps) if (!q.mounted && q.host === undefined) {
          expect(Math.abs(q.x - strip.x) < q.hx + strip.hx && Math.abs(q.z - strip.z) < q.hz + strip.hz, `seed ${seed}: ${q.kind} ${q.x},${q.z} ${q.hx}x${q.hz} in front of door ${p.door!.a}/${p.door!.b} @${p.x},${p.z} n ${p.nx},${p.nz} half ${p.half}`).toBe(false);
        }
      }

      // --- wayfinding on the sign system: the event's names, door plates at their doors, arrows along the route ---
      const texts = vr.signs.map(s => s.sign.text).join(' | ');
      for (const w of ['MAIN STAGE', 'PANEL ROOM A', 'WASHROOMS', 'REGISTRATION', 'ARTIST ALLEY']) expect(texts, `seed ${seed}: ${w}`).toContain(w);
      for (const s of vr.signs) {
        expect(L.signs).toContainEqual(s.sign);
        expect(s.sign.level).toBe(lv);
        expect(s.sign.text).not.toMatch(/\b(driv\w*|test[- ]?drive|car|prize)\b/i);
        if (!s.sign.hang && s.target) {
          // a plate over / beside the door it names, on its own area's wall
          expect(Math.hypot(s.sign.x - s.target.x, s.sign.z - s.target.z), `plate "${s.sign.text}" at its door`).toBeLessThan(3.2);
          const d = L.doors.find(q => Math.hypot((q.x + q.w / 2) * CELL - s.target!.x, (q.y + q.h / 2) * CELL - s.target!.z) < 0.01)!;
          const behind = d.a === s.sign.area ? d.b : d.a;
          if (s.to.startsWith('PANEL ROOM')) expect(roleOf(behind)).toBe('panel');
          if (s.to === 'PHOTO LOUNGE') expect(roleOf(behind)).toBe('photo-lounge');
          if (s.to === 'MAIN STAGE') expect(roleOf(behind)).toBe('main-hall');
          if (s.to === 'WASHROOMS') expect(roleOf(behind)).toBe('washrooms');
        }
        if (s.sign.hang && s.sign.arrow && s.target) {
          const [ax, az] = arrowDir(s.sign.rot, s.sign.arrow), dx = s.target.x - s.sign.x, dz = s.target.z - s.sign.z;
          expect(deg(angDiff(Math.atan2(ax, az), Math.atan2(dx, dz))), `seed ${seed}: "${s.sign.text}" (${s.sign.arrow}) points along its route`).toBeLessThan(75);
          expect(inRect(L.areas[s.sign.area], s.target.x, s.target.z, 0.6), 'the next opening is one of its own area').toBe(true);
          expect(s.sign.y - base).toBeGreaterThanOrEqual(2.2);
        }
      }
    });
  }

  it('deterministic per seed (two generations of seed 4 dress the venue identically)', () => {
    const a = LEVELS.skyways.generate('main', {levelSeed: 4} as never), b = LEVELS.skyways.generate('main', {levelSeed: 4} as never);
    const pick = (L: StationLayout) => JSON.stringify([skywaysAddonDressOf(L)!.venue, L.skyways!.addon, L.signs.length]);
    expect(pick(a)).toBe(pick(b));
  });
});

// ---------------------------------------------------------------------------------------------

describe('the venue art (Codex initial sources; crop / pack only)', () => {
  it('one level-only atlas on file, allowlisted, its provenance naming the ledgered Codex calls; every piece a 3:2 panel', () => {
    const url = SKYWAYS_VENUE_ART.venueArt.url, pub = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
    expect(levelOfAsset(url)).toBe('skyways');
    const bytes = fs.readFileSync(pub(url));
    const allow = (JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../tools/release/public-inputs.json', import.meta.url)), 'utf8')) as {files: {path: string; bytes: number}[]}).files;
    expect(allow.find(f => f.path === url)?.bytes).toBe(bytes.length);
    const prov = JSON.parse(fs.readFileSync(pub('assets/derivatives/skyways-venue-art.json'), 'utf8')) as {output: {bytes: number}; pieces: {name: string; codex: {ledgerCall: number; generator: string}}[]};
    expect(prov.output.bytes).toBe(bytes.length);
    for (const p of prov.pieces) { expect(p.codex.ledgerCall).toBeGreaterThanOrEqual(200); expect(p.codex.ledgerCall).toBeLessThan(300); expect(p.codex.generator).toMatch(/Codex/); }
    expect(prov.pieces.map(p => p.name).sort()).toEqual(Object.keys(SKYWAYS_VENUE_ART.venueArt.pieces).sort());
    for (const [n, p] of Object.entries(SKYWAYS_VENUE_ART.venueArt.pieces)) expect(Math.abs(p.aspect - 1.5), n).toBeLessThan(0.01);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the convention stage is walkable (runtime support under the drawn deck and treads)', () => {
  let stageScene: THREE.Object3D;
  beforeAll(async () => { stageScene = (await loadStripped(SKYWAYS_MESHY_PROPS.skyways_con_stage.url)).scene; stageScene.updateMatrixWorld(true); });

  it('the support heights are the drawn deck / tread tops of the cooked stage model (cell-centre sampling)', () => {
    const ray = new THREE.Raycaster();
    const topAt = (x: number, z: number) => {
      ray.set(new THREE.Vector3(x, 1.6, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(stageScene, true)[0];
      return hit ? hit.point.y : 0;
    };
    for (const s of SKYWAYS_STAGE_SURFACES) {
      const pts = [[0.35, 0.5], [0.15, 0.2], [0.85, 0.2], [0.15, 0.8], [0.85, 0.8]]; // (x 0: the deck's centre seam)
      for (const [u, w] of pts) {
        const x = s.x0 + (s.x1 - s.x0) * u, z = s.z0 + (s.z1 - s.z0) * w;
        expect(Math.abs(topAt(x, z) - s.top), `${s.name} at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBeLessThan(0.015);
        expect(stageSurfaceAt(x, z)?.name).toBe(s.name);
      }
    }
    // the risers: just in front of each tread / the deck edge the drawn surface drops to the next one down
    const xm = 2.9;
    expect(topAt(xm, SKYWAYS_STAGE_DECK_EDGE - 0.03)).toBeCloseTo(SKYWAYS_STAGE.deckY, 1);
    expect(topAt(xm, SKYWAYS_STAGE_DECK_EDGE + 0.03)).toBeCloseTo(SKYWAYS_STAGE_SURFACES[1].top, 1);
    expect(topAt(xm, SKYWAYS_STAGE_SURFACES[1].z1 + 0.04)).toBeCloseTo(SKYWAYS_STAGE_SURFACES[2].top, 1);
    expect(topAt(xm, SKYWAYS_STAGE_SURFACES[2].z1 + 0.03)).toBeLessThan(0.01);
    // every riser is a walking step (and a step down never starts a fall)
    const tops = [0, ...SKYWAYS_STAGE_SURFACES.slice(1).map(s => s.top).reverse(), SKYWAYS_STAGE.deckY];
    for (let i = 1; i < tops.length; i++) { expect(tops[i] - tops[i - 1]).toBeLessThanOrEqual(STEP_UP); expect(tops[i] - tops[i - 1]).toBeLessThan(0.4); }
  });

  for (const [seed, version] of [[4, 3], [5, 3], [9, 3], [4, 2], [5, 2]] as const) {
    it(`seed ${seed} (layout version ${version}): a real player walks floor -> steps -> deck -> across -> steps -> floor`, () => {
      const L = gen(seed, version), sup = applySkywaysStageSupport(L);
      expect(sup.length).toBe(1);
      expect(applySkywaysStageSupport(L)).toBe(sup); // idempotent per layout
      const q = sup[0], st = q.stage, g = L.levels[q.level].grid, base = q.base;
      const names = new Set(q.cells.map(c => c.name));
      for (const n of ['deck', 'upper-tread', 'lower-tread']) expect(names.has(n), n).toBe(true);
      // every lifted cell carries the drawn surface at its centre
      for (const c of q.cells) {
        const [mx, mz] = stageModelXZ(st, (c.i % g.w + 0.5) * CELL, (Math.floor(c.i / g.w) + 0.5) * CELL);
        const s = stageSurfaceAt(mx, mz)!;
        expect(g.floorOf(c.i)).toBeCloseTo(base + s.top, 4);
      }
      if (version === 3) {
        // layout version 3: the drawn deck edge on a cell line (the upper tread exactly one cell row deep)
        const [ex, ez] = stageWorldXZ(st, 0, SKYWAYS_STAGE_DECK_EDGE), along = Math.abs(Math.sin(st.rot)) > 0.5 ? ex : ez;
        expect(Math.abs(along / CELL - Math.round(along / CELL))).toBeLessThan(1e-3);
      }
      const Lv = levelsOf(L), idx = new PropIndex(Lv, L.props);
      // the stage's own collision boxes no longer block the body on them; the deck-top statue and the truss boxes do
      const around = new Set<number>();
      idx.near(st.x - 6, st.z - 6, st.x + 6, st.z + 6, around);
      const kinds = [...around].map(i => L.props[i]);
      expect(kinds.filter(p => p.kind === 'skywaysConStage' && p.variant !== SKYWAYS_STAGE_TRUSS_VARIANT)).toEqual([]);
      expect(kinds.filter(p => p.kind === 'skywaysConStage' && p.variant === SKYWAYS_STAGE_TRUSS_VARIANT).length).toBe(3);
      expect(kinds.some(p => p.kind === 'skywaysMascotStatue' && Math.abs(p.y - (base + SKYWAYS_STAGE.deckY)) < 1e-3), 'the cheer statue blocks on the deck').toBe(true);

      const W = (mx: number, mz: number) => stageWorldXZ(st, mx, mz);
      const p = new Player();
      const [x0, z0] = W(2.9, 3.1);
      p.spawn(x0, z0, 0, 0);
      p.y = Lv.floorAt(x0, z0, base + 0.3);
      expect(p.y).toBeCloseTo(base, 4);
      const route: [string, number, number, number][] = [
        ['lower tread', 3.0, 2.4, SKYWAYS_STAGE_SURFACES[2].top], ['upper tread', 3.0, 1.9, SKYWAYS_STAGE_SURFACES[1].top], ['deck', 3.0, 1.0, SKYWAYS_STAGE.deckY],
        ['across', -2.0, 0.2, SKYWAYS_STAGE.deckY], ['back', -2.0, -1.6, SKYWAYS_STAGE.deckY], ['to the steps', 3.0, 1.2, SKYWAYS_STAGE.deckY], ['down', 2.9, 3.1, 0],
      ];
      for (const [tag, mx, mz, top] of route) {
        const r = walkTo(p, Lv, idx, ...W(mx, mz));
        expect(r.reached, `seed ${seed} v${version}: ${tag}`).toBe(true);
        expect(r.maxDy, `${tag}: every step within STEP_UP`).toBeLessThanOrEqual(0.36);
        expect(r.minVy, `${tag}: never falls`).toBe(0);
        expect(p.y - base, `${tag}: height`).toBeCloseTo(top, 3);
      }
      // into the truss line from the deck: stopped in front of it
      walkTo(p, Lv, idx, ...W(3.0, 2.4)); walkTo(p, Lv, idx, ...W(3.0, 1.0));
      walkTo(p, Lv, idx, ...W(0.0, -0.5));
      walkTo(p, Lv, idx, ...W(0.0, -3.5), 240);
      expect(stageModelXZ(st, p.x, p.z)[1], 'the backdrop / truss line stops the body').toBeGreaterThan(-2.34 + 0.25);
      expect(p.y - base).toBeCloseTo(SKYWAYS_STAGE.deckY, 3);
      // from the floor into the deck's side: a 1 m ledge, never climbed
      const p2 = new Player();
      const [sx, sz] = W(-4.8, 0.0);
      p2.spawn(sx, sz, 0, 0); p2.y = Lv.floorAt(sx, sz, base + 0.3);
      walkTo(p2, Lv, idx, ...W(-2.0, 0.0), 240);
      expect(p2.y).toBeCloseTo(base, 4);
      expect(stageModelXZ(st, p2.x, p2.z)[0]).toBeLessThan(-4.0 + 1e-3);
      // chasing zombies' paths: from the floor in front of the steps onto the deck, by the treads
      const pf = new PathFinder(Lv);
      const [dx, dz] = W(0.0, 0.0);
      const path = pf.find(x0, z0, dx, dz, 0.3, 26000, {ay: base, by: base + SKYWAYS_STAGE.deckY, drops: true});
      expect(path, `seed ${seed} v${version}: a path up the steps`).toBeTruthy();
      expect(Math.abs((path![path!.length - 1][3] ?? 0) - (base + SKYWAYS_STAGE.deckY))).toBeLessThan(0.05);
      // nobody spawns inside the stage
      for (const zb of L.zombies) {
        const [mx, mz] = stageModelXZ(st, zb.x, zb.z);
        expect(!!stageSurfaceAt(mx, mz) && (zb.level ?? 0) === q.level, 'a zombie spawned inside the stage').toBe(false);
      }
    });
  }
});
