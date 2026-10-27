import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {CONSUME_TIMING, ConsumeView} from '../src/weapons/consumeView';
import {Inventory} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';

/** Viewmodel stand-in: the camera the item is parented to + the holster level it receives. */
function host() {
  return {camera: new THREE.Object3D(), k: -1, setHolstered(k: number) { this.k = k; }};
}
/** 0.07 x h x 0.07 item, origin bottom-centre (like the runtime item models). */
const make = (h = 0.23) => () => {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07));
  m.position.y = h / 2;
  g.add(m);
  return g;
};
const dt = 1 / 60;
const run = (cv: ConsumeView, s: number) => { for (let t = 0; t < s; t += dt) cv.update(dt); };
// Mirrors consumeView MOUTH (iteration-04 integration: raised into the 54° viewmodel frame).
const MOUTH = new THREE.Vector3(0.015, -0.045, -0.14);
const topOf = (cv: ConsumeView) => {
  const obj = cv.group.children[0];
  return new THREE.Vector3(0, 0.23, 0).applyQuaternion(obj.quaternion).add(obj.position);
};

describe('consume view state machine (iteration 04)', () => {
  it('swap: gun lowers, the item comes up to the mouth, then goes away and the gun comes back', () => {
    const h = host(), cv = new ConsumeView(h, make());
    expect(h.camera.children).toContain(cv.group);
    cv.start('water', 1.6, 'swap');
    run(cv, 0.08);
    expect(cv.phase).toBe('stow');
    expect(cv.itemVisible).toBe(false);
    expect(h.k).toBeGreaterThan(0);
    expect(h.k).toBeLessThan(1);
    run(cv, CONSUME_TIMING.stow);
    expect(h.k).toBe(1); // gun fully out of view
    expect(cv.itemVisible).toBe(true);
    run(cv, 0.4);
    expect(cv.phase).toBe('use');
    expect(topOf(cv).distanceTo(MOUTH)).toBeLessThan(0.03); // bottle neck at the mouth
    const z0 = cv.group.children[0].position.z;
    run(cv, 0.8);
    expect(cv.group.children[0].position.y).toBeGreaterThan(-0.06); // tipped up as it empties
    expect(Math.abs(cv.group.children[0].position.z - z0)).toBeLessThan(0.1);
    cv.complete(false);
    expect(cv.phase).toBe('finish');
    expect(cv.busy).toBe(true);
    run(cv, CONSUME_TIMING.finish + 0.02);
    expect(cv.itemVisible).toBe(false);
    expect(cv.phase).toBe('restore');
    run(cv, CONSUME_TIMING.restore + 0.02);
    expect(cv.phase).toBe('idle');
    expect(cv.busy).toBe(false);
    expect(h.k).toBe(0);
    expect(cv.counts).toEqual({started: 1, completed: 1, cancelled: 0});
  });

  it('cancel during use or stow restores the gun without completing; no double counting', () => {
    const h = host(), cv = new ConsumeView(h, make());
    cv.start('cola', 1.4, 'swap');
    run(cv, 0.8);
    cv.cancel('hit');
    cv.cancel('again');
    cv.complete(false); // ignored after a cancel
    expect(cv.phase).toBe('cancel');
    run(cv, CONSUME_TIMING.cancel + CONSUME_TIMING.restore + 0.05);
    expect([cv.phase, h.k, cv.itemVisible]).toEqual(['idle', 0, false]);
    expect(cv.counts).toEqual({started: 1, completed: 0, cancelled: 1});
    expect(cv.lastCancel).toBe('hit');

    cv.start('cola', 1.4, 'swap');
    run(cv, 0.05);
    cv.cancel('slot');
    expect(cv.phase).toBe('restore'); // item never came on screen
    run(cv, CONSUME_TIMING.restore + 0.02);
    expect([cv.phase, h.k, cv.itemVisible]).toEqual(['idle', 0, false]);
  });

  it('hand mode: the held copy hides at once and the stack returns to the hand when some remain', () => {
    const h = host(), cv = new ConsumeView(h, make(0.122));
    cv.start('cola', 1.4, 'hand');
    expect(h.k).toBe(1);
    expect(cv.itemVisible).toBe(true);
    expect(cv.group.children[0].position.toArray().map(v => +v.toFixed(2))).toEqual([0.16, -0.17, -0.36]);
    run(cv, 1.4);
    cv.complete(true);
    run(cv, CONSUME_TIMING.finish + 0.02);
    expect([cv.phase, h.k, cv.itemVisible]).toEqual(['idle', 0, false]);
  });

  it('reset clears everything immediately; medical items use the apply motion', () => {
    const h = host(), cv = new ConsumeView(h, make(0.09));
    cv.start('bandage', 1.1, 'empty');
    run(cv, 0.6);
    expect(cv.phase).toBe('use');
    expect(cv.group.children[0].position.y).toBeLessThan(-0.12); // held low, not at the mouth
    cv.reset();
    expect([cv.phase, h.k, cv.itemVisible, cv.busy]).toEqual(['idle', 0, false, false]);
  });

  it('using an item from the backpack leaves the held weapon equipped with its magazine', () => {
    const inv = new Inventory();
    const rifle = inv.makeStack('rifle', 1, 17);
    inv.set({bar: 'hotbar', index: 0}, rifle);
    inv.set({bar: 'pack', index: 3}, inv.makeStack('water', 2));
    inv.select(0);
    const wc = new WeaponController();
    wc.equip(inv.selectedStack());
    wc.update(1, {held: false, pressed: false, reload: false, lowered: false}, inv);
    // while the consume view is busy the game passes lowered: true -> no shots
    expect(wc.update(0.05, {held: true, pressed: true, reload: false, lowered: true}, inv)).toEqual([]);
    expect(inv.consumeAt({bar: 'pack', index: 3})).toBe(true);
    wc.equip(inv.selectedStack()); // Game.syncHeld after the use: same stack -> no re-equip
    expect(wc.stack).toBe(rifle);
    expect(wc.phase).toBe('idle');
    expect(rifle.mag).toBe(17);
    expect(inv.selected).toBe(0);
  });
});
