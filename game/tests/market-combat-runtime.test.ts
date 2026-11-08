// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market fighting back, driven in Node on a REAL generated Survivor Market
// (levels, path finder, props, the parked train) with the real cast and the player's real gun models:
//  - people are targets: bone volumes with head / torso / limb classification; an ordinary zombie's 100 hp through the player's own damage;
//  - the first successful attack turns the settlement hostile once (~30 % draw, the rest flee); a theft makes the robbed trader fight;
//  - their gunfire: real line of sight (a wall / slab blocks the round), their magazine / reloads, positional shot / reload sounds, the
//    muzzle flash; their hits go through the player's ENEMY pipeline (x2 once, armour cuts it and wears);
//  - fleers run away along routes (never through the train keep-out) and leave; armed hostiles animate every frame;
//  - persistence: teardown / rebuild, save -> load, Retry (the entry snapshot); dead stay dead, fled stay gone; trade gating;
//  - never in game.zombies, never cargo, never loot; the calm market is untouched until provoked.
import {beforeAll, describe, expect, it} from 'vitest';
import fs from 'node:fs';
import * as THREE from 'three';
import {COMBAT_CLIP, GUN_MARKERS} from '../src/market/combat/combatClips';
import {MARKET_COMBAT, MARKET_COMBAT_TEXT, type MarketCombatant} from '../src/market/combat/marketCombat';
import {MARKET_HOSTILITY} from '../src/market/combat/roles';
import {MARKET_HOSTILITY_LANE, type MarketHostilityJSON} from '../src/market/combat/record';
import {NPC_GUNS, npcRoundDamage} from '../src/market/combat/npcGun';
import {ENEMY_DAMAGE_TO_PLAYER} from '../src/player/hits';
import {armorPool} from '../src/player/armor';
import {WEAPONS} from '../src/weapons/weapons';
import {GEAR_SLOTS} from '../src/items/gear';
import {raycastWorld} from '../src/combat/hitscan';
import {validateSaveFile, parseSaveText} from '../src/save/validate';
import {installRestore, makeSaveFile, prepareRestore, saveFileText} from '../src/save/serialize';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {playerPelletDamage} from '../src/market/combat/marketCombat';
import {combatWorld, loadCombatAssets, rayTo, type CombatAssets} from './helpers/marketCombatFixture';

let A: CombatAssets;
beforeAll(async () => { A = await loadCombatAssets(); });

type World = ReturnType<typeof combatWorld>;
const bonePos = (p: MarketCombatant, n: string) => { p.actor.root.updateMatrixWorld(true); return new THREE.Vector3().setFromMatrixPosition(p.actor.bone(n)!.matrixWorld); };

/** Stand the player about `d` m from a person on its floor, where the eye has a clear world line to its head and chest, looking at it. */
function faceOff(w: World, p: MarketCombatant, d = 3) {
  const a = p.actor, L = w.host.levels, G = L.grid(L.levelAt(a.x, a.z, a.y + 0.05));
  const head = bonePos(p, 'Head'), chest = bonePos(p, 'Spine');
  for (const dd of [d, d - 1, d + 1, d - 1.5, d + 2]) for (let k = 0; k < 36; k++) {
    const ang = a.yaw + (k / 36) * Math.PI * 2, x = a.x + Math.sin(ang) * dd, z = a.z + Math.cos(ang) * dd;
    const [cx, cy] = G.cellOf(x, z);
    if (!G.walkable(cx, cy) || !G.circleClear(x, z, 0.35) || Math.abs(G.cellFloor(cx, cy) - a.y) > 0.05) continue;
    const ok = [head, chest].every(t => { const r = rayTo(new THREE.Vector3(x, a.y + 1.55, z), t); return raycastWorld(L, w.layout.props, r.o, r.d, r.len, w.layout.trench.floorY).t >= r.len - 0.01; });
    if (!ok) continue;
    Object.assign(w.player, {x, y: a.y, z, eye: a.y + 1.62, yaw: Math.atan2(a.x - x, a.z - z)});
    return;
  }
  throw new Error(`no clear spot round ${p.id}`);
}

/** One player trigger pull of `weapon` from `eye` at world point `at` (Game.fire's person path: rayHit -> pellet -> endShot). */
function shootAt(w: World, eye: THREE.Vector3, at: THREE.Vector3, weapon = 'pistol') {
  const def = WEAPONS[weapon], r = rayTo(eye, at);
  const wh = raycastWorld(w.host.levels, w.layout.props, r.o, r.d, def.range, w.layout.trench.floorY);
  const mh = w.combat.rayHit(r.o, r.d, wh.t);
  if (mh) w.combat.pellet(mh.person, playerPelletDamage(def, mh.part, mh.t), at.clone(), new THREE.Vector3(r.d.x, r.d.y, r.d.z), mh.part === 'head', def.id);
  return {mh, out: w.combat.endShot(def)};
}

describe('market people are targets with an ordinary zombie\'s health', () => {
  it('bone volumes: a ray at the head is a head hit, at the chest a torso hit, at a shin a limb hit; the dead have none', () => {
    const w = combatWorld(A);
    w.build();
    const p = w.combat.people.find(x => x.id.startsWith('resident:'))!;
    // from behind (no arm in front of the back), 3 m off, volumes only (no world ray)
    const eye = new THREE.Vector3(p.actor.x - Math.sin(p.actor.yaw) * 3, p.actor.y + 1.5, p.actor.z - Math.cos(p.actor.yaw) * 3);
    const hit = (bone: string, up = 0) => { const b = bonePos(p, bone).add(new THREE.Vector3(0, up, 0)); const r = rayTo(eye, b); return w.combat.rayHit(r.o, r.d, 50); };
    expect(hit('Head', 0.07)?.part).toBe('head');
    expect(hit('Spine')?.part).toBe('torso');
    expect(hit('L_Shin')?.part).toBe('limb');
    expect(hit('Head', 0.6)).toBeNull(); // over the head
    expect(hit('Head', 0.07)?.person).toBe(p);
  });

  it('the player\'s pistol: 3 head shots or 6 body shots kill (100 hp); the first hit makes the settlement hostile, once', () => {
    const w = combatWorld(A);
    w.build();
    expect(w.combat.hostile).toBe(false);
    const p = w.combat.people.find(x => x.id.startsWith('resident:'))!;
    faceOff(w, p, 4);
    const eye = new THREE.Vector3(w.player.x, p.actor.y + 1.55, w.player.z);
    const at = () => bonePos(p, 'Head').add(new THREE.Vector3(0, 0.07, 0));
    let shots = 0;
    while (p.state === 'alive' && shots < 10) { const {mh} = shootAt(w, eye, at()); expect(mh?.part).toBe('head'); shots++; }
    expect(shots).toBe(3);
    expect(p.state).toBe('dead');
    expect(w.combat.hostile).toBe(true);
    expect(w.combat.counts.provoked).toBe(1);
    expect(w.toasts.filter(t => t === MARKET_COMBAT_TEXT.hostile).length).toBe(1);
    expect(w.sfx.confirms).toBe(3);
    // the body: the Death clip (no physics world here), no volumes, bullets pass
    expect(p.actor.current).toBe(COMBAT_CLIP.death);
    expect(shootAt(w, eye, at()).mh).toBeNull();
    // another person: 6 torso rounds
    const q = w.combat.people.find(x => x !== p && x.state === 'alive' && x.id.startsWith('resident:'))!;
    q.actor.x = p.actor.x + 30; // (out of the way; poses are re-read from the bones)
    faceOff(w, q, 4);
    const e2 = new THREE.Vector3(w.player.x, q.actor.y + 1.2, w.player.z);
    let n = 0;
    while (q.state === 'alive' && n < 12) { q.actor.sync(); const {mh} = shootAt(w, e2, bonePos(q, 'Spine')); if (mh) n++; else break; }
    expect(n).toBe(Math.ceil(MARKET_HOSTILITY.hp / WEAPONS.pistol.damage));
    expect(w.combat.counts.provoked).toBe(1);
  });
});

describe('hostility: ~30 % fight with real guns, the rest flee; a theft makes the robbed trader fight', () => {
  it('provoke: roles by the seeded split, fighters draw their gun and aim, fleers run away from the player and leave', () => {
    const w = combatWorld(A);
    w.build();
    const st = w.layout.market!.stalls[2];
    Object.assign(w.player, {x: st.front.x, y: st.front.y, z: st.front.z, eye: st.front.y + 1.62});
    w.combat.provoke({kind: 'attack', person: 'resident:0'});
    w.combat.provoke({kind: 'theft', stall: 'gun'}); // idempotent: once
    expect(w.combat.counts.provoked).toBe(1);
    const fight = w.combat.people.filter(p => p.role === 'fight'), flee = w.combat.people.filter(p => p.role === 'flee');
    expect(fight.length).toBe(Math.max(1, Math.round(w.combat.people.length * 0.3)));
    expect(flee.length).toBe(w.combat.people.length - fight.length);
    const start = new Map(flee.map(p => [p, Math.hypot(p.actor.x - w.player.x, p.actor.z - w.player.z)]));
    w.player.alive = false; // (only the motion here: nobody shoots a dead player)
    w.run(2.5);
    for (const p of fight) { expect(p.body.gunShown, p.id).toBe(true); expect(p.actor.current?.includes(p.gun) || p.actor.loop.includes(p.gun), p.id).toBe(true); }
    for (const p of flee) expect(p.body.gunShown).toBe(false);
    // the fleers: on their way or hidden, farther from the player, never in the train keep-out
    let farther = 0;
    for (let i = 0; i < 300; i++) {
      w.frame();
      for (const p of flee) if (p.state === 'alive') expect(w.people.inKeepout(p.actor.x, p.actor.z, p.actor.y), p.id).toBe(false);
    }
    for (const p of flee) if (p.state === 'fled' || Math.hypot(p.actor.x - w.player.x, p.actor.z - w.player.z) > start.get(p)! + 1) farther++;
    expect(farther / flee.length).toBeGreaterThan(0.6);
    // unseen long enough: they leave the market (out of the scene)
    w.run(16);
    const fled = flee.filter(p => p.state === 'fled');
    expect(fled.length).toBeGreaterThan(0);
    for (const p of fled) expect(p.actor.root.parent).toBeNull();
    expect(w.combat.counts.fled).toBe(fled.length);
  });

  it('a theft at a stall: that trader fights — never flees; no stall trades', () => {
    for (const stall of ['gun', 'medical', 'scrap'] as const) {
      const w = combatWorld(A);
      w.build();
      w.combat.provoke({kind: 'theft', stall});
      const t = w.combat.people.find(p => p.id === `trader:${stall}`)!;
      expect(t.role).toBe('fight');
      expect(w.toasts).toContain(MARKET_COMBAT_TEXT.theft);
      expect(w.combat.canTrade(stall)).toBe(false);
    }
  });
});

describe('their gunfire', () => {
  /** A fighter at its post with the player in open view `d` m in front (on its floor), every other person removed. */
  function duel(seed = 808, d = 7) {
    const w = combatWorld(A, seed);
    w.build();
    w.combat.provoke({kind: 'theft', stall: 'gun'});
    const t = w.combat.people.find(p => p.id === 'trader:gun')!;
    for (const p of w.combat.people) if (p !== t) { p.state = 'fled'; w.people.remove(p.actor); }
    // a clear spot in front of the trader on its storey (the counter between: step to the side of it)
    return {w, t, d};
  }

  /** Put the player on the trader's storey, 4-9 m off, where the trader's eye has a clear world line to the chest. */
  function inTheOpen(w: World, t: MarketCombatant) {
    const G = w.host.levels.grid(w.host.levels.levelAt(t.actor.x, t.actor.z, t.actor.y + 0.05));
    for (let r = 4; r <= 9; r += 1) for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2, x = t.actor.x + Math.sin(a) * r, z = t.actor.z + Math.cos(a) * r;
      const [cx, cy] = G.cellOf(x, z);
      if (!G.walkable(cx, cy) || !G.circleClear(x, z, 0.4) || Math.abs(G.cellFloor(cx, cy) - t.actor.y) > 0.1) continue;
      const eye = t.body.eyeWorld(), chest = new THREE.Vector3(x, t.actor.y + 1.1, z);
      const r1 = rayTo(eye, chest);
      if (raycastWorld(w.host.levels, w.layout.props, r1.o, r1.d, r1.len, w.layout.trench.floorY).t < r1.len - 0.05) continue;
      Object.assign(w.player, {x, y: t.actor.y, z, eye: t.actor.y + 1.62, yaw: 0});
      return;
    }
    throw new Error('no open spot');
  }

  it('fires its real gun at a player in sight: shot sounds, flashes, rounds counted against its magazine; hits through the ENEMY pipeline (x2 once)', () => {
    const {w, t} = duel();
    inTheOpen(w, t);
    const mag0 = t.npc.mag + t.npc.spare;
    w.run(10);
    expect(w.combat.counts.shots).toBeGreaterThan(2);
    expect(w.sfx.shots).toBe(w.combat.counts.shots);
    expect(w.fx.flashes).toBe(w.combat.counts.shots);
    expect(mag0 - (t.npc.mag + t.npc.spare)).toBe(w.combat.counts.shots);
    expect(w.hits.length).toBeGreaterThan(0);
    for (const h of w.hits) {
      expect(h.raw.enemy).toBe(true);
      expect(h.raw.amount).toBeLessThanOrEqual(npcRoundDamage(t.gun, 0) * WEAPONS[t.gun].pellets + 1e-9);
      expect(h.resolved.amount).toBeCloseTo(h.raw.amount * ENEMY_DAMAGE_TO_PLAYER, 9); // x2 exactly once
      expect(h.resolved.applied).toBeCloseTo(h.resolved.amount, 9); // no armour worn
      expect(h.from).toEqual([expect.any(Number), expect.any(Number)]);
    }
  });

  it('armour cuts a survivor\'s round like a zombie\'s claw and wears', () => {
    const {w, t} = duel();
    const vest = w.h.inv.makeStack('armor_vest', 1);
    w.h.inv.gearSlots[GEAR_SLOTS.indexOf('chest')] = vest;
    const pool = armorPool(w.h.inv.gear);
    expect(pool).toBeGreaterThan(0);
    const before = vest.armor;
    const res = w.host.gunshotPlayer({amount: 9, source: 'other', enemy: true, location: 'torso', attacker: 'survivor-pistol'}, t.actor.x, t.actor.z);
    expect(res.amount).toBe(9 * ENEMY_DAMAGE_TO_PLAYER);
    expect(res.applied).toBeCloseTo(res.amount * (1 - pool), 9);
    expect(vest.armor ?? 0).toBeLessThan(before ?? Infinity);
  });

  it('a wall blocks the line: a player behind solid structure is never shot (no round even leaves), in view again he is', () => {
    const {w, t} = duel();
    // a spot on the trader's storey the trader cannot see (walls / slabs between)
    const L = w.host.levels, G = L.grid(L.levelAt(t.actor.x, t.actor.z, t.actor.y + 0.05));
    let hidden: THREE.Vector3 | null = null;
    for (let r = 5; r <= 20 && !hidden; r += 1.5) for (let k = 0; k < 32 && !hidden; k++) {
      const a = (k / 32) * Math.PI * 2, x = t.actor.x + Math.sin(a) * r, z = t.actor.z + Math.cos(a) * r;
      const [cx, cy] = G.cellOf(x, z);
      if (!G.walkable(cx, cy) || !G.circleClear(x, z, 0.4)) continue;
      const y = G.cellFloor(cx, cy), eye = t.body.eyeWorld();
      if (!L.lineOfSight(eye, {x, y: y + 1.62, z}) && !L.lineOfSight(eye, {x, y: y + 1.1, z})) hidden = new THREE.Vector3(x, y, z);
    }
    expect(hidden).not.toBeNull();
    Object.assign(w.player, {x: hidden!.x, y: hidden!.y, z: hidden!.z, eye: hidden!.y + 1.62});
    // pin the shooter at its post (no route: it holds) so only the line matters
    (w.people as unknown as {route: () => null}).route = () => null;
    w.run(6);
    expect(w.combat.counts.shots).toBe(0);
    expect(w.hits.length).toBe(0);
    // a round forced through anyway stops at the wall: the player is not hit
    t.body.gunShown = true;
    t.aimPt = {x: hidden!.x, y: hidden!.y + 1.1, z: hidden!.z};
    (t.npc as {cooldown: number}).cooldown = 0;
    (w.combat as unknown as {shoot(p: MarketCombatant): void}).shoot(t);
    expect(w.hits.length).toBe(0);
    expect(w.combat.log[w.combat.log.length - 1].hit).toBe('miss');
  });

  it('empties its magazine, reloads (positional reload cues, the reload clip at the reload time), then fires on; out of rounds it runs', () => {
    const {w, t} = duel();
    t.npc.mag = 1;
    t.npc.spare = WEAPONS[t.gun].magazine;
    inTheOpen(w, t);
    w.player.hp = 1e9; // (stays standing through the exchange)
    let sawReload = false;
    for (let i = 0; i < 30 * 16 && w.combat.counts.reloads < 1; i++) { w.frame(); if (t.mode === 'reload') { sawReload = true; expect(t.actor.current === COMBAT_CLIP.reload(t.gun) || t.actor.loop === COMBAT_CLIP.reload(t.gun)).toBe(true); } }
    expect(w.combat.counts.shots).toBeGreaterThanOrEqual(1);
    expect(sawReload).toBe(true);
    expect(w.sfx.reloads).toBe(1);
    expect(w.combat.counts.reloads).toBe(1);
    expect(t.npc.mag).toBe(WEAPONS[t.gun].magazine);
    for (let i = 0; i < 30 * 6 && w.combat.counts.shots < 3; i++) w.frame();
    expect(w.combat.counts.shots).toBeGreaterThanOrEqual(2); // fires on after the reload
    // dry: flees
    t.npc.mag = 0; t.npc.spare = 0;
    w.frame();
    expect(t.role).toBe('flee');
    expect(t.body.gunShown).toBe(false);
  });

  it('armed hostiles animate every frame; their guns are the player\'s models in the right hand, muzzle forward when aiming', () => {
    const {w, t} = duel();
    w.player.alive = false;
    w.run(1.5);
    expect(t.body.gunHolder?.parent?.name).toBe(`${t.actor.prefix}R_Hand`);
    // stride 1: the clip time advances every frame
    const a = (t.actor as unknown as {mixer: THREE.AnimationMixer}).mixer;
    const before = a.time;
    w.frame(1 / 30);
    expect(a.time - before).toBeCloseTo(1 / 30, 6);
    // aiming (no pitch): the gun's bore (-Z of its model) along the body's facing
    t.actor.play(COMBAT_CLIP.aim(t.gun), 0);
    t.body.aimPitch = 0;
    for (let i = 0; i < 20; i++) t.actor.animate(1 / 30);
    t.actor.sync();
    t.actor.root.updateMatrixWorld(true);
    const bore = new THREE.Vector3(0, 0, -1).transformDirection(t.body.gunHolder!.matrixWorld);
    const fwd = new THREE.Vector3(Math.sin(t.actor.yaw), 0, Math.cos(t.actor.yaw));
    expect(bore.dot(fwd)).toBeGreaterThan(Math.cos(0.2));
    void GUN_MARKERS; void NPC_GUNS;
  });
});

describe('persistence: dead stay dead, fled stay gone (leave / return, save / load, Retry)', () => {
  function provoked() {
    const w = combatWorld(A);
    w.build();
    w.player.alive = false;
    w.h.takeEntry(); // the level-entry snapshot (calm)
    const victim = w.combat.people.find(p => p.id === 'resident:1')!;
    faceOff(w, victim, 3);
    const eye = new THREE.Vector3(w.player.x, victim.actor.y + 1.55, w.player.z);
    for (let i = 0; i < 4 && victim.state === 'alive'; i++) shootAt(w, eye, bonePos(victim, 'Head').add(new THREE.Vector3(0, 0.07, 0)), 'rifle');
    expect(victim.state).toBe('dead');
    w.player.x += 200; // far away: the fleers hide unseen and leave
    w.run(20);
    return {w, victim};
  }
  const snapshot = (w: World) => w.combat.people.map(p => [p.id, p.state, p.role, p.gun, p.npc.mag, p.npc.spare, Math.round(p.hp)]);

  it('the record is written at once and on every change; teardown -> rebuild restores it (bodies lying where they fell)', () => {
    const {w, victim} = provoked();
    const rec = w.h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE)!;
    expect(rec).toMatchObject({v: 1, hostile: true, cause: 'attack'});
    expect(rec.people['resident:1']).toMatchObject({s: 'dead', hp: 0, posture: 'down'});
    const fledIds = w.combat.people.filter(p => p.state === 'fled').map(p => p.id);
    expect(fledIds.length).toBeGreaterThan(0);
    const at = {x: victim.actor.x, z: victim.actor.z};
    w.teardown();
    const after = w.h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE)!;
    // the alive fleers left while the player was away
    for (const [id, r] of Object.entries(after.people)) if (r.role === 'flee' && r.s !== 'dead') expect(r.s, id).toBe('fled');
    const want = Object.entries(after.people).map(([id, r]) => [id, r.s]);
    w.build();
    expect(w.combat.hostile).toBe(true);
    expect(w.combat.people.map(p => [p.id, p.state])).toEqual(want);
    const v2 = w.combat.people.find(p => p.id === 'resident:1')!;
    expect(v2.actor.x).toBeCloseTo(at.x, 2); // (recorded to the millimetre)
    expect(v2.actor.z).toBeCloseTo(at.z, 2);
    expect(v2.actor.current).toBe(COMBAT_CLIP.death);
    expect(bonePos(v2, 'Head').y - v2.actor.y).toBeLessThan(0.45); // lying
    for (const p of w.combat.people) if (p.state === 'fled') expect(p.actor.root.parent).toBeNull();
    expect(w.host.scene.children.length).toBe(w.combat.people.filter(p => p.state !== 'fled').length);
    // nobody comes back to life, no stall trades
    for (const s of w.layout.market!.stalls) expect(w.combat.canTrade(s.id)).toBe(false);
    void fledIds;
  });

  it('save -> export text -> import -> load -> build: the same hostile market; a malformed record is refused', () => {
    const {w} = provoked();
    const want = snapshot(w);
    const text = saveFileText(w.h.file('arrival'));
    const v = parseSaveText(text);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const u = combatWorld(A);
    installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
    u.build();
    // (alive fighters keep their state; alive fleers were mid-hide when saved: still there, still fleeing)
    expect(snapshot(u)).toEqual(want);
    expect(u.combat.hostile).toBe(true);
    // corrupt it: refused at import
    const run = structuredClone(v.value.run) as unknown as {memories: Record<string, {lanes: Record<string, MarketHostilityJSON>}>};
    const mem = Object.values(run.memories).find(m => m.lanes[MARKET_HOSTILITY_LANE])!;
    mem.lanes[MARKET_HOSTILITY_LANE].people['resident:1'].hp = 50; // a dead body with hp
    const bad = validateSaveFile(makeSaveFile(run as never, w.h.file('arrival').meta));
    expect(bad.ok).toBe(false);
  });

  it('Retry: back to the level-entry snapshot (here: before the provocation) — the market is calm again', () => {
    const {w} = provoked();
    const snap = w.h.run.entry!;
    const key = {...w.h.run.current};
    w.teardown();
    w.h.run.restoreScopeMemories(key, snap.memories);
    const inv = restoreCarry(snap, {player: w.h.player, survival: w.h.survival, battery: w.h.battery, stats: w.h.stats});
    w.h.inv.loadJSON(inv.toJSON());
    restoreParticipants(snap, w.h.participants);
    w.build();
    expect(w.combat.hostile).toBe(false);
    expect(w.combat.people.every(p => p.state === 'alive')).toBe(true);
    expect(w.combat.canTrade('gun')).toBe(true);
    // a hostile market at entry stays hostile on Retry
    const {w: w2} = provoked();
    w2.h.takeEntry();
    const snap2 = w2.h.run.entry!;
    w2.teardown();
    w2.h.run.restoreScopeMemories({...w2.h.run.current}, snap2.memories);
    w2.build();
    expect(w2.combat.hostile).toBe(true);
    expect(w2.combat.people.find(p => p.id === 'resident:1')!.state).toBe('dead');
  });
});

describe('the calm market, trade gating, not an enemy', () => {
  it('until provoked nothing changes: no record, the calm frame runs, every trader can trade', () => {
    const w = combatWorld(A);
    w.build();
    Object.assign(w.player, {x: w.layout.market!.stalls[0].front.x, y: 0, z: w.layout.market!.stalls[0].front.z});
    w.run(5);
    expect(w.combat.hostile).toBe(false);
    expect(w.h.run.laneStore(MARKET_HOSTILITY_LANE)).toBeUndefined();
    for (const s of w.layout.market!.stalls) expect(w.combat.canTrade(s.id)).toBe(true);
    expect(w.combat.people.every(p => !p.body.gunShown)).toBe(true);
    expect(w.people.counts.arrivals + w.people.counts.paths).toBeGreaterThanOrEqual(0);
  });

  it('never joins game.zombies, never cargo, never loot; the module never scales a hit itself', () => {
    const w = combatWorld(A);
    w.build();
    w.combat.provoke({kind: 'theft', stall: 'fuel'});
    w.run(3);
    expect(w.host.zombies.length).toBe(0);
    const src = (f: string) => fs.readFileSync(new URL(`../src/market/combat/${f}`, import.meta.url), 'utf8');
    for (const f of ['marketCombat.ts', 'body.ts', 'npcGun.ts', 'roles.ts', 'combatClips.ts', 'humanRig.ts', 'record.ts']) {
      const s = src(f).replace(/\/\/.*$/gm, ''); // (code, not the comments that say "never game.zombies")
      expect(s, f).not.toMatch(/\.zombies\b|trainCargo|propCargo|pickups\.|spawnPickup|lootTable|incomingHit|ENEMY_DAMAGE_TO_PLAYER|armorHit/);
    }
    // the player's ENEMY pipeline: Game.gunshotPlayer -> blastPlayer -> applyPlayerHit; the round is attributed enemy: true
    const game = fs.readFileSync(new URL('../src/game.ts', import.meta.url), 'utf8');
    expect(game).toMatch(/gunshotPlayer\(hit: PlayerHit, fromX: number, fromZ: number\): ResolvedHit \{\s*return this\.blastPlayer\(hit, fromX, fromZ\);/);
    expect(game).toMatch(/blastPlayer\(hit: PlayerHit, fromX: number, fromZ: number\): ResolvedHit \{\s*const p = this\.player, resolved = this\.applyPlayerHit\(hit\);/);
    expect(src('marketCombat.ts')).toMatch(/this\.host\.gunshotPlayer\(\{amount: raw, source: 'other', enemy: true,/);
    // Game.fire: the person test per ray after the enemy test, aggregated per trigger pull; the knife too
    expect(game).toMatch(/const mh = this\.marketCombat\.rayHit\(o, d, bestT\);/);
    expect(game).toMatch(/this\.marketCombat\.pellet\(bestP, playerPelletDamage\(def,/);
    expect(game).toMatch(/const people = this\.marketCombat\.endShot\(def\);/);
    expect(game).toMatch(/\.\.\.this\.marketCombat\.meleeTargets\(\)\]/);
    expect(game).toMatch(/this\.marketHostility = this\.marketCombat;/);
  });

  it('the robbed-trader path the wares lane uses: Game.marketHostility.provoke({kind: "theft", stall}) is optional-safe where no market is built', () => {
    const w = combatWorld(A);
    // not built: inert
    w.combat.provoke({kind: 'theft', stall: 'gun'});
    expect(w.combat.hostile).toBe(false);
    expect(w.combat.canTrade('gun')).toBe(true);
    w.build();
    w.combat.provoke({kind: 'theft', stall: 'gun'});
    expect(w.combat.hostile).toBe(true);
    expect(w.combat.canTrade('gun')).toBe(false);
    void MARKET_COMBAT;
  });
});
