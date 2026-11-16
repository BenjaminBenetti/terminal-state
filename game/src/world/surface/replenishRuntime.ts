// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane LIFE): the OUTDOOR REPLENISHER's Game adapter (the rules and the
// bookkeeping are world/surface/replenish.ts, pure). Installed once by world/surface/life.ts; INERT on every layout without
// `layout.surface` (the district): no actor, no hook work, no model key.
//  - sectionHooks.build (after the interior enemies and the pickups, before the warm-up): the replenisher for this visit of the district
//    (its own stream: the district seed + the memory's visit count), hidden KEEPER actors of every outdoor family (one per family / zombie
//    type, built by the game's own actor factory and wound install, in a hidden group registered as the warm-up pool
//    'surface-outdoor-enemies': their programs compile behind the loading screen and stay referenced while the district lives, so an
//    outdoor spawn later in play is a program-cache hit, never a visible compile), then the initial outdoor population (spawnEnemy, also
//    before the warm-up);
//  - frameHooks (play only — update() never runs paused / in a menu / on the map / loading / warming): the replenisher's tick;
//  - sectionHooks.teardown: everything forgotten (the Game's own teardown removes and disposes every actor of the world; the keepers are
//    disposed here);
//  - sectionModelKeys: the district loads the lazily loaded model of every outdoor family its pool can draw (the Blightbelly's).
// The spawn seam is Game.spawnEnemy(spawn, index, ownRand) — the replenisher's stream, never Game.rand — and the actor goes into
// Game.uncountedEnemies (the section's alive / clear / HUD counts never include it) and never into Game.enemyIndex (the kill memory, the
// corpse system and the hordes never see it). Retiring an actor = the corpse system's own path (world/corpses.ts pickUpActor /
// disposeBody): out of Game.zombies, physics.forgetRagdoll (its simulating / frozen record), damage.releaseZombie, the scene, dispose.

import * as THREE from 'three';
import type {Game} from '../../game';
import type {StationLayout, ZombieSpawn} from '../../gen/stationTypes';
import type {EnemyActor} from '../../ai/creatureArchetypes';
import {ENEMY_ARCHETYPES} from '../../ai/creatureArchetypes';
import {ENEMY_MODEL_FILES} from '../../ai/enemyModels';
import {spawnProfile, type EnemyFamilyId} from '../../ai/spawnTables';
import {FLOOR} from '../../gen/grid';
import {mulberry32} from '../../core/rng';
import {OutdoorReplenisher, REPLENISH, outdoorFamilyPool, outdoorRulesOf, viewerOf, type ReplenishHost, type Standable} from './replenish';

const runtimes = new WeakMap<object, SurfaceReplenishRuntime>();
/** The replenisher runtime installed into a game (QA / tests). */
export const surfaceReplenishOf = (game: object): SurfaceReplenishRuntime | undefined => runtimes.get(game);

/** The lazily loaded model key of an outdoor family (null: a boot model or none). */
function lazyModelOf(f: EnemyFamilyId): string | null {
  const m = (ENEMY_ARCHETYPES as Record<string, {model: string | null} | undefined>)[f]?.model ?? null;
  return m && ENEMY_MODEL_FILES[m] ? m : null;
}

/** The lazy enemy models a district's outdoor pool can draw (Game.sectionModelKeys). */
export function outdoorModelKeys(layout: StationLayout): string[] {
  const s = layout.surface;
  if (!s) return [];
  const keys = new Set<string>();
  for (const [f, w] of outdoorFamilyPool(s.host)) { const k = w > 0 ? lazyModelOf(f) : null; if (k) keys.add(k); }
  return [...keys].sort();
}

export class SurfaceReplenishRuntime {
  rep: OutdoorReplenisher<EnemyActor> | null = null;
  /** The hidden keeper actors' group (warm-up pool) while a district is built. */
  keepers: THREE.Group | null = null;
  private keeperActors: EnemyActor[] = [];
  private layout: StationLayout | null = null;
  private outdoor = new Set<number>();
  readonly counts = {builds: 0, teardowns: 0, keepers: 0};

  constructor(readonly game: Game) {}

  install(): this {
    const g = this.game;
    runtimes.set(g, this);
    g.sectionModelKeys.push(outdoorModelKeys);
    g.sectionHooks.push({build: layout => this.build(layout), teardown: () => this.teardown()});
    g.frameHooks.push(dt => this.rep?.tick(dt));
    g.warmRegistry.addPool('surface-outdoor-enemies', () => (this.keepers ? [this.keepers] : []));
    return this;
  }

  /** Can the game build family `f` now (its model loaded; a missing one -> the replenisher draws an ordinary zombie instead)? */
  familyReady(f: EnemyFamilyId): boolean {
    const g = this.game;
    const m = (ENEMY_ARCHETYPES as Record<string, {model: string | null} | undefined>)[f]?.model ?? null;
    if (!m) return f === 'zombie';
    if (ENEMY_MODEL_FILES[m]) return g.propModels.has(m);
    return !!(g.assets?.models as unknown as Record<string, unknown> | undefined)?.[m];
  }

  build(layout: StationLayout): void {
    this.teardown();
    const s = layout.surface;
    if (!s) return;
    const g = this.game;
    this.layout = layout;
    this.counts.builds++;
    const areas = s.outdoor.areas.length ? s.outdoor.areas : s.outdoorAreas;
    this.outdoor = new Set(areas);
    const pool = outdoorFamilyPool(s.host);
    const mem = g.run.memory(g.run.current); // (the build's arrival step made the district the run's current section)
    this.rep = new OutdoorReplenisher<EnemyActor>(this.host(), outdoorRulesOf(s), {seed: s.seed, visit: mem.visits, pool, coatedChance: spawnProfile(s.host).zombieTypes.coatedChance});
    this.rep.familyReady = f => this.familyReady(f);
    this.buildKeepers(pool.filter(([, w]) => w > 0).map(([f]) => f), s.seed);
    this.rep.seed();
  }

  teardown(): void {
    if (this.rep || this.layout) this.counts.teardowns++;
    this.rep?.reset();
    this.rep = null;
    this.layout = null;
    this.outdoor.clear();
    const g = this.game;
    for (const k of this.keeperActors) { g.damage.releaseZombie(k as never); k.root.removeFromParent(); k.dispose(); }
    this.keeperActors = [];
    this.keepers?.removeFromParent();
    this.keepers = null;
  }

  /** One hidden actor per family (and zombie type) the outdoor pool can draw — the warm-up pool (see the header). */
  private buildKeepers(families: readonly EnemyFamilyId[], seed: number): void {
    const g = this.game, group = new THREE.Group();
    group.name = 'surface-outdoor-keepers';
    group.visible = false;
    const rand = mulberry32((seed ^ 0x6b6565) >>> 0); // (its own stream: nothing of a station stream)
    const s0 = this.layout!.surface!.portal.pose;
    const specs: ZombieSpawn[] = [];
    for (const f of families) {
      if (!this.familyReady(f)) continue;
      if (f === 'zombie') for (const type of ['shambler', 'coated'] as const) specs.push({x: s0.x, z: s0.z, yaw: 0, type, area: -1, level: 0, y: s0.y});
      else specs.push({x: s0.x, z: s0.z, yaw: 0, type: 'shambler', area: -1, level: 0, y: s0.y, archetype: f});
    }
    specs.forEach((sp, k) => {
      try {
        const {actor} = g.buildEnemyActor(sp, REPLENISH.indexBase - 1 - k, seed, rand);
        g.damage.installZombie(actor as never); // (the live actors' own wound-patched materials: the same programs)
        actor.root.position.set(sp.x, sp.y ?? 0, sp.z);
        g.atmosphere.markShadows(actor.root, false); // (as Game.spawnEnemy marks every enemy)
        group.add(actor.root);
        this.keeperActors.push(actor);
      } catch (err) { console.warn('surface replenisher: a keeper actor could not be built (its first spawn compiles in play)', err); }
    });
    this.counts.keepers = this.keeperActors.length;
    g.scene.add(group);
    this.keepers = group;
  }

  private host(): ReplenishHost<EnemyActor> {
    const g = this.game;
    return {
      spawn: (spawn, index, rand) => {
        try {
          const z = g.spawnEnemy(spawn, index, rand); // (the replenisher's stream; never enemyIndex: no kill memory)
          g.uncountedEnemies.add(z);
          return z;
        } catch (err) { console.warn('surface replenisher: a spawn failed', err); return null; }
      },
      remove: z => {
        const i = g.zombies.indexOf(z);
        if (i >= 0) g.zombies.splice(i, 1);
        g.uncountedEnemies.delete(z);
        g.physics.forgetRagdoll(z as never);
        g.damage.releaseZombie(z as never);
        z.root.removeFromParent();
        z.dispose();
      },
      removable: z => !g.fireSys.alight.has(z as never), // (a body still burning stays until the fire is out)
      viewer: () => {
        const p = g.player, c = g.camera;
        return viewerOf({x: p.x, y: p.eye, z: p.z}, p.yaw, p.pitch, c.fov, c.aspect);
      },
      lineOfSight: (a, b) => g.levels.lineOfSight(a, b),
      standable: (x, z, r) => this.standable(x, z, r),
      truck: () => {
        const car = g.skywaysCar, b = car?.worldLive ? car.body : null;
        return b ? {x: b.x, z: b.z, r: Math.hypot(car.spec.length, car.spec.width) / 2} : null;
      },
      active: () => g.state === 'playing' && !g.warming && !!this.layout && g.layout === this.layout,
    };
  }

  /** A standable OUTDOOR street point (level 0, an outdoor area's FLOOR cell, a clear body circle: no wall / blocking prop). */
  standable(x: number, z: number, r: number): Standable | null {
    const g = this.game, grid = g.levels?.main;
    if (!grid) return null;
    const [cx, cy] = grid.cellOf(x, z);
    if (!grid.inBounds(cx, cy)) return null;
    const i = grid.idx(cx, cy);
    if (grid.cells[i] !== FLOOR || !this.outdoor.has(grid.area[i])) return null;
    const floor = grid.floorAt(x, z);
    if (!g.levels.circleClear(x, z, r, floor)) return null;
    return {floor, area: grid.area[i]};
  }

  qa(): Record<string, unknown> {
    return {district: !!this.layout, keepers: this.keeperActors.length, counts: {...this.counts}, ...(this.rep?.qa() ?? {})};
  }
}

export function installSurfaceReplenish(game: Game): SurfaceReplenishRuntime {
  return new SurfaceReplenishRuntime(game).install();
}
