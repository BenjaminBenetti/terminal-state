// Task studio-skyways-rework-20261107-054512-01 (lane ARCH): THE SKYWAYS REWORK'S ARCHITECTURE LOOK on real layouts (layout version 3,
// the live generator; versions 1 / 2 through the frozen GAME77 generator for the unchanged checks):
//  - glazed bridge roofs (world/skywaysBridgeRoofs.ts): every roofed bridge gets glass + steel (ribs = round(length / rib) + 1), one
//    glass + one steel mesh tagged with the skyway storey, the glass transparent / depth-writing / never a shadow caster; no ceiling run
//    is drawn inside its deck; its side walls stop at the springing line; its floor is the paver finish; v1 / v2 bridges unchanged;
//  - skylights (gen/skyways/skylights.ts): records on storey 2 only, inside public skyway courts, the coffer cells' ceiling raised (the
//    well), a daylight source under each, the coffer top = the sky key (no slab ceiling), the well walls plain plaster;
//  - gardens (gen/skyways/gardens.ts): troughs along the atrium gallery rails (balustrade row, walkway kept behind, never on stairs /
//    run mouths / door zones / bridge lanes), standing on the floor; court bench-planters; both kinds classified in every audit;
//  - textures: the Codex derivatives present, bytes / hashes = tools/release/public-inputs.json and their provenance; the textured path
//    used when loaded (decayed SurfaceNodeMaterial over the texture, span = the texture's); preloaded behind the loading screen
//    (level-only skyways resources) for v3 layouts only;
//  - exterior: a roofed bridge has no opaque roof slab, its fascias stop under the roof.
import * as THREE from 'three';
import {afterAll, beforeAll, describe, expect, it} from 'vitest';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as path from 'node:path';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {LEVELS} from '../src/levels/registry';
import {PROP_DEFS} from '../src/gen/props';
import {PROP_DAMAGE, propPhysics} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {finishClass} from '../src/damage/impactFinish';
import {WorldMaterials, SurfaceNodeMaterial} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {LevelColumns, ceilingRuns, stationLevels} from '../src/world/levelGeometry';
import {SKYWAYS_TEX_KEYS} from '../src/world/skywaysArch';
import {BRIDGE_PANE_MAX, bridgeRoofBays, bridgeRoofPlan, bridgeRoofProfile} from '../src/world/skywaysBridgeRoofs';
import {SKYLIGHT_SKY_KEY} from '../src/world/skywaysSkylights';
import {SkywaysArchTextureRuntime, setSkywaysArchTexture, usesSkywaysArchTextures} from '../src/world/skywaysArchTextures';
import {GARDEN_FOLIAGE, skywaysGardenModelKeysFor} from '../src/world/skywaysGardens';
import {planSkywaysExterior} from '../src/world/skywaysExterior';
import {SKYLIGHT} from '../src/gen/skyways/skylights';
import {GARDEN} from '../src/gen/skyways/gardens';
import {GARDEN_KINDS} from '../src/gen/skyways/destinations/kindsGardens';
import {SKYWAYS_ARCH_TEXTURES, type SkywaysArchTextureKey} from '../src/assets/skywaysArchTextures.generated';
import {levelOfAsset} from '../src/assets/levelAssets';

installCanvasShim(false);
const SEEDS = [1, 2, 3] as const;
const LOG = '/tmp/skyways-arch-rework.log';
const ROOT = path.resolve(__dirname, '../..');
let mats: WorldMaterials;
const layouts = new Map<string, StationLayout>();
const worlds = new Map<number, BuiltWorld>();
const gen = (seed: number, layoutVersion?: number): StationLayout => {
  const k = `${seed}:${layoutVersion ?? 'cur'}`;
  let L = layouts.get(k);
  if (!L) layouts.set(k, (L = LEVELS.skyways!.generate('main', {levelSeed: seed, startWeapon: 'pistol', ...(layoutVersion !== undefined ? {layoutVersion} : {})} as never) as StationLayout));
  return L;
};
const world = (seed: number): BuiltWorld => {
  let w = worlds.get(seed);
  if (!w) worlds.set(seed, (w = buildWorld(gen(seed), mats, {})));
  return w;
};
const log = (s: string) => fs.appendFileSync(LOG, s + '\n');
const meshesNamed = (w: BuiltWorld, re: RegExp) => { const out: THREE.Mesh[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh && re.test(o.name)) out.push(o as THREE.Mesh); }); return out; };

beforeAll(() => { mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}); fs.writeFileSync(LOG, ''); });
afterAll(() => { for (const k of Object.keys(SKYWAYS_ARCH_TEXTURES) as SkywaysArchTextureKey[]) setSkywaysArchTexture(k, null); });

describe('glazed bridge roofs', () => {
  it('profiles: every style springs at the deck faces and peaks at the apex; ribs follow `rib`', () => {
    for (const style of ['vault', 'faceted', 'gable', 'flat'] as const) {
      const p = bridgeRoofProfile(style, 10, 16, 12.5, 15);
      expect(p[0]).toEqual({a: 10, y: 12.5});
      expect(p[p.length - 1]).toEqual({a: 16, y: 12.5});
      expect(Math.max(...p.map(q => q.y)), style).toBeCloseTo(15, 6);
      for (const q of p) { expect(q.a).toBeGreaterThanOrEqual(10 - 1e-9); expect(q.a).toBeLessThanOrEqual(16 + 1e-9); }
    }
    expect(bridgeRoofBays(19, 1.8)).toBe(11);
    expect(bridgeRoofBays(0.3, 1.8)).toBe(1);
  });

  for (const seed of SEEDS) {
    it(`seed ${seed}: every roofed bridge has glass + steel (rib count), no ceiling inside its deck, side walls stop at the springing, paver floor`, () => {
      const L = gen(seed), w = world(seed), a = w.skywaysArch!;
      const info = L.skyways!;
      expect(info.bridges.length).toBeGreaterThan(0);
      expect(info.bridges.every(b => b.roof), 'v3: every bridge is roofed').toBe(true);
      const stats = new Map(a.bridgeRoofs.map(s => [s.bridge, s]));
      const levels = stationLevels(L), cols = new LevelColumns(levels);
      const runs = ceilingRuns(levels, cols);
      for (const b of info.bridges) {
        const plan = bridgeRoofPlan(b)!, st = stats.get(b.id)!;
        expect(st, b.id).toBeTruthy();
        expect(st.ribs, b.id).toBe(bridgeRoofBays(b.length, b.roof!.rib) + 1);
        expect(st.panes, b.id).toBe((st.ribs - 1) * plan.split.reduce((s, n) => s + n, 0));
        expect(plan.split.every((n, k) => Math.hypot(plan.profile[k + 1].a - plan.profile[k].a, plan.profile[k + 1].y - plan.profile[k].y) / n <= BRIDGE_PANE_MAX * 1.5)).toBe(true);
        expect(st.meshes, b.id).toBe(2);
        expect(st.triangles, b.id).toBeLessThan(6000);
        const glass = meshesNamed(w, new RegExp(`^skyways-bridge-roof-glass-${b.id}$`)), steel = meshesNamed(w, new RegExp(`^skyways-bridge-roof-steel-${b.id}$`));
        expect(glass.length).toBe(1); expect(steel.length).toBe(1);
        const gm = glass[0].material as THREE.Material;
        expect(gm.transparent && gm.depthWrite, 'glass: transparent, depth-writing').toBe(true);
        expect(glass[0].castShadow).toBe(false);
        expect(glass[0].userData.levels).toEqual([2]);
        expect(steel[0].userData.levels).toEqual([2]);
        // the glass spans the deck from the springing line to the apex
        const bb = new THREE.Box3().setFromObject(glass[0]);
        expect(bb.min.y).toBeCloseTo(b.roof!.springY, 2);
        expect(bb.max.y).toBeCloseTo(b.roof!.apexY, 2);
        // no ceiling run of the deck is drawn (the builder skips false)
        const deckRuns = runs.filter(r => r.area === b.area && !r.voidCell);
        expect(deckRuns.length, b.id).toBeGreaterThan(0);
        for (const r of deckRuns) expect(a.ceilKey(r.level, r.area, r.row * L.grid.w + r.x0, r.y)).toBe(false);
        // side wall faces of the deck end at the springing line
        const sides = w.wallFaces.filter(f => f.area === b.area && !f.slope && (b.axis === 'x' ? Math.abs(f.z0 - f.z1) < 1e-9 && (Math.abs(f.z0 - b.rect.z0) < 1e-3 || Math.abs(f.z0 - b.rect.z1) < 1e-3)
          : Math.abs(f.x0 - f.x1) < 1e-9 && (Math.abs(f.x0 - b.rect.x0) < 1e-3 || Math.abs(f.x0 - b.rect.x1) < 1e-3)));
        expect(sides.length, b.id).toBeGreaterThan(0);
        for (const f of sides) expect(f.y1, `${b.id} side face`).toBeLessThanOrEqual(b.roof!.springY + 1e-3);
        // the deck's floor: the paver finish (its stand-in without the texture)
        const g = L.levels[2].grid, [cx, cy] = g.cellOf((b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2);
        expect(a.floorKey(2, g.idx(cx, cy))).toBe('skyways-floor-pavers');
        // no fixture hangs at the ridge: the deck's lights are daylight under the glass (gen/skyways/skylights.ts glazedBridgeDaylight)
        const deckLights = L.lights.filter(l => l.area === b.area);
        expect(deckLights.filter(l => !l.virtual).length, `${b.id} fixtures`).toBe(0);
        for (const l of deckLights) expect(l.y, `${b.id} light under the glass`).toBeLessThan(b.roof!.apexY);
        expect(L.lights.filter(l => l.virtual && l.x > b.rect.x0 && l.x < b.rect.x1 && l.z > b.rect.z0 && l.z < b.rect.z1).length, `${b.id} daylight`).toBeGreaterThan(0);
        log(`seed ${seed} ${b.id} ${b.roof!.style} w ${b.width} len ${b.length}: ribs ${st.ribs} panes ${st.panes} purlins ${st.purlins} meshes ${st.meshes} tris ${st.triangles}`);
      }
      // no down-facing drawn surface inside a roofed deck above the springing line other than the roof itself
      for (const m of meshesNamed(w, /^arch-/)) {
        const p = m.geometry.attributes.position, n = m.geometry.attributes.normal, idx = m.geometry.index;
        if (!p || !n || !idx) continue;
        for (let t = 0; t + 2 < idx.count; t += 3) {
          const i0 = idx.getX(t);
          if (n.getY(i0) > -0.99) continue;
          const cx = (p.getX(i0) + p.getX(idx.getX(t + 1)) + p.getX(idx.getX(t + 2))) / 3, cy = (p.getY(i0) + p.getY(idx.getX(t + 1)) + p.getY(idx.getX(t + 2))) / 3, cz = (p.getZ(i0) + p.getZ(idx.getX(t + 1)) + p.getZ(idx.getX(t + 2))) / 3;
          for (const b of info.bridges) if (cx > b.rect.x0 + 0.01 && cx < b.rect.x1 - 0.01 && cz > b.rect.z0 + 0.01 && cz < b.rect.z1 - 0.01) expect(cy, `${m.name} ceiling in ${b.id}`).toBeLessThan(b.roof!.springY);
        }
      }
    });
  }

  it('versions 1 / 2 keep their look: no roof / skylight / planter, the bridge soffit and court stone as before', () => {
    for (const v of [1, 2]) {
      const L = gen(1, v), w = buildWorld(L, mats, {}), a = w.skywaysArch!;
      expect(L.skyways!.bridges.some(b => b.roof), `v${v}`).toBe(false);
      expect(L.skyways!.skylights, `v${v}`).toBeUndefined();
      expect(L.props.some(p => (GARDEN_KINDS as readonly string[]).includes(p.kind)), `v${v}`).toBe(false);
      expect(a.rework).toBe(false);
      expect(a.bridgeRoofs).toEqual([]);
      expect(usesSkywaysArchTextures(L)).toBe(false);
      const b = L.skyways!.bridges[0], g = L.levels[2].grid, [cx, cy] = g.cellOf((b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2);
      expect(a.ceilKey(2, b.area, g.idx(cx, cy))).toBe('skyways-ceil-bridge');
      expect(a.floorKey(2, g.idx(cx, cy))).toBe('skyways-floor-bridge');
      expect(meshesNamed(w, /^skyways-(bridge-roof|skylight)/).length).toBe(0);
    }
  });

  it('exterior: a roofed bridge has no opaque roof slab and its fascias / steel stop under the roof', () => {
    const L = gen(1), plan = planSkywaysExterior(L);
    for (const bp of plan.bridges) {
      const b = L.skyways!.bridges.find(q => q.id === bp.bridge)!;
      expect(bp.faces.some(f => f.axis === 'y' && f.n === 1), `${b.id} roof slab`).toBe(false);
      for (const f of bp.faces) if (f.axis !== 'y') expect(f.t1, `${b.id} fascia`).toBeLessThanOrEqual(b.roof!.springY);
      for (const s of bp.steel) expect(s.y1, `${b.id} steel`).toBeLessThanOrEqual(b.roof!.springY + 0.2);
    }
  });
});

describe('skylight coffers', () => {
  it('records on storey 2 only, inside public skyway courts; the well raised; daylight under each; the top the sky key; walls plaster', () => {
    let total = 0;
    for (const seed of SEEDS) {
      const L = gen(seed), w = world(seed), a = w.skywaysArch!, info = L.skyways!;
      const sk = info.skylights ?? [];
      total += sk.length;
      const g = L.levels[2].grid;
      for (const s of sk) {
        expect(s.level).toBe(2);
        const ar = L.areas[s.area];
        expect(ar.publicSpace, ar.label).toBe(true);
        expect(a.classOf(s.area), ar.label).toBe('public');
        expect(info.addon.areas).not.toContain(s.area);
        expect(s.topY - s.ceilY).toBeCloseTo(SKYLIGHT.depth, 3);
        expect(Math.round((s.rect.x1 - s.rect.x0) / CELL)).toBe(SKYLIGHT.size);
        for (let y = Math.round(s.rect.z0 / CELL); y < Math.round(s.rect.z1 / CELL); y++) for (let x = Math.round(s.rect.x0 / CELL); x < Math.round(s.rect.x1 / CELL); x++) {
          const i = g.idx(x, y);
          expect(g.cells[i]).toBe(FLOOR); // walkability unchanged under the well
          expect(g.area[i]).toBe(s.area);
          expect(g.ceil[i]).toBeCloseTo(s.topY, 3);
          expect(g.rampIdx[i]).toBeLessThan(0);
          expect(a.ceilKey(2, s.area, i, s.topY)).toBe(SKYLIGHT_SKY_KEY);
        }
        const day = L.lights.filter(l => l.virtual && (l.level ?? 0) === 2 && l.x > s.rect.x0 && l.x < s.rect.x1 && l.z > s.rect.z0 && l.z < s.rect.z1);
        expect(day.length, 'a daylight source under the coffer').toBeGreaterThan(0);
        for (const l of day) { expect(l.y).toBeLessThan(s.ceilY); expect(l.tint).toBeTruthy(); }
        // no fixture left hanging in the well (dropFloatingFixtures)
        expect(L.lights.filter(l => !l.virtual && (l.level ?? L.areas[l.area]?.level ?? 0) === 2 && l.x > s.rect.x0 && l.x < s.rect.x1 && l.z > s.rect.z0 && l.z < s.rect.z1).length).toBe(0);
      }
      // the well walls are the light well's plain plaster; the coffer tops are drawn with the sky material
      const wellFaces = w.wallFaces.filter(f => sk.some(s => s.area === f.area && f.y0 >= s.ceilY - 0.02 && f.y1 <= s.topY + 0.02));
      if (sk.length) expect(wellFaces.length).toBeGreaterThanOrEqual(4 * sk.length);
      for (const f of wellFaces) expect(f.finish).toBe('skyways-reveal');
      if (sk.length) expect(a.usedMaterials().get(SKYLIGHT_SKY_KEY)).toBeTruthy();
      // glazing: one glass + one frame mesh on the skyway storey
      if (sk.length) {
        expect(a.skylightStats.coffers).toBe(sk.length);
        expect(meshesNamed(w, /^skyways-skylight-glass$/).length).toBe(1);
        const gm = meshesNamed(w, /^skyways-skylight-glass$/)[0];
        expect((gm.material as THREE.Material).transparent).toBe(true);
        expect(gm.userData.level).toBe(2);
      }
      log(`seed ${seed}: skylights ${sk.length} in ${new Set(sk.map(s => s.area)).size} courts; ${JSON.stringify(a.skylightStats)}`);
    }
    expect(total, 'skylit courts across the seeds').toBeGreaterThan(0);
  });
});

describe('planted galleries and courts', () => {
  it('troughs along the atrium gallery rails: balustrade row, walkway behind, never on stairs / run mouths / door zones; standing on the floor', () => {
    let troughs = 0, benches = 0;
    for (const seed of SEEDS) {
      const L = gen(seed), info = L.skyways!, g = L.levels[2].grid;
      const atria = info.buildings.filter(b => b.atrium).map(b => b.atrium!.rect);
      const doorNear = (x: number, y: number) => L.doors.some(d => ((d as {level?: number}).level ?? L.areas[d.a]?.level ?? 0) === 2 && x >= d.x - 2 && x < d.x + d.w + 2 && y >= d.y - 2 && y < d.y + d.h + 2);
      for (const p of L.props.filter(q => q.kind === 'skyArchGalleryPlanter')) {
        troughs++;
        expect(p.level).toBe(2);
        const [cx, cy] = g.cellOf(p.x, p.z), i = g.idx(cx, cy);
        expect(p.y, 'on the floor').toBeCloseTo(g.floorOf(i), 3);
        // beside an atrium opening, its back to the balustrade (the cell behind it has no floor on this storey)
        const fx = Math.round(Math.sin(p.rot)), fz = Math.round(Math.cos(p.rot));
        expect(atria.some(r => p.x > r.x0 - 1 && p.x < r.x1 + 1 && p.z > r.z0 - 1 && p.z < r.z1 + 1), 'by an atrium opening').toBe(true);
        expect(g.cells[g.idx(cx - fx, cy - fz)], 'the opening behind it').not.toBe(FLOOR);
        // its cells: open gallery floor, no ramp near, no door zone; the walkway in front stays walkable
        const along = fx === 0 ? [1, 0] : [0, 1];
        for (let k = -1; k <= 1; k++) {
          const x = cx + along[0] * k, y = cy + along[1] * k;
          expect(g.cells[g.idx(x, y)]).toBe(FLOOR);
          expect(g.rampIdx[g.idx(x, y)]).toBeLessThan(0);
          expect(doorNear(x, y), 'door zone').toBe(false);
          for (let s = 1; s <= GARDEN.walk; s++) expect(g.walkable(x + fx * s, y + fz * s), 'walkway').toBe(true);
          for (const r of g.ramps) {
            const dx = Math.max(r.x - x, 0, x - (r.x + r.w - 1)), dy = Math.max(r.y - y, 0, y - (r.y + r.h - 1));
            expect(Math.max(dx, dy), 'run mouth').toBeGreaterThan(1);
            if (r.axis === 'x' && y >= r.y - 1 && y <= r.y + r.h) expect(dx, 'run mouth (x)').toBeGreaterThan(GARDEN.mouth);
            if (r.axis === 'z' && x >= r.x - 1 && x <= r.x + r.w) expect(dy, 'run mouth (z)').toBeGreaterThan(GARDEN.mouth);
          }
        }
        // not on a landmark's clear disc / a bridge lane
        for (const m of info.landmarks ?? []) if (m.level === 2) expect(Math.hypot(p.x - m.x, p.z - m.z)).toBeGreaterThan(m.radius);
      }
      for (const p of L.props.filter(q => q.kind === 'skyArchBenchPlanter')) {
        benches++;
        const lv = p.level ?? 0, gg = L.levels[lv].grid, [cx, cy] = gg.cellOf(p.x, p.z);
        expect(p.y, 'on the floor').toBeCloseTo(gg.floorOf(gg.idx(cx, cy)), 3);
        expect(L.areas[p.area].publicSpace).toBe(true);
      }
      log(`seed ${seed}: troughs ${L.props.filter(q => q.kind === 'skyArchGalleryPlanter').length}, bench-planters ${L.props.filter(q => q.kind === 'skyArchBenchPlanter').length}, atria ${atria.length}`);
    }
    expect(troughs, 'gallery troughs across the seeds').toBeGreaterThan(0);
    expect(benches, 'court bench-planters across the seeds').toBeGreaterThan(0);
  });

  it('every planter kind is classified (static built-in fixture, no storage) and drawn with the existing foliage model', () => {
    for (const k of GARDEN_KINDS) {
      const def = PROP_DEFS[k];
      expect(def.w * def.h * def.d, k).toBeGreaterThan(0);
      expect(PROP_PHYSICS_AUDIT[k], k).toMatchObject({cls: 'static'});
      expect(PROP_PHYSICS_AUDIT[k].why, k).toBeTruthy();
      expect(propPhysics(k).dynamic, k).toBe(false);
      expect(PROP_DAMAGE[k], k).toMatchObject({breaks: 'never'});
      const open = OPENABLE_AUDIT.filter(r => r.kind === k);
      expect(open.length, k).toBe(1);
      expect(open[0].cls, k).toBe('none');
    }
    // the foliage model is requested only where a planter stands
    const L = gen(1);
    expect(skywaysGardenModelKeysFor(L)).toEqual([GARDEN_FOLIAGE.key]);
    expect(skywaysGardenModelKeysFor({props: []})).toEqual([]);
    expect(levelOfAsset('assets/models/office-potted-plant-small.glb')).toBeNull(); // a shared office model
    const w = world(1);
    expect(meshesNamed(w, /^prop-skyArchGalleryPlanter-/).length).toBeGreaterThan(0);
    // without the model: the foliage stand-in, one instance per shrub
    expect(meshesNamed(w, /^prop-skyArchGalleryPlanter-foliage$/).length).toBeGreaterThan(0);
  });
});

describe('court / bridge textures (Codex derivatives)', () => {
  it('files present, sizes / bytes reported, public-inputs and provenance match', () => {
    const allow = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/release/public-inputs.json'), 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]};
    for (const [k, t] of Object.entries(SKYWAYS_ARCH_TEXTURES)) {
      const file = path.join(ROOT, 'game/public', t.url), buf = fs.readFileSync(file), sha = crypto.createHash('sha256').update(buf).digest('hex');
      expect(buf.length, k).toBe(t.bytes);
      expect(buf.length, k).toBeLessThan(400_000);
      expect(buf.subarray(0, 3).toString('hex'), `${k} jpeg`).toBe('ffd8ff');
      const row = allow.files.find(f => f.path === t.url);
      expect(row, k).toBeTruthy();
      expect(row!.bytes).toBe(buf.length);
      expect(row!.sha256).toBe(sha);
      const provPath = `assets/derivatives/${path.basename(t.url, '.jpg')}.json`, prov = JSON.parse(fs.readFileSync(path.join(ROOT, 'game/public', provPath), 'utf8'));
      expect(prov.output.sha256).toBe(sha);
      expect(prov.generator).toMatch(/Codex/);
      expect(allow.files.find(f => f.path === provPath), provPath).toBeTruthy();
      expect(levelOfAsset(t.url), `${k} level-only`).toBe('skyways');
      log(`texture ${k}: ${t.url} ${buf.length} bytes, span ${t.span.join(' x ')} m`);
    }
  });

  it('the textured path: decayed materials over the loaded textures for the courts / bridges, their spans; impact classes', () => {
    const texs = new Map<SkywaysArchTextureKey, THREE.Texture>();
    for (const k of Object.keys(SKYWAYS_ARCH_TEXTURES) as SkywaysArchTextureKey[]) { const t = new THREE.DataTexture(new Uint8Array(16 * 16 * 4), 16, 16); texs.set(k, t); setSkywaysArchTexture(k, t); }
    try {
      const L = gen(2), w = buildWorld(L, mats, {}), a = w.skywaysArch!, info = L.skyways!;
      expect(a.rework).toBe(true);
      const b = info.bridges[0], g2 = L.levels[2].grid, [bx, by] = g2.cellOf((b.rect.x0 + b.rect.x1) / 2, (b.rect.z0 + b.rect.z1) / 2);
      expect(a.floorKey(2, g2.idx(bx, by))).toBe(SKYWAYS_TEX_KEYS.pavers);
      const court = L.areas.find(q => (q.level ?? 0) === 1 && a.classOf(q.id) === 'court')!;
      const g1 = L.levels[1].grid;
      let ci = -1;
      for (let y = court.y; y < court.y + court.h && ci < 0; y++) for (let x = court.x; x < court.x + court.w; x++) if (g1.cells[g1.idx(x, y)] === FLOOR && g1.area[g1.idx(x, y)] === court.id) { ci = g1.idx(x, y); break; }
      expect(a.floorKey(1, ci)).toBe(SKYWAYS_TEX_KEYS.herringbone);
      for (const s of info.skylights ?? []) {
        expect(a.ceilKey(2, s.area, undefined, s.ceilY)).toBe(SKYWAYS_TEX_KEYS.woodSlats);
        break;
      }
      expect(w.wallFaces.some(f => f.finish === SKYWAYS_TEX_KEYS.brickWall)).toBe(true);
      // ordinary lobbies keep the plaster / stone look
      expect(w.wallFaces.some(f => f.finish === 'skyways-wall')).toBe(true);
      const used = a.usedMaterials();
      for (const [t, key] of Object.entries(SKYWAYS_TEX_KEYS) as [SkywaysArchTextureKey, string][]) {
        const m = used.get(key) as SurfaceNodeMaterial | undefined;
        if (!m) continue;
        expect(m).toBeInstanceOf(SurfaceNodeMaterial);
        expect(m.map).toBe(texs.get(t));
        expect(m.userData.decay, `${key} decayed`).toBeTruthy();
        expect(a.scale(key)).toEqual({u: SKYWAYS_ARCH_TEXTURES[t].span[0], v: SKYWAYS_ARCH_TEXTURES[t].span[1]});
      }
      for (const k of used.keys()) expect(finishClass(k), k).not.toBeNull();
    } finally {
      for (const k of texs.keys()) setSkywaysArchTexture(k, null);
    }
  });

  it('the runtime preloads the four textures behind the loading screen (level-only, repeating), for layout-version-3 Skyways only', async () => {
    const loads: {level: string; url: string; repeat: boolean}[] = [];
    const host = {
      levelResources: {load: (level: string, url: string, spec: {srgb: boolean; repeat: boolean}) => { loads.push({level, url, repeat: spec.repeat}); return Promise.resolve(new THREE.Texture()); }},
      sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    };
    const rt = new SkywaysArchTextureRuntime(host).install();
    expect(host.sectionPreloads.length).toBe(1);
    await host.sectionPreloads[0]({...gen(1, 2)});
    expect(loads.length, 'a v2 layout loads nothing').toBe(0);
    await host.sectionPreloads[0]({props: []} as unknown as StationLayout);
    expect(loads.length, 'another level loads nothing').toBe(0);
    await host.sectionPreloads[0](gen(1));
    expect(loads.map(l => l.url).sort()).toEqual(Object.values(SKYWAYS_ARCH_TEXTURES).map(t => t.url).sort());
    for (const l of loads) { expect(l.level).toBe('skyways'); expect(l.repeat).toBe(true); }
    expect(rt.counts.loaded).toBe(4);
    for (const k of Object.keys(SKYWAYS_ARCH_TEXTURES) as SkywaysArchTextureKey[]) setSkywaysArchTexture(k, null);
  });
});
