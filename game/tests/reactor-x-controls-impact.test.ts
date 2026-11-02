// Task reactor-expansion-20261101 (lane CONTROLS): bullet impacts take the ACTUAL hit material (user feedback: "particel effects when
// shooting walls do not match wall material"). The finish table, and on a REAL Reactor world (built in Node): shots from the decks
// into the pit walls / gratings / room walls go through Levels.raycast + DamageSystem.hitWorld exactly like Game.fire, and the effect
// class / fx style / sound follow the finish the builder drew there (pit concrete = concrete dust, bar grating / rusted plate = steel
// sparks) — where the station rule used to answer tile / terrazzo / plaster. Damage numbers are untouched (routing only). Other
// levels: a plain Subway station has no arch finish (null resolver: unchanged), the Office's keys map to their real materials.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {generateStation} from '../src/gen/station';
import type {StationLayout} from '../src/gen/stationTypes';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld, type BuiltWorld} from '../src/world/builder';
import {raycastWorld} from '../src/combat/hitscan';
import {DamageSystem} from '../src/damage/system';
import {DAMAGE_MATERIALS, STRUCTURAL_CLASS, structuralKeyAt, type DamageClass} from '../src/damage/materials';
import {FINISH_CLASS_KEYS, finishClass} from '../src/damage/impactFinish';
import {REACTOR_SURFACE_KEYS} from '../src/world/reactor/archMaterials';
import type {FloorKind, CeilingKind} from '../src/world/officeArch';

installCanvasShim(false);
const mats = () => new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});

describe('the finish -> damage class table', () => {
  it('every Reactor surface key has its material: concrete pit / steel grating / rusted steel plate', () => {
    const want: Record<string, DamageClass> = {
      'reactor-wall': 'concrete', 'reactor-roof': 'concrete', 'reactor-floor': 'concrete', 'reactor-ceil': 'concrete',
      'reactor-grating': 'steel', 'reactor-deck-under': 'steel', 'reactor-room-wall': 'steel', 'reactor-trim': 'steel',
    };
    for (const k of REACTOR_SURFACE_KEYS) expect(finishClass(k), k).toBe(want[k]);
    expect(FINISH_CLASS_KEYS.reactor.sort()).toEqual([...REACTOR_SURFACE_KEYS].sort());
    expect(DAMAGE_MATERIALS[finishClass('reactor-grating')!].fx).toBe('metal');
    expect(DAMAGE_MATERIALS[finishClass('reactor-wall')!].fx).toBe('concrete');
  });

  it('Office keys map to their real materials (drywall plaster, carpet fabric, tile, slab concrete …); unknown keys keep the station rule', () => {
    const floors: FloorKind[] = ['carpet', 'vinyl', 'tile', 'wet', 'stone', 'concrete', 'wood', 'server', 'core', 'roof'];
    for (const f of floors) expect(finishClass(`office-floor-${f}`), f).not.toBeNull();
    const ceils: CeilingKind[] = ['grid', 'plain', 'raw', 'core'];
    for (const c of ceils) expect(finishClass(`office-ceil-${c}`), c).not.toBeNull();
    expect(finishClass('office-carpet@4')).toBe('fabric');
    expect(finishClass('office-vinyl@2')).toBe('plastic');
    expect(finishClass('office-wall@3')).toBe('plaster');
    expect(finishClass('office-accent@3')).toBe('plaster');
    expect(finishClass('office-wet')).toBe('tile');
    expect(finishClass('office-core')).toBe('concrete');
    expect(finishClass('annexWall')).toBe('concrete');
    for (const k of ['mall-wall|3', 'tileLower', 'paint', 'concrete', '', 'whatever']) expect(finishClass(k), k).toBeNull();
    expect(finishClass(null)).toBeNull();
  });
});

describe('a real Reactor world: shots take the drawn finish', () => {
  let L: StationLayout, w: BuiltWorld;
  beforeAll(() => { L = LEVELS.reactor.generate('main', {levelSeed: 9100}); w = buildWorld(L, mats(), {}); }, 180_000);

  it('the world reports arch finishes for walls, floors and ceilings', () => {
    expect(w.finishAt).toBeTruthy();
  });

  it('shots from every tier deck into the pit walls, the gratings and the room walls: concrete / steel, matching fx + sound', () => {
    const lv = levelsOf(L), r = L.reactor!;
    const calls: {fx: string; sound: string}[] = [];
    const fx = {impact: (_p: THREE.Vector3, _n: THREE.Vector3, s: string) => { calls.push({fx: s, sound: ''}); }, sparks() {}, dust() {}} as never;
    const sfx = {impact: (_x: number, _y: number, _z: number, s: string) => { calls[calls.length - 1].sound = s; }, breakage() {}} as never;
    const dmg = new DamageSystem(fx, sfx);
    dmg.build(L, null, [], {finishAt: w.finishAt ?? null});
    const seen: Record<string, {n: number; was: Record<string, number>}> = {};
    const shoot = (o: {x: number; y: number; z: number}, d: {x: number; y: number; z: number}, expectKind?: string) => {
      const wh = raycastWorld(lv, L.props, o, d, 40, L.trench.floorY);
      if (wh.kind === 'none' || wh.kind === 'prop' || (expectKind && wh.kind !== expectKind)) return null;
      const p = new THREE.Vector3(o.x + d.x * wh.t, o.y + d.y * wh.t, o.z + d.z * wh.t), n = new THREE.Vector3(wh.nx, wh.ny, wh.nz);
      const key = w.finishAt!(wh.kind as 'wall', wh.level, p.x, p.y, p.z, wh.nx, wh.nz);
      const G = lv.grid(Math.max(0, wh.level));
      const old = STRUCTURAL_CLASS[structuralKeyAt(wh.kind, p.x, p.y, p.z, wh.nx, wh.nz, {grid: G, areas: L.areas, trenches: L.trenches})];
      const info = dmg.hitWorld(wh, p, new THREE.Vector3(d.x, d.y, d.z), {damage: 30, pellet: false, weapon: 'rifle'} as never);
      const c = calls[calls.length - 1];
      // the effect, the sound and the reported material are the finish's
      if (key && finishClass(key)) {
        expect(info.material, key).toBe(finishClass(key));
        expect(c.fx, key).toBe(DAMAGE_MATERIALS[finishClass(key)!].fx);
        expect(c.sound, key).toBe(DAMAGE_MATERIALS[finishClass(key)!].sound);
        const s = (seen[key] ??= {n: 0, was: {}});
        s.n++; s.was[old] = (s.was[old] ?? 0) + 1;
      }
      void n;
      return key;
    };
    for (const d of r.decks) {
      const y = d.y + 1.5, cx = (d.rect.x0 + d.rect.x1) / 2, cz = (d.rect.z0 + d.rect.z1) / 2;
      for (const dir of [{x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0}, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}]) shoot({x: cx, y, z: cz}, dir, 'wall');
      shoot({x: cx, y, z: cz}, {x: 0.05, y: -1, z: 0.03}, 'floor');
    }
    for (const s of r.sites) {
      const cx = (s.rect.x0 + s.rect.x1) / 2, cz = (s.rect.z0 + s.rect.z1) / 2, y = r.tiers.find(t => t.level === s.level)!.baseY + 1.5;
      for (const dir of [{x: 1, y: 0, z: 0}, {x: -1, y: 0, z: 0}, {x: 0, y: 0, z: 1}, {x: 0, y: 0, z: -1}]) shoot({x: cx, y, z: cz}, dir, 'wall');
      shoot({x: cx, y, z: cz}, {x: 0.02, y: -1, z: 0.01}, 'floor');
      shoot({x: cx, y, z: cz}, {x: 0.02, y: 1, z: 0.01}, 'ceiling');
    }
    // pit concrete walls, steel gratings and rusted-plate rooms were all struck, and the station rule had them wrong
    expect(seen['reactor-wall']?.n ?? 0, JSON.stringify(seen)).toBeGreaterThan(3);
    expect(seen['reactor-grating']?.n ?? 0, JSON.stringify(seen)).toBeGreaterThan(3);
    expect(seen['reactor-room-wall']?.n ?? 0, JSON.stringify(seen)).toBeGreaterThan(3);
    const wrongBefore = (k: string, cls: DamageClass) => Object.entries(seen[k]?.was ?? {}).filter(([c]) => c !== cls).reduce((a, [, n]) => a + n, 0);
    expect(wrongBefore('reactor-grating', 'steel')).toBeGreaterThan(0); // grating used to puff concrete / terrazzo dust
    expect(wrongBefore('reactor-room-wall', 'steel')).toBeGreaterThan(0); // rusted plate used to flake plaster / tile
  }, 120_000);
});

describe('other levels', () => {
  it('a plain Subway station has no arch finish: impacts keep the station rule exactly', () => {
    const L = generateStation(4242, {trackExtensions: 'none'});
    const w = buildWorld(L, mats(), {});
    expect(w.finishAt ?? null).toBeNull();
  }, 120_000);
});
