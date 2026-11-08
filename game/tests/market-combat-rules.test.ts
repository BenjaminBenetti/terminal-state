// Task studio-market-rework-20261108-074144-01 (lane COMBAT): the market hostility's pure rules —
//  - survivors have an ORDINARY zombie's health (ai/brain.ts ZOMBIE_STATS.shambler), the player's weapons unchanged;
//  - the 70 / 30 split over seeds (round(0.3 n) fighters, at least one), the robbed trader always fights, roles / guns / rounds seeded and
//    stable per station + person, all three real guns used;
//  - an NPC gun's cadence (single shots / bursts, never faster than the player's gun), magazine, reloads (magazine / shell by shell);
//  - a round's raw damage (the gun's falloff x the NPC scale, before the player's pipeline), where it lands on the player's body;
//  - the hostility record's validator (save/validate.ts runs it on every lane store).
import {describe, expect, it} from 'vitest';
import {ZOMBIE_STATS} from '../src/ai/brain';
import {WEAPONS, WeaponController} from '../src/weapons/weapons';
import {MARKET_STALLS} from '../src/gen/market/marketTypes';
import {MARKET_HOSTILITY, ammoFor, assignRoles, fighterCount, gunFor} from '../src/market/combat/roles';
import {NPC_GUNS, NpcGun, coneDir, npcReloadTime, npcRoundDamage, playerBulletHit, playerChest, type PlayerBody} from '../src/market/combat/npcGun';
import {MARKET_GUNS, marketHostilityProblem, residentId, traderId, type MarketHostilityJSON} from '../src/market/combat/record';
import {mulberry32} from '../src/core/rng';
import {meleeHitsToKill} from '../src/combat/melee';
import {playerPelletDamage} from '../src/market/combat/marketCombat';

const ids = (residents: number) => [...MARKET_STALLS.map(traderId), ...Array.from({length: residents}, (_, i) => residentId(i))];

describe('health: an ordinary zombie, the player\'s weapons unchanged', () => {
  it('100 hp = the shambler (not the coated zombie, a boss, the Siren or the Strainer)', () => {
    expect(MARKET_HOSTILITY.hp).toBe(ZOMBIE_STATS.shambler.hp);
    expect(MARKET_HOSTILITY.hp).toBeLessThan(ZOMBIE_STATS.coated.hp);
  });

  it('hits to kill match an ordinary zombie\'s (the same damage formula as Game.fire / the knife)', () => {
    const hits = (w: string, part: 'head' | 'torso' | 'limb', t = 5) => Math.ceil(MARKET_HOSTILITY.hp / playerPelletDamage(WEAPONS[w], part, t) - 1e-9);
    expect([hits('pistol', 'head'), hits('pistol', 'torso'), hits('pistol', 'limb')]).toEqual([3, 6, 9]);
    expect([hits('rifle', 'head'), hits('rifle', 'torso')]).toEqual([2, 5]);
    expect(playerPelletDamage(WEAPONS.shotgun, 'torso', 3) * WEAPONS.shotgun.pellets).toBeGreaterThanOrEqual(MARKET_HOSTILITY.hp); // a close shotgun blast
    expect([meleeHitsToKill(WEAPONS.knife, 'head', MARKET_HOSTILITY.hp), meleeHitsToKill(WEAPONS.knife, 'torso', MARKET_HOSTILITY.hp)]).toEqual([2, 4]);
    // the formula is fire()'s: damage x falloff x the part multiplier
    expect(playerPelletDamage(WEAPONS.rifle, 'head', 60)).toBeCloseTo(WEAPONS.rifle.damage * WeaponController.falloff(WEAPONS.rifle, 60) * WEAPONS.rifle.headMult, 9);
  });
});

describe('roles: ~70 % flee, ~30 % fight; the robbed trader fights', () => {
  it('round(0.3 n) fighters (at least one); over many stations every person fights ~30 % of the time', () => {
    expect([fighterCount(0), fighterCount(1), fighterCount(3), fighterCount(10), fighterCount(18), fighterCount(20)]).toEqual([0, 1, 1, 3, 5, 6]);
    const list = ids(12), tally = new Map(list.map(id => [id, 0]));
    let fighters = 0;
    const N = 400;
    for (let s = 1; s <= N; s++) {
      const r = assignRoles(s * 7919, list);
      const f = [...r.values()].filter(v => v === 'fight').length;
      expect(f).toBe(fighterCount(list.length));
      fighters += f;
      for (const [id, role] of r) if (role === 'fight') tally.set(id, tally.get(id)! + 1);
    }
    expect(fighters / (N * list.length)).toBeCloseTo(fighterCount(18) / 18, 6);
    for (const [id, n] of tally) expect(n / N, id).toBeGreaterThan(0.17), expect(n / N, id).toBeLessThan(0.4);
  });

  it('a theft: the robbed stall\'s trader always fights (taking a fighter\'s place: the split is unchanged); stable per station', () => {
    const list = ids(10);
    for (let s = 1; s <= 120; s++) {
      for (const stall of MARKET_STALLS) {
        const r = assignRoles(s, list, stall);
        expect(r.get(traderId(stall)), `seed ${s} ${stall}`).toBe('fight');
        expect([...r.values()].filter(v => v === 'fight').length).toBe(fighterCount(list.length));
      }
      expect([...assignRoles(s, list).entries()]).toEqual([...assignRoles(s, list).entries()]);
    }
  });

  it('guns are seeded per station + person, every real gun is used, rounds are a full magazine + 1-3 spare magazines', () => {
    const seen = new Map(MARKET_GUNS.map(g => [g, 0]));
    for (let s = 1; s <= 200; s++) for (const id of ids(12)) {
      const g = gunFor(s, id);
      expect(gunFor(s, id)).toBe(g);
      seen.set(g, seen.get(g)! + 1);
      const a = ammoFor(s, id, g);
      expect(a.mag).toBe(WEAPONS[g].magazine);
      expect(a.spare % WEAPONS[g].magazine).toBe(0);
      expect(a.spare / WEAPONS[g].magazine).toBeGreaterThanOrEqual(1);
      expect(a.spare / WEAPONS[g].magazine).toBeLessThanOrEqual(3);
    }
    const total = [...seen.values()].reduce((x, y) => x + y, 0);
    expect(seen.get('pistol')! / total).toBeCloseTo(0.45, 1);
    expect(seen.get('rifle')! / total).toBeCloseTo(0.3, 1);
    expect(seen.get('shotgun')! / total).toBeCloseTo(0.25, 1);
  });
});

describe('an NPC gun: cadence, magazine, reloads', () => {
  const runFor = (g: NpcGun, seconds: number, dt = 1 / 60) => {
    const times: number[] = [];
    for (let t = 0; t < seconds; t += dt) {
      g.tick(dt);
      if (g.ready) { g.fire(); times.push(t); }
      else if (g.mag <= 0 && !g.reloading) g.startReload();
    }
    return times;
  };

  it('a pistol fires single shots no faster than the player\'s own pistol, empties its magazine, then reloads (the empty time x the NPC factor)', () => {
    const g = new NpcGun('pistol', 15, 30, mulberry32(3));
    const times = runFor(g, 14);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(Math.max(WEAPONS.pistol.interval, NPC_GUNS.pistol.interval[0]) - 1 / 60);
    expect(g.counts.rounds).toBeGreaterThan(15);
    expect(g.counts.reloads).toBeGreaterThanOrEqual(1);
    // the reload gap: >= the reload time
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(npcReloadTime('pistol', 0, 15) - 1e-6);
    expect(npcReloadTime('pistol', 0, 15)).toBeCloseTo(WEAPONS.pistol.reload.kind === 'magazine' ? WEAPONS.pistol.reload.emptyTime * NPC_GUNS.pistol.reloadMult : 0, 9);
  });

  it('a rifle fires 2-4 round bursts with pauses; rounds = magazine + spares, never more', () => {
    const g = new NpcGun('rifle', 30, 30, mulberry32(9));
    const times = runFor(g, 40);
    expect(g.counts.rounds).toBe(60);
    expect([g.mag, g.spare, g.dry]).toEqual([0, 0, true]);
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const inBurst = gaps.filter(x => x < 0.3), pauses = gaps.filter(x => x >= 0.3 && x < 2);
    expect(Math.min(...inBurst)).toBeGreaterThanOrEqual(WEAPONS.rifle.interval - 1 / 60);
    expect(pauses.length).toBeGreaterThan(10);
    // bursts of 2..4 rounds between pauses
    let run = 1;
    const bursts: number[] = [];
    for (const x of gaps) { if (x < 0.3) run++; else { bursts.push(run); run = 1; } }
    expect(Math.min(...bursts.slice(0, -1))).toBeGreaterThanOrEqual(1);
    expect(Math.max(...bursts)).toBeLessThanOrEqual(4);
  });

  it('a shotgun reloads shell by shell (start + each x shells + end, x the NPC factor) and fires its 9 pellets per round', () => {
    const def = WEAPONS.shotgun;
    if (def.reload.kind !== 'shell') throw new Error('shell reload expected');
    expect(npcReloadTime('shotgun', 2, 30)).toBeCloseTo((def.reload.start + def.reload.each * 4 + def.reload.end) * NPC_GUNS.shotgun.reloadMult, 9);
    expect(npcReloadTime('shotgun', 5, 1)).toBeCloseTo((def.reload.start + def.reload.each * 1 + def.reload.end) * NPC_GUNS.shotgun.reloadMult, 9);
    const g = new NpcGun('shotgun', 6, 3, mulberry32(1));
    expect(g.fire()).toBe(9);
    expect(g.ready).toBe(false); // the pump
    g.mag = 0;
    expect(g.startReload()).toBe(true);
    g.tick(g.reloadT + 0.01);
    expect([g.mag, g.spare]).toEqual([3, 0]);
    expect(g.startReload()).toBe(false); // no spares left
  });
});

describe('a round reaching the player', () => {
  const body: PlayerBody = {x: 0, y: 0, z: 0, eye: 1.62, yaw: 0, radius: 0.3};
  const at = (y: number, x = 0) => playerBulletHit({x, y, z: 10}, {x: 0, y: 0, z: -1}, 50, body);

  it('lands by height / side: head over the shoulders, legs below the hips, arms off the torso\'s sides', () => {
    expect(at(1.68)?.location).toBe('head');
    expect(at(1.2)?.location).toBe('torso');
    expect(at(1.2, 0.22)?.location).toBe('arm');
    expect(at(0.5)?.location).toBe('leg');
    expect(at(2.2)).toBeNull();
    expect(at(1.2, 0.5)).toBeNull();
    // a wall nearer than the player stops it (maxT = the world hit)
    expect(playerBulletHit({x: 0, y: 1.2, z: 10}, {x: 0, y: 0, z: -1}, 5, body)).toBeNull();
    expect(playerChest(body).y).toBeGreaterThan(1);
  });

  it('raw damage = the gun\'s own damage x falloff x the NPC scale (before the player\'s pipeline), in a zombie claw\'s range', () => {
    for (const g of MARKET_GUNS) {
      const def = WEAPONS[g];
      expect(npcRoundDamage(g, 3)).toBeCloseTo(def.damage * NPC_GUNS[g].damageScale, 9);
      expect(npcRoundDamage(g, def.range + 5)).toBeCloseTo(def.damage * def.falloffMin * NPC_GUNS[g].damageScale, 9);
      expect(npcRoundDamage(g, 3) * def.pellets).toBeLessThan(ZOMBIE_STATS.shambler.attackDamage * 2.6);
      expect(npcRoundDamage(g, 3) * def.pellets).toBeGreaterThan(ZOMBIE_STATS.shambler.attackDamage * 0.7);
    }
  });

  it('spread stays inside its cone', () => {
    const r = mulberry32(4), d = {x: 0, y: 0, z: -1};
    for (let i = 0; i < 500; i++) {
      const v = coneDir(d, 0.05, r);
      expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(1, 9);
      expect(Math.acos(-v.z)).toBeLessThanOrEqual(0.05 + 1e-9);
    }
  });
});

describe('the hostility record (save/validate.ts)', () => {
  const good = (): MarketHostilityJSON => ({v: 1, hostile: true, cause: 'theft', stall: 'gun', people: {
    'trader:gun': {s: 'alive', hp: 64.5, role: 'fight', gun: 'shotgun', mag: 3, spare: 6, posture: 'fight', x: 1, y: 0, z: 2, yaw: 0.5},
    'resident:3': {s: 'dead', hp: 0, role: 'flee', gun: 'pistol', mag: 15, spare: 30, posture: 'down', x: 4, y: 3.2, z: -1, yaw: -2},
    'resident:4': {s: 'fled', hp: 100, role: 'flee', gun: 'rifle', mag: 30, spare: 60, posture: 'flee'},
  }});
  it('accepts a well-formed record and refuses every malformed one', () => {
    expect(marketHostilityProblem(good())).toBeNull();
    const bad: [string, (r: Record<string, unknown> & {people: Record<string, Record<string, unknown>>}) => void][] = [
      ['version', r => { r.v = 2; }],
      ['calm', r => { r.hostile = false; }],
      ['cause', r => { r.cause = 'insult'; }],
      ['theft without a stall', r => { delete r.stall; }],
      ['unknown stall', r => { r.stall = 'bank'; }],
      ['extra field', r => { r.reputation = 3; }],
      ['person id', r => { r.people['mayor:1'] = r.people['resident:3']; }],
      ['dead with hp', r => { r.people['resident:3'].hp = 20; }],
      ['alive without hp', r => { r.people['trader:gun'].hp = 0; }],
      ['state', r => { r.people['trader:gun'].s = 'asleep'; }],
      ['gun', r => { r.people['trader:gun'].gun = 'rocket'; }],
      ['rounds', r => { r.people['trader:gun'].mag = -1; }],
      ['partial position', r => { delete r.people['trader:gun'].z; }],
      ['no position', r => { for (const k of ['x', 'y', 'z', 'yaw']) delete r.people['resident:3'][k]; }],
      ['nan', r => { r.people['trader:gun'].x = Number.NaN; }],
      ['posture', r => { r.people['trader:gun'].posture = 'dance'; }],
    ];
    for (const [why, f] of bad) {
      const r = structuredClone(good()) as never;
      f(r);
      expect(marketHostilityProblem(r), why).not.toBeNull();
    }
  });
});
