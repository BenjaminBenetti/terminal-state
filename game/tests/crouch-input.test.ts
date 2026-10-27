import {describe, expect, it} from 'vitest';
import {CROUCH_KEYS, isCrouchKey, shouldPreventKey} from '../src/player/input';
import {CROUCH_EYE, Player, type MoveInput} from '../src/player/player';
import {FLOOR, Grid} from '../src/gen/grid';

class Keys implements MoveInput {
  held = new Set<string>();
  taps = new Set<string>();
  clears = 0;
  down(c: string) { return this.held.has(c); }
  hit(c: string) { return this.taps.has(c); }
}

function room(): Grid {
  const g = new Grid(24, 24);
  for (let y = 2; y < 22; y++) for (let x = 2; x < 22; x++) { const i = g.idx(x, y); g.cells[i] = FLOOR; g.ceil[i] = 3; }
  return g;
}

const opts = {aiming: false, speedMult: 1, canSprint: true};
const step = (p: Player, g: Grid, k: Keys, frames: number) => { for (let i = 0; i < frames; i++) { p.update(1 / 60, k, g, null, opts); k.taps.clear(); } };

describe('crouch input: C (iteration 05; Ctrl removed because Ctrl+W closes the tab)', () => {
  it('maps only C to crouch', () => {
    expect(CROUCH_KEYS).toEqual(['KeyC']);
    expect(isCrouchKey('KeyC')).toBe(true);
    for (const k of ['ControlLeft', 'ControlRight', 'KeyX', 'ShiftLeft']) expect(isCrouchKey(k)).toBe(false);
  });

  it('suppresses browser defaults for game keys; Ctrl combos are left to the browser', () => {
    expect(shouldPreventKey({code: 'KeyC'}, true)).toBe(true);
    expect(shouldPreventKey({code: 'KeyC'}, false)).toBe(false);
    expect(shouldPreventKey({code: 'ControlLeft'}, true)).toBe(false);
    expect(shouldPreventKey({code: 'KeyW'}, true)).toBe(false);
    expect(shouldPreventKey({code: 'Tab'}, false)).toBe(true);
    expect(shouldPreventKey({code: 'Digit3'}, true)).toBe(true);
    expect(shouldPreventKey({code: 'Digit3'}, false)).toBe(false);
  });

  it('tap C toggles, hold C crouches while held; Ctrl does nothing', () => {
    const g = room(), p = new Player(), k = new Keys();
    p.spawn(5, 5, 0);
    k.taps.add('ControlLeft');
    step(p, g, k, 30);
    expect(p.crouched).toBe(false);
    k.taps.add('KeyC');
    step(p, g, k, 30);
    expect(p.crouched).toBe(true);
    expect(p.eye).toBeCloseTo(CROUCH_EYE, 6);
    k.taps.add('KeyC'); // tap again -> stand
    step(p, g, k, 30);
    expect(p.crouched).toBe(false);
    k.held.add('KeyC'); k.taps.add('KeyC'); // hold 0.5 s, release -> stand
    step(p, g, k, 30);
    expect(p.crouched).toBe(true);
    k.held.delete('KeyC');
    step(p, g, k, 2);
    expect(p.crouched).toBe(false);
  });
});
