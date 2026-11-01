// Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): THE STRAINER as a normal registered enemy family —
//  - registry: appended LAST (every older roll / band / order unchanged), the archetype def, the lazy model key;
//  - weights: service-annex pool 0.08 (rat/dog 0.20 and Blightbelly 0.05 exactly as before, zombies 0.75 -> 0.67), an explicit 0
//    in every other pool, hordes forbid it; the validation guard rejects a positive weight outside STRAINER_CONTEXTS;
//  - non-service picks bit-identical to the pre-change pools (200k rolls per level pool, room modifiers included);
//  - a Node simulation of many tagged service-annex spawns: Strainers only in 'service' spawns, at ~0.08;
//  - stats vs the ordinary zombie (read from source), the melee brain (long reach, claw contact at the clip's hit time, no ladder
//    links), the actor on a contract-shaped synthetic rig (the real GLB is checked by tests/strainer-contract.test.ts),
//    the head zone (hunched forward, scaled), the counted zombie fallback, the ragdoll / corpse, save / load of a killed Strainer.
import {describe, expect, it} from 'vitest';
import {writeFileSync} from 'node:fs';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ZOMBIE_STATS, ZombieBrain, type BrainWorld} from '../src/ai/brain';
import {
  PLAYER_BODY_RADIUS, STRAINER_ASSET, STRAINER_CUES, STRAINER_MAX_TOP_M, STRAINER_REACH, STRAINER_SCALE, STRAINER_STAGGER_MIN, STRAINER_STATS, STRAINER_WET, StrainerBrain, strainerAttackRange,
} from '../src/ai/strainer';
import {STRAINER_BONES, STRAINER_CLIPS, StrainerActor} from '../src/ai/strainerActor';
import {STRAINER_TRAIL, StrainerWetTrail} from '../src/ai/strainerTrail';
import {WET_TRAIL} from '../src/world/fx';
import {BLIGHTBELLY_STATS} from '../src/ai/blightbelly';
import {createEnemyActor, ENEMY_ARCHETYPES, enemyCues, archetypeOf, type EnemyActor} from '../src/ai/creatureArchetypes';
import {assignEnemyArchetypes, enemyRoll, pickEnemyArchetype} from '../src/ai/creatureSpawn';
import {
  CONTEXT_LOCKED_FAMILIES, DEFAULT_FAMILY_SHARES, ENEMY_FAMILY_IDS, MALL_HORDE, SERVICE_CONTEXT, SERVICE_FAMILY_POOL, SERVICE_FAMILY_SHARES,
  SPAWN_PROFILES, STRAINER_CONTEXTS, familyPool, markSpawnContext, roomFamilyPool, spawnContextOf, spawnProfile, validateSpawnProfile,
  type FamilyPool, type SpawnProfile,
} from '../src/ai/spawnTables';
import {HORDE_FORBIDDEN_FAMILIES, hordeFamilyRoll, pickHordeFamily, validateHordeRules} from '../src/ai/hordeSpec';
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from '../src/ai/enemyModels';
import {validateLevelRegistry} from '../src/levels/levelContract';
import {LEVELS, LEVEL_IDS} from '../src/levels/registry';
import {createMemory, enemiesToSpawn, mergeKilled} from '../src/run/memory';
import {takeSnapshot} from '../src/run/snapshot';
import {Inventory} from '../src/items/inventory';
import {HUMANOID_RIG} from '../src/physics/ragdoll';
import {PhysicsSystem, killImpulseStrength} from '../src/physics/world';
import {FLOOR, Grid, SOLID} from '../src/gen/grid';
import {raySphere, rayCapsule} from '../src/combat/hitscan';
import type {ZombieSpawn} from '../src/gen/stationTypes';

const S = ZOMBIE_STATS.shambler;
const share = (pool: FamilyPool, f: string) => pool.find(r => r[0] === f)?.[1];
const rng = (seed = 1) => { let s = seed; return () => ((s = (s * 16807) % 2147483647) / 2147483647); };
const spawnAt = (x: number, z: number, yaw = 0): ZombieSpawn => ({x, z, yaw, type: 'shambler', area: 0, archetype: 'strainer'});
/** The pool exactly as it was before the Strainer existed (its row removed). */
const before = (pool: FamilyPool): FamilyPool => pool.filter(([f]) => f !== 'strainer');

// --- a contract-shaped synthetic rig (the real enemy-strainer.glb is exercised in strainer-contract.test.ts) ----------
const JOINTS: readonly [string, string | null, [number, number, number]][] = [
  ['Root', null, [0, 0, 0]], ['Hips', 'Root', [0, 1.1, 0]], ['Spine', 'Hips', [0, 1.32, 0.03]], ['Chest', 'Spine', [0, 1.56, 0.07]],
  ['Neck', 'Chest', [0, 1.8, 0.12]], ['Head', 'Neck', [0, 1.9, 0.15]],
  ['L_UpperArm', 'Chest', [0.22, 1.72, 0.08]], ['L_Forearm', 'L_UpperArm', [0.3, 1.25, 0.1]], ['L_Hand', 'L_Forearm', [0.34, 0.85, 0.14]],
  ['R_UpperArm', 'Chest', [-0.22, 1.72, 0.08]], ['R_Forearm', 'R_UpperArm', [-0.3, 1.25, 0.1]], ['R_Hand', 'R_Forearm', [-0.34, 0.85, 0.14]],
  ['L_Thigh', 'Hips', [0.12, 1.06, 0]], ['L_Shin', 'L_Thigh', [0.12, 0.58, 0]], ['L_Foot', 'L_Shin', [0.12, 0.08, 0.03]],
  ['R_Thigh', 'Hips', [-0.12, 1.06, 0]], ['R_Shin', 'R_Thigh', [-0.12, 0.58, 0]], ['R_Foot', 'R_Shin', [-0.12, 0.08, 0.03]],
];
function syntheticStrainer(extras: Record<string, unknown> = {}): GLTF {
  const scene = new THREE.Group();
  const bones = new Map<string, THREE.Bone>();
  for (const [name, parent, world] of JOINTS) {
    const b = new THREE.Bone();
    b.name = name;
    const pw = parent ? JOINTS.find(j => j[0] === parent)![2] : [0, 0, 0];
    b.position.set(world[0] - pw[0], world[1] - pw[1], world[2] - pw[2]);
    (parent ? bones.get(parent)! : scene).add(b);
    bones.set(name, b);
  }
  const geo = new THREE.BoxGeometry(0.4, 2.15, 0.3).translate(0, 1.075, 0);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
  mesh.name = 'StrainerBody';
  scene.add(mesh);
  scene.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(JOINTS.map(([j]) => bones.get(j)!)));
  scene.userData.enemyStrainer = {heightM: 2.15, ...extras};
  const dur: Record<string, number> = {Idle: 2, Walk: 1, Run: 0.7, Attack: STRAINER_ASSET.attackDuration, Hit: 0.4, Death: 2};
  const animations = STRAINER_CLIPS.map(c => new THREE.AnimationClip(c, dur[c], [
    new THREE.VectorKeyframeTrack('Hips.position', [0, dur[c]], [0, 1.1, 0, 0, c === 'Death' ? 0.3 : 1.1, 0]),
  ]));
  return {scene, scenes: [scene], animations, cameras: [], asset: {}, parser: null, userData: {}} as unknown as GLTF;
}
const zombieStandIn = (): EnemyActor => ({brain: new ZombieBrain('shambler', 0, 0, 0), stand: 'zombie'}) as unknown as EnemyActor;

// ---------------------------------------------------------------------------------------------------------------------------
describe('Strainer: registry, weights and the context lock', () => {
  it('appended LAST: the older ids / roll order unchanged; ENEMY_ARCHETYPES agrees; the archetype definition', () => {
    expect(ENEMY_FAMILY_IDS.slice(0, 4)).toEqual(['zombie', 'blightbelly', 'siren', 'ratdog']);
    expect(ENEMY_FAMILY_IDS[ENEMY_FAMILY_IDS.length - 1]).toBe('strainer');
    expect(ENEMY_FAMILY_IDS).toHaveLength(5);
    expect(Object.keys(ENEMY_ARCHETYPES)).toEqual([...ENEMY_FAMILY_IDS]);
    const d = ENEMY_ARCHETYPES.strainer;
    expect(d).toMatchObject({id: 'strainer', label: 'Strainer', model: 'enemy_strainer', climbsLadders: false, dropsIntoTrackBed: true, voiceHeight: 1.9});
    expect(d.stats).toBe(STRAINER_STATS);
    expect(familyPool().map(([f]) => f)).toEqual([...ENEMY_FAMILY_IDS]);
  });

  it('weights: service pool 0.08 (rat/dog 0.20, Blightbelly 0.05 unchanged, zombies 0.67); an explicit 0 in every other pool; hordes 0', () => {
    expect(STRAINER_CONTEXTS).toEqual(['service']);
    expect(CONTEXT_LOCKED_FAMILIES).toEqual({strainer: ['service']});
    expect(DEFAULT_FAMILY_SHARES.strainer).toBe(0);
    expect(SERVICE_FAMILY_SHARES).toEqual({ratdog: 0.2, blightbelly: 0.05, siren: 0, strainer: 0.08});
    expect(SERVICE_FAMILY_POOL).toEqual([['zombie', 0.67], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0.2], ['strainer', 0.08]]);
    expect(SERVICE_CONTEXT.families).toBe(SERVICE_FAMILY_POOL);
    for (const id of LEVEL_IDS) {
      const p = spawnProfile(id);
      expect(validateSpawnProfile(p), id).toEqual([]);
      // the level pool (every core context reads it) lists the Strainer explicitly at 0
      expect(p.families.find(([f]) => f === 'strainer'), id).toEqual(['strainer', 0]);
      for (const [c, rule] of Object.entries(p.contexts)) {
        if (!rule?.families) continue;
        expect(share(rule.families, 'strainer'), `${id} ${c}`).toBe(c === 'service' ? 0.08 : 0);
      }
      if (p.horde) expect(share(p.horde.families, 'strainer'), `${id} horde`).toBe(0);
    }
    expect(share(MALL_HORDE.families, 'strainer')).toBe(0);
    expect(HORDE_FORBIDDEN_FAMILIES).toContain('strainer');
    expect(validateLevelRegistry()).toEqual([]);
  });

  it('validation guard: a positive Strainer weight outside a service context fails validateSpawnProfile and validateLevelRegistry', () => {
    const SUB = spawnProfile('subway'), OFF = spawnProfile('office'), MALL = spawnProfile('mall');
    const bad: [string, SpawnProfile][] = [
      ['level pool (Subway)', {...SUB, families: familyPool({strainer: 0.08})}],
      ['level pool (Office)', {...OFF, families: familyPool({siren: 0.19, strainer: 0.01})}],
      ['a core context\'s own pool', {...SUB, contexts: {...SUB.contexts, station: {...SUB.contexts.station!, families: familyPool({strainer: 0.1})}}}],
      ['the Office floors\' own pool', {...OFF, contexts: {...OFF.contexts, floor: {...OFF.contexts.floor!, families: familyPool({strainer: 0.05})}}}],
      ['the mall horde', {...MALL, horde: {...MALL.horde!, families: [['zombie', 1], ['blightbelly', 0], ['siren', 0], ['ratdog', 0], ['strainer', 0.2]]}}],
    ];
    for (const [what, p] of bad) expect(validateSpawnProfile(p).join('\n'), what).toMatch(/strainer/);
    expect(validateSpawnProfile(bad[0][1]).join('\n')).toMatch(/context-locked family .* level pool/);
    expect(validateSpawnProfile(bad[2][1]).join('\n')).toMatch(/contexts\.station\.families\.strainer: context-locked family/);
    expect(validateSpawnProfile(bad[4][1]).join('\n')).toMatch(/strainer never joins/);
    // the registry contract reports it too
    expect(validateLevelRegistry(LEVEL_IDS, LEVELS, {...SPAWN_PROFILES, subway: bad[0][1]}).join('\n')).toMatch(/subway: families\.strainer/);
    // a horde rule set with a Strainer is rejected on its own as well
    expect(validateHordeRules({...MALL.horde!, families: [['zombie', 1], ['strainer', 1]]}, ENEMY_FAMILY_IDS).join('\n')).toMatch(/strainer never joins/);
    // the service context's own pool may enable it (any weight); a level pool may list it at 0 (explicit exclusion)
    const svc = (w: number): SpawnProfile => ({...SUB, contexts: {...SUB.contexts, service: {...SERVICE_CONTEXT, families: familyPool({ratdog: 0.2, strainer: w})}}});
    expect(validateSpawnProfile(svc(0.3))).toEqual([]);
    expect(validateSpawnProfile(svc(0))).toEqual([]);
  });

  it('hordes never contain it: every horde roll of the registered horde pools is a non-Strainer family', () => {
    for (const id of LEVEL_IDS) {
      const h = spawnProfile(id).horde;
      if (!h) continue;
      for (let g = 0; g < 40; g++) for (let m = 0; m < 20; m++) expect(pickHordeFamily(h.families, hordeFamilyRoll(1000 + g, g, m))).not.toBe('strainer');
    }
  });

  it('model: enemy_strainer -> assets/models/enemy-strainer.glb, lazily loaded only for layouts that placed a Strainer', () => {
    expect(ENEMY_MODEL_FILES.enemy_strainer.url).toBe('assets/models/enemy-strainer.glb');
    expect(ENEMY_MODEL_FILES.enemy_strainer.bytes).toBeGreaterThan(0);
    const layout = (fams: (string | undefined)[]) => ({zombies: fams.map(archetype => ({archetype}))});
    expect(enemyModelKeysFor(layout([undefined, 'ratdog', 'zombie']))).toEqual([]);
    expect(enemyModelKeysFor(layout(['strainer']))).toEqual(['enemy_strainer']);
    expect(enemyModelKeysFor(layout(['strainer', undefined, 'blightbelly', 'strainer']))).toEqual(['enemy_blightbelly', 'enemy_strainer']);
    const g = syntheticStrainer();
    expect(withEnemyModels({}, k => (k === 'enemy_strainer' ? g : undefined)).enemy_strainer).toBe(g);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Strainer: core / non-service picks bit-identical; service-annex simulation', () => {
  it('every level pool (with and without room modifiers) picks exactly as the pre-Strainer pool — 200k (seed, index) rolls each', () => {
    const SUB = spawnProfile('subway');
    const roomed = roomFamilyPool({...SUB, rooms: {platform: {strainer: {weight: 9, density: 3}, ratdog: {weight: 2}}}}, {type: 'platform'});
    expect(share(roomed, 'strainer')).toBe(0); // a room modifier never creates weight from 0
    const pools: [string, FamilyPool, FamilyPool][] = [
      ...LEVEL_IDS.map(id => [id, spawnProfile(id).families, before(spawnProfile(id).families)] as [string, FamilyPool, FamilyPool]),
      ['subway platform room', roomed, before(roomed)],
    ];
    // the pre-change pools, literally (task track1 / mall round 3 values)
    expect(before(spawnProfile('subway').families)).toEqual([['zombie', 0.9], ['blightbelly', 0.05], ['siren', 0], ['ratdog', 0.05]]);
    expect(before(spawnProfile('office').families)).toEqual([['zombie', 0.71], ['blightbelly', 0.05], ['siren', 0.19], ['ratdog', 0.05]]);
    expect(before(spawnProfile('mall').families)).toEqual([['zombie', 0.1], ['blightbelly', 0.05], ['siren', 0.8], ['ratdog', 0.05]]);
    let strainers = 0;
    for (let k = 0; k < 200000; k++) {
      const seed = (k * 2654435761 + 12345) >>> 0, i = k % 53;
      for (const [what, now, old] of pools) {
        const a = pickEnemyArchetype(seed, i, now), b = pickEnemyArchetype(seed, i, old);
        if (a !== b) throw new Error(`${what}: seed ${seed} index ${i}: ${b} -> ${a}`);
        if (a === 'strainer') strainers++;
      }
    }
    expect(strainers).toBe(0);
  });

  it('Node sim: 2000 levels x (core + 1-2 annex runs) per level profile (16k service spawns each) — Strainers only in service spawns, ~0.08', () => {
    const lines: string[] = [];
    for (const id of LEVEL_IDS) {
      const P = spawnProfile(id);
      const ctxs = Object.keys(P.contexts).filter(c => c !== 'service') as (keyof typeof P.contexts)[];
      let svc = 0, svcStrainer = 0, svcRat = 0, svcBb = 0, core = 0, coreStrainer = 0, coreMoved = 0;
      for (let k = 0; k < 2000; k++) {
        // a level: core spawns in each core context, then 1-2 annex runs of 5-6 service spawns appended last (the generator's order)
        const zs: {archetype?: string; area?: number}[] = [];
        const layout = {seed: (k * 7919 + 17) >>> 0, zombies: zs as never[]};
        for (const c of ctxs) { const first = zs.length; for (let n = 0; n < 4; n++) zs.push({}); markSpawnContext(layout, first, c); }
        const nCore = zs.length;
        for (let a = 0; a < 1 + (k % 2); a++) { const first = zs.length; for (let n = 0; n < 5 + ((k + a) % 2); n++) zs.push({}); markSpawnContext(layout, first, 'service'); }
        assignEnemyArchetypes(layout as never, P);
        const got = zs.map(z => z.archetype);
        // the pre-Strainer assignment on the same layout and tags: the level pool / service pool without the Strainer row
        const old: SpawnProfile = {...P, families: before(P.families), contexts: {...P.contexts, service: {...P.contexts.service!, families: familyPool({ratdog: 0.2, blightbelly: 0.05, siren: 0})}}};
        assignEnemyArchetypes(layout as never, old);
        zs.forEach((z, i) => {
          const ctx = spawnContextOf(layout, P, i);
          if (ctx === 'service') {
            svc++;
            if (got[i] === 'strainer') svcStrainer++;
            if (got[i] === 'ratdog') svcRat++;
            if (got[i] === 'blightbelly') svcBb++;
            expect(got[i]).not.toBe('siren');
            // a Strainer only ever takes what was an ordinary-zombie / rat-dog / Blightbelly service draw — never adds a spawn
            if (got[i] === 'strainer') expect(['zombie', 'ratdog', 'blightbelly']).toContain(z.archetype);
          } else {
            expect(i).toBeLessThan(nCore);
            core++;
            if (got[i] === 'strainer') coreStrainer++;
            if (got[i] !== z.archetype) coreMoved++;
          }
        });
      }
      expect(coreStrainer, `${id}: no core Strainer`).toBe(0);
      expect(coreMoved, `${id}: core picks bit-identical`).toBe(0);
      const f = svcStrainer / svc;
      lines.push(`${id}: service ${svc} spawns -> Strainer ${svcStrainer} (${(100 * f).toFixed(2)} %), rat/dog ${(100 * svcRat / svc).toFixed(2)} %, Blightbelly ${(100 * svcBb / svc).toFixed(2)} %; core ${core} spawns, Strainer ${coreStrainer}, moved ${coreMoved}`);
      // ~0.08 within ~5.7 sigma of 16k draws (sigma 0.0021); the other service shares as configured
      expect(f, id).toBeGreaterThan(0.068);
      expect(f, id).toBeLessThan(0.092);
      expect(svcRat / svc, id).toBeGreaterThan(0.185);
      expect(svcRat / svc, id).toBeLessThan(0.215);
    }
    lines.push('configured service share 0.08 = a per-spawn selection probability (no quota, none forced, none guaranteed)');
    try { writeFileSync('/tmp/strainer-sim.txt', lines.join('\n') + '\n'); } catch { /* diagnostics only */ }
  });

  it('the service roll bands: zombie [0, 0.67), Blightbelly [0.67, 0.72), rat/dog [0.72, 0.92), Strainer [0.92, 1)', () => {
    let n = 0;
    for (let k = 0; k < 4000 && n < 400; k++) {
      const r = enemyRoll(k, 5);
      if (Math.min(...[0.67, 0.72, 0.92].map(b => Math.abs(r - b))) < 1e-9) continue;
      n++;
      expect(pickEnemyArchetype(k, 5, SERVICE_FAMILY_POOL)).toBe(r < 0.67 ? 'zombie' : r < 0.72 ? 'blightbelly' : r < 0.92 ? 'ratdog' : 'strainer');
    }
    expect(n).toBe(400);
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Strainer: stats vs the ordinary zombie, the melee brain', () => {
  // (user playtest 2026-11-01: "much to weak", "should lumber towards you, but be strong") — strong, slow, heavy-hitting
  it('stats: a durable, strong, LUMBERING threat — 6x health, heavy claws, far slower than a zombie, longer reach and recovery', () => {
    const T = STRAINER_STATS;
    expect(T.hp).toBe(1200); // (reach + squish task) user: "Needs double the health. 1,200 health"
    expect(T.hp).toBeGreaterThanOrEqual(10 * S.hp);
    expect(T.attackDamage).toBe(24);
    expect(T.attackDamage).toBeGreaterThanOrEqual(2 * S.attackDamage); // strong
    expect(T.wanderSpeed).toBe(0.4);
    expect(T.chaseSpeed).toBe(1.35);
    expect(T.chaseSpeed).toBeLessThan(0.6 * S.chaseSpeed); // it lumbers: far slower than a zombie's chase
    expect(T.chaseSpeed).toBeLessThan(3.4 / 2); // a walking player (3.4 m/s) easily outpaces it
    expect(T.chaseSpeed).toBe(STRAINER_ASSET.runGroundSpeed); // the chase clip plays at its authored speed (feet planted, no slide)
    expect(T.wanderSpeed).toBeCloseTo(STRAINER_ASSET.walkGroundSpeed, 1);
    expect(T.turnRate!).toBeLessThan(4.5); // a heavy body turns slowly
    expect(T.attackRange).toBeGreaterThan(S.attackRange); // the long arms
    // (reach + squish task) user: "double the reach of the swing": the previous range 1.931 -> 3.862, covered VISIBLY by the
    // lunging long-arm swipe (clip claw contact = reach + the player's radius) plus the lunge travel
    expect(STRAINER_REACH.previousRangeM).toBe(1.931);
    expect(T.attackRange).toBe(2 * 1.931);
    expect(STRAINER_REACH.contactM).toBe(strainerAttackRange(STRAINER_ASSET.reachM));
    expect(STRAINER_REACH.contactM).toBeCloseTo(STRAINER_ASSET.reachM + PLAYER_BODY_RADIUS, 6);
    expect(STRAINER_REACH.contactM + T.lunge!.distM).toBeCloseTo(T.attackRange, 2); // claws + lunge cover the whole range
    expect(T.lunge!.distM).toBeLessThan(1.5); // the arms carry most of it (no long leap)
    expect(T.lunge!.to).toBe(T.attackImpact); // the lunge lands with the claws
    expect(T.lunge!.from).toBeLessThan(T.lunge!.to);
    expect(T.lunge!.stopM).toBeLessThan(STRAINER_REACH.contactM); // never lunges past the point where the claws already reach
    expect(T.hitRange!).toBeCloseTo(STRAINER_REACH.contactM + 0.45, 6); // contact after the lunge: the visible claws + the usual slack
    expect(T.attackCooldown!).toBe(1.0); // a long recovery after the big swing (zombie default 0.45)
    expect(T.attackDuration).toBeGreaterThan(S.attackDuration); // a slower, telegraphed swipe
    expect(T.attackImpact).toBeGreaterThan(S.attackImpact);
    expect(T.attackImpact).toBe(STRAINER_ASSET.attackHitTime);
    expect(T.attackDuration).toBe(STRAINER_ASSET.attackDuration);
    expect(T.attackImpact).toBeLessThan(T.attackDuration);
    expect(T.sightRange).toBe(S.sightRange);
    expect(T.radius).toBeLessThan(0.5); // passes every 1.0 m opening
    expect(T.chaseAnim).toBe('Run');
    expect(strainerAttackRange(0.2)).toBeGreaterThan(S.attackRange); // never shorter than a zombie's
    expect(strainerAttackRange(5)).toBe(3.0); // never an invisible reach
    // no global retune: the other families are untouched
    expect(ZOMBIE_STATS.shambler).toMatchObject({hp: 100, chaseSpeed: 2.55, attackDamage: 10, attackRange: 1.35, radius: 0.33});
    expect(BLIGHTBELLY_STATS).toMatchObject({hp: 100, chaseSpeed: 1.6, attackDamage: 10});
    // size: its own narrow jitter keeps the crown under 2.25 m (annex doors 2.3 m)
    expect(STRAINER_ASSET.heightM * STRAINER_SCALE.max).toBeLessThan(STRAINER_MAX_TOP_M);
    expect(STRAINER_MAX_TOP_M).toBeLessThan(2.3);
    expect(STRAINER_ASSET.heightM * 1.0).toBeGreaterThan(1.9); // taller than a zombie
  });

  /** A flat open world: the player in sight; findPath records its options. */
  const world = (px: number, pz: number, paths: unknown[]): BrainWorld => ({
    px, pz, playerAlive: true, los: () => true, walkClear: () => false, rand: rng(3),
    findPath: (_ax, _az, bx, bz, o) => { paths.push(o ?? {}); return [[bx, bz]]; }, randomNear: () => null,
  });

  it('brain: the ordinary melee brain; long reach starts a swing a zombie cannot; claws land at the clip hit time; no ladder links', () => {
    // 1.8 m away, facing the player: inside the Strainer's reach, beyond the zombie's 1.35
    const sb = new StrainerBrain(0, 0, 0), zb = new ZombieBrain('shambler', 0, 0, 0);
    expect(sb).toBeInstanceOf(ZombieBrain);
    expect(sb.archetype).toBe('strainer');
    const sp: unknown[] = [], zp: unknown[] = [];
    const ws = world(0, 1.8, sp), wz = world(0, 1.8, zp);
    let start = -1, hitAt = -1, zAttack = false;
    for (let t = 0; t < 3; t += 1 / 60) {
      const o = sb.update(1 / 60, ws);
      if (sb.state === 'attack' && start < 0) start = t;
      if (o.attackHit && hitAt < 0) hitAt = t;
      zb.update(1 / 60, wz);
      if (zb.state === 'attack') zAttack = true;
    }
    expect(start).toBeGreaterThanOrEqual(0);
    expect(hitAt - start).toBeGreaterThan(STRAINER_STATS.attackImpact - 0.05);
    expect(hitAt - start).toBeLessThan(STRAINER_STATS.attackImpact + 0.05);
    expect(zAttack).toBe(false); // out of the zombie's reach
    // every path request of the Strainer ignores ladder nav links; the plain zombie's does not
    const far: unknown[] = [];
    const s2 = new StrainerBrain(0, 0, 0), wf = world(0, 12, far);
    for (let t = 0; t < 1.5; t += 1 / 30) s2.update(1 / 30, wf);
    const zf: unknown[] = [];
    const z2 = new ZombieBrain('shambler', 0, 0, 0), wzf = world(0, 12, zf);
    for (let t = 0; t < 1.5; t += 1 / 30) z2.update(1 / 30, wzf);
    expect(far.length).toBeGreaterThan(0);
    expect(far.every(o => (o as {noLinks?: boolean}).noLinks === true)).toBe(true);
    expect(zf.length).toBeGreaterThan(0);
    expect(zf.some(o => (o as {noLinks?: boolean}).noLinks === true)).toBe(false);
  });

  it('dies once like every enemy (the brain\'s own contract); 12x the zombie\'s health (user: "1,200 health")', () => {
    const b = new StrainerBrain(0, 0, 0);
    for (let k = 0; k < 11; k++) expect(b.damage(S.hp, 0, 2), `zombie-worth ${k + 1}`).toBe(false); // eleven zombies' worth is not enough
    expect(b.alive).toBe(true);
    expect(b.damage(S.hp, 0, 2)).toBe(true);
    expect(b.damage(50, 0, 2)).toBe(false);
  });

  // lane AUDIO (strainer squish set): the VOICE stays the zombie calls; footfalls are its own wet set (tests/strainer-audio.test.ts)
  it('audio: the existing zombie voice calls through the cue adapter, from its taller mouth; its own wet footfalls', () => {
    const calls: string[] = [];
    const sfx = new Proxy({}, {get: (_t, k) => (...a: unknown[]) => { calls.push(`${String(k)}:${(a[1] as number)?.toFixed?.(2) ?? ''}`); }}) as never;
    const a = new StrainerActor(syntheticStrainer(), spawnAt(0, 0), rng(1));
    expect(enemyCues(a as unknown as EnemyActor)).toBe(STRAINER_CUES);
    STRAINER_CUES.alert(sfx, a as never);
    STRAINER_CUES.attack(sfx, a as never);
    a.groanT = 0;
    STRAINER_CUES.tick(sfx, a as never, 0.1, 1.2, 5, rng(2));
    STRAINER_CUES.death(sfx, a as never);
    expect(calls.map(c => c.split(':')[0])).toEqual(['groan', 'zombieAttack', 'groan', 'strainerGait', 'zombieDeath']);
    expect(calls[0]).toBe('groan:1.90'); // voice height (feet y 0 + 1.9)
  });
});

// ---------------------------------------------------------------------------------------------------------------------------
describe('Strainer: actor (shared rig), head zone, fallback, ragdoll, persistence', () => {
  it('createEnemyActor: the StrainerActor with its model; without it the COUNTED zombie stand-in (never a T-pose)', () => {
    const none = createEnemyActor(spawnAt(1, 2), {}, rng(1), zombieStandIn);
    expect(none.fallback).toBe(true);
    expect((none.actor as unknown as {stand: string}).stand).toBe('zombie');
    expect(archetypeOf(none.actor)).toBe('zombie');
    const g = syntheticStrainer();
    const ok = createEnemyActor(spawnAt(1, 2, 0.5), {enemy_strainer: g}, rng(1), zombieStandIn);
    expect(ok.fallback).toBe(false);
    expect(ok.actor).toBeInstanceOf(StrainerActor);
    expect(archetypeOf(ok.actor)).toBe('strainer');
    expect(ok.actor.brain).toBeInstanceOf(StrainerBrain);
    expect(ok.actor.brain.stats).toBe(STRAINER_STATS);
    expect(ok.actor.hasRig).toBe(true);
    expect(ok.actor.meshes.length).toBe(1);
    expect([ok.actor.brain.x, ok.actor.brain.z, ok.actor.brain.yaw]).toEqual([1, 2, 0.5]);
    // a template missing a clip is not a rig (the stand-in rule is the caller's: the model is what matters)
    const partial = syntheticStrainer();
    partial.animations = partial.animations.filter(c => c.name !== 'Attack');
    expect(new StrainerActor(partial, spawnAt(0, 0), rng(1)).hasRig).toBe(false);
    expect(STRAINER_BONES.length).toBe(11);
  });

  it('scale: its own narrow 0.97..1.03 jitter; the crown never above 2.25 m', () => {
    const g = syntheticStrainer();
    let lo = Infinity, hi = -Infinity;
    for (let s = 1; s < 60; s++) {
      const a = new StrainerActor(g, spawnAt(0, 0), rng(s * 7919));
      lo = Math.min(lo, a.scale); hi = Math.max(hi, a.scale);
      expect(a.root.scale.x).toBe(a.scale);
    }
    expect(lo).toBeGreaterThanOrEqual(STRAINER_SCALE.min);
    expect(hi).toBeLessThanOrEqual(STRAINER_SCALE.max);
    expect(hi * STRAINER_ASSET.heightM).toBeLessThan(STRAINER_MAX_TOP_M);
  });

  it('hit zones: a head sphere at the contract headCenter (hunched FORWARD), x scale; ordinary body hits elsewhere; follows the Head bone', () => {
    const extras = {headCenter: [0, 2.0, 0.24] as [number, number, number], headRadius: 0.12};
    const a = new StrainerActor(syntheticStrainer(extras), spawnAt(3, 4, 0), rng(5));
    a.root.position.y = 0;
    const v = a.updateVolumes();
    expect(v.map(x => x.part)).toEqual(['head', 'torso', 'limb', 'limb', 'limb', 'limb']);
    const head = v[0], s = a.scale;
    expect(head.r).toBeCloseTo(extras.headRadius * s, 6);
    expect(head.a.x - 3).toBeCloseTo(0, 6);
    expect(head.a.y).toBeCloseTo(extras.headCenter[1] * s, 6);
    expect(head.a.z - 4).toBeCloseTo(extras.headCenter[2] * s, 6); // +Z forward (yaw 0)
    const hips = a.bone('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(head.a.z).toBeGreaterThan(hips.z + 0.15); // hunched forward of the body
    // a frontal shot at the head centre hits the HEAD first; a chest-high shot hits the torso (nearest volume wins, as Game.fire)
    const first = (o: THREE.Vector3, d: THREE.Vector3) => {
      let best = Infinity, part = 'none';
      for (const h of v) { const t = h.b ? rayCapsule(o, d, h.a, h.b, h.r) : raySphere(o, d, h.a, h.r); if (t < best) { best = t; part = h.part; } }
      return part;
    };
    const eye = (y: number) => new THREE.Vector3(3, y, 12);
    expect(first(eye(head.a.y), new THREE.Vector3(head.a.x - 3, 0, head.a.z - 12).normalize())).toBe('head');
    expect(first(eye(1.4), new THREE.Vector3(0, 0, -1))).toBe('torso');
    // the defaults when the extras omit the head (STRAINER_ASSET)
    const d = new StrainerActor(syntheticStrainer(), spawnAt(0, 0, 0), rng(5));
    d.root.position.y = 0;
    const dh = d.updateVolumes()[0];
    expect(dh.r).toBeCloseTo(STRAINER_ASSET.headRadius * d.scale, 6);
    expect(dh.a.z).toBeCloseTo(STRAINER_ASSET.headCenter[2] * d.scale, 6);
    // the head zone rides the Head bone (bend the neck forward: the sphere moves with it)
    const z0 = a.updateVolumes()[0].a.z;
    a.bone('Neck')!.rotation.x = 0.6;
    expect(a.updateVolumes()[0].a.z).toBeGreaterThan(z0 + 0.02);
    expect(a.corpseVolumes()).toHaveLength(6);
    // dead: no live volumes (corpse volumes stay for the damage system)
    a.brain.damage(9999, 3, 8);
    expect(a.updateVolumes()).toEqual([]);
  });

  it('animates its own clips (Walk / Run time-scaled by the authored ground speed); the attack replays per swing', () => {
    const a = new StrainerActor(syntheticStrainer(), spawnAt(0, 0), rng(1));
    expect(a.clip).toBe('Idle');
    a.animate(0.1, 'Walk', 0.5);
    expect(a.clip).toBe('Walk');
    a.animate(0.1, 'Run', 2.4);
    expect(a.clip).toBe('Run');
    expect(a.clipSpeed('Walk')).toBe(STRAINER_ASSET.walkGroundSpeed);
    const b = new StrainerActor(syntheticStrainer({clips: {Run: {groundSpeed: 1.9}}}), spawnAt(0, 0), rng(1));
    expect(b.clipSpeed('Run')).toBe(1.9);
    (a.brain as unknown as {attackSeq: number}).attackSeq = 1;
    a.animate(0.1, 'Attack', 0);
    expect(a.clip).toBe('Attack');
    a.animate(0.1, 'Death', 0);
    expect(a.clip).toBe('Death');
    a.dispose();
  });

  it('ragdoll: the humanoid rig on the shared skeleton names; the corpse falls and settles (existing contracts)', () => {
    for (const p of HUMANOID_RIG.parts) expect(JOINTS.some(([j]) => j === p.bone), p.bone).toBe(true);
    const g = new Grid(32, 32);
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) g.set(x, y, x < 2 || y < 2 || x >= 30 || y >= 30 ? SOLID : FLOOR);
    const ph = new PhysicsSystem(null);
    ph.build({grid: g, props: [], trench: {floorY: -1.15}} as never);
    const a = new StrainerActor(syntheticStrainer(), spawnAt(8, 8, 0.3), rng(4));
    a.root.position.y = 0;
    for (let i = 0; i < 4; i++) { a.animate(1 / 30, 'Walk', 0.5); a.updateVolumes(); }
    expect(a.brain.damage(STRAINER_STATS.hp, 8, 11)).toBe(true); // one lethal hit (its full health)
    expect(ph.ragdoll(a, {dir: {x: 0, y: -0.1, z: -1}, point: {x: 8, y: 1.3, z: 8}, strength: killImpulseStrength('rifle', 1, 1)})).toBe(true);
    expect(a.ragdolled).toBe(true);
    for (let t = 0; t < 4; t += 1 / 60) ph.update(1 / 60);
    a.root.updateMatrixWorld(true);
    const hips = a.bone('Hips')!.getWorldPosition(new THREE.Vector3());
    expect(Number.isFinite(hips.x + hips.y + hips.z)).toBe(true);
    expect(hips.y).toBeLessThan(0.8); // down (standing hips 1.1 m)
    expect(hips.y).toBeGreaterThan(-0.2); // never through the floor
  });

  it('save / load: a killed Strainer stays dead through a run snapshot; a living one comes back as a Strainer at the same index', () => {
    const P = spawnProfile('subway');
    // a level whose annex rolled Strainers (service spawns appended after the core, the generator's order); found by the roll itself
    const make = (seed: number) => {
      const zs: ZombieSpawn[] = [];
      const layout = {seed, zombies: zs};
      for (let n = 0; n < 24; n++) zs.push({x: n, z: 0, yaw: 0, type: 'shambler', area: 0});
      markSpawnContext(layout, 0, 'station');
      for (let n = 0; n < 12; n++) zs.push({x: n, z: 30, yaw: 0, type: 'shambler', area: 1});
      markSpawnContext(layout, 24, 'service');
      assignEnemyArchetypes(layout as never, P);
      return layout;
    };
    let seed = 1;
    while (make(seed).zombies.filter(z => z.archetype === 'strainer').length < 2) seed++;
    const L = make(seed);
    const idx = L.zombies.flatMap((z, i) => (z.archetype === 'strainer' ? [i] : []));
    expect(idx.every(i => i >= 24)).toBe(true); // service spawns only
    const [dead, alive] = idx;
    const key = {level: 'subway' as const, section: 'main'};
    const mem = createMemory(key);
    mem.killed = mergeKilled(mem.killed, [dead]);
    const snap = takeSnapshot({level: 'subway', section: 'main', arrival: {kind: 'start'} as never},
      {inv: new Inventory(), player: {hp: 80, stamina: 1, damageTaken: 0}, survival: {hunger: 0, thirst: 0, time: 0}, battery: {charge: 1, on: false, died: false}, participants: [], stats: {}},
      {[mem.id]: mem});
    const restored = JSON.parse(JSON.stringify(snap)).memories[mem.id];
    // reload: the same seed regenerates the same families at the same indices; the killed Strainer is not spawned again
    const L2 = make(seed);
    expect(L2.zombies.map(z => z.archetype)).toEqual(L.zombies.map(z => z.archetype));
    const toSpawn = enemiesToSpawn(L2.zombies.length, restored);
    expect(toSpawn).not.toContain(dead);
    expect(toSpawn).toContain(alive);
    const g = syntheticStrainer();
    const {actor, fallback} = createEnemyActor(L2.zombies[alive], {enemy_strainer: g}, rng(2), zombieStandIn);
    expect(fallback).toBe(false);
    expect(archetypeOf(actor)).toBe('strainer');
    expect(actor.brain.hp).toBe(STRAINER_STATS.hp);
  });
});

// Task studio-alpha-strainer-lumbering-wetness-20261101-01 (user playtest): the strong body shrugs off ordinary rounds, the wet
// finish layers on the original Meshy maps, and the wet-shine trail is bounded, spaced by distance and on the floor it walks on.
describe('Strainer lumbering / wet (user playtest 2026-11-01)', () => {
  it('stagger resistance: only a single hit >= STRAINER_STAGGER_MIN staggers it; smaller hits still wake it into a chase', () => {
    for (const amount of [17, 24, 30, 44]) {
      const b = new StrainerBrain(0, 0, 0);
      expect(b.damage(amount, 0, 5), `${amount}`).toBe(false);
      expect(b.state, `${amount}: no stun-lock`).toBe('chase');
    }
    const big = new StrainerBrain(0, 0, 0);
    big.damage(STRAINER_STAGGER_MIN, 0, 5);
    expect(big.state).toBe('stagger');
    const z = new ZombieBrain('shambler', 0, 0, 0);
    z.damage(24, 0, 5);
    expect(z.state).toBe('stagger'); // the ordinary zombie is unchanged
  });

  it('wet finish: a runtime layer on the ORIGINAL material (roughness factor down, colour darker), template untouched', () => {
    const g = syntheticStrainer();
    const src = (() => { let m: THREE.MeshStandardMaterial | null = null; g.scene.traverse(o => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) m = s.material as THREE.MeshStandardMaterial; }); return m!; })();
    src.roughness = 1; src.color.setRGB(1, 1, 1);
    const a = new StrainerActor(g, spawnAt(0, 0, 0), rng(3));
    let mat: THREE.MeshStandardMaterial | null = null;
    a.root.traverse(o => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh) mat = s.material as THREE.MeshStandardMaterial; });
    expect(mat!.roughness).toBeCloseTo(STRAINER_WET.roughnessFactor, 6);
    expect(mat!.color.r).toBeCloseTo(STRAINER_WET.darken, 6);
    expect(src.roughness).toBe(1); // the shared template keeps its own values
  });

  it('wet-shine trail: one mark per spacing of travel, alternating feet, on the brain floor (storey-aware), bounded per step', () => {
    const t = new StrainerWetTrail(), key = {}, marks: [number, number, number, number][] = [];
    const drop = (x: number, y: number, z: number, s: number) => { marks.push([x, y, z, s]); };
    const b = {x: 0, y: -1.2, z: 0, yaw: 0, alive: true, state: 'chase'};
    expect(t.step(key, b, false, drop, () => 0.5)).toBe(0); // first sight: no mark
    for (let i = 0; i < 30; i++) { b.z += 0.1; t.step(key, b, false, drop, () => 0.5); } // 3 m walked
    expect(marks.length).toBe(Math.floor(3 / STRAINER_TRAIL.spacingM + 1e-9));
    for (const m of marks) { expect(m[1]).toBeCloseTo(-1.2 + STRAINER_TRAIL.liftM, 6); expect(m[3]).toBeGreaterThanOrEqual(STRAINER_TRAIL.size[0]); expect(m[3]).toBeLessThanOrEqual(STRAINER_TRAIL.size[1]); }
    expect(Math.sign(marks[0][0])).toBe(-Math.sign(marks[1][0])); // left / right feet
    for (const m of marks) expect(m[2]).toBeLessThan(b.z); // behind it
    const n0 = marks.length;
    for (const state of ['dead', 'climb', 'stagger']) { const d = {...b, state}; d.z += 2; t.step(key, d, false, drop, () => 0.5); b.z = d.z; }
    t.step(key, {...b, z: b.z + 1}, true, drop, () => 0.5); // ragdolled
    expect(marks.length).toBe(n0);
    t.step(key, {...b, z: b.z + 40}, false, drop, () => 0.5); // a placement jump is not a walk
    expect(marks.length).toBe(n0);
    const k2 = {}, b2 = {x: 0, y: 0, z: 0, yaw: 0, alive: true, state: 'chase'};
    t.step(k2, b2, false, drop, () => 0.5);
    expect(t.step(k2, {...b2, z: 2.9}, false, drop, () => 0.5)).toBeLessThanOrEqual(4); // never unbounded per step
    // the marks live in ONE fixed instanced ring (fx WET_TRAIL: cap, lifetime): nothing accumulates without bound
    expect(WET_TRAIL.cap).toBeLessThanOrEqual(64);
    expect(WET_TRAIL.lifetimeS).toBeLessThanOrEqual(20);
  });
});

// Task studio-alpha-strainer-reach-squish-20261101-201110-01 (user: "double the reach of the swing ... using its long arms"): the
// swing starts from 3.862 m; the body lunges toward the player only inside the clip's lunge window (motor-applied), and the claws
// connect only within their visible contact (+ the usual slack) after the lunge — a retreating player is missed.
describe('Strainer lunging long-arm swipe (reach doubled)', () => {
  const W = (pz: () => number): BrainWorld => ({
    get px() { return 0; }, get pz() { return pz(); }, playerAlive: true, los: () => true, walkClear: () => false, rand: rng(5),
    findPath: (_ax, _az, bx, bz) => [[bx, bz]], randomNear: () => null,
  } as unknown as BrainWorld);
  /** Run one swing with a minimal motor (out.speed along out.dir); `player(t)` = the player's z at time t since the swing began. */
  function swing(start: number, player: (t: number) => number) {
    const b = new StrainerBrain(0, 0, 0);
    let t0 = -1, t = 0, hit = false, lungeFrom = -1, lungeTo = -1;
    const z0 = b.z;
    const w = W(() => player(t0 < 0 ? 0 : t - t0) + start);
    for (; t < 4; t += 1 / 60) {
      const o = b.update(1 / 60, w);
      if (b.state === 'attack' && t0 < 0) t0 = t;
      if (o.speed > 0 && b.state === 'attack') { if (lungeFrom < 0) lungeFrom = t - t0; lungeTo = t - t0; b.x += o.dirX * o.speed / 60; b.z += o.dirZ * o.speed / 60; }
      if (o.attackHit) hit = true;
      if (t0 >= 0 && b.state !== 'attack') break;
    }
    return {hit, started: t0 >= 0, lunged: b.z - z0, lungeFrom, lungeTo};
  }

  it('hits a player standing 3.8 m away after a ~1.25 m lunge inside the lunge window; the swing starts from up to 3.862 m', () => {
    const r = swing(3.8, () => 0);
    expect(r.started).toBe(true);
    expect(r.hit).toBe(true);
    expect(r.lunged).toBeGreaterThan(1.0);
    expect(r.lunged).toBeLessThanOrEqual(STRAINER_REACH.lungeM + 0.05);
    expect(r.lungeFrom).toBeGreaterThanOrEqual(STRAINER_STATS.lunge!.from - 0.02);
    expect(r.lungeTo).toBeLessThanOrEqual(STRAINER_STATS.lunge!.to + 0.02);
    expect(swing(3.95, () => 0).started).toBe(false); // beyond the doubled range: no swing
  });

  it('misses a player who steps back out of the claws\' reach during the wind-up (no invisible hit); no lunge when already in reach', () => {
    expect(swing(3.8, t => Math.min(1.6, t * 2)).hit).toBe(false); // backs off 1.6 m before the impact
    const close = swing(2.0, () => 0);
    expect(close.hit).toBe(true);
    expect(close.lunged).toBe(0); // within the visible claw reach already: the swipe lands in place
    const z = new ZombieBrain('shambler', 0, 0, 0), w = W(() => 1.2);
    for (let t = 0; t < 2; t += 1 / 60) { const o = z.update(1 / 60, w); if (z.state === 'attack') expect(o.speed).toBe(0); } // zombies never lunge
  });
});
