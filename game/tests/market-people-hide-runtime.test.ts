// Task studio-market-bar-20261108-225231-01 (lane PEOPLE): the market's fleers HIDE IN HOMES, driven in Node on REAL generated markets
// (levels, path finder, props, the parked train) with the real cast (market/combat/marketCombat.ts + market/people/refuges.ts). User:
// "Fleeing survivors must hide in homes, not disappear/despawn. Increase attackers to 50%."
//  - provoked: half fight, half flee; every fleer runs (real routes: doors, stairs; never through a wall, never into the train's keep-out,
//    never off the floor) to its refuge and hides in its slot, ALIVE and PRESENT (never removed from the scene or the people lists);
//  - a hider seen up close flinches (a scream) and stays; shot, it stays (cornered, still a target);
//  - persistence: teardown / rebuild, save -> export -> import -> load, Retry; a fleer the player left behind reaches its refuge meanwhile;
//  - an OLD record's 'fled' people come back as hiders in a refuge (hp / gun / rounds / role kept), the dead stay dead, the record is
//    rewritten in version 2 — on the container settlement and on the first (shed) market, whose refuges are its under-deck rooms;
//  - voices at events (a stub Game.marketAudio): screams when fleers panic / run / flinch, grunts when fighters draw / are hit;
//  - the player's detectability (a stub Game.beerEffects.perceptionMult) read once a frame and applied once (the sight distance).
import {beforeAll, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {MarketCombatant} from '../src/market/combat/marketCombat';
import {MARKET_COMBAT} from '../src/market/combat/marketCombat';
import {COMBAT_CLIP} from '../src/market/combat/combatClips';
import {MARKET_HOSTILITY_LANE, marketHostilityProblem, type MarketHostilityJSON} from '../src/market/combat/record';
import {fighterCount} from '../src/market/combat/roles';
import {MARKET_PEOPLE} from '../src/market/marketPeople';
import {WEAPONS} from '../src/weapons/weapons';
import {playerPelletDamage} from '../src/market/combat/marketCombat';
import {validateSaveFile, parseSaveText} from '../src/save/validate';
import {installRestore, makeSaveFile, prepareRestore, saveFileText} from '../src/save/serialize';
import {restoreCarry, restoreParticipants} from '../src/run/snapshot';
import {combatWorld, loadCombatAssets, rayTo, type CombatAssets} from './helpers/marketCombatFixture';

let A: CombatAssets;
beforeAll(async () => { A = await loadCombatAssets(); });

type World = ReturnType<typeof combatWorld>;
const fleers = (w: World) => w.combat.people.filter(p => p.role === 'flee' && p.state === 'alive');
const inScene = (w: World, p: MarketCombatant) => { let o: THREE.Object3D | null = p.actor.root; while (o?.parent) o = o.parent; return o === w.host.scene; };

/** Every frame: each alive person on a supported floor of a storey, not inside a wall, never in the train keep-out. */
function checkBodies(w: World, tag: string): void {
  const L = w.host.levels;
  for (const p of w.combat.people) {
    if (p.state !== 'alive') continue;
    const a = p.actor;
    expect(w.people.inKeepout(a.x, a.z, a.y), `${tag} ${p.id} in the train keep-out`).toBe(false);
    expect(L.supportIn(a.x, a.z, a.y, 0.35), `${tag} ${p.id} off the floor at ${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)}`).not.toBeNull();
    expect(L.circleClear(a.x, a.z, 0.12, a.y), `${tag} ${p.id} inside a wall at ${a.x.toFixed(2)},${a.y.toFixed(2)},${a.z.toFixed(2)}`).toBe(true);
    const bed = w.layout.trenches.find(t => a.x > t.x0 && a.x < t.x1 && a.z > t.z0 && a.z < t.z1 && Math.abs(a.y - t.floorY) < 0.6);
    expect(bed, `${tag} ${p.id} in the track bed`).toBeUndefined();
  }
}

/** Provoked with the player well away (out of everyone's way), run until the fleers are home. */
function provokedAway(seed = 808, o: Parameters<typeof combatWorld>[2] = {}, seconds = 40) {
  const w = combatWorld(A, seed, o);
  w.build();
  w.player.alive = false; // (only the motion here: nobody shoots)
  const st = w.layout.market!.stalls[0];
  Object.assign(w.player, {x: st.front.x, y: st.front.y, z: st.front.z, eye: st.front.y + 1.62});
  w.combat.provoke({kind: 'attack', person: 'resident:0'});
  w.player.x += 400; // gone: no route passes the player
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) { w.frame(dt); if (Math.round(t / dt) % 10 === 0) checkBodies(w, `t ${t.toFixed(1)}`); }
  return w;
}

describe('half fight, half flee; the fleers run home and hide — alive and present', () => {
  it('provoked: round(n / 2) fighters; every fleer reaches a refuge slot (its home first) and cowers there, never removed', () => {
    for (const seed of [808, 1234]) {
      const w = provokedAway(seed);
      const n = w.combat.people.length;
      expect(w.combat.people.filter(p => p.role === 'fight').length).toBe(fighterCount(n));
      const book = w.combat.refugeBook();
      const F = fleers(w);
      expect(F.length).toBe(n - fighterCount(n));
      for (const p of F) {
        const c = book.claimOf(p.id)!;
        expect(c, p.id).toBeDefined();
        expect(c.refuge.kind, p.id).toBe('home'); // (plenty of homes for half the settlement)
        expect(p.hidden, `${p.id} hidden`).toBe(true);
        expect(p.mode).toBe('hide');
        expect(book.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z), `${p.id} inside ${c.refuge.id}`).toBe(true);
        const s = c.refuge.slots[c.slot];
        expect(Math.hypot(s.x - p.actor.x, s.z - p.actor.z), `${p.id} at its slot`).toBeLessThan(MARKET_PEOPLE.arrive + 0.35);
        expect(p.actor.loop).toBe(COMBAT_CLIP.cower);
        // nobody in a doorway
        for (const m of c.refuge.mouths) expect(Math.hypot(m.x - p.actor.x, m.z - p.actor.z)).toBeGreaterThan(0.9);
        // present: in the scene, in the people lists, a target
        expect(inScene(w, p), `${p.id} in the scene`).toBe(true);
        expect(w.people.roster.some(r => r.actor === p.actor)).toBe(true);
        expect(p.body.hitVolumes(9999, true).length).toBeGreaterThan(0);
      }
      // one person per slot
      const keys = F.map(p => `${book.claimOf(p.id)!.refuge.id}#${book.claimOf(p.id)!.slot}`);
      expect(new Set(keys).size).toBe(keys.length);
      expect(w.host.scene.children.length).toBe(w.combat.people.length);
      expect(w.combat.counts.hidden).toBeGreaterThanOrEqual(F.length);
    }
  });

  it('they walk there (path-finder routes ending in the refuge): continuous motion — no jump, no teleport — up the stairs to the catwalk homes', () => {
    const w = combatWorld(A, 808);
    w.build();
    w.player.alive = false;
    w.combat.provoke({kind: 'attack', person: 'resident:0'});
    w.player.x += 400;
    const book = w.combat.refugeBook(), L = w.host.levels;
    const F = fleers(w);
    const start = new Map(F.map(p => [p.id, L.levelAt(p.actor.x, p.actor.z, p.actor.y)]));
    const last = new Map(F.map(p => [p.id, {x: p.actor.x, y: p.actor.y, z: p.actor.z}]));
    const ends = new Map<string, boolean>();
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 40; i++) {
      w.frame(dt);
      for (const p of F) {
        const a = p.actor, q = last.get(p.id)!;
        // a running person moves at most its speed (+ the separation's push) per frame; its feet follow the floor (a stair step at most)
        expect(Math.hypot(a.x - q.x, a.z - q.z), `${p.id} frame ${i}`).toBeLessThan(p.speed * dt + 0.2);
        expect(Math.abs(a.y - q.y), `${p.id} frame ${i} dy`).toBeLessThan(0.5);
        last.set(p.id, {x: a.x, y: a.y, z: a.z});
        if (p.path) { const e = p.path[p.path.length - 1], c = book.claimOf(p.id)!; ends.set(p.id, (ends.get(p.id) ?? true) && book.inside(c.refuge, e[0], e[3] ?? c.refuge.slots[c.slot].y, e[1])); }
      }
      if (i % 15 === 0) checkBodies(w, `frame ${i}`);
    }
    for (const p of F) expect(ends.get(p.id), `${p.id}: every route ends inside its refuge`).toBe(true);
    for (const p of F) expect(p.hidden, `${p.id} home`).toBe(true);
    // homes up on the catwalks: some climbed the stairs to get there
    expect(F.some(p => start.get(p.id) !== book.claimOf(p.id)!.refuge.level)).toBe(true);
  });

  it('a hider seen up close flinches and screams but stays; shot, it stays in its refuge (still a target); killed, its body stays', () => {
    const audio = {screams: [] as string[], grunts: [] as string[]};
    const w = provokedAway(808, {marketAudio: {scream: id => { audio.screams.push(id); }, grunt: id => { audio.grunts.push(id); }}});
    const p = fleers(w)[0], book = w.combat.refugeBook(), c = book.claimOf(p.id)!;
    // the player walks into the refuge's doorway, in sight
    const m = c.refuge.mouths[0];
    Object.assign(w.player, {alive: true, x: m.x, y: c.refuge.slots[0].y, z: m.z, eye: c.refuge.slots[0].y + 1.62});
    // (keep the fighters out of it: far away, never seeing)
    for (const f of w.combat.people) if (f.role === 'fight') { f.actor.x += 300; }
    const s0 = audio.screams.filter(i => i === p.id).length, f0 = w.combat.counts.flinches;
    w.run(4);
    expect(w.combat.counts.flinches).toBeGreaterThan(f0);
    expect(audio.screams.filter(i => i === p.id).length).toBeGreaterThan(s0);
    expect(p.hidden).toBe(true);
    expect(book.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z)).toBe(true);
    expect(inScene(w, p)).toBe(true);
    // shot (a pistol round to the body): hurt, a scream, still hiding in its refuge
    const eye = new THREE.Vector3(w.player.x, w.player.eye, w.player.z);
    p.actor.root.updateMatrixWorld(true);
    const chest = new THREE.Vector3().setFromMatrixPosition(p.actor.bone('Spine')!.matrixWorld);
    const r = rayTo(eye, chest);
    const hit = w.combat.rayHit(r.o, r.d, 50);
    expect(hit?.person).toBe(p);
    const s1 = audio.screams.length;
    w.combat.pellet(p, playerPelletDamage(WEAPONS.pistol, hit!.part, hit!.t), chest, new THREE.Vector3(r.d.x, r.d.y, r.d.z), false, 'pistol');
    w.combat.endShot(WEAPONS.pistol);
    expect(p.hp).toBeLessThan(100);
    expect(audio.screams.length).toBeGreaterThan(s1);
    w.run(2);
    expect(p.state).toBe('alive');
    expect(p.hidden).toBe(true);
    expect(book.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z)).toBe(true);
    // killed: the body lies in its refuge (present)
    p.hp = 1;
    (w.combat as unknown as {damage(p: MarketCombatant, n: number, h: boolean, a: THREE.Vector3, b: THREE.Vector3, w: string, x: number, y: number): boolean}).damage(p, 50, false, chest, new THREE.Vector3(0, 0, 1), 'pistol', 1, 1);
    expect(p.state).toBe('dead');
    expect(inScene(w, p)).toBe(true);
  });

  it('a blocked way home (the player standing in it): the fleer cowers where it is and tries again; once the way is free it goes home', () => {
    const w = combatWorld(A, 808);
    w.build();
    w.player.alive = false;
    w.combat.provoke({kind: 'attack', person: 'resident:0'});
    const p = w.combat.people.find(q => q.role === 'flee' && q.state === 'alive')!;
    // stand right on the person: every route out passes within MARKET_COMBAT.passGap
    Object.assign(w.player, {x: p.actor.x + 0.6, y: p.actor.y, z: p.actor.z});
    w.run(3);
    expect(p.mode).toBe('hide');
    expect(p.hidden).toBe(false); // (stranded, not in a refuge)
    expect(p.actor.loop).toBe(COMBAT_CLIP.cower);
    expect(inScene(w, p)).toBe(true);
    w.player.x += 400;
    w.run(40);
    expect(p.hidden).toBe(true);
    expect(w.combat.refugeBook().inside(w.combat.refugeBook().claimOf(p.id)!.refuge, p.actor.x, p.actor.y, p.actor.z)).toBe(true);
  });
});

describe('persistence: hiding survives leaving, save / load and Retry', () => {
  const snap = (w: World) => w.combat.people.map(p => [p.id, p.state, p.role, p.gun, p.npc.mag, p.npc.spare, Math.round(p.hp), p.hidden, w.combat.refugeBook().claimOf(p.id)?.refuge.id ?? null]);

  it('the record (version 2) names every alive fleer\'s refuge; teardown -> rebuild: the hiders cower where they hid, in their refuges', () => {
    const w = provokedAway(808);
    const rec = w.h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE)!;
    expect(rec.v).toBe(2);
    expect(marketHostilityProblem(rec)).toBeNull();
    for (const p of fleers(w)) expect(rec.people[p.id]).toMatchObject({s: 'alive', posture: 'hide', refuge: w.combat.refugeBook().claimOf(p.id)!.refuge.id});
    expect(Object.values(rec.people).some(r => (r.s as string) === 'fled')).toBe(false);
    const where = new Map(fleers(w).map(p => [p.id, [p.actor.x, p.actor.y, p.actor.z]]));
    const want = snap(w);
    w.teardown();
    w.build();
    expect(snap(w)).toEqual(want);
    for (const p of fleers(w)) {
      const [x, y, z] = where.get(p.id)!;
      expect([p.actor.x, p.actor.y, p.actor.z].map(v => +v.toFixed(2))).toEqual([x, y, z].map(v => +v.toFixed(2)));
      expect(p.mode).toBe('hide');
      expect(p.actor.current).toBe(COMBAT_CLIP.cower);
      expect(inScene(w, p)).toBe(true);
    }
    expect(w.host.scene.children.length).toBe(w.combat.people.length);
  });

  it('a fleer still on its way when the player leaves is home on return (it had found its route); one that never ran resumes from where it was', () => {
    const w = combatWorld(A, 1234);
    w.build();
    w.player.alive = false;
    w.combat.provoke({kind: 'attack', person: 'resident:0'});
    w.player.x += 400;
    w.run(1.2); // (some are on their way, none home yet)
    const running = fleers(w).filter(p => p.mode === 'flee' && p.routed);
    expect(running.length).toBeGreaterThan(0);
    w.teardown();
    const rec = w.h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE)!;
    w.build();
    for (const p of running) {
      const q = w.combat.people.find(o => o.id === p.id)!;
      expect(rec.people[p.id].posture).toBe('hide');
      expect(q.hidden).toBe(true);
      const c = w.combat.refugeBook().claimOf(q.id)!;
      expect(w.combat.refugeBook().inside(c.refuge, q.actor.x, q.actor.y, q.actor.z)).toBe(true);
    }
  });

  it('save -> export text -> import -> load -> build: the same hiders in the same refuges; Retry to a calm entry is calm again', () => {
    const w = provokedAway(808);
    w.h.takeEntry();
    const want = snap(w);
    const v = parseSaveText(saveFileText(w.h.file('arrival')));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    const u = combatWorld(A, 808);
    installRestore(prepareRestore(v.value.run, u.h.makeRun), u.h.target());
    u.build();
    expect(snap(u)).toEqual(want);
    // Retry: a calm entry snapshot -> calm, everyone alive and home
    const c = combatWorld(A, 808);
    c.build();
    c.h.takeEntry();
    const entry = c.h.run.entry!;
    c.combat.provoke({kind: 'attack', person: 'resident:0'});
    c.run(2);
    const key = {...c.h.run.current};
    c.teardown();
    c.h.run.restoreScopeMemories(key, entry.memories);
    const inv = restoreCarry(entry, {player: c.h.player, survival: c.h.survival, battery: c.h.battery, stats: c.h.stats});
    c.h.inv.loadJSON(inv.toJSON());
    restoreParticipants(entry, c.h.participants);
    c.build();
    expect(c.combat.hostile).toBe(false);
    expect(c.combat.people.every(p => p.state === 'alive' && !p.hidden)).toBe(true);
  });
});

describe('old saves: version-1 records with FLED people', () => {
  /** A version-1 record as the old build wrote it: alive fleers that had left -> 'fled' (no position), one victim dead. */
  function oldRecord(w: World): MarketHostilityJSON {
    const ids = w.combat.people.map(p => p.id);
    const people: MarketHostilityJSON['people'] = {};
    ids.forEach((id, i) => {
      const p = w.combat.people[i], a = p.actor;
      const fight = i % 2 === 0;
      const base = {role: fight ? 'fight' as const : 'flee' as const, gun: p.gun, mag: 3 + i, spare: 10 + i};
      if (i === 1) people[id] = {...base, s: 'dead', hp: 0, posture: 'down', x: a.x, y: a.y, z: a.z, yaw: 0.3};
      else if (fight) people[id] = {...base, s: 'alive', hp: 40 + i, posture: 'fight', x: a.x, y: a.y, z: a.z, yaw: 0};
      else people[id] = {...base, s: 'fled', hp: 30 + i, posture: 'flee'};
    });
    return {v: 1, hostile: true, cause: 'attack', people};
  }

  for (const [label, version, seed] of [['the container settlement (v2)', 2, 808], ['the first shed market (v1, no homes)', 1, 808]] as const) {
    it(`${label}: the fled come back as hiders in refuges (hp / gun / rounds / role kept), the dead stay dead, the record becomes version 2`, () => {
      const w = combatWorld(A, seed, {layoutVersion: version});
      w.build();
      const rec = oldRecord(w);
      expect(marketHostilityProblem(rec)).toBeNull();
      w.teardown();
      w.h.run.setLaneStore(MARKET_HOSTILITY_LANE, rec);
      w.build();
      expect(w.combat.hostile).toBe(true);
      const book = w.combat.refugeBook();
      const kinds = new Set<string>();
      for (const p of w.combat.people) {
        const r = rec.people[p.id];
        expect(p.role).toBe(r.role);
        expect([p.npc.mag, p.npc.spare]).toEqual([r.mag, r.spare]);
        expect(inScene(w, p), `${p.id} in the scene`).toBe(true);
        if (r.s === 'dead') { expect(p.state).toBe('dead'); expect(p.hp).toBe(0); continue; }
        expect(p.state).toBe('alive');
        expect(p.hp).toBe(r.hp);
        if (r.s === 'fled') {
          const c = book.claimOf(p.id)!;
          expect(c, p.id).toBeDefined();
          kinds.add(c.refuge.kind);
          expect(p.hidden).toBe(true);
          expect(book.inside(c.refuge, p.actor.x, p.actor.y, p.actor.z)).toBe(true);
          expect(p.actor.current).toBe(COMBAT_CLIP.cower);
        }
      }
      if (version === 2) expect(kinds).toEqual(new Set(['home']));
      else expect([...kinds].every(k => k === 'bunks' || k === 'room')).toBe(true);
      expect(w.combat.counts.migrated).toBe(Object.values(rec.people).filter(r => r.s === 'fled').length);
      const now = w.h.run.laneStore<MarketHostilityJSON>(MARKET_HOSTILITY_LANE)!;
      expect(now.v).toBe(2);
      expect(marketHostilityProblem(now)).toBeNull();
      for (const [id, r] of Object.entries(rec.people)) if (r.s === 'fled') expect(now.people[id]).toMatchObject({s: 'alive', posture: 'hide', hp: r.hp, mag: r.mag, spare: r.spare});
      // the rewritten record goes through a save file (export -> import validates every lane store)
      expect(parseSaveText(saveFileText(w.h.file('arrival'))).ok).toBe(true);
    });
  }
});

describe('voices and detection (the seams: Game.marketAudio, Game.beerEffects)', () => {
  it('screams when fleers panic and run, grunts when fighters draw and are hit; nothing from a hider nobody sees', () => {
    const calls: {kind: 'scream' | 'grunt'; id: string; y: number}[] = [];
    const w = combatWorld(A, 808, {marketAudio: {scream: (id, _x, y) => { calls.push({kind: 'scream', id, y}); }, grunt: (id, _x, y) => { calls.push({kind: 'grunt', id, y}); }}});
    w.build();
    w.player.alive = false;
    const st = w.layout.market!.stalls[0];
    Object.assign(w.player, {x: st.front.x, y: st.front.y, z: st.front.z, eye: st.front.y + 1.62});
    w.combat.provoke({kind: 'attack', person: 'resident:0'});
    expect(calls.length).toBe(0); // (the voices come with the reactions, staggered: not all at the provocation)
    w.run(2);
    const F = w.combat.people.filter(p => p.role === 'flee'), Fi = w.combat.people.filter(p => p.role === 'fight');
    for (const p of F) expect(calls.some(c => c.kind === 'scream' && c.id === p.id), `${p.id} screams`).toBe(true);
    for (const p of Fi) expect(calls.some(c => c.kind === 'grunt' && c.id === p.id), `${p.id} grunts`).toBe(true);
    expect(calls.every(c => (c.kind === 'scream') === F.some(p => p.id === c.id))).toBe(true); // fleers scream, fighters grunt
    // at the head, not the feet
    for (const c of calls) { const p = w.combat.people.find(q => q.id === c.id)!; expect(c.y - p.actor.y).toBeGreaterThan(1.3); }
    // running: more screams now and then, never every frame
    w.player.x += 400;
    const n0 = calls.length;
    w.run(6);
    const during = calls.length - n0;
    expect(during).toBeGreaterThan(0);
    expect(during).toBeLessThan(F.length * 6 / MARKET_COMBAT.scream[0] + F.length);
    // all home, nobody near: silence from the hiders
    w.run(40);
    const quiet = calls.length;
    w.run(10);
    expect(calls.slice(quiet).filter(c => c.kind === 'scream').length).toBe(0);
    // a fighter hit: a grunt
    const f = Fi.find(p => p.state === 'alive')!;
    const g0 = calls.filter(c => c.kind === 'grunt' && c.id === f.id).length;
    (w.combat as unknown as {damage(p: MarketCombatant, n: number, h: boolean, a: THREE.Vector3, b: THREE.Vector3, w: string, x: number, y: number): boolean}).damage(f, 5, false, new THREE.Vector3(f.actor.x, f.actor.y + 1, f.actor.z), new THREE.Vector3(0, 0, 1), 'pistol', 1, 1);
    expect(calls.filter(c => c.kind === 'grunt' && c.id === f.id).length).toBe(g0 + 1);
  });

  it('the detectability factor is read once a frame and scales the sight distance once (60 m x k), never compounded', () => {
    let k = 1, reads = 0;
    const w = combatWorld(A, 808, {beerEffects: {perceptionMult: () => { reads++; return k; }}});
    w.build();
    w.combat.provoke({kind: 'theft', stall: 'gun'});
    const t = w.combat.people.find(p => p.id === 'trader:gun')!;
    // a clear line from the trader's eye to a point d m away on its storey
    const L = w.host.levels, G = L.grid(L.levelAt(t.actor.x, t.actor.z, t.actor.y + 0.05));
    let spot: {x: number; y: number; z: number; d: number} | null = null;
    for (let d = 14; d >= 8 && !spot; d -= 1) for (let i = 0; i < 48 && !spot; i++) {
      const ang = (i / 48) * Math.PI * 2, x = t.actor.x + Math.sin(ang) * d, z = t.actor.z + Math.cos(ang) * d;
      const [cx, cy] = G.cellOf(x, z);
      if (!G.walkable(cx, cy) || Math.abs(G.cellFloor(cx, cy) - t.actor.y) > 0.05) continue;
      const y = G.cellFloor(cx, cy), eye = t.body.eyeWorld();
      if (L.lineOfSight(eye, {x, y: y + 1.62, z})) spot = {x, y, z, d: Math.hypot(eye.x - x, eye.z - z)};
    }
    expect(spot).not.toBeNull();
    for (const p of w.combat.people) if (p !== t) { p.actor.x += 300; }
    Object.assign(w.player, {x: spot!.x, y: spot!.y, z: spot!.z, eye: spot!.y + 1.62, alive: true});
    const frames = 20;
    // k so the sight reaches past the player: seen; k so it stops short (but k x k would still be... never applied twice): not seen
    k = (spot!.d + 3) / MARKET_COMBAT.sight;
    reads = 0;
    w.run(frames / 30);
    expect(reads).toBe(frames); // once per frame, not per person / per check
    expect(t.sees).toBe(true);
    k = (spot!.d - 1.5) / MARKET_COMBAT.sight;
    w.run(frames / 30);
    expect(t.sees).toBe(false);
    // (k applied once: with sqrt(k) the line would reach; with k it does not)
    expect(MARKET_COMBAT.sight * Math.sqrt(k)).toBeGreaterThan(spot!.d);
    k = 1;
    w.run(frames / 30);
    expect(t.sees).toBe(true);
  });
});
