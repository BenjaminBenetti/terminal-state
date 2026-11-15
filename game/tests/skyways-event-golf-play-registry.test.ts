// Task studio-skywalk-events-20261115-193624-01 (layout version 7, lane GOLF-PLAY): the mini-golf PUTTER and GOLF BALL in the registries,
// and the guard that they are PLACED ONLY (user: "Don't silently add the putter to global random weapon pools"):
//  - the items: the putter a kind 'weapon' melee club (the inventory's melee slot, its stats against the knife, the hint, the icon, its
//    lazily delivered code-built model whose public GLB / provenance are allowlisted by hash); the ball a passive supply stack of ONE with
//    a SPHERE body of its own (damage class, mass, the code-built model: a 42.7 mm sphere with its origin at the bottom);
//  - NEVER A FIND: neither id is in any loot module's data (tables, pools, weights, weapon-find leaves, mask / gear loot), the weapon pool
//    version and its leaves are what they were, no generator / level / loot / starter source names them except the mini-golf event's own
//    gen/skyways/events/golf*.ts, the rolls (level gear, mask loot, every weapon slot of every pool version, the weapon finds, both starter
//    kits, every market stall over many seeds, the bench recipes, the 1337 gear drop) never give one, and a placed putter / ball is left
//    alone by the weapon-find plan; the trade value is a priced ordinary item.
import {createHash} from 'node:crypto';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {GOLF_BALL_ITEM, GOLF_BALL_MASS, GOLF_BALL_R, PUTTER_ITEM} from '../src/gen/skyways/events/golfContract';
import {GOLF_CLASS, GOLF_DIMS, GOLF_EVENT_ONLY, GOLF_ITEMS, GOLF_PHYSICS, isGolfEventItem} from '../src/items/golfItems';
import {ITEMS, ITEM_DIMS, itemDef} from '../src/items/items';
import {ITEM_CLASS, ITEM_PHYSICS, PHYS_MATS, itemClass, itemPhysics} from '../src/damage/materials';
import {WEAPONS} from '../src/weapons/weapons';
import {PUTTER_DEF, PUTTER_MELEE, PUTTER_RAYS} from '../src/weapons/putter';
import {PUTTER_POSES} from '../src/weapons/meleeView';
import {PUTTER_MODEL} from '../src/assets/putterModel.generated';
import {LAZY_EXTRA_WEAPON_IDS, lazyWeaponIdsIn} from '../src/weapons/lazyWeaponModels';
import {isVarietyWeapon} from '../src/weapons/varietyIds';
import {ICONS} from '../src/ui/icons';
import {GOLF_ICONS} from '../src/ui/golfIcons';
import {supplyText} from '../src/ui/itemTip';
import {Inventory} from '../src/items/inventory';
import {PickupManager} from '../src/world/pickups';
import {GOLF_BALL_MODEL_SOURCE} from '../src/world/golfBallModel';
import * as lootTables from '../src/items/lootTables';
import * as loot from '../src/items/loot';
import * as weaponVariety from '../src/items/weaponVariety';
import * as weaponFinds from '../src/gen/weaponFinds';
import * as gearLoot from '../src/gen/gearLoot';
import * as maskLoot from '../src/gen/maskLoot';
import {starterInventory} from '../src/run/starter';
import {devGrantBundle} from '../src/items/devGrant';
import {BENCH_RECIPES} from '../src/craft/recipes';
import {stallDraws, stockRng} from '../src/market/trade/stock';
import {baseCents} from '../src/market/trade/value';
import {MARKET_STALLS_ALL} from '../src/gen/market/marketTypes';
import type {LevelId} from '../src/levels/types';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip(): void}).clip ??= () => {};

const IDS: readonly string[] = [PUTTER_ITEM, GOLF_BALL_ITEM];
const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Every place (a path) where a string equal to one of `ids` sits in plain data (flamethrower-economy.test.ts's walker). */
function mentions(v: unknown, ids: readonly string[], path = '', seen = new Set<unknown>(), out: string[] = []): string[] {
  if (typeof v === 'string') { if (ids.includes(v)) out.push(path); return out; }
  if (!v || typeof v !== 'object' || seen.has(v)) return out;
  seen.add(v);
  if (v instanceof Set) { for (const x of v) mentions(x, ids, `${path}{}`, seen, out); return out; }
  if (v instanceof Map) { for (const [k, x] of v) { mentions(k, ids, `${path}<key>`, seen, out); mentions(x, ids, `${path}.${String(k)}`, seen, out); } return out; }
  if (Array.isArray(v)) { v.forEach((x, i) => mentions(x, ids, `${path}[${i}]`, seen, out)); return out; }
  for (const [k, x] of Object.entries(v)) {
    if (ids.includes(k)) out.push(`${path}.${k} (key)`);
    mentions(x, ids, `${path}.${k}`, seen, out);
  }
  return out;
}
function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(`${SRC}${dir}`)) {
    const rel = `${dir}/${name}`;
    if (statSync(`${SRC}${rel}`).isDirectory()) out.push(...sourcesUnder(rel));
    else if (name.endsWith('.ts')) out.push(rel);
  }
  return out;
}
const sha256 = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('the putter: an ordinary melee weapon', () => {
  it('a kind "weapon" item of one with its WeaponDef (melee: no ammo / magazine / caliber); it goes to the melee slot like the knife', () => {
    expect(ITEMS[PUTTER_ITEM]).toBe(GOLF_ITEMS[PUTTER_ITEM]);
    expect(ITEMS[PUTTER_ITEM]).toMatchObject({id: PUTTER_ITEM, kind: 'weapon', stackMax: 1, weaponId: PUTTER_ITEM, icon: 'putter', short: 'Putter'});
    expect(itemDef(PUTTER_ITEM).description).toMatch(/hold the button for more power and release to putt/);
    expect(WEAPONS[PUTTER_ITEM]).toBe(PUTTER_DEF);
    expect(PUTTER_DEF.melee).toBe(PUTTER_MELEE);
    expect(PUTTER_DEF).toMatchObject({magazine: 0, pellets: 1, knockback: 0});
    expect(PUTTER_DEF.caliber).toBeUndefined();
    expect(PUTTER_DEF.stream).toBeUndefined();
    expect(isVarietyWeapon(PUTTER_ITEM)).toBe(false); // never a weapon-variety identity
    const inv = new Inventory(), st = inv.makeStack(PUTTER_ITEM, 1);
    expect(inv.add(st)).toBe(0);
    expect(inv.meleeSlot[0]).toBe(st);
    expect(st).toEqual({uid: st.uid, itemId: PUTTER_ITEM, count: 1, mag: 0});
  });

  it('its stats: a LIGHT club — less damage than the knife, a little more reach, a similar cadence, a small push, a charge that sets the putt', () => {
    expect({damage: PUTTER_DEF.damage, headMult: PUTTER_DEF.headMult, limbMult: PUTTER_DEF.limbMult, range: PUTTER_DEF.range, interval: PUTTER_DEF.interval,
      equipTime: PUTTER_DEF.equipTime, noise: PUTTER_DEF.noise}).toEqual({damage: 20, headMult: 2, limbMult: 1, range: 1.3, interval: 0.76, equipTime: 0.35, noise: 4});
    expect(JSON.stringify(PUTTER_MELEE)).toBe(JSON.stringify({windup: 0.2, strike: 0.09, sweep: 0.2, recovery: 0.36, rays: PUTTER_RAYS,
      maxTargets: 1, knockback: 0.25, stamina: 5, propHits: true, charge: {time: 2.0, damage: [0.9, 1.25], knockback: [0.6, 1.6], stagger: [0, 0.2], stamina: [0.6, 1.4]}}));
    const knife = WEAPONS.knife;
    expect(PUTTER_DEF.damage).toBeLessThan(knife.damage);
    expect(PUTTER_DEF.range).toBeGreaterThan(knife.range);
    expect(Math.abs(PUTTER_DEF.interval - knife.interval)).toBeLessThan(0.15);
    expect(PUTTER_DEF.noise).toBeLessThan(knife.noise);
    // the club's fan is low (below the eye line, centre first)
    expect(PUTTER_RAYS[0]).toEqual([0, 0]);
    expect(PUTTER_RAYS.every(([, p]) => p <= 0.07)).toBe(true);
    expect(PUTTER_POSES).toBeDefined();
  });

  it('its model: code-built, lazily delivered, the public GLB and its provenance allowlisted by hash; the held length is the model\'s', () => {
    expect(PUTTER_MODEL).toMatchObject({itemId: PUTTER_ITEM, kind: 'melee', url: 'assets/models/weapon-putter.glb', length: 0.89});
    expect(PUTTER_DEF.view.length).toBe(PUTTER_MODEL.length);
    expect(PUTTER_DEF.view.model).toBe(PUTTER_ITEM);
    expect(LAZY_EXTRA_WEAPON_IDS).toContain(PUTTER_ITEM);
    // a layout that places a putter asks for its model before play (game.ts prepareWeaponVariety)
    expect([...lazyWeaponIdsIn([{itemId: PUTTER_ITEM, x: 0, z: 0, count: 1}])]).toEqual([PUTTER_ITEM]);
    expect([...lazyWeaponIdsIn([{itemId: GOLF_BALL_ITEM, x: 0, z: 0, count: 1}])]).toEqual([]);
    const rows = (JSON.parse(readFileSync(`${ROOT}tools/release/public-inputs.json`, 'utf8')) as {files: {path: string; bytes: number; sha256: string}[]}).files;
    for (const rel of ['assets/models/weapon-putter.glb', 'assets/derivatives/weapon-putter.json']) {
      const row = rows.find(r => r.path === rel);
      expect(row, rel).toBeDefined();
      expect(row!.bytes, rel).toBe(statSync(`${PUBLIC}${rel}`).size);
      expect(row!.sha256, rel).toBe(sha256(`${PUBLIC}${rel}`));
    }
    const prov = JSON.parse(readFileSync(`${PUBLIC}assets/derivatives/weapon-putter.json`, 'utf8')) as {itemId: string; origin: string};
    expect(prov.itemId).toBe(PUTTER_ITEM);
    expect(prov.origin).toMatch(/hand-built from code primitives/);
    expect(prov.origin).toMatch(/no generation service/);
    const glb = readFileSync(`${PUBLIC}assets/models/weapon-putter.glb`);
    expect(glb.subarray(0, 4).toString('latin1')).toBe('glTF');
  });
});

describe('the golf ball: a passive supply stack of one, a rolling sphere', () => {
  it('kind "supply", one per stack (one stack = one ball = one pickup = one body); its tooltip says what to do with it', () => {
    expect(ITEMS[GOLF_BALL_ITEM]).toBe(GOLF_ITEMS[GOLF_BALL_ITEM]);
    expect(ITEMS[GOLF_BALL_ITEM]).toMatchObject({id: GOLF_BALL_ITEM, kind: 'supply', stackMax: 1, icon: 'golfBall'});
    const inv = new Inventory(), a = inv.makeStack(GOLF_BALL_ITEM, 1), b = inv.makeStack(GOLF_BALL_ITEM, 1);
    expect(inv.add(a)).toBe(0);
    expect(inv.add(b)).toBe(0);
    expect(inv.allStacks(true).filter(s => s.itemId === GOLF_BALL_ITEM).map(s => s.count)).toEqual([1, 1]); // never merged
    expect(supplyText(GOLF_BALL_ITEM)).toBe('Mini-golf: drop it on the turf and putt it with the putter (hold for a harder stroke)');
  });

  it('its own damage class and loose-item physics: a 45.9 g SPHERE of the lively, frictionless "ball" material; the putter a box of steel', () => {
    for (const id of IDS) {
      expect(Object.prototype.hasOwnProperty.call(ITEM_CLASS, id), id).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(ITEM_PHYSICS, id), id).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(ITEM_DIMS, id), id).toBe(true);
      expect(itemClass(id)).toBe(GOLF_CLASS[id]);
      expect(itemPhysics(id)).toEqual(GOLF_PHYSICS[id]);
      expect(ITEM_DIMS[id]).toEqual(GOLF_DIMS[id]);
    }
    expect(itemPhysics(GOLF_BALL_ITEM)).toEqual({mass: GOLF_BALL_MASS, shape: 'sphere', mat: 'ball'});
    expect(GOLF_BALL_MASS).toBeCloseTo(0.0459, 6);
    expect(PHYS_MATS.ball).toEqual({friction: 0, restitution: 0.65});
    expect(itemPhysics(PUTTER_ITEM)).toEqual({mass: 0.52, shape: 'box', mat: 'metal'});
    expect([itemClass(PUTTER_ITEM), itemClass(GOLF_BALL_ITEM)]).toEqual(['steel', 'plastic']);
  });

  it('the code-built model: a 42.7 mm sphere with its origin at the BOTTOM (the pickup frame), shared geometry, no texture', () => {
    expect(GOLF_BALL_R * 2).toBeCloseTo(0.0427, 4);
    expect(GOLF_DIMS[GOLF_BALL_ITEM]).toMatchObject({w: GOLF_BALL_R * 2, d: GOLF_BALL_R * 2, h: GOLF_BALL_R * 2});
    const pm = new PickupManager({}), inv = new Inventory();
    const a = pm.add(inv.makeStack(GOLF_BALL_ITEM, 1), 3, 0.06, 4, 0), b = pm.add(inv.makeStack(GOLF_BALL_ITEM, 1), 5, 0, 5, 1);
    const box = new THREE.Box3().setFromObject(a.obj), size = box.getSize(new THREE.Vector3());
    for (const k of ['x', 'y', 'z'] as const) expect(size[k], k).toBeCloseTo(GOLF_BALL_R * 2, 3);
    expect(box.min.y).toBeCloseTo(0.06, 4); // resting ON the turf top it was put down at
    expect(box.getCenter(new THREE.Vector3()).x).toBeCloseTo(3, 4);
    const meshes = (o: THREE.Object3D) => { const out: THREE.Mesh[] = []; o.traverse(x => { if ((x as THREE.Mesh).isMesh) out.push(x as THREE.Mesh); }); return out; };
    const [ma, mb] = [meshes(a.obj), meshes(b.obj)];
    expect(ma.length).toBeGreaterThan(0);
    expect(ma[0].geometry).toBe(mb[0].geometry);
    for (const m of [ma[0], mb[0]]) expect((m.material as THREE.MeshStandardMaterial).map ?? null).toBeNull(); // no texture: a plain factor material
    expect(GOLF_BALL_MODEL_SOURCE).toMatch(/code-built/);
  });

  it('the icons: both keys are in the HUD icon registry', () => {
    for (const id of IDS) {
      const key = itemDef(id).icon as keyof typeof ICONS;
      expect(ICONS[key], id).toBe(GOLF_ICONS[key as keyof typeof GOLF_ICONS]);
      expect(ICONS[key].length, id).toBeGreaterThan(40);
    }
  });
});

describe('placed only: never loot, a find, market stock, a recipe, the starter kit or the gear drop', () => {
  it('GOLF_EVENT_ONLY names exactly the two items', () => {
    expect([...GOLF_EVENT_ONLY]).toEqual([PUTTER_ITEM, GOLF_BALL_ITEM]);
    expect(IDS.every(isGolfEventItem)).toBe(true);
    expect([null, undefined, '', 'knife', 'pistol', 'bandage'].some(isGolfEventItem)).toBe(false);
    // appended after every existing item (catalogue order of the others unchanged)
    expect(Object.keys(ITEMS).slice(-2)).toEqual([PUTTER_ITEM, GOLF_BALL_ITEM]);
  });

  it('neither id is anywhere in the loot modules\' data; the weapon pool and its leaves are what they were', () => {
    expect(mentions(weaponVariety, ['knife']).length).toBeGreaterThan(0); // (the walker finds what IS loot)
    const modules = {lootTables, loot, weaponVariety, weaponFinds, gearLoot, maskLoot};
    for (const [name, m] of Object.entries(modules)) expect(mentions(m, IDS), name).toEqual([]);
    expect([...weaponVariety.GUN_LEAVES]).toEqual(['pistol', 'hornet', 'longslide', 'rifle', 'stub', 'overwatch', 'shotgun', 'coach_gun', 'thresher', 'turnstile']);
    expect([...weaponVariety.MELEE_LEAVES]).toEqual(['knife', 'fire_axe', 'machete', 'sledgehammer', 'crowbar', 'slugger', 'track_shovel']);
    expect(weaponVariety.WEAPON_POOL_VERSION).toBe(2);
  });

  it('no generator, level, loot or starter source names either item — except the mini-golf event\'s own gen/skyways/events/golf*.ts', () => {
    const files = [...sourcesUnder('gen'), ...sourcesUnder('levels'), 'items/loot.ts', 'items/lootTables.ts', 'items/lootEconomy.ts', 'items/naturalFood.ts', 'items/pantryVariety.ts',
      'items/weaponVariety.ts', 'items/weaponVarietyItems.ts', 'run/starter.ts', 'world/containers.ts', 'world/openablesSpec.ts', 'craft/recipes.ts', 'items/devGrant.ts'];
    expect(files.length).toBeGreaterThan(100);
    const named = files.filter(f => /PUTTER_ITEM|GOLF_BALL_ITEM|GOLF_EVENT_ONLY|['"](putter|golf_ball)['"]/.test(readFileSync(`${SRC}${f}`, 'utf8')));
    const own = (f: string) => /^gen\/skyways\/events\/golf[A-Za-z]*\.ts$/.test(f);
    expect(named.filter(f => !own(f))).toEqual([]);
    expect(named).toContain('gen/skyways/events/golfContract.ts'); // (the scan does see the ids)
    // the market's stock rows name it only to exclude it by the event-only list (its rows are what they were)
    expect(readFileSync(`${SRC}market/trade/stock.ts`, 'utf8')).toMatch(/!WEAPONS\[d\.weaponId\]\.stream && !isGolfEventItem\(d\.id\)\)/);
  });

  it('the rolls never give one: level gear, mask loot, every weapon slot of every pool, the finds, both starter kits, the gear drop, the bench', () => {
    const rolled = new Set<string>();
    const levels = Object.keys(lootTables.PROFILES) as LevelId[];
    expect(levels.length).toBeGreaterThanOrEqual(7);
    for (const level of levels) {
      for (let seed = 1; seed <= 60; seed++) {
        for (const a of Object.values(gearLoot.rollLevelGear(seed * 7919, level, ['main', 'b', 'c'])).flat()) rolled.add(a.itemId);
        for (const a of Object.values(maskLoot.rollMaskLoot(seed * 7919, level, ['main', 'b', 'c'])).flat()) rolled.add(a.itemId);
      }
    }
    for (const kind of ['weapon', 'gun', 'pistol', 'rifle', 'shotgun', 'melee'] as const) {
      for (let pool = 1; pool <= weaponVariety.WEAPON_POOL_VERSION + 1; pool++) for (const [id] of weaponVariety.slotRows(kind, pool)) rolled.add(id);
    }
    for (const start of ['rifle', 'pistol'] as const) {
      for (const id of weaponFinds.findWeaponsFor(start)) rolled.add(id);
      for (const s of starterInventory(start).allStacks(true)) rolled.add(s.itemId);
    }
    for (const l of devGrantBundle()) rolled.add(l.itemId);
    for (const r of BENCH_RECIPES) if ('make' in r && r.make.type === 'item') rolled.add(r.make.itemId);
    expect(rolled.has('knife') && rolled.has('turnstile') && rolled.has('backpack')).toBe(true); // (the sample reaches the pools)
    for (const id of IDS) expect(rolled.has(id), id).toBe(false);
  });

  it('no market stall ever stocks one (every stall, 200 seeds); a putter / ball sold to a trader is an ordinary priced item', () => {
    const stocked = new Set<string>();
    for (const stall of MARKET_STALLS_ALL) for (let seed = 1; seed <= 200; seed++) for (const d of stallDraws(stall, stockRng(`st-${seed % 17}`, seed, stall))) stocked.add(d.itemId);
    expect(stocked.has('knife') || stocked.has('pistol')).toBe(true);
    for (const id of IDS) expect(stocked.has(id), id).toBe(false);
    expect(baseCents(GOLF_BALL_ITEM)).toBe(100); // one tie
    expect(baseCents(PUTTER_ITEM)).toBeGreaterThan(0);
    expect(baseCents(PUTTER_ITEM)).toBeLessThan(baseCents('knife') * 2);
  });

  it('a putter / ball PLACED in a layout is left alone by the weapon-find plan (never re-rolled into a find, never its family)', () => {
    const area = {purpose: 'golf-desk', type: 'room'};
    const pickups = [
      {itemId: PUTTER_ITEM, x: 4, z: 4, count: 1, area: 0},
      {itemId: GOLF_BALL_ITEM, x: 5, z: 4, count: 1, area: 0},
      {itemId: 'pistol', x: 8, z: 8, count: 1, area: 0},
      {itemId: 'ammo_9mm', x: 8.4, z: 8, count: 12, area: 0},
    ];
    for (let seed = 1; seed <= 40; seed++) {
      const plan = weaponVariety.weaponFindPlan({seed, pickups, areas: [area]} as never, 'skyways', 'st-01');
      expect(plan.finds.map(f => f.index), `seed ${seed}`).toEqual([2]); // only the pistol is a find
      expect(plan.changes.has(0) || plan.changes.has(1), `seed ${seed}`).toBe(false);
      for (const c of plan.changes.values()) expect(IDS.includes(c.itemId), `seed ${seed}`).toBe(false);
    }
  });
});
