// Task reactor-expansion-20261101 (lane MINES): THE OLD MINE WORKINGS in the REAL Reactor level (LEVELS.reactor.generate over 8 seeds,
// lane HOST's slot / dresser / populations / lighting): the whole level valid (reactorIssues + complexIssues clean), the mines complex
// hosting zone 1's generator on tier 2 with its full program (>= 10 spaces, >= 600 m², two routes, the set pieces), the visuals plan
// (timber sets / rail line / models) derived from it, determinism and the generation budget.
// Task reactor-playtest-round2-20261102 (lane MINES): the program is a seeded drift / room graph now — the guaranteed spaces (adit,
// junction, haulage, cavern, development heading), a loop, a distinct graph per level seed, the drill in its heading at the runtime fit.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {LEVELS} from '../src/levels/registry';
import {reactorIssues, REACTOR_GEN_STATS} from '../src/gen/reactor/index';
import {complexIssues} from '../src/gen/reactor/complex/host';
import {CELL, FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {MINE_PIECE} from '../src/gen/reactor/complex/minesDress';
import {MINES_NAME} from '../src/gen/reactor/complex/mines';
import {buildMinesVisuals, planMinesVisuals} from '../src/world/reactor/minesVisuals';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {WorldMaterials} from '../src/world/materials';
import {minesModelKeysFor, MINES_FIT, MINES_MODELS, REACTOR_X_MODEL_FILES} from '../src/world/reactor/minesAssets';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const cache = new Map<number, {L: StationLayout; ms: number}>();
const gen = (seed: number) => {
  let e = cache.get(seed);
  if (!e) { const L = LEVELS.reactor.generate('main', {levelSeed: seed}); e = {L, ms: REACTOR_GEN_STATS.ms}; cache.set(seed, e); }
  return e;
};
const log = (name: string, v: unknown) => { try { writeFileSync(`/tmp/reactor-x-mines-level-${name}.json`, JSON.stringify(v, null, 1)); } catch { /* diagnostics only */ } };

describe('Reactor mines complex — in the real level (lane MINES)', () => {
  it('hosts zone 1\'s generator on tier 2 in the mines; the level is valid (reactorIssues + complexIssues)', () => {
    const out: unknown[] = [];
    for (const seed of SEEDS) {
      const {L} = gen(seed), R = L.reactor!;
      const c = R.complexes?.find(q => q.id === 'mines');
      expect(c, `seed ${seed}: mines complex`).toBeDefined();
      expect(reactorIssues(L), `seed ${seed}`).toEqual([]);
      expect(complexIssues(L), `seed ${seed}`).toEqual([]);
      expect(c!.level).toBe(2);
      expect(c!.zone).toBe(1);
      expect(c!.name).toBe(MINES_NAME);
      const g1 = R.generators[c!.generator];
      expect(g1.zone).toBe(1);
      expect(c!.areas).toContain(g1.area);
      expect(c!.rooms.find(r => r.area === g1.area)?.key).toBe('cavern');
      // the program: since task reactor-playtest-round2-20261102 a seeded drift / room graph — the adit, the junction, the haulage, the
      // cavern and the development heading always, >= 1 loop (openings >= spaces), the rest seeded
      const keys = c!.rooms.map(r => r.key);
      for (const k of ['portal', 'junction', 'cavern', 'heading', 'haulage-0']) expect(keys, `${seed} ${k}`).toContain(k);
      expect(c!.rooms.length).toBeGreaterThanOrEqual(10);
      const ids0 = new Set(c!.areas), inner = L.doors.filter(d => ids0.has(d.a) && ids0.has(d.b));
      expect(inner.length, `seed ${seed} loop`).toBeGreaterThanOrEqual(c!.areas.length);
      // the generator stope is never a cul-de-sac: two openings into the workings (the haulage + a manway / return airway)
      expect(inner.filter(d => d.a === g1.area || d.b === g1.area).length, `seed ${seed} cavern ways in`).toBeGreaterThanOrEqual(2);
      const g = L.levels[2].grid, ids = new Set(c!.areas);
      let walk = 0, free = 0;
      for (let i = 0; i < g.cells.length; i++) if (ids.has(g.area[i]) && g.cells[i] === FLOOR) { walk++; if (!g.blocked[i] && g.rampIdx[i] < 0) free++; }
      expect(walk * CELL * CELL, `seed ${seed} m²`).toBeGreaterThanOrEqual(650);
      // the host's "substantial" floor (complexIssues: >= 500 m² walkable AFTER props) with a margin: never a whole-level retry
      expect(free * CELL * CELL, `seed ${seed} m² after props`).toBeGreaterThanOrEqual(560);
      out.push({seed, rooms: c!.rooms.length, m2: walk * CELL * CELL, free: free * CELL * CELL, wall: c!.slot?.inward, attempts: REACTOR_GEN_STATS.attempts});
    }
    log('summary', out);
  });

  it('is a different mine every generation: distinct space graphs over the 8 level seeds, the drill jumbo in its heading at the runtime fit', () => {
    const sigs = new Set<string>(), courses = new Set<number>();
    for (const seed of SEEDS) {
      const {L} = gen(seed), c = L.reactor!.complexes!.find(q => q.id === 'mines')!;
      const kind = new Map(c.rooms.map(r => [r.area, r.key.replace(/-\d+$/, '')]));
      const edges = L.doors.filter(d => kind.has(d.a) && kind.has(d.b)).map(d => [kind.get(d.a)!, kind.get(d.b)!].sort().join('-')).sort();
      sigs.add(edges.join(','));
      courses.add(c.rooms.filter(r => /^haulage-\d+$/.test(r.key)).length);
      const hd = c.rooms.find(r => r.key === 'heading')!;
      const drill = L.props.filter(p => p.kind === 'annexMachine' && p.variant === MINE_PIECE.drill);
      expect(drill.length, `seed ${seed} drill`).toBe(1);
      expect(drill[0].area, `seed ${seed} drill in the heading`).toBe(hd.area);
      const v = planMinesVisuals(L)!;
      expect(v.models.drillRig[0].sx).toBe(MINES_FIT.drillRig);
    }
    log('variety', {sigs: [...sigs], courses: [...courses]});
    expect(sigs.size).toBe(SEEDS.length);
    expect(courses.size).toBeGreaterThanOrEqual(2);
  });

  it('dresses the workings in the real level: hoist winch + winze, ore carts, drill, cribs; storage opens; the generator room lit', () => {
    let hoists = 0;
    for (const seed of SEEDS) {
      const {L} = gen(seed), c = L.reactor!.complexes!.find(q => q.id === 'mines')!, ids = new Set(c.areas);
      const props = L.props.filter(p => ids.has(p.area));
      const n = (v: number) => props.filter(p => p.kind === 'annexMachine' && p.variant === v).length;
      if (n(MINE_PIECE.winch) && n(MINE_PIECE.winze)) hoists++;
      expect(n(MINE_PIECE.cart), `seed ${seed} carts`).toBeGreaterThanOrEqual(1);
      expect(n(MINE_PIECE.crib)).toBeGreaterThanOrEqual(1);
      expect(props.filter(p => p.kind === 'crate' || p.kind === 'cabinetTall' || p.kind === 'staffLockers').length).toBeGreaterThanOrEqual(4);
      for (const p of props) { expect(p.level).toBe(2); expect(p.y).toBeGreaterThanOrEqual(L.levels[2].baseY - 0.02); }
      const cav = L.areas[L.reactor!.generators[c.generator].area];
      expect(cav.lighting).toBe('lit');
      // enemies of the tier context may roam the workings; never on the generator's stand point
      const gen1 = L.reactor!.generators[c.generator];
      for (const z of L.zombies) if ((z.level ?? 0) === 2) expect(Math.hypot(z.x - gen1.use.x, z.z - gen1.use.z)).toBeGreaterThan(0.5);
    }
    expect(hoists).toBeGreaterThanOrEqual(SEEDS.length - 1);
  });

  it('plans the runtime visuals from the layout: timber sets along the drifts, the rail line, the hero models; requests the expansion models', () => {
    for (const seed of SEEDS) {
      const {L} = gen(seed);
      const v = planMinesVisuals(L)!;
      expect(v, `seed ${seed}`).not.toBeNull();
      expect(v.stats.sets, `seed ${seed} sets (${v.stats.setsSkipped} skipped)`).toBeGreaterThanOrEqual(6);
      expect(v.stats.railM).toBeGreaterThan(10);
      expect(v.models.mineCart.length).toBeGreaterThanOrEqual(1);
      expect(v.models.timberSet.length).toBe(v.stats.sets);
      // the sets clear >= 2.3 m under their cap (0.711 x the drift's clear height) and stand within the drift's floor
      const g = L.levels[2].grid;
      const posts = L.props.filter(p => p.kind === 'annexMachine' && p.variant === MINE_PIECE.post);
      expect(posts.length).toBe(2 * v.stats.sets);
      for (const m of v.models.timberSet) {
        expect(1.79 * m.sy).toBeGreaterThanOrEqual(2.3);
        const [cx, cy] = g.cellOf(m.x, m.z), a = L.areas[g.area[g.idx(cx, cy)]];
        expect(g.cells[g.idx(cx, cy)]).toBe(FLOOR);
        // the whole set (cap ends at +-1.7 x sx) stays inside the drift's one-cell rock walls; both posts are collision boxes there
        const alongX = Math.abs(m.yaw - Math.PI / 2) < 1e-6, Wd = (alongX ? a.h : a.w) * CELL; // a set's yaw: across its drift's travel
        expect(1.7 * m.sx).toBeLessThanOrEqual(Wd / 2 + 0.49);
        const mine = posts.filter(p => p.area === a.id && Math.abs((alongX ? p.x : p.z) - (alongX ? m.x : m.z)) < 1e-3);
        expect(mine.length).toBe(2);
        // a post standing proud of the 0.1 m edge allowance blocks its rib cell (nav + the walk volume agree with the collider)
        const proud = Wd / 2 - 1.03 * m.sx;
        for (const p of mine) if (proud > 0.12) expect(g.blocked[g.idx(...g.cellOf(p.x, p.z))]).toBe(1);
      }
      expect(minesModelKeysFor(L)).toEqual(Object.values(MINES_MODELS).map(m => m.key));
    }
    for (const m of Object.values(MINES_MODELS)) expect(REACTOR_X_MODEL_FILES[m.key]).toEqual({url: m.url, bytes: m.bytes});
    expect(minesModelKeysFor({})).toEqual([]);
  });

  it('builds the visuals: instanced per material / model mesh, tagged with the storey; the Meshy models when loaded, textured stand-ins otherwise', () => {
    installCanvasShim(false);
    const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const {L} = gen(2);
    // without models: stand-ins in existing materials
    const g0 = new THREE.Group(), s0 = buildMinesVisuals(g0, L, mats, {});
    expect(s0.plan).not.toBeNull();
    expect(s0.models).toEqual({});
    expect(g0.children.length).toBe(s0.meshes);
    for (const o of g0.children) {
      expect(o.userData.level).toBe(2);
      expect((o as THREE.InstancedMesh).isInstancedMesh).toBe(true);
      const m = (o as THREE.Mesh).material as THREE.Material & {map?: unknown};
      expect(m).toBeDefined();
    }
    // with (stand-in) GLTFs for the four keys: one InstancedMesh per model mesh, instances = placements
    const fake = (): GLTF => { const s = new THREE.Group(); s.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())); return {scene: s} as unknown as GLTF; };
    const models = Object.fromEntries(Object.values(MINES_MODELS).map(m => [m.key, fake()]));
    const g1 = new THREE.Group(), s1 = buildMinesVisuals(g1, L, mats, models);
    expect(s1.models.timberSet).toBe(s1.plan!.sets);
    expect(s1.models.mineCart).toBeGreaterThanOrEqual(1);
    expect(g1.children.filter(o => /model-timberSet/.test(o.name)).reduce((n, o) => n + (o as THREE.InstancedMesh).count, 0)).toBe(s1.plan!.sets);
    expect(s1.meshes).toBeLessThan(24); // bounded draw calls
    // a non-mines layout builds nothing
    expect(buildMinesVisuals(new THREE.Group(), {...L, reactor: {...L.reactor!, complexes: []}}, mats, {}).meshes).toBe(0);
  });

  it('is deterministic and stays inside the generation budget', () => {
    const a = LEVELS.reactor.generate('main', {levelSeed: 3}), b = LEVELS.reactor.generate('main', {levelSeed: 3});
    const pick = (L: StationLayout) => JSON.stringify({c: L.reactor!.complexes!.find(q => q.id === 'mines'), props: L.props.filter(p => p.level === 2), signs: L.signs.filter(s => s.level === 2)});
    expect(pick(a)).toBe(pick(b));
    const ms = SEEDS.map(s => gen(s).ms).sort((x, y) => x - y);
    log('ms', ms);
    expect(ms[Math.floor(ms.length / 2)]).toBeLessThan(1200);
  });
});
