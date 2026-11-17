// Task studio-subway-station-variety-20261117-043926-01: the Subway's version-2 PLAN FAMILIES and station IDENTITIES.
//  - the layout version policy (gen/subwayLayoutVersion.ts): a visited station without a record stays version 1, a new one records the
//    current version (3 since task studio-subway-architecture-materials-rework-20261117-072826-01; a recorded 2 stays 2);
//  - the roll: the classic archetypes keep ~40 % (their version-1 layout byte for byte + only the identity), the three new families
//    (grand hall, cavern, hub) ~20 % each — at natural seeds, never forced;
//  - each family at a natural seed: valid, its signature spaces, the player's train, the track extensions, the Surface Run access;
//  - the identity's render: arch-owned zone finishes from the Subway architecture sets (task studio-subway-architecture-materials-rework-
//    20261117-072826-01), impact classes, wall treatment, the level-asset rule; version-1 stations draw no identity at all.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {generateStation, pickArchetype, validateLayout, type StationLayout} from '../src/gen/station';
import {ARCHETYPES, PLAN_FAMILIES, type Archetype} from '../src/gen/stationTypes';
import {PLAN_FAMILY_WEIGHTS, STATION_THEMES, planFamilyOf, signatureAreas, stationIdentityOf} from '../src/gen/stationPlans';
import {SUBWAY_LAYOUT_LANE, SUBWAY_LAYOUT_VERSION, subwayLayoutVersionFor} from '../src/gen/subwayLayoutVersion';
import {playerTrainPlacement} from '../src/gen/playerTrain';
import {SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {CELL} from '../src/gen/grid';
import {LEVELS} from '../src/levels/registry';
import {createRun} from '../src/run/runState';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {SUBWAY_WALL_TAG, subwayArchKeysOf, subwayPlate} from '../src/world/subwayArch';
import {SUBWAY_ARCH_TEXTURES} from '../src/assets/subwayArchTextures.generated';
import {finishClass} from '../src/damage/impactFinish';
import {isArchFinish} from '../src/world/finishAt';
import {finishFamily, treatmentOf} from '../src/world/wallDetailPlan';
import {assetAllowedIn} from '../src/assets/levelAssets';
import {atmosphereFor} from '../src/render/atmosphere';

installCanvasShim(false);

/** Natural seeds (the version-2 roll, nothing forced): one per family; SURFACE_SEEDS also roll the Surface Run access. */
const FAMILY_SEEDS = {classic: 1, 'grand-hall': 3, cavern: 2, hub: 16} as const;
const SURFACE_SEEDS = {'grand-hall': 15, cavern: 38, hub: 67} as const;
const CLASSIC_SEEDS = [1, 6, 9, 10];

const cache = new Map<string, StationLayout>();
/** The game's own call: the registry with the station's layout version and the current Surface Run version. */
const gen = (seed: number, version?: number, surface = SURFACE_VERSION): StationLayout => {
  const key = `${seed}:${version ?? '-'}:${surface}`;
  let L = cache.get(key);
  if (!L) cache.set(key, (L = LEVELS.subway.generate('main', {levelSeed: seed, surfaceVersion: surface, ...(version !== undefined ? {layoutVersion: version} : {})})));
  return L;
};

function layoutHash(l: unknown): string {
  const json = JSON.stringify(l, (_k, v) => {
    if (ArrayBuffer.isView(v)) { const b = new Uint8Array(v.buffer, v.byteOffset, v.byteLength); let x = 2166136261; for (let i = 0; i < b.length; i++) x = Math.imul(x ^ b[i], 16777619); return `#${b.length}:${x >>> 0}`; }
    return v;
  });
  let x = 2166136261;
  for (let i = 0; i < json.length; i++) x = Math.imul(x ^ json.charCodeAt(i), 16777619);
  return `${json.length}:${(x >>> 0).toString(16)}`;
}
const m2 = (a: {w: number; h: number}) => a.w * a.h * CELL * CELL;

describe('layout version policy', () => {
  // (task studio-subway-architecture-materials-rework-20261117-072826-01: version 3 — the sectioned grand hall — is the new build; a
  // recorded version 2 stays version 2: tests/subway-hall-v3.test.ts)
  it('a visited station without a record stays version 1; a recorded version is kept; a new / never-entered station builds 3', () => {
    expect(SUBWAY_LAYOUT_VERSION).toBe(3);
    expect(subwayLayoutVersionFor(undefined)).toBe(3);
    expect(subwayLayoutVersionFor({visits: 0, lanes: {}})).toBe(3);
    expect(subwayLayoutVersionFor({visits: 3, lanes: {}})).toBe(1);
    expect(subwayLayoutVersionFor({visits: 3, lanes: {[SUBWAY_LAYOUT_LANE]: {v: 2}}})).toBe(2);
    expect(subwayLayoutVersionFor({visits: 3, lanes: {[SUBWAY_LAYOUT_LANE]: {v: 3}}})).toBe(3);
    expect(subwayLayoutVersionFor({visits: 0, lanes: {[SUBWAY_LAYOUT_LANE]: {v: 1}}})).toBe(1);
    for (const bad of [{v: 0}, {v: 9}, {v: 1.5}, {v: '2'}, null]) expect(subwayLayoutVersionFor({visits: 2, lanes: {[SUBWAY_LAYOUT_LANE]: bad}})).toBe(1);
  });

  it('a campaign station: an old visited station rebuilds its exact version-1 layout; a new one records version 3 (Game.generateSection)', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const oldKey = {level: 'subway' as const, section: 'main', station: 'st-old'}, newKey = {level: 'subway' as const, section: 'main', station: 'st-new'};
    run.memory(oldKey).visits = 2;
    const version = (k: typeof oldKey) => {
      const v = subwayLayoutVersionFor(run.peekMemory(k));
      if (run.laneStore(SUBWAY_LAYOUT_LANE, k) === undefined) run.setLaneStore(SUBWAY_LAYOUT_LANE, {v}, k);
      return v;
    };
    expect([version(oldKey), version(newKey)]).toEqual([1, 3]);
    run.memory(newKey).visits++;
    expect([version(oldKey), version(newKey)]).toEqual([1, 3]);
    expect([run.laneStore(SUBWAY_LAYOUT_LANE, oldKey), run.laneStore(SUBWAY_LAYOUT_LANE, newKey)]).toEqual([{v: 1}, {v: 3}]);
    // the visited station (a new-family seed): its version-1 rebuild is the build it was saved with (the generator before this task)
    const s = FAMILY_SEEDS.cavern;
    const before = generateStation(s), rebuilt = generateStation(s, {layoutVersion: 1});
    expect(rebuilt.identity).toBeUndefined();
    expect(layoutHash(rebuilt)).toBe(layoutHash(before));
    expect(layoutHash(gen(s, 1))).toBe(layoutHash(gen(s)));
    const src = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
    expect(src).toMatch(/key\.level === 'subway' && key\.section === 'main' \? subwayLayoutVersionFor\(run\.peekMemory\(key\)\)/);
    expect(src).toMatch(/key\.level === 'subway' && key\.section === 'main' \? SUBWAY_LAYOUT_LANE/);
    expect(src).toMatch(/run\.setLaneStore\(versionLane, \{v: layoutVersion\}, key\)/);
    expect(src).toMatch(/installSubwayIdentityTextures\(this\)/);
  }, 120_000);
});

describe('the version-2 roll', () => {
  it('classic ~40 %, each new family ~20 %; the families and themes are fixed per seed', () => {
    const N = 3000, count = new Map<string, number>();
    for (let s = 1; s <= N; s++) count.set(planFamilyOf(s), (count.get(planFamilyOf(s)) ?? 0) + 1);
    for (const [f, w] of PLAN_FAMILY_WEIGHTS) {
      expect((count.get(f) ?? 0) / N, f).toBeGreaterThan(w - 0.04);
      expect((count.get(f) ?? 0) / N, f).toBeLessThan(w + 0.04);
    }
    expect(Object.entries(FAMILY_SEEDS).every(([f, s]) => planFamilyOf(s) === f)).toBe(true);
    expect(Object.entries(SURFACE_SEEDS).every(([f, s]) => planFamilyOf(s) === f && surfacePresent('subway', s, SURFACE_VERSION))).toBe(true);
    // the cavern is always painted rock; every other family a tile or cast-concrete theme
    for (let s = 1; s <= 400; s++) for (const a of [...ARCHETYPES, ...PLAN_FAMILIES] as Archetype[]) {
      const id = stationIdentityOf(s, a);
      expect(STATION_THEMES[id.theme], id.theme).toBeTruthy();
      expect(id.walls === 'rock', `${a} ${s} ${id.theme}`).toBe(a === 'cavern');
      expect(id.finishCeiling).toBe(id.walls !== 'tile');
    }
  });

  it('version 1 (and a direct generator call) never rolls a new family nor carries an identity', () => {
    for (const s of [...Object.values(FAMILY_SEEDS), ...Object.values(SURFACE_SEEDS)]) {
      const L = generateStation(s);
      expect(L.archetype).toBe(pickArchetype(s));
      expect(L.identity).toBeUndefined();
    }
  }, 120_000);

  it('a classic seed at version 2 = its version-1 layout + only the identity (no generation draw moved)', () => {
    for (const s of CLASSIC_SEEDS) {
      expect(planFamilyOf(s)).toBe('classic');
      const a = gen(s, 1), b = gen(s, 2);
      expect(b.identity, `seed ${s}`).toBeTruthy();
      expect(b.archetype).toBe(a.archetype);
      expect(layoutHash({...b, identity: undefined}), `seed ${s} (${b.archetype})`).toBe(layoutHash(a));
    }
  }, 120_000);
});

describe('the plan families at natural seeds', () => {
  const classicHall = Math.max(...CLASSIC_SEEDS.map(s => Math.max(...gen(s, 1).areas.filter(a => a.type === 'fare-hall').map(m2))));

  for (const fam of PLAN_FAMILIES) {
    it(`${fam} (seed ${FAMILY_SEEDS[fam as keyof typeof FAMILY_SEEDS]}): valid, its signature, the train, the track extensions`, () => {
      const L = gen(FAMILY_SEEDS[fam as keyof typeof FAMILY_SEEDS], 2);
      expect(L.archetype).toBe(fam);
      expect(validateLayout(L)).toEqual([]);
      expect(L.identity).toBeTruthy();
      expect(playerTrainPlacement(L), 'the player train').not.toBeNull();
      expect(L.extensions?.tunnels.length ?? 0, 'a track tunnel').toBeGreaterThanOrEqual(1);
      const sig = signatureAreas(L.areas);
      const props = (kind: string, area?: number) => L.props.filter(p => p.kind === kind && (area === undefined || p.area === area)).length;
      if (fam === 'grand-hall') {
        const T = sig.filter(a => a.role === 'grand-ticket-hall');
        expect(T.length).toBe(1);
        const fares = L.doors.filter(d => d.fare && (d.a === T[0].id || d.b === T[0].id));
        expect(fares.length, 'gate banks into the great hall').toBeGreaterThanOrEqual(2);
        expect(m2(T[0]), 'the great hall vs the largest classic ticket hall').toBeGreaterThan(1.5 * classicHall);
        expect(T[0].ceil).toBeGreaterThanOrEqual(7.2);
        expect(props('booth', T[0].id), 'a booth at every gate bank').toBe(fares.length);
        expect(props('ticketMachine', T[0].id)).toBeGreaterThanOrEqual(2 * fares.length);
        expect(sig.some(a => a.role === 'gate-gallery') && sig.some(a => a.role === 'waiting-hall')).toBe(true);
      } else if (fam === 'cavern') {
        expect(sig.filter(a => a.role === 'grotto').length).toBeGreaterThanOrEqual(2);
        expect(L.identity!.walls).toBe('rock');
        // one vault over both tracks: no column line between the beds (a classic side-platform bed keeps its centre columns)
        expect(L.trenches.length).toBeGreaterThanOrEqual(1);
        expect(L.trenches.every(t => !t.columns)).toBe(true);
        expect(L.areas.some(a => a.role === 'escalator' && a.label === 'Inclined passage')).toBe(true);
      } else {
        const H = sig.find(a => a.role === 'interchange-hall')!;
        expect(H).toBeTruthy();
        expect(L.areas.filter(a => a.kind === 'platform').map(a => a.platformNo).sort()).toEqual([1, 2, 3]);
        expect(L.areas.filter(a => a.type === 'fare-hall').length, 'a ticket hall at each end').toBeGreaterThanOrEqual(2);
        const lines = L.signs.filter(s => s.area === H.id && /^LINE [12] /.test(s.text)).map(s => s.text.slice(0, 6));
        expect(new Set(lines)).toEqual(new Set(['LINE 1', 'LINE 2']));
      }
    }, 120_000);
  }

  it('the player train at the placement test seeds (11, 9001) for every new family', () => {
    for (const fam of PLAN_FAMILIES) for (const s of [11, 9001]) {
      const L = generateStation(s, {archetype: fam, layoutVersion: 2});
      expect(L.archetype, `${fam} ${s}`).toBe(fam);
      expect(validateLayout(L), `${fam} ${s}`).toEqual([]);
      expect(playerTrainPlacement(L), `${fam} ${s}`).not.toBeNull();
    }
  }, 240_000);

  it('the Surface Run access: its normal closed exit stair opens on every family (no new validator issue)', () => {
    for (const [fam, s] of Object.entries(SURFACE_SEEDS)) {
      const L0 = gen(s, 2, 0), L1 = gen(s, 2);
      expect(L1.archetype).toBe(fam);
      expect(L0.surfaceAccess).toBeUndefined();
      const a = L1.surfaceAccess!;
      expect(a?.kind, `${fam} ${s}`).toBe('subway-stair');
      expect(L1.areas[a.hall!].type).toBe('exit-stair');
      const base = new Set(validateLayout(L0));
      expect(validateLayout(L1).filter(x => !base.has(x)), `${fam} ${s}`).toEqual([]);
    }
  }, 240_000);

  it('generation stays within budget (warm; the classic stations ~0.2-0.8 s here)', () => {
    for (const fam of PLAN_FAMILIES) generateStation(101, {archetype: fam, layoutVersion: 2});
    for (const [fam, s] of Object.entries(FAMILY_SEEDS)) {
      const t0 = performance.now();
      generateStation(s, {layoutVersion: 2});
      expect(performance.now() - t0, fam).toBeLessThan(2500);
    }
  }, 120_000);
});

describe('the station identity: drawn with the Subway architecture sets', () => {
  // (task studio-subway-architecture-materials-rework-20261117-072826-01: the identity no longer stretches the Reactor's pit concrete / the
  // mine rock over walls and ceilings; every public wall is zoned in the scheme's Codex-generated sets — world/subwayFinish.ts; the kit's
  // relief is tests/subway-arch-kit.test.ts)
  const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const meshes = (w: BuiltWorld): THREE.Mesh[] => { const out: THREE.Mesh[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
  const keyed = (w: BuiltWorld, k: string) => meshes(w).filter(m => m.name.startsWith(`arch-${k}@`));

  it('the pure parts: impact classes, arch-owned keys, wall treatments, the asset rule, plates, atmosphere', () => {
    expect(finishClass('subway-tile-field')).toBe('tile');
    expect(finishClass('subway-rock-dado')).toBe('concrete');
    expect(finishClass('subway-concrete-ceil-hall')).toBe('concrete');
    expect(finishClass('subway-plaster-ceil')).toBe('plaster');
    expect(finishClass('subway-metal-ceil')).toBe('steel');
    expect(finishClass('subway-terrazzo-floor')).toBe('terrazzo');
    for (const k of ['subway-tile-field', 'subway-stone-plinth', 'subway-rock-dado', 'subway-plaster-ceil']) expect(isArchFinish(k), k).toBe(true);
    // the scheme's tile / stone never take the station tile grid's cuts; precast concrete spalls; painted rock is the tunnel's treatment
    expect(finishFamily('subway-tile-field')).toBe('office');
    expect(finishFamily('subway-stone-plinth')).toBe('office');
    expect(finishFamily('subway-concrete-dado')).toBe('concrete');
    expect(finishFamily('subway-rock-dado')).toBe('concrete');
    expect(treatmentOf({zone: 'platform', finish: 'subway-rock-dado'})).toBe('trackTunnel');
    expect(treatmentOf({zone: 'stair', finish: 'subway-rock-dado'})).toBe('stairCore');
    expect(treatmentOf({zone: 'platform', finish: 'subway-tile-field'})).toBe(treatmentOf({zone: 'platform', finish: 'tileLower'}));
    expect(subwayPlate({})).toBeNull();
    expect(subwayArchKeysOf({})).toEqual([]);
    for (const fam of ['classic', 'grand-hall', 'cavern', 'hub'] as const) {
      const keys = subwayArchKeysOf({identity: stationIdentityOf(FAMILY_SEEDS[fam], fam === 'classic' ? 'split' : fam)});
      expect(keys.length, fam).toBeGreaterThanOrEqual(3);
      for (const k of keys) expect(assetAllowedIn('subway', SUBWAY_ARCH_TEXTURES[k].color.url), k).toBe(true);
    }
    expect(atmosphereFor({archetype: 'cavern'}).density).toBeGreaterThan(atmosphereFor({archetype: 'side-mezzanine'}).density);
  });

  it('a cavern draws painted rock on its public walls, track bed and ceilings over a granite base; version 1 draws none', () => {
    const L = gen(FAMILY_SEEDS.cavern, 2);
    const w = buildWorld(L, mats(), {});
    expect(w.subwayArch).toBeTruthy();
    expect(w.subwayArch!.stats.faces['subway-rock-dado']).toBeGreaterThan(100);
    const walls = keyed(w, 'subway-rock-dado'), ceils = keyed(w, 'subway-rock-ceil');
    expect(walls.length).toBeGreaterThan(0);
    expect(ceils.length).toBeGreaterThan(0);
    expect(keyed(w, 'subway-stone-plinth').length).toBeGreaterThan(0);
    const m = walls[0].material as THREE.Material;
    expect(m.userData[SUBWAY_WALL_TAG]).toBe(true);
    expect(m.userData.subwayArchTex).toBe('rockPainted');
    expect((ceils[0].material as THREE.Material).userData[SUBWAY_WALL_TAG]).toBeUndefined();
    // the same seed's version-1 build: no identity, no identity finish anywhere
    const w1 = buildWorld(gen(FAMILY_SEEDS.cavern, 1), mats(), {});
    expect(w1.subwayArch).toBeUndefined();
    const zoneKey = /^subway-(tile|stone|concrete|plaster|metal|terrazzo|rock)-/;
    expect(meshes(w1).some(q => /^(arch|trim)-subway-/.test(q.name) || zoneKey.test((q.material as THREE.Material).name))).toBe(false);
  }, 240_000);

  it('a tile station zones its walls in the scheme sets; a brutalist one is precast concrete with concrete coffers', () => {
    // seed 4: a civic grand hall (tile); seed 3: a brutalist grand hall (concrete)
    const tile = gen(4, 2), conc = gen(3, 2);
    expect([tile.identity!.theme, conc.identity!.theme]).toEqual(['civic', 'brutalist']);
    const wt = buildWorld(tile, mats(), {});
    for (const k of ['subway-stone-plinth', 'subway-tile-dado', 'subway-tile-field', 'subway-tile-band', 'subway-stone-field-hall', 'subway-plaster-ceil', 'subway-stone-floor']) expect(keyed(wt, k).length, k).toBeGreaterThan(0);
    expect((keyed(wt, 'subway-tile-field')[0].material as THREE.Material).userData.subwayArchTex).toBe('tileBlueSquare');
    // the old glazed tile set is gone from the public walls
    expect(keyed(wt, 'tileUpper').length + keyed(wt, 'tileLower').length).toBe(0);
    const wc = buildWorld(conc, mats(), {});
    expect(keyed(wc, 'subway-concrete-dado').length).toBeGreaterThan(0);
    expect(keyed(wc, 'subway-concrete-ceil').length).toBeGreaterThan(0);
    expect((keyed(wc, 'subway-concrete-dado')[0].material as THREE.Material).userData.subwayArchTex).toBe('concretePrecast');
    expect(meshes(wc).some(m => /pit-concrete|mine-rock/.test(String((m.material as THREE.MeshStandardMaterial).map?.name ?? '')))).toBe(false);
  }, 240_000);
});
