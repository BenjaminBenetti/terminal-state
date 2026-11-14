// Task studio-refinement-batch-20261113-035659-01: the crafted throwables — the Acid Scrapper grenade and the Zombie Lure grenade.
// Node tests over the real modules: the items (items/grenades.ts: ids, kind, stack, dims = the cooked models' bounds, icons, the model
// urls), the bench recipes (craft/recipes.ts MADE_RECIPES: 3 bio mater -> 5 acid / 3 lure, 10 scrap -> the train armor) and their
// atomic transaction (craft/crafting.ts craftMade: room counted first, the batch into the pockets then the Lockbox, an upgrade
// installed, everything refunded exactly on a failed last step), and the canisters in a real station's physics world
// (weapons/grenades.ts GrenadeSystem: one item per throw, the caps, acid: zombie hit / stick to a meltable prop / burst on landing ->
// the pool on the floor that burns zombies AND the player for exactly 10 ACTIVE seconds and exposes the props it touches; lure: at rest
// it opens ONE scent emitter at the canister for 20 active seconds, then it is spent and removed).
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as THREE from 'three';
import {describe, expect, it, vi} from 'vitest';
import {GRENADE_MODELS} from '../src/assets/grenades.generated';
import {BENCH_RECIPES, MADE_RECIPES, RECIPES, RECIPE_MATERIALS, benchRecipeFor, isMadeRecipe} from '../src/craft/recipes';
import {MADE_TEXT, carriedRoom, craftMade, craftSources, lockboxRoom, madeBlock, type MadeUpgradesTarget} from '../src/craft/crafting';
import {BIO_MATER, ELECTRICAL_PARTS, SCRAP_METAL} from '../src/items/craftMaterials';
import {ACID_GRENADE, GRENADE_IDS, LURE_GRENADE, grenadeKind, isGrenadeItem} from '../src/items/grenades';
import {Inventory, PACK_SIZE, THROW_REF} from '../src/items/inventory';
import {ITEMS, ITEM_DIMS, itemDef} from '../src/items/items';
import {econCat} from '../src/items/lootTables';
import {ICONS} from '../src/ui/icons';
import {GRENADE_MODEL_URLS, grenadeModel, grenadeModelSource} from '../src/world/grenadeModels';
import {ACID, GRENADE, GrenadeSystem, LURE, inPool, poolReach, poolStrength, throwHoldTarget, throwOneGrenade, type AcidMeltLike, type GrenadeEnemy, type MeltRefLike} from '../src/weapons/grenades';
import {PhysicsSystem} from '../src/physics/world';
import {levelsOf} from '../src/gen/levels';
import {mulberry32} from '../src/core/rng';
import {TrainLockbox} from '../src/run/trainLockbox';
import {SCENT, ScentLures} from '../src/ai/scentLure';
import {FlareHold, type FlareHoldInput} from '../src/weapons/flareHold';
import {FlareSystem, throwOneFlare} from '../src/weapons/throwables';
import {LightSources} from '../src/world/lightSources';
import {FIX, levelFixture} from './helpers/levelFixture';

const DT = 1 / 60;

describe('the crafted throwables: items', () => {
  it('two throwables for the grenade slot, stacking to 5, sized by their cooked models, with icons and their delivered GLBs', () => {
    expect([...GRENADE_IDS]).toEqual([ACID_GRENADE, LURE_GRENADE]);
    expect([itemDef(ACID_GRENADE).name, itemDef(LURE_GRENADE).name]).toEqual(['Acid Scrapper grenade', 'Zombie Lure grenade']);
    for (const id of GRENADE_IDS) {
      const d = ITEMS[id];
      expect(d).toMatchObject({id, kind: 'throwable', stackMax: 5});
      expect(isGrenadeItem(id)).toBe(true);
      expect(ICONS[d.icon]).toMatch(/^<svg/);
      const g = GRENADE_MODELS[grenadeKind(id)];
      expect(GRENADE_MODEL_URLS[id]).toBe(g.url);
      expect(ITEM_DIMS[id]).toEqual({w: g.dims[0], h: g.dims[1], d: g.dims[2], shape: 'cylinder'});
      expect(d.description).toMatch(/hold G/);
    }
    expect(isGrenadeItem('flare')).toBe(false);
    // never loot: no economy category, in no loot table / pool (they only come from the bench)
    const tables = readFileSync(fileURLToPath(new URL('../src/items/lootTables.ts', import.meta.url)), 'utf8');
    for (const id of GRENADE_IDS) { expect(econCat(id)).toBeNull(); expect(tables).not.toContain(id); }
    expect(itemDef(ACID_GRENADE).description).toMatch(/10 seconds/);
    expect(itemDef(ACID_GRENADE).description).toMatch(/you too/);
    expect(itemDef(LURE_GRENADE).description).toMatch(/20 seconds.*30 m/); // (the reach: SCENT.radius, 30 m since the console refinements)
    // Node: the labelled fallback (no browser fetch), never claimed as the Meshy model
    expect(grenadeModelSource(ACID_GRENADE)).toMatch(/^FALLBACK/);
    expect(grenadeModel(ACID_GRENADE).userData.fallback).toBe(true);
  });
});

describe('the bench recipes: the made outputs', () => {
  it('3 bio mater -> 5 acid / 3 lure grenades, 10 scrap -> the train armor; listed after the four units', () => {
    expect([...RECIPE_MATERIALS]).toEqual([SCRAP_METAL, ELECTRICAL_PARTS, BIO_MATER]);
    expect(MADE_RECIPES.map(r => [r.kind, r.make, r.cost[SCRAP_METAL], r.cost[ELECTRICAL_PARTS], r.cost[BIO_MATER]])).toEqual([
      [ACID_GRENADE, {type: 'item', itemId: ACID_GRENADE, count: 5}, 0, 0, 3],
      [LURE_GRENADE, {type: 'item', itemId: LURE_GRENADE, count: 3}, 0, 0, 3],
      ['armor', {type: 'upgrade', id: 'armor'}, 10, 0, 0],
    ]);
    expect(BENCH_RECIPES.map(r => r.kind)).toEqual(['chest', 'radar', 'sentry', 'scanner', ACID_GRENADE, LURE_GRENADE, 'armor']);
    expect(BENCH_RECIPES.slice(0, 4)).toEqual([...RECIPES]); // the units: unchanged, first
    for (const r of RECIPES) expect(r.cost[BIO_MATER]).toBe(0);
    for (const r of BENCH_RECIPES) { expect(benchRecipeFor(r.kind)).toBe(r); expect(r.blurb.length).toBeGreaterThan(40); }
    expect(MADE_RECIPES.every(isMadeRecipe) && !RECIPES.some(isMadeRecipe)).toBe(true);
  });
});

function stocked(bio: number, scrap = 0) {
  const inv = new Inventory();
  const box = new TrainLockbox();
  if (bio) inv.add(inv.makeStack(BIO_MATER, bio));
  if (scrap) inv.add(inv.makeStack(SCRAP_METAL, scrap));
  return {inv, box, sources: () => craftSources({inv, lockbox: box})};
}
const snap = (inv: Inventory, box: TrainLockbox) => JSON.stringify({inv: inv.toJSON(), box: box.slots.map(s => (s ? [s.uid, s.itemId, s.count] : null))});

describe('craftMade: the atomic transaction of a made recipe', () => {
  const acid = benchRecipeFor(ACID_GRENADE)!, lure = benchRecipeFor(LURE_GRENADE)!, armor = benchRecipeFor('armor')!;
  if (!isMadeRecipe(acid) || !isMadeRecipe(lure) || !isMadeRecipe(armor)) throw new Error('made recipes');

  it('5 acid grenades into the empty grenade slot for exactly 3 bio mater; then 3 lures next to them', () => {
    const w = stocked(7);
    const r = craftMade(acid, {sources: w.sources(), items: {inv: w.inv, lockbox: w.box}});
    expect(r).toMatchObject({ok: true, made: {type: 'item', itemId: ACID_GRENADE, count: 5}, carried: 5, lockbox: 0});
    expect(w.inv.count(BIO_MATER)).toBe(4);
    expect(w.inv.thrown).toMatchObject({itemId: ACID_GRENADE, count: 5});
    const r2 = craftMade(lure, {sources: w.sources(), items: {inv: w.inv, lockbox: w.box}});
    expect(r2).toMatchObject({ok: true, carried: 3, lockbox: 0});
    expect([w.inv.count(BIO_MATER), w.inv.count(LURE_GRENADE), w.inv.count(ACID_GRENADE)]).toEqual([1, 3, 5]);
    // not enough bio mater: refused, nothing changes
    const before = snap(w.inv, w.box);
    expect(craftMade(acid, {sources: w.sources(), items: {inv: w.inv, lockbox: w.box}})).toMatchObject({ok: false, reason: 'missing', text: 'Need 2 more Bio mater'});
    expect(snap(w.inv, w.box)).toBe(before);
    expect(w.inv.invariants()).toEqual([]);
  });

  it('pockets full: the rest goes into the Lockbox; no room anywhere: refused BEFORE anything is spent', () => {
    const w = stocked(0);
    const box = w.box;
    box.slots[0] = w.inv.makeStack(BIO_MATER, 3); // paid from the Lockbox
    for (let i = 0; i < 5; i++) w.inv.set({bar: 'hotbar', index: i}, w.inv.makeStack('bandage', 5));
    for (let i = 0; i < PACK_SIZE; i++) w.inv.set({bar: 'pack', index: i}, w.inv.makeStack('water', 2));
    w.inv.set(THROW_REF, w.inv.makeStack(ACID_GRENADE, 3)); // room for 2 more in the grenade slot
    expect(carriedRoom(w.inv, ACID_GRENADE)).toBe(2);
    const r = craftMade(acid, {sources: w.sources(), items: {inv: w.inv, lockbox: box}});
    expect(r).toMatchObject({ok: true, carried: 2, lockbox: 3});
    expect(w.inv.thrown!.count).toBe(5);
    expect(box.slots.filter(Boolean).map(s => [s!.itemId, s!.count])).toEqual([[ACID_GRENADE, 3]]); // (the bio mater's slot was freed and reused)
    // the Lockbox full too: madeBlock refuses with the room text, the materials stay
    box.slots[1] = w.inv.makeStack(BIO_MATER, 3);
    for (let i = 2; i < box.slots.length; i++) box.slots[i] = w.inv.makeStack('water', 2);
    box.slots[0]!.count = 5;
    expect(lockboxRoom(box, ACID_GRENADE) + carriedRoom(w.inv, ACID_GRENADE)).toBe(0);
    const before = snap(w.inv, box);
    expect(madeBlock(acid, {items: {inv: w.inv, lockbox: box}})).toBe(MADE_TEXT.noRoom(5, 'Acid Scrapper grenade'));
    expect(craftMade(acid, {sources: w.sources(), items: {inv: w.inv, lockbox: box}})).toMatchObject({ok: false, reason: 'blocked'});
    expect(snap(w.inv, box)).toBe(before);
    expect(craftMade(acid, {sources: w.sources(), items: null})).toEqual({ok: false, reason: 'blocked', text: MADE_TEXT.unavailable});
  });

  it('the armor: 10 scrap, installed once; refused by its system (already fitted); a failed install is refunded exactly', () => {
    const w = stocked(0, 14);
    const fitted = new Set<string>();
    let fail = false;
    const up: MadeUpgradesTarget = {block: id => (fitted.has(id) ? 'Already fitted' : null), install: id => { if (fail) return false; fitted.add(id); return true; }};
    fail = true;
    const before = snap(w.inv, w.box);
    expect(craftMade(armor, {sources: w.sources(), upgrades: up})).toMatchObject({ok: false, reason: 'failed'});
    expect(snap(w.inv, w.box)).toBe(before); // the same stacks, the same counts
    fail = false;
    expect(craftMade(armor, {sources: w.sources(), upgrades: up})).toMatchObject({ok: true, made: {type: 'upgrade', id: 'armor'}});
    expect(w.inv.count(SCRAP_METAL)).toBe(4);
    expect(craftMade(armor, {sources: w.sources(), upgrades: up})).toEqual({ok: false, reason: 'blocked', text: 'Already fitted'});
    expect(w.inv.count(SCRAP_METAL)).toBe(4);
    expect(craftMade(armor, {sources: w.sources(), upgrades: null})).toEqual({ok: false, reason: 'blocked', text: MADE_TEXT.unavailable});
    // a throwing install: refunded too
    fitted.clear();
    w.inv.add(w.inv.makeStack(SCRAP_METAL, 6));
    const mid = snap(w.inv, w.box);
    const boom: MadeUpgradesTarget = {block: () => null, install: () => { throw new Error('boom'); }};
    expect(craftMade(armor, {sources: w.sources(), upgrades: boom})).toMatchObject({ok: false, reason: 'failed', error: expect.any(Error)});
    expect(snap(w.inv, w.box)).toBe(mid);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The canisters in a real station's physics world

const fx = levelFixture();
const L = levelsOf(fx);

function fakeZombie(x: number, y: number, z: number, hp = 100): GrenadeEnemy & {brain: {hp: number; hits: {amount: number; from: [number, number, number?]}[]}} {
  const brain = {
    alive: true, x, y, z, hp, hits: [] as {amount: number; from: [number, number, number?]}[],
    damage(amount: number, fx: number, fz: number, fy?: number) {
      if (!this.alive) return false;
      this.hits.push({amount, from: [fx, fz, fy]});
      this.hp -= amount;
      if (this.hp <= 0) { this.alive = false; return true; }
      return false;
    },
  };
  return {
    brain, hitFlash: 0,
    get hitVolumes() { return brain.alive ? [{part: 'torso' as const, a: {x: brain.x, y: brain.y + 0.9, z: brain.z}, b: {x: brain.x, y: brain.y + 1.55, z: brain.z}, r: 0.28}] : []; },
  };
}

function world(o: {zombies?: GrenadeEnemy[]; melt?: AcidMeltLike | null} = {}) {
  const ph = new PhysicsSystem(null);
  ph.build(fx);
  const sys = new GrenadeSystem(new THREE.Group(), ph, mulberry32(11));
  const player = {x: 21, y: FIX.upperY, z: 4, alive: true, hp: 100, takeDamage(a: number) { this.hp -= a; if (this.hp <= 0) this.alive = false; }};
  const scents = {added: [] as {x: number; y: number; z: number; seconds?: number}[], removed: 0, add(p: {x: number; y: number; z: number}, opts?: {seconds?: number}) { this.added.push({...p, seconds: opts?.seconds}); return {id: this.added.length}; }, remove() { this.removed++; }};
  const kills: GrenadeEnemy[] = [], killStrength: number[] = [], pain: number[] = [];
  sys.env = {
    zombies: () => o.zombies ?? [], player: () => player, kill: (z, _d, _p, strength) => { kills.push(z); killStrength.push(strength); },
    playerHurt: a => { pain.push(a); },
    melt: () => o.melt ?? null, scents: () => scents,
    levelAt: (x, z, y) => L.levelAt(x, z, y), lineOfSight: (a, b) => L.lineOfSight(a, b),
  };
  const inv = new Inventory();
  inv.add(inv.makeStack(ACID_GRENADE, 5));
  inv.add(inv.makeStack(LURE_GRENADE, 3));
  const eye = {x: 21, y: FIX.upperY + 1.62, z: 4};
  const dirOf = (x: number, y: number, z: number) => { const l = Math.hypot(x, y, z); return {x: x / l, y: y / l, z: z / l}; };
  const step = (n = 1) => { for (let i = 0; i < n; i++) { ph.update(DT); sys.tick(DT); } };
  const toss = (id: typeof ACID_GRENADE | typeof LURE_GRENADE, dir = dirOf(0, -0.35, 1)) =>
    throwOneGrenade(sys, id, () => inv.take(id, 1) === 1, () => inv.count(id) > 0, eye, dir);
  const poolNow = () => { let n = 0; while (!sys.pools.length && n++ < 600) step(); return sys.pools[0]; };
  return {ph, sys, player, scents, kills, killStrength, pain, inv, step, toss, dirOf, poolNow};
}

describe('GrenadeSystem: acid', () => {
  it('one item per throw; it lands, bursts and leaves a pool ON THE FLOOR for exactly 10 active seconds', () => {
    const w = world();
    const r = w.toss(ACID_GRENADE);
    expect(r.ok).toBe(true);
    expect(w.inv.count(ACID_GRENADE)).toBe(4);
    let n = 0;
    while (!w.sys.pools.length && n++ < 600) w.step();
    expect(w.sys.pools).toHaveLength(1);
    expect(w.sys.canisters).toHaveLength(0); // it shattered
    const p = w.sys.pools[0];
    expect(p.y).toBeCloseTo(FIX.upperY, 1);
    expect(Math.hypot(p.x - 21, p.z - 4)).toBeGreaterThan(1.5); // thrown away from the eye
    expect(p.r).toBe(ACID.poolR);
    // it ages only while ticked (active seconds): no ticks, no drying
    const left = p.left;
    expect(w.sys.pools[0].left).toBe(left);
    w.step(Math.round((ACID.poolSeconds - 0.5) / DT));
    expect(w.sys.pools).toHaveLength(1);
    w.step(Math.round(0.6 / DT));
    expect(w.sys.pools).toHaveLength(0);
    expect(w.sys.counts).toMatchObject({thrown: 1, bursts: 1, pools: 1, poolsDried: 1});
  });

  it('the pool burns the zombies AND the player standing in it (inPool: the drawn disc), and nobody outside it', () => {
    const w = world();
    w.toss(ACID_GRENADE);
    const p = w.poolNow();
    w.step(Math.round(ACID.fadeIn / DT) + 1); // (spread to its full disc)
    expect(poolReach(p)).toBe(ACID.poolR);
    const inside = fakeZombie(p.x + 0.6, p.y, p.z), outside = fakeZombie(p.x + ACID.poolR + 0.6, p.y, p.z), above = fakeZombie(p.x, p.y + 3, p.z);
    const zs = [inside, outside, above];
    w.sys.env.zombies = () => zs;
    Object.assign(w.player, {x: p.x - 0.5, y: p.y, z: p.z});
    const hp0 = w.player.hp;
    w.step(60); // 1 s: applied in ACID.burnEvery batches, so up to one batch is still pending
    expect(100 - inside.brain.hp).toBeGreaterThan(ACID.zombieDps * (1 - ACID.burnEvery) - 0.01);
    expect(100 - inside.brain.hp).toBeLessThan(ACID.zombieDps * 1 + 0.01);
    expect([outside.brain.hp, above.brain.hp]).toEqual([100, 100]);
    expect(hp0 - w.player.hp).toBeGreaterThan(ACID.playerDps * (1 - ACID.burnEvery) - 0.01);
    expect(hp0 - w.player.hp).toBeLessThan(ACID.playerDps * 1 + 0.01);
    expect(inPool(p, w.player.x, w.player.y, w.player.z)).toBe(true);
    // a regular zombie dies in it in ~100 / 30 s (the kill goes through the game's kill path, crumpling: ACID.killImpulse)
    w.step(Math.round(2.6 / DT));
    expect(inside.brain.alive).toBe(false);
    expect(w.kills).toEqual([inside]);
    expect(w.killStrength).toEqual([ACID.killImpulse]);
    // the burn comes from the zombie's own feet (never "a noise at the pool's centre" that would draw it in), batched, never per frame
    expect(inside.brain.hits.every(h => h.from[0] === inside.brain.x && h.from[1] === inside.brain.z)).toBe(true);
    expect(inside.brain.hits.length).toBeLessThanOrEqual(Math.ceil(3.6 / ACID.burnEvery) + 1);
    // stepping out stops the burn (what was counted before is applied at the next batch, then nothing)
    Object.assign(w.player, {x: p.x + ACID.poolR + 1});
    w.step(Math.round(ACID.burnEvery / DT) + 1);
    const hp1 = w.player.hp;
    w.step(60);
    expect(w.player.hp).toBe(hp1);
    // the pain cue (HUD pulse + grunt) at most every ACID.painEvery s while it burns
    expect(w.pain.length).toBeGreaterThan(0);
    expect(w.pain.length).toBeLessThanOrEqual(Math.ceil(3.6 / ACID.painEvery) + 1);
  });

  it('the burn thins with the film: a whole pool is worth about (10 - the fades / 2) s, and nothing burns past its 10 active seconds', () => {
    const w = world();
    w.toss(ACID_GRENADE);
    const p = w.poolNow();
    const z = fakeZombie(p.x, p.y, p.z, 1e6);
    w.sys.env.zombies = () => [z];
    Object.assign(w.player, {x: p.x + 9, z: p.z + 9});
    const t0 = p.left;
    // to the last frame, then one long (0.05 s) frame past its end
    w.step(Math.floor((t0 - 0.03) / DT));
    expect(w.sys.pools).toHaveLength(1);
    w.ph.update(0.05); w.sys.tick(0.05);
    expect(w.sys.pools).toHaveLength(0);
    const took = 1e6 - z.brain.hp;
    const full = ACID.zombieDps * (t0 - ACID.fadeIn / 2 - ACID.fadeOut / 2);
    expect(took).toBeGreaterThan(full - 1);
    expect(took).toBeLessThan(full + 1);
    // the strength the burn uses IS the film's opacity (drawPool) — one source for what hurts and what shows
    expect(poolStrength({age: ACID.fadeIn / 2, left: 5})).toBeCloseTo(0.5, 6);
    expect(poolStrength({age: 5, left: ACID.fadeOut / 4})).toBeCloseTo(0.25, 6);
  });

  it('a zombie in its path stops it: direct damage + the burst there; the caps refuse with nothing consumed', () => {
    const z = fakeZombie(21, FIX.upperY, 7);
    const w = world({zombies: [z]});
    w.toss(ACID_GRENADE, w.dirOf(0, -0.12, 1));
    let n = 0;
    while (!w.sys.pools.length && n++ < 300) w.step();
    expect(w.sys.counts.zombieHits).toBe(1);
    expect(100 - z.brain.hp).toBeGreaterThanOrEqual(ACID.direct);
    expect(Math.abs(w.sys.pools[0].z - 7)).toBeLessThan(0.8);
    // cap: pools + acid in flight
    for (let i = 0; i < 2; i++) { w.step(Math.round(GRENADE.cooldown / DT) + 1); expect(w.toss(ACID_GRENADE).ok).toBe(true); }
    w.step(Math.round(GRENADE.cooldown / DT) + 1);
    const before = w.inv.count(ACID_GRENADE);
    expect(w.toss(ACID_GRENADE)).toEqual({ok: false, reason: 'cap'});
    expect(w.inv.count(ACID_GRENADE)).toBe(before);
    // the cooldown: a second throw right after one is refused silently, nothing consumed
    const w2 = world();
    expect(w2.toss(LURE_GRENADE).ok).toBe(true);
    expect(w2.toss(LURE_GRENADE)).toEqual({ok: false, reason: 'cooldown'});
    expect(w2.inv.count(LURE_GRENADE)).toBe(2);
  });

  it('touching a meltable prop it STICKS, bursts after the fuse and starts that prop melting; the pool exposes what it touches', () => {
    const ref: MeltRefLike = {key: 'prop:7', x: 21, y: FIX.upperY, z: 8, label: 'crate'};
    const calls = {start: [] as string[], expose: [] as [string, number][], atPoint: 0};
    const melt: AcidMeltLike = {
      atPoint: (_x, _y, z) => { calls.atPoint++; return z > 5.5 ? ref : null; },
      inDisc: (x, _y, z, r) => (Math.hypot(x - ref.x, z - ref.z) <= r + 0.5 ? [ref] : []),
      expose: (r, dt) => { calls.expose.push([r.key, dt]); return true; },
      start: r => { calls.start.push(r.key); return true; },
      alive: () => true,
      where: (r, out) => { out.x = r.x; out.y = r.y; out.z = r.z; return true; },
    };
    const w = world({melt});
    w.toss(ACID_GRENADE);
    let n = 0;
    while (w.sys.canisters[0]?.state !== 'stuck' && n++ < 600) w.step();
    const c = w.sys.canisters[0];
    expect(c.state).toBe('stuck');
    expect(c.body).toBeNull();
    expect(calls.start).toEqual([]);
    w.step(Math.round(ACID.stickFuse / DT) + 2);
    expect(calls.start).toEqual(['prop:7']);
    expect(w.sys.pools).toHaveLength(1);
    w.step(Math.round(1 / DT));
    expect(calls.expose.length).toBeGreaterThanOrEqual(4);
    expect(calls.expose.every(([k, dt]) => k === 'prop:7' && dt >= ACID.propEvery - 1e-9 && dt < ACID.propEvery + DT + 1e-9)).toBe(true);
    // the prop gone before the fuse: the stuck canister bursts at once
    const w2 = world({melt: {...melt, alive: () => false}});
    w2.toss(ACID_GRENADE);
    n = 0;
    while (!w2.sys.pools.length && n++ < 600) w2.step();
    expect(w2.sys.pools).toHaveLength(1);
  });
});

describe("Game's throw dispatch: one hold for every throwable (throwHoldTarget + FlareHold, as Game.update drives them)", () => {
  /** One frame of Game.update's throw part: the target item, the hold, the release thrown by item id (Game.throwHeld / throwGrenade). */
  function rig() {
    const w = world();
    const fl = new FlareSystem(new THREE.Group(), w.ph, new LightSources(), mulberry32(7));
    const inv = w.inv, hold = new FlareHold(), eye = {x: 21, y: FIX.upperY + 1.62, z: 4}, dir = w.dirOf(0, -0.35, 1);
    let readied: string | null = null;
    const events: string[] = [];
    const frame = (o: {press?: boolean; down?: boolean; click?: boolean; mouse?: boolean} = {}) => {
      const held = inv.selectedStack(), heldThrowable = !!held && itemDef(held.itemId).kind === 'throwable';
      const t = throwHoldTarget({active: hold.active, readied, keyPressed: !!o.press, slot: inv.thrown?.itemId ?? null, mousePressed: !!o.click, held: held?.itemId ?? null, heldThrowable});
      const input: FlareHoldInput = {keyDown: !!o.down, keyPressed: !!o.press, mouseDown: !!o.mouse, mousePressed: !!o.click,
        heldIsFlare: heldThrowable && (hold.source !== 'mouse' || held?.itemId === readied), busy: false, flares: t ? inv.count(t) : 0,
        refusal: t && isGrenadeItem(t) ? w.sys.refusal(t) : fl.refusal(), clears: 0};
      for (const e of hold.update(DT, input)) {
        events.push(e.type === 'refuse' ? `refuse:${e.reason}` : e.type);
        if (e.type === 'ready') readied = t;
        else if (e.type === 'release') {
          const id = readied ?? 'flare', fromHeld = e.source === 'mouse';
          readied = null;
          const ref = fromHeld && inv.selectedStack()?.itemId === id ? inv.selectedRef() : !fromHeld && inv.thrown?.itemId === id ? THROW_REF : null;
          const take = () => (ref ? inv.consumeAt(ref) : inv.take(id, 1) === 1), has = () => inv.count(id) > 0;
          if (isGrenadeItem(id)) throwOneGrenade(w.sys, id, take, has, eye, dir);
          else throwOneFlare(fl, take, has, eye, dir);
        } else if (e.type === 'cancel') readied = null;
      }
      w.ph.update(DT); w.sys.tick(DT); fl.tick(DT);
    };
    return {...w, fl, hold, frame, events, readied: () => readied};
  }

  it('G throws the grenade slot\'s item (an acid grenade), exactly one, from that slot; a flare in the pack is untouched', () => {
    const r = rig();
    r.inv.add(r.inv.makeStack('flare', 4));
    if (!r.inv.thrown) r.inv.refillThrowSlot();
    const slot = r.inv.thrown!;
    expect(slot.itemId).toBe(ACID_GRENADE);
    r.frame({press: true, down: true});
    expect(r.readied()).toBe(ACID_GRENADE);
    for (let i = 0; i < 20; i++) r.frame({down: true});
    expect([slot.count, r.sys.canisters.length]).toEqual([5, 0]); // nothing spent while readied
    r.frame();
    expect([slot.count, r.sys.canisters.length, r.sys.canisters[0]?.itemId, r.fl.flares.length, r.inv.count('flare')]).toEqual([4, 1, ACID_GRENADE, 0, 4]);
    expect(r.inv.invariants()).toEqual([]);
  });

  it('a click with a lure grenade in the hand throws THAT lure (the held stack), and the hold keeps its item if the slot changes', () => {
    const r = rig();
    expect(r.inv.take(LURE_GRENADE, 3)).toBe(3);
    r.inv.set({bar: 'hotbar', index: 2}, r.inv.makeStack(LURE_GRENADE, 3));
    r.inv.select(2);
    expect(r.inv.selectedStack()!.itemId).toBe(LURE_GRENADE);
    r.frame({click: true, mouse: true});
    expect([r.hold.source, r.readied()]).toEqual(['mouse', LURE_GRENADE]);
    r.frame({mouse: true});
    r.frame({press: true, mouse: true}); // (a G press mid-hold never re-targets: the readied lure stays the throw)
    expect(r.readied()).toBe(LURE_GRENADE);
    r.frame();
    expect([r.sys.canisters.length, r.sys.canisters[0]?.itemId, r.inv.count(LURE_GRENADE), r.inv.count(ACID_GRENADE)]).toEqual([1, LURE_GRENADE, 2, 5]);
  });

  it('the refusal is the item\'s own system\'s: three acid pools refuse acid (nothing spent), never a lure or a flare', () => {
    const r = rig();
    if (!r.inv.thrown) r.inv.refillThrowSlot();
    for (let i = 0; i < ACID.maxPools; i++) {
      expect(r.toss(ACID_GRENADE).ok).toBe(true);
      for (let k = 0; k < Math.round(GRENADE.cooldown / DT) + 1; k++) r.frame();
    }
    const n = r.inv.count(ACID_GRENADE);
    r.frame({press: true, down: true});
    r.frame();
    expect(r.events).toContain('refuse:cap');
    expect(r.inv.count(ACID_GRENADE)).toBe(n);
    // the grenades gone, flares in the slot: the acid cap does not apply to them
    r.inv.take(ACID_GRENADE, n);
    r.inv.take(LURE_GRENADE, 3);
    r.inv.add(r.inv.makeStack('flare', 2));
    expect(r.inv.refillThrowSlot()).toBe(true);
    expect(r.inv.thrown?.itemId).toBe('flare');
    r.events.length = 0;
    r.frame({press: true, down: true});
    expect([r.events, r.readied()]).toEqual([['ready'], 'flare']); // (readied, not refused: its release is the flare's own throw)
  });
});

describe('GrenadeSystem: lifts, doors and clears', () => {
  it('an elevator cab carries a venting lure (its emitter AND its plume follow) and a pool; a stuck canister rides its prop instead', () => {
    const w = world();
    const moved: {y: number}[] = [], plume: {up: {y: number}[]; stopped: number} = {up: [], stopped: 0};
    const scents = {n: 0, add() { return {id: ++this.n}; }, remove() {}, move: (_e: unknown, p: {y: number}) => { moved.push(p); }};
    w.sys.env.scents = () => scents;
    w.sys.env.smoke = {addSmokeEmitter: () => ({update: (q: {y: number}) => { plume.up.push(q); }, stop: () => { plume.stopped++; }})};
    w.toss(LURE_GRENADE);
    let n = 0;
    while (w.sys.canisters[0].state === 'flying' && n++ < 900) w.step();
    const c = w.sys.canisters[0], y0 = w.sys.qa().canisters[0].y;
    expect(c.state).toBe('venting');
    w.sys.carry(() => true, 1.25);
    expect(w.sys.qa().canisters[0].y).toBeCloseTo(y0 + 1.25, 2); // (qa() rounds to mm)
    expect(moved.map(p => p.y)).toEqual([expect.closeTo(y0 + 1.25, 2)]);
    expect(plume.up.map(p => p.y)).toEqual([expect.closeTo(y0 + 1.25 + 0.1, 2)]);
    // outside the cab: nothing moves
    w.sys.carry(() => false, 3);
    expect(moved).toHaveLength(1);
    // a landing door shuts on it: it goes to the side the door hands it, the scent with it
    w.sys.relocate(() => [c.root.position.x + 0.6, c.root.position.z]);
    expect(moved).toHaveLength(2);
    expect(plume.up).toHaveLength(2);
    // a pool rides the cab too (its film and its bubbles)
    const w2 = world();
    w2.toss(ACID_GRENADE);
    const p = w2.poolNow(), py = p.y;
    w2.sys.carry((_x, y) => Math.abs(y - py) < 0.5, 0.8);
    expect([p.y, p.mesh.position.y - p.y, p.bubbles.position.y - p.y].map(v => +v.toFixed(4))).toEqual([+(py + 0.8).toFixed(4), 0.012, 0.012]);
  });

  it('clear(): canisters in every state and pools go silently — no burst, no melt start, no damage; a cleared world ticks to nothing', () => {
    const ref: MeltRefLike = {key: 'prop:9', x: 21, y: FIX.upperY, z: 8, label: 'crate'};
    const started: string[] = [];
    const melt: AcidMeltLike = {
      atPoint: (_x, _y, z) => (z > 5.5 ? ref : null), inDisc: () => [], expose: () => true,
      start: r => { started.push(r.key); return true; }, alive: () => true,
      where: (r, out) => { out.x = r.x; out.y = r.y; out.z = r.z; return true; },
    };
    const w = world({melt});
    w.toss(ACID_GRENADE);
    let n = 0;
    while (w.sys.canisters[0]?.state !== 'stuck' && n++ < 600) w.step();
    expect(w.sys.canisters[0].state).toBe('stuck');
    w.step(Math.round(GRENADE.cooldown / DT) + 1);
    w.toss(LURE_GRENADE); // (in flight)
    const z = fakeZombie(21, FIX.upperY, 6);
    w.sys.env.zombies = () => [z];
    w.sys.clear();
    expect([w.sys.canisters.length, w.sys.pools.length, w.sys.acidCount, w.sys.lureCount]).toEqual([0, 0, 0, 0]);
    w.step(Math.round(3 / DT));
    expect([started, z.brain.hits.length, w.sys.counts.bursts, w.sys.pools.length]).toEqual([[], 0, 0, 0]);
    // and a pool mid-burn: its pending batch is dropped with it (nothing applied after clear)
    const w2 = world();
    w2.toss(ACID_GRENADE);
    const p = w2.poolNow();
    const z2 = fakeZombie(p.x, p.y, p.z);
    w2.sys.env.zombies = () => [z2];
    w2.step(Math.round(0.5 / DT) + 3);
    const hp = z2.brain.hp;
    w2.sys.clear();
    w2.step(Math.round(1 / DT));
    expect(z2.brain.hp).toBe(hp);
  });
});

describe('GrenadeSystem: lure', () => {
  it('at rest it opens ONE scent emitter at the canister for 20 active seconds, then is spent and removed', () => {
    const w = world();
    expect(w.toss(LURE_GRENADE).ok).toBe(true);
    let n = 0;
    while (w.sys.canisters[0].state === 'flying' && n++ < 900) w.step();
    const c = w.sys.canisters[0];
    expect(c.state).toBe('venting');
    expect(w.scents.added).toHaveLength(1);
    const e = w.scents.added[0];
    expect(e.seconds).toBe(LURE.seconds);
    expect(e.y).toBeGreaterThan(FIX.upperY - 0.01);
    expect(e.y).toBeLessThan(FIX.upperY + 0.2);
    const pos = w.sys.qa().canisters[0];
    expect(Math.hypot(e.x - pos.x, e.z - pos.z)).toBeLessThan(0.05); // the emitter IS the canister
    w.step(Math.round((LURE.seconds - 0.5) / DT));
    expect([c.state, w.scents.removed]).toEqual(['venting', 0]);
    w.step(Math.round(0.6 / DT));
    expect([c.state, w.scents.removed]).toEqual(['spent', 1]);
    w.step(Math.round((LURE.husk + 0.2) / DT));
    expect(w.sys.canisters).toHaveLength(0);
    expect(w.scents.removed).toBe(1); // never twice
    // clear(): an active lure's emitter goes too, silently
    const w2 = world();
    w2.toss(LURE_GRENADE);
    n = 0;
    while (w2.sys.canisters[0].state === 'flying' && n++ < 900) w2.step();
    w2.sys.clear();
    expect([w2.scents.removed, w2.sys.canisters.length]).toEqual([1, 0]);
  });

  it('with the real scent registry (ai/scentLure.ts): the canister IS the emitter, active for SCENT.seconds, gone after', () => {
    const w = world(), real = new ScentLures();
    w.sys.env.scents = () => real;
    w.toss(LURE_GRENADE);
    let n = 0;
    while (w.sys.canisters[0].state === 'flying' && n++ < 900) { w.step(); real.tick(DT); }
    expect(real.list).toHaveLength(1);
    const e = real.list[0], c = w.sys.qa().canisters[0];
    expect([e.active, e.seconds, e.radius]).toEqual([true, SCENT.seconds, SCENT.radius]);
    expect(Math.hypot(e.x - c.x, e.z - c.z)).toBeLessThan(0.05);
    for (let i = 0; i < Math.round((SCENT.seconds + 0.2) / DT); i++) { w.step(); real.tick(DT); }
    expect(real.list).toHaveLength(0);
    expect(w.sys.canisters[0].state).toBe('spent');
  });

  it('never refused by an acid pool: the caps are per kind', () => {
    const w = world();
    const spy = vi.spyOn(w.sys, 'refusal');
    expect(w.toss(LURE_GRENADE).ok).toBe(true);
    expect(spy).toHaveBeenCalledWith(LURE_GRENADE);
  });
});
