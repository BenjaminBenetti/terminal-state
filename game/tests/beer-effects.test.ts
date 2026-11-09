// Task studio-market-bar-20261108-225231-01 (lane BEER): THE BEER EFFECTS (market/beer/beerEffects.ts, Game.beerEffects) — the consume commit
// (the REAL Game.startUse / completeUse / cancelUse on a minimal shell, as tests/consumable-return.test.ts drives them), the one timed slot
// (a second timed beer — another or the same — calls Game.vomit.start() and REPLACES the buff; the Bock coexists without a vomit), the
// timer (active play only; exact across save / load / Continue / Retry / import / export), the Lager's single x1.25 movement multiplier,
// the Stout's temporary armour in the one pool (worn vs naked wear), the Porter's single detection factor.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it, vi} from 'vitest';
import {Inventory, type ItemStack, type SlotRef} from '../src/items/inventory';
import {WeaponController} from '../src/weapons/weapons';
import {starterInventory} from '../src/run/starter';
import {Survival} from '../src/player/survival';
import {FlashlightBattery} from '../src/player/flashlight';
import {BEERS, BEER_IDS, BEER_TUNING, type BeerId} from '../src/items/beers';
import {BeerEffects, type BeerHost} from '../src/market/beer/beerEffects';
import {BEER_PARTICIPANT, beerSaveProblem} from '../src/market/beer/beerSave';
import {combineModifiers, type ModifierSource} from '../src/player/modifiers';
import {armorHit, armorPool, ARMOR, ARMOR_WEAR_PER_HIT, tempHalfPips} from '../src/player/armor';
import {ZombieBrain, alertListeners, type BrainWorld} from '../src/ai/brain';
import {restoreParticipants} from '../src/run/snapshot';
import {makeSaveFile, restoreRun, saveFileText, type SaveFileV1Like} from '../src/save/serialize';
import {validateSaveFile} from '../src/save/validate';
import {Harness} from './helpers/saveFixture';

const H = (index: number): SlotRef => ({bar: 'hotbar', index});
const src = (rel: string) => readFileSync(fileURLToPath(new URL(`../src/${rel}`, import.meta.url)), 'utf8');

const {Game} = await import('../src/game');

/** A plain beer host (Node): the real Survival / Inventory, a vomit spy, the registries. */
type TestHost = Omit<BeerHost, 'survival' | 'inv'> & {survival: Survival; inv: Inventory; toasts: string[]; vomit: {active: boolean; start: ReturnType<typeof vi.fn>}};
function host(o: Partial<Omit<TestHost, 'toasts'>> = {}): TestHost {
  const toasts: string[] = [];
  return {
    survival: new Survival(), inv: new Inventory(), player: {x: 0, y: 0, z: 0, yaw: 0}, state: 'playing',
    hud: {toast: (t: string) => { toasts.push(t); }}, vomit: {active: false, start: vi.fn(() => true)},
    run: {current: {level: 'market', section: 'main', station: 'st-07'}, seeds: {subway: 11}},
    frameHooks: [], runParticipants: [], modifierSources: [], toasts, ...o,
  } as never;
}

type Shell = {
  inv: Inventory; use: {t: number; total: number} | null; toasts: string[]; survival: Survival; beerEffects: BeerEffects; input: {mouse: boolean[]};
  slotKeys(i: {hit(c: string): boolean; wheel: number}): void; startUse(r: SlotRef): void; completeUse(): void; cancelUse(reason: string): void; syncHeld(): void;
};

/** The REAL Game consume methods on a minimal shell (tests/consumable-return.test.ts's shell) with a real BeerEffects as Game.beerEffects. */
function shell(): {g: Shell; beer: BeerEffects; h: ReturnType<typeof host>} {
  const views: string[] = [], toasts: string[] = [];
  const s = {
    inv: starterInventory('pistol'), weapon: new WeaponController(), input: {mouse: [false, false, false]}, lmbLatch: false, use: null, consumeReturn: null, toasts, views, state: 'playing',
    survival: new Survival(), torch: {battery: new FlashlightBattery(() => 0.5)}, mods: {handlingMult: 1},
    player: {hp: 50, maxHp: 100, heal(n: number) { const k = Math.min(n, this.maxHp - this.hp); this.hp += k; return k; }},
    stats: {itemsUsed: 0, healed: 0}, gasMask: {transitioning: false}, flareHold: {active: false}, gear: null, invUI: {selected: null as SlotRef | null},
    injuries: {refuseReason: () => null, healNote: () => '', completeTreatment: () => null},
    consumeView: {start: (id: string, _t: number, mode: string) => views.push(`start:${id}:${mode}`), complete: (keep: boolean) => views.push(`complete:${keep}`), cancel: (r: string) => views.push(`cancel:${r}`)},
    sfx: {equip() {}, denied() {}, heal() {}, eat() {}, drink() {}, batteryInsert() {}},
    viewmodel: {setItem: (_id: string | null) => {}},
    hud: {toast: (t: string) => { toasts.push(t); }},
  };
  Object.setPrototypeOf(s, Game.prototype);
  const g = s as unknown as Shell;
  g.survival.hunger = 40;
  g.survival.thirst = 40;
  const h = host({survival: g.survival, inv: g.inv, hud: (s as {hud: BeerHost['hud']}).hud});
  const beer = new BeerEffects(h).install();
  g.beerEffects = beer;
  g.syncHeld();
  return {g, beer, h};
}
const press = (g: Shell, code: string) => g.slotKeys({hit: c => c === code, wheel: 0});
function consumeHeld(g: Shell): void {
  g.startUse(g.inv.selectedRef());
  expect(g.use).not.toBeNull();
  g.use!.t = g.use!.total;
  g.completeUse();
}
const give = (g: Shell, id: string, n: number, slot = 2): ItemStack => { const st = g.inv.makeStack(id, n); g.inv.set(H(slot), st); press(g, `Digit${slot + 1}`); return st; };

describe('the consume commit: a beer applies ONCE, after its unit was consumed; a cancel / a missing source applies nothing', () => {
  it('Express Line Lager: one unit gone, the slot filled (600 s), the toast names the effect; food / water untouched', () => {
    const {g, beer} = shell();
    const st = give(g, 'beer_lager', 2);
    consumeHeld(g);
    expect(st.count).toBe(1);
    expect(beer.active).toEqual({itemId: 'beer_lager', effect: 'speed', remaining: BEER_TUNING.activeSeconds});
    expect(g.toasts.at(-1)).toBe('Drank Express Line Lager: +25 % ground speed for 10 min');
    expect([g.survival.hunger, g.survival.thirst]).toEqual([40, 40]);
    g.completeUse(); // a second completion of the same use: nothing (the use is over)
    expect([beer.counts.drinks, st.count]).toEqual([1, 1]);
  });

  it('a cancelled use (sprint / slot switch) and a use whose stack vanished commit nothing — no unit, no buff', () => {
    const {g, beer} = shell();
    const st = give(g, 'beer_porter', 2);
    g.startUse(g.inv.selectedRef());
    g.cancelUse('sprint');
    expect([st.count, beer.active, beer.counts.drinks]).toEqual([2, null, 0]);
    g.startUse(g.inv.selectedRef());
    g.inv.set(H(2), null); // the source is gone before the use completes (dropped / moved)
    g.use!.t = g.use!.total;
    g.completeUse();
    expect([beer.active, beer.counts.drinks]).toEqual([null, 0]);
  });

  it('the commit is the only caller: purchase / equip / hover never drink (one drink?.( call in the source, in completeUse)', () => {
    const calls = src('game.ts').match(/beerEffects\?\.drink\?\.\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(src('game.ts')).toMatch(/private completeUse\(\): void \{[\s\S]*?isBeer\(def\.id\) \? this\.beerEffects\?\.drink\?\.\(def\.id\) : undefined[\s\S]*?private consumeReturnTarget/);
  });

  it('the last bottle of a stack drunk from a switch still returns to the gun (the consume flow is unchanged)', () => {
    const {g} = shell();
    const pistol = g.inv.get(H(0))!;
    give(g, 'beer_stout', 1);
    consumeHeld(g);
    expect(g.inv.selectedStack()?.uid).toBe(pistol.uid);
  });
});

describe('the ONE timed slot: a second timed beer throws up and REPLACES; the Bock coexists', () => {
  it('a different timed beer: vomit.start() once, the new buff with a fresh 600 s; the old effect is gone', () => {
    const h = host(), beer = new BeerEffects(h).install();
    beer.drink('beer_lager');
    beer.tick(250);
    expect(beer.speedMult()).toBe(1.25);
    const text = beer.drink('beer_stout');
    expect(h.vomit.start).toHaveBeenCalledTimes(1);
    expect(beer.active).toEqual({itemId: 'beer_stout', effect: 'armor', remaining: 600});
    expect([beer.speedMult(), beer.tempArmor()]).toEqual([1, 0.125]);
    expect(text).toBe('You threw up — Ironclad Stout replaces Express Line Lager: +5 armour pips for 10 min');
  });

  it('the SAME timed beer again: vomits too, and restarts at a fresh 600 s (never stacks)', () => {
    const h = host(), beer = new BeerEffects(h).install();
    beer.drink('beer_porter');
    beer.tick(400);
    beer.drink('beer_porter');
    expect(h.vomit.start).toHaveBeenCalledTimes(1);
    expect(beer.active!.remaining).toBe(600);
    expect(beer.perceptionMult()).toBe(0.75);
    expect([beer.counts.replaced, beer.counts.vomits]).toEqual([1, 1]);
  });

  it('without a vomit action (or one that cannot start now) the buff is still replaced', () => {
    const h = host({vomit: null as never}), beer = new BeerEffects(h).install();
    beer.drink('beer_lager');
    beer.drink('beer_pilsner');
    expect(beer.active!.itemId).toBe('beer_pilsner');
    const h2 = host(), b2 = new BeerEffects(h2).install();
    h2.vomit.start.mockReturnValue(false);
    b2.drink('beer_lager');
    b2.drink('beer_lager');
    expect([b2.active!.remaining, b2.counts.vomits, b2.counts.replaced]).toEqual([600, 0, 1]);
  });

  it('Second Supper Bock: SETS food and water to 200, never occupies or replaces the slot, never a vomit', () => {
    const h = host(), beer = new BeerEffects(h).install();
    beer.drink('beer_lager');
    beer.tick(100);
    h.survival.hunger = 12; h.survival.thirst = 150;
    expect(beer.drink('beer_bock')).toBe('Drank Second Supper Bock: food and water 200 %');
    expect([h.survival.hunger, h.survival.thirst]).toEqual([200, 200]);
    expect(beer.active).toEqual({itemId: 'beer_lager', effect: 'speed', remaining: 500});
    expect(h.vomit.start).not.toHaveBeenCalled();
    const h2 = host(), b2 = new BeerEffects(h2).install();
    b2.drink('beer_bock');
    expect(b2.active).toBeNull();
    b2.drink('beer_bock'); // a second Bock: still no slot, no vomit
    expect([b2.active, h2.vomit.start.mock.calls.length]).toEqual([null, 0]);
  });
});

describe('the timer: ACTIVE play only; exact across save / load / Continue / Retry / import / export', () => {
  it('the frame hook ticks only while playing; pauses / menus / death do not; it wears off at 0 with a toast', () => {
    const h = host(), beer = new BeerEffects(h).install();
    beer.drink('beer_pilsner');
    const hook = h.frameHooks[0];
    for (const state of ['paused', 'inventory', 'dead', 'title', 'loading']) { h.state = state; hook(50); }
    expect(beer.active!.remaining).toBe(600);
    h.state = 'playing';
    hook(599.5);
    expect(beer.active!.remaining).toBeCloseTo(0.5, 9);
    hook(0.5);
    expect(beer.active).toBeNull();
    expect(h.toasts.at(-1)).toBe('Lucky Switch Pilsner wore off');
    expect(beer.counts.expired).toBe(1);
    expect(src('game.ts')).toMatch(/if \(playing\) this\.update\(dt\);/); // (the frame hooks run inside update: live play only)
  });

  it('save -> validate -> import / export -> Continue restores the exact seconds left; the Retry snapshot restores level entry', () => {
    const h = new Harness(), bh = host({survival: h.survival, inv: h.inv}), beer = new BeerEffects(bh).install();
    h.participants.push(...bh.runParticipants!);
    beer.drink('beer_stout');
    beer.tick(123.456789);
    h.takeEntry(); // entered the station: 476.543211 s left
    beer.tick(100.25);
    const file = h.file('arrival');
    const text = saveFileText(file); // export -> import
    const v = validateSaveFile(JSON.parse(text));
    expect(v.ok).toBe(true);
    const h2 = new Harness(), bh2 = host({survival: h2.survival, inv: h2.inv}), beer2 = new BeerEffects(bh2).install();
    h2.participants.push(...bh2.runParticipants!);
    beer2.drink('beer_lager'); // whatever the live state was before the load
    if (v.ok) restoreRun(v.value.run, h2.target());
    expect(beer2.active).toEqual({itemId: 'beer_stout', effect: 'armor', remaining: 600 - 123.456789 - 100.25});
    // Retry: the participants as at level entry
    restoreParticipants(h.run.entry!, h.participants);
    expect(beer.active!.remaining).toBe(600 - 123.456789);
    // a pending journey (departure save) carries it the same way; NewGame resets it
    expect(beerSaveProblem(beer.save())).toBeNull();
    for (const p of h.participants) if (p.id === BEER_PARTICIPANT) p.reset();
    expect(beer.active).toBeNull();
  });

  it('an older save without the record loads with no beer; a malformed record is refused by validation', () => {
    const h = new Harness(), bh = host({survival: h.survival, inv: h.inv}), beer = new BeerEffects(bh).install();
    const file = h.file('arrival'); // no 'market.beer' participant yet (an older save)
    h.participants.push(...bh.runParticipants!);
    beer.drink('beer_porter');
    const v = validateSaveFile(file);
    expect(v.ok).toBe(true);
    if (v.ok) restoreRun(v.value.run, h.target());
    expect(beer.active).toBeNull();
    const bad = (rec: unknown) => {
      const f = structuredClone(file) as {run: {participants: Record<string, unknown>}};
      f.run.participants[BEER_PARTICIPANT] = rec;
      return validateSaveFile(JSON.parse(saveFileText(remake(f))));
    };
    expect(bad({v: 1, active: {itemId: 'beer_lager', remaining: 12.5}, rolled: [1, 2]}).ok).toBe(true);
    for (const rec of [
      {v: 1, active: {itemId: 'beer_lager', remaining: 600.001}, rolled: []},
      {v: 1, active: {itemId: 'beer_lager', remaining: 0}, rolled: []},
      {v: 1, active: {itemId: 'beer_bock', remaining: 10}, rolled: []}, // the instant beer is never the timed one
      {v: 1, active: {itemId: 'water', remaining: 10}, rolled: []},
      {v: 1, active: null, rolled: [1.5]},
      {v: 1, active: null, rolled: [7, 7]},
      {v: 1, active: null, rolled: Array.from({length: 1025}, (_, i) => i)},
      {v: 2, active: null, rolled: []},
      {v: 1, active: null, rolled: [], extra: 1},
    ]) expect(bad(rec).ok, JSON.stringify(rec).slice(0, 80)).toBe(false);
  });

  it('buying / carrying more bottles never touches the running buff', () => {
    const h = host(), beer = new BeerEffects(h).install();
    beer.drink('beer_lager');
    beer.tick(30);
    h.inv.add(h.inv.makeStack('beer_lager', 6));
    h.inv.add(h.inv.makeStack('beer_stout', 6));
    expect(beer.active!.remaining).toBe(570);
  });
});

/** Re-checksum a mutated file (save/serialize makeSaveFile over the run). */
const remake = (f: {run: unknown}): SaveFileV1Like => makeSaveFile(f.run as never, (f as unknown as {meta: unknown}).meta as never);

describe('Express Line Lager: ONE x1.25 on the player\'s ground movement (walk / sprint / crouch / aim together)', () => {
  it('one ModifierSource multiplied once with gear / injuries; a second drink never doubles it; a grabbed fuel cart keeps its pace', () => {
    const h = host(), beer = new BeerEffects(h).install();
    const gear: ModifierSource = () => ({speedMult: 0.9}), injury: ModifierSource = () => ({speedMult: 0.8});
    const sources = [gear, injury, ...h.modifierSources!] as ModifierSource[];
    expect(combineModifiers(sources).speedMult).toBeCloseTo(0.72, 12);
    beer.drink('beer_lager');
    expect(combineModifiers(sources).speedMult).toBeCloseTo(0.72 * 1.25, 12);
    beer.drink('beer_lager'); // replaced (fresh 600 s), never stacked
    expect(combineModifiers(sources).speedMult).toBeCloseTo(0.72 * 1.25, 12);
    expect(h.modifierSources!.length).toBe(1);
    (h as {fuelCarts?: unknown}).fuelCarts = {grab: {}};
    expect(combineModifiers(sources).speedMult).toBeCloseTo(0.72, 12);
    (h as {fuelCarts?: unknown}).fuelCarts = {grab: null};
    beer.tick(600);
    expect(combineModifiers(sources).speedMult).toBeCloseTo(0.72, 12);
  });

  it('the player step scales walk / sprint / crouch / aim by one multiplier; stamina never reads it; vehicles / AI never get it', () => {
    const player = src('player/player.ts');
    expect(player).toMatch(/const max = \(this\.sprinting \? SPRINT_SPEED : opts\.aiming \? AIM_SPEED : WALK_SPEED\) \* \(this\.crouched \? CROUCH_SPEED_MULT : 1\) \* opts\.speedMult;/);
    expect((player.match(/opts\.speedMult/g) ?? []).length).toBe(1);
    expect(player).not.toMatch(/stamina[^\n]*speedMult/);
    const game = src('game.ts');
    expect(game).toMatch(/const moveOpts = \{aiming: this\.aiming, speedMult: \(this\.use \? 0\.6 : wdef\?\.moveMult \?\? 1\) \* this\.mods\.speedMult,/);
    expect(game).toMatch(/this\.skywaysCar\.driving \? this\.skywaysCar\.stepPlayer\(dt, inp\)/); // the car never takes the walking modifiers
    expect(game).not.toMatch(/beerEffects\?\.speedMult/); // only through the one ModifierSource
    for (const f of ['ai/brain.ts', 'ai/motor.ts', 'world/fuelCarts.ts', 'world/trainRide.ts']) expect(src(f)).not.toMatch(/speedMult\(\)|beerEffects/);
  });
});

describe('Ironclad Stout: +5 temporary pips (0.125) in the ONE enemy-only pool; never an item\'s armour; never worn down', () => {
  type HitShell = {inv: Inventory; player: {takeDamage(n: number): void; taken: number}; hitListeners: unknown[]; wearRand: () => number; beerEffects?: BeerEffects;
    applyPlayerHit(h: {amount: number; source: string; location: string; enemy?: boolean}): {applied: number; absorbed: number; armor: number}};
  function hitShell(): {g: HitShell; beer: BeerEffects} {
    const inv = new Inventory();
    const s = {inv, player: {taken: 0, takeDamage(n: number) { this.taken += n; }}, hitListeners: [], wearRand: () => 0};
    Object.setPrototypeOf(s, Game.prototype);
    const g = s as unknown as HitShell;
    const beer = new BeerEffects(host({inv})).install();
    g.beerEffects = beer;
    return {g, beer};
  }

  it('naked: the enemy hit (x2 first) loses 12.5 %, the injury save sees 0.125; no item gains an armour value; a fall meets none', () => {
    const {g, beer} = hitShell();
    beer.drink('beer_stout');
    const r = g.applyPlayerHit({amount: 10, source: 'zombie', location: 'torso'});
    expect([r.applied, r.absorbed, r.armor]).toEqual([17.5, 2.5, 0.125]);
    expect(g.inv.allStacks(true).some(s => s.armor !== undefined)).toBe(false);
    const fall = g.applyPlayerHit({amount: 10, source: 'other', location: 'leg', enemy: false});
    expect([fall.applied, fall.armor]).toEqual([10, 0]);
  });

  it('worn gear: the pool is worn + 0.125; a mitigating hit wears ONE worn item by .00625 (never the beer); it expires cleanly', () => {
    const {g, beer} = hitShell();
    const vest = g.inv.makeStack('armor_vest', 1);
    g.inv.add(vest);
    beer.drink('beer_stout');
    const r = g.applyPlayerHit({amount: 10, source: 'zombie', location: 'torso'});
    expect(r.armor).toBeCloseTo(0.1 + 0.125, 12);
    expect(r.applied).toBeCloseTo(20 * (1 - 0.225), 12);
    expect(vest.armor).toBeCloseTo(0.1 - ARMOR_WEAR_PER_HIT, 12);
    for (let i = 0; i < 4; i++) g.applyPlayerHit({amount: 10, source: 'zombie', location: 'torso'});
    expect(beer.tempArmor()).toBe(0.125); // the beer itself never degrades per hit
    beer.tick(600);
    expect(armorPool(g.inv.gear, beer.tempArmor())).toBeCloseTo(0.1 - 5 * ARMOR_WEAR_PER_HIT, 12);
  });

  it('one cap for the pool; the HUD share and its half pips', () => {
    const worn = {chest: {uid: 1, itemId: 'armor_vest', count: 1, armor: 0.1}};
    expect(armorPool(worn, 0.125)).toBeCloseTo(0.225, 12);
    expect(armorPool(worn, 5)).toBe(ARMOR.cap);
    const {resolved} = armorHit({amount: 40, source: 'zombie', location: 'torso'}, {}, () => 0, ARMOR_WEAR_PER_HIT, 0.125);
    expect([resolved.applied, resolved.armor]).toEqual([35, 0.125]);
    expect(tempHalfPips(0.225, 0.125)).toBe(10); // 5 pips = 10 half pips on top of the vest's 8
    expect(tempHalfPips(0.8, 0.05)).toBe(4); // capped: only its share shows
    expect(src('game.ts')).toMatch(/armorHit\(hit, this\.inv\.gear, this\.wearRand, undefined, this\.beerEffects\?\.tempArmor\(\) \?\? 0\)/);
    expect(src('game.ts')).toMatch(/armorTemp: this\.beerEffects\?\.tempArmor\(\) \?\? 0,/);
  });
});

describe('Night Shift Porter: ONE detectability factor 0.75 (unaware sight / notice, the player\'s noise) — never compounded, aggro kept', () => {
  const world = (o: Partial<BrainWorld> = {}): BrainWorld => ({px: 0, pz: 15, playerAlive: true, los: () => true, walkClear: () => true, findPath: () => null,
    randomNear: () => null, rand: () => 0.5, ...o});
  const sees = (b: ZombieBrain, w: BrainWorld) => (b as unknown as {sees(w: BrainWorld, dt: number): boolean}).sees(w, 0.016);

  it('an unaware zombie notices at sightRange x 0.75 (exactly one factor), the all-round 5 m at 3.75 m; an aware one keeps its sight', () => {
    const b = new ZombieBrain('shambler', 0, 0, 0); // sight 18 m, facing +Z
    const R = b.stats.sightRange * 0.75;
    expect(sees(b, world({pz: R - 0.01, detect: 0.75}))).toBe(true);
    expect(sees(b, world({pz: R + 0.01, detect: 0.75}))).toBe(false); // (0.75^2 would stop at 10.1 m: one factor only)
    expect(sees(b, world({pz: R + 0.01}))).toBe(true); // no beer: the established 18 m
    expect(sees(b, world({pz: -4.5}))).toBe(true); // behind, 4.5 m: within the all-round 5 m
    expect(sees(b, world({pz: -4.5, detect: 0.75}))).toBe(false); // ... not within 3.75 m
    b.aware = true; // already hunting: the Porter never blinds it
    expect(sees(b, world({pz: 17, detect: 0.75}))).toBe(true);
  });

  it('gunfire: the noise radius x 0.75 once (a listener at 25 m of a 30 m shot no longer hears it); 1 = the established loop', () => {
    const mk = () => new ZombieBrain('shambler', 0, 25, 0);
    const a = mk(), b = mk();
    alertListeners([a], {x: 0, y: 0, z: 0}, 30, () => true, null, false);
    alertListeners([b], {x: 0, y: 0, z: 0}, 30, () => true, null, false, 0.75);
    expect([a.state, b.state]).toEqual(['chase', 'idle']);
    const c = mk();
    alertListeners([c], {x: 0, y: 0, z: 0}, 34, () => true, null, false, 0.75); // 25.5 m: heard
    expect(c.state).toBe('chase');
  });

  it('the game passes the beer\'s one factor to the brains and the noise loop; the market\'s people read perceptionMult()', () => {
    const game = src('game.ts');
    expect(game).toMatch(/detect: this\.beerEffects\?\.perceptionMult\(\) \?\? 1,/);
    expect(game).toMatch(/this\.beerEffects\?\.perceptionMult\(\) \?\? 1\); \/\/ \(task studio-market-bar-20261108-225231-01, lane BEER\) the player's one detectability factor/);
    const h = host(), beer = new BeerEffects(h).install();
    expect(beer.perceptionMult()).toBe(1);
    beer.drink('beer_porter');
    expect(beer.perceptionMult()).toBe(0.75);
    expect(src('market/combat/marketCombat.ts')).not.toMatch(/beerEffects/); // (the PEOPLE lane wires market/combat, not this lane)
  });
});

describe('the beers\' numbers are the user\'s', () => {
  it('600 s, x1.25, 10 %, 0.125 (= 5 pips), x0.75, 200; four timed beers and one instant', () => {
    expect(BEER_TUNING).toEqual({activeSeconds: 600, speedMult: 1.25, pickupDupChance: 0.1, tempArmor: 0.125, perceptionMult: 0.75, overfill: 200});
    expect(BEER_TUNING.tempArmor / ARMOR.pip).toBe(5);
    expect(BEER_IDS.filter(id => BEERS[id].effect !== 'overfill').length).toBe(4);
    expect(BEER_IDS.map(id => BEERS[id].name)).toEqual(['Express Line Lager', 'Lucky Switch Pilsner', 'Ironclad Stout', 'Night Shift Porter', 'Second Supper Bock']);
    const ids: BeerId[] = ['beer_lager', 'beer_pilsner', 'beer_stout', 'beer_porter'];
    for (const id of ids) {
      const h = host(), beer = new BeerEffects(h).install();
      beer.drink(id);
      expect(beer.active!.effect).toBe(BEERS[id].effect);
    }
  });
});
