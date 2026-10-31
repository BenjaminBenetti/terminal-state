// Playtest revision evidence (opt-in: ANNEX_TRACE=1): the PRODUCTION-PATH trace of annex loot + enemies on fresh New Game layouts —
// createRun -> LEVELS.generate -> dropUnloadedP7 (the level's selectable model keys) -> ContainerManager.build + fresh run memory ->
// pickupPlan / enemiesToSpawn -> access (PathFinder from the annex door to each stocked holder's stand point, ContainerManager.target
// from there; enemy spawn height vs the annex floor, route from the door, nearest core floor cell). Writes
// qa-artifacts/annex-trace/trace-<level>.json (reference/tasks/track2-playtest-revision-20261031/DIAGNOSIS-BASELINE.md used it).
//   ANNEX_TRACE=1 [TRACE=subway,office,mall] [SEEDS=...] ./node_modules/.bin/vitest run --config game/vitest.config.ts --maxWorkers=1 --no-file-parallelism game/tests/annex-trace.evidence.test.ts
import * as THREE from 'three';
import {beforeAll, describe, it} from 'vitest';
import {mkdirSync, writeFileSync} from 'node:fs';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, openableModels} from './helpers/openablesFixture';
import {LEVELS} from '../src/levels/registry';
import {createRun} from '../src/run/runState';
import {rollLevelGear} from '../src/levels/gearAdapter';
import {enemiesToSpawn, pickupPlan} from '../src/run/memory';
import {applyHolders} from '../src/run/worldMemory';
import {P7_FILES, dropUnloadedP7, p7ModelKeysFor} from '../src/gen/props07';
import {OFFICE_MODEL_FILES} from '../src/assets/officeAssets';
import {COMPANY_MODEL_FILES, COMPANY_PART_MODEL_FILES} from '../src/assets/companyAssets';
import {MALL_MODEL_FILES} from '../src/assets/mallAssets';
import {ENEMY_MODEL_FILES} from '../src/ai/enemyModels';
import {selectLevelKeys} from '../src/assets/levelAssets';
import {levelsOf} from '../src/gen/levels';
import {PathFinder} from '../src/gen/grid';
import {lootProfile} from '../src/items/lootTables';
import {isLootHolderKind} from '../src/items/loot';
import {econCat} from '../src/items/lootTables';
import {WorldMaterials} from '../src/world/materials';
import {ContainerManager} from '../src/world/containers';
import {STAND_EYE} from '../src/player/player';
import type {LevelId} from '../src/levels/types';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};
let models: Record<string, GLTF> = {};
beforeAll(async () => { if (process.env.ANNEX_TRACE) models = await openableModels(); }, 120000);
const CATALOGUE = {...P7_FILES, ...OFFICE_MODEL_FILES, ...COMPANY_MODEL_FILES, ...COMPANY_PART_MODEL_FILES, ...ENEMY_MODEL_FILES, ...MALL_MODEL_FILES} as never;

function trace(level: LevelId, seed: number) {
  const key = {level, section: 'main'};
  const run = createRun({seeds: {subway: seed, office: seed, mall: seed} as never, start: key as never, levels: LEVELS, rollGear: rollLevelGear});
  const layout = LEVELS[level].generate('main', {levelSeed: seed, startWeapon: 'pistol', gear: run.gearFor(key as never)} as never);
  const ext = layout.extensions;
  const out: Record<string, unknown> = {level, seed, annexes: ext?.annexes.length ?? 0, tunnels: ext?.tunnels.length ?? 0};
  if (!ext?.annexes.length) return out;
  const annexOf = new Map<number, number>(); ext.annexes.forEach(a => a.areas.forEach(id => annexOf.set(id, a.id)));
  const inAnnex = (area: number) => annexOf.has(area);
  // generated / populated
  const genHolders = layout.props.filter(p => inAnnex(p.area) && isLootHolderKind(p.kind));
  const genProps = layout.props.filter(p => inAnnex(p.area)).length;
  const genPickups = layout.pickups.map((p, i) => ({p, i})).filter(q => inAnnex(q.p.area));
  const genZombies = layout.zombies.map((z, i) => ({z, i})).filter(q => inAnnex(q.z.area));
  // buildSection: dropUnloadedP7 with this level's selectable keys (assume every selectable file loads)
  const sel = selectLevelKeys(level, p7ModelKeysFor(layout), CATALOGUE);
  const before = layout.props.length;
  const dropped = dropUnloadedP7(layout as never, new Set(sel.keys));
  const afterHolders = layout.props.filter(p => inAnnex(p.area) && isLootHolderKind(p.kind)).length;
  // ContainerManager.build + fresh memory
  const inv = {} as never;
  const cm = new ContainerManager(models, new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17}), () => inv);
  cm.build(layout, {}, lootProfile(level));
  const mem = run.memory(key as never);
  applyHolders(cm, mem.holders);
  const holders = cm.all.filter(h => inAnnex(h.prop.area));
  const stocked = holders.filter(h => h.state.lots.length > 0);
  const cls = (h: (typeof holders)[number]) => h.prop.purpose === 'annex-stash' ? 'stash' : h.prop.purpose === 'annex-picked' ? 'picked' : 'deep';
  const byClass: Record<string, [number, number, number]> = {};
  for (const h of holders) { const c = cls(h), e = (byClass[c] ??= [0, 0, 0]); e[0]++; if (h.state.lots.length) { e[1]++; e[2] += h.state.lots.length; } }
  const kinds: Record<string, number> = {}; for (const h of holders) kinds[h.kind] = (kinds[h.kind] ?? 0) + 1;
  const econ = (hs: typeof holders, pk: typeof layout.pickups) => { const e: Record<string, number> = {stocked: 0, holders: hs.length}; for (const h of hs) { if (h.state.lots.length) e.stocked++; for (const l of h.state.lots) { const c = econCat(l.itemId) ?? 'other'; e[c] = (e[c] ?? 0) + (c === 'ammo' ? l.count : 1); } } for (const q of pk) { const c = 'floor-' + (econCat(q.itemId) ?? 'other'); e[c] = (e[c] ?? 0) + (econCat(q.itemId) === 'ammo' ? q.count : 1); } return e; };
  (out as Record<string, unknown>).econCore = econ(cm.all.filter(h => !inAnnex(h.prop.area) && !(layout.areas[h.prop.area] as {ext?: string})?.ext), layout.pickups.filter(q => !inAnnex(q.area) && !(layout.areas[q.area] as {ext?: string})?.ext));
  (out as Record<string, unknown>).econAnnex = econ(holders, layout.pickups.filter(q => inAnnex(q.area)));
  (out as Record<string, unknown>).byClass = byClass; (out as Record<string, unknown>).holderKinds = kinds;
  const lots = stocked.reduce((n, h) => n + h.state.lots.length, 0);
  const plan = pickupPlan(layout.pickups.length, mem), spawnIdx = new Set(enemiesToSpawn(layout.zombies.length, mem));
  // access: route from the annex door to each stocked holder's stand point; targeting from there; enemies' floor heights + routes
  const L = levelsOf(layout), pf = new PathFinder(L);
  const res: Record<string, unknown>[] = [];
  let reachH = 0, targetH = 0;
  for (const a of ext.annexes) {
    const aStocked = stocked.filter(h => annexOf.get(h.prop.area) === a.id);
    let r = 0, t = 0;
    for (const h of aStocked) {
      const {aim, stand} = cm.aimPoint(h);
      const route = pf.find(a.exit.x, a.exit.z, stand.x, stand.z, 0.3, 400000, {ay: a.floorY, by: a.floorY});
      if (route) r++;
      const eye = new THREE.Vector3(stand.x, a.floorY + STAND_EYE, stand.z), dir = new THREE.Vector3(aim.x, aim.y, aim.z).sub(eye).normalize();
      if (cm.target(eye, dir, L)?.container === h) t++;
    }
    reachH += r; targetH += t;
    const z = genZombies.filter(q => annexOf.get(q.z.area) === a.id);
    const zInfo = z.map(q => {
      const lv = q.z.level ?? 0, fy = L.grid(lv).floorAt(q.z.x, q.z.z), y = q.z.y ?? fy;
      const route = pf.find(a.exit.x, a.exit.z, q.z.x, q.z.z, 0.3, 400000, {ay: a.floorY, by: y});
      // earshot: nearest core (non-extension) walkable cell centre in 3D (a player standing there; its floor height)
      let near = Infinity;
      for (const Lv of L.list) { const g = Lv.grid; for (let cy = 0; cy < g.h; cy++) for (let cx = 0; cx < g.w; cx++) { const k = g.idx(cx, cy), ar = g.area[k]; if (ar < 0 || annexOf.has(ar) || (layout.areas[ar] as {ext?: string}).ext || !g.walkable(cx, cy)) continue; const d = Math.hypot((cx + 0.5) * 0.5 - q.z.x, (cy + 0.5) * 0.5 - q.z.z, g.floorAt((cx + 0.5) * 0.5, (cy + 0.5) * 0.5) - y); if (d < near) near = d; } }
      return {i: q.i, level: lv, y: +y.toFixed(2), floor: +fy.toFixed(2), annexFloor: a.floorY, spawned: spawnIdx.has(q.i), reach: !!route, archetype: q.z.archetype ?? 'zombie', coreDist: +near.toFixed(1)};
    });
    res.push({annex: a.id, tunnel: a.tunnel, areaM2: a.areaM2, stocked: aStocked.length, reachable: r, targetable: t, zombies: zInfo});
  }
  Object.assign(out, {
    props: genProps, holdersGenerated: genHolders.length, p7Dropped: dropped, propsBefore: before, holdersAfterDrop: afterHolders, foreign: sel.foreign,
    holdersRegistered: holders.length, stockedHolders: stocked.length, lots, lotItems: [...new Set(stocked.flatMap(h => h.state.lots.map(l => l.itemId)))].slice(0, 12),
    pickupsGenerated: genPickups.length, pickupsPlanned: genPickups.filter(q => plan.fromLayout.includes(q.i)).length,
    zombiesGenerated: genZombies.length, zombiesSpawned: genZombies.filter(q => spawnIdx.has(q.i)).length,
    stockedReachable: reachH, stockedTargetable: targetH, perAnnex: res,
  });
  return out;
}

describe.runIf(!!process.env.ANNEX_TRACE)('annex production-path trace (evidence)', () => {
  it('traces the fresh New Game annexes of the sample', () => {
    const which = (process.env.TRACE ?? 'subway').split(',') as LevelId[];
    const seeds = (process.env.SEEDS ?? '1043,1002,777001,777002').split(',').map(Number);
    mkdirSync('qa-artifacts/annex-trace', {recursive: true});
    for (const level of which) writeFileSync(`qa-artifacts/annex-trace/trace-${level}.json`, JSON.stringify(seeds.map(s => trace(level, s)), null, 1));
  }, 1800000);
});
