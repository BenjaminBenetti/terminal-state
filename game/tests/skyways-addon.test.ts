// Task studio-skyways-level-20261106-054448 (lane ADDON): the Skyways ADD-ON dressing — the anime convention hall and the prize-car
// atrium (gen/skyways/addon.ts + addonConvention.ts / addonPrize.ts / addonFrame.ts), the add-on kinds (gen/skyways/addonKinds.ts),
// their renderer (world/skywaysAddon.ts) and the turntable / velvet-rope runtime (world/skywaysAddonRuntime.ts):
//  - kinds: PROP_DEFS / PROP_DAMAGE / PROP_PHYSICS_AUDIT / OPENABLE_AUDIT rows, the live physics class, the lazy level-only models
//    (bytes = the files), the measured stage / table / stanchion geometry against the cooked GLBs, the art faces' atlas pieces;
//  - the convention on the real seeds (4, 5, 7, 9, 13): the statue set / roles / poses recorded in the contract, `point` aims its hand at
//    the washroom door (<= 10 deg), `wave` faces the entry, the stage at real size inside the hall against the wall opposite the entry,
//    loose merch supported on the table tops (never floating / overlapping), clear walking lanes entry -> stage / washrooms, 1.2 m+
//    in front of every door, posters never over glazing / doors, banners >= 2.2 m clear, deterministic, validation clean;
//  - the prize car on the real seeds (1, 2, 3, 6, 8): nothing within the car body + 1.2 m, the exit lane clear, the stanchion ring
//    outside that radius and open over the lane, the ropes between neighbours only, the prize board facing the entry, no text about
//    driving anywhere;
//  - the renderer (real GLBs, textures stripped): every kind drawn (`prop-<kind>`), the stage's deck on its collision box, a mesh per
//    statue pose, art quads on their atlas pieces; the runtime: turntable at the car spot (render only), ropes hang between upright
//    posts and DROP to the floor for good when a post is shot over (real physics);
//  - movable things move: a stanchion shot / walked into goes loose; merch is knocked off its static table (host slab).
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {LEVELS} from '../src/levels/registry';
import {skywaysIssues} from '../src/gen/skyways/index';
import {skywaysAddonDressOf} from '../src/gen/skyways/addon';
import {skywaysAddonDressOf as legacyAddonDressOf} from '../src/gen/skyways/legacy77/addon';
import {skywaysIssues as legacyIssues} from '../src/gen/skyways/legacy77/validate';
import {SKYWAYS_ADDON_KINDS, SKYWAYS_ADDON_MODEL_FILES, SKYWAYS_ADDON_PHYS, SKYWAYS_MASCOT_MODEL_KEY, SKYWAYS_MASCOT_POSES, SKYWAYS_MERCH_TOP,
  SKYWAYS_STAGE, SKYWAYS_STAGE_DECK_D, SKYWAYS_STAGE_MODEL_SHIFT, SKYWAYS_STANCHION, SKYWAYS_STATUE_PLINTH, isSkywaysAddonKind, skywaysAddonModelKey,
  skywaysAddonModelKeysFor, skywaysAddonShape, type SkywaysAddonKind} from '../src/gen/skyways/addonKinds';
import {CON_DOOR_CLEAR} from '../src/gen/skyways/addonConvention';
import {SKYWAYS_PRIZE_LANE_HALF, SKYWAYS_PRIZE_RING, SKYWAYS_ROPE, SKYWAYS_TURNTABLE_R} from '../src/gen/skyways/addonPrize';
import {doorPoint} from '../src/gen/skyways/addonFrame';
import {SKYWAYS_MASCOT} from '../src/assets/skywaysMascot.generated';
import {SKYWAYS_MESHY_PROPS} from '../src/assets/skywaysMeshyProps.generated';
import {SKYWAYS_ART, SKYWAYS_CON_BANNERS, SKYWAYS_CON_POSTERS} from '../src/assets/skywaysArt.generated';
import {SKYWAYS_CAR} from '../src/assets/skywaysCar.generated';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {dynamicKind} from '../src/physics/dynamicItems';
import {PhysicsSystem} from '../src/physics/world';
import {SHOT_IMPULSE_PER_DAMAGE} from '../src/damage/system';
import {levelOfAsset} from '../src/assets/levelAssets';
import {CELL, FLOOR, Grid, SOLID} from '../src/gen/grid';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {PropDamage} from '../src/damage/propDamage';
import {setSkywaysAddonArtMaterial, skywaysAddonArtLoaded, skywaysAddonFit} from '../src/world/skywaysAddon';
import {SkywaysAddonRuntime, planRopes, ropeLine, ROPE_TUBE} from '../src/world/skywaysAddonRuntime';
import {fakeEnvTextures, loadStripped} from './helpers/openablesFixture';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import type {Area, StationLayout} from '../src/gen/stationTypes';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const PUB = (rel: string) => fileURLToPath(new URL('../public/' + rel, import.meta.url));
const DT = 1 / 60;
const PELLET = 15 * SHOT_IMPULSE_PER_DAMAGE;
const CONVENTION_SEEDS = [4, 5, 7, 9, 13];
const PRIZE_SEEDS = [1, 2, 3, 6, 8];
const DRIVE_WORDS = /\b(driv\w*|test[- ]?drive|get in|ride|keys?|enter(able)?|usable|take it|yours to)\b/i;
const deg = (r: number) => (r * 180) / Math.PI;
const angDiff = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

const layouts = new Map<number, StationLayout>();
const gen = (seed: number): StationLayout => {
  let L = layouts.get(seed);
  if (!L) layouts.set(seed, (L = LEVELS.skyways.generate('main', {levelSeed: seed} as never)));
  return L;
};
/** (task studio-skyways-rework-20261107-054512-01) a station entered before the rework: the frozen GAME77 generator (layout version 2). */
const layouts77 = new Map<number, StationLayout>();
const gen77 = (seed: number): StationLayout => {
  let L = layouts77.get(seed);
  if (!L) layouts77.set(seed, (L = LEVELS.skyways.generate('main', {levelSeed: seed, layoutVersion: 2} as never)));
  return L;
};
/** World point -> host-local (x, z) (inverse of the dressers' toWorld). */
function local(host: {x: number; z: number; rot: number}, x: number, z: number): [number, number] {
  const c = Math.cos(host.rot), s = Math.sin(host.rot), dx = x - host.x, dz = z - host.z;
  return [c * dx - s * dz, s * dx + c * dz];
}
const hallRect = (a: Area) => ({x0: a.x * CELL, z0: a.y * CELL, x1: (a.x + a.w) * CELL, z1: (a.y + a.h) * CELL});
const boxesOverlap = (p: PropPlacement, q: {x: number; z: number; hx: number; hz: number}, pad = 0) => Math.abs(p.x - q.x) < p.hx + q.hx + pad && Math.abs(p.z - q.z) < p.hz + q.hz + pad;
/** Distance from a point to a segment. */
function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz, t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
/** Distance from an axis-aligned box to a segment (sampled on the box outline + centre). */
function boxSegDist(p: PropPlacement, ax: number, az: number, bx: number, bz: number): number {
  let m = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) {
    if (i > 0 && i < 8 && j > 0 && j < 8) continue;
    m = Math.min(m, segDist(p.x - p.hx + (2 * p.hx * i) / 8, p.z - p.hz + (2 * p.hz * j) / 8, ax, az, bx, bz));
  }
  // a box straddling the segment
  if (segDist(p.x, p.z, ax, az, bx, bz) < Math.min(p.hx, p.hz)) m = 0;
  return m;
}
/** BFS on cells whose centre has a free disc of radius r (Grid.circleClear: FLOOR, no blocking prop). */
function reach(L: StationLayout, level: number, from: [number, number], to: [number, number], r: number): boolean {
  const g = L.levels[level].grid;
  const ok = (cx: number, cy: number) => g.inBounds(cx, cy) && g.circleClear((cx + 0.5) * CELL, (cy + 0.5) * CELL, r);
  const [sx, sy] = g.cellOf(from[0], from[1]), [tx, ty] = g.cellOf(to[0], to[1]);
  const seen = new Uint8Array(g.w * g.h), q: number[] = [sx, sy];
  seen[g.idx(sx, sy)] = 1;
  for (let i = 0; i < q.length; i += 2) {
    const x = q[i], y = q[i + 1];
    if (Math.abs(x - tx) <= 1 && Math.abs(y - ty) <= 1) return true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!g.inBounds(nx, ny) || seen[g.idx(nx, ny)] || !ok(nx, ny)) continue;
      seen[g.idx(nx, ny)] = 1;
      q.push(nx, ny);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------

describe('add-on kinds: registered, classified in both audits, models / art on file', () => {
  it('every kind has a footprint, a never-breaking damage class, one openables row and a physics row that agrees with the live physics', () => {
    expect(SKYWAYS_ADDON_KINDS.length).toBe(13);
    for (const k of SKYWAYS_ADDON_KINDS) {
      expect(isSkywaysAddonKind(k)).toBe(true);
      expect(/^[A-Za-z]+$/.test(k), `${k}: prop-<kind> mesh names (damage/propDamage.ts NAME_RE)`).toBe(true);
      const def = PROP_DEFS[k];
      expect(def.w * def.d * def.h, k).toBeGreaterThan(0);
      expect(PROP_DAMAGE[k], k).toMatchObject({breaks: 'never'});
      expect(OPENABLE_AUDIT.filter(r => r.kind === k).length, k).toBe(1);
      const row = PROP_PHYSICS_AUDIT[k], ph = SKYWAYS_ADDON_PHYS[k];
      expect(row, k).toMatchObject({src: 'skyways', cls: ph.dynamic ? 'dynamic' : 'static'});
      expect(dynamicKind(k), k).toBe(ph.dynamic);
      if (ph.dynamic) {
        // calibrated pad contact + contact wake (rule 2: walked into, they move), plausible masses
        expect(propPhysics(k), k).toMatchObject({dynamic: true, mat: 'pad', contact: true, mass: ph.mass});
        expect(ph.mass).toBeGreaterThan(0.5);
        expect(ph.mass).toBeLessThanOrEqual(15);
        expect(!!propPhysics(k).onHost, k).toBe(['skywaysConFigureBox', 'skywaysConPlush', 'skywaysConPrintCard'].includes(k));
      } else expect(row.why, k).toBeTruthy();
    }
    // the classes the brief asks for
    for (const k of ['skywaysPrizeStanchion', 'skywaysPrizeBoard', 'skywaysConPosterBoard', 'skywaysConWelcome']) expect(PROP_PHYSICS_AUDIT[k].cls, k).toBe('dynamic');
    expect(PROP_PHYSICS_AUDIT.skywaysMascotStatue).toMatchObject({cls: 'static', why: 'anchored'});
    expect(PROP_PHYSICS_AUDIT.skywaysConStage).toMatchObject({cls: 'static', why: 'structure'});
    expect(PROP_PHYSICS_AUDIT.skywaysConMerchTable.cls).toBe('static');
    for (const k of ['skywaysConPoster', 'skywaysConBanner', 'skywaysConBackdrop']) expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({cls: 'static', why: 'mounted'});
    expect(OPENABLE_AUDIT.find(r => r.kind === 'skywaysConFigureBox')!.cls).toBe('exception');
  });

  it('lazy level-only models: keys = file names, bytes = the files, only the kinds a layout placed', () => {
    for (const [key, f] of Object.entries(SKYWAYS_ADDON_MODEL_FILES)) {
      expect(f.url).toBe(`assets/models/${key}.glb`);
      expect(levelOfAsset(f.url), key).toBe('skyways');
      expect(fs.statSync(PUB(f.url)).size, key).toBe(f.bytes);
    }
    expect(skywaysAddonModelKey('skywaysMascotStatue')).toBe(SKYWAYS_MASCOT_MODEL_KEY);
    expect(skywaysAddonModelKey('skywaysConPoster')).toBeNull();
    expect(skywaysAddonModelKeysFor({props: [{kind: 'bench'}, {kind: 'skywaysConStage'}, {kind: 'skywaysMascotStatue'}, {kind: 'skywaysConPoster'}]}))
      .toEqual(['skyways-con-stage', 'skyways-mascot-poses']);
    expect(skywaysAddonModelKeysFor({props: [{kind: 'bench'}]})).toEqual([]);
  });

  it('measured geometry agrees with the cooked GLBs: stage deck / steps / truss, the merch table top, the stanchion ring', async () => {
    const box = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o);
    const stage = await loadStripped(SKYWAYS_MESHY_PROPS.skyways_con_stage.url);
    const pos: THREE.Vector3[] = [];
    stage.scene.updateMatrixWorld(true);
    stage.scene.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i++) pos.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld)); });
    const b = box(stage.scene);
    expect(b.max.x - b.min.x).toBeCloseTo(8, 2);
    expect(b.min.z).toBeCloseTo(SKYWAYS_STAGE.deckZ0, 2);
    // the deck: geometry at the deck height spans the deck box; nothing at deck height in front of the deck front but the steps
    const deck = pos.filter(p => Math.abs(p.y - SKYWAYS_STAGE.deckY) < 0.03);
    expect(Math.max(...deck.map(p => p.z))).toBeLessThan(SKYWAYS_STAGE.deckZ1 + 0.05);
    const front = pos.filter(p => p.z > SKYWAYS_STAGE.deckZ1 + 0.05 && p.y > 0.05);
    for (const p of front) { expect(p.x).toBeGreaterThan(SKYWAYS_STAGE.steps.x0 - 0.05); expect(p.x).toBeLessThan(SKYWAYS_STAGE.steps.x1 + 0.05); expect(p.y).toBeLessThan(SKYWAYS_STAGE.steps.h + 0.02); }
    // the backdrop plane behind the truss uprights and the beam, inside the truss opening
    const truss = pos.filter(p => p.y > SKYWAYS_STAGE.deckY + 0.2 && p.y < SKYWAYS_STAGE.beamY - 0.05 && Math.abs(p.x) < 2.45);
    for (const p of truss) expect(p.z, 'only the hung speakers / nothing behind the backdrop plane').toBeGreaterThan(SKYWAYS_STAGE.trussBackZ - 0.04);
    expect(SKYWAYS_STAGE_DECK_D).toBeCloseTo(SKYWAYS_STAGE.deckZ1 - SKYWAYS_STAGE.deckZ0, 6);
    // merch table: the cloth top plateau within x +-0.92, z +-0.39 at topY
    const table = await loadStripped(SKYWAYS_MESHY_PROPS.skyways_con_merch_table.url);
    const tp: THREE.Vector3[] = [];
    table.scene.updateMatrixWorld(true);
    table.scene.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; const a = m.geometry.attributes.position; for (let i = 0; i < a.count; i++) tp.push(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld)); });
    const top = tp.filter(p => p.y > SKYWAYS_MERCH_TOP.y - 0.03);
    expect(Math.max(...top.map(p => Math.abs(p.x)))).toBeLessThan(SKYWAYS_MERCH_TOP.x + 0.02);
    expect(Math.max(...top.map(p => Math.abs(p.z)))).toBeLessThan(SKYWAYS_MERCH_TOP.z + 0.02);
    expect(Math.max(...tp.map(p => p.y))).toBeCloseTo(SKYWAYS_MERCH_TOP.y, 2);
    const st = box((await loadStripped(SKYWAYS_MESHY_PROPS.skyways_prize_stanchion.url)).scene);
    expect(st.max.x - st.min.x).toBeCloseTo(SKYWAYS_STANCHION.radius * 2, 2);
    expect(SKYWAYS_STANCHION.ringY).toBeGreaterThan(0.8);
  });

  it('art faces show existing atlas pieces at their aspect; nothing printed / named about driving the car', () => {
    for (const k of SKYWAYS_ADDON_KINDS) for (let v = 0; v < 8; v++) for (const f of skywaysAddonShape(k, v).faces) {
      const piece = (SKYWAYS_ART[f.atlas].pieces as Record<string, {aspect: number}>)[f.piece];
      expect(piece, `${k} ${f.piece}`).toBeTruthy();
      expect(Math.abs(f.w / f.h - piece.aspect) / piece.aspect, `${k} ${f.piece} aspect`).toBeLessThan(0.02);
    }
    // the prize-car add-on's art is the prize-draw board only; no art / kind / audit sentence suggests the car can be driven or entered
    expect(Object.keys(SKYWAYS_ART.prizeBoard.pieces)).toEqual(['board']);
    for (const k of ['skywaysPrizeBoard', 'skywaysPrizeStanchion'] as const) {
      expect(SKYWAYS_ADDON_PHYS[k].how, k).not.toMatch(DRIVE_WORDS);
      expect(OPENABLE_AUDIT.find(r => r.kind === k)!.how, k).not.toMatch(DRIVE_WORDS);
    }
    for (const a of Object.values(SKYWAYS_ART)) for (const name of Object.keys(a.pieces)) expect(name).not.toMatch(DRIVE_WORDS);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the convention hall on the real seeds', () => {
  for (const seed of CONVENTION_SEEDS) {
    it(`seed ${seed}: stage, statues, merch, lanes, doors, posters, banners`, () => {
      const L = gen(seed), info = L.skyways!, ad = info.addon, res = skywaysAddonDressOf(L)!, c = res.convention!;
      expect(ad.id).toBe('convention');
      expect(res.skipped, `seed ${seed} skipped`).toEqual([]);
      expect(skywaysIssues(L), `seed ${seed} validation`).toEqual([]);
      const hall = L.areas[ad.areas[0]], hr = hallRect(hall), base = info.storeys[ad.level].baseY;
      const g = L.levels[ad.level].grid;
      const mine = res.props;
      // nothing floats: floor props on the hall floor, hosted ones on their host's top, mounted ones on their wall / under the ceiling
      for (const p of mine) {
        expect(p.level, p.kind).toBe(ad.level);
        if (p.host !== undefined) continue;
        if (p.mounted) continue;
        const [cx, cy] = g.cellOf(p.x, p.z);
        expect(p.y, `${p.kind} on the floor`).toBeCloseTo(g.floorOf(g.idx(cx, cy)), 6);
      }

      // --- the stage: real size, inside the hall, back to the wall opposite the entry ---
      // (the entry: the hall's door to the network — or to its foyer, an add-on area of concourse kind)
      const outside = (id: number) => !ad.areas.includes(id) || L.areas[id]?.kind === 'concourse';
      const entry = L.doors.find(q => (q.a === hall.id || q.b === hall.id) && outside(q.a === hall.id ? q.b : q.a))!;
      const stage = c.stage!, E = doorPoint(entry, hall);
      expect(stage.kind).toBe('skywaysConStage');
      expect(PROP_DEFS.skywaysConStage.w).toBe(SKYWAYS_MESHY_PROPS.skyways_con_stage.w);
      const sr = ad.convention!.stage;
      expect(sr.x0).toBeGreaterThanOrEqual(hr.x0 - 1e-6); expect(sr.x1).toBeLessThanOrEqual(hr.x1 + 1e-6);
      expect(sr.z0).toBeGreaterThanOrEqual(hr.z0 - 1e-6); expect(sr.z1).toBeLessThanOrEqual(hr.z1 + 1e-6);
      expect(Math.max(sr.x1 - sr.x0, sr.z1 - sr.z0)).toBeCloseTo(8, 3); // the model's width along the wall
      expect(Math.min(sr.x1 - sr.x0, sr.z1 - sr.z0)).toBeCloseTo(SKYWAYS_MESHY_PROPS.skyways_con_stage.d, 2); // deck + steps
      // against the back wall (the entry's opposite side), its front (+Z) facing the entry
      const back = {N: hr.z0 - sr.z0, S: sr.z1 - hr.z1, W: hr.x0 - sr.x0, E: sr.x1 - hr.x1}[{N: 'S', S: 'N', W: 'E', E: 'W'}[E.side] as 'N'];
      expect(Math.abs(back), `seed ${seed}: stage back to the wall`).toBeLessThan(0.35);
      expect(Math.cos(stage.rot) * E.nz * -1 + Math.sin(stage.rot) * E.nx * -1, 'faces the entry').toBeGreaterThan(0.99);
      expect(c.steps).toMatchObject({kind: 'skywaysConStage', variant: 1});
      expect(c.backdrop).toMatchObject({kind: 'skywaysConBackdrop', mounted: true});
      expect(c.backdrop!.y).toBeCloseTo(base + SKYWAYS_STAGE.deckY + 0.08, 4);
      expect(c.backdrop!.y + c.backdrop!.h).toBeLessThan(base + SKYWAYS_STAGE.beamY);

      // --- statues: the set, roles, poses, recorded in the contract ---
      const recs = ad.convention!.statues;
      const roles = recs.map(s => s.role);
      for (const r of ['entrance-wave', 'washroom-point', 'stage-cheer', 'merch-bow']) expect(roles, `seed ${seed}`).toContain(r);
      const want: Record<string, string> = {'entrance-wave': 'wave', 'washroom-point': 'point', 'stage-cheer': 'cheer', 'merch-bow': 'bow', 'green-room-stand': 'stand'};
      for (const s of recs) {
        expect(s.pose).toBe(want[s.role]);
        expect(s.level).toBe(ad.level);
        const p = mine.find(q => q.kind === 'skywaysMascotStatue' && q.x === s.x && q.z === s.z)!;
        expect(p, s.role).toBeTruthy();
        expect(SKYWAYS_MASCOT_POSES[p.variant]).toBe(s.pose);
        expect(p.round).toBe(true);
        expect(s.yaw).toBe(p.rot);
        expect(s.y).toBeCloseTo(p.y + SKYWAYS_STATUE_PLINTH.h, 3);
        expect(p.h).toBeCloseTo(SKYWAYS_STATUE_PLINTH.h + SKYWAYS_MASCOT.poses[s.pose as 'stand'].h * s.scale, 3);
        if (s.role === 'stage-cheer') expect(s.y).toBeCloseTo(stage.y + SKYWAYS_STAGE.deckY + SKYWAYS_STATUE_PLINTH.h, 3);
        else expect(s.y).toBeCloseTo(base + SKYWAYS_STATUE_PLINTH.h, 3);
      }
      // `point`: the hand's direction (model frame, turned by the yaw) aims at the washroom door within 10 degrees
      const pt = recs.find(s => s.role === 'washroom-point')!, wd = doorPoint(c.washroomDoor!, hall);
      const pd = SKYWAYS_MASCOT.poses.point.pointDir, cy = Math.cos(pt.yaw), sy = Math.sin(pt.yaw);
      const hand = Math.atan2(pd[0] * cy + pd[1] * sy, -pd[0] * sy + pd[1] * cy), toDoor = Math.atan2(wd.x - pt.x, wd.z - pt.z);
      expect(deg(angDiff(hand, toDoor)), `seed ${seed}: point -> washrooms`).toBeLessThanOrEqual(10);
      expect(Math.hypot(wd.x - pt.x, wd.z - pt.z)).toBeGreaterThan(3);
      expect(L.areas[c.washroomDoor!.a === hall.id ? c.washroomDoor!.b : c.washroomDoor!.a].type).toBe('washroom');
      // `wave`: facing the entry (its front toward the opening), close to it
      const wv = recs.find(s => s.role === 'entrance-wave')!;
      expect(deg(angDiff(wv.yaw, Math.atan2(E.x - wv.x, E.z - wv.z))), 'wave faces the entry').toBeLessThan(25);
      expect(Math.hypot(E.x - wv.x, E.z - wv.z)).toBeLessThan(5);

      // --- merch: separate loose props supported on the real table tops, never overlapping ---
      expect(c.tables.length, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(c.merch.length).toBeGreaterThanOrEqual(c.tables.length * 3);
      const byTable = new Map<number, PropPlacement[]>();
      for (const m of c.merch) {
        expect(['skywaysConFigureBox', 'skywaysConPlush', 'skywaysConPrintCard']).toContain(m.kind);
        const t = L.props[m.host!];
        expect(t.kind).toBe('skywaysConMerchTable');
        expect(m.y, 'on the cloth top').toBeCloseTo(t.y + SKYWAYS_MERCH_TOP.y, 3);
        expect(m.rot).toBe(t.rot);
        const [lx, lz] = local(t, m.x, m.z), d = PROP_DEFS[m.kind];
        expect(Math.abs(lx) + d.w / 2).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.x + 1e-6);
        expect(Math.abs(lz) + d.d / 2).toBeLessThanOrEqual(SKYWAYS_MERCH_TOP.z + 1e-6);
        const l = byTable.get(m.host!); if (l) l.push(m); else byTable.set(m.host!, [m]);
      }
      for (const items of byTable.values()) for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const t = L.props[items[i].host!], [ax, az] = local(t, items[i].x, items[i].z), [bx, bz] = local(t, items[j].x, items[j].z);
        const A = PROP_DEFS[items[i].kind], B = PROP_DEFS[items[j].kind];
        expect(Math.abs(ax - bx) >= (A.w + B.w) / 2 - 1e-6 || Math.abs(az - bz) >= (A.d + B.d) / 2 - 1e-6, 'merch overlaps').toBe(true);
      }
      for (const t of c.tables) expect(L.props.filter(p => p !== t && !p.mounted && p.host === undefined && p.h > 0 && (p.level ?? 0) === ad.level && boxesOverlap(p, t, -0.01))
        .map(p => `${p.kind} ${p.x},${p.z} ${p.hx}x${p.hz} vs table ${t.x},${t.z} ${t.hx}x${t.hz}`)).toEqual([]);
      expect(c.chairs.length).toBeGreaterThanOrEqual(12);
      for (const ch of c.chairs) expect(ch.kind).toBe('foldingChair');

      // --- lanes: entry -> stage front, entry -> washrooms walkable 1.1 m wide; no prop of the hall on the lanes ---
      const ein: [number, number] = [E.x + E.nx * 0.75, E.z + E.nz * 0.75];
      for (const l of c.lanes) {
        expect(reach(L, ad.level, ein, [l.bx, l.bz], 0.55), `seed ${seed}: lane to ${l.to}`).toBe(true);
        for (const p of mine) if (!p.mounted && p.host === undefined) expect(boxSegDist(p, l.ax, l.az, l.bx, l.bz), `${p.kind} on the ${l.to} lane`).toBeGreaterThan(0.45);
      }
      expect(c.lanes.some(l => l.to === 'washrooms')).toBe(true);
      // --- 1.2 m clear in front of every door of the hall ---
      for (const d of L.doors) {
        if (d.a !== hall.id && d.b !== hall.id) continue;
        const dp = doorPoint(d, hall), along = dp.side === 'N' || dp.side === 'S';
        const strip = {x: dp.x + dp.nx * (0.25 + 0.6), z: dp.z + dp.nz * (0.25 + 0.6), hx: along ? dp.half : 0.6, hz: along ? 0.6 : dp.half};
        for (const p of mine) if (!p.mounted && p.host === undefined) expect(boxesOverlap(p, strip), `seed ${seed}: ${p.kind} in front of a door`).toBe(false);
      }
      expect(CON_DOOR_CLEAR).toBeGreaterThanOrEqual(1.2);

      // --- posters: all eight designs once (walls, then boards); wall ones never over glazing; banners hung >= 2.2 m clear ---
      expect([...c.posters, ...c.boards].map(p => p.variant).sort((a, b) => a - b)).toEqual(SKYWAYS_CON_POSTERS.map((_, i) => i));
      const wins = info.windows.filter(w => w.level === ad.level);
      for (const p of c.posters) {
        expect(p.mounted).toBe(true);
        // the wall run behind it (within 0.6 m across the wall, overlapping along it) holds no glazing at the poster's height
        const along = p.hx > p.hz;
        const hit = wins.some(w => (along ? w.x0 < p.x + p.hx - 0.01 && w.x1 > p.x - p.hx + 0.01 && w.z1 > p.z - 0.6 && w.z0 < p.z + 0.6
          : w.z0 < p.z + p.hz - 0.01 && w.z1 > p.z - p.hz + 0.01 && w.x1 > p.x - 0.6 && w.x0 < p.x + 0.6) && w.sill < p.y - base + p.h && w.head > p.y - base);
        expect(hit, 'poster over glazing').toBe(false);
      }
      expect(c.banners.map(b => b.variant).sort()).toEqual(SKYWAYS_CON_BANNERS.map((_, i) => i));
      for (const b of c.banners) {
        expect(b.y - base).toBeGreaterThanOrEqual(2.2);
        expect(b.y + b.h).toBeLessThanOrEqual(g.ceilAt(b.x, b.z) + 1e-6);
      }
      expect(c.welcome).toBeTruthy();
      expect(c.booth.length).toBeGreaterThanOrEqual(2);
    });
  }

  it('deterministic per seed (two generations of seed 4 dress identically)', () => {
    const a = LEVELS.skyways.generate('main', {levelSeed: 4} as never), b = LEVELS.skyways.generate('main', {levelSeed: 4} as never);
    const pick = (L: StationLayout) => JSON.stringify([skywaysAddonDressOf(L)!.props, L.skyways!.addon]);
    expect(pick(a)).toBe(pick(b));
  });
});

// ---------------------------------------------------------------------------------------------

describe('the prize-car atrium on the real seeds', () => {
  /** True distance (m) from a prop's box (or a round prop's circle) to the car body (4.78 x 2.11 m at the spawn yaw); 0 when they overlap. */
  function bodyDist(car: {x: number; z: number; yaw: number}, p: PropPlacement): number {
    const fx = -Math.sin(car.yaw), fz = -Math.cos(car.yaw), hl = SKYWAYS_CAR.length / 2, hw = SKYWAYS_CAR.width / 2;
    const d = (x: number, z: number) => { const dx = x - car.x, dz = z - car.z, lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx; return Math.hypot(Math.max(0, Math.abs(lz) - hl), Math.max(0, Math.abs(lx) - hw)); };
    if (p.round) return Math.max(0, d(p.x, p.z) - p.hx);
    let m = d(p.x, p.z) === 0 ? 0 : Infinity;
    for (let i = 0; i <= 16; i++) for (const [x, z] of [[p.x - p.hx + (2 * p.hx * i) / 16, p.z - p.hz], [p.x - p.hx + (2 * p.hx * i) / 16, p.z + p.hz], [p.x - p.hx, p.z - p.hz + (2 * p.hz * i) / 16], [p.x + p.hx, p.z - p.hz + (2 * p.hz * i) / 16]]) m = Math.min(m, d(x, z));
    // a body corner inside the box
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = car.x + fx * hl * a - fz * hw * b, z = car.z + fz * hl * a + fx * hw * b; if (Math.abs(x - p.x) < p.hx && Math.abs(z - p.z) < p.hz) m = 0; }
    return m;
  }

  for (const seed of PRIZE_SEEDS) {
    it(`GAME77 showroom (layout version 2), seed ${seed}: car spot + exit lane clear, stanchion ring outside the body + 1.2 m, ropes, board facing the entry`, () => {
      const L = gen77(seed), info = L.skyways!, ad = info.addon, res = legacyAddonDressOf(L)!, pz = res.prize!;
      expect(ad.id).toBe('prize-car');
      expect(res.skipped, `seed ${seed}`).toEqual([]);
      expect(legacyIssues(L), `seed ${seed} validation`).toEqual([]);
      const car = ad.car!, hall = L.areas[ad.areas[0]];
      // nothing at all within the car body + 1.2 m (any prop of the storey, the stanchions included)
      for (const p of L.props) if ((p.level ?? 0) === car.level && p.h > 0) expect(bodyDist(car, p), `seed ${seed}: ${p.kind} within the car body + 1.2 m`).toBeGreaterThanOrEqual(1.2);
      // the exit lane (car -> entry, the car's width + 2 x 1.2 m) clear of every prop
      const lane = pz.lane!;
      expect(lane.half).toBeCloseTo(SKYWAYS_PRIZE_LANE_HALF, 6);
      for (const p of L.props) if ((p.level ?? 0) === car.level && ad.areas.includes(p.area) && !p.mounted) expect(boxSegDist(p, lane.ax, lane.az, lane.bx, lane.bz), `seed ${seed}: ${p.kind} in the exit lane`).toBeGreaterThan(lane.half - 1e-6);
      expect(reach(L, car.level, [car.x, car.z], [lane.bx, lane.bz], SKYWAYS_CAR.width / 2 + 0.1), `seed ${seed}: the car's way out`).toBe(true);
      // the stanchions: a ring round the spot outside the clearance, every post round / upright on the floor
      expect(pz.stanchions.length, `seed ${seed}`).toBeGreaterThanOrEqual(7);
      for (const s of pz.stanchions) {
        expect(Math.hypot(s.x - car.x, s.z - car.z)).toBeCloseTo(SKYWAYS_PRIZE_RING, 1);
        expect(s.y).toBeCloseTo(car.y, 6);
        expect(dynamicKind(s.kind)).toBe(true);
      }
      // the ropes: neighbours only (never across the lane), each within its reach
      const ropes = planRopes(L);
      expect(ropes.length).toBeGreaterThanOrEqual(pz.stanchions.length - 2);
      expect(ropes.length).toBeLessThan(pz.stanchions.length); // the lane's side stays open
      for (const r of ropes) {
        expect(Math.hypot(r.a.x - r.b.x, r.a.z - r.b.z)).toBeLessThanOrEqual(SKYWAYS_ROPE.maxSpan);
        expect(segDist((r.a.x + r.b.x) / 2, (r.a.z + r.b.z) / 2, lane.ax, lane.az, lane.bx, lane.bz)).toBeGreaterThan(lane.half);
      }
      // the prize board: on its stand, facing the entry (the quarter turn nearest the direction to it)
      const b = pz.board!;
      expect(b.kind).toBe('skywaysPrizeBoard');
      expect(deg(angDiff(b.rot, Math.atan2(lane.bx - b.x, lane.bz - b.z))), 'board faces the entry').toBeLessThanOrEqual(46);
      expect(pz.planters.length).toBeGreaterThanOrEqual(2);
      // no sign in the add-on says anything about the car
      for (const sg of L.signs) if (ad.areas.includes(sg.area)) expect(sg.text).not.toMatch(DRIVE_WORDS);
      void hall;
    });
  }

  // (layout version 3; user: "prize car in public walkway / atrium, not separate room") the PRIZE DISPLAY in the host's skyway court
  for (const seed of PRIZE_SEEDS) {
    it(`public display (layout version 3), seed ${seed}: in the skyway court, car spot + exit lane clear, stanchion ring outside the body + 1.2 m, ropes, board behind it`, () => {
      const L = gen(seed), info = L.skyways!, ad = info.addon, res = skywaysAddonDressOf(L)!, pz = res.prize!;
      expect(ad.id).toBe('prize-car');
      expect(ad.display).toBe(true);
      expect(ad.areas).toEqual([]);
      expect(res.skipped, `seed ${seed}`).toEqual([]);
      expect(skywaysIssues(L), `seed ${seed} validation`).toEqual([]);
      const car = ad.car!, court = L.areas[car.area];
      expect(car.level).toBe(2);
      expect(court.publicSpace).toBe(true);
      expect(court.label).toMatch(/^Skyway (court|galleria)/);
      // nothing within the car body + 1.2 m
      for (const p of L.props) if ((p.level ?? 0) === car.level && p.h > 0) expect(bodyDist(car, p), `seed ${seed}: ${p.kind} within the car body + 1.2 m`).toBeGreaterThanOrEqual(1.2);
      // the exit lane ahead of the nose clear of every prop of the storey; the car's way out reachable on its storey
      const lane = pz.lane!;
      expect(lane.half).toBeCloseTo(SKYWAYS_PRIZE_LANE_HALF, 6);
      for (const p of L.props) if ((p.level ?? 0) === car.level && !p.mounted) expect(boxSegDist(p, lane.ax, lane.az, lane.bx, lane.bz), `seed ${seed}: ${p.kind} in the exit lane`).toBeGreaterThan(lane.half - 1e-6);
      expect(reach(L, car.level, [car.x, car.z], [lane.bx, lane.bz], SKYWAYS_CAR.width / 2 + 0.1), `seed ${seed}: the car's way out`).toBe(true);
      // the stanchions: a rounded rectangle about 1.2 m off the body (>= 1.2 m: checked above for every prop), on the floor
      expect(pz.stanchions.length, `seed ${seed}`).toBeGreaterThanOrEqual(7);
      for (const s of pz.stanchions) {
        expect(bodyDist(car, s)).toBeLessThanOrEqual(2.4);
        expect(s.y).toBeCloseTo(car.y, 6);
      }
      const ropes = planRopes(L);
      // (the lane's gap, and at most one post the court left no room for)
      expect(ropes.length).toBeGreaterThanOrEqual(pz.stanchions.length - 3);
      expect(ropes.length).toBeLessThan(pz.stanchions.length); // the lane's side stays open
      for (const r of ropes) expect(segDist((r.a.x + r.b.x) / 2, (r.a.z + r.b.z) / 2, lane.ax, lane.az, lane.bx, lane.bz)).toBeGreaterThan(lane.half);
      // the prize board behind the car, facing it (the way it looks)
      const b = pz.board!;
      expect(b.kind).toBe('skywaysPrizeBoard');
      expect(deg(angDiff(b.rot, Math.atan2(car.x - b.x, car.z - b.z))), 'board faces the car').toBeLessThanOrEqual(46);
      // no sign anywhere in the court says anything about the car
      for (const sg of L.signs) if (sg.area === car.area) expect(sg.text).not.toMatch(DRIVE_WORDS);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// the renderer + runtime on a synthetic hall (real GLBs, textures stripped)

/** A 40 x 30 m room (level 0) with the given props; a car spot at (20, 15) for the rope ring. */
function room(props: PropPlacement[]): StationLayout {
  const W = 80, H = 60, g = new Grid(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = g.idx(x, y); g.cells[i] = x < 1 || y < 1 || x >= W - 1 || y >= H - 1 ? SOLID : FLOOR; g.area[i] = 0; g.ceil[i] = 5.6; g.floor[i] = 0; }
  return {
    seed: 3, name: 'addon test', props, grid: g, areas: [{id: 0, x: 1, y: 1, w: W - 2, h: H - 2, kind: 'concourse', type: 'concourse', label: 'Hall', ceil: 5.6, parent: -1, depth: 0, publicSpace: true, lighting: 'lit'} as unknown as Area],
    doors: [], playerSpawn: {x: 2, z: 2, yaw: 0}, lights: [], signs: [], pickups: [], zombies: [], decor: [], storefronts: [], trench: {floorY: -1.15}, trenches: [],
    attempt: 0, towards: ['A', 'B'], platform: 0, platforms: [], traversal: {stairs: [], ladders: [], underpasses: []}, rails: [], levelLinks: [],
  } as unknown as StationLayout;
}
const place = (kind: SkywaysAddonKind | 'foldingChair', x: number, z: number, o: Partial<PropPlacement> = {}): PropPlacement => {
  const d = PROP_DEFS[kind];
  return {kind, x, z, y: 0, rot: 0, area: 0, hx: d.w / 2, hz: d.d / 2, h: d.h, blocksSight: false, variant: 0, ...o};
};
function ringPosts(n = 8): PropPlacement[] {
  return Array.from({length: n}, (_, k) => {
    const a = 0.4 + (2 * Math.PI * k) / n;
    return place('skywaysPrizeStanchion', 20 + Math.sin(a) * 2.6, 15 + Math.cos(a) * 2.6, {rot: a, round: true, hx: 0.17, hz: 0.17});
  });
}

describe('world/skywaysAddon.ts + skywaysAddonRuntime.ts: drawn at real size, ropes follow / drop with their posts', () => {
  const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  let lib: Record<string, GLTF> = {};
  beforeAll(async () => {
    lib = {};
    for (const [key, f] of Object.entries(SKYWAYS_ADDON_MODEL_FILES)) if (key !== 'skyways-car-dash' && key !== 'skyways-car-seat') lib[key] = await loadStripped(f.url);
  });

  function sample(): {layout: StationLayout; stage: PropPlacement; table: PropPlacement} {
    const props: PropPlacement[] = [];
    const stage = place('skywaysConStage', 10, 6, {rot: 0});
    props.push(stage, place('skywaysConStage', 12.9, 6 + SKYWAYS_STAGE_DECK_D / 2 + 0.39, {variant: 1, hx: 0.7, hz: 0.39, h: 0.73}));
    props.push(place('skywaysConBackdrop', 10, 6 + SKYWAYS_STAGE.trussBackZ - 0.04 + SKYWAYS_STAGE_MODEL_SHIFT, {y: SKYWAYS_STAGE.deckY + 0.08, mounted: true, host: 0}));
    const table = place('skywaysConMerchTable', 30, 25);
    props.push(table);
    const ti = props.length - 1;
    props.push(place('skywaysConFigureBox', 29.6, 25.15, {y: SKYWAYS_MERCH_TOP.y, host: ti}), place('skywaysConPlush', 30, 25.1, {y: SKYWAYS_MERCH_TOP.y, host: ti}),
      place('skywaysConPrintCard', 30.5, 25.2, {y: SKYWAYS_MERCH_TOP.y, host: ti, variant: 2}));
    SKYWAYS_MASCOT_POSES.forEach((pose, i) => props.push(place('skywaysMascotStatue', 4 + i * 1.6, 26, {variant: i, rot: 0.3 * i, round: true, hx: 0.55, hz: 0.55,
      h: SKYWAYS_STATUE_PLINTH.h + SKYWAYS_MASCOT.poses[pose].h})));
    for (let v = 0; v < 8; v++) props.push(place('skywaysConPoster', 2 + v, 0.53, {y: 1.05, mounted: true, variant: v}));
    props.push(place('skywaysConPosterBoard', 36, 5, {variant: 3}), place('skywaysConBanner', 36, 12, {y: 2.38, mounted: true, variant: 1}),
      place('skywaysConWelcome', 36, 18), place('skywaysPrizeBoard', 30, 8));
    props.push(...ringPosts());
    return {layout: room(props), stage, table};
  }

  it('missing models: stand-ins; loaded: every kind drawn as prop-<kind>, the stage deck on its box, one mesh per statue pose, art on its pieces', () => {
    const {layout, stage} = sample();
    const names = (w: {group: THREE.Group}) => { const s = new Set<string>(); w.group.traverse(o => { if ((o as THREE.InstancedMesh).isInstancedMesh) s.add(o.name); }); return s; };
    const bare = names(buildWorld(layout, mats, {}));
    for (const k of SKYWAYS_ADDON_KINDS) expect([...bare].some(n => n === `prop-${k}` || n.startsWith(`prop-${k}-`)), k).toBe(true);
    const w = buildWorld(layout, mats, lib), got = names(w);
    for (const k of SKYWAYS_ADDON_KINDS) expect([...got].some(n => n === `prop-${k}` || n.startsWith(`prop-${k}-`)), k).toBe(true);
    for (const pose of SKYWAYS_MASCOT_POSES) expect(got.has(`prop-skywaysMascotStatue-${pose}`), pose).toBe(true);
    // the stage drawn once (its steps placement is collision only), its deck band over the deck box, k = 1
    const fit = skywaysAddonFit('skywaysConStage', new THREE.Box3().setFromObject(lib['skyways-con-stage'].scene).getSize(new THREE.Vector3()));
    expect(fit.k).toBeCloseTo(1, 3);
    const ims: THREE.InstancedMesh[] = [];
    w.group.traverse(o => { if (o.name === 'prop-skywaysConStage') ims.push(o as THREE.InstancedMesh); });
    expect(ims.length).toBeGreaterThan(0);
    const all = new THREE.Box3(), m = new THREE.Matrix4();
    for (const im of ims) { expect(im.count).toBe(1); im.getMatrixAt(0, m); all.union(new THREE.Box3().setFromBufferAttribute(im.geometry.attributes.position as THREE.BufferAttribute).applyMatrix4(m)); }
    expect(all.min.y).toBeCloseTo(0, 3);
    expect(all.max.x - all.min.x).toBeCloseTo(8, 2);
    expect(all.min.z).toBeCloseTo(stage.z - SKYWAYS_STAGE_DECK_D / 2, 2); // its back (truss) on the deck box's back
    expect(all.max.z).toBeCloseTo(stage.z - SKYWAYS_STAGE_DECK_D / 2 + SKYWAYS_MESHY_PROPS.skyways_con_stage.d, 2); // steps out front
    // art quads sample their atlas pieces (poster 3's front quad)
    const poster = [...got].find(n => n === 'prop-skywaysConPoster-art3')!;
    let pim: THREE.InstancedMesh | undefined;
    w.group.traverse(o => { if (o.name === poster) pim = o as THREE.InstancedMesh; });
    const uv = pim!.geometry.attributes.uv as THREE.BufferAttribute, piece = SKYWAYS_ART.conPosters.pieces[SKYWAYS_CON_POSTERS[3]];
    for (let i = 0; i < uv.count; i++) { expect(uv.getX(i)).toBeGreaterThanOrEqual(piece.u0 - 1e-6); expect(uv.getX(i)).toBeLessThanOrEqual(piece.u1 + 1e-6); expect(uv.getY(i)).toBeGreaterThanOrEqual(piece.v0 - 1e-6); expect(uv.getY(i)).toBeLessThanOrEqual(piece.v1 + 1e-6); }
    // with a loaded atlas material the panels use it (the runtime hands it in), else the plain board
    const art = new THREE.MeshStandardMaterial({name: 'atlas'});
    setSkywaysAddonArtMaterial('conPosters', art);
    let used = false;
    buildWorld(layout, mats, lib).group.traverse(o => { if (o.name.startsWith('prop-skywaysConPoster-art') && (o as THREE.Mesh).material === art) used = true; });
    setSkywaysAddonArtMaterial('conPosters', null);
    expect(used).toBe(true);
  });

  it('the turntable sits on the car spot (render only), the ropes hang between upright posts and drop for good when a post is shot over', () => {
    const {layout} = sample();
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    ph.dynamicItems.contactWake = true;
    const pd = new PropDamage();
    const w = buildWorld(layout, mats, lib);
    pd.build(layout.props, [w.group]);
    ph.dynamicItems.detacher = pd;
    const scene = new THREE.Scene();
    const rt = new SkywaysAddonRuntime({scene, levelResources: {load: async () => null, own: (_l, r) => r}, physics: ph, frameHooks: [], sectionHooks: []});
    // (the car spot the ring stands round: layout.skyways.addon.car)
    rt.build({...layout, skyways: {addon: {id: 'prize-car', car: {x: 20, y: 0, z: 15, yaw: 0.5, level: 0, area: 0}}}} as unknown as StationLayout);
    const disc = scene.getObjectByName('skyways-turntable') as THREE.Mesh;
    expect(disc.position.x).toBe(20); expect(disc.position.z).toBe(15);
    (disc.geometry as THREE.BufferGeometry).computeBoundingBox();
    expect(disc.geometry.boundingBox!.max.x).toBeCloseTo(SKYWAYS_TURNTABLE_R + 0.02, 3);
    expect(disc.geometry.boundingBox!.max.y).toBeLessThan(0.03);
    expect(layout.props.some(p => p.kind.toLowerCase().includes('turntable'))).toBe(false); // no collision
    expect(rt.ropes.length).toBe(8); // a closed synthetic ring of 8 posts 2.0 m apart
    // hanging: the ends on the posts' eye rings, the middle sags but stays well above the floor
    const line: number[] = [];
    for (const r of rt.ropes) {
      ropeLine(r, (p, out) => out.compose(new THREE.Vector3(p.x, p.y, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot), new THREE.Vector3(1, 1, 1)), line);
      expect(r.dropped).toBe(false);
      expect(line[1]).toBeCloseTo(SKYWAYS_STANCHION.ringY, 6);
      const mid = line[Math.floor(ROPE_TUBE.seg / 2) * 3 + 1];
      expect(mid).toBeLessThan(SKYWAYS_STANCHION.ringY - 0.05);
      expect(mid).toBeGreaterThan(0.4);
    }
    // a buckshot blast at a post's head: it goes loose, tips over; its two ropes drop to the floor (and stay), the others still hang
    const post = layout.props.find(p => p.kind === 'skywaysPrizeStanchion')!, i = layout.props.indexOf(post);
    expect(ph.dynamicItems.isDynamicProp(post)).toBe(true);
    expect(ph.dynamicItems.shootProp(post, i, new THREE.Vector3(post.x - 0.17, 0.85, post.z), new THREE.Vector3(1, 0, 0), PELLET * 9)).toBe(true);
    for (let t = 0; t < 3; t += DT) { ph.update(DT); rt.frame(); }
    const mt = new THREE.Matrix4();
    expect(ph.dynamicItems.propMatrix(post, mt)).toBe(true);
    expect(mt.elements[5], 'the post tipped over').toBeLessThan(0.9);
    const mine = rt.ropes.filter(r => r.a === post || r.b === post), rest = rt.ropes.filter(r => r.a !== post && r.b !== post);
    expect(mine.length).toBe(2);
    for (const r of mine) { expect(r.dropped).toBe(true); for (let k = 1; k < r.last.length; k += 3) expect(r.last[k]).toBeCloseTo(ROPE_TUBE.r, 6); }
    for (const r of rest) expect(r.dropped).toBe(false);
    expect(rt.counts.drops).toBe(2);
    rt.teardown();
    expect(scene.getObjectByName('skyways-addon')).toBeUndefined();
  });

  it('preload: the panels\' Codex atlases (level-only, via LevelResources) become one material each before the build; a failed atlas keeps the plain board', async () => {
    const {layout} = sample();
    const asked: string[] = [], owned: unknown[] = [];
    const rt = new SkywaysAddonRuntime({scene: new THREE.Scene(), frameHooks: [], sectionHooks: [], levelResources: {
      load: async (level, url) => { asked.push(`${level}:${url}`); return url.includes('prize') ? null : new THREE.Texture(); },
      own: (_l, r) => { owned.push(r); return r; }}});
    await rt.preload(layout);
    // posters / boards (conPosters), banners (conBanners), backdrop (conStage), welcome + prints (conSigns), the prize board (prizeBoard)
    expect(asked.sort()).toEqual(['conBanners', 'conPosters', 'conSigns', 'conStage', 'prizeBoard'].map(k => `skyways:${SKYWAYS_ART[k as 'conStage'].url}`).sort());
    for (const k of ['conBanners', 'conPosters', 'conSigns', 'conStage'] as const) expect(skywaysAddonArtLoaded(k), k).toBe(true);
    expect(skywaysAddonArtLoaded('prizeBoard')).toBe(false);
    expect(owned.length).toBe(4);
    expect(rt.counts.artLoaded).toBe(4);
    for (const k of ['conBanners', 'conPosters', 'conSigns', 'conStage'] as const) setSkywaysAddonArtMaterial(k, null);
    // a layout without the add-on panels asks for nothing
    asked.length = 0;
    await rt.preload(room([place('foldingChair', 5, 5)]));
    expect(asked).toEqual([]);
  });

  it('merch is knocked off its static vendor table (host slab: never sinks into it); the table and the statues never move', () => {
    const {layout, table} = sample();
    const ph = new PhysicsSystem(null);
    ph.build(layout);
    const pd = new PropDamage();
    pd.build(layout.props, [buildWorld(layout, mats, lib).group]);
    ph.dynamicItems.detacher = pd;
    const plush = layout.props.find(p => p.kind === 'skywaysConPlush')!, i = layout.props.indexOf(plush);
    expect(ph.dynamicItems.isDynamicProp(table)).toBe(false);
    for (const p of layout.props) if (p.kind === 'skywaysMascotStatue') expect(ph.dynamicItems.isDynamicProp(p)).toBe(false);
    expect(ph.dynamicItems.isDynamicProp(plush)).toBe(true);
    const start = new THREE.Vector3(plush.x, plush.y, plush.z);
    expect(ph.dynamicItems.shootProp(plush, i, new THREE.Vector3(plush.x - 0.15, plush.y + 0.17, plush.z), new THREE.Vector3(1, -0.05, 0).normalize(), PELLET * 3)).toBe(true);
    expect(ph.dynamicItems.stats().counts.hostSlabs).toBe(1);
    const mt = new THREE.Matrix4();
    let sank = false;
    for (let t = 0; t < 6; t += DT) {
      ph.update(DT);
      ph.dynamicItems.propMatrix(plush, mt);
      const at = new THREE.Vector3().setFromMatrixPosition(mt);
      if (Math.abs(at.x - table.x) < SKYWAYS_MERCH_TOP.x - 0.1 && Math.abs(at.z - table.z) < SKYWAYS_MERCH_TOP.z - 0.1 && at.y < SKYWAYS_MERCH_TOP.y - 0.06 && at.y > 0.1) sank = true;
    }
    const end = new THREE.Vector3().setFromMatrixPosition(mt);
    expect(sank, 'sank into the table').toBe(false);
    expect(end.distanceTo(start)).toBeGreaterThan(0.1);
    expect(end.y > SKYWAYS_MERCH_TOP.y - 0.06 || end.y < 0.2, 'on the top or on the floor').toBe(true);
    expect(table.h).toBe(PROP_DEFS.skywaysConMerchTable.h);
  });
});
