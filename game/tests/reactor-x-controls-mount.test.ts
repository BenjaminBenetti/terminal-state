// Task reactor-expansion-20261101 (lane CONTROLS): THE MOUNTED-CONTROL RULE on REAL generated Reactor layouts (user feedback: "the main
// breaker and fuse slot controls are floating in front of the electrical box thing ... all controls that sit on 3d models need to be
// checked, for touching" / "circulation pump hit box is miss aligned with model, hit box is off by 90deg"):
//  - HOST_FACES re-probed from the cooked GLBs (ray casts over the model triangles), so the data the rule runs on is the models';
//  - every restart control's overlay back plane lies ON its host model's actual surface (ray casts from the overlay into the placed
//    model's triangles: no gap, no protrusion through), the valve's handwheel is the model's own wheel;
//  - every machine model agrees with its collider (long axis, centre, extent: the pump's 90 deg error), generators too, and each
//    generator's start box stands flush on the generator model's measured face;
//  - every control is reachable and pickable from its stand point through the real level geometry.
import {beforeAll, describe, expect, it} from 'vitest';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {FLOOR} from '../src/gen/grid';
import type {StationLayout} from '../src/gen/stationTypes';
import {
  EMBED, GENERATOR_PANEL, HOST_FACES, OVERLAY_EXTENT, generatorPanelPose, generatorPlacement, hostToWorld, machineDepth, machineFront,
  machineWidth, reactorMounts, deskFrame, type HostPiece, type HostPlacement, type MountedControl,
} from '../src/world/reactor/controlsMount';
import {RESTART_REACH} from '../src/world/reactor/restart';
import {RESTART_CONTROL_IDS} from '../src/world/reactor/restartLogic';
import {glbTris, mapTris, rayTris, trisBox, type Tri, type V3} from './helpers/reactorControlsGlb';
import {buildRestart, fakeHost} from './helpers/reactorRestartFixture';

const SEEDS = [9100, 218558, 637474];
const FILE: Record<HostPiece | 'generator', string> = {
  switchgear: 'reactor-switchgear.glb', coolantPump: 'reactor-coolant-pump.glb', coolantValve: 'reactor-coolant-valve.glb',
  controlConsole: 'reactor-control-console.glb', generator: 'reactor-aux-generator.glb',
};
const layouts = new Map<number, StationLayout>();
const level = (seed: number) => { let L = layouts.get(seed); if (!L) layouts.set(seed, (L = LEVELS.reactor.generate('main', {levelSeed: seed}))); return L; };

/** World triangles of a placed host. */
const placed = new WeakMap<HostPlacement, Tri[]>();
function hostTris(h: HostPlacement): Tri[] {
  let t = placed.get(h);
  if (!t) placed.set(h, (t = mapTris(glbTris(FILE[h.piece]), (x, y, z) => hostToWorld(h, x, y, z))));
  return t;
}

describe('HOST_FACES are the cooked models\' faces (re-probed)', () => {
  it('switchgear: the clear door rect is the flat door plane (no gauge / lever under it)', () => {
    const T = glbTris(FILE.switchgear), F = HOST_FACES.switchgear, C = F.clear;
    const hs: number[] = [];
    for (let x = C.x0 + 0.01; x <= C.x1 - 0.01; x += 0.02) for (let y = C.y0 + 0.01; y <= C.y1 - 0.01; y += 0.02) {
      const t = rayTris(T, [x, y, 2], [0, 0, -1]);
      expect(t, `door at ${x.toFixed(2)},${y.toFixed(2)}`).not.toBeNull();
      hs.push(2 - t!);
    }
    hs.sort((a, b) => a - b);
    expect(hs[Math.floor(hs.length / 2)]).toBeCloseTo(F.doorZ, 2);
    expect(hs[0]).toBeGreaterThan(F.doorZ - EMBED);
    expect(hs[hs.length - 1]).toBeLessThan(F.doorZ + 0.035); // paint relief only
    // ... and the bounding box front is NOT the door (the lever handle reaches 0.65): mounting on the bbox floated the controls 0.26 m
    expect(trisBox(T).max[2] - F.doorZ).toBeGreaterThan(0.2);
  });

  it('coolant pump: the motor end cover is a flat disc at x -1.75', () => {
    const T = glbTris(FILE.coolantPump), P = HOST_FACES.coolantPump;
    for (let a = 0; a < 8; a++) for (const r of [0, 0.15, 0.3]) {
      const y = P.disc.y + Math.sin(a) * r, z = P.disc.z + Math.cos(a) * r;
      const t = rayTris(T, [-3, y, z], [1, 0, 0]);
      expect(t).not.toBeNull();
      expect(-3 + t!).toBeCloseTo(P.endX, 1);
    }
  });

  it('control console: the sloped desk plane', () => {
    const T = glbTris(FILE.controlConsole), df = deskFrame();
    for (let x = -1.3; x <= 1.3; x += 0.26) for (let z = df.z0 + 0.02; z <= df.z1 - 0.02; z += 0.05) {
      const t = rayTris(T, [x, 3, z], [0, -1, 0]);
      expect(t).not.toBeNull();
      expect(Math.abs(3 - t! - df.yAt(z))).toBeLessThan(0.03);
    }
  });

  it('coolant valve: the handwheel is every triangle above the cut (centred on the stem, r 0.43)', () => {
    const T = glbTris(FILE.coolantValve), W = HOST_FACES.coolantValve.wheel;
    const wheel = T.filter(t => t.every(v => v[1] > W.cutY));
    expect(wheel.length).toBeGreaterThan(200);
    const b = trisBox(wheel);
    expect((b.min[0] + b.max[0]) / 2).toBeCloseTo(0, 1);
    expect((b.min[2] + b.max[2]) / 2).toBeCloseTo(0, 1);
    expect((b.max[0] - b.min[0]) / 2).toBeCloseTo(W.r, 1);
    expect(b.min[1]).toBeGreaterThan(W.cutY);
    // the bonnet front where its lamp sits
    const L = HOST_FACES.coolantValve.lamp;
    expect(2 - rayTris(T, [0, L.y, 2], [0, 0, -1])!).toBeCloseTo(L.z, 2);
  });

  it('generator: both ends are flat at |x| 2.69 where a start box meets them (the radiator end to 1.75 m), the side at 0.59', () => {
    const T = glbTris(FILE.generator);
    // the box back rests on the face's outer plane; grooves (radiator bands at 0.8 / 1.3 m) are at most ~8 cm deep behind it
    const off: string[] = [], xs: number[] = [];
    for (const s of [-1, 1]) for (let y = s > 0 ? 0.7 : 1.3; y <= (s > 0 ? 1.75 : 1.46); y += 0.05) for (let z = -0.4; z <= 0.3; z += 0.1) {
      const t = rayTris(T, [s * 4, y, z], [-s, 0, 0]);
      const x = t === null ? NaN : 4 - t;
      xs.push(x);
      if (!(x > GENERATOR_PANEL.endX - 0.1 && x < GENERATOR_PANEL.endX + 0.04)) off.push(`${s > 0 ? '+' : '-'}X y ${y.toFixed(2)} z ${z.toFixed(2)}: ${x.toFixed(3)}`);
    }
    expect(off).toEqual([]);
    xs.sort((a, b) => a - b);
    expect(Math.abs(xs[Math.floor(xs.length / 2)] - GENERATOR_PANEL.endX)).toBeLessThan(0.025);
    const t = rayTris(T, [0, 1.2, 3], [0, 0, -1]);
    expect(3 - t!).toBeCloseTo(GENERATOR_PANEL.sideZ, 1);
  });
});

for (const seed of SEEDS) {
  describe(`seed ${seed}: every control ON its host model's face, every machine on its collider`, () => {
    let L: StationLayout;
    beforeAll(() => { L = level(seed); }, 120_000);

    it('every restart control has a host model placed from a machine record', () => {
      const M = reactorMounts(L.reactor!);
      for (const id of RESTART_CONTROL_IDS) {
        const m = M.byId.get(id);
        expect(m, id).toBeDefined();
        expect(m!.host, id).not.toBeNull();
        const s = M.sites.find(q => q.mounts.includes(m!))!;
        expect(s.hosts[m!.placement].machine, id).toBeGreaterThanOrEqual(0);
      }
    });

    it('the overlay back plane touches the model surface everywhere under it (no gap, nothing through it)', () => {
      const M = reactorMounts(L.reactor!);
      const report: string[] = [];
      for (const s of M.sites) for (const m of s.mounts) {
        if (!m.host) continue;
        const h = s.hosts[m.placement];
        if (m.id === 'valve') {
          // the wheel IS the model's: the mount is its centre on the stem
          const w = hostToWorld(h, 0, HOST_FACES.coolantValve.wheel.y, 0);
          expect(Math.hypot(w.x - m.x, w.y - m.y, w.z - m.z), m.id).toBeLessThan(1e-6);
          continue;
        }
        const tris = hostTris(h), e = OVERLAY_EXTENT[m.id];
        const r: V3 = [m.uy * m.nz - m.uz * m.ny, m.uz * m.nx - m.ux * m.nz, m.ux * m.ny - m.uy * m.nx];
        for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.1, 0.5, 0.9]) {
          const lx = e.x0 + (e.x1 - e.x0) * fx, ly = e.y0 + (e.y1 - e.y0) * fy;
          const P: V3 = [m.x + r[0] * lx + m.ux * ly, m.y + r[1] * lx + m.uy * ly, m.z + r[2] * lx + m.uz * ly];
          const t = rayTris(tris, [P[0] + m.nx * 0.25, P[1] + m.ny * 0.25, P[2] + m.nz * 0.25], [-m.nx, -m.ny, -m.nz], 0.6);
          expect(t, `${m.id} sample ${fx},${fy}: model surface under the overlay`).not.toBeNull();
          const above = 0.25 - t!; // surface height above the mount plane (+ = toward the operator)
          report.push(`${m.id} ${fx},${fy}: ${above.toFixed(3)}`);
          expect(above, `${m.id} ${fx},${fy}: a gap behind the overlay`).toBeGreaterThan(-EMBED - 0.012);
          expect(above, `${m.id} ${fx},${fy}: the model pokes through the overlay`).toBeLessThan(0.035);
          if (fx === 0.5 && fy === 0.5) expect(Math.abs(above), `${m.id}: centre on the face`).toBeLessThan(0.015);
        }
      }
      expect(report.length).toBeGreaterThan(40);
    });

    it('each machine model agrees with its collider: long axis, centre, extent (the pump was 90 deg off)', () => {
      const M = reactorMounts(L.reactor!);
      for (const s of M.sites) for (const [i, m] of (s.site.machines ?? []).entries()) {
        const hosts = s.hosts.filter(h => h.machine === i);
        if (m.kind === 'statusBoard') continue;
        expect(hosts.length, m.kind).toBeGreaterThan(0);
        const prop = L.props[m.prop];
        const box = trisBox(hosts.flatMap(h => hostTris(h)));
        const mx = (box.max[0] - box.min[0]) / 2, mz = (box.max[2] - box.min[2]) / 2;
        // long axis: the model's and the collider's agree
        if (Math.abs(prop.hx - prop.hz) > 0.2) expect(mx > mz, `${m.kind} long axis`).toBe(prop.hx > prop.hz);
        // the model never stands outside its collider into walkable space (lane PATHS' audit rule): its plan box inside the collider
        // (+1 cm), except a switchgear bank's back, which sinks into the wall behind it
        const [fx, fz] = machineFront(m);
        if (m.kind === 'switchgear') {
          // the bank exactly fills the collider along its length; its outermost front (the lever handles) on the collider's front
          // face, the door 0.26 m behind it
          const along = Math.abs(fx) > 0.5 ? mz : mx;
          expect(along * 2).toBeCloseTo(machineWidth(m), 2);
          for (const h of hosts) {
            const f = hostToWorld(h, 0, 1.2, HOST_FACES.switchgear.frontZ), d = hostToWorld(h, 0, 1.2, HOST_FACES.switchgear.doorZ);
            expect((f.x - m.x) * fx + (f.z - m.z) * fz).toBeCloseTo(machineDepth(m) / 2, 3);
            expect((d.x - m.x) * fx + (d.z - m.z) * fz).toBeCloseTo(machineDepth(m) / 2 - (HOST_FACES.switchgear.frontZ - HOST_FACES.switchgear.doorZ), 3);
          }
          const behind = {x: m.x - fx * machineDepth(m) / 2, z: m.z - fz * machineDepth(m) / 2};
          const g = L.levels[s.site.level].grid, [cx, cy] = g.cellOf(behind.x - fx * 0.25, behind.z - fz * 0.25);
          expect(g.cells[g.idx(cx, cy)], 'the bank backs onto a wall').not.toBe(FLOOR);
          continue;
        }
        expect(box.min[0], `${m.kind} x0`).toBeGreaterThan(prop.x - prop.hx - 0.01);
        expect(box.max[0], `${m.kind} x1`).toBeLessThan(prop.x + prop.hx + 0.01);
        expect(box.min[2], `${m.kind} z0`).toBeGreaterThan(prop.z - prop.hz - 0.01);
        expect(box.max[2], `${m.kind} z1`).toBeLessThan(prop.z + prop.hz + 0.01);
        expect(box.max[1] - box.min[1], `${m.kind} height`).toBeLessThan(prop.h + 0.02);
        expect(Math.abs(mx - prop.hx) + Math.abs(mz - prop.hz), `${m.kind} fills its collider`).toBeLessThan(0.45);
        if (m.kind === 'pump') {
          // the hit box: model / collider overlap (intersection over union of the plan rects) — it was ~0.3 when 90 deg off
          const ix = Math.max(0, Math.min(box.max[0], prop.x + prop.hx) - Math.max(box.min[0], prop.x - prop.hx));
          const iz = Math.max(0, Math.min(box.max[2], prop.z + prop.hz) - Math.max(box.min[2], prop.z - prop.hz));
          const inter = ix * iz, uni = 4 * mx * mz + 4 * prop.hx * prop.hz - inter;
          expect(inter / uni).toBeGreaterThan(0.85);
        }
      }
    });

    it('generators: the model lies along its collider; the start box stands flush on the model face, grounded', () => {
      const r = L.reactor!;
      for (const g of r.generators) {
        const p = generatorPlacement(g);
        const tris = mapTris(glbTris(FILE.generator), (x, y, z) => hostToWorld(p, x, y, z));
        const box = trisBox(tris);
        const prop = L.props.find(q => q.kind === 'annexMachine' && Math.abs(q.x - g.x) < 0.05 && Math.abs(q.z - g.z) < 0.05 && (q.level ?? 0) === g.level);
        expect(prop, `generator ${g.id} collider`).toBeDefined();
        expect((box.max[0] - box.min[0]) > (box.max[2] - box.min[2]), `generator ${g.id} long axis`).toBe(prop!.hx > prop!.hz);
        expect(box.min[0]).toBeGreaterThan(prop!.x - prop!.hx - 0.15);
        expect(box.max[0]).toBeLessThan(prop!.x + prop!.hx + 0.15);
        const pose = generatorPanelPose(g, true);
        // the box's back (a vertical plane EMBED inside the face) meets the model where the box and the face overlap in height
        const y0 = Math.max(pose.py - GENERATOR_PANEL.h / 2, g.y + 0.65 * p.s), y1 = Math.min(pose.py + GENERATOR_PANEL.h / 2, g.y + 1.45 * p.s);
        expect(y1 - y0, `generator ${g.id}: the box overlaps the model's face`).toBeGreaterThan(0.05);
        const yc = (y0 + y1) / 2;
        const t = rayTris(tris, [pose.face.x + pose.n.x * 0.3, yc, pose.face.z + pose.n.z * 0.3], [-pose.n.x, 0, -pose.n.z], 0.8);
        expect(t, `generator ${g.id}: model face behind the box`).not.toBeNull();
        expect(Math.abs(0.3 - t!), `generator ${g.id}: box back on the face`).toBeLessThan(EMBED + 0.03);
      }
    });

    it('every control is reachable and pickable from its stand point through the real level geometry', () => {
      const h = fakeHost();
      h.layout = L;
      const lv = levelsOf(L);
      h.levels = {raycast: (o, d, max) => lv.raycast(o, d, max), levelAt: (x, z, y) => lv.levelAt(x, z, y)};
      const rt = buildRestart(h);
      expect(rt.controls.length).toBe(RESTART_CONTROL_IDS.length);
      for (const e of rt.controls) {
        const floor = L.reactor!.tiers.find(t => t.level === e.level)!.baseY;
        const eye = {x: e.c.stand.x, y: floor + 1.6, z: e.c.stand.z};
        const p = e.m.pick;
        expect(Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z), `${e.id} reach`).toBeLessThan(RESTART_REACH - 0.15);
        h.player.x = eye.x; h.player.z = eye.z; h.player.y = floor;
        h.camera.position.set(eye.x, eye.y, eye.z);
        h.camera.lookAt(p.x, p.y, p.z);
        h.camera.updateMatrixWorld(true);
        expect(rt.pick()?.id, `${e.id} picked from its stand`).toBe(e.id);
      }
      for (const s of h.sectionHooks) s.teardown?.();
    }, 60_000);
  });
}

describe('mounts are pure and stable', () => {
  it('the same layout gives the same mounts; a mount keeps its overlay on the face of a machine record', () => {
    const r = level(SEEDS[0]).reactor!;
    const a = reactorMounts(r), b = reactorMounts(r);
    const pick = (m: MountedControl) => [m.id, m.pick.x.toFixed(4), m.pick.y.toFixed(4), m.pick.z.toFixed(4)].join();
    expect([...a.byId.values()].map(pick)).toEqual([...b.byId.values()].map(pick));
  });
});
