// Hit-audio lane (2026-10-28): player-confirmed enemy hits stay audible at range (pure gain helpers).
import {describe, expect, it} from 'vitest';
import {HIT_CONFIRM, hitConfirmCompensation, hitConfirmGain, pannerInverseGain} from '../src/audio/sfx';

describe('player hit confirm gain', () => {
  it('is full level near and follows the bullet-impact rolloff until the floor', () => {
    expect(hitConfirmGain(0)).toBe(1);
    expect(hitConfirmGain(HIT_CONFIRM.ref)).toBe(1);
    expect(hitConfirmGain(3)).toBeCloseTo(pannerInverseGain(3, 2, 1.05), 6);
    expect(hitConfirmCompensation(3)).toBeCloseTo(1, 6);
    for (let d = 0; d < 120; d += 0.5) expect(hitConfirmGain(d + 0.5)).toBeLessThanOrEqual(hitConfirmGain(d) + 1e-9);
  });
  it('never drops below the audible floor out to 80+ m (and past the panner clamp)', () => {
    expect(HIT_CONFIRM.floor).toBeGreaterThanOrEqual(0.35);
    expect(HIT_CONFIRM.floor).toBeLessThanOrEqual(0.45);
    for (const d of [10, 20, 40, 80, 90, 150]) {
      expect(hitConfirmGain(d)).toBeGreaterThanOrEqual(HIT_CONFIRM.floor);
      // compensated input x panner rolloff == the floored level
      expect(hitConfirmCompensation(d) * pannerInverseGain(d, HIT_CONFIRM.ref, HIT_CONFIRM.rolloff)).toBeCloseTo(hitConfirmGain(d), 6);
    }
    expect(hitConfirmGain(80)).toBeCloseTo(HIT_CONFIRM.floor, 6);
    expect(hitConfirmCompensation(150)).toBeCloseTo(hitConfirmCompensation(90), 6);
  });
});
