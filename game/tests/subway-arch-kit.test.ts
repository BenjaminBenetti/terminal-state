// Task studio-subway-architecture-materials-rework-20261117-072826-01: THE SUBWAY ARCHITECTURAL KIT and the zoned wall finishes.
//  - the finish schemes (world/subwayFinish.ts): every theme maps every zone to a generated set, the keys carry their class;
//  - the zone split (world/subwayArch.ts remapFaces): public walls cut at the plinth / dado / band heights over their own floor, openings kept
//    in every piece, the pieces merge back into one treatment face (world/wallDetailFaces.ts);
//  - the ceiling forms (gen/subwayCeilings.ts): a vault springs above every dresser pendant, never below the form's clear height;
//  - the kit (world/subwayKit.ts): deterministic, inside its areas, clear of doorways and of the dresser's fixtures, nothing on a version-1
//    station; the styled hall lights' tube matrices / glow.

import * as THREE from 'three';
import {describe, expect, it} from 'vitest';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {PENDANT_Y, type LightPlacement, type StationLayout} from '../src/gen/stationTypes';
import {STATION_THEMES} from '../src/gen/stationPlans';
import {FORM_MIN_CLEAR, VAULT_GAP, areaFloor, ceilingFormOf, soffitAt} from '../src/gen/subwayCeilings';
import {CELL} from '../src/gen/grid';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {normalizeFaces} from '../src/world/wallDetailFaces';
import {ARCH_CLASS, ZONES, finishSchemeOf, keyClass, schemeTextures} from '../src/world/subwayFinish';
import {SUBWAY_ARCH_TEXTURES} from '../src/assets/subwayArchTextures.generated';
import {KIT_BEAM_CLEAR, LANTERN, coveLengths, hallKit, styledTubeMatrix} from '../src/world/subwayKit';

installCanvasShim(false);

const SEEDS = {classic: 1, brutalistHall: 3, civicHall: 4, cavern: 2, hub: 16} as const;
const cache = new Map<number, StationLayout>();
const gen = (seed: number, version = 2): StationLayout => {
  const k = seed * 10 + version;
  let L = cache.get(k);
  if (!L) cache.set(k, (L = LEVELS.subway.generate('main', {levelSeed: seed, layoutVersion: version})));
  return L;
};
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const meshes = (w: BuiltWorld): THREE.Mesh[] => { const out: THREE.Mesh[] = []; w.group.traverse(o => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };

describe('the finish schemes', () => {
  it('every theme maps every zone to a generated set; keys carry their class', () => {
    for (const [theme, t] of Object.entries(STATION_THEMES)) {
      const s = finishSchemeOf({identity: {theme, ...t, plate: {...t.plate}}})!;
      expect(s, theme).toBeTruthy();
      for (const k of schemeTextures(s)) expect(SUBWAY_ARCH_TEXTURES[k], `${theme} ${k}`).toBeTruthy();
      // a dark dado / plinth under a lighter field: the plinth is the granite base everywhere
      expect(s.plinth.tex).toBe('plinthGranite');
      if (t.walls === 'rock') expect(s.rock, theme).toBeTruthy(); else expect(s.band, theme).toBeTruthy();
    }
    expect(finishSchemeOf({})).toBeNull();
    for (const [tex, cls] of Object.entries(ARCH_CLASS)) expect(keyClass(`subway-${cls}-field`), tex).toBe(cls);
    expect(keyClass('tileUpper')).toBeNull();
  });
});

describe('the zoned walls', () => {
  it('public walls split at the zone heights over their floor; openings kept; the pieces merge back into one treatment face', () => {
    const L = gen(SEEDS.civicHall);
    const w = buildWorld(L, mats(), {});
    const sub = w.wallFaces.filter(f => /^subway-/.test(f.finish));
    expect(sub.length).toBeGreaterThan(200);
    for (const f of sub) {
      if (f.slope || /rock|concrete-dado/.test(f.finish)) continue;
      const floor = (f as unknown as {vb0: number}).vb0;
      // every piece lies inside one zone: no zone height strictly inside it (the band only on walls tall enough for one)
      const heights = [ZONES.plinth, ZONES.dado, ...(/-(band|upper)/.test(f.finish) ? [ZONES.band0, ZONES.band1] : [])];
      for (const h of heights) expect(f.y0 < floor + h - 1e-3 && f.y1 > floor + h + 1e-3, `${f.finish} ${f.y0}-${f.y1} over ${floor}`).toBe(false);
    }
    expect(sub.some(f => /-band/.test(f.finish))).toBe(true);
    // the plinth pieces sit on the floor
    const plinths = sub.filter(f => f.finish === 'subway-stone-plinth' && !f.slope);
    expect(plinths.length).toBeGreaterThan(50);
    for (const f of plinths) expect(f.y1 - (f as unknown as {vb0: number}).vb0).toBeLessThanOrEqual(ZONES.plinth + 1e-6);
    // one treatment face per wall again (the wall detail plans as many faces as before the split, give or take the track bed)
    const merged = normalizeFaces(w.wallFaces);
    const pieces = normalizeFaces(sub);
    expect(pieces.length).toBeLessThan(sub.length / 2);
    expect(merged.length).toBeGreaterThan(0);
  }, 240_000);
});

describe('the ceiling forms', () => {
  it('vaults spring above every dresser pendant; every form keeps its clear height', () => {
    for (const seed of Object.values(SEEDS)) {
      const L = gen(seed);
      for (const a of L.areas) {
        const f = ceilingFormOf(L, a);
        if (f.kind === 'flat') continue;
        const floor = areaFloor(a);
        if (f.kind === 'vault' || f.kind === 'rock') expect(f.spring - floor, `${seed} ${a.role}`).toBeGreaterThanOrEqual(PENDANT_Y + 0.4 - 1e-6);
        expect(f.ceil - f.beam - floor, `${seed} ${a.role}`).toBeGreaterThanOrEqual(FORM_MIN_CLEAR - 1e-6);
        // the soffit is never above the ceiling nor below the clear height
        const b = f.bays;
        for (let k = 0; k <= 8; k++) {
          const along = b.a0 + ((b.a1 - b.a0) * k) / 8, across = (b.c0 + b.c1) / 2;
          const y = soffitAt(f, b.alongX ? along : across, b.alongX ? across : along);
          expect(y).toBeLessThanOrEqual(f.ceil + 1e-6);
          expect(y - floor).toBeGreaterThanOrEqual(FORM_MIN_CLEAR - 1e-6);
        }
      }
    }
    expect(VAULT_GAP).toBeGreaterThan(0);
  });
});

describe('the kit', () => {
  it('draws relief on every family; deterministic; nothing on a version-1 station', () => {
    const stats: Record<string, unknown> = {};
    for (const [name, seed] of Object.entries(SEEDS)) {
      const w = buildWorld(gen(seed), mats(), {});
      const k = w.subwayArch!.kit!;
      expect(k, name).toBeTruthy();
      expect(k.boxes, name).toBeGreaterThan(200);
      stats[name] = k;
      if (name !== 'cavern') expect(k.pilasters + k.beams, name).toBeGreaterThan(20);
    }
    const again = buildWorld(gen(SEEDS.hub), mats(), {});
    expect(again.subwayArch!.kit).toEqual(stats.hub);
    const v1 = buildWorld(gen(SEEDS.hub, 1), mats(), {});
    expect(v1.subwayArch).toBeUndefined();
    expect(meshes(v1).some(m => /^(arch|trim)-subway-(tile|stone|concrete|plaster|metal|terrazzo|rock)-/.test(m.name))).toBe(false);
  }, 600_000);

  it('kit geometry stays inside the station: above its floors, under its ceilings, out of doorways', () => {
    const L = gen(SEEDS.civicHall);
    const w = buildWorld(L, mats(), {});
    const g = L.grid;
    const kit = meshes(w).filter(m => /^trim-subway-/.test(m.name));
    expect(kit.length).toBeGreaterThan(0);
    let checked = 0;
    for (const m of kit) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      // sample vertices: every one inside the grid and under the highest ceiling
      for (let i = 0; i < pos.count; i += 7) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        expect(x).toBeGreaterThan(-0.5); expect(z).toBeGreaterThan(-0.5);
        expect(x).toBeLessThan(g.w * CELL + 0.5); expect(z).toBeLessThan(g.h * CELL + 0.5);
        expect(y).toBeLessThan(Math.max(...L.areas.map(a => a.ceil)) + 0.6);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    // pilasters / caps never stand in a door opening (below its head)
    const doors = L.doors.map(d => ({x0: d.x * CELL, z0: d.y * CELL, x1: (d.x + d.w) * CELL, z1: (d.y + d.h) * CELL, top: d.height}));
    for (const m of kit) {
      const pos = m.geometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i += 3) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        if (y > 2.0 || y < 0.05) continue;
        const inside = doors.find(d => x > d.x0 + 0.12 && x < d.x1 - 0.12 && z > d.z0 + 0.12 && z < d.z1 - 0.12);
        expect(inside, `${m.name} vertex in a doorway at ${x.toFixed(2)},${y.toFixed(2)},${z.toFixed(2)}`).toBeUndefined();
      }
    }
  }, 240_000);

  it("beams keep clear of the dresser's fixtures; low halls with flush fixtures keep plain beams", () => {
    let lines = 0;
    for (const seed of Object.values(SEEDS)) {
      const L = gen(seed);
      for (const a of L.areas) {
        const k = hallKit(L, a);
        if (!k) continue;
        const plain = L.lights.filter(l => l.area === a.id && !l.virtual && !l.style);
        if (plain.some(l => l.y > k.form.ceil - 0.6)) expect(['beams', 'vault', 'rock'], `${seed} ${a.role}`).toContain(k.form.kind);
        for (const line of k.lines) for (const l of plain) {
          expect(Math.abs((k.form.bays.alongX ? l.x : l.z) - line), `seed ${seed} ${a.role} line ${line}`).toBeGreaterThan(k.form.beamW / 2 + KIT_BEAM_CLEAR - 1e-6);
          lines++;
        }
      }
    }
    expect(lines).toBeGreaterThan(100);
  });
});

describe('styled hall lights', () => {
  const light = (style: LightPlacement['style'], x: number, rot = 0): LightPlacement =>
    ({x, y: 5, z: 3, rot, area: 0, broken: false, flicker: false, warm: false, dying: false, power: 1, style} as LightPlacement);
  const fixture = {w: 1.2, h: 0.19, d: 0.17};
  it('tube matrices: lantern glass, a recessed lens, a cove strip spanning to its neighbour', () => {
    expect(styledTubeMatrix(light(undefined, 0), fixture)).toBeNull();
    const geo = new THREE.BoxGeometry(fixture.w * 0.82, 0.025, fixture.d * 0.42);
    geo.translate(0, -fixture.h - 0.004, 0);
    const sizeOf = (m: THREE.Matrix4) => { const g = geo.clone().applyMatrix4(m); g.computeBoundingBox(); return g.boundingBox!; };
    const drum = sizeOf(styledTubeMatrix(light('drum', 0), fixture)!);
    expect(drum.max.x - drum.min.x).toBeCloseTo(LANTERN.glass, 3);
    expect(drum.min.y).toBeGreaterThan(5);
    expect(drum.max.y).toBeLessThan(5 + LANTERN.h);
    const lens = sizeOf(styledTubeMatrix(light('downlight', 0), fixture)!);
    expect(lens.max.x - lens.min.x).toBeCloseTo(0.36, 3);
    const lights = [light('cove', 0), light('cove', 4), light('cove', 8)];
    const len = coveLengths(lights);
    expect([...len.values()]).toEqual([4, 4, 4]);
    const strip = sizeOf(styledTubeMatrix(lights[1], fixture, len.get(1))!);
    expect(strip.max.x - strip.min.x).toBeCloseTo(4, 3);
  });

  it('a cove has no glow card and no tube fixture model; a lantern none either', () => {
    const L0 = gen(SEEDS.civicHall), L = {...L0, lights: [...L0.lights]};
    const hall = L.areas.find(a => a.role === 'grand-ticket-hall')!;
    const cx = (hall.x + hall.w / 2) * CELL, cz = (hall.y + hall.h / 2) * CELL;
    L.lights.push({...light('cove', cx), z: cz, area: hall.id, y: hall.ceil - 0.6}, {...light('drum', cx + 3), z: cz, area: hall.id, y: hall.ceil - 2});
    const w = buildWorld(L, mats(), {});
    const n = L.lights.length;
    expect(w.fixtures[n - 2].noGlow).toBe(true);
    expect(w.fixtures[n - 1].noGlow).toBeUndefined();
    expect(w.subwayArch!.kit!.lanterns).toBeGreaterThanOrEqual(1);
    expect(w.subwayArch!.kit!.coves).toBeGreaterThanOrEqual(1);
  }, 240_000);
});
