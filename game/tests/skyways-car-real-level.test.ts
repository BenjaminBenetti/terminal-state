// Task studio-skyways-level-20261106-054448 (lane CAR): the prize car's controller on a REAL generated multi-storey level (until the Skyways
// generator lands: the Mall — galleries round an open atrium behind generator railings, escalator / stair ramps, shopfronts, columns,
// props). From several admissible parked poses on different storeys the car is driven with a busy deterministic pattern (throttle,
// steering swings, reverse, handbrake) and every frame it must hold the controller's invariants: the footprint on its own storey's
// floor (never a ramp, never over the atrium / an edge), the storey unchanged, never inside a wall / rail / prop (a settled pose).
import {describe, expect, it} from 'vitest';
import {generateMallLevel} from '../src/gen/mall/index';
import {levelsOf} from '../src/gen/levels';
import {CELL} from '../src/gen/grid';
import {PropIndex} from '../src/core/physics';
import type {StationLayout} from '../src/gen/stationTypes';
import {CAR_PHYS, NO_CONTROLS, footprintFloor, settlePose, stepCar, type CarBody, type CarControls} from '../src/world/skywaysCarPhysics';
import {CAR_SPEC} from '../src/world/skywaysCarSpec';

const DT = 1 / 60;
const G = CAR_SPEC;

describe('skyways car on a real level (the Mall)', () => {
  const layout = generateMallLevel({levelSeed: 5158, startWeapon: 'rifle'} as never) as StationLayout;
  const levels = levelsOf(layout);
  const props = new PropIndex(levels, layout.props);
  const w = {levels, props};
  const settled = (b: CarBody) => {
    const o = {x: 0, z: 0, sx: 0, sz: 0, circle: -1};
    return settlePose(w, G, b.x, b.z, b.yaw, b.y, o) && Math.hypot(o.sx, o.sz) < 0.01;
  };

  /** Admissible parked poses: spread over the grid, one storey at a time (every 7th cell, both axes' headings). */
  function poses(max: number): CarBody[] {
    const out: CarBody[] = [];
    const g0 = levels.main, perLevel = new Map<number, number>();
    for (let cy = 3; cy < g0.h - 3 && out.length < max; cy += 7) for (let cx = 3; cx < g0.w - 3 && out.length < max; cx += 7) {
      const x = (cx + 0.5) * CELL, z = (cy + 0.5) * CELL;
      for (const band of levels.bands(x, z)) {
        if ((perLevel.get(band.level) ?? 0) >= Math.ceil(max / 2)) continue;
        for (const yaw of [0, Math.PI / 2]) {
          const b: CarBody = {x, y: band.floor, z, yaw, v: 0, steer: 0, level: band.level, yawRate: 0};
          if (footprintFloor(levels, x, z, yaw, band.floor, band.level, G) === null || !settled(b)) continue;
          out.push(b);
          perLevel.set(band.level, (perLevel.get(band.level) ?? 0) + 1);
          break;
        }
      }
    }
    return out;
  }

  it('drives about without ever leaving its storey floor, crossing a rail / edge / ramp or entering a wall / prop', () => {
    const start = poses(8);
    expect(start.length).toBeGreaterThanOrEqual(4);
    expect(new Set(start.map(b => b.level)).size).toBeGreaterThanOrEqual(2); // more than one storey (an upper gallery round the atrium)
    let driven = 0, blocked = 0;
    for (const [k, b] of start.entries()) {
      const level = b.level, y0 = b.y;
      const ctl: CarControls = {...NO_CONTROLS};
      for (let f = 0; f < 6 / DT; f++) {
        const t = f * DT, phase = Math.floor(t / 0.7) + k;
        ctl.forward = phase % 5 !== 3;
        ctl.back = phase % 5 === 3;
        ctl.left = phase % 3 === 0;
        ctl.right = phase % 3 === 1;
        ctl.handbrake = phase % 7 === 6;
        const r = stepCar(b, w, G, ctl, DT);
        driven += r.moved;
        if (r.blocked) blocked++;
        expect(b.level).toBe(level);
        expect(Math.abs(b.y - y0)).toBeLessThanOrEqual(CAR_PHYS.floorTol + 1e-6);
        expect(footprintFloor(levels, b.x, b.z, b.yaw, b.y, b.level, G), `pose ${k} frame ${f}`).not.toBeNull();
        expect(settled(b), `pose ${k} frame ${f}`).toBe(true);
        expect(Number.isFinite(b.x) && Number.isFinite(b.z) && Number.isFinite(b.v)).toBe(true);
      }
    }
    expect(driven).toBeGreaterThan(start.length * 4); // it really drove (not stuck in place; the mall is crowded: ~10 m a pose)
    expect(blocked).toBeGreaterThan(0); // and met the level's walls / rails / edges on the way
  });
});
