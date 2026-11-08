// Task studio-ui-subway-maps-20261108-074144-01 (user: "add map kiosks to the subway level, similar to the mall level"): the Subway's station
// map kiosks — the kind's registration in every shared table, the placement (by the arrival on platform 1, the ticket halls and concourses;
// wall-backed, clear of doors, stairs, the track edge, pickups, spawns, the arrival, signs and every other prop; reading strip open; at most
// 4, apart), non-destructive (generateStation untouched, appended last, deterministic, the layout still validates as before), the plan
// (public space only, no extensions / back-of-house / loot words), the face drawing (heads-up, YOU ARE HERE inside the plan), the
// renderer (bounded, released with the world, no model file) and the E close-up read. Node only (canvas shim).

import {describe, expect, it} from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {generateStation, validateLayout} from '../src/gen/station';
import type {StationLayout} from '../src/gen/stationTypes';
import {CELL, SOLID, VOID} from '../src/gen/grid';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {PROP_DAMAGE} from '../src/damage/materials';
import {PROP_PHYSICS_AUDIT, unclassifiedPhysicsKinds} from '../src/damage/physicsAudit';
import {OPENABLE_AUDIT} from '../src/world/openablesSpec';
import {cellsOfBox, propBlocksDoorway} from '../src/gen/placeKit';
import {SUBWAY_MAP_KIOSK, isSubwayMapKioskKind} from '../src/gen/subwayMapKioskKind';
import {SUBWAY_MAP_KIOSKS, placeSubwayMapKiosks} from '../src/gen/subwayMapKiosks';
import {KIOSK_FACE, KIOSK_FACE_DRAW, PLAN_CELL, SUBWAY_MAP_FORBIDDEN, drawKioskFace, hereOf, readerFrame, subwayMapPlan} from '../src/world/subwayMapPlan';
import {SUBWAY_MAP_KIOSK_BUILD} from '../src/world/subwayMapKiosks';
import {SubwayMapRead} from '../src/world/subwayMapRead';
import {MAP_READ} from '../src/world/skywaysMapRead';
import {WorldMaterials} from '../src/world/materials';
import {buildWorld} from '../src/world/builder';
import {fakeEnvTextures} from './helpers/openablesFixture';
import {installCanvasShim} from './helpers/canvas2d';

installCanvasShim(false);

const SEEDS = [1, 2, 3, 7, 11, 42, 99, 424242, 1337, 2026, 31337, 777];
const cache = new Map<number, StationLayout>();
const gen = (seed: number) => { let L = cache.get(seed); if (!L) cache.set(seed, (L = LEVELS.subway.generate('main', {levelSeed: seed, gear: []} as never))); return L; };
const kiosksOf = (L: StationLayout) => L.props.filter(p => p.kind === 'subwayMapKiosk');
const src = (rel: string) => fs.readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');

describe('the kind: every shared table, classified honestly', () => {
  it('a sealed, anchored, sheet-metal map sign the size of the mall directory; no model file', () => {
    expect(isSubwayMapKioskKind('subwayMapKiosk')).toBe(true);
    expect(PROP_DEFS.subwayMapKiosk).toMatchObject({w: 0.9, d: 0.3, h: 2.1, blocksSight: false});
    expect(PROP_DAMAGE.subwayMapKiosk).toMatchObject({cls: 'sheetMetal', breaks: 'never'});
    expect(PROP_PHYSICS_AUDIT.subwayMapKiosk).toMatchObject({cls: 'static', why: 'anchored', src: 'subway'});
    expect(OPENABLE_AUDIT.find(r => r.kind === 'subwayMapKiosk')).toMatchObject({cls: 'none', role: 'equipment'});
    expect(unclassifiedPhysicsKinds()).toEqual([]);
    // procedural (no model, so no asset to load: tests/level-assets.test.ts keeps "Subway layouts select zero level-only files")
    const L = gen(1);
    expect(kiosksOf(L).length).toBeGreaterThan(0);
    expect(src('world/subwayMapKiosks.ts')).not.toMatch(/\.glb|loadModel|models\[/);
    // the printed panel sits at reading height on the cabinet
    expect(SUBWAY_MAP_KIOSK.faceY0).toBeGreaterThan(0.7);
    expect(SUBWAY_MAP_KIOSK.faceY0 + SUBWAY_MAP_KIOSK.faceH).toBeLessThan(SUBWAY_MAP_KIOSK.top - 0.1);
  });
});

describe('placement: where people need a map, never in the way', () => {
  it('2-4 kiosks per station; platform 1 by the arrival in most stations; ticket halls / concourses; at most one per area; apart', () => {
    let onPlatform1 = 0;
    for (const seed of SEEDS) {
      const L = gen(seed), ks = kiosksOf(L);
      expect(ks.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      expect(ks.length).toBeLessThanOrEqual(SUBWAY_MAP_KIOSKS.max);
      expect(new Set(ks.map(k => k.area)).size).toBe(ks.length);
      for (const k of ks) {
        const a = L.areas[k.area];
        expect(a.publicSpace && !a.ext, `seed ${seed} ${a.label}`).toBe(true);
        expect(['platform', 'concourse']).toContain(a.kind);
        for (const o of ks) if (o !== k) expect(Math.hypot(o.x - k.x, o.z - k.z)).toBeGreaterThanOrEqual(SUBWAY_MAP_KIOSKS.apart - 1e-6);
      }
      const p1 = ks.find(k => k.area === L.platform);
      if (p1) { onPlatform1++; expect(Math.hypot(p1.x - L.playerSpawn.x, p1.z - L.playerSpawn.z), `seed ${seed}`).toBeLessThan(30); } // the nearest legal wall spot on a long platform
      expect(ks.some(k => L.areas[k.area].type === 'fare-hall' || L.areas[k.area].kind === 'concourse'), `seed ${seed}`).toBe(true);
    }
    expect(onPlatform1).toBeGreaterThanOrEqual(Math.ceil(SEEDS.length * 0.75));
  });

  it('wall-backed, the reading strip open, clear of doors, stairs, the track edge, pickups, spawns, the arrival, signs and every other prop', () => {
    for (const seed of SEEDS) {
      const L = gen(seed);
      for (const k of kiosksOf(L)) {
        const lv = k.level ?? 0, g = L.levels[lv]?.grid ?? L.grid, tag = `seed ${seed} kiosk @${k.x.toFixed(1)},${k.z.toFixed(1)}`;
        const fx = Math.round(Math.sin(k.rot)), fz = Math.round(Math.cos(k.rot));
        // the back: solid wall across the cabinet's width, one cell behind
        const bx = k.x - fx * (SUBWAY_MAP_KIOSK.d / 2 + CELL * 0.6), bz = k.z - fz * (SUBWAY_MAP_KIOSK.d / 2 + CELL * 0.6);
        const [b0, b1, b2, b3] = cellsOfBox(bx, bz, fx ? 0.01 : SUBWAY_MAP_KIOSK.w / 2 - 0.05, fz ? 0.01 : SUBWAY_MAP_KIOSK.w / 2 - 0.05);
        for (let y = b1; y <= b3; y++) for (let x = b0; x <= b2; x++) expect(g.get(x, y), `${tag} back`).toBe(SOLID);
        // the reading strip: walkable
        const sx = k.x + fx * (SUBWAY_MAP_KIOSK.d / 2 + SUBWAY_MAP_KIOSKS.front / 2), sz = k.z + fz * (SUBWAY_MAP_KIOSK.d / 2 + SUBWAY_MAP_KIOSKS.front / 2);
        const [s0, s1, s2, s3] = cellsOfBox(sx, sz, fx ? SUBWAY_MAP_KIOSKS.front / 2 : 0.3, fz ? SUBWAY_MAP_KIOSKS.front / 2 : 0.3);
        const [k0, k1, k2, k3] = cellsOfBox(k.x, k.z, k.hx, k.hz); // (the kiosk's own cells are blocked by it)
        for (let y = s1; y <= s3; y++) for (let x = s0; x <= s2; x++) if (x < k0 || x > k2 || y < k1 || y > k3) expect(g.walkable(x, y), `${tag} strip`).toBe(true);
        // standing on its floor (absolute), not sunk or floating
        const [cx, cy] = g.cellOf(k.x, k.z);
        expect(k.y, `${tag} floor`).toBeCloseTo(g.floorOf(g.idx(cx, cy)), 6);
        // doors / stairs / track edge
        expect(propBlocksDoorway(L, k.x, k.z, k.hx, k.hz, k.y, SUBWAY_MAP_KIOSK.top), tag).toBeNull();
        const [c0, c1, c2, c3] = cellsOfBox(k.x, k.z, k.hx + CELL, k.hz + CELL);
        for (let y = c1; y <= c3; y++) for (let x = c0; x <= c2; x++) if (g.inBounds(x, y)) expect(g.rampIdx[g.idx(x, y)], `${tag} stairs`).toBe(-1);
        const [t0, t1, t2, t3] = cellsOfBox(k.x, k.z, k.hx + SUBWAY_MAP_KIOSKS.trackClear - 0.05, k.hz + SUBWAY_MAP_KIOSKS.trackClear - 0.05);
        for (let y = t1; y <= t3; y++) for (let x = t0; x <= t2; x++) if (g.inBounds(x, y)) expect(g.get(x, y) === VOID, `${tag} track`).toBe(false);
        // things: pickups, spawns, the arrival, signs, other props (incl. mounted ones)
        const near = (x: number, z: number, r: number) => Math.max(Math.abs(x - k.x) - k.hx, Math.abs(z - k.z) - k.hz) < r - 0.05;
        for (const p of L.pickups) if ((p.level ?? 0) === lv) expect(near(p.x, p.z, SUBWAY_MAP_KIOSKS.pickupClear - CELL), `${tag} pickup ${p.itemId}`).toBe(false);
        for (const z of L.zombies) if ((z.level ?? 0) === lv) expect(near(z.x, z.z, SUBWAY_MAP_KIOSKS.spawnClear - CELL), `${tag} spawn`).toBe(false);
        if (lv === 0) expect(Math.hypot(L.playerSpawn.x - k.x, L.playerSpawn.z - k.z), `${tag} arrival`).toBeGreaterThan(SUBWAY_MAP_KIOSKS.arrivalClear - CELL);
        for (const o of L.props) {
          if (o === k || (o.level ?? 0) !== lv || o.y >= SUBWAY_MAP_KIOSK.top + 0.2) continue;
          const ox = Math.abs(o.x - k.x) < o.hx + k.hx - 0.01, oz = Math.abs(o.z - k.z) < o.hz + k.hz - 0.01;
          expect(ox && oz, `${tag} overlaps ${o.kind}`).toBe(false);
        }
      }
    }
  });

  it('non-destructive: generateStation is untouched; kiosks are APPENDED (every older index unchanged); deterministic; RNG-neutral; the layout validates as before', () => {
    for (const seed of [1, 42, 424242, 31337]) {
      const base = generateStation(seed), L = gen(seed), n = base.props.length;
      expect(L.props.length).toBe(n + kiosksOf(L).length);
      expect(JSON.stringify(L.props.slice(0, n))).toBe(JSON.stringify(base.props));
      expect(L.props.slice(n).every(p => p.kind === 'subwayMapKiosk')).toBe(true);
      expect(JSON.stringify([L.pickups, L.zombies, L.playerSpawn, L.signs])).toBe(JSON.stringify([base.pickups, base.zombies, base.playerSpawn, base.signs]));
      const again = LEVELS.subway.generate('main', {levelSeed: seed, gear: []} as never);
      expect(JSON.stringify(kiosksOf(again))).toBe(JSON.stringify(kiosksOf(L)));
      expect(validateLayout(L)).toEqual(validateLayout(base));
    }
    // the pass draws from no station stream: it only builds its own placement ctx
    expect(src('gen/subwayMapKiosks.ts')).not.toMatch(/\.fork\(|rng\.(next|range|int|chance|pick)\(/);
    // placing twice on a fresh copy does nothing more than once (no runaway on re-entry)
    const L = generateStation(7);
    const first = placeSubwayMapKiosks(L).length, more = placeSubwayMapKiosks(L).length;
    expect(first).toBeGreaterThan(0);
    expect(more).toBe(0); // every spot is now taken / too close
  });

  it('bounded cost: the pass is a small fraction of generating the station', () => {
    const L = generateStation(424242);
    const t0 = performance.now();
    placeSubwayMapKiosks(L);
    expect(performance.now() - t0).toBeLessThan(120);
  });
});

describe('the plan: the public station only', () => {
  it('prints public, non-extension space only (never the service level or back-of-house); no loot / play words; labels and stairs as text', () => {
    for (const seed of SEEDS) {
      const L = gen(seed), plan = subwayMapPlan(L);
      expect(plan.storeys.length).toBeGreaterThanOrEqual(1);
      for (const st of plan.storeys) {
        const g = L.levels[st.level]?.grid ?? L.grid;
        for (let i = 0; i < st.cells.length; i++) {
          const c = st.cells[i];
          if (!c || c === PLAN_CELL.track) continue;
          const a = L.areas[g.area[i]];
          expect(a.publicSpace && !a.ext && a.kind !== 'service', `seed ${seed} L${st.level} ${a.label}`).toBe(true);
        }
        for (const l of st.labels) {
          expect(l.text, `seed ${seed}`).not.toMatch(SUBWAY_MAP_FORBIDDEN);
          expect(L.areas[l.area].publicSpace).toBe(true);
        }
        for (const s of st.stairs) expect(s.text).toMatch(/^(Up|Down) to the /);
      }
    }
    // it reads the layout's structure only: no props, pickups, spawns or play state
    expect(src('world/subwayMapPlan.ts')).not.toMatch(/layout\.(pickups|zombies|props|hordes)|run\.memory|lootFor|holderState/);
  });

  it('the face: heads-up (what is ahead of the reader is up), the plan fitted, YOU ARE HERE inside the plan, labels, the legend', () => {
    const L = gen(1), plan = subwayMapPlan(L);
    for (const k of kiosksOf(L)) {
      // ahead of the reader = into the kiosk's wall
      const ahead = readerFrame(k, k.x - Math.sin(k.rot), k.z - Math.cos(k.rot));
      expect(ahead.v).toBeCloseTo(1, 9);
      expect(ahead.u).toBeCloseTo(0, 9);
      const h = hereOf(k);
      expect(Math.hypot(h.x - k.x, h.z - k.z)).toBeCloseTo(0.6, 9);
      const c = document.createElement('canvas');
      c.width = KIOSK_FACE.w; c.height = KIOSK_FACE.h;
      drawKioskFace(c.getContext('2d')!, plan, k);
      expect(KIOSK_FACE_DRAW.cells).toBeGreaterThan(100);
      expect(KIOSK_FACE_DRAW.labels).toBeGreaterThanOrEqual(1);
      const here = KIOSK_FACE_DRAW.here;
      expect(here.x).toBeGreaterThan(KIOSK_FACE.pad - 1); expect(here.x).toBeLessThan(KIOSK_FACE.w - KIOSK_FACE.pad + 1);
      expect(here.y).toBeGreaterThan(KIOSK_FACE.header); expect(here.y).toBeLessThan(KIOSK_FACE.h - KIOSK_FACE.legend);
    }
    expect(KIOSK_FACE.h / KIOSK_FACE.w).toBeCloseTo(SUBWAY_MAP_KIOSK.faceH / SUBWAY_MAP_KIOSK.faceW, 2);
  });
});

describe('the renderer and the read', () => {
  it('bounded: per storey 2 body meshes + 1 face mesh, ONE atlas texture; every instance on its storey; released with the world', () => {
    const L = gen(1), ks = kiosksOf(L), mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
    const w = buildWorld(L, mats, {});
    const storeys = new Set(ks.map(k => k.level ?? 0));
    expect(SUBWAY_MAP_KIOSK_BUILD).toMatchObject({kiosks: ks.length, storeys: storeys.size, textures: 1, meshes: storeys.size * 3});
    const found: THREE.Mesh[] = [];
    w.group.traverse(o => { if (o.name.startsWith('prop-subwayMapKiosk-')) found.push(o as THREE.Mesh); });
    expect(found).toHaveLength(storeys.size * 3);
    for (const lv of storeys) {
      const n = ks.filter(k => (k.level ?? 0) === lv).length;
      for (const part of ['steelDark', 'steelBright']) expect((found.find(m => m.name === `prop-subwayMapKiosk-${part}` && m.userData.level === lv) as THREE.InstancedMesh).count).toBe(n);
      const face = found.find(m => m.name === `prop-subwayMapKiosk-face-L${lv}`)!;
      expect(face.geometry.attributes.position.count).toBe(4 * n);
    }
    const face = found.find(m => m.name.startsWith('prop-subwayMapKiosk-face'))!;
    const tex = (face.material as THREE.Material & {map?: THREE.Texture}).map!;
    expect(tex).toBeTruthy();
    let disposed = 0;
    tex.addEventListener('dispose', () => disposed++);
    for (const m of found) if (m instanceof THREE.InstancedMesh) m.dispose();
    expect(disposed).toBe(1);
  });

  it('E at a kiosk\'s face reads it; E again, walking off, turning away or leaving play closes it; inert without kiosks', () => {
    const L = gen(1), k = kiosksOf(L)[0];
    const host = {player: {x: 0, y: 0, z: 0, yaw: 0}, layout: L, state: 'playing', interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[],
      sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], promptProviders: [] as (() => string | null)[]};
    const rt = new SubwayMapRead(host).install();
    host.sectionHooks[0].build!(L);
    expect(rt.kiosks.length).toBe(kiosksOf(L).length);
    const fx = Math.sin(k.rot), fz = Math.cos(k.rot);
    const stand = (d: number, turn = 0) => { Object.assign(host.player, {x: k.x + fx * d, z: k.z + fz * d, y: k.y, yaw: k.rot + turn}); host.frameHooks[0](0.016); };
    stand(1.0);
    expect(rt.target).toBe(k);
    expect(host.promptProviders[0]()).toMatch(/Read the station map/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.open).toBe(k);
    expect(rt.counts.opens).toBe(1);
    expect(host.promptProviders[0]()).toMatch(/Close the station map/);
    expect(host.interactHandlers[0]()).toBe(true);
    expect(rt.open).toBeNull();
    host.interactHandlers[0]();
    stand(MAP_READ.reach + 0.5);
    expect(rt.open).toBeNull();
    expect(host.interactHandlers[0]()).toBe(false);
    stand(1.0, Math.PI);
    expect(rt.target).toBeNull();
    stand(1.0);
    host.interactHandlers[0]();
    host.state = 'paused';
    host.frameHooks[0](0.016);
    expect(rt.open).toBeNull();
    host.state = 'playing';
    host.sectionHooks[0].teardown!();
    host.sectionHooks[0].build!({...L, props: L.props.filter((p: PropPlacement) => p.kind !== 'subwayMapKiosk')} as StationLayout);
    stand(1.0);
    expect(host.promptProviders[0]()).toBeNull();
    // the game installs it (one line, inert without kiosks)
    expect(src('game.ts')).toMatch(/installSubwayMapRead\(this\);/);
  });
});
