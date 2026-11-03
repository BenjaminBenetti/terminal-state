// Task reactor-expansion-20261101 (lane GASLIGHT): THE REACTOR PIT'S LAMPS + THE OPEN ROOF on real generated layouts and the world
// builder. User: "lights on the walls … an orange circle … but no light" and "lights floating in the air, around player level".
//  - every lamp inside the pit is a MOUNTED fixture (wall bracket on a real wall / post on a free-standing deck), below the roof line,
//    clear of every walkway / flight at its head, in a light-field band (it is baked: it casts); the old floating ones are gone;
//  - the circuits: the rim steady, emergency lamps steady, the rest on circuit 2 (dark until the restart) — a lit lamp lights the pit
//    around it, a held one lights nothing and its glass reads dead (the tube instance IS its lens);
//  - the kit draws no decorative emissive lamps any more; the bodies are instanced with the kit;
//  - the roof opening (task reactor-submit-roof-fog-20261102, lane ROOF — was the whole top open): levels[0].sky at the roof line
//    with the opening mask (the slab elsewhere, rays leave only through the hole), the sky dome + outside gas over the opening.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {FLOOR, SOLID, CELL} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {LightPlacement, StationLayout} from '../src/gen/stationTypes';
import {inOutline, pitLampStats, PIT_LAMPS} from '../src/gen/reactor/gaslightLamps';
import {bakeLightField, fixtureGroup, sampleField} from '../src/world/lightField';
import {LevelColumns, ceilingRuns, stationLevels} from '../src/world/levelGeometry';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {levelFixture} from './helpers/levelFixture';
import {archFixtureInfo} from './reactor-arch-fixture';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {StationLighting} from '../src/world/lights';
import {LAMP_BODY, isMounted} from '../src/world/reactor/gaslightFixtures';
import {buildPitSky, PIT_SKY} from '../src/world/reactor/gaslightSky';
import {roofOpeningOf} from '../src/gen/reactor/roofOpening'; // task reactor-submit-roof-fog-20261102 (lane ROOF)
import {REACTOR_FOG} from '../src/world/reactor/archInstall';
import type {ReactorInfo} from '../src/gen/reactor/reactorTypes';

installCanvasShim(false);

const SEEDS = [9100, 637474];
const cache = new Map<number, StationLayout>();
const level = (seed: number) => { let L = cache.get(seed); if (!L) cache.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };
const pitLights = (L: StationLayout) => L.lights.filter(l => !l.virtual && inOutline(L.reactor!.pit.outline, l.x, l.z));
const lum = (s: {amb: readonly number[]; dirColor: readonly number[]}) => 0.2126 * (s.amb[0] + s.dirColor[0]) + 0.7152 * (s.amb[1] + s.dirColor[1]) + 0.0722 * (s.amb[2] + s.dirColor[2]);

describe('gaslight lamps: real generated Reactors', () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: every pit lamp is mounted on a real wall / a deck post, below the roof line, clear of every walkway`, () => {
      const L = level(seed), info = L.reactor!, st = pitLampStats(L)!;
      expect(st).not.toBeNull();
      const lamps = pitLights(L);
      expect(lamps.length).toBe(st.wall + st.post);
      expect(st.wall).toBeGreaterThan(40);
      for (const l of lamps) {
        const m = l.mount!;
        expect(m, `lamp at ${l.x},${l.y},${l.z}`).toBeDefined();
        expect(l.broken).toBe(false);
        expect(l.y).toBeLessThan(info.pit.roofY - 2);
        expect(Math.hypot(l.x - m.x, l.z - m.z)).toBeLessThan(0.6);
        // in a light-field band of its storey: the bake uses it (it casts)
        const g = L.levels[l.level ?? 0].grid, [cx, cy] = g.cellOf(l.x, l.z), i = g.idx(cx, cy);
        expect(g.cells[i]).not.toBe(SOLID);
        expect(g.floorOf(i)).toBeLessThan(l.y);
        expect(g.ceil[i]).toBeGreaterThan(l.y);
        // nothing walkable at the head (no head clips a lamp)
        for (const lv of L.levels) {
          const gg = lv.grid, j = gg.idx(cx, cy);
          if (gg.cells[j] !== FLOOR) continue;
          const f = gg.floorAt(l.x, l.z);
          expect(f > l.y - 2.0 && f < l.y + 0.5, `walkway at the head of ${l.x},${l.y},${l.z} (level ${lv.id} floor ${f})`).toBe(false);
        }
        if (m.kind === 'wall') {
          // on the pit wall line, a real wall behind it (no open band there at the lamp's height on any storey)
          const P = info.pit.outline;
          let dmin = Infinity;
          for (let k = 0; k < P.length; k++) {
            const a = P[k], b = P[(k + 1) % P.length], ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
            const t = Math.max(0, Math.min(1, ((m.x - a.x) * ex + (m.z - a.z) * ez) / L2));
            dmin = Math.min(dmin, Math.hypot(a.x + ex * t - m.x, a.z + ez * t - m.z));
          }
          expect(dmin).toBeLessThan(0.02);
          for (const lv of L.levels) {
            const gg = lv.grid, [bx, by] = gg.cellOf(m.x - m.nx * 0.25, m.z - m.nz * 0.25), j = gg.idx(bx, by);
            if (gg.cells[j] === SOLID) continue;
            const f = gg.floorOf(j), c = gg.ceil[j];
            expect(f > m.y + 0.4 || c < m.y - 0.6, `opening behind the wall lamp at ${m.x},${m.y},${m.z} (level ${lv.id})`).toBe(true);
          }
          // the head height above its storey's deck (believable: above heads, under the painted tier band)
          const t = info.tiers.reduce((best, tt) => (tt.baseY <= m.y && tt.baseY > best.baseY ? tt : best), {baseY: -Infinity} as {baseY: number});
          expect(m.y - t.baseY).toBeCloseTo(PIT_LAMPS.wallY, 3);
        } else {
          // on a free-standing deck's rail line: the foot at the deck top, inside its rect edge; the head over the walkway
          const d = info.decks.find(dd => (dd.kind === 'bridge' || dd.kind === 'tower') && Math.abs(dd.y - m.y) < 0.01 && m.x >= dd.rect.x0 - 0.01 && m.x <= dd.rect.x1 + 0.01 && m.z >= dd.rect.z0 - 0.01 && m.z <= dd.rect.z1 + 0.01);
          // task reactor-expansion-20261101 (lane CORE): or a post on the core floor's goop railings (service ring / radial bridges)
          const cf = info.coreFloor, onCore = !!cf && Math.abs(m.y - cf.y) < 0.01 && Math.hypot(m.x - cf.x, m.z - cf.z) < cf.pool.r1 + 0.5;
          expect(d ?? (onCore || undefined), `post foot ${m.x},${m.y},${m.z}`).toBeDefined();
          expect(l.y - m.y).toBeCloseTo(PIT_LAMPS.postY, 3);
        }
      }
      // the old floating fixtures are gone: no pit light without a mount, none above the rim higher than a wall lamp
      expect(L.lights.filter(l => !l.virtual && inOutline(info.pit.outline, l.x, l.z) && !l.mount)).toEqual([]);
      expect(st.removed).toBeGreaterThan(0);
    }, 60_000);
  }

  it('circuits: the rim steady, emergency lamps steady on every tier, the rest on circuit 2; a lit lamp casts, a held one lights nothing', () => {
    const L = level(SEEDS[0]), lamps = pitLights(L);
    const idx = new Map<LightPlacement, number>(L.lights.map((l, i) => [l, i]));
    const steady = lamps.filter(l => !l.dying), dying = lamps.filter(l => l.dying);
    expect(dying.length).toBeGreaterThan(20);
    expect(steady.length).toBeGreaterThan(20);
    for (const l of lamps) if ((l.level ?? 0) === 0 && l.y > -1) expect(l.dying).toBe(false);
    for (const l of dying) expect(fixtureGroup(l, idx.get(l)!)).toBe(2);
    const tiers = new Set(lamps.filter(l => l.y < -3).map(l => Math.round(l.y)));
    expect(tiers.size).toBeGreaterThan(3);
    // the baked field: 1 m out from the wall, 1.6 m under the lamp
    const f = bakeLightField({grid: L.grid, lights: L.lights, trenchFloorY: L.trench.floorY, levels: stationLevels(L)});
    const at = (l: LightPlacement, levels: [number, number, number]) => {
      const m = l.mount!;
      return lum(sampleField(f, l.x + m.nx * 0.6, l.y - 1.6, l.z + m.nz * 0.6, levels));
    };
    const walls = (list: LightPlacement[]) => list.filter(l => l.mount!.kind === 'wall');
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length);
    const lit = mean(walls(steady).filter(l => l.y < -3).map(l => at(l, [1, 1, 0])));
    const held = mean(walls(dying).map(l => at(l, [1, 1, 0])));
    const restored = mean(walls(dying).map(l => at(l, [1, 1, 1])));
    expect(lit).toBeGreaterThan(held * 2.5); // the lit lamps really light the pit round them
    expect(restored).toBeGreaterThan(held * 3); // the held ones cast once powered (the restart)
  }, 120_000);

  // task reactor-submit-roof-fog-20261102 (lane ROOF, user: "a single hole above the reactor not a totally open roof"): was the whole
  // top open (no ceiling over any pit cell); the full opening checks are game/tests/reactor-x-roof-opening.test.ts
  it('the roof opening: the rim storey opens to the sky at the roof line ONLY over the core; the roof slab elsewhere; walls stop rays', () => {
    const L = level(SEEDS[0]), info = L.reactor!, o = roofOpeningOf(info)!;
    // (task studio-reactor-surface-ending-20261102, lane ENDING: the sky ceil is now the surface plaza's band top over the roof; the pit's
    // roof-line band tops stay ceilings below it — the full opening checks: reactor-x-roof-opening.test.ts)
    expect(L.levels[0].sky).toMatchObject({y: info.pit.rimY, ceil: info.surface!.ceil, top: info.pit.roofY});
    expect(L.levels[0].sky!.open).toBeInstanceOf(Uint8Array);
    expect(L.levels.filter(l => l.sky).length).toBe(1);
    const levels = stationLevels(L), runs = ceilingRuns(levels, new LevelColumns(levels));
    const b = info.pit.bounds, inPit = (r: {row: number; x0: number; x1: number}) => (r.row + 0.5) * CELL > b.z0 && (r.row + 0.5) * CELL < b.z1 && (r.x1 * CELL) > b.x0 && r.x0 * CELL < b.x1;
    const roof = runs.filter(r => inPit(r) && r.y >= info.pit.roofY - 0.6);
    expect(roof.length).toBeGreaterThan(50);
    for (const r of roof) for (let x = r.x0; x < r.x1; x++) expect(Math.hypot((x + 0.5) * CELL - o.x, (r.row + 0.5) * CELL - o.z)).toBeGreaterThan(o.r - CELL);
    const lv = levelsOf(L);
    expect(lv.raycast({x: o.x, y: 2, z: o.z}, {x: 0.05, y: 1, z: 0.03}, 200).kind).toBe('none');
    expect(lv.raycast({x: b.x0 + 3, y: 2, z: b.z0 + 3}, {x: 0, y: 1, z: 0}, 200).kind).toBe('ceiling');
    expect(lv.raycast({x: o.x, y: 4, z: o.z}, {x: 1, y: 0, z: 0}, 200).kind).toBe('wall');
  }, 60_000);
});

describe('gaslight lamps: the world (bodies in the kit, the tube instance is the lens, the sky over the opening)', () => {
  const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  function world() {
    const base = levelFixture();
    const a = archFixtureInfo();
    const info: ReactorInfo = {
      ...a,
      pit: {outline: [{x: 8, z: 2}, {x: 19, z: 2}, {x: 19, z: 22}, {x: 8, z: 22}], bounds: {x0: 8, z0: 2, x1: 19, z1: 22}, cx: 13.5, cz: 12, rimY: 0, floorY: -5, roofY: 8.4, variant: 'gaslight-fixture'},
      tiers: [{level: 0, index: 0, role: 'rim', label: 'Rim', baseY: 0, zone: -1, color: 0xc8a030}],
      zones: [], generators: [], fans: [], sites: [], screens: [], decks: [], towers: [], pipeBanks: [],
      core: {x: 15, z: 18, radius: 1.5, y0: -1.15, y1: 3}, markers: [],
      crane: {axis: 'x', railY: 7.6, a0: 9, a1: 18, b0: 3, b1: 21, bridgeAt: 14, trolleyAt: 12, hookY: 2},
    };
    const wall = (z: number, dying: boolean): LightPlacement => ({x: 8.38, y: 2.4, z, rot: Math.PI / 2, area: 0, broken: false, flicker: false, warm: true, power: dying ? 0.9 : 0.55, dying, mount: {kind: 'wall', x: 8, y: 2.55, z, nx: 1, nz: 0}});
    const post: LightPlacement = {x: 14, y: 2.5, z: 12.5, rot: 0, area: 0, broken: false, flicker: false, warm: true, power: 0.9, dying: true, mount: {kind: 'post', x: 14, y: 0, z: 12, nx: 0, nz: 1}};
    const tube: LightPlacement = {x: 28, y: 3.2, z: 6, rot: 0, area: 0, broken: false, flicker: false, warm: true, power: 1, dying: false};
    const L = {...base, reactor: info, lights: [wall(6, false), wall(14, true), post, tube]} as unknown as StationLayout;
    return {L, w: buildWorld(L as never, mats(), {})};
  }

  // task reactor-playtest-round2-20261102 (lane PROPS): the glass is the jar glow inside the cage ('light-glass', sharing the tubes'
  // colour); the light's tube instance is collapsed (it was the flat plate in front of the cage: "strange box in front of" the lamps)
  it('mounted lamps: bodies planned with the kit, NO decorative emissive lamps, the glass = a jar inside the cage at the lamp head', () => {
    const {L, w} = world(), arch = w.reactorArch!;
    expect(arch.plan!.lamps).toEqual([]); // no per-tier KitLamp lenses (the orange circles)
    expect(arch.built!.tierLamps.size).toBe(0);
    expect(arch.mountedLamps.length).toBe(3);
    expect(arch.stats.lamps).toBe(3);
    const glass = w.group.getObjectByName('light-glass') as THREE.InstancedMesh;
    expect(glass).toBe(arch.lampGlass);
    expect(glass.instanceColor).toBe(w.tubes!.instanceColor); // the lighting's per-fixture colour IS the glass colour
    expect(glass.material).toBe(w.tubes!.material);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (const r of arch.mountedLamps) {
      const l = L.lights[r.index];
      expect(isMounted(l)).toBe(true);
      w.tubes!.getMatrixAt(r.index, m);
      m.elements.forEach((v, k) => expect(v).toBeCloseTo(r.lens.elements[k], 4)); // (the instance buffer is float32)
      expect([0, 1, 2].map(k => new THREE.Vector3().setFromMatrixColumn(m, k).length())).toEqual([0, 0, 0]); // the tube box is collapsed: no plate
      glass.getMatrixAt(r.index, m);
      m.elements.forEach((v, k) => expect(v).toBeCloseTo(r.glass.elements[k], 4));
      // the jar's centre (half its height up the lathe) sits at the head: the cage's centre / inside the model's cage
      const c = new THREE.Vector3(0, 0.111, 0).applyMatrix4(m);
      if (!r.model) expect(c.distanceTo(new THREE.Vector3(l.x, l.y, l.z))).toBeLessThan(0.01);
      else expect(c.distanceTo(new THREE.Vector3(l.x, l.y, l.z))).toBeLessThan(0.35);
      m.decompose(p, q, s);
      expect(Math.max(s.x, s.y, s.z) * 0.214).toBeLessThan(0.25); // a small jar, not a 1 m tube
    }
    // the tube fixture outside the pit stays a tube
    w.tubes!.getMatrixAt(3, m); m.decompose(p, q, s);
    expect(s.x).toBeCloseTo(1, 5);
    // no hanging cages / hangers for mounted lamps (the old floating rods)
    const names: string[] = [];
    w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) names.push(o.name); });
    expect(names.some(n => n.startsWith('reactor-lamp-hanger'))).toBe(false);
    expect(LAMP_BODY.cage[1]).toBeLessThan(0.5);
  });

  it('the lens follows the fixture: circuit 2 held at 0 = dead grey glass and no glow card light; steady = lit glass; restored = lit', () => {
    const {L, w} = world();
    const lp = new StationLighting(new THREE.Scene(), L, w.fixtures, w.tubes);
    lp.circuitLevel = [null, null, 0];
    lp.update(0.016);
    const c = new THREE.Color();
    w.tubes!.getColorAt(0, c); // steady emergency wall lamp
    expect(c.r).toBeGreaterThan(0.4);
    w.tubes!.getColorAt(1, c); // circuit 2 held
    expect(c.r).toBeLessThan(0.05);
    w.tubes!.getColorAt(2, c); // the post lamp, circuit 2 held
    expect(c.r).toBeLessThan(0.05);
    expect(lp.fixtureLevel(1)).toBe(0);
    lp.circuitLevel = [null, null, 1];
    lp.update(0.016);
    w.tubes!.getColorAt(1, c);
    expect(c.r).toBeGreaterThan(0.6);
    lp.dispose();
  });

  // task reactor-submit-roof-fog-20261102 (lane ROOF): the sky is built over the roof's single OPENING (none: a closed roof)
  it('the roof opening: a sky dome over the opening (inside the far plane) + the outside gas sheets / curtain, on every pit storey', () => {
    // the world fixture's 11 m pit has no room for an opening (curb + solid band): a closed roof, no sky
    const {w} = world();
    expect(w.reactorArch!.pitSky).toBeNull();
    expect(w.group.getObjectByName('pit-sky')).toBeUndefined();
    // the kit fixture's 44 x 36 m pit: the opening over the core, the sky over it
    const info = archFixtureInfo(), o = roofOpeningOf(info)!, group = new THREE.Group();
    const st = buildPitSky(group, info, [0, 1, 2, 3, 4])!;
    expect(st).toMatchObject({dome: true, opening: o});
    expect(st.gasLayers).toBeGreaterThan(3);
    const names: string[] = [];
    group.traverse(m => { if ((m as THREE.Mesh).isMesh) { names.push(m.name); expect(m.userData.levels).toEqual([0, 1, 2, 3, 4]); } });
    for (const n of ['pit-sky', 'pit-exterior-gas', 'pit-exterior-gas-curtain']) expect(names).toContain(n);
    const sky = group.getObjectByName('pit-sky') as THREE.Mesh;
    expect([sky.position.x, sky.position.y, sky.position.z]).toEqual([o.x, info.pit.roofY, o.z]);
    expect((sky.material as THREE.Material & {fog: boolean}).fog).toBe(false);
    // every dome point inside the far plane from anywhere in a real pit (the core floor ~50 m below / ~35 m beside the centre)
    const real = level(SEEDS[0]).reactor!.pit, rb = real.bounds;
    const worst = PIT_SKY.radius + Math.hypot((rb.x1 - rb.x0) / 2, (rb.z1 - rb.z0) / 2, real.roofY - real.floorY);
    expect(worst).toBeLessThan(REACTOR_FOG.far);
    // no roof column: nothing built
    const g = new THREE.Group();
    expect(buildPitSky(g, {...archFixtureInfo(), pit: {...archFixtureInfo().pit, roofY: 0.5}} as ReactorInfo, [0])).toBeNull();
    expect(g.children.length).toBe(0);
  });
});
