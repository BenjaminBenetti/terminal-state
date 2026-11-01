// Task studio-beta-mall-round3-20261031-01 (lane ENEMY): the GENERATED-MALL checks of R2 and R8 on ONE memoized sample of five malls
// (the first five seeds of the 48-mall census, tuning / validation halves alternating) — every mall is generated once per file.
// The malls are the CORE generation (generateMallLevel without the Track2 annex and the street-exit post-pass): the registry path adds
// only those two, appended after every core record (the annex pool has no Siren; core spawn indices / positions unchanged) — measured
// identical Siren placements on 12 of 12 seeds and identical t3a spawns (lanes/ENEMY-evidence / ENEMY.notes); the rest of the
// registry path (lazy keys, spawn, actor) is checked below.
//
// R8 (user: "I've done a bunch of mall runs, and not found a siren ever, confirm that siren can spawn on this level. with chance similar
// to office space, i.e. average 2 per mall."):
//  1. the runtime path: placed dormant Sirens on the retail floors -> the section's lazy model keys (game.ts modelKeysFor:
//     enemyModelKeysFor + selectLevelKeys over the game's catalogue) carry 'enemy_siren' (shared, never 'foreign' to the mall), the
//     file is in game/public and in the release allowlist under the literal path the bundle references (package-ci ships referenced
//     models) -> a fresh run spawns every index -> SirenSystem.skip false with her model -> createEnemyActor builds a SirenActor from the
//     REAL enemy-siren.glb (textures stripped: no image decoder in Node) -> adopt() leaves her DORMANT with her vein patch on her floor.
//     Nothing culls / replaces her (actors are never culler-registered). "Never found one" was rarity (mean 0.79, 37.5 % of malls none).
//  2. the retune (ai/spawnTables.ts MALL_RING_PLACEMENT, cap 4, 24 m): the 48-mall census is mean 1.96, 8.3 % none, max 4 (evidence).
//     This 5-mall sample bounds the mean only roughly (per-mall sd ~1.0 -> standard error ~0.46): the band 1.4..3.0 (sum 7..15) holds
//     the census mean with margin (~1.2 SE below it), while the old tuning (mean 0.79, sd 0.7) would reach a 5-mall sum >= 7 only
//     ~5 % of the time — a regression guard, not a precision census.
// R2 (user: "When killing zombies at the subway terminal the open atrium often causes zombies higher up to agro, causing them to run
// down in a big stream"): ai/brain.ts ATRIUM_PERCEPTION before / after on one sample mall (tests/helpers/aggroSim.ts): a horde at the
// rail above the pit (the stream reproduced at once before: one sighting sends the crowd) and firing at the level start.

import {beforeAll, describe, expect, it} from 'vitest';
import {readFileSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GLTFLoader, type GLTF} from 'three/addons/loaders/GLTFLoader.js';
import * as THREE from 'three';
import {NodeIO} from '@gltf-transform/core';
import {LEVEL_IDS} from '../src/levels/registry';
import {generateMallLevel} from '../src/gen/mall/index';
import {levelsOf} from '../src/gen/levels';
import type {StationLayout, ZombieSpawn} from '../src/gen/stationTypes';
import {ATRIUM_PERCEPTION} from '../src/ai/brain';
import {MALL_SIREN_ELIGIBILITY, MALL_SIREN_SPACING, MALL_SPAWN_PROFILE, eligibilityFailure, spawnContextOf} from '../src/ai/spawnTables';
import {ENEMY_MODEL_FILES, enemyModelKeysFor, withEnemyModels} from '../src/ai/enemyModels';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {P7_FILES, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {officeModelKeysFor} from '../src/gen/office/index';
import {SIREN_MODEL_KEY, SirenActor} from '../src/ai/sirenActor';
import {SirenBrain} from '../src/ai/siren';
import {SirenSystem, type SirenHost} from '../src/ai/sirenSystem';
import {createEnemyActor, type EnemyActor} from '../src/ai/creatureArchetypes';
import {RunState} from '../src/run/runState';
import {createMemory, enemiesToSpawn} from '../src/run/memory';
import type {Sfx} from '../src/audio/sfx';
import {aggroSim} from './helpers/aggroSim';

const has = (LEVEL_IDS as readonly string[]).includes('mall');
/** The first five of the 48-mall census seeds (9100 + 104729k / 50021 + 7919k alternating). */
const SEEDS = Array.from({length: 5}, (_, k) => k % 2 === 0 ? 9100 + 104729 * (k >> 1) : 50021 + 7919 * (k >> 1));
/** The game's lazy model catalogue (game.ts propModels; the annex genset key is irrelevant here). */
const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES} as Record<string, {url: string; bytes: number}>;
const PUB = (rel: string) => fileURLToPath(new URL(`../public/${rel}`, import.meta.url));
const layouts = new Map<number, StationLayout>();
/** Memoized core generation of a sample seed (see the header). */
const get = (seed: number): StationLayout => {
  let l = layouts.get(seed);
  if (!l) layouts.set(seed, (l = generateMallLevel({levelSeed: seed, startWeapon: 'pistol'}, {trackExt: 'none', streetExits: false})));
  return l;
};

/**
 * A copy of `layout` with one roaming horde (the largest that fits) standing along the void edge of its storey, every placed member
 * facing down at a pit spot 14.5-18 m away (3D) in clear sight and within 6 m of the first (its call radius): inside the established
 * 18 m PLAN sight range, beyond the open-atrium notice range (13.5 m 3D). It is the moment the user described (a group on the gallery
 * above the subway terminal), set up directly instead of waiting for the patrol to get there (organically, e.g. t3a at ~62 s in the
 * 12-mall census: lanes/ENEMY-evidence in the task folder). Null when no spot fits.
 */
function hordeAtTheRail(layout: StationLayout): {layout: StationLayout; spot: {x: number; z: number}; level: number; placed: number} | null {
  const L = levelsOf(layout), G0 = L.grid(0), M = layout.mall!;
  const inRect = (x: number, z: number, r: {x0: number; z0: number; x1: number; z1: number}, m = 0) => x >= r.x0 - m && x <= r.x1 + m && z >= r.z0 - m && z <= r.z1 + m;
  // pit spots under the floor-1 opening (the column open to the roof), every metre
  const spots: {x: number; y: number; z: number}[] = [];
  for (let y = 2; y < G0.h - 2; y += 2) for (let x = 2; x < G0.w - 2; x += 2) {
    const [wx, wz] = G0.center(x, y);
    if (inRect(wx, wz, M.void.bounds) && G0.walkable(x, y) && G0.circleClear(wx, wz, 0.4)) spots.push({x: wx, y: G0.floorAt(wx, wz), z: wz});
  }
  const sees = (x: number, y: number, z: number, s: {x: number; y: number; z: number}) => L.lineOfSight({x, y: y + 1.5, z}, {x: s.x, y: s.y + 1.5, z: s.z});
  for (const h of [...(layout.hordes ?? [])].sort((p, q) => q.members.length - p.members.length)) {
    const base = layout.levels[h.level].baseY, G = L.grid(h.level);
    const op = M.void.openings?.find(o => o.level === h.level)?.bounds ?? M.void.bounds;
    // the gallery strip along this storey's opening (within 3 m of it), every cell
    const strip: [number, number, number][] = [];
    for (let y = 1; y < G.h - 1; y++) for (let x = 1; x < G.w - 1; x++) {
      const [wx, wz] = G.center(x, y);
      if (!inRect(wx, wz, op, 3) || !G.walkable(x, y) || !G.circleClear(wx, wz, 0.35)) continue;
      const f = G.floorAt(wx, wz);
      if (Math.abs(f - base) <= 0.3) strip.push([wx, wz, f]);
    }
    for (const s of spots) {
      const vis = strip.filter(([x, z, f]) => { const d2 = Math.hypot(x - s.x, z - s.z), d3 = Math.hypot(d2, f - s.y); return d2 <= 17 && d3 > 14.5 && d3 <= 18 && sees(x, f, z, s); });
      if (vis.length < 6) continue;
      const c0 = vis.reduce((p, q) => (Math.hypot(q[0] - s.x, q[1] - s.z) < Math.hypot(p[0] - s.x, p[1] - s.z) ? q : p));
      vis.sort((p, q) => Math.hypot(p[0] - c0[0], p[1] - c0[1]) - Math.hypot(q[0] - c0[0], q[1] - c0[1]));
      const at: [number, number, number][] = [];
      for (const c of vis) if (at.length < h.members.length && Math.hypot(c[0] - c0[0], c[1] - c0[1]) <= 5.5 && at.every(q => Math.hypot(q[0] - c[0], q[1] - c[1]) >= 0.9)) at.push(c);
      if (at.length < 6) continue;
      const zombies = layout.zombies.map(z => ({...z}));
      at.forEach(([x, z, y], k) => { Object.assign(zombies[h.members[k]], {x, z, y, yaw: Math.atan2(s.x - x, s.z - z)}); });
      const node = M.patrol.filter(n => n.level === h.level).reduce((p, q) => (Math.hypot(q.x - c0[0], q.z - c0[1]) < Math.hypot(p.x - c0[0], p.z - c0[1]) ? q : p));
      const hordes = layout.hordes!.map(q => (q === h ? {...q, startNode: node.id, start: {x: c0[0], y: base, z: c0[1]}} : q));
      return {layout: {...layout, zombies, hordes}, spot: {x: s.x, z: s.z}, level: h.level, placed: at.length};
    }
  }
  return null;
}

describe('mall Sirens (R8)', () => {
  let real: GLTF;
  beforeAll(async () => {
    const io = new NodeIO();
    const doc = await io.read(PUB(ENEMY_MODEL_FILES[SIREN_MODEL_KEY].url));
    for (const t of doc.getRoot().listTextures()) t.dispose();
    const bin = await io.writeBinary(doc);
    real = await new Promise<GLTF>((res, rej) => new GLTFLoader().parse(bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength) as ArrayBuffer, '', res, rej));
  });

  (has ? it : it.skip)('the runtime path on a generated mall: placed -> model key loaded -> spawned -> a dormant Siren actor on her retail floor', () => {
    const seed = SEEDS.find(s => get(s).zombies.filter(z => z.archetype === 'siren').length >= 2)!;
    expect(seed, 'a sample mall with at least two Sirens').toBeDefined();
    const l = get(seed), L = levelsOf(l), P = MALL_SPAWN_PROFILE;
    const sirens = l.zombies.map((z, i) => ({z, i})).filter(e => e.z.archetype === 'siren');
    // the section's lazy keys exactly as Game.modelKeysFor selects them: 'enemy_siren' requested, never rejected as another level's
    const sel = selectLevelKeys('mall', [...new Set([...p7ModelKeysFor(l), ...officeModelKeysFor(l as never), ...enemyModelKeysFor(l)])], CATALOGUE);
    expect(enemyModelKeysFor(l)).toContain(SIREN_MODEL_KEY);
    expect(sel.keys).toContain(SIREN_MODEL_KEY);
    expect(sel.foreign).not.toContain(SIREN_MODEL_KEY);
    // the file ships: in game/public with the allowlisted size / path, the path literal the bundle references (package-ci keeps a model
    // whose path appears in the code)
    const url = ENEMY_MODEL_FILES[SIREN_MODEL_KEY].url;
    const allow = (JSON.parse(readFileSync(fileURLToPath(new URL('../../tools/release/public-inputs.json', import.meta.url)), 'utf8')) as {files: {path: string; bytes: number}[]}).files;
    const entry = allow.find(f => f.path === url);
    expect(entry, 'release allowlist').toBeDefined();
    expect(statSync(PUB(url)).size).toBe(entry!.bytes);
    expect(readFileSync(fileURLToPath(new URL('../src/ai/enemyModels.ts', import.meta.url)), 'utf8')).toContain(`'${url}'`);
    // a fresh run spawns every placed index (killed ones only are skipped)
    const live = new Set(enemiesToSpawn(l.zombies.length, createMemory({level: 'mall', section: 'main'})));
    // the game's build loop: sirens.skip (model loaded: false) -> spawnEnemy (createEnemyActor with the lazy models) -> adopt
    const run = new RunState({seeds: {subway: 1, office: 2, mall: seed}, start: {level: 'mall', section: 'main'}});
    const host: SirenHost = {
      scene: new THREE.Group(), levels: L, layout: {seed: l.seed, zombies: l.zombies as ZombieSpawn[]}, run, frameHooks: [], sectionHooks: [],
      warmRegistry: {addPool: () => {}}, propModels: {get: k => (k === SIREN_MODEL_KEY ? real : undefined)}, sfx: {sirenHumStop: () => {}} as unknown as Sfx,
    };
    const sys = new SirenSystem(host).install();
    let seq = 7;
    const rand = () => ((seq = (seq * 16807) % 2147483647) / 2147483647);
    const actors: EnemyActor[] = [];
    for (const {z, i} of sirens) {
      expect(live.has(i)).toBe(true);
      expect(sys.skip(z)).toBe(false);
      const {actor, fallback} = createEnemyActor(z as ZombieSpawn, withEnemyModels({}, k => host.propModels.get(k)), rand, () => { throw new Error('a Siren never becomes a zombie stand-in'); });
      expect(fallback).toBe(false);
      expect(actor).toBeInstanceOf(SirenActor);
      expect((actor as SirenActor).hasRig).toBe(true);
      const lv = z.level ?? 0, y = z.y ?? l.levels[lv].grid.floorAt(z.x, z.z); // spawnEnemy's height rule
      actor.brain.y = actor.root.position.y = y;
      sys.adopt(actor, z as ZombieSpawn, i);
      const b = actor.brain as SirenBrain;
      expect(b).toBeInstanceOf(SirenBrain);
      expect(b.dormant).toBe(true);
      expect(b.state).toBe('dormant');
      // her place: a retail floor (never the station storey), an eligible shop / stock-room slot of the 'ring' context, supported floor
      expect(lv).toBeGreaterThanOrEqual(1);
      expect(spawnContextOf(l, P, i)).toBe('ring');
      expect(eligibilityFailure(MALL_SIREN_ELIGIBILITY, l, z, 'ring')).toBeNull();
      const s = L.supportIn(z.x, z.z, y + 0.05, 0.45);
      expect(s?.level).toBe(lv);
      actors.push(actor);
    }
    expect(sys.veins.count).toBe(sirens.length); // each dormant Siren has her ground-corruption patch
    expect(sys.skippedHere).toBe(0);
    for (const a of actors) a.dispose();
  });

  (has ? it : it.skip)('the retune: about two Sirens per mall like the Office (5-mall sample of the census; band 1.4..3.0, see the header), never the station / annex / hordes, <= 4, 24 m apart', () => {
    const counts: number[] = [], storeys: number[] = [];
    for (const seed of SEEDS) {
      const l = get(seed);
      const sirens = l.zombies.map((z, i) => ({z, i})).filter(e => e.z.archetype === 'siren');
      counts.push(sirens.length);
      for (const {z, i} of sirens) {
        storeys.push(z.level ?? 0);
        expect(z.horde).toBeUndefined();
        expect(spawnContextOf(l, MALL_SPAWN_PROFILE, i)).toBe('ring');
      }
      expect(sirens.length).toBeLessThanOrEqual(MALL_SIREN_ELIGIBILITY.maxPerLevel!);
      for (let a = 0; a < sirens.length; a++) for (let b = a + 1; b < sirens.length; b++) {
        const p = sirens[a].z, q = sirens[b].z;
        expect(Math.hypot(p.x - q.x, (p.y ?? 0) - (q.y ?? 0), p.z - q.z)).toBeGreaterThanOrEqual(MALL_SIREN_SPACING.spacingM);
      }
    }
    const sum = counts.reduce((s, n) => s + n, 0);
    process.stdout.write(`\n[mall Sirens] ${SEEDS.length} malls: Sirens per mall ${counts.join(' ')} (mean ${(sum / counts.length).toFixed(2)}); storeys ${[1, 2, 3].map(k => storeys.filter(s => s === k).length).join(' / ')}\n`);
    // (before this round: 0.79 mean / 37.5 % none on the 48-mall census; the Office 1.97 / 12.5 %)
    expect(sum).toBeGreaterThanOrEqual(7);
    expect(sum).toBeLessThanOrEqual(15);
    expect(counts.filter(n => n === 0).length).toBeLessThanOrEqual(1);
  });
});

describe('the generated mall start: before / after (R2, deterministic scenario)', () => {
  (has ? it : it.skip)('a horde at the rail above the pit (1.25 s: past the 1 s notice dwell) and firing at the start (8 rifle shots, 2.5 s): fewer upper-floor responders, no mass stream from one event, station fights kept', () => {
    // one sample mall for both scenarios (the census's 50021: its floor-3 horde fits at the rail)
    const layout = get(SEEDS[1]);
    const rail = hordeAtTheRail(layout);
    expect(rail, 'a void-edge strip of a horde storey overlooking the pit').not.toBeNull();
    const lines: string[] = [];
    const tot = {before: {upper: 0, burst: 0, calls: 0, station: 0}, after: {upper: 0, burst: 0, calls: 0, station: 0}};
    const runs: [string, StationLayout, Parameters<typeof aggroSim>[1]][] = [
      [`horde on L${rail!.level} at the rail (${rail!.placed} members), player in the pit below`, rail!.layout, {noise: 30, shots: [], seconds: 1.25, atrium: false, start: rail!.spot}],
      ['firing at the start', layout, {noise: 30, shots: Array.from({length: 8}, (_, k) => 0.3 + k * 0.3), seconds: 2.5, atrium: false}],
    ];
    for (const [name, l, o] of runs) for (const atrium of [false, true]) {
      const r = aggroSim(l, {...o, atrium});
      const k = atrium ? 'after' : 'before';
      // the largest group set hunting by ONE gunshot / call (same frame, same cause)
      const ev = new Map<string, number>();
      for (const u of r.upper) if (u.cause === 'gunfire' || u.cause === 'call') ev.set(`${u.t}|${u.cause}`, (ev.get(`${u.t}|${u.cause}`) ?? 0) + 1);
      const burst = Math.max(0, ...ev.values());
      const station = r.responders.filter(u => u.level === 0).length;
      tot[k].upper += r.upper.length; tot[k].burst = Math.max(tot[k].burst, burst); tot[k].calls += r.callsHeard; tot[k].station += station;
      lines.push(`${name} ${k}: upper-floor responders ${r.upper.length}/${r.upperSpawns} ${JSON.stringify(r.upperByCause)}, largest single-event group ${burst}, horde calls heard ${r.callsHeard}; station responders ${station} ${JSON.stringify(r.stationByCause)}, kills ${r.kills}`);
    }
    console.info(`[mall atrium aggro] seed ${SEEDS[1]} (${layout.mall!.variant})\n  ${lines.join('\n  ')}`);
    expect(tot.before.burst).toBeGreaterThan(ATRIUM_PERCEPTION.hearCrossMax); // the stream reproduced before: one sighting sends the crowd
    expect(tot.after.upper).toBeLessThan(tot.before.upper * 0.75);
    expect(tot.after.burst).toBeLessThanOrEqual(ATRIUM_PERCEPTION.hearCrossMax); // no mass stream from one shot / call
    expect(tot.after.calls).toBeLessThanOrEqual(tot.before.calls);
    expect(tot.after.station).toBeGreaterThan(0); // the station fight itself still happens (same-storey perception unchanged)
  });
});
