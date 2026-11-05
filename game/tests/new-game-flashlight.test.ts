// Task studio-beta-new-game-flashlight-off-20261105-022524-01 (user: "by default when starting a new game the light should not be on";
// Main: OFF only for a fresh game; Continue / saved state and travel unchanged).
//
// The fresh-game path is Game.newGame -> resetCarry -> PlayerLight.reset(undefined, {on: false}): the battery is at its 80 % start and
// switched OFF (not flat), the spot already dark before the first frame. Retry (restoreCarryFrom) / Load / Continue (installSave) reset
// to the SAVED charge with the default (on) and then write the saved on / died flags; travel resets nothing. The F toggle, brightness,
// drain and battery items are unchanged; the warm-up lights the torch itself (MOOD.flashlight), so a dark start still prepares the
// flashlight passes. (The campaign New Game -> save -> journey -> Continue flow runs in tests/campaign-journey.test.ts.)
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {BATTERY, FlashlightBattery, PlayerLight} from '../src/player/flashlight';
import {Inventory} from '../src/items/inventory';
import {Survival} from '../src/player/survival';
import {restoreCarry, takeSnapshot} from '../src/run/snapshot';

const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the battery / light reset', () => {
  it('reset(start, {on: false}): 80 % charge, switched OFF (not flat), dark output; F switches it on as usual', () => {
    const b = new FlashlightBattery(() => 0.5);
    b.reset(undefined, {on: false});
    expect([b.charge, b.on, b.died, b.output, b.emitting]).toEqual([BATTERY.start, false, false, 0, false]);
    expect(b.toggle()).toBe('on');
    expect(b.on).toBe(true);
    expect(b.output).toBeGreaterThan(0);
    expect(b.toggle()).toBe('off');
  });

  it('the default reset is unchanged (on when charged; a flat battery is off + died); off stays off through drain-free time and a battery item', () => {
    const b = new FlashlightBattery(() => 0.5);
    b.reset();
    expect([b.on, b.died]).toEqual([true, false]);
    b.reset(0);
    expect([b.on, b.died]).toEqual([false, true]);
    b.reset(0, {on: false});
    expect([b.on, b.died]).toEqual([false, true]); // flat is flat either way
    b.reset(0.5, {on: false});
    for (let i = 0; i < 600; i++) b.update(0.1); // a minute with the light off: no drain
    expect([b.charge, b.on]).toEqual([0.5, false]);
    expect(b.refill(1)).toBe(true);
    expect([b.charge, b.on]).toEqual([1, false]); // a battery item never switches a light the player has off back on
  });

  it('PlayerLight.reset(undefined, {on: false}): the spot is dark at once (no on-flash on the first frame); F lights it at full candela', () => {
    const spot = new THREE.SpotLight(0xffffff, 0);
    const pl = new PlayerLight(spot, 34, () => 0.5);
    spot.intensity = 34; // (the constructor default state: on)
    pl.reset(undefined, {on: false});
    expect([pl.battery.on, spot.intensity]).toEqual([false, 0]);
    expect(pl.toggle()).toBe('on');
    expect(spot.intensity).toBeCloseTo(34, 9);
    pl.reset(0.6); // (Retry / Load: the saved charge, default on — the saved flags follow)
    expect([pl.battery.on, spot.intensity > 0]).toEqual([true, true]);
  });
});

describe('Retry keeps the entry state (snapshot flags), on or off', () => {
  it('a level entered with the light OFF retries off; entered ON retries on (reset to the saved charge, then the flags)', () => {
    for (const on of [false, true]) {
      const light = new PlayerLight(new THREE.SpotLight(), 34, () => 0.5);
      light.reset(0.7, {on});
      const carry = {inv: new Inventory(), player: {hp: 80, stamina: 90, damageTaken: 3}, survival: new Survival(), battery: light.battery, participants: [], stats: {}};
      const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'}}, carry, {});
      expect(snap.battery).toEqual({charge: 0.7, on, died: false});
      light.battery.setOn(!on); // played on, flipped the light
      light.reset(snap.battery.charge); // Game.restoreCarryFrom
      restoreCarry(snap, {player: carry.player, survival: carry.survival, battery: light.battery, stats: {}});
      expect([light.battery.on, light.battery.charge]).toEqual([on, 0.7]);
    }
  });
});

describe('scope (game.ts): only a fresh game starts dark; nothing else resets the light; the warm-up still lights the torch', () => {
  const g = src('../src/game.ts');

  it('resetCarry resets the light OFF and is called only from newGame; Retry / Load reset to the saved charge (flags follow)', () => {
    const calls = g.match(/this\.torch\.reset\([^)]*\)/g);
    expect(calls).toEqual(['this.torch.reset(undefined, {on: false})', 'this.torch.reset(snap.battery.charge)', 'this.torch.reset(charge)']);
    expect(g.match(/this\.resetCarry\(\)/g)).toHaveLength(1);
    const newGame = g.slice(g.indexOf('  newGame(level: LevelId'), g.indexOf('  newGame(level: LevelId') + 3000);
    expect(newGame).toMatch(/this\.resetCarry\(\);/);
    expect(g).toMatch(/resetBattery: charge => this\.torch\.reset\(charge\),/); // installSave: the saved flags are written after it
  });

  it('the HUD meter and the F toggle read the same battery flag; the warm-up lights the torch at MOOD.flashlight whatever its state', () => {
    expect(g).toMatch(/get flashlightOn\(\): boolean \{ return this\.torch\.battery\.on; \}/);
    expect(g).toMatch(/battery: \{charge: this\.torch\.battery\.charge, on: this\.flashlightOn,/);
    expect(src('../src/ui/hud.ts')).toMatch(/row\.classList\.toggle\('off', !b\.on\);/);
    expect(g).toMatch(/torch: this\.flashlight, torchIntensity: MOOD\.flashlight,/);
    const w = src('../src/render/warmup.ts');
    expect(w).toMatch(/if \(torch\) \{ torch\.intensity = host\.torchIntensity; torch\.shadow\.needsUpdate = true; \}/);
    expect(w).toMatch(/if \(torch\) \{ torch\.intensity = torchIntensity; torch\.shadow\.needsUpdate = torchNeeds; \}/); // restored after
  });

  it('no train / fixture / menu light or quality code changed (the player light only)', () => {
    for (const f of ['../src/world/playerTrain.ts', '../src/world/trainRide.ts', '../src/world/menuScene.ts', '../src/world/lights.ts']) expect(src(f)).not.toMatch(/new-game-flashlight-off/);
  });
});
