// Task reactor-expansion-20261101 (lane CONTROLS): THE FLOOR-MAP BOARDS on REAL generated Reactor layouts (user feedback: "on the boards
// that detail what you need there should also be another board near by showing a floor map, with indicators (x marks the spot) on
// where the items are ... select the level to look at via small interaction buttons on the map, similar to elevator buttons ... I could
// not find the final key to start the reactor"):
//  - a physical board beside each objective instruction board, on a solid wall, walkable in front, clear of doors / signs / controls;
//  - the X marks are the ACTUAL generated positions (the key / fuse pickups, the mounted controls, the generators — in their side
//    complexes when the host carved them) on their ACTUAL storeys, every one on a walkable cell of its storey's plan;
//  - the marks follow the state (carried -> use it here, installed / started -> done) and the live pickups (a dropped key moves);
//  - the elevator-style storey buttons: pickable from in front of the board, E selects the storey, the selected one lit, redraws only on
//    change.
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS} from '../src/levels/registry';
import {FLOOR} from '../src/gen/grid';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout} from '../src/gen/stationTypes';
import {emptyReactorState, REACTOR_LANE, type ReactorRunState} from '../src/world/reactor/runState';
import {reactorMounts} from '../src/world/reactor/controlsMount';
import {screenFacing} from '../src/world/reactor/restartViews';
import {MAP_BOARD, MAP_SCREENS, PLAN, mapButtons, mapMarkers, planMapBoards, planStoreys, type MarkerSource} from '../src/world/reactor/mapBoardPlan';
import {ReactorMapBoards, MAP_REACH} from '../src/world/reactor/mapBoard';
import {lampSkin} from '../src/world/reactor/controlsSkin';
import {installCanvasShim} from './helpers/canvas2d';
import {fakeHost} from './helpers/reactorRestartFixture';

const SEEDS = [9100, 218558, 637474];
const layouts = new Map<number, StationLayout>();
const level = (seed: number) => { let L = layouts.get(seed); if (!L) layouts.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };

function source(L: StationLayout, state: ReactorRunState, carried: Record<string, number> = {}, pickups = L.pickups as readonly {itemId: string; x: number; y: number; z: number}[]): MarkerSource {
  const lv = levelsOf(L);
  return {info: L.reactor!, state, carried: id => carried[id] ?? 0, pickups: id => pickups.filter(p => p.itemId === id), levelAt: (x, z, y) => lv.levelAt(x, z, y + 0.1)};
}
const openAtOf = (L: StationLayout) => (x: number, z: number, lvl: number) => { const g = L.levels[lvl].grid, [cx, cy] = g.cellOf(x, z); return g.inBounds(cx, cy) && g.passable(cx, cy); };

for (const seed of SEEDS) {
  describe(`seed ${seed}`, () => {
    let L: StationLayout;
    beforeAll(() => { L = level(seed); }, 120_000);

    it('a physical board beside every objective instruction board: solid wall behind, open floor in front, clear of signs / controls', () => {
      const r = L.reactor!, boards = planMapBoards(L, r, sc => screenFacing(sc, openAtOf(L)));
      expect(boards.map(b => b.screen).sort()).toEqual([...MAP_SCREENS].sort());
      for (const b of boards) {
        const sc = r.screens.find(s => s.id === b.screen)!, g = L.levels[b.level].grid;
        expect(b.level).toBe(sc.level);
        expect(Math.hypot(b.x - sc.x, b.z - sc.z), `${b.screen} near its board`).toBeLessThan(9);
        // span: wall behind, floor in front (no door, no machine)
        for (let s = -MAP_BOARD.w / 2; s <= MAP_BOARD.w / 2; s += 0.25) {
          const px = b.x + b.rx * s, pz = b.z + b.rz * s;
          const [bx, by] = g.cellOf(px - b.nx * 0.3, pz - b.nz * 0.3), [fx, fy] = g.cellOf(px + b.nx * 0.35, pz + b.nz * 0.35);
          expect(g.cells[g.idx(bx, by)], `${b.screen}: wall behind`).not.toBe(FLOOR);
          expect(g.cells[g.idx(fx, fy)], `${b.screen}: floor in front`).toBe(FLOOR);
        }
        // no prop reaches into the board (a low cabinet under it is fine)
        const bottom = b.y - MAP_BOARD.h / 2;
        for (const p of L.props.filter(q => (q.level ?? 0) === b.level)) {
          const dAlong = Math.abs((p.x - b.x) * b.rx + (p.z - b.z) * b.rz), ext = Math.abs(p.hx * b.rx) + Math.abs(p.hz * b.rz);
          const dOut = (p.x - b.x) * b.nx + (p.z - b.z) * b.nz, extOut = Math.abs(p.hx * b.nx) + Math.abs(p.hz * b.nz);
          if (dAlong < MAP_BOARD.w / 2 + ext && dOut - extOut < 0.5 && dOut + extOut > -0.1) expect(p.y + (p.lift ?? 0) + p.h, `${b.screen}: ${p.kind} under the board`).toBeLessThan(bottom);
        }
        // never overlapping a sign (its own instruction board included)
        for (const s of r.screens.filter(q => q.level === b.level)) {
          const d = Math.abs((s.x - b.x) * b.rx + (s.z - b.z) * b.rz), off = Math.abs((s.x - b.x) * b.nx + (s.z - b.z) * b.nz);
          if (off < 0.3) expect(d, `${b.screen} vs ${s.id}`).toBeGreaterThan(MAP_BOARD.w / 2 + s.w / 2 + 0.1);
        }
        // the storey buttons: one per storey, reachable from in front of the board (eye 1.6 m, 0.8 m out)
        const btn = mapButtons(b, r.tiers.map(t => t.level));
        expect(btn.length).toBe(r.tiers.length);
        const floorY = r.tiers.find(t => t.level === b.level)!.baseY;
        for (const q of btn) expect(Math.hypot(q.x - (b.x + b.nx * 0.8), q.y - (floorY + 1.6), q.z - (b.z + b.nz * 0.8))).toBeLessThan(MAP_REACH - 0.3);
      }
    });

    it('X marks the spot: markers at the ACTUAL key / fuse / control / generator positions, on their storeys, on walkable plan cells', () => {
      const r = L.reactor!, state = emptyReactorState(r.generators.length, r.zones.length);
      const ms = mapMarkers(source(L, state)), plan = planStoreys(L, r), mounts = reactorMounts(r);
      // the startup key — where it was generated, on its storey
      const key = r.components.find(c => c.item === 'reactor_key')!, kp = L.pickups[key.pickup];
      const km = ms.filter(m => m.kind === 'key');
      expect(km.length).toBe(1);
      expect([km[0].x, km[0].z, km[0].level]).toEqual([kp.x, kp.z, key.level]);
      // every fuse cartridge
      const fuses = r.components.filter(c => c.item === 'fuse_cartridge');
      const fm = ms.filter(m => m.kind === 'fuse');
      expect(fm.length).toBe(fuses.length);
      for (const c of fuses) expect(fm.some(m => m.x === L.pickups[c.pickup].x && m.z === L.pickups[c.pickup].z && m.level === c.level), c.where).toBe(true);
      // the controls at their mounted overlays, the generators at their panels (inside their complexes once carved)
      for (const id of ['breaker', 'valve', 'pump', 'rods', 'keyswitch', 'fuse-0', 'fuse-1']) {
        const site = r.sites.find(s => s.controls.some(c => c.id === id))!, p = mounts.byId.get(id)!.pick;
        expect(ms.some(m => m.level === site.level && Math.abs(m.x - p.x) < 1e-9 && Math.abs(m.z - p.z) < 1e-9), id).toBe(true);
      }
      for (const g of r.generators) {
        const gm = ms.find(m => m.kind === 'generator' && m.id === g.id)!;
        expect([gm.level, gm.x, gm.z, gm.state]).toEqual([g.level, g.panel.x, g.panel.z, 'need']);
        const cx = r.complexes?.find(c => c.generator === g.id);
        if (cx) expect(cx.level).toBe(g.level);
      }
      // every marker lies on a drawn cell of its storey's plan (findable on the map), its stand area walkable
      for (const m of ms) {
        const st = plan.storeys.find(s => s.level === m.level)!;
        const cx = Math.floor(m.x / 0.5), cy = Math.floor(m.z / 0.5);
        let drawn = false;
        for (let i = 0; i < st.runs.length && !drawn; i += 4) {
          if (Math.abs(st.runs[i + 2] - cy) > 3) continue;
          if (cx >= st.runs[i] - 3 && cx < st.runs[i + 1] + 3 && st.runs[i + 3] !== PLAN.none) drawn = true;
        }
        expect(drawn, `${m.kind} on storey ${m.level}`).toBe(true);
      }
    });

    it('the marks follow the state: carried -> use here, installed / started -> done, a dropped key moves its X', () => {
      const r = L.reactor!, st = emptyReactorState(r.generators.length, r.zones.length);
      // carrying the key: no key on the floor, the key switch says "use it here"
      const noKey = L.pickups.filter(p => p.itemId !== 'reactor_key');
      let ms = mapMarkers(source(L, st, {reactor_key: 1}, noKey));
      expect(ms.some(m => m.kind === 'key')).toBe(false);
      expect(ms.find(m => m.kind === 'keyswitch')!.state).toBe('use');
      // dropped elsewhere: the X is where it lies now
      const dropped = [...noKey, {itemId: 'reactor_key', count: 1, x: r.start.x, y: 0, z: r.start.z}];
      ms = mapMarkers(source(L, st, {}, dropped as never));
      expect(ms.filter(m => m.kind === 'key').map(m => [m.x, m.z])).toEqual([[r.start.x, r.start.z]]);
      // both fuses seated: no cartridge marks, slots done; key in, generators started: done
      const done = {...st, fuses: st.fuses.map(() => true), breaker: true, valve: true, pump: true, keyInserted: true, generators: st.generators.map(() => ({started: true, startedAt: 1}))};
      ms = mapMarkers(source(L, done));
      expect(ms.some(m => m.kind === 'fuse' || m.kind === 'key')).toBe(false);
      for (const k of ['fuseSlot', 'breaker', 'valve', 'pump', 'keyswitch', 'generator'] as const) for (const m of ms.filter(q => q.kind === k)) expect(m.state, k).toBe('done');
      expect(ms.find(m => m.kind === 'rods')!.state).toBe('need');
    });
  });
}

describe('the runtime: boards in the world, elevator-style storey buttons', () => {
  it('builds 4 boards, a button picked from in front selects its storey (lit), redraws only on change, survives teardown', () => {
    const uninstall = installCanvasShim(false);
    try {
      const L = level(SEEDS[0]), r = L.reactor!, lv = levelsOf(L);
      const h = fakeHost();
      h.layout = L;
      h.levels = {raycast: (o, d, max) => lv.raycast(o, d, max), levelAt: (x, z, y) => lv.levelAt(x, z, y)};
      const host = Object.assign(h, {pickups: {list: L.pickups.map(p => ({stack: {itemId: p.itemId}, x: p.x, y: p.y, z: p.z}))}});
      const rt = new ReactorMapBoards(host).install();
      for (const s of h.sectionHooks) s.build?.(L);
      expect(rt.boards.length).toBe(4);
      expect(rt.markers.some(m => m.kind === 'key')).toBe(true);
      // the drawn buttons are where they are picked, in the face's right column (the viewer's right)
      const wp = new THREE.Vector3();
      for (const bd of rt.boards) {
        bd.root.updateMatrixWorld(true);
        for (const q of bd.buttons) {
          q.mesh.getWorldPosition(wp);
          expect(Math.hypot(wp.x - q.b.x, wp.y - q.b.y, wp.z - q.b.z), `${bd.pose.screen} button L${q.b.level}`).toBeLessThan(0.02);
          const local = bd.root.worldToLocal(wp.clone());
          expect(local.x).toBeGreaterThan(MAP_BOARD.w / 2 - 0.15);
        }
      }
      const redraws0 = rt.counts.redraws;
      expect(redraws0).toBeGreaterThanOrEqual(4);
      rt.refresh(); rt.refresh();
      expect(rt.counts.redraws).toBe(redraws0); // nothing changed: no redraw
      // stand in front of the switchgear room's map board, look at the Core floor button, press E
      const b = rt.boards.find(q => q.pose.screen === 'switchgearBoard')!;
      const floorY = r.tiers.find(t => t.level === b.pose.level)!.baseY;
      const core = r.tiers[r.tiers.length - 1].level;
      const btn = b.buttons.find(q => q.b.level === core)!;
      h.player.x = b.pose.x + b.pose.nx * 0.9; h.player.z = b.pose.z + b.pose.nz * 0.9; h.player.y = floorY;
      h.camera.position.set(h.player.x, floorY + 1.6, h.player.z);
      h.camera.lookAt(btn.b.x, btn.b.y, btn.b.z);
      h.camera.updateMatrixWorld(true);
      rt.frame(0.3); // (the boards redraw once: the player's storey / "you are here" changed)
      const redraws1 = rt.counts.redraws;
      expect(rt.target?.board).toBe(b);
      expect(rt.prompt).toMatch(/show Core floor on the map/i);
      expect(b.selected).toBe(b.pose.level);
      expect(rt.interact()).toBe(true);
      expect(b.selected).toBe(core);
      expect(btn.mesh.material).toBe(lampSkin('litAmber'));
      expect(b.buttons.filter(q => q.mesh.material === lampSkin('litAmber')).length).toBe(1);
      expect(rt.counts.redraws).toBe(redraws1 + 1); // only the pressed board
      // looking away: nothing to press
      h.camera.lookAt(h.camera.position.x + b.pose.nx * 5, floorY + 1.6, h.camera.position.z + b.pose.nz * 5);
      h.camera.updateMatrixWorld(true);
      rt.frame(0.016);
      expect(rt.target).toBeNull();
      expect(rt.interact()).toBe(false);
      // a state change redraws: the key picked up (persisted record) -> the markers rebuild
      const builds = rt.counts.markerBuilds;
      host.pickups.list = host.pickups.list.filter(p => p.stack.itemId !== 'reactor_key');
      expect(h.run.laneStore(REACTOR_LANE)).toBeUndefined(); // no restart runtime here: the markers read the (empty) persisted record
      rt.refresh();
      expect(rt.counts.markerBuilds).toBe(builds + 1);
      expect(rt.markers.some(m => m.kind === 'key')).toBe(false);
      for (const s of h.sectionHooks) s.teardown?.();
      expect(rt.boards.length).toBe(0);
      void THREE;
    } finally { uninstall(); }
  }, 120_000);
});
