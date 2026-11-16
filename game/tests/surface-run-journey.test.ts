// Task studio-surface-run-opus-rebuild-20261116-020827-01 (lane ACCESS): the SURFACE RUN crossing end to end on the REAL Game in Node
// (src/game.ts: every lane, the asset boot, the campaign lifecycle, the warm-up) over three r186's WebGPURenderer on the validating no-op
// device (helpers/headlessGame.ts, helpers/validatingWebgpu.ts).
//  1. A new campaign at a Subway station whose Surface Run roll is present: the player starts in the parked train, the station records
//     version 1 and has its stairwell (the hall's grille block hidden, the street door drawn).
//  2. [E] at the stairwell's door -> the loading screen -> the district (layout.surface): no train, the train record still parked at the
//     station, the station's resources released, the player at the portal.
//  3. Persistent action in the district: take an item, kill a zombie (both injected into the district's layout by the test: the district
//     generator's own loot / enemies are lane GEN's, so the test does not depend on them).
//  4. [E] at the portal -> back in the station: its world exact (layout, loose items, kills), the train and its equipment / Lockbox / fuel
//     exact, the inventory = before + what was taken, nothing of the district left (objects, resources, frame hooks).
//  5. Save in the train -> Main menu -> Continue (the run decoded from storage) -> up again: the district as it was left. Dying there
//     -> Retry: back in the train at the station, the station's access kept, the district as it was when the station was entered.
//  6. A station entered BEFORE the feature (its memory has visits but no 'surface.run' record: the stored save edited that way) builds at
//     version 0: no access, its world the plain generated one.
// A capture taken in the district saves the station's own section with a 'start' arrival and validates.
import {afterAll, describe, expect, it, vi} from 'vitest';
import * as THREE from 'three';
import {installHeadless} from './helpers/headlessGame';
import {generateNetwork} from '../src/campaign/network';
import {SURFACE_LANE, SURFACE_VERSION, surfacePresent} from '../src/gen/surface/surfaceRun';
import {LEVELS} from '../src/levels/registry';
import type {StationLayout} from '../src/gen/stationTypes';
import type {SectionKey} from '../src/levels/types';
import {checksumOf} from '../src/save/checksum';
import {validateSaveFile} from '../src/save/validate';

afterAll(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The first network seed whose first Subway node rolls a Surface Run (a dev start at 'subway' picks that node). */
function pickNetwork(): {seed: number; station: string; levelSeed: number} {
  for (let seed = 1; seed < 500; seed++) {
    const n = generateNetwork(seed).nodes.find(x => x.archetype === 'subway');
    if (n && surfacePresent('subway', n.levelSeed, SURFACE_VERSION)) return {seed, station: n.id, levelSeed: n.levelSeed};
  }
  throw new Error('no network with a Surface Run subway station');
}

/** A clear walkable spot on level 0 between r0 and r1 m from `c`, away from `avoid` (+1 m). */
function spot(L: StationLayout, c: {x: number; z: number}, r0: number, r1: number, avoid: {x0: number; z0: number; x1: number; z1: number}) {
  const g = L.grid;
  for (let r = r0; r <= r1; r += 0.5) for (let k = 0; k < 24; k++) {
    const a = (k / 24) * Math.PI * 2, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    if (x > avoid.x0 - 1 && x < avoid.x1 + 1 && z > avoid.z0 - 1 && z < avoid.z1 + 1) continue;
    const [cx, cy] = g.cellOf(x, z);
    if (!g.inBounds(cx, cy) || !g.walkable(cx, cy) || !g.circleClear(x, z, 0.6)) continue;
    return {x, z, y: g.floorAt(x, z), area: g.area[g.idx(cx, cy)]};
  }
  return null;
}

interface Inst { mesh: THREE.InstancedMesh; index: number }
interface Priv {
  interact(): void;
  saveSectionMemory(): void;
  currentTarget: unknown;
  layoutPickup: Map<unknown, number>;
  enemyIndex: Map<unknown, number>;
  damage: {props: {index: {inst: Map<unknown, Inst[]>}}};
  trainRuntime: {train: {view: {root: THREE.Object3D}; layoutBoxes: unknown[]} | null; playerInside(): boolean};
  sectionGenInputs(key: SectionKey, run: unknown): {ctx: Record<string, unknown>};
}

/**
 * A memory compared as poses: numbers to 1e-6 (and -0 = 0), a rotation quaternion `q` and its negation are the same rotation (a
 * rebuilt item's captured pose may come back as either).
 */
function canon(v: unknown, key = ''): unknown {
  if (typeof v === 'number') { const r = Math.round(v * 1e6) / 1e6; return r === 0 ? 0 : r; }
  if (Array.isArray(v)) {
    let a = v;
    if (key === 'q' && a.length === 4 && a.every(x => typeof x === 'number')) {
      const lead = (a as number[]).find(x => Math.abs(x) > 1e-9) ?? 0;
      const w = Math.abs(a[3] as number) > 1e-9 ? a[3] as number : lead;
      if (w < 0) a = (a as number[]).map(x => -x);
    }
    return a.map(x => canon(x));
  }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, canon(x, k)]));
  return v;
}

const countsOf = (inv: {hotbar: ({itemId: string; count: number} | null)[]; pack: ({itemId: string; count: number} | null)[]}) => {
  const m: Record<string, number> = {};
  for (const s of [...inv.hotbar, ...inv.pack]) if (s) m[s.itemId] = (m[s.itemId] ?? 0) + s.count;
  return m;
};

describe('Surface Run: station -> district -> station -> save -> Continue -> district (real Game, validating device)', () => {
  it('crosses both ways behind the loading screen; both worlds and the train exact; the district persists through a save', async () => {
    const T0 = performance.now(), marks: string[] = [];
    const mark = (s: string) => marks.push(`${s} ${((performance.now() - T0) / 1000).toFixed(1)} s`);
    const quiet = () => {};
    for (const k of ['log', 'info', 'debug', 'warn'] as const) vi.spyOn(console, k).mockImplementation(quiet);
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 400)); });

    const pick = pickNetwork();
    const hostKey: SectionKey = {level: 'subway', section: 'main', station: pick.station};
    const surfKey: SectionKey = {level: 'subway', section: 'surface', station: pick.station};
    // the district's layout gets one item and one zombie near its portal (appended: the generator's own indices are untouched)
    const injected = {pickup: -1, zombie: -1, item: 'bandage', count: 2};
    const generate = LEVELS.subway.generate;
    LEVELS.subway.generate = (section, ctx) => {
      const L = generate(section, ctx);
      if (section === 'surface' && L.surface) {
        const p = L.surface.portal, a = spot(L, p.pose, 3, 12, p.trigger), b = spot(L, p.pose, 9, 30, p.trigger);
        if (a) { injected.pickup = L.pickups.length; L.pickups.push({itemId: injected.item, count: injected.count, x: a.x, y: a.y, z: a.z, area: a.area, level: 0}); }
        if (b) { injected.zombie = L.zombies.length; L.zombies.push({x: b.x, z: b.z, yaw: 0, type: 'shambler', area: b.area, level: 0, y: b.y}); }
      }
      return L;
    };
    const h = installHeadless();
    try {
      const {Game} = await import('../src/game');
      const {installQaHooks} = await import('../src/qa');
      const {surfaceAccessOf} = await import('../src/world/surface/accessRuntime');
      const game = new Game(h.canvas, false);
      const G = game as unknown as Priv;
      installQaHooks(game);
      const qa = (globalThis as unknown as {__LL: {
        surface: {go(): boolean; access(): {prompt: string | null}; state(): {scene: {district: number; accessDoorMeshes: number}; resources: Record<string, {textures: number; owned: number}>; frameHooks: number}};
        teleport(x: number, z: number, yaw?: number, level?: number): boolean; lookAt(x: number, y: number, z: number): void; trainGo(w: string): boolean;
      }}).__LL;
      const frameErrors: string[] = [];
      const loop = (t: number) => { try { game.frame(t); } catch (err) { frameErrors.push(String((err as Error)?.stack ?? err).slice(0, 400)); } requestAnimationFrame(loop); };
      const states: string[] = [];
      game.stateListeners.push(s => { states.push(s); });
      game.applySettings();
      game.setState('title');
      requestAnimationFrame(loop);
      await game.initRenderer();
      await game.load(() => {});
      const until = async (f: () => boolean, max = 8000) => { for (let i = 0; i < max && !f(); i++) await h.waitFrames(1); return f(); };
      const press = async () => { G.interact(); await h.waitFrames(1); };
      mark('boot');

      // ---- 1. new campaign at the Surface Run station: in the train, version 1, the stairwell --------------------------------------
      expect(await game.newCampaign(1, {overwrite: true, networkSeed: pick.seed, dev: {level: 'subway'}})).toMatchObject({ok: true, saved: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('new game');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'a new game starts in the parked train').toBe(true);
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: SURFACE_VERSION});
      const acc = game.layout.surfaceAccess!;
      expect(acc.kind).toBe('subway-stair');
      const grille = game.layout.props.find(p => p.kind === 'exitStair' && p.area === acc.hall)!;
      expect(grille).toMatchObject({cargoGone: true, h: 0, blocksSight: false});
      const inst = G.damage.props.index.inst.get(grille) ?? [];
      expect(inst.length, 'the hall\'s grille block is drawn by shared instances').toBeGreaterThan(0);
      const m = new THREE.Matrix4();
      for (const e of inst) { e.mesh.getMatrixAt(e.index, m); expect([m.elements[0], m.elements[5], m.elements[10]], 'its instances are hidden').toEqual([0, 0, 0]); }
      expect(qa.surface.state().scene.accessDoorMeshes, 'the street door is drawn').toBeGreaterThan(0);
      // refused from a menu (the [E] itself needs the door: below)
      game.setState('paused');
      expect(await game.crossSurface()).toMatchObject({ok: false, reason: 'not-playing'});
      await game.enterPlay(); // (Resume: the pointer captured again)
      expect(await until(() => game.state === 'playing', 300)).toBe(true);
      await h.waitFrames(60); // (loose items settle)

      // the station's state, the train, the inventory, the hooks, before the [E] crossing
      const ownProps = (L: StationLayout) => { const boxes = new Set<unknown>(G.trainRuntime.train?.layoutBoxes ?? []); return L.props.filter(p => !boxes.has(p) && !p.cargo); };
      const snapHost = () => {
        G.saveSectionMemory();
        const mem = canon(game.run.peekMemory(hostKey)!) as {pickups: unknown; holders: unknown; killed: unknown; cleared: unknown};
        const L = game.layout;
        return {
          mem: {pickups: mem.pickups, holders: mem.holders, killed: mem.killed, cleared: mem.cleared},
          areas: L.areas.map(a => `${a.id}:${a.type}:${a.label}:${a.x},${a.y},${a.w},${a.h}`),
          props: ownProps(L).map(p => `${p.kind}@${p.x.toFixed(3)},${p.z.toFixed(3)},${p.y.toFixed(3)}:${p.h.toFixed(3)}:${!!p.cargoGone}`),
          signs: L.signs.map(s => s.text), cells: Array.from(L.grid.cells).join(''), access: structuredClone(L.surfaceAccess),
          alive: game.zombies.filter(z => z.brain.alive).length,
        };
      };
      const host0 = snapHost();
      const train0 = JSON.stringify(game.playerTrain.participant().save());
      const inv0 = countsOf(game.inv);
      const hooks0 = game.frameHooks.length;
      const res0 = qa.surface.state().resources;
      const trainRoot = G.trainRuntime.train!.view.root;
      expect(trainRoot.parent).not.toBeNull();

      // ---- 2. [E] at the stairwell's door -> the district ------------------------------------------------------------------------
      const c0 = {...game.lifecycleCounts}, s0 = states.length, done0 = game.surfaceCrossCounts.done;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(surfaceAccessOf(game)!.aimed).toBe(true);
      expect(qa.surface.access().prompt).toBe('<b>[E]</b> Go up to the street');
      await press();
      expect(await until(() => game.surfaceCrossCounts.done === done0 + 1 && game.state === 'playing')).toBe(true);
      mark('[E] up');
      expect(states.slice(s0), 'the loading screen, then play').toEqual(['loading', 'playing']);
      expect(game.lifecycleCounts.loading - c0.loading).toBe(1);
      expect(game.lifecycleCounts.leave - c0.leave).toBe(1);
      expect(game.lifecycleCounts.build - c0.build).toBe(1);
      expect(game.lifecycleCounts.warmup - c0.warmup).toBeGreaterThanOrEqual(1);
      expect(game.run.current).toEqual(surfKey);
      expect(game.layout.surface).toBeTruthy();
      expect(game.trainPlacement, 'no train in the district').toBeNull();
      expect(G.trainRuntime.train).toBeNull();
      expect(trainRoot.parent, 'the car is not in the district\'s scene').toBeNull();
      expect(game.playerTrain.state.at, 'the train stays parked at the station (its record: level + section)').toEqual({level: 'subway', section: 'main'});
      const res1 = qa.surface.state().resources;
      marks.push(`resources: station ${JSON.stringify(res0)} district ${JSON.stringify(res1)}`);
      expect(res1.subway?.owned ?? 0, `the station's own resources released: ${JSON.stringify(res1)}`).toBe(0);
      expect(res1.subway?.textures ?? 0).toBe(0);
      const pose = game.layout.surface!.portal.pose;
      expect(Math.hypot(game.player.x - pose.x, game.player.z - pose.z), 'at the portal').toBeLessThan(0.75);
      expect(game.openTravelMap('travel'), 'no travel map from the district').toBe(false);
      expect(await game.travelToStation(game.run.campaign!.current)).toMatchObject({ok: false});
      // a capture here resumes in the train at the station (and validates)
      const cap = game.captureSave('manual', {slot: 1});
      expect(cap.run.section).toBe('main');
      expect(cap.run.arrival).toBe('start');
      expect(Object.keys(cap.run.memories)).toContain(`${pick.station}:surface`);
      expect(validateSaveFile(cap).ok, 'a save captured in the district validates').toBe(true);

      // ---- 3. persistent action: take the item, kill the zombie ------------------------------------------------------------------
      expect(injected.pickup).toBeGreaterThanOrEqual(0);
      expect(injected.zombie).toBeGreaterThanOrEqual(0);
      const pk = game.pickups.list.find(p => G.layoutPickup.get(p) === injected.pickup) as {x: number; y: number; z: number} | undefined;
      expect(pk, 'the district item is lying there').toBeTruthy();
      const zb = game.zombies.find(z => G.enemyIndex.get(z) === injected.zombie);
      expect(zb?.brain.alive, 'the district zombie is up').toBe(true);
      zb!.brain.damage(zb!.brain.hp + 1, game.player.x, game.player.z);
      await h.waitFrames(10);
      expect(zb!.brain.alive).toBe(false);
      const dir = Math.atan2(pk!.z - game.player.z, pk!.x - game.player.x);
      expect(qa.teleport(pk!.x - Math.cos(dir) * 0.9, pk!.z - Math.sin(dir) * 0.9)).toBe(true);
      qa.lookAt(pk!.x, pk!.y + 0.03, pk!.z);
      expect(await until(() => G.currentTarget === pk, 30), 'the item under the crosshair').toBe(true);
      await press();
      expect(game.pickups.list.includes(pk as never), 'taken').toBe(false);
      expect(countsOf(game.inv)[injected.item] ?? 0).toBe((inv0[injected.item] ?? 0) + injected.count);
      await h.waitFrames(30);
      mark('district action');

      // ---- 4. [E] at the portal -> back in the station, exact ---------------------------------------------------------------------
      const done1 = game.surfaceCrossCounts.done;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      expect(qa.surface.access().prompt).toBe(`<b>[E]</b> Back down to ${game.run.node(pick.station)!.name}`);
      await press();
      expect(await until(() => game.surfaceCrossCounts.done === done1 + 1 && game.state === 'playing')).toBe(true);
      mark('[E] down');
      expect(game.run.current).toEqual(hostKey);
      const back = game.layout.surfaceAccess!.returnPose;
      expect(Math.hypot(game.player.x - back.x, game.player.z - back.z), 'at the stairwell door').toBeLessThan(0.75);
      await h.waitFrames(20);
      expect(snapHost(), 'the station exactly as it was left').toEqual(host0);
      expect(JSON.stringify(game.playerTrain.participant().save()), 'the train, its Lockbox, fuel and equipment exact').toBe(train0);
      expect(G.trainRuntime.train, 'the car is back').not.toBeNull();
      expect({...countsOf(game.inv), [injected.item]: inv0[injected.item] ?? 0}).toEqual({...inv0, [injected.item]: inv0[injected.item] ?? 0});
      const st4 = qa.surface.state();
      expect(st4.scene.district, 'nothing of the district in the scene').toBe(0);
      marks.push(`resources back: ${JSON.stringify(st4.resources)}`);
      expect(st4.resources.surface?.owned ?? 0, `no district resources: ${JSON.stringify(st4.resources)}`).toBe(0);
      expect(st4.resources.surface?.textures ?? 0).toBe(0);
      expect(st4.resources, 'the station\'s resources are back as they were').toEqual(res0);
      expect(st4.frameHooks, 'no frame hook left over').toBe(hooks0);
      const dmem = structuredClone(game.run.peekMemory(surfKey)!);
      expect(dmem.killed).toContain(injected.zombie);
      expect((dmem.pickups ?? []).some(r => r.layoutIndex === injected.pickup), 'the taken item is not in the district memory').toBe(false);

      // ---- 5. save in the train -> Main menu -> Continue -> up again: the district as it was left ---------------------------------
      expect(qa.trainGo('spawn')).toBe(true);
      await h.waitFrames(3);
      expect(game.saveNow()).toMatchObject({ok: true});
      const dmemSaved = structuredClone(game.run.peekMemory(surfKey)!);
      game.setState('paused');
      game.returnToMenu();
      await h.waitFrames(5);
      expect(await game.continueCampaign(1)).toEqual({ok: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('continue');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'Continue resumes in the train').toBe(true);
      expect(game.run.peekMemory(surfKey), 'the district memory came back from the save exactly').toEqual(dmemSaved);
      expect(game.layout.surfaceAccess).toEqual(host0.access);
      const done2 = game.surfaceCrossCounts.done;
      expect(qa.surface.go()).toBe(true);
      await h.waitFrames(2);
      await press();
      expect(await until(() => game.surfaceCrossCounts.done === done2 + 1 && game.state === 'playing')).toBe(true);
      mark('[E] up after Continue');
      expect(game.run.current).toEqual(surfKey);
      expect(game.pickups.list.some(p => G.layoutPickup.get(p) === injected.pickup), 'the taken item stays taken').toBe(false);
      expect(game.zombies.some(z => G.enemyIndex.get(z) === injected.zombie && z.brain.alive), 'the killed zombie stays dead').toBe(false);

      // ---- Retry after dying in the district: back in the train at the station, both worlds as the station was entered ----------
      (game.player as unknown as {takeDamage(n: number): void}).takeDamage(1e6);
      expect(await until(() => game.state === 'dead', 300)).toBe(true);
      await h.waitFrames(10);
      await game.retryLevel();
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('retry');
      expect(game.run.current).toEqual(hostKey);
      expect(G.trainRuntime.playerInside(), 'Retry resumes in the train').toBe(true);
      expect(game.layout.surfaceAccess, 'the station keeps its access').toEqual(host0.access);
      expect(game.run.laneStore(SURFACE_LANE, hostKey)).toEqual({v: SURFACE_VERSION});
      expect(game.run.peekMemory(surfKey), 'the district as it was when the station was entered (never visited)').toBeUndefined();

      // ---- 6. a station entered before the feature: version 0, no access ---------------------------------------------------------
      game.setState('paused');
      game.returnToMenu();
      await h.waitFrames(5);
      const raw = game.saves.read(1);
      expect(raw.ok).toBe(true);
      const file = structuredClone((raw as {file: {run: {memories: Record<string, {visits: number; lanes: Record<string, unknown>}>; entry?: {memories: Record<string, {lanes: Record<string, unknown>}>} | null}; checksum: string}}).file);
      const hostId = `${pick.station}:main`;
      expect(file.run.memories[hostId].visits).toBeGreaterThan(0);
      for (const ms of [file.run.memories, file.run.entry?.memories ?? {}]) {
        if (ms[hostId]) delete ms[hostId].lanes[SURFACE_LANE];
        delete ms[`${pick.station}:surface`];
      }
      file.checksum = checksumOf(file.run);
      expect(game.saves.commit(1, file as never, {overwrite: true})).toMatchObject({ok: true});
      expect(await game.continueCampaign(1)).toEqual({ok: true});
      expect(await until(() => game.state === 'playing')).toBe(true);
      mark('legacy continue');
      expect(game.run.current).toEqual(hostKey);
      expect(game.layout.surfaceAccess, 'a station entered before the feature has no access').toBeUndefined();
      expect(game.run.laneStore(SURFACE_LANE, hostKey), 'and keeps version 0').toEqual({v: 0});
      expect(surfaceAccessOf(game)!.way).toBeNull();
      expect(qa.surface.state().scene.accessDoorMeshes).toBe(0);
      expect(await game.crossSurface()).toMatchObject({ok: false, reason: 'no-access'});
      const {ctx} = G.sectionGenInputs(hostKey, game.run);
      const plain = LEVELS.subway.generate('main', {...ctx, surfaceVersion: undefined} as never);
      expect(game.layout.areas.length).toBe(plain.areas.length);
      expect(ownProps(game.layout).length).toBe(plain.props.length);
      expect(game.layout.props.some(p => p.kind === 'exitStair' && p.cargoGone)).toBe(false);
      expect(Array.from(game.layout.grid.cells).join('')).toBe(Array.from(plain.grid.cells).join(''));

      expect(frameErrors).toEqual([]);
      expect(errors).toEqual([]);
      expect(h.log.dropped, 'no dropped submit').toBe(0);
    } finally {
      LEVELS.subway.generate = generate;
      h.stop();
      process.stdout.write(`surface-run-journey: ${marks.join(' | ')}\n`);
    }
  }, 600_000);
});
