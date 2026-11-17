// Task studio-surface-run-field-followup-20261116-211729-01 (lane TRUCK): THE SEATED TRUCK CAB TAKES THE HITS (user: "Zombies must not
// damage the player through the seated truck cab. Their hits damage the truck instead (once per real hit); outside the truck normal
// player damage remains."):
//  - Game.hurtPlayer (one call per real hit: `out.attackHit`) and Game.blastPlayer (the Blightbelly's burst; a survivor's round through
//    gunshotPlayer) ask world/surface/truckConditionRuntime.ts shieldTruckHit FIRST: seated in the closed cab the truck's condition drops
//    by the hit's raw damage x perHitPoint / perBlastPoint, a metal impact sounds — and nothing reaches the player (HP, armour, injuries);
//  - on foot beside it, in the open car, or without a truck world: false (the player's hit as ever);
//  - repeated hits wear it down through the stages to a breakdown, and the driver still gets out.
import {readFileSync} from 'node:fs';
import {describe, expect, it} from 'vitest';
import {TRUCK_CONDITION, truckStage, truckStateOf} from '../src/world/surface/truckCondition';
import {shieldTruckHit, truckConditionOf} from '../src/world/surface/truckConditionRuntime';
import {SkywaysCar} from '../src/world/skywaysCar';
import {build, frame, press, run, teardown} from './helpers/skywaysCarHost';
import {getInTruck, setTruckLayout} from './helpers/surfaceTruckHost';
import {fieldHost} from './helpers/surfaceTruckFieldHost';

const GAME = readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');

/** The body of a Game method (from its signature to the next method at the same indent). */
function method(sig: RegExp): string {
  const m = sig.exec(GAME);
  if (!m) throw new Error(`no ${sig}`);
  const rest = GAME.slice(m.index);
  const end = rest.slice(1).search(/\n {2}(?:private |readonly |async |get )?[a-zA-Z]+\(.*\)(?::[^{]+)? \{\n/);
  return end < 0 ? rest : rest.slice(0, end + 1);
}

describe('the truck cab takes the hits: Game wiring', () => {
  it('hurtPlayer (once per real hit) and blastPlayer (blasts, survivors\' rounds) ask the cab FIRST and stop there', () => {
    // one hurtPlayer per connecting swing (the brain's attackHit), unchanged
    expect(GAME).toMatch(/if \(out\.attackHit\) this\.hurtPlayer\(z\);/);
    const hurt = method(/ {2}private hurtPlayer\(z: EnemyActor\): void \{/);
    const first = hurt.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'))[1];
    expect(first).toMatch(/if \(shieldTruckHit\(this, z\.brain\.stats\.attackDamage, z\.brain\.x, z\.brain\.z, 'claw'\)\) \{.*return; \}/);
    expect(hurt.indexOf('shieldTruckHit')).toBeLessThan(hurt.indexOf('applyPlayerHit'));
    const blast = method(/ {2}blastPlayer\(hit: PlayerHit, fromX: number, fromZ: number\): ResolvedHit \{/);
    const bfirst = blast.split('\n').filter(l => l.trim() && !l.trim().startsWith('//'))[1];
    expect(bfirst).toMatch(/if \(shieldTruckHit\(this, hit\.amount, fromX, fromZ, 'blast'\)\) \{.*return \{\.\.\.hit, applied: 0, absorbed: 0\}; \}/);
    expect(blast.indexOf('shieldTruckHit')).toBeLessThan(blast.indexOf('applyPlayerHit'));
    // a survivor's round goes through blastPlayer (the same shield)
    expect(method(/ {2}gunshotPlayer\(hit: PlayerHit, fromX: number, fromZ: number\): ResolvedHit \{/)).toMatch(/return this\.blastPlayer\(hit, fromX, fromZ\);/);
  });
});

describe('the truck cab takes the hits: the shield', () => {
  it('seated in the closed cab: each hit lands on the truck once (its raw damage x perHitPoint), a metal impact; the player untouched', () => {
    const {h, car, log} = fieldHost();
    getInTruck(h, car);
    expect(car.enclosed).toBe(true);
    const hp = h.player.hp, c0 = truckStateOf(car).condition;
    for (let i = 1; i <= 5; i++) {
      expect(shieldTruckHit(h, 10, car.body!.x + 2, car.body!.z + 1, 'claw')).toBe(true);
      expect(truckStateOf(car).condition).toBeCloseTo(c0 - i * 10 * TRUCK_CONDITION.perHitPoint, 9);
      expect(truckStateOf(car).counts.hits).toBe(i);
      expect(log.truckHits).toBe(i);
    }
    expect(h.player.hp).toBe(hp);
    // a blast / a survivor's round: perBlastPoint
    const c1 = truckStateOf(car).condition;
    expect(shieldTruckHit(h, 40, car.body!.x - 3, car.body!.z, 'blast')).toBe(true);
    expect(truckStateOf(car).condition).toBeCloseTo(c1 - 40 * TRUCK_CONDITION.perBlastPoint, 9);
    expect(truckStateOf(car).counts.blasts).toBe(1);
    expect(h.player.hp).toBe(hp);
    // garbage damage never heals it
    const c2 = truckStateOf(car).condition;
    expect(shieldTruckHit(h, -50, 0, 0, 'claw')).toBe(true);
    expect(shieldTruckHit(h, NaN, 0, 0, 'claw')).toBe(true);
    expect(truckStateOf(car).condition).toBe(c2);
  });

  it('outside the seat the hit is the player\'s: on foot beside the truck, after getting out, and in a world without the truck', () => {
    const {h, car} = fieldHost();
    const c0 = truckStateOf(car).condition;
    expect(shieldTruckHit(h, 10, car.body!.x, car.body!.z, 'claw')).toBe(false);
    getInTruck(h, car);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(shieldTruckHit(h, 10, car.body!.x, car.body!.z, 'claw')).toBe(false);
    expect(shieldTruckHit(h, 10, car.body!.x, car.body!.z, 'blast')).toBe(false);
    expect(truckStateOf(car).condition).toBe(c0);
    // the controller's other vehicle (open: never enclosed) and an unrelated game object
    teardown(h);
    setTruckLayout(h, null);
    build(h);
    expect(car.vehicle).toBe('car');
    expect(shieldTruckHit(h, 10, 0, 0, 'claw')).toBe(false);
    expect(shieldTruckHit({}, 10, 0, 0, 'claw')).toBe(false);
    expect(truckConditionOf(h)).toBeDefined();
    expect(car).toBeInstanceOf(SkywaysCar);
  });

  it('repeated hits wear it down through the stages to a breakdown; broken down and still under attack, the driver gets out', () => {
    const {h, car, sys} = fieldHost();
    getInTruck(h, car);
    const seen = new Set<string>();
    let n = 0;
    while (truckStateOf(car).condition > 0 && n < 1000) { shieldTruckHit(h, 10, car.body!.x + 2, car.body!.z, 'claw'); n++; seen.add(truckStage(truckStateOf(car).condition)); frame(h, car); }
    expect(n).toBe(Math.ceil(1 / (10 * TRUCK_CONDITION.perHitPoint) - 1e-9));
    expect([...seen]).toEqual(['sound', 'smoking', 'heavy', 'burning', 'disabled']);
    expect(sys.condition.qa().disabled).toBe(true);
    shieldTruckHit(h, 10, car.body!.x + 2, car.body!.z, 'claw');
    run(h, car, 0.2);
    press(h, car, 'KeyE');
    expect(car.driving).toBe(false);
    expect(shieldTruckHit(h, 10, car.body!.x + 2, car.body!.z, 'claw')).toBe(false); // (out: the player's again)
  });
});
