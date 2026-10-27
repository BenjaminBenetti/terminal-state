import {describe, expect, it} from 'vitest';
import {Grid, FLOOR} from '../src/gen/grid';
import {CROUCH_EYE, HEAD_ABOVE_EYE, JUMP_HEIGHT, Player, STAND_EYE, WALK_SPEED, stanceRecoilMult, stanceSpreadMult, type MoveInput} from '../src/player/player';

/** Open 10 m x 10 m room; optional low-ceiling patch over the west half. */
function room(ceil = 3, lowCeil?: number): Grid {
  const g = new Grid(24, 24);
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.ceil[i] = lowCeil !== undefined && x < 12 ? lowCeil : ceil; }
  return g;
}

class Keys implements MoveInput {
  held = new Set<string>();
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}

const opts = {aiming: false, speedMult: 1, canSprint: true};
const dt = 1 / 60;

function step(p: Player, g: Grid, k: Keys, frames = 1): void {
  for (let i = 0; i < frames; i++) { p.update(dt, k, g, null, opts); k.taps.clear(); }
}

describe('stance: jump, ceiling clamp, crouch', () => {
  it('jumps ~0.5 m, lands grounded with no hovering, no double jump', () => {
    const g = room(), p = new Player(), k = new Keys();
    p.spawn(5, 5, 0);
    k.taps.add('Space');
    p.update(dt, k, g, null, opts);
    expect(p.justJumped).toBe(true);
    expect(p.grounded).toBe(false);
    k.taps.clear();
    let apex = 0, landed = false, frames = 0;
    while (frames++ < 120) {
      if (frames === 5) k.taps.add('Space'); // mid-air press: must not double jump
      p.update(dt, k, g, null, opts);
      k.taps.clear();
      expect(p.justJumped).toBe(false);
      apex = Math.max(apex, p.y);
      if (p.justLanded) { landed = true; break; }
    }
    expect(landed).toBe(true);
    expect(apex).toBeGreaterThan(JUMP_HEIGHT - 0.05);
    expect(apex).toBeLessThan(JUMP_HEIGHT + 0.03);
    expect(frames * dt).toBeLessThan(0.6);
    step(p, g, k, 3);
    expect(p.grounded).toBe(true);
    expect(p.y).toBe(0);
    expect(p.vy).toBe(0);
    step(p, g, k, 30); // landing dip has recovered
    expect(p.eye).toBeCloseTo(STAND_EYE, 6);
  });

  it('clamps the head under a low ceiling and refuses to stand without headroom', () => {
    const g = room(3, 2.0), p = new Player(), k = new Keys();
    p.spawn(3, 5, 0); // west half: 2.0 m ceiling
    k.taps.add('Space');
    let maxHead = 0;
    for (let i = 0; i < 60; i++) { p.update(dt, k, g, null, opts); k.taps.clear(); maxHead = Math.max(maxHead, p.eye + HEAD_ABOVE_EYE); }
    expect(maxHead).toBeLessThanOrEqual(2.0 + 1e-6);
    expect(p.grounded).toBe(true);

    const low = room(3, 1.5), q = new Player();
    q.spawn(3, 5, 0);
    k.taps.add('KeyC');
    step(q, low, k, 30);
    expect(q.crouched).toBe(true);
    k.taps.add('KeyC'); // try to stand under 1.5 m
    step(q, low, k, 10);
    expect(q.crouched).toBe(true);
    expect(q.standBlocked).toBe(true);
    // walk east into the 3 m half: stands up automatically once clear
    q.yaw = -Math.PI / 2; // facing +X
    k.held.add('KeyW');
    step(q, low, k, 180);
    expect(q.x).toBeGreaterThan(6.5);
    expect(q.crouched).toBe(false);
  });

  it('crouch lowers the eye and halves speed; hold-to-crouch stands on release; recoil x0.7', () => {
    const g = room(), p = new Player(), k = new Keys();
    p.spawn(5, 10.5, 0); // facing -Z with ~9 m of room ahead
    k.held.add('KeyW');
    step(p, g, k, 60);
    const standSpeed = p.speed;
    expect(standSpeed).toBeCloseTo(WALK_SPEED, 1);
    k.taps.add('KeyC');
    step(p, g, k, 60);
    expect(p.crouched).toBe(true);
    expect(p.eye).toBeCloseTo(CROUCH_EYE, 6);
    expect(p.speed).toBeCloseTo(standSpeed * 0.5, 1);
    k.held.add('ShiftLeft'); // holding sprint without a fresh press: still crouched, no sprint
    step(p, g, k, 10);
    expect(p.crouched).toBe(true);
    expect(p.sprinting).toBe(false);
    k.held.delete('ShiftLeft');
    k.taps.add('Space'); // Space from a crouch stands instead of jumping
    step(p, g, k, 2);
    expect(p.crouched).toBe(false);
    expect(p.grounded).toBe(true);
    // hold C for 0.5 s, release -> stand
    k.held.add('KeyC'); k.taps.add('KeyC');
    step(p, g, k, 30);
    expect(p.crouched).toBe(true);
    k.held.delete('KeyC');
    step(p, g, k, 2);
    expect(p.crouched).toBe(false);

    expect(stanceRecoilMult(true)).toBeCloseTo(0.7 * stanceRecoilMult(false), 10);
    expect(stanceSpreadMult(true)).toBeCloseTo(0.8 * stanceSpreadMult(false), 10);
  });
});
