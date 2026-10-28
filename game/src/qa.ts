// Test-automation hooks, installed ONLY with ?qa=1. They read state and aim the camera for
// scripted playtests (pointer lock cannot be granted to automated browsers). Inputs still go
// through real keyboard/mouse events; nothing here changes health, ammo or enemy behaviour.

import {isP7Kind, p7ModelKeysFor} from './gen/props07';
import * as THREE from 'three';
import type {Game} from './game';
import {itemDef} from './items/items';
import {killImpulseStrength} from './physics/world';
import {itemIconStats, itemIconUrl} from './ui/itemIcons';
import {traversalSummary} from './gen/traversal';
import {doorClearVolumes, doorwaySummary} from './gen/doorways';
import {compositionOf, compositionSummary} from './gen/compose';
import {CELL} from './gen/grid';
import {damageQaApi} from './damage/qa';
import {creatureQaApi} from './ai/creatureQa';
import {qaStandFree} from './world/shelfStock'; // Lane S: stand-point check of goStockedShelf

export function installQaHooks(game: Game): void {
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
        held: st ? {itemId: st.itemId, mag: st.mag ?? null, count: st.count} : null,
        weapon: {id: game.weapon.def?.id ?? null, phase: game.weapon.phase},
        hotbar: game.inv.hotbar.map(s => s && {itemId: s.itemId, count: s.count, mag: s.mag ?? null}),
        pack: game.inv.pack.map(s => s && {itemId: s.itemId, count: s.count}),
        ammo: {rifle: game.inv.count('ammo_rifle'), shells: game.inv.count('ammo_shells')},
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
        render: {...game.renderer.info.render},
        softwareGl: game.softwareGl, // iteration 08: software rasterizer detection (anisotropy cap)
        memory: {...game.renderer.info.memory},
        world: game.world?.stats, genMs: game.genMs,
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
        optic: {aimBlend: game.viewmodel.aimBlend, opticAim: game.viewmodel.opticAim, clarity: game.viewmodel.heldOptic?.clarity ?? null, eye: game.viewmodel.heldOptic?.eye.toArray() ?? null, reticleDir: game.viewmodel.heldOptic ? (game.viewmodel.heldOptic.lens.uniforms.uDir.value as THREE.Vector3).toArray() : null, crosshairHidden: document.getElementById('crosshair')?.style.visibility === 'hidden'},
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
    /** Iteration 06 (Lane F): volumetric atmosphere state (enabled/active, resolution, steps, shadow map, GPU/CPU ms). */
    atmosphere: () => game.atmosphere.debug(),
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
     * DEBUG ONLY (exception to the read-only rule above, for the ragdoll browser check): kill the
     * nearest living zombie as if shot from the player, with the rifle/shotgun kill impulse.
     */
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
  };
  (window as unknown as {__LL: typeof api}).__LL = api;

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
