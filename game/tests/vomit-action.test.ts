// Task studio-market-bar-20261108-225231-01 (lane SHELVES; user: "A second timed beer makes player vomit, physical chunks like bullet
// casings."): THE THROW-UP ACTION (player/vomit.ts, Game.vomit) on a small structural host:
//  - start / active / end timing (about 2.6 s), one retch at the start, the chunks thrown with the heaves (bounded);
//  - refused (false, nothing happens) while dead, in any menu / pause / map, riding, driving, or already throwing up;
//  - the camera pitches down and recovers EXACTLY to the player's own pitch (the player's mouse look in between kept), the head dips,
//    the held item lowers and comes back, movement is slowed, the mouse buttons are owned (no shot / aim / use) while it lasts;
//  - death / the section going end it at once (the offset taken back);
//  - never an inventory / loot / cargo change; Game's guards (vmBusy, E, startUse, the viewmodel holster) read it.
import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {VOMIT, VomitAction, vomitDip, vomitHolster, vomitPitch, vomitQaApi, vomitSpeed, type VomitHost} from '../src/player/vomit';
import {VOMIT_CHUNKS} from '../src/player/vomitChunks';
import {combineModifiers} from '../src/player/modifiers';
import {PITCH_LIMIT} from '../src/player/mouseLook';
import {Inventory} from '../src/items/inventory';

const DT = 1 / 60;

function host(over: Partial<VomitHost> = {}) {
  const camera = new THREE.PerspectiveCamera(75, 1, 0.05, 70);
  const scene = new THREE.Scene();
  const player = {alive: true, pitch: 0.1, eye: 1.6, yaw: 0.3, vx: 0, vz: 0, x: 0, z: 0};
  const retches: number[] = [];
  const h = {
    state: 'playing', player, camera, scene, trainRide: {riding: false}, skywaysCar: {driving: false}, physics: null,
    marketAudio: {retch: () => { retches.push(1); }},
    frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: never): void; teardown?(): void}[],
    modifierSources: [] as VomitHost['modifierSources'], inputOwners: [] as (() => boolean)[], ...over,
  };
  const sys = new VomitAction(h as VomitHost).install();
  /** One game frame: the player's step writes the eye fresh, then the frame hooks (the action), then the camera reads pitch / eye. */
  const frame = (dt = DT) => {
    player.eye = 1.6;
    for (const f of h.frameHooks) f(dt);
    camera.position.set(player.x, player.eye, player.z);
    camera.rotation.set(player.pitch, player.yaw, 0, 'YXZ');
    camera.updateMatrixWorld(true);
  };
  return {h, sys, player, frame, retches, scene};
}

describe('the throw-up action: timing', () => {
  it('start(): active for about 2.6 s (2-3 s), then over; one retch at the start; the heaves throw their chunks', () => {
    const {sys, frame, retches} = host();
    expect(sys.active).toBe(false);
    expect(sys.start()).toBe(true);
    expect([sys.active, retches.length]).toEqual([true, 1]);
    let t = 0;
    while (sys.active && t < 5) { frame(); t += DT; }
    expect(t).toBeGreaterThanOrEqual(2.0);
    expect(t).toBeLessThanOrEqual(3.0);
    expect(Math.abs(t - VOMIT.duration)).toBeLessThan(2 * DT);
    const thrown = VOMIT.heaves.reduce((n, hv) => n + hv.chunks, 0);
    expect(sys.counts).toMatchObject({started: 1, completed: 1, cancelled: 0, chunks: thrown, retches: 1});
    expect(sys.chunks.live).toBe(thrown);
    expect(thrown).toBeLessThanOrEqual(VOMIT_CHUNKS.max);
    expect(retches.length).toBe(1);
    // it can run again once over
    expect(sys.start()).toBe(true);
  });

  it('the chunks leave with the heaves (none before the first), all of a heave thrown before the next', () => {
    const {sys, frame} = host();
    sys.start();
    const log: [number, number][] = [];
    while (sys.active) { frame(); log.push([sys.active ? sys.elapsed : VOMIT.duration, sys.counts.chunks]); }
    const thrownBy = (t: number) => log.filter(([x]) => x <= t + 1e-9).at(-1)?.[1] ?? 0;
    let before = 0;
    VOMIT.heaves.forEach((hv, i) => {
      expect(thrownBy(hv.t), `before heave ${i}`).toBe(before);
      before += hv.chunks;
      expect(thrownBy(VOMIT.heaves[i + 1]?.t ?? VOMIT.duration), `after heave ${i}`).toBe(before);
    });
  });
});

describe('the throw-up action: refused states', () => {
  const cases: [string, (h: ReturnType<typeof host>) => void][] = [
    ['dead', x => { x.player.alive = false; }],
    ['menu', x => { x.h.state = 'inventory'; }],
    ['menu', x => { x.h.state = 'paused'; }],
    ['menu', x => { x.h.state = 'map'; }],
    ['riding', x => { x.h.trainRide = {riding: true}; }],
    ['driving', x => { x.h.skywaysCar = {driving: true}; }],
  ];
  for (const [why, set] of cases) it(`never while ${why}: start() is false and nothing happens (no retch, no chunks, no offsets)`, () => {
    const x = host();
    set(x);
    const pitch = x.player.pitch;
    expect(x.sys.start()).toBe(false);
    expect([x.sys.active, x.sys.lastRefusal, x.retches.length]).toEqual([false, why, 0]);
    for (let i = 0; i < 120; i++) x.frame();
    expect([x.player.pitch, x.sys.chunks.live, x.sys.holster]).toEqual([pitch, 0, 0]);
  });

  it('never twice at once: a second start() while throwing up is refused (busy) and does not restart it', () => {
    const {sys, frame, retches} = host();
    sys.start();
    for (let i = 0; i < 30; i++) frame();
    const t = sys.elapsed;
    expect(sys.start()).toBe(false);
    expect([sys.lastRefusal, sys.elapsed, retches.length]).toEqual(['busy', t, 1]);
  });
});

describe('the throw-up action: body, camera, held item, movement, actions', () => {
  it('the view pitches down with each heave and recovers EXACTLY to the player\'s own pitch, mouse look in between kept; the head dips', () => {
    const {sys, frame, player} = host();
    sys.start();
    let lowest = Infinity, dipMax = 0, mouse = 0;
    while (sys.active) {
      // the player moves the mouse a little up each frame (applyMouseLook happens before the frame hooks)
      player.pitch += 0.001; mouse += 0.001;
      frame();
      lowest = Math.min(lowest, player.pitch - (0.1 + mouse));
      dipMax = Math.max(dipMax, 1.6 - player.eye);
    }
    expect(lowest).toBeLessThan(-0.3); // (a heave looks well down)
    expect(dipMax).toBeGreaterThan(0.05);
    expect(player.pitch).toBeCloseTo(0.1 + mouse, 9); // (exactly the player's own look back)
    frame();
    expect(player.eye).toBe(1.6);
  });

  it('near the pitch limit: the offset clamps and exactly that much is taken back', () => {
    const {sys, frame, player} = host();
    player.pitch = -PITCH_LIMIT + 0.05;
    sys.start();
    while (sys.active) { frame(); expect(player.pitch).toBeGreaterThanOrEqual(-PITCH_LIMIT); }
    expect(player.pitch).toBeCloseTo(-PITCH_LIMIT + 0.05, 9);
  });

  it('the curves: pitch / dip / holster / speed are 0 / 0 / 0 / 1 outside it; the item fully lowered and movement slow in the middle', () => {
    for (const t of [-1, 0, VOMIT.duration, VOMIT.duration + 1]) expect([vomitPitch(t), vomitHolster(t), vomitSpeed(t)]).toEqual([0, 0, 1]);
    expect(vomitDip(VOMIT.duration + 1)).toBe(0);
    expect(vomitHolster(1.0)).toBe(1);
    expect(vomitSpeed(1.0)).toBe(VOMIT.speedMult);
    for (const hv of VOMIT.heaves) expect(vomitPitch(hv.t + VOMIT.heaveLen / 2)).toBeGreaterThan(VOMIT.hunch + hv.pitch * 0.9);
  });

  it('the held item lowers out of view and comes back; movement slowed (a modifier source) and the mouse owned only while it lasts', () => {
    const {sys, frame, h} = host();
    const mods = () => combineModifiers(h.modifierSources);
    const owns = () => h.inputOwners.some(f => f());
    expect([sys.holster, mods().speedMult, owns()]).toEqual([0, 1, false]);
    sys.start();
    let maxH = 0, minSpeed = 1;
    const pose: number[] = [];
    while (sys.active) {
      frame();
      if (!sys.active) break;
      maxH = Math.max(maxH, sys.holster);
      minSpeed = Math.min(minSpeed, mods().speedMult);
      expect(owns()).toBe(true);
      pose.push(sys.holster);
    }
    expect(maxH).toBe(1);
    expect(minSpeed).toBe(VOMIT.speedMult);
    expect(pose.at(-1)!).toBeLessThan(0.05); // (back up by the end)
    expect([sys.holster, mods().speedMult, owns()]).toEqual([0, 1, false]);
  });

  it('death ends it at once (the offset taken back); the section going / a new build ends it too', () => {
    const a = host();
    a.sys.start();
    for (let i = 0; i < 45; i++) a.frame(); // (into the first heave)
    expect(a.player.pitch).toBeLessThan(0.1 - 0.05);
    a.player.alive = false;
    a.frame();
    expect([a.sys.active, a.sys.counts.cancelled]).toEqual([false, 1]);
    expect(a.player.pitch).toBeCloseTo(0.1, 9);
    for (const hook of ['teardown', 'build'] as const) {
      const b = host();
      b.sys.start();
      for (let i = 0; i < 45; i++) b.frame();
      for (const s of b.h.sectionHooks) s[hook]?.(undefined as never);
      expect(b.sys.active).toBe(false);
      expect(b.player.pitch).toBeCloseTo(0.1, 9);
    }
  });

  it('never an inventory change: the action holds no item / stack / slot (a real inventory stays byte-identical); the chunks are no pickups', () => {
    const inv = new Inventory();
    inv.add(inv.makeStack('water', 2));
    inv.add(inv.makeStack('beans', 1));
    const before = JSON.stringify(inv.toJSON());
    const x = host();
    Object.assign(x.h, {inv});
    x.sys.start();
    while (x.sys.active) x.frame();
    expect(JSON.stringify(inv.toJSON())).toBe(before);
    // the chunks live in their own pool under the scene (no pickup / loot / cargo system holds them)
    expect(x.scene.getObjectByName('vomit-chunks')).toBeDefined();
    expect(x.sys.chunks.live).toBeGreaterThan(0);
  });

  it('QA hooks: vomit() / vomitStart() / vomitChunks()', () => {
    const x = host();
    const api = vomitQaApi(() => x.sys);
    expect(api.vomitStart()).toBe(true);
    for (let i = 0; i < 60; i++) x.frame();
    expect(api.vomit()).toMatchObject({active: true, counts: {started: 1}});
    expect(api.vomitChunks().length).toBe(x.sys.chunks.live);
  });
});

describe('the throw-up action: Game wiring (source pins)', () => {
  const src = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/game.ts'), 'utf8');
  it('Game installs it as Game.vomit; vmBusy, E, startUse and the viewmodel holster read it', () => {
    expect(src).toMatch(/this\.vomit = this\.vomitAction = installVomit\(this\);/);
    expect(src).toMatch(/const vmBusy = !!this\.use \|\| this\.consumeView\.busy \|\| !!this\.vomit\?\.active;/);
    expect(src).toMatch(/private interact\(\): void \{\n\s+if \(this\.vomit\?\.active\) return;/);
    expect(src).toMatch(/if \(this\.vomit\?\.active\) return; \/\/ \(lane SHELVES\) no timed use starts/);
    // the holster after the consume view's own (which pushes its value every update), never touching the consume flow's state
    const cv = src.indexOf('this.consumeView.update(dt);'), vh = src.indexOf('const vomitHolster = this.vomitAction?.holster ?? 0;'), vm = src.indexOf('this.viewmodel.update(dt, {');
    expect(cv).toBeGreaterThan(0);
    expect(vh).toBeGreaterThan(cv);
    expect(vm).toBeGreaterThan(vh);
  });
});
