// Task studio-sprinter-zombies-20261112-033210-01: SPRINTERS (ai/sprinter.ts) — a seeded 10 % of eligible ordinary zombies RUN at the
// player while they pursue; idle / roaming, stats, looks, special enemies and every saved station stay as they were. User: "Add sprinter
// variants to 10% of ordinary regular zombie spawns. They should run at the player when pursuing instead of shambling ... Use a
// deterministic seeded 10% chance per eligible regular zombie, without increasing total spawns or guaranteeing an extra sprinter."
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {ROSTER_LANE, ROSTER_VERSION, ZOMBIE_FREE_LEVELS, rosterOf, rosterVersionFor} from '../src/ai/enemyRoster';
import {SPRINTER, applySprinters, isSprinter, sprinterEligible, sprinterRoll} from '../src/ai/sprinter';
import {SPRINTER_STATS, ZOMBIE_STATS, ZombieBrain, spawnStats, type BrainWorld, type ZombieStats} from '../src/ai/brain';
import {CLIP_GROUND_SPEED, GAIT_TIME_SCALE, ZombieActor, gaitTimeScale} from '../src/ai/zombieActor';
import {WALK_SPEED, SPRINT_SPEED} from '../src/player/player';
import {ENEMY_FAMILY_IDS} from '../src/ai/spawnTables';
import {createRun} from '../src/run/runState';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';

const COMBAT = LEVEL_IDS.filter(l => !ZOMBIE_FREE_LEVELS.includes(l));
const spawn = (o: Partial<ZombieSpawn> = {}): ZombieSpawn => ({x: 0, z: 0, yaw: 0, type: 'shambler', area: 0, ...o});
/** Everything of the spawns but the sprinter tag. */
const untagged = (l: StationLayout): string => JSON.stringify(l.zombies.map(z => ({...z, sprinter: undefined})));

describe('sprinters: the rule (pure)', () => {
  it('10 %, 4.3 m/s pursuit (~1.69x the shambler\'s 2.55, ~2.46x the coated\'s 1.75), from roster version 2; between a walking and a sprinting player', () => {
    expect(SPRINTER.chance).toBe(0.1);
    expect(SPRINTER.chaseSpeed).toBe(4.3);
    expect(SPRINTER.since).toBe(2);
    expect(ROSTER_VERSION).toBeGreaterThanOrEqual(SPRINTER.since);
    expect(ZOMBIE_STATS.shambler.chaseSpeed).toBe(2.55);
    expect(ZOMBIE_STATS.coated.chaseSpeed).toBe(1.75);
    expect(SPRINTER.chaseSpeed / ZOMBIE_STATS.shambler.chaseSpeed).toBeCloseTo(1.686, 3);
    expect(SPRINTER.chaseSpeed / ZOMBIE_STATS.coated.chaseSpeed).toBeCloseTo(2.457, 3);
    expect(SPRINTER.chaseSpeed).toBeGreaterThan(WALK_SPEED); // it catches a walking player ...
    expect(SPRINTER.chaseSpeed).toBeLessThan(SPRINT_SPEED); // ... a sprinting one still gets away
  });

  it('eligible = every ordinary infected zombie (shambler / coated, ambient / horde / outfit); never a special family (whatever its tag)', () => {
    expect(sprinterEligible(spawn())).toBe(true);
    expect(sprinterEligible(spawn({archetype: 'zombie'}))).toBe(true);
    expect(sprinterEligible(spawn({archetype: 'zombie', horde: 0}))).toBe(true);
    expect(sprinterEligible(spawn({archetype: 'zombie', look: 'lingerie'}))).toBe(true);
    expect(sprinterEligible(spawn({type: 'coated'}))).toBe(true);
    for (const f of ENEMY_FAMILY_IDS.filter(f => f !== 'zombie')) {
      expect(sprinterEligible(spawn({archetype: f})), f).toBe(false);
      expect(isSprinter(spawn({archetype: f, sprinter: true})), f).toBe(false);
      expect(spawnStats(spawn({archetype: f, sprinter: true})), f).toBe(ZOMBIE_STATS.shambler); // a special's zombie stand-in: the ordinary pace
    }
    expect(isSprinter(spawn({sprinter: true}))).toBe(true);
    expect(isSprinter(spawn())).toBe(false);
    expect(isSprinter(spawn({type: 'coated', sprinter: true}))).toBe(true);
  });

  it('the roll is a pure hash of (level seed, spawn index): deterministic, uniform, about 10 % below the chance', () => {
    expect(sprinterRoll(1201, 7)).toBe(sprinterRoll(1201, 7));
    expect(sprinterRoll(1201, 7)).not.toBe(sprinterRoll(1202, 7));
    expect(sprinterRoll(1201, 7)).not.toBe(sprinterRoll(1201, 8));
    let n = 0, hits = 0;
    for (let seed = 1; seed <= 400; seed++) for (let i = 0; i < 50; i++) {
      const r = sprinterRoll(seed * 7919, i);
      expect(r >= 0 && r < 1).toBe(true);
      n++; if (r < SPRINTER.chance) hits++;
    }
    const sd = Math.sqrt(SPRINTER.chance * (1 - SPRINTER.chance) / n);
    expect(Math.abs(hits / n - SPRINTER.chance)).toBeLessThan(3 * sd);
  });

  it('applySprinters only writes the tag: no spawn added / removed / moved / retyped; no minimum (a level may hold none)', () => {
    const Z = [spawn({x: 1}), spawn({x: 2, type: 'coated'}), spawn({x: 3, archetype: 'siren', sprinter: true}), spawn({x: 4, archetype: 'zombie'}), spawn({x: 5, horde: 1})];
    const before = JSON.stringify(Z.map(z => ({...z, sprinter: undefined})));
    // seeds where no eligible spawn rolls (likely with 4 eligible: 0.9^4 = 66 %) and where some do — neither is forced
    let none = -1, some = -1;
    for (let seed = 1; seed < 500 && (none < 0 || some < 0); seed++) {
      const r = applySprinters(Z.map(z => ({...z})), seed);
      if (r.sprinters === 0 && none < 0) none = seed;
      if (r.sprinters > 0 && some < 0) some = seed;
    }
    expect(none).toBeGreaterThan(0);
    expect(some).toBeGreaterThan(0);
    for (const seed of [none, some]) {
      const z = Z.map(s => ({...s}));
      const rep = applySprinters(z, seed);
      expect(rep.eligible).toBe(4);
      expect(JSON.stringify(z.map(s => ({...s, sprinter: undefined})))).toBe(before);
      expect(z[2].sprinter).toBeUndefined(); // a special family's stale tag is cleared
      z.forEach((s, i) => expect(s.sprinter === true, `#${i}`).toBe(sprinterEligible(s) && sprinterRoll(seed, i) < SPRINTER.chance));
      expect(rep.sprinters).toBe(z.filter(s => s.sprinter).length);
    }
  });
});

describe('sprinters: real levels through the registry (the roster pass at version 2)', () => {
  const SEEDS = [0, 1, 2, 3].map(k => (2203 + k * 6151) >>> 0);
  let eligible = 0, sprinters = 0;

  for (const level of COMBAT) {
    it(`${level}: version 2 = version 1 + the sprinter tags only (families, counts, positions, indices, looks, layout unchanged)`, () => {
      for (const seed of SEEDS) {
        const v1 = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: 1});
        const v2 = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
        const again = LEVELS[level].generate('main', {levelSeed: seed, rosterVersion: ROSTER_VERSION});
        expect(JSON.stringify(again.zombies), `${level} ${seed}: deterministic`).toBe(JSON.stringify(v2.zombies));
        expect(v1.zombies.some(z => z.sprinter !== undefined), `${level} ${seed}: a version-1 station has no sprinters`).toBe(false);
        expect(untagged(v2), `${level} ${seed}: special enemies and their spawn rules untouched`).toBe(JSON.stringify(v1.zombies));
        expect(JSON.stringify({...v2, zombies: null})).toBe(JSON.stringify({...v1, zombies: null}));
        v2.zombies.forEach((z, i) => {
          expect(z.sprinter === true, `${level} ${seed} #${i}`).toBe(sprinterEligible(z) && sprinterRoll(seed, i) < SPRINTER.chance);
          if (z.sprinter) expect(isSprinter(z)).toBe(true);
        });
        const rep = rosterOf(v2)!.sprinters!;
        expect(rep.eligible).toBe(v2.zombies.filter(sprinterEligible).length);
        expect(rep.sprinters).toBe(v2.zombies.filter(z => z.sprinter).length);
        expect(rosterOf(v1)!.sprinters).toBeUndefined();
        eligible += rep.eligible; sprinters += rep.sprinters;
      }
    }, 180_000);
  }

  it('census: about 10 % of the eligible spawns of these levels sprint (within 3 sigma); the Survivor Market has none', () => {
    expect(eligible).toBeGreaterThan(300);
    const p = SPRINTER.chance, sd = Math.sqrt(p * (1 - p) / eligible);
    expect(Math.abs(sprinters / eligible - p), `${sprinters} / ${eligible}`).toBeLessThan(3 * sd);
    const m = LEVELS.market.generate('main', {levelSeed: SEEDS[0], rosterVersion: ROSTER_VERSION});
    expect(m.zombies.length).toBe(0);
    expect(rosterOf(m)!.sprinters).toBeUndefined();
  });
});

describe('sprinters: saves (the roster version pin)', () => {
  it('a station recorded at version 1 (or visited before the roster) regenerates exactly as before; a never-entered one gets sprinters, never rerolled', () => {
    const run = createRun({seeds: {subway: 1, office: 2, mall: 3, market: 4, bunker: 7, skyways: 5, reactor: 6}, start: {level: 'subway', section: 'main'}, levels: LEVELS});
    const v1Key = {level: 'subway' as const, section: 'main', station: 'st-v1'}, v0Key = {level: 'subway' as const, section: 'main', station: 'st-v0'};
    const newKey = {level: 'subway' as const, section: 'main', station: 'st-new'};
    run.memory(v1Key).visits = 3; run.setLaneStore(ROSTER_LANE, {v: 1}, v1Key); run.memory(v1Key).killed = [1, 4];
    run.memory(v0Key).visits = 1;
    const SEED = 2203;
    const build = (k: typeof v1Key): StationLayout => {
      // Game.generateSection's rule (sectionGenInputs + the lane stamp)
      const rosterVersion = rosterVersionFor(run.peekMemory(k));
      const layout = LEVELS[k.level].generate(k.section, {levelSeed: SEED, rosterVersion});
      if (run.laneStore(ROSTER_LANE, k) === undefined) run.setLaneStore(ROSTER_LANE, {v: rosterVersion}, k);
      return layout;
    };
    const asV1 = LEVELS.subway.generate('main', {levelSeed: SEED, rosterVersion: 1}), plain = LEVELS.subway.generate('main', {levelSeed: SEED});
    const a = build(v1Key), b = build(v0Key), c = build(newKey);
    expect(JSON.stringify(a.zombies)).toBe(JSON.stringify(asV1.zombies)); // its enemies, identities and kill indices exactly as built
    expect(JSON.stringify(b.zombies)).toBe(JSON.stringify(plain.zombies));
    expect([a, b].some(l => l.zombies.some(z => z.sprinter))).toBe(false);
    expect(c.zombies.filter(z => z.sprinter).length, 'this seed rolls sprinters for a new station').toBeGreaterThan(0);
    expect(untagged(c)).toBe(JSON.stringify(asV1.zombies));
    expect([run.laneStore(ROSTER_LANE, v1Key), run.laneStore(ROSTER_LANE, v0Key), run.laneStore(ROSTER_LANE, newKey)]).toEqual([{v: 1}, {v: 0}, {v: ROSTER_VERSION}]);
    expect(run.memory(v1Key).killed).toEqual([1, 4]);
    // a revisit (Continue / Retry) and an export / import of the memory keep the version: the same sprinters, never rerolled
    run.memory(newKey).visits++;
    expect(JSON.stringify(build(newKey).zombies)).toBe(JSON.stringify(c.zombies));
    expect(JSON.stringify(build(v1Key).zombies)).toBe(JSON.stringify(a.zombies));
    for (const k of [v1Key, v0Key, newKey]) expect(rosterVersionFor(JSON.parse(JSON.stringify(run.peekMemory(k))))).toBe(rosterVersionFor(run.peekMemory(k)));
  }, 60_000);
});

/** An open floor: the player in plain sight, straight-line routes (a pure brain world). */
function openWorld(p: {x: number; z: number}): BrainWorld {
  let seed = 7;
  return {
    get px() { return p.x; }, get pz() { return p.z; }, playerAlive: true, py: 0,
    los: () => true, walkClear: () => true,
    findPath: (_ax, _az, bx, bz) => [[bx, bz]],
    randomNear: (x, z) => [x + 3, z],
    rand: () => ((seed = (seed * 16807) % 2147483647) / 2147483647),
  };
}

describe('sprinters: the brain (only the pursuit pace changes)', () => {
  it('SPRINTER_STATS = each type\'s own stats with only the chase pace raised; spawnStats picks them for a sprinter spawn only', () => {
    for (const t of ['shambler', 'coated'] as const) {
      expect({...SPRINTER_STATS[t], chaseSpeed: 0}, t).toEqual({...ZOMBIE_STATS[t], chaseSpeed: 0});
      expect(SPRINTER_STATS[t].chaseSpeed).toBe(SPRINTER.chaseSpeed);
      expect(SPRINTER_STATS[t].chaseAnim).toBe('Run');
      expect(spawnStats(spawn({type: t, sprinter: true}))).toBe(SPRINTER_STATS[t]);
      expect(spawnStats(spawn({type: t}))).toBe(ZOMBIE_STATS[t]);
    }
    expect(SPRINTER_STATS.coated.hp).toBe(165); // a coated sprinter keeps its toughness
  });

  /** Chase a player who moves straight away at `playerSpeed` from `gap` m for `secs` s; the final gap (m) and the brain's pace. */
  function pursuit(stats: ZombieStats, playerSpeed: number, gap = 8, secs = 6): {gap: number; speeds: Set<number>; anims: Set<string>} {
    const p = {x: gap, z: 0};
    const b = new ZombieBrain('shambler', 0, 0, Math.PI / 2, stats); // facing +x: the player
    const w = openWorld(p), dt = 1 / 30, speeds = new Set<number>(), anims = new Set<string>();
    for (let t = 0; t < secs; t += dt) {
      const out = b.update(dt, w);
      if (b.state === 'chase') { speeds.add(out.speed); anims.add(out.anim); }
      b.x += out.dirX * out.speed * dt; b.z += out.dirZ * out.speed * dt;
      if (out.face !== null) b.yaw = out.face;
      p.x += playerSpeed * dt;
    }
    return {gap: Math.hypot(p.x - b.x, p.z - b.z), speeds, anims};
  }

  it('pursuit: a sprinter RUNS at 4.3 m/s and closes on a walking player; the ordinary zombie (2.55) falls behind; a sprinting player escapes', () => {
    const ordinary = pursuit(ZOMBIE_STATS.shambler, WALK_SPEED), sprinter = pursuit(SPRINTER_STATS.shambler, WALK_SPEED);
    expect([...sprinter.speeds]).toEqual([SPRINTER.chaseSpeed]);
    expect([...sprinter.anims]).toEqual(['Run']);
    expect([...ordinary.speeds]).toEqual([ZOMBIE_STATS.shambler.chaseSpeed]);
    expect(sprinter.gap).toBeLessThan(8 - 4); // ~0.9 m/s closing for 6 s
    expect(ordinary.gap).toBeGreaterThan(8 + 4); // ~0.85 m/s opening
    expect(pursuit(SPRINTER_STATS.shambler, SPRINT_SPEED).gap).toBeGreaterThan(8 + 6); // ~1.5 m/s opening
    // a coated sprinter runs at the same pace (its own chase 1.75 would fall far behind)
    expect([...pursuit(SPRINTER_STATS.coated, WALK_SPEED).speeds]).toEqual([SPRINTER.chaseSpeed]);
    expect(pursuit(SPRINTER_STATS.coated, WALK_SPEED).gap).toBeLessThan(8 - 4);
    expect(pursuit(ZOMBIE_STATS.coated, WALK_SPEED).gap).toBeGreaterThan(8 + 8);
  });

  it('idle / roaming keep the ordinary pace and gait; attack, damage and health are the ordinary zombie\'s', () => {
    const far = {x: 500, z: 500}; // never seen (sight 18 m)
    const roam = (stats: ZombieStats) => {
      const b = new ZombieBrain('shambler', 0, 0, 0, stats), w = openWorld(far), seen = new Set<string>();
      for (let t = 0; t < 30; t += 1 / 30) { const out = b.update(1 / 30, w); b.x += out.dirX * out.speed / 30; b.z += out.dirZ * out.speed / 30; seen.add(`${b.state}:${out.anim}:${out.speed}`); }
      return [...seen].sort();
    };
    const s = roam(SPRINTER_STATS.shambler);
    expect(s).toEqual(roam(ZOMBIE_STATS.shambler));
    expect(s).toContain(`wander:Walk:${ZOMBIE_STATS.shambler.wanderSpeed}`);
    expect(roam(SPRINTER_STATS.coated)).toEqual(roam(ZOMBIE_STATS.coated));
    // the same swing: in range it attacks once per swing for the ordinary damage
    const p = {x: 1, z: 0};
    const sb = new ZombieBrain('shambler', 0, 0, Math.PI / 2, SPRINTER_STATS.shambler), ob = new ZombieBrain('shambler', 0, 0, Math.PI / 2);
    const swing = (b: ZombieBrain) => { let hits = 0; const states: string[] = []; for (let i = 0; i < 45; i++) { const out = b.update(1 / 30, openWorld(p)); hits += out.attackHit ? 1 : 0; states.push(b.state); } return {hits, states: states.join()}; };
    expect(swing(sb)).toEqual(swing(ob));
    expect([sb.hp, sb.stats.attackDamage, sb.stats.attackDuration, sb.stats.sightRange]).toEqual([ob.hp, ob.stats.attackDamage, ob.stats.attackDuration, ob.stats.sightRange]);
  });
});

describe('sprinters: the actor (the same Run clip, played to match the pace)', () => {
  it('gaitTimeScale: a sprinter\'s Run covers its 4.3 m/s on every body scale (0.95-1.05); every other zombie\'s playback is unchanged', () => {
    for (const scale of [0.95, 1, 1.05]) {
      const ground = CLIP_GROUND_SPEED.Run * scale;
      const ts = gaitTimeScale('Run', SPRINTER.chaseSpeed, scale, SPRINTER_STATS.coated);
      expect(ts).toBe(gaitTimeScale('Run', SPRINTER.chaseSpeed, scale, SPRINTER_STATS.shambler));
      expect(ts * ground).toBeCloseTo(SPRINTER.chaseSpeed, 9); // no foot slide at the sprint pace
      expect(ts).toBeGreaterThan(1.7);
      expect(ts).toBeLessThan(2);
      // the old rule for everyone else: clamp(speed / ground, 0.35, 1.8)
      const old = (clip: 'Walk' | 'Run', v: number) => Math.max(0.35, Math.min(1.8, v / (CLIP_GROUND_SPEED[clip] * scale))) || 1;
      for (const v of [0, 0.3, 0.65, 0.91, 1.75, 2.55, 3, 5, 9]) {
        for (const stats of [ZOMBIE_STATS.shambler, ZOMBIE_STATS.coated]) {
          expect(gaitTimeScale('Run', v, scale, stats)).toBe(old('Run', v));
          expect(gaitTimeScale('Walk', v, scale, stats)).toBe(old('Walk', v));
        }
        expect(gaitTimeScale('Walk', v, scale, SPRINTER_STATS.shambler)).toBe(old('Walk', v)); // roaming: the ordinary walk
      }
      // a shove faster than the sprint pace still clamps: at the sprint pace, or the usual 1.8 when that is higher (the largest bodies)
      expect(gaitTimeScale('Run', 9, scale, SPRINTER_STATS.shambler)).toBeCloseTo(Math.max(1.8, SPRINTER.chaseSpeed / ground), 9);
    }
    expect(GAIT_TIME_SCALE).toEqual({min: 0.35, max: 1.8});
  });

  it('ZombieActor builds its brain from the spawn: a sprinter spawn gets SPRINTER_STATS, any other its type\'s stats (same body, same clips)', () => {
    const template = {scene: new THREE.Group(), animations: [] as THREE.AnimationClip[]} as never;
    const rnd = () => 0.5;
    expect(new ZombieActor(template, spawn({sprinter: true}), rnd).brain.stats).toBe(SPRINTER_STATS.shambler);
    expect(new ZombieActor(template, spawn(), rnd).brain.stats).toBe(ZOMBIE_STATS.shambler);
    expect(new ZombieActor(template, spawn({type: 'coated', sprinter: true}), rnd).brain.stats).toBe(SPRINTER_STATS.coated);
    expect(new ZombieActor(template, spawn({type: 'coated'}), rnd).brain.stats).toBe(ZOMBIE_STATS.coated);
    expect(new ZombieActor(template, spawn({archetype: 'strainer', sprinter: true}), rnd).brain.stats).toBe(ZOMBIE_STATS.shambler);
    const a = new ZombieActor(template, spawn({sprinter: true}), rnd), o = new ZombieActor(template, spawn(), rnd);
    expect([a.root.name, a.scale, a.brain.hp]).toEqual([o.root.name, o.scale, o.brain.hp]);
  });
});
