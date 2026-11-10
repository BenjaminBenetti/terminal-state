// Test-automation hooks, installed ONLY with ?qa=1. They read state and aim the camera for
// scripted playtests (pointer lock cannot be granted to automated browsers). Inputs still go
// through real keyboard/mouse events; nothing here changes health, ammo or enemy behaviour.

import {fuelQaApi} from './fuel/fuelQa'; // task train-fuel-system
import {isP7Kind, p7ModelKeysFor} from './gen/props07';
import * as THREE from 'three';
import type {Game} from './game';
import {itemDef} from './items/items';
import {CALIBER_IDS, ammoItemFor} from './items/calibers'; // lane AMMO
import {killImpulseStrength} from './physics/world';
import {itemIconStats, itemIconUrl} from './ui/itemIcons';
import {traversalSummary} from './gen/traversal';
import {doorClearVolumes, doorwaySummary} from './gen/doorways';
import {compositionOf, compositionSummary} from './gen/compose';
import {CELL} from './gen/grid';
import {damageQaApi} from './damage/qa';
import {creatureQaApi} from './ai/creatureQa';
import {lightLureQaApi} from './ai/lightLureQa'; // Iteration 12 (AI)
import {hordeQaApi} from './ai/hordeQa'; // Task track3-eaton-centre-20261031 (lane HORDE)
import {gearQaApi} from './gear/qa'; // Iteration 16 (lane GEAR): gear / backpack spot-check hooks
import {marketTradeQaApi} from './market/trade/tradeSystem'; // task studio-survivor-market-20261108-005807-01 (lane TRADE)
import {marketCombatQaApi} from './market/combat/marketCombat'; // task studio-market-rework-20261108-074144-01 (lane COMBAT)
import {weaponVarietyQaApi} from './world/weaponVarietyDelivery'; // task studio-weapon-runtime-fix-20261110-022206-01
import {marketAudioQaApi} from './market/audio/marketSounds'; // task studio-market-bar-20261108-225231-01 (lane AUDIO)
import {marketWaresQaApi} from './market/wares/wares'; // task studio-market-rework-20261108-074144-01 (lane WARES)
import {vomitQaApi} from './player/vomit'; // task studio-market-bar-20261108-225231-01 (lane SHELVES): the throw-up action
import {beerQaApi} from './market/beer/beerEffects'; // task studio-market-bar-20261108-225231-01 (lane BEER)
import {towerQaApi} from './world/towerQa'; // Iteration 16 (lane TOWER): elevator / stair door / exterior spot-check hooks
import {officeArchQaApi} from './world/officeAtmosphere'; // Task office-overhaul-20261030 (lane ARCH): office finishes / green exterior fog tuning
import {mallArchQaApi} from './world/mallAtmosphere'; // Task track3-eaton-centre-20261031 (lane ARCH): mall finishes / atrium / fog / QA poses
import {gasQaApi} from './world/gas/qa'; // Task gasmask-breach-20261030 (lane GAS): office windows / breach gas spot-check hooks
import {reactorAirQaApi} from './world/reactor/airQa'; // task reactor-build-20261101 (lane AIR): Reactor depth gas / generators spot-check hooks
import {reactorCpuQaApi} from './world/reactor/cpuActorCulling'; // task studio-reactor-submit-roof-fog-20261102 (lane CPU): culler decision / A-B
import {reactorArchQaApi} from './world/reactor/archInstall'; // task reactor-build-20261101 (lane ARCH): Reactor kit summary / draw cost, fog tune, visuals driver
import {reactorSurfaceOf, type ReactorSurface} from './world/reactor/surface'; // task studio-reactor-surface-ending-20261102 (lane SURFACE)
import {reactorEndingQaApi} from './world/reactor/endingQa'; // task studio-reactor-surface-ending-20261102 (lane ENDING)
import {reactorCreditsOf, type ReactorCredits} from './world/reactor/credits'; // task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS)
import {gaslightQaApi} from './world/gaslightQa'; // task reactor-expansion-20261101 (lane GASLIGHT): gas visibility / pit lamps / open sky state, shaft tune
import {blightbellyQaApi} from './ai/blightbellyQa'; // Task track1-siren-blightbelly-20261031 (lane BLIGHT): Blightbelly burst / blast / gas puff spot-check hooks
import {sirenQaApi} from './ai/sirenQa'; // Task track1-siren-blightbelly-20261031 (lane SIREN): Siren state / wake / veins spot-check hooks
import {strainerQaApi} from './ai/strainerQa'; // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): Strainer spot-check hooks
import {reactorRestartQaApi} from './world/reactor/restartQa'; // task reactor-build-20261101 (lane RESTART): restart state / controls / win spot-check hooks
import {trainQaApi} from './world/playerTrain'; // Task player-train-shell-20261101-202805 (lane TRAIN): train(), trainDoor(i, open), trainFaceDoor(i?), trainLights()
import {rideQaApi} from './world/trainRide'; // task campaign-foundation-20261102 (lane RIDE): ride(), rideDepart(), rideArrive(), rideDemo(seconds?), rideReset()
import {lockboxQaApi} from './ui/lockboxView'; // task train-lockbox-windows-20261101-232156 (lane BOX): lockbox(), lockboxOpen(), lockboxType('1337'), lockboxQuick / Move / Stow / Close
import {trunkQaApi} from './world/skywaysCarTrunk'; // task studio-beta-skyways-vehicle-20261107 (lane TRUNK): trunk(), trunkOpen(), trunkClose(), trunkQuick / Move / Stow
import {floorPlanPose, roofLadderPose, roofRewardPose, transitPose} from './gen/office'; // Task office-overhaul-20261030 (lane STRUCT) / office-interactions-layout-20261030: roof ladder / transit / roof cache / floor-plan poses
import {mallShopPose} from './gen/mall/shopsWeapons'; // Task track3-eaton-centre-20261031 (primary): goShop
import {MALL_POSE_NAMES, mallQaPose, type MallPoseName} from './gen/mall/qa'; // Task track3-eaton-centre-20261031 (lane GEN): mall QA poses
import {walkerQaApi} from './qaWalk'; // Iteration 17 (seamless): real-input walker, per-frame traversal trace, lifecycle counts
import {lightQaApi} from './player/lightQa'; // Iteration 12 (LIGHT)
import {qaStandFree} from './world/shelfStock'; // Lane S: stand-point check of goStockedShelf
import {renderStats} from './render/backend'; // Iteration 13 (CORE)
import {decayDetailTexture, probeDecayGPU, type DecayProbe} from './world/decay'; // Iteration 13 (MAT-A): decay inputs as the GPU sees them
import {anisotropyReport, observeBackendAnisotropy} from './render/anisotropy'; // Task mall-playtest-revision-20261031 (lane FIX, U08)
import {anisotropyCapability} from './render/softwareGl'; // (lane FIX, U08)
import {seedToCode} from './core/rng'; // Iteration 16 (lane RUN)
import {memorySummary} from './run/memory'; // Iteration 16 (lane RUN)
import {parseSectionId} from './run/bagStore'; // Iteration 16 (lane RUN)
import type {Arrival, LevelId} from './levels/types'; // Iteration 16 (lane RUN)
import {propPhysics} from './damage/materials'; // Task office-props-physics-scale-20261030 (lane PHYS): goWalkInto
import type {PropPlacement} from './gen/props'; // lane PHYS
import {SPAN_ABOUT, SPAN_COUNT} from './debug/updateProfile'; // Task frame-budget-deferral-20261030 (lane MEASURE)

export function installQaHooks(game: Game): void {
  // task office-props-physics-scale-20261030 (lane PHYS): the goWalkInto target (walkIntoCheck)
  let walkInto: {prop: PropPlacement; index: number; x: number; z: number; contacts: number; shots: number; lots: number} | null = null;
  let columnTarget: PropPlacement | null = null; // Task mall-playtest-revision-20261031 (lane FIX, U04): goColumn / columnCheck
  const api = {
    ready: () => game.state !== 'loading' && !!game.layout,
    state: () => game.state,
    snapshot: () => {
      const p = game.player;
      const st = game.inv.selectedStack();
      return {
        state: game.state, seed: game.seed, name: game.layout?.name, frames: game.frames,
        player: {x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp, stamina: p.stamina, alive: p.alive, speed: p.speed, sprinting: p.sprinting, crouched: p.crouched, standBlocked: p.standBlocked, grounded: p.grounded, y: p.y, vy: p.vy, eye: p.eye},
        // Iteration 08 (Lane B): storey of the player / zombies (support band at the feet).
        level: levelQa(),
        selected: game.inv.selected,
        // task knife-windup-20261030 (lane SLOT): the melee slot (~) and whether its weapon is the one in the hands
        meleeSlot: game.inv.melee && {itemId: game.inv.melee.itemId, uid: game.inv.melee.uid}, meleeSelected: game.inv.meleeSelected,
        held: st ? {itemId: st.itemId, mag: st.mag ?? null, count: st.count} : null,
        weapon: {id: game.weapon.def?.id ?? null, phase: game.weapon.phase},
        // lane KNIFE: melee swing state + the last contacts (kind enemy / corpse / world / miss, part, damage, killed)
        // lane FEEL: the cycle stage (windup / ready / swing / recover / null = carry), seconds into it, and whether it is a held windup
        melee: {swinging: game.weapon.swinging, stage: game.weapon.meleeStage, stageT: +game.weapon.stageT.toFixed(3), winding: game.weapon.winding,
          swingTime: game.weapon.swingTime, swings: game.weapon.swingId, last: game.meleeLog.slice(-4)},
        hotbar: game.inv.hotbar.map(s => s && {itemId: s.itemId, count: s.count, mag: s.mag ?? null}),
        pack: game.inv.pack.map(s => s && {itemId: s.itemId, count: s.count}),
        // lane AMMO: per caliber (rifle / shells keys kept for the older e2e scripts: the 5.56×45mm / 12-gauge pools)
        ammo: {rifle: game.inv.count('ammo_556'), shells: game.inv.count('ammo_12ga'), pistol: game.inv.count('ammo_9mm'),
          byCaliber: Object.fromEntries(CALIBER_IDS.map(c => [c, game.inv.count(ammoItemFor(c))]))},
        invariants: game.inv.invariants(),
        zombies: game.zombies.map(z => ({x: z.brain.x, z: z.brain.z, hp: z.brain.hp, state: z.brain.state, type: z.brain.type, alive: z.brain.alive, rigged: z.hasRig, look: z.look, archetype: z.archetype ?? 'zombie'})),
        pickups: game.pickups.list.map(pk => ({itemId: pk.stack.itemId, count: pk.stack.count, x: pk.x, y: pk.y, z: pk.z, name: itemDef(pk.stack.itemId).name})),
        // Searchable cabinets/crates: {count, models, list: [{index, kind, x, z, open, searched, remaining, items, aim, stand, …}]}
        containers: game.containers?.qaState() ?? null,
        // Iteration 03: hunger/thirst (HUD FOOD/WATER) and visible loot on every holder kind.
        survival: {hunger: game.survival.hunger, thirst: game.survival.thirst, time: game.survival.time},
        loot: game.containers?.lootQa() ?? null,
        // Iteration 03 physics: {ragdollsActive, ragdollsFrozen, ragdollsFailed, casingsLive, bodies, staticBodies, stepMs, stepMsMax}
        physics: {...game.physics.stats(), ragdolled: game.zombies.filter(z => z.ragdolled).length, ragdolls: game.physics.debugRagdolls(), casings: game.physics.casings.list().slice(-8)},
        stats: game.stats,
        // Iteration 13 (CORE): WebGPURenderer info — `calls` keeps meaning draw calls this frame (r186 `drawCalls`)
        render: renderStats(game.renderer.info),
        softwareGl: game.softwareGl, // iteration 08: software rasterizer detection (anisotropy cap)
        // Iteration 13 (CORE): the backend that actually initialized ({backend: 'webgpu' | 'webgl2-fallback', adapter, reason, label, …})
        gpu: gpuQa(),
        memory: {...game.renderer.info.memory},
        world: game.world?.stats, genMs: game.genMs, journeyBuild: game.journeyBuildStats, // (task studio-perf-ao-train-continuity-20261110-022206-01: the journey's paced build)
        // Lighting debug: current area profile, hemi (ambient) intensity, pool and fixture states.
        lighting: game.lightPool ? {...game.lightPool.debug(), flashlightOn: game.flashlightOn, areaProfiles: game.layout.areas.map(a => a.lighting)} : null,
        // Iteration 06 (Lane F): volumetric atmosphere (quality, active, march resolution/steps, shadow map, ms).
        atmosphere: game.atmosphere.debug(),
        layout: game.layout && {areas: game.layout.areas.map(a => ({kind: a.kind, type: a.type, x: a.x, y: a.y, w: a.w, h: a.h})), doors: game.layout.doors.length, props: game.layout.props.length, lights: game.layout.lights.length,
          // Iteration 04 (Lane B): macro archetype + storefront bays (name, use, hall wall, shutter, unit area) for the layout-variety check.
          archetype: game.layout.archetype, tracks: game.layout.trenches.reduce((n, t) => n + t.tracks.length, 0),
          storefronts: game.layout.storefronts.map(s => ({name: s.name, use: s.use, hall: game.layout.areas[s.hall].type, side: s.side, shutter: s.shutter, unit: s.unit})),
          // Iteration 05 (Lane R): purpose per area (back-of-house rooms + store units) with its label and fixtures.
          purposes: game.layout.areas.filter(a => a.purpose).map(a => ({area: a.id, purpose: a.purpose, label: a.label, type: a.type, props: [...new Set(game.layout.props.filter(p => p.area === a.id).map(p => p.kind))]}))},
        // Iteration 07 (Lane P2): generated props — kinds placed in this station, lazily loaded models (only this station's), library stats.
        props07: game.layout && {kinds: [...new Set(game.layout.props.filter(p => isP7Kind(p.kind)).map(p => p.kind))].sort(), placements: game.layout.props.filter(p => isP7Kind(p.kind)).length,
          needed: p7ModelKeysFor(game.layout), loaded: game.propModels.loadedKeys().sort(), failures: game.propModels.failures, library: {...game.propModels.stats}},
        // Iteration 04 (Lane D): consume view (item to face / gun holster), inventory drag-drop, 3D icon cache, crouch input.
        consume: game.consumeView?.qaState() ?? null,
        invUi: {dragging: game.invUI.dragging, lastDrop: game.invUI.lastDrop, selected: game.invUI.selected, uids: {hotbar: game.inv.hotbar.map(s => s?.uid ?? null), pack: game.inv.pack.map(s => s?.uid ?? null)}, packMags: game.inv.pack.map(s => s?.mag ?? null)},
        icons: itemIconStats(),
        crouchInput: {down: ['KeyC'].filter(k => game.input.down(k))},
        // Iteration 04 (Lane E): see-through rifle optic — ADS blend, exit-pupil clarity, eye in the optic frame (m), reticle dir (view space), HUD crosshair hidden.
        optic: {aimBlend: game.viewmodel.aimBlend, opticAim: game.viewmodel.opticAim, clarity: game.viewmodel.heldOptic?.clarity ?? null, eye: game.viewmodel.heldOptic?.eye.toArray() ?? null, reticleDir: game.viewmodel.heldOptic ? game.viewmodel.heldOptic.lens.uniforms.uDir.value.toArray() : null, crosshairHidden: document.getElementById('crosshair')?.style.visibility === 'hidden'},
        lastError: game.lastError,
      };
    },
    /** Point the view at a world position (stands in for mouse aiming). */
    lookAt: (x: number, y: number, z: number) => {
      // Iteration 08 (primary): eye from the CURRENT feet height (player.eye only refreshes in update(), so right after a
      // QA reposition to another storey it still held the old height and the aim pitch was wrong).
      game.player.eye = game.player.stanceEye + game.player.y - game.player.landDip;
      const eye = new THREE.Vector3(game.player.x, game.player.eye, game.player.z);
      const dx = x - eye.x, dy = y - eye.y, dz = z - eye.z;
      game.player.yaw = Math.atan2(-dx, -dz);
      game.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    /** QA-only: move the player to a walkable point (used for room screenshots, not the playtest flow). Iteration 08: `level` = on that storey. */
    teleport: (x: number, z: number, yaw?: number, level = 0) => {
      const p = game.snap(x, z, level);
      if (!p) return false;
      game.player.x = p[0]; game.player.z = p[1];
      // Lane T: land on the local floor height (stairs / underpass), standing; Lane B: of that level.
      game.player.y = (game.levels && level > 0 ? game.levels.grid(level) : game.layout.grid).floorAt(p[0], p[1]); game.player.vy = 0; game.player.grounded = true; game.player.climb = null;
      if (yaw !== undefined) game.player.yaw = yaw;
      return true;
    },
    /** Iteration 08: `y` = target feet height (its storey); waypoints then carry [x, z, link, y]. */
    pathTo: (x: number, z: number, y?: number) => game.pathfinder.find(game.player.x, game.player.z, x, z, 0.3, 60000, {ay: game.player.y, by: y ?? game.player.y}),
    // --- Iteration 08 (Lane B): stacked levels --------------------------------------------------
    /** Levels summary (per level open cells / floor / ceiling range, level links, railings, unrailed drops) + who is where. */
    levels: () => ({...game.levels.summary(), unrailedDrops: game.levels.unrailedDrops().length, ...levelQa()}),
    /**
     * QA-only (setup, not traversal proof): stand at the bottom ('bottom') or top ('top') stand point of
     * level link `i` (default: the nearest), facing along the run toward its other end.
     */
    goLevelStairs: (i?: number, end: 'bottom' | 'top' = 'bottom') => {
      const links = game.layout.levelLinks ?? [];
      const p = game.player;
      const k = i !== undefined ? links[i] : [...links].sort((a, b) => Math.hypot(a[end].x - p.x, a[end].z - p.z) - Math.hypot(b[end].x - p.x, b[end].z - p.z))[0];
      if (!k) return null;
      const s = k[end], o = end === 'bottom' ? k.top : k.bottom;
      p.x = s.x; p.z = s.z; p.y = game.levels.supportAt(s.x, s.z, s.y + 0.05)?.floor ?? s.y; p.vy = 0; p.grounded = true; p.climb = null;
      p.yaw = Math.atan2(-(o.x - s.x), -(o.z - s.z)); p.pitch = end === 'bottom' ? 0.15 : -0.25;
      return {id: k.id, kind: k.kind, lower: k.lower, upper: k.upper, end, at: {x: p.x, y: p.y, z: p.z}, level: game.levels.levelAt(p.x, p.z, p.y + 0.05), toward: o};
    },
    // --- Iteration 05 (Lane T): vertical traversal ------------------------------------------
    /** Connectors (stair flights, rescue ladders, underpasses) + the player's height/climb state. */
    traversal: () => ({
      ...traversalSummary(game.layout),
      player: {x: game.player.x, y: game.player.y, z: game.player.z, grounded: game.player.grounded, climbing: game.player.climbing, floor: game.levels.floorAt(game.player.x, game.player.z, game.player.y + 0.05)},
      ladderPrompt: game.ladderAim ? {ladder: game.ladderAim.ladder.id, up: game.ladderAim.up} : null,
      zombies: game.zombies.map(z => ({x: z.brain.x, y: z.brain.y, z: z.brain.z, state: z.brain.state})),
    }),
    /**
     * QA-only: stand at the top landing of stair flight `i` (default: the flight nearest the player
     * that starts a leg down from a platform), facing down the stairs. Returns the flight summary.
     */
    goStairs: (i?: number) => {
      const st = game.layout.traversal.stairs;
      const pick = i !== undefined ? st[i] : [...st].filter(f => f.h0 === 0).sort((a, b) => Math.hypot(a.top.x - game.player.x, a.top.z - game.player.z) - Math.hypot(b.top.x - game.player.x, b.top.z - game.player.z))[0];
      if (!pick) return null;
      const p = game.player;
      p.x = pick.top.x; p.z = pick.top.z; p.y = game.levels.supportAt(p.x, p.z, pick.top.y + 0.05)?.floor ?? pick.top.y; p.vy = 0; p.grounded = true; p.climb = null; // Lane B: the flight's top storey
      const dx = pick.bottom.x - pick.top.x, dz = pick.bottom.z - pick.top.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = -0.25;
      return traversalSummary(game.layout).stairs[pick.id];
    },
    /**
     * QA-only: stand at ladder `i` (default: nearest), at its foot in the track bed ('bottom') or at
     * its head on the platform ('top'), looking at it so the "[E] Climb ladder" prompt shows.
     */
    goLadder: (i?: number, end: 'bottom' | 'top' = 'bottom') => {
      const ls = game.layout.traversal.ladders;
      const l = i !== undefined ? ls[i] : [...ls].sort((a, b) => Math.hypot(a.x - game.player.x, a.faceZ - game.player.z) - Math.hypot(b.x - game.player.x, b.faceZ - game.player.z))[0];
      if (!l) return null;
      const p = game.player;
      const s = end === 'bottom' ? l.bottom : l.top;
      // Step back from the stand point (bottom: 0.3 m further into the bed; top: 0.45 m onto the platform).
      p.x = s.x; p.z = s.z - l.dir * (end === 'bottom' ? 0.3 : -0.45); p.y = game.layout.grid.floorAt(p.x, p.z); p.vy = 0; p.grounded = true; p.climb = null;
      p.yaw = (end === 'bottom') === (l.dir > 0) ? Math.PI : 0; // face the platform face: +dir from the bed, -dir from the platform
      p.pitch = end === 'bottom' ? -0.3 : -1.0;
      return {id: l.id, x: l.x, faceZ: l.faceZ, end, top: l.top, bottom: l.bottom};
    },
    // --- Iteration 07 (Lane DW): doorway clearance --------------------------------------------
    /** Walk-through openings (clear lanes by kind, sealed storefronts) and decor intruding on them (expect []). */
    doorways: () => doorwaySummary(game.layout),
    // --- Iteration 08 (Lane P): composed dressing (gen/compose.ts) ------------------------------
    /** Per-area composition: zone, lanes / plazas, coverage vs cap, clusters with their members; landmark views; counts. */
    composition: () => compositionSummary(game.layout),
    /**
     * QA-only (screenshot setup, not traversal proof): stand just inside landmark view `i`'s arrival (default 0) on its level,
     * looking at the landmark vignette. Returns the view record and the stand point.
     */
    goLandmark: (i = 0) => {
      const v = compositionOf(game.layout)?.landmarks[i];
      if (!v) return null;
      const dx = v.to.x - v.from.x, dz = v.to.z - v.from.z, d = Math.hypot(dx, dz) || 1;
      if (!api.teleport(v.from.x + dx / d * 1.2, v.from.z + dz / d * 1.2, undefined, v.level)) return null;
      const p = game.player;
      api.lookAt(v.to.x, p.y + 1.2, v.to.z);
      return {...v, stand: {x: p.x, y: p.y, z: p.z}};
    },
    /**
     * QA-only: stand 2.2 m in front of clear lane `i` (index into doorways().lanes; default: the
     * nearest lane of `kind`, default 'staff'), facing through the opening at eye level.
     */
    goDoorway: (i?: number, kind = 'staff') => {
      const vols = doorClearVolumes(game.layout);
      const p = game.player;
      const c = (v: (typeof vols)[number]) => [(v.x0 + v.x1) / 2, (v.z0 + v.z1) / 2];
      const v = i !== undefined ? vols[i] : vols.filter(q => q.kind === kind).sort((a, b) => Math.hypot(c(a)[0] - p.x, c(a)[1] - p.z) - Math.hypot(c(b)[0] - p.x, c(b)[1] - p.z))[0];
      if (!v) return null;
      const [cx, cz] = c(v);
      const A = game.layout.areas[v.a];
      const toA = v.alongX ? Math.sign((A.y + A.h / 2) * CELL - cz) || 1 : Math.sign((A.x + A.w / 2) * CELL - cx) || 1;
      for (const s of [toA, -toA]) {
        const spot = game.snap(v.alongX ? cx : cx + s * 2.2, v.alongX ? cz + s * 2.2 : cz);
        if (!spot) continue;
        p.x = spot[0]; p.z = spot[1]; p.y = game.layout.grid.floorAt(p.x, p.z); p.vy = 0; p.grounded = true; p.climb = null;
        p.yaw = Math.atan2(-(cx - p.x), -(cz - p.z)); p.pitch = -0.04;
        return {door: v.door, lane: v.lane, kind: v.kind, a: A.label, b: game.layout.areas[v.b].label, stand: {x: p.x, z: p.z}, clear: {y0: v.y0, y1: v.y1}};
      }
      return null;
    },
    /** Aim at container `i` (default: nearest to the player): door centre / crate lid. Returns its QA entry. */
    aimContainer: (i?: number) => {
      const list = game.containers?.list ?? [];
      const c = i !== undefined ? list[i] : [...list].sort((a, b) => Math.hypot(a.prop.x - game.player.x, a.prop.z - game.player.z) - Math.hypot(b.prop.x - game.player.x, b.prop.z - game.player.z))[0];
      if (!c || !game.containers) return null;
      const {aim, stand} = game.containers.aimPoint(c);
      api.lookAt(aim.x, aim.y, aim.z);
      return {index: c.index, kind: c.kind, aim, stand, dist: Math.hypot(aim.x - game.player.x, aim.z - game.player.z)};
    },
    /** Aim at loot holder `serial` (any kind: cabinet, crate, shelf, stall, vending, table). */
    aimHolder: (serial: number) => {
      const h = game.containers?.all[serial];
      if (!h || !game.containers) return null;
      const {aim, stand} = game.containers.aimPoint(h);
      api.lookAt(aim.x, aim.y, aim.z);
      return {serial, kind: h.kind, aim, stand, open: h.state.open, lots: h.state.lots.length};
    },
    /**
     * Iteration 05 (Lane R): aim at a loot holder inside the first room/store of `purpose`
     * (e.g. 'pharmacy', 'security-office', 'staff-room'), optionally of holder `kind`; with
     * teleport, stand in front of it first (QA screenshots). Returns the area, its fixtures and
     * the holder's visible items.
     */
    aimPurpose: (purpose: string, o: {kind?: string; teleport?: boolean} = {}) => {
      const l = game.layout, cm = game.containers;
      if (!l || !cm) return null;
      const areas = l.areas.filter(a => a.purpose === purpose && (a.storefront === undefined || l.storefronts[a.storefront].shutter !== 'closed'));
      for (const a of areas) {
        const hs = cm.all.filter(h => h.prop.area === a.id && (!o.kind || h.kind === o.kind)).sort((p, q) => q.state.lots.length - p.state.lots.length);
        const h = hs[0];
        if (!h) continue;
        const {aim, stand} = cm.aimPoint(h);
        if (o.teleport) api.teleport(stand.x, stand.z);
        api.lookAt(aim.x, aim.y, aim.z);
        return {area: a.id, label: a.label, purpose, props: [...new Set(l.props.filter(p => p.area === a.id).map(p => p.kind))], serial: h.serial, kind: h.kind, aim, stand, open: h.state.open, items: h.state.lots.map(x => x.itemId)};
      }
      return null;
    },
    /**
     * Aim at the nearest loot item (optionally of holder `kind` / item `itemId`, or in holder
     * `serial`). Items inside closed containers count but report visible:false (open it first).
     */
    aimLoot: (o: {kind?: string; itemId?: string; serial?: number; visibleOnly?: boolean} = {}) => {
      const cm = game.containers;
      if (!cm) return null;
      let best: {h: (typeof cm.all)[number]; lot: (typeof cm.all)[number]['state']['lots'][number]; d: number} | null = null;
      for (const h of cm.all) {
        if (o.kind && h.kind !== o.kind) continue;
        if (o.serial !== undefined && h.serial !== o.serial) continue;
        if (o.visibleOnly && !h.state.open) continue;
        for (const lot of h.state.lots) {
          if (o.itemId && lot.itemId !== o.itemId) continue;
          const at = cm.lotPoint(h, lot);
          if (!at) continue;
          const d = Math.hypot(at.x - game.player.x, at.z - game.player.z);
          if (!best || d < best.d) best = {h, lot, d};
        }
      }
      if (!best) return null;
      const at = cm.lotPoint(best.h, best.lot)!;
      api.lookAt(at.x, at.y, at.z);
      return {serial: best.h.serial, kind: best.h.kind, lotId: best.lot.id, itemId: best.lot.itemId, count: best.lot.count, at, stand: cm.aimPoint(best.h).stand, dist: best.d, visible: best.h.state.open};
    },
    zombieHead: (i: number) => {
      const v = game.zombies[i]?.hitVolumes.find(h => h.part === 'head');
      return v ? v.a : null;
    },
    zombieChest: (i: number) => {
      const v = game.zombies[i]?.hitVolumes.find(h => h.part === 'torso');
      return v && v.b ? {x: (v.a.x + v.b.x) / 2, y: (v.a.y + v.b.y) / 2, z: (v.a.z + v.b.z) / 2} : null;
    },
    /** Top-down debug map of the current station as a PNG data URL (for reports). */
    mapImage: (scale = 4) => {
      const l = game.layout, g = l.grid;
      let x0 = g.w, y0 = g.h, x1 = 0, y1 = 0;
      for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.cells[g.idx(x, y)] !== 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      x0 -= 2; y0 -= 2; x1 += 2; y1 += 2;
      const c = document.createElement('canvas');
      c.width = (x1 - x0 + 1) * scale; c.height = (y1 - y0 + 1) * scale + 18;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#16181a'; ctx.fillRect(0, 0, c.width, c.height);
      const colors: Record<string, string> = {platform: '#c9b98f', passage: '#bfb7a3', concourse: '#a9b8a8', service: '#8f9aa0', room: '#b7a58c', closet: '#9c8c78'};
      // Iteration 04 (Lane B): storefront units and the halls they line.
      const TYPE_COLORS: Record<string, string> = {'eatery': '#e8965c', 'shop': '#78aae2', 'food-court': '#dec478', 'retail-arcade': '#96c4ce'};
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const i = g.idx(x, y), cell = g.cells[i];
        if (cell === 0) continue;
        const a = g.area[i];
        ctx.fillStyle = cell === 2 ? '#3b3530' : g.blocked[i] ? '#4a4f55' : a >= 0 ? (TYPE_COLORS[l.areas[a].type] ?? colors[l.areas[a].kind]) : '#888';
        ctx.fillRect((x - x0) * scale, (y - y0) * scale, scale, scale);
      }
      const dot = (wx: number, wz: number, col: string, r = scale * 0.9) => { ctx.fillStyle = col; ctx.beginPath(); ctx.arc((wx / 0.5 - x0) * scale, (wz / 0.5 - y0) * scale, r, 0, Math.PI * 2); ctx.fill(); };
      for (const pk of l.pickups) dot(pk.x, pk.z, pk.itemId === 'shotgun' ? '#4f8a87' : '#d9a520', scale * 0.6);
      for (const z of l.zombies) dot(z.x, z.z, z.archetype === 'ratdog' ? '#b45cd6' : z.type === 'coated' ? '#3d6fd1' : '#c2463a'); // Lane Q: rat/dog purple
      dot(l.playerSpawn.x, l.playerSpawn.z, '#ffffff', scale * 1.2);
      ctx.fillStyle = '#ece4cf'; ctx.font = '12px sans-serif';
      ctx.fillText(`${l.name} · ${l.archetype} · ${l.areas.length} areas · ${l.storefronts.length} storefronts · ${l.zombies.length} zombies`, 4, c.height - 5);
      return c.toDataURL('image/png');
    },
    storageKeys: () => ({local: Object.keys(localStorage), session: Object.keys(sessionStorage)}),
    /** Audio lifecycle: contexts ever created (must be 1), ctx state, ambient loops, cues started. */
    audio: () => game.sfx.debugState(),
    /** Bounded feedback pools: live particles/sparks, bullet-hole and blood decals in use. */
    fx: () => game.fx.stats(),
    // Iteration 06 (Lane D): damage stats + aimDamage(type, {teleport}) + DEBUG qaDamageShot(weapon) (src/damage/qa.ts).
    ...damageQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number): boolean => api.teleport(x, z, yaw)),
    // Iteration 07 (Lane Q): rat/dog creature — creatures(), enemyMix(), goCreature(i?), aimCreature(i?, part), DEBUG qaSpawnCreature(dist).
    ...creatureQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number): boolean => api.teleport(x, z, yaw)),
    // Iteration 12 (AI): light lure — lightLure(), lureProbe(i?), goLureVantage({index, dist, ahead}), DEBUG qaLureLight / qaLureLightSet.
    ...lightLureQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    // Task track3-eaton-centre-20261031 (lane HORDE): roaming hordes — hordes(), goHorde({group, ahead}), hordeKillCheck().
    ...hordeQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    ...gearQaApi(game), // Iteration 16 (lane GEAR): gear(), gearGive(id), bagPlace(), bagOpen(), bagQuick('pack:0'), bagMove(a, b), bagWear(), bagClose()
    ...marketTradeQaApi(() => game.trade), // task studio-survivor-market-20261108-005807-01 (lane TRADE): trade(), the stalls' stock / balance / deal line
    ...weaponVarietyQaApi(() => game, itemIconUrl), // task studio-weapon-runtime-fix-20261110-022206-01: weaponVariety() — per new weapon: model state / held / preview; loader + delivery counters
    ...marketCombatQaApi(() => game.marketCombat), // task studio-market-rework-20261108-074144-01 (lane COMBAT): marketCombat() (hostility, people, rounds), marketProvoke(stall?, kind?)
    ...marketAudioQaApi(() => game.marketAudio, () => game.sfx.marketAudioState()), // task studio-market-bar-20261108-225231-01 (lane AUDIO): marketAudio() (murmur groups / channels, voices, counts)
    ...marketWaresQaApi(() => game.marketWares), // task studio-market-rework-20261108-074144-01 (lane WARES): wares(), waresSteal(uid)
    ...vomitQaApi(() => game.vomit), // task studio-market-bar-20261108-225231-01 (lane SHELVES): vomit(), vomitStart(), vomitChunks()
    ...towerQaApi(game), // Iteration 17 / office-overhaul (lane LIFT): tower(), towerGoLanding(floor), towerGoCab(), liftButtons(), liftAim(id), liftPress(id, 'mouse' | 'key'), liftState(), towerExteriorTune({...})
    ...officeArchQaApi(game), // Task office-overhaul-20261030 (lane ARCH): exteriorFogTune({...}), officeArch(), officeArchTune({...}), roofFog()
    // Task track3-eaton-centre-20261031 (lane ARCH): mallArch(), mallFog({density, color}), mallSkylight(), mallCuller(), mallPoses(), mallPose(name)
    ...mallArchQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    ...gasQaApi(game), // Task gasmask-breach-20261030 (lane GAS): windows(level?), windowAim(id), DEBUG windowBreak(id), gas(), gasTune({...})
    ...beerQaApi(() => game.beerEffects), // task studio-market-bar-20261108-225231-01 (lane BEER): beer() — the timed slot, rolls, counters (read-only)
    ...reactorAirQaApi(game), // task reactor-build-20261101 (lane AIR): reactorAir(), reactorGoGenerator(id), DEBUG reactorStartGenerator(id), reactorClearAll(s), reactorDepthAt(y), reactorGasTune({...})
    ...reactorCpuQaApi(game as Parameters<typeof reactorCpuQaApi>[0]), // task studio-reactor-submit-roof-fog-20261102 (lane CPU): reactorCpu(), DEBUG reactorCpu({rules: false|true})
    ...reactorArchQaApi(game as Parameters<typeof reactorArchQaApi>[0]), // task reactor-build-20261101 (lane ARCH): reactorArch(), reactorFog({density, color}), DEBUG reactorVisualsSet({fan, generator, core, tier})
    ...gaslightQaApi(game), // task reactor-expansion-20261101 (lane GASLIGHT): gaslight(), gaslightShafts({gain, fade, colour})
    // task studio-reactor-surface-ending-20261102 (lane SURFACE): reactorSurface({sky, ground, horizon, zenith, clouds, mist}) — the
    // city plan census, eye gate / rain / wet / fog state, draws and triangles; the outdoor look's uniforms (tune)
    reactorSurface: (tune?: Parameters<ReactorSurface['qa']>[0]): object => reactorSurfaceOf(game)?.qa(tune) ?? {installed: false},
    // task studio-reactor-surface-ending-20261102 (lane ENDING): reactorEnding({online, open, skipMessage, go: 'door' | 'stairs' | 'top' |
    // 'exit' | 'hole'}) — the exterior door's phase / seal / the centre message / the objective stage; force the clear-complete state, poses
    ...reactorEndingQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    // task studio-alpha-reactor-surface-redesign-credits-20261103-055510-01 (lane CREDITS): reactorCredits({skip: s, start, end, press, reset})
    // — the credits record / phase / gate / counters; QA fast-forward of the 10 s count and the scroll, the end card's button
    reactorCredits: (cmd?: Parameters<ReactorCredits['qa']>[0]): object => reactorCreditsOf(game)?.qa(cmd) ?? {installed: false},
    // Task track1-siren-blightbelly-20261031 (lane BLIGHT): blight(), blightGo(i?, dist), blightAim(i?), blightGas(), DEBUG blightSpawnNear(dist) / blightKill(i?)
    ...blightbellyQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    // Task track1-siren-blightbelly-20261031 (lane SIREN): sirens(), sirenSystem(), goSiren(i?, dist, face), sirenLight(i?), sirenProbe(i?), aimSiren(i?, part), DEBUG sirenWake(i?) / qaSpawnSiren(dist)
    ...sirenQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    // Task studio-alpha-beyond-station-round4-20261101-01 (lane FAMILY): strainers(), strainerGo(i?, dist), strainerAim(i?, part), DEBUG strainerSpawnNear(dist)
    ...strainerQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    // task reactor-build-20261101 (lane RESTART): reactorRestart(), reactorGoControl(id), reactorControl(id, {give}), reactorWinFinish()
    ...reactorRestartQaApi(game, (x: number, y: number, z: number): void => { api.lookAt(x, y, z); }, (x: number, z: number, yaw?: number, level?: number): boolean => api.teleport(x, z, yaw, level)),
    ...fuelQaApi(game), // task train-fuel-system: fuel(), fuelSetTank(units)
    ...trainQaApi(game), // Task player-train-shell-20261101-202805 (lane TRAIN): train(), trainDoor(i, open), trainFaceDoor(i?), trainLights(); train-shell-followup: trainGo('cab' | 'rear' | 'spawn'); train-lockbox: trainGo('lockbox')
    ...rideQaApi(game), // task campaign-foundation-20261102 (lane RIDE): ride(), rideDepart(), rideArrive(), rideDemo(seconds?) (dev: depart + loop + re-arrive at the same station), rideReset()
    ...lockboxQaApi(game), // task train-lockbox-windows-20261101-232156 (lane BOX): lockbox(), lockboxOpen(), lockboxClose(), lockboxType(keys), lockboxQuick(spec), lockboxMove(from, to, n?), lockboxStow()
    ...trunkQaApi(game), // task studio-beta-skyways-vehicle-20261107 (lane TRUNK): trunk(), trunkOpen(), trunkClose(), trunkQuick(spec), trunkMove(from, to, n?), trunkStow()
    // Task office-overhaul-20261030 (lane STRUCT): stand at the roof access ladder (then the game's own "[E] Climb ladder") or on a transit-hall lane (0 / 2 escalators, 1 stair)
    goRoofLadder: (end: 'bottom' | 'top' = 'bottom') => {
      const q = roofLadderPose(game.layout, end);
      if (!q) return null;
      game.player.place(q.x, q.z, q.yaw, q.y); game.player.pitch = q.pitch;
      return q;
    },
    // Task office-interactions-layout-20261030: in front of the roof cache (lane ROOF) / at the top of a floor's side corridor
    // looking into its arrangement (lane LAYOUT; kind = 'ring' | 'loop' | 'commons')
    goRoofCache: () => {
      const q = roofRewardPose(game.layout);
      if (!q) return null;
      game.player.place(q.x, q.z, q.yaw, q.y); game.player.pitch = q.pitch;
      return q;
    },
    goFloorPlan: (floor: number) => {
      const q = floorPlanPose(game.layout, floor);
      if (!q) return null;
      game.player.place(q.x, q.z, q.yaw, q.y); game.player.pitch = q.pitch;
      return q;
    },
    // Task track3-eaton-centre-20261031 (lane GEN): stand at a mall pose (gen/mall/qa.ts: 'platform-lookup', 'court', 'ring-edge',
    // 'shopfront', 'escalator', 'bridge', 'elevator', 'washrooms'; `ring` = the storey for ring-edge / shopfront / escalator / washrooms).
    goMall: (name: MallPoseName = 'platform-lookup', ring?: number) => {
      const q = mallQaPose(game.layout, name, ring);
      if (!q) return {ok: false, names: MALL_POSE_NAMES};
      game.player.place(q.x, q.z, q.yaw, q.y); game.player.pitch = q.pitch;
      return {ok: true, ...q, variant: game.layout.mall?.variant};
    },
    // Task track3-eaton-centre-20261031 (primary, lane SHOPS pose): stand at the entry of the nth shop of a program / recipe
    // ('guns', 'pharmacy', …) looking in.
    goShop: (program = 'guns', nth = 0) => {
      const q = mallShopPose(game.layout, program, nth);
      if (!q || !api.teleport(q.x, q.z, q.yaw, q.level)) return {ok: false, programs: [...new Set(game.layout.mall?.shops.map(s => s.program) ?? [])]};
      game.player.pitch = -0.08;
      const s = game.layout.mall?.shops.find(t => t.id === q.shop);
      return {ok: true, ...q, brand: s?.brand, kind: s?.kind};
    },
    goTransit: (end: 'bottom' | 'top' = 'bottom', lane = 1) => {
      const q = transitPose(game.layout, end, lane);
      if (!q) return null;
      game.player.place(q.x, q.z, q.yaw, q.y); game.player.pitch = q.pitch;
      return q;
    },
    ...walkerQaApi(game), // Iteration 17: walkTo(x, z, y?), walkStatus(), traceStart/Stop/Summary/Samples, lifecycle()
    // Iteration 12 (LIGHT): light() — battery / glow / flares / light sources; DEBUG qaSetBattery(charge), qaGiveItem(id, n).
    ...lightQaApi(game),
    /**
     * Iteration 06 (Lane F): volumetric atmosphere state (enabled/active, resolution, steps, shadow map, ms). Iteration 13 (FOG):
     * + backend the fog pass runs on, fog clock {fog, game, epoch}, motion (m/s), density stats, pass counters.
     */
    atmosphere: () => game.atmosphere.debug(),
    /**
     * Iteration 13 (FOG): the world haze at (x, y, z) — sigma (1/m), patch / wisp values, area multiplier, level slot — at the
     * current fog time, or at fog time `t` (s). The CPU mirror of what the march integrates there; independent of the camera,
     * so a value read before walking away and again on return (same t) must be identical (persistence check).
     */
    fogSample: (x: number, y: number, z: number, t?: number) => game.atmosphere.fogSample(x, y, z, t),
    /**
     * Iteration 13 (CORE): renderer backend that actually initialized — read from three's backend object, not navigator.gpu:
     * {backend: 'webgpu' | 'webgl2-fallback', adapter, reason, requested, webgpuApi, glRenderer, label, deviceLost, errors, …}.
     */
    gpu: () => gpuQa(),
    /**
     * Task mall-playtest-revision-20261031 (lane FIX, U08): floor / wall / ceiling texture anisotropy on the ACTIVE backend —
     * {backend, software, requested (16), supported (WebGL: EXT max; WebGPU: 16 spec clamp), supportedSource, cap, capReason,
     * effective, roles: {floor | wall | ceiling | architecture | detail | other: {textures, requested: {value: n}, effective: {value: n}}},
     * observed: {api: 'createSampler' | 'texParameterf', values: {anisotropy: count}} (what three handed the API), note}.
     */
    anisotropy: () => anisotropyReport(anisotropyCapability(game.softwareGl), game.scene, game.renderer.initialized ? observeBackendAnisotropy(game.renderer.backend) : null, [decayDetailTexture()]),
    /** Iteration 14: the loading-screen render warm-up's result (status, mode, plan counts, per-stage done / total / ms) and whether one runs now. */
    warmup: () => ({running: game.warming, result: game.warmup, runtimeVariants: game.runtimeVariants.stats}),
    /**
     * Task frame-budget-deferral-20261030 (lane SCHED): the frame-budget scheduler (core/frameBudget.ts) — refresh detection,
     * budget, hold, generation, queued jobs + oldest age, last run frame (chunks / ms / deferred / overdue runs / remaining),
     * totals (chunks, ms, overdue runs, drops, cancellations, errors, overruns), per-kind estimates; plus this frame's frameCpu.
     */
    frameBudget: () => ({...game.frameBudget.diagnostics(), frameCpu: {...game.frameCpu}}),
    /** Lane SCHED: the brains' path requests (ai/pathService.ts) — immediate / queued far re-plans / delivered / reissued / skipped / refused. */
    pathService: () => game.pathService ? {...game.pathService.stats, pending: game.pathService.pending} : null,
    /**
     * Task frame-budget-deferral-20261030 (lane MEASURE): opt-in frame profiler (debug/updateProfile.ts). Start (clears the
     * window: a ring of the newest 600 play frames), read, stop. updateProfile({reset, window, spikes}) -> per span avg / p95 /
     * max ms per frame, frames entered, calls, share of frame time over the newest `window` frames (default all), the `spikes`
     * slowest frames (default 5) with their dominant spans, hook names, clock note; `reset` clears after reading.
     */
    updateProfileStart: () => {
      game.prof.startRecording();
      return {on: true, capacity: game.prof.capacity, spans: SPAN_COUNT, hooks: [...game.prof.hookNames]};
    },
    updateProfile: (o: {reset?: boolean; window?: number; spikes?: number} = {}) => {
      const r = game.prof.report(o);
      if (o.reset) game.prof.reset();
      return {...r, about: SPAN_ABOUT};
    },
    updateProfileStop: () => { const r = game.prof.report(); game.prof.stopRecording(); return r; },
    /** Iteration 13 (MAT-A): decay field texel + level band the surface shaders read at world points (GPU) vs the CPU field. */
    decayProbe: (pts: DecayProbe[]) => probeDecayGPU(game.renderer as never, pts),
    /**
     * Iteration 06 (Lane F) before/after toggle: `enabled` switches only the volumetric pass (flashlight
     * shadows stay); `quality` 'off'|'low'|'high' overrides the settings quality ('off' = exact r5 path);
     * `flashlight` sets the lamp; `params` edits live tunables (QA tuning). Returns the new state.
     */
    setAtmosphere: (o: {enabled?: boolean; quality?: 'off' | 'low' | 'high' | null; flashlight?: boolean; params?: Record<string, unknown>} = {}) => {
      const a = game.atmosphere;
      if (o.enabled !== undefined) a.enabled = o.enabled;
      if (o.quality !== undefined) { a.override = o.quality; a.setQuality(game.settings.quality); game.resize(); }
      if (o.flashlight !== undefined) game.flashlightOn = o.flashlight;
      if (o.params) Object.assign(a.params, o.params);
      return a.debug();
    },
    /** Physics: ragdoll/casing counts, cannon body count and step cost (ms). */
    physics: () => ({...game.physics.stats(), ragdolls: game.physics.debugRagdolls(), casings: game.physics.casings.list()}),
    // --- Iteration 08 (Lane S): real 3D shelf stock (filler) --------------------------------------
    /** Stock per station: stocked holders, filler pieces, active / resting / frozen bodies, draw calls (total / in view / moving), tris, MB. */
    stock: () => {
      const s = game.stock.stats();
      const byLevel: Record<number, {holders: number; pieces: number}> = {};
      for (const h of game.stock.holders) { const e = (byLevel[h.level] ??= {holders: 0, pieces: 0}); e.holders++; e.pieces += h.count; }
      return {...s, byLevel, draw: game.stock.drawCallsInView(game.camera), pierced: game.stock.pierced,
        shops: s.shops.map(x => ({...x, use: game.layout.storefronts[x.shop]?.use ?? null, name: game.layout.storefronts[x.shop]?.name ?? null}))};
    },
    /**
     * QA-only (setup, not shot proof): stand ~2.5 m in front of a stocked shelving unit (storefront first; optionally on `level`),
     * aiming at its fullest middle board. The shot itself must be an ordinary shotgun mouse click.
     */
    goStockedShelf: (level?: number) => {
      const L = game.levels;
      // stand 2.5 m in front, else 2.0 / 1.6 / 1.3 m (narrow lower-level rooms); sparse back-room boards accepted for a level
      const t = game.stock.shelfTarget({level, free: (s, aim) => qaStandFree(L, s, aim)});
      if (!t) return null;
      const p = game.player;
      p.x = t.stand.x; p.z = t.stand.z; p.y = L.supportIn(t.stand.x, t.stand.z, t.stand.y + 0.3)?.floor ?? t.stand.y; p.vy = 0; p.grounded = true; p.climb = null;
      api.lookAt(t.aim.x, t.aim.y, t.aim.z);
      const h = t.holder;
      return {holder: h.index, kind: h.kind, category: h.category, level: h.level, shop: h.shop ?? null, tier: t.tier, piecesOnBoard: t.pieces, pieces: h.count,
        stand: {x: p.x, y: p.y, z: p.z}, aim: {x: t.aim.x, y: t.aim.y, z: t.aim.z}, standOff: t.dist, dist: Math.hypot(t.aim.x - p.x, t.aim.z - p.z)};
    },
    /** Filler displaced since load (> 2 cm), max displacement (m), any below their floor / outside the station, + physics counters. */
    stockMoved: () => ({...game.stock.filler.displacement(game.physics.statics), physics: game.stock.filler.stats()}),
    /**
     * Iteration 04: a full mouse drag through the real pointer listeners (synthetic PointerEvents).
     * Specs: 'hotbar:N' | 'pack:N' (panel slots), 'hud:N' (HUD quick slot), 'panel', 'out' (floor).
     * Opens the inventory first if playing. Returns the drop {from, to, count, result} or null.
     */
    invDrag: (from: string, to: string, shift = false) => {
      if (game.state === 'playing') game.openInventory();
      return game.invUI.simulateDrag(from, to, shift);
    },
    /** Viewport point of a slot spec, for real-mouse automation (e.g. page.mouse.move/down/up). */
    invPoint: (spec: string) => game.invUI.pointFor(spec),
    // --- Task knife-windup-20261030 (lane SLOT): the melee slot (~) -------------------------------------------------
    /** The melee slot, whether its weapon is drawn, the remembered quick slot, what the hands / weapon controller hold, the HUD ~ cell. */
    meleeSlot: () => {
      const m = game.inv.melee, held = game.inv.selectedStack();
      return {slot: m ? {itemId: m.itemId, uid: m.uid} : null, selected: game.inv.meleeSelected, quickSlot: game.inv.selected, held: held?.itemId ?? null,
        weapon: game.weapon.def?.id ?? null, quickSlot3: game.inv.hotbar[2]?.itemId ?? null,
        hudCell: typeof document !== 'undefined' ? document.querySelector('#hotbar .slot.meleeslot')?.className ?? null : null};
    },
    /** Press ~ for the next playing frame, as an unmodified Backquote keydown does (Game.update -> slotKeys -> selectMelee). */
    pressMelee: () => { game.input.pressed.add('Backquote'); return true; },
    /** What ~ does, synchronously: draw the melee slot's weapon (false = empty everywhere: the "No melee weapon" toast). */
    selectMelee: () => game.selectMelee(),
    /**
     * Narrow-viewport HUD check: rounded rects of the vitals, weapon panel / hint, light panel and every HUD slot cell (left to
     * right as shown), plus every cell that intersects one of those panels (`overlaps`: expected empty at >= 960 px wide).
     */
    hudLayout: () => {
      type R = {l: number; t: number; r: number; b: number};
      const rect = (el: Element | null): R | null => { if (!el) return null; const b = el.getBoundingClientRect(); return b.width > 0 ? {l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom)} : null; };
      const cells = [...document.querySelectorAll<HTMLElement>('#hotbar .slot')].map(el => ({bar: el.dataset.bar ?? '', index: Number(el.dataset.index), rect: rect(el)}))
        .sort((a, b) => (a.rect?.l ?? 0) - (b.rect?.l ?? 0));
      const panels: Record<string, R | null> = {vitals: rect(document.querySelector('#vitals')), weaponPanel: rect(document.querySelector('#weapon-panel')),
        weaponHint: rect(document.querySelector('#weapon-hint')), lightPanel: rect(document.querySelector('#light-panel'))};
      const hit = (a: R | null, b: R | null) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
      const overlaps: string[] = [];
      for (const c of cells) for (const [k, p] of Object.entries(panels)) if (hit(c.rect, p)) overlaps.push(`${c.bar}:${c.index} x ${k}`);
      return {viewport: {w: window.innerWidth, h: window.innerHeight}, order: cells.map(c => c.bar), cellWidth: (q => q?.rect ? q.rect.r - q.rect.l : null)(cells.find(c => c.bar === 'hotbar')), cells, panels, overlaps};
    },
    /** Contact sheet (PNG data URL) of every model-rendered item icon, for reports. */
    iconSheet: async () => {
      const ids = itemIconStats().ids, cols = 5, w = 192, h = 136;
      const c = document.createElement('canvas');
      c.width = cols * w; c.height = Math.max(1, Math.ceil(ids.length / cols)) * h;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#15171a'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.fillStyle = '#ece4cf'; ctx.font = '12px sans-serif';
      await Promise.all(ids.map((id, i) => new Promise<void>(res => {
        const im = new Image();
        const x = (i % cols) * w, y = Math.floor(i / cols) * h;
        im.onload = () => { ctx.drawImage(im, x, y); ctx.fillText(id, x + 4, y + h - 5); res(); };
        im.onerror = () => res();
        im.src = itemIconUrl(id) ?? '';
      })));
      return c.toDataURL('image/png');
    },
    // --- Iteration 08 (Lane I): openable holders (lids / doors / drawers) -------------------------------------
    /** Per-kind openable counts (per level), parts, open parts, cramped openings, lots inside, own-mesh takeovers, model sources. */
    openables: () => game.containers?.openablesQa() ?? null,
    /** One openable holder (by holder serial): per-part open / t / opening amount / lots inside / aim + stand points. */
    openableState: (serial: number) => game.containers?.openableState(serial) ?? null,
    /**
     * QA-only (setup, not interaction proof): stand in front of an openable (optionally of `kind`, on `level`, nearest first) and
     * aim at its part `part` (default 0). [E] itself must be an ordinary key press. Returns its openableState().
     */
    goOpenable: (kind?: string, level?: number, part = 0) => {
      const cm = game.containers, L = game.levels, p = game.player;
      if (!cm) return null;
      const list = cm.openList.filter(h => (!kind || h.kind === kind) && (level === undefined || (h.prop.level ?? 0) === level) && h.open && !h.open.loose && part < h.open.parts.length)
        .sort((a, b) => Math.hypot(a.prop.x - p.x, a.prop.z - p.z) - Math.hypot(b.prop.x - p.x, b.prop.z - p.z));
      for (const h of list) {
        const st = cm.openableState(h.serial) as {parts: {aim: {x: number; y: number; z: number}; stand: {x: number; z: number}}[]} | null;
        const t = st?.parts[part];
        if (!t) continue;
        const lv = h.prop.level ?? 0;
        if (!api.teleport(t.stand.x, t.stand.z, undefined, lv)) continue;
        if (Math.hypot(p.x - t.stand.x, p.z - t.stand.z) > 0.4) continue;
        if (L && !L.lineOfSight({x: p.x, y: p.y + 1.6, z: p.z}, t.aim, {slack: 0.3})) continue;
        api.lookAt(t.aim.x, t.aim.y, t.aim.z);
        return cm.openableState(h.serial);
      }
      return null;
    },
    /**
     * Task office-props-physics-scale-20261030 (lane PHYS): stand 1.2 m off a free side of the nearest untouched light physics prop
     * of `kind` (default: any contact kind — e.g. 'rollingSuitcase' in the Subway, 'officeChair' / 'plasticStackChair' in the
     * Office; a spill holder: 'bin', 'wheelieBin', 'archiveBoxes') on `level` (default the player's storey), facing it. Then hold
     * W (a real key) ~1 s and read walkIntoCheck(): the prop must be loose and moved with `shots` 0 (no shot / aim needed); a
     * spill holder's `spilled` equals its `lotsBefore` and `lotsLeft` is 0. Returns the target or null.
     */
    goWalkInto: (kind?: string, level?: number) => {
      const p = game.player, L = game.levels, props = game.layout.props, di = game.physics.dynamicItems;
      const lv = level ?? Math.max(0, L.levelAt(p.x, p.z, p.y + 0.05));
      const cands = props.map((q, i) => ({q, i})).filter(({q}) => (q.level ?? 0) === lv && q.h > 0.02 && (!kind || q.kind === kind) && !!propPhysics(q.kind).contact
        && di.isDynamicProp(q)).sort((a, b) => Math.hypot(a.q.x - p.x, a.q.z - p.z) - Math.hypot(b.q.x - p.x, b.q.z - p.z)).slice(0, 40);
      const near = new Set<number>(), r = 0.36;
      const free = (t: PropPlacement, x: number, z: number) => {
        for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) if (L.blocksAt(cx, cz, x, z, t.y)) return false;
        for (const k of game.propIndex.near(x - r, z - r, x + r, z + r, near)) {
          const q = props[k];
          if (q !== t && q.h > 0.05 && q.y < t.y + 1.8 && q.y + q.h > t.y + 0.05 && Math.abs(q.x - x) < q.hx + r && Math.abs(q.z - z) < q.hz + r) return false;
        }
        return true;
      };
      for (const {q, i} of cands) {
        const f = {x: Math.sin(q.rot), z: Math.cos(q.rot)};
        for (const [ax, az] of [[f.x, f.z], [-f.x, -f.z], [f.z, -f.x], [-f.z, f.x]].map(([a, b]) => [Math.round(a), Math.round(b)])) {
          const face = Math.abs(ax) * q.hx + Math.abs(az) * q.hz;
          let ok = true;
          for (let s = -(face + 0.6); s <= face + 1.6 && ok; s += 0.1) if (Math.abs(s) >= face + r) ok = free(q, q.x + ax * s, q.z + az * s);
          if (!ok || !api.teleport(q.x + ax * (face + 1.5), q.z + az * (face + 1.5), undefined, lv)) continue;
          api.lookAt(q.x, q.y + Math.min(0.5, q.h * 0.6), q.z);
          const st = di.stats();
          const lots = game.containers?.holderFor(q)?.state.lots.length ?? 0;
          walkInto = {prop: q, index: i, x: q.x, z: q.z, contacts: st.counts.contacts, shots: st.counts.shots, lots};
          return {kind: q.kind, index: i, level: lv, at: {x: q.x, y: q.y, z: q.z}, mat: propPhysics(q.kind).mat, lots, hint: 'hold W ~1 s, then __LL.walkIntoCheck()'};
        }
      }
      return null;
    },
    /**
     * Task mall-playtest-revision-20261031 (lane FIX, U04): stand 1.5 m off a round atrium column (layout props of kind
     * 'atriumColumn', round: true — the `i`-th, else the nearest on the player's storey) on a free side, facing its centre at chest
     * height. Then hold W (a real key) ~1 s and / or fire, and read columnCheck(). Returns the target or null.
     */
    goColumn: (i?: number) => {
      const p = game.player, L = game.levels, props = game.layout.props;
      const all = props.filter(q => q.kind === 'atriumColumn');
      const lv = Math.max(0, L.levelAt(p.x, p.z, p.y + 0.05));
      const list = i !== undefined ? all.slice(i, i + 1) : all.filter(q => (q.level ?? 0) === lv).sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      for (const c of [...list, ...(i === undefined ? all : [])]) {
        for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (!api.teleport(c.x + ax * 1.5, c.z + az * 1.5, undefined, c.level ?? 0)) continue;
          if (Math.hypot(p.x - (c.x + ax * 1.5), p.z - (c.z + az * 1.5)) > 0.2) continue;
          api.lookAt(c.x, c.y + 1.4, c.z);
          columnTarget = c;
          return {index: all.indexOf(c), count: all.length, level: c.level ?? 0, at: {x: c.x, y: c.y, z: c.z}, r: c.hx, h: +c.h.toFixed(2), round: c.round === true,
            hint: 'hold W ~1 s (contact stops at 0.64 m from the axis), fire at it, then __LL.columnCheck()'};
        }
      }
      return null;
    },
    /**
     * Task mall-round2-20261031 (lane PROPS, M03 / M04 / M07): QA-only view setup (no interaction) — stand `dist` m off the nearest
     * placement of `kind` (the player's storey first, then any storey unless `level` is given) on its `view` side ('front' = the prop's
     * front, 'left34' / 'right34' = 35 deg off it, 'rear'), with a line of sight to that face, looking at `aimH` x its height. E.g.
     * goProp('cctvConsole') (mall security room island / Office ironclad), goProp('multideckOpenCooler', undefined, 'front', 1.6, 0.55)
     * (its inner back wall through the open front), goProp('wallBay', undefined, 'right34', 1.8). Returns the target or null.
     */
    goProp: (kind: string, level?: number, view: 'front' | 'left34' | 'right34' | 'rear' = 'front', dist = 2.2, aimH = 0.6) => {
      const p = game.player, L = game.levels;
      const lv = level ?? Math.max(0, L.levelAt(p.x, p.z, p.y + 0.05));
      const all = game.layout.props.filter(q => q.kind === kind);
      const byDist = (a: PropPlacement, b: PropPlacement) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z);
      const list = [...all.filter(q => (q.level ?? 0) === lv).sort(byDist), ...(level === undefined ? all.filter(q => (q.level ?? 0) !== lv) : [])];
      const yaw = {front: 0, left34: 0.61, right34: -0.61, rear: Math.PI}[view];
      for (const q of list) {
        const dir = {x: Math.sin(q.rot + yaw), z: Math.cos(q.rot + yaw)};
        const face = Math.abs(dir.x) * q.hx + Math.abs(dir.z) * q.hz;
        const sx = q.x + dir.x * (face + dist), sz = q.z + dir.z * (face + dist), qlv = q.level ?? 0;
        if (!api.teleport(sx, sz, undefined, qlv) || Math.hypot(p.x - sx, p.z - sz) > 0.4) continue;
        const aimY = q.y + q.h * aimH;
        if (!L.lineOfSight({x: p.x, y: p.y + 1.6, z: p.z}, {x: q.x + dir.x * (face + 0.05), y: aimY, z: q.z + dir.z * (face + 0.05)}, {slack: 0.3})) continue;
        api.lookAt(q.x, aimY, q.z);
        return {kind, count: all.length, level: qlv, view, at: {x: q.x, y: q.y, z: q.z}, rot: +q.rot.toFixed(3), h: +q.h.toFixed(3), stand: {x: +sx.toFixed(2), z: +sz.toFixed(2)}};
      }
      return null;
    },
    /** Lane FIX (U04): the goColumn target — player distance to its axis, contact (<= 0.30 + r + 2 cm) and what a bullet along the view hits. */
    columnCheck: () => {
      const c = columnTarget;
      if (!c) return null;
      const p = game.player, cam = game.camera;
      const dir = cam.getWorldDirection(new THREE.Vector3());
      const o = cam.getWorldPosition(new THREE.Vector3());
      const hit = game.levels.raycast({x: o.x, y: o.y, z: o.z}, {x: dir.x, y: dir.y, z: dir.z}, 40, {props: game.layout.props});
      const dist = Math.hypot(p.x - c.x, p.z - c.z);
      return {dist: +dist.toFixed(3), contactDist: +(p.radius + c.hx).toFixed(3), touching: dist <= p.radius + c.hx + 0.02,
        ray: {kind: hit.kind, t: +hit.t.toFixed(3), column: hit.prop !== undefined && game.layout.props[hit.prop] === c, prop: hit.prop !== undefined ? game.layout.props[hit.prop].kind : null}};
    },
    /** Lane PHYS: the goWalkInto target now — loose, how far it moved, contact wakes / shots since, prop physics + reclaim counters. */
    walkIntoCheck: () => {
      const t = walkInto;
      if (!t) return null;
      const st = game.physics.dynamicItems.stats();
      const h = game.containers?.holderFor(t.prop);
      const holder = h ? {lotsBefore: t.lots, lotsLeft: h.state.lots.length, spilled: game.pickups.list.filter(q => q.fromLot?.holder === h.serial).length} : {};
      return {kind: t.prop.kind, index: t.index, loose: t.prop.h === 0, moved: +Math.hypot(t.prop.x - t.x, t.prop.z - t.z).toFixed(3), ...holder, contacts: st.counts.contacts - t.contacts,
        shots: st.counts.shots - t.shots, propsAwake: st.propsAwake, resting: st.resting, restingInWorld: st.restingInWorld, reclaimed: st.counts.reclaimed, redetached: st.counts.redetached,
        detached: game.damage.props.detachedCount, stepMs: game.physics.stats().stepMs};
    },
    /**
     * DEBUG ONLY (exception to the read-only rule above, for the ragdoll browser check): kill the
     * nearest living zombie as if shot from the player, with the rifle/shotgun kill impulse.
     */
    /** Pistol lane: weapon finds of this station (generated placements + live world pickups) with level and spawn distance. */
    weaponFinds: () => {
      const sp = game.layout.playerSpawn, isGun = (id: string) => itemDef(id).kind === 'weapon';
      return {
        startWeapon: game.startWeapon, devPistol: game.devPistol,
        generated: game.layout.pickups.filter(p => isGun(p.itemId)).map(p => ({itemId: p.itemId, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), level: p.level ?? 0, area: p.area,
          purpose: game.layout.areas[p.area]?.purpose ?? game.layout.areas[p.area]?.type, spawnDist: +Math.hypot(p.x - sp.x, p.z - sp.z).toFixed(1)})),
        live: game.pickups.list.filter(p => isGun(p.stack.itemId)).map(p => ({itemId: p.stack.itemId, mag: p.stack.mag, x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), spawnDist: +Math.hypot(p.x - sp.x, p.z - sp.z).toFixed(1)})),
      };
    },
    qaKillNearest: (weapon: 'rifle' | 'shotgun' = 'rifle') => {
      const p = game.player;
      const z = game.zombies.filter(q => q.brain.alive).sort((a, b) => Math.hypot(a.brain.x - p.x, a.brain.z - p.z) - Math.hypot(b.brain.x - p.x, b.brain.z - p.z))[0];
      if (!z) return null;
      const chest = api.zombieChest(game.zombies.indexOf(z)) ?? {x: z.brain.x, y: 1.2, z: z.brain.z};
      const dir = new THREE.Vector3(chest.x - p.x, chest.y - p.eye, chest.z - p.z).normalize();
      z.brain.damage(z.brain.hp + 1, p.x, p.z);
      const ok = game.physics.ragdoll(z, {dir, point: chest, strength: killImpulseStrength(weapon, weapon === 'shotgun' ? 9 : 1, weapon === 'shotgun' ? 9 : 1)});
      return {index: game.zombies.indexOf(z), ragdoll: ok, at: chest};
    },
    // --- Iteration 16 (lane RUN): the run (levels / sections, carryover, memories) and test travel ---------------------
    /** Current section, arrival, level seeds (+ codes), gear roll, the Retry snapshot summary and every section memory. */
    run: () => {
      const r = game.run, cur = r.current;
      const mem = r.peekMemory(cur);
      return {
        id: r.id, current: {...cur}, sectionId: r.sectionId, arrival: {...game.arrival}, travelling: game.travelling, state: game.state,
        seeds: {...r.seeds}, codes: Object.fromEntries(Object.entries(r.seeds).map(([k, v]) => [k, seedToCode(v)])), gear: r.gear, entered: [...r.entered],
        entry: r.entry && {level: r.entry.level, section: r.entry.section, arrival: r.entry.arrival, hp: r.entry.vitals.hp, survival: r.entry.survival,
          battery: r.entry.battery, lanes: Object.keys(r.entry.lanes), memories: Object.keys(r.entry.memories), items: r.entry.inventory.hotbar.concat(r.entry.inventory.pack).filter(Boolean).map(st => `${st!.itemId}x${st!.count}`)},
        here: {name: game.layout?.name, zombies: game.layout?.zombies.length ?? 0, alive: game.zombies.filter(z => z.brain.alive).length, pickups: game.pickups.list.length, layoutPickups: game.layout?.pickups.length ?? 0},
        memory: mem ? memorySummary(mem, game.layout?.pickups.length) : null,
        memories: r.memoryIds().map(id => memorySummary(r.peekMemory(parseSectionId(id))!)),
        participants: game.runParticipants.map(p => p.id),
        carry: {hp: game.player.hp, alive: game.player.alive, hunger: game.survival.hunger, thirst: game.survival.thirst, battery: game.torch.battery.charge,
          items: game.inv.hotbar.concat(game.inv.pack).filter(Boolean).map(st => `${st!.itemId}x${st!.count}`)},
      };
    },
    /** QA level change (a menu travel: the full loading screen). Resolves with the TravelResult. */
    travel: (level: LevelId, section = 'main', arrival?: Arrival) => game.travel({to: {level, section}, arrival: arrival ?? {kind: 'start'}, label: `QA travel · ${level}`, via: 'menu'}),
    /** QA: NewGame in a level (seeds optional) without entering play; resolves with the warm-up status. */
    newGame: (level: LevelId, seeds?: Partial<Record<LevelId, number>>) => game.newGame(level, {seeds}).then(w => w?.status ?? null),
    /** Task track3-eaton-centre-20261031 (lane PACKAGE): the level's lazy working set, resident models / bytes, late fetches, level resources. */
    levelAssets: () => game.levelAssetsQa(),
  };
  (window as unknown as {__LL: typeof api}).__LL = api;

  /** Iteration 13 (CORE): backend diagnostics (null until renderer.init() resolved) + live renderer facts. */
  function gpuQa() {
    const g = game.gpu, r = game.renderer;
    if (!g) return null;
    const be = r.backend as {isWebGPUBackend?: boolean; isWebGLBackend?: boolean};
    return {...g, adapter: g.adapter && {...g.adapter}, errors: [...g.errors],
      live: {isWebGPUBackend: be.isWebGPUBackend === true, isWebGLBackend: be.isWebGLBackend === true, coordinateSystem: r.coordinateSystem, samples: r.samples,
        pixelRatio: r.getPixelRatio(), toneMapping: r.toneMapping, outputColorSpace: r.outputColorSpace, shadowMap: {...r.shadowMap}, atmosphereBypass: game.atmosphereBypass, overlayDraws: game.overlay.draws}};
  }

  /** Iteration 08 (Lane B): storey + support of the player and every zombie. */
  function levelQa() {
    const L = game.levels, p = game.player;
    if (!L) return null;
    const sup = (x: number, y: number, z: number) => { const s = L.supportAt(x, z, y + 0.05); return s ? {level: s.level, floor: +s.floor.toFixed(3), ceil: +s.ceil.toFixed(3), area: s.area} : null; };
    return {
      count: L.count,
      player: {y: +p.y.toFixed(3), support: sup(p.x, p.y, p.z), headroom: +(L.ceilingOver(p.x, p.z, p.radius, p.y) - p.y).toFixed(3)},
      zombies: game.zombies.map(z => ({y: +z.brain.y.toFixed(3), level: L.levelAt(z.brain.x, z.brain.z, z.brain.y + 0.05), state: z.brain.state})),
    };
  }
}
