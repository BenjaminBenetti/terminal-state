// Task office-overhaul-20261030 (lane INTERACT): walk-in toilet stalls (user feedback #13) — the stall is an openable loot holder
// (world/openablesSpec.ts toiletStall: the procedural cubicle as body, an inward-swinging hinged door, finite seeded loot in the
// toilet) and world/stalls.ts gives the cubicle its runtime collision / sight / hitscan. Real classes in Node: ContainerManager,
// OpenableSet, PropIndex + core/physics movement, Levels line of sight, the hitscan ray, run memory. Generation is untouched.
import {describe, expect, it} from 'vitest';
import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {installCanvasShim, ShimContext} from './helpers/canvas2d';
import {fakeEnvTextures, rowLayout} from './helpers/openablesFixture';
import {PROP_DEFS, type PropPlacement} from '../src/gen/props';
import {generateStation, type StationLayout} from '../src/gen/station';
import {levelsOf} from '../src/gen/levels';
import {PropIndex, moveCircle} from '../src/core/physics';
import {raycastWorld} from '../src/combat/hitscan';
import {createHolderState, isContainerKind, isLootHolderKind, HOLDER_LABEL} from '../src/items/loot';
import {holderSurfaces} from '../src/items/lootLayout';
import {Inventory} from '../src/items/inventory';
import {WorldMaterials} from '../src/world/materials';
import {shapeMaterial} from '../src/world/shapeMaterials';
import {ContainerManager, type Holder} from '../src/world/containers';
import {partLocalMatrix, setOpenableBodyModel} from '../src/world/openables';
import {OPENABLE_AUDIT, OPENABLE_CONTAINER_KINDS, openableSpec, type HingeMove} from '../src/world/openablesSpec';
import {STALL_DOOR, installStalls, leafSegment, stallLocal, stallQaApi, type StallSystem} from '../src/world/stalls';
import {captureHolders, applyHolders} from '../src/run/worldMemory';
import {buildWorld} from '../src/world/builder';
import {generateOfficeLevel} from '../src/gen/office/index';
import type {Game} from '../src/game';

installCanvasShim(false);
(ShimContext.prototype as unknown as {clip?: () => void}).clip ??= () => {};

const mats = new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
const settle = (cm: ContainerManager, s = 1, after?: () => void) => { for (let t = 0; t < s; t += 1 / 60) { cm.update(1 / 60, t); after?.(); } };
const lotsKey = (h: Holder) => JSON.stringify(h.state.lots.map(l => [l.id, l.itemId, l.count, l.part, +l.x.toFixed(4), +l.z.toFixed(4)]));
const STALL = 'toiletStall';
const spec = openableSpec(STALL)!;

const stations = new Map<number, StationLayout>();
const station = (seed: number) => { let l = stations.get(seed); if (!l) stations.set(seed, (l = generateStation(seed, {startWeapon: 'pistol'}))); return l; };
/** First seeds whose station has toilet stalls. */
function stallSeeds(n: number): number[] {
  const out: number[] = [];
  for (let seed = 1; out.length < n && seed < 60; seed++) if (station(seed).props.some(p => p.kind === STALL)) out.push(seed);
  return out;
}

/** A minimal Game shell (only what world/stalls.ts reads) around a built ContainerManager. */
function shell(layout: StationLayout) {
  const inv = new Inventory();
  const cm = new ContainerManager({}, mats, () => inv);
  cm.build(layout);
  const levels = levelsOf(layout);
  const toasts: string[] = [];
  const changed: [number, number][] = [];
  const sp = layout.playerSpawn;
  const g = {
    layout, levels, containers: cm, propIndex: new PropIndex(levels, layout.props),
    player: {x: sp.x, y: 0, z: sp.z, eye: 1.62, yaw: 0, pitch: 0, radius: 0.3},
    zombies: [] as {brain: {alive: boolean; x: number; y: number; z: number; stats: {radius: number}}}[],
    physics: {propsChanged: (x: number, z: number) => { changed.push([x, z]); }},
    hud: {toast: (t: string) => { toasts.push(t); }}, sfx: {denied() {}},
    containerTarget: null as unknown,
    sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[], frameHooks: [] as ((dt: number) => void)[],
    interactHandlers: [] as (() => boolean)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[], promptProviders: [] as (() => string | null)[],
    stalls: null as StallSystem | null,
  };
  const game = g as unknown as Game;
  g.stalls = installStalls(game);
  for (const h of g.sectionHooks) h.build?.(layout);
  const frame = () => { for (const f of g.frameHooks) f(1 / 60); };
  const tick = (s = 1) => settle(cm, s, frame);
  const world = (p: PropPlacement, lx: number, lz: number): [number, number] => {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return [p.x + lx * c + lz * s, p.z - lx * s + lz * c];
  };
  /** Walk a 0.3 m body from stall-local (ax, az) toward (bx, bz) with the live movement index; the reached stall-local point. */
  const walk = (p: PropPlacement, a: [number, number], b: [number, number]): [number, number] => {
    let [x, z] = world(p, ...a);
    const [tx, tz] = world(p, ...b);
    for (let i = 0; i < 120; i++) {
      const dx = tx - x, dz = tz - z, d = Math.hypot(dx, dz);
      if (d < 1e-3) break;
      const k = Math.min(0.05, d) / d;
      [x, z] = moveCircle(levels, g.propIndex, x, z, dx * k, dz * k, 0.3, p.y);
    }
    return stallLocal(p, x, z);
  };
  const place = (p: PropPlacement, lx: number, lz: number) => { [g.player.x, g.player.z] = world(p, lx, lz); g.player.y = p.y; };
  return {g, game, cm, inv, levels, toasts, changed, frame, tick, walk, place, world, sys: g.stalls!};
}
const stallHolders = (cm: ContainerManager) => cm.all.filter(h => h.kind === STALL);

describe('toilet stall spec: an openable container with an inward door; generation untouched', () => {
  it('is a container holder kind with one inward-swinging hinged door; the audit has no stall exception', () => {
    expect(OPENABLE_CONTAINER_KINDS).toContain(STALL);
    expect(isLootHolderKind(STALL) && isContainerKind(STALL)).toBe(true);
    expect(HOLDER_LABEL[STALL as 'toiletStall']).toBe('toilet stall');
    expect(OPENABLE_AUDIT.filter(e => e.kind === STALL).map(e => e.cls)).toEqual(['openable']);
    expect(spec.parts).toHaveLength(1);
    const door = spec.parts[0], mv = door.move as HingeMove;
    expect(mv.type).toBe('hinge');
    expect(mv.axis).toBe('y');
    expect(door.cavityHidden).toBe(true);
    // the free edge goes INTO the cubicle (-Z) and, fully open, stays between the partitions and clear of the toilet
    const pivot = new THREE.Vector3(...mv.pivot), m = new THREE.Matrix4();
    partLocalMatrix(door, pivot, mv.angle, m);
    const tip = new THREE.Vector3(0.445, 1, 0.78).applyMatrix4(m);
    expect(tip.z).toBeLessThan(0);
    for (const k of [0, 1, 2]) for (const [x, z] of leafSegment(mv.angle, k)) {
      expect(x).toBeGreaterThan(-0.5); expect(x).toBeLessThan(0.5);
      expect(x < -0.215 || z > -0.16, `leaf over the toilet at ${x.toFixed(3)},${z.toFixed(3)}`).toBe(true);
    }
    // the leaf model matches the collision leaf (hinge, length)
    expect(mv.pivot[0]).toBeCloseTo(STALL_DOOR.hingeX, 6);
    expect(mv.pivot[2]).toBeCloseTo(STALL_DOOR.hingeZ, 6);
    const leaf = door.boxes![0].b;
    expect(leaf[3] - mv.pivot[0]).toBeCloseTo(STALL_DOOR.length, 2);
  });

  it('generated stations: same stall placements / AABBs / masks after the stall runtime ran and was torn down', () => {
    for (const seed of stallSeeds(2)) {
      const fresh = generateStation(seed, {startWeapon: 'pistol'});
      const dump = (l: StationLayout) => JSON.stringify({
        props: l.props.filter(p => p.kind === STALL).map(p => [p.x, p.z, p.y, p.rot, p.hx, p.hz, p.h, p.blocksSight, p.level ?? 0]),
        masks: (l.levels ?? [{grid: l.grid}]).map(L => [Array.from(L.grid.blocked).join(''), Array.from(L.grid.sightBlocked).join('')]),
      });
      const before = dump(fresh);
      const s = shell(fresh);
      const h = stallHolders(s.cm)[0];
      s.cm.interact({container: h, t: 1, lot: null, part: 0});
      s.tick(0.8);
      s.place(h.prop, 0, 0.3);
      s.frame();
      for (const hk of s.g.sectionHooks) hk.teardown?.();
      expect(dump(fresh), `seed ${seed}`).toBe(before);
    }
  });
});

describe('holders: body + door drawn by the openables (not the builder); open / close; prompt', () => {
  it('every generated stall is an openable holder; body + closed door instanced; the world builder draws no stall', () => {
    const [seed] = stallSeeds(1);
    const l = station(seed);
    const n = l.props.filter(p => p.kind === STALL).length;
    expect(n).toBeGreaterThan(1);
    const cm = new ContainerManager({}, mats, () => new Inventory());
    cm.build(l);
    const hs = stallHolders(cm);
    expect(hs).toHaveLength(n);
    for (const h of hs) {
      expect(h.group).toBe('container');
      expect(h.open?.parts).toHaveLength(1);
      expect(Math.abs(h.open!.parts[0].amount), 'door opens at least 70°').toBeGreaterThanOrEqual(70 * Math.PI / 180 - 1e-6);
    }
    const names = cm.openables.group.children.map(o => o.name);
    expect(names).toContain(`container-body-${STALL}`);
    expect(names).toContain(`openable-closed-${STALL}`);
    expect(hs[0].open!.model.source).toMatch(/propShapes/);
    // the body is the procedural cubicle (partitions + porcelain toilet) without a door panel
    const bodyMats = new Set(hs[0].open!.model.body.map(q => q.mat));
    expect(bodyMats.has(shapeMaterial(mats, 'partition'))).toBe(true);
    expect(bodyMats.has(shapeMaterial(mats, 'porcelain'))).toBe(true);
    const w = buildWorld(l, mats, {});
    const drawn: string[] = [];
    w.group.traverse(o => { if (/toiletStall/.test(o.name)) drawn.push(o.name); });
    expect(drawn).toEqual([]);
  });

  it('[E] opens the door (animated swing), the revealed interior shows, [E] again closes it; the prompt names the stall door', () => {
    const cm = new ContainerManager({}, mats, () => new Inventory());
    cm.build(rowLayout([STALL, STALL], {gap: 0.02}));
    const h = stallHolders(cm)[0];
    expect(cm.prompt({container: h, t: 1, lot: null, part: 0})).toBe('<b>[E]</b> Open stall door');
    h.state.lots.length = 0; // an empty stall toggles open / closed
    cm.interact({container: h, t: 1, lot: null, part: 0});
    expect(h.state.parts![0]).toBe(true);
    settle(cm, 0.2);
    const mid = h.open!.parts[0].t;
    expect(mid).toBeGreaterThan(0.1); expect(mid).toBeLessThan(1);
    settle(cm, 0.6);
    expect(h.open!.parts[0].t).toBe(1);
    expect(h.open!.root).toBeTruthy();
    expect(h.open!.parts[0].inner.length).toBeGreaterThan(0); // toilet-roll holder; no liner box
    expect(h.open!.parts[0].inner.every(o => o.visible)).toBe(true);
    cm.interact({container: h, t: 1, lot: null, part: 0});
    expect(h.state.parts![0]).toBe(false);
    settle(cm, 0.6);
    expect(h.open!.parts[0].t).toBe(0);
  });

  it('a delivered company toilet replaces the boxed toilet (fake GLTF); without it the geometry fallback stays', async () => {
    const scene = new THREE.Group();
    const toiletMat = new THREE.MeshStandardMaterial({name: 'fake-toilet'});
    scene.add(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.8, 0.7).translate(0, 0.4, 0), toiletMat));
    setOpenableBodyModel('toilet', {scene} as unknown as GLTF);
    try {
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.build(rowLayout([STALL]));
      const m = stallHolders(cm)[0].open!.model;
      const bodyMats = new Set(m.body.map(q => q.mat));
      expect(bodyMats.has(toiletMat)).toBe(true);
      expect(bodyMats.has(shapeMaterial(mats, 'porcelain'))).toBe(false);
      expect(m.source).toMatch(/toilet model/);
      // fitted at the back of the stall, grounded, inside the cubicle
      const g = m.body.find(q => q.mat === toiletMat)!.geo;
      g.computeBoundingBox();
      const b = g.boundingBox!;
      expect(b.min.y).toBeCloseTo(0, 3);
      expect(b.min.z).toBeGreaterThanOrEqual(-0.8 - 1e-3);
      expect(b.max.z).toBeLessThan(0);
    } finally { setOpenableBodyModel('toilet', null); }
    const cm2 = new ContainerManager({}, mats, () => new Inventory());
    cm2.build(rowLayout([STALL]));
    expect(new Set(stallHolders(cm2)[0].open!.model.body.map(q => q.mat)).has(shapeMaterial(mats, 'porcelain'))).toBe(true);
    // the stall runtime's preload asks lane ASSETS' registry: not delivered (url null) -> the fallback
    const s = shell(rowLayout([STALL]));
    await Promise.all(s.g.sectionPreloads.map(f => f(s.g.layout)));
    expect(s.sys.toiletModel).toBe(false);
  });
});

describe('walk-in cubicle (world/stalls.ts): movement, door collision, sweep, sight, hitscan', () => {
  it('closed: a closed cubicle; open: the player steps in front of the toilet; partitions block sideways; the leaf collision follows the swing', () => {
    const s = shell(rowLayout([STALL, STALL, STALL], {gap: 0.02}));
    const [, h] = stallHolders(s.cm);
    h.state.lots.length = 0;
    const p = h.prop;
    expect(s.g.propIndex.props.includes(p)).toBe(false); // the stall AABBs left the movement index …
    expect(s.g.propIndex.props.filter(q => q.kind === STALL)).toHaveLength(3 * 7); // … for 7 collision boxes per stall
    // closed: stays outside the door
    const out = s.walk(p, [0, 1.6], [0, 0.2]);
    expect(out[1]).toBeGreaterThan(STALL_DOOR.hingeZ + 0.3 - 0.04);
    // open the door: the leaf boxes swing with it
    const leafZ = () => stallLocal(p, s.sys.stalls[1].leaf[2].x, s.sys.stalls[1].leaf[2].z)[1];
    const closedZ = leafZ();
    expect(closedZ).toBeCloseTo(STALL_DOOR.hingeZ, 1);
    s.cm.interact({container: h, t: 1, lot: null, part: 0});
    s.tick(0.25);
    const midZ = leafZ();
    expect(midZ).toBeLessThan(closedZ - 0.05);
    s.tick(0.7);
    expect(leafZ()).toBeLessThan(midZ);
    expect(stallLocal(p, s.sys.stalls[1].leaf[2].x, s.sys.stalls[1].leaf[2].z)[0]).toBeLessThan(-0.35); // along the left partition
    // open: walk in to the spot in front of the toilet
    const inside = s.walk(p, [0, 1.6], [0.02, 0.2]);
    expect(Math.hypot(inside[0] - 0.02, inside[1] - 0.2)).toBeLessThan(0.08);
    // partitions block sideways (both ways), the toilet blocks backwards
    expect(s.walk(p, [0.02, 0.3], [1.6, 0.3])[0]).toBeLessThan(0.5 - 0.03 - 0.3 + 0.02);
    expect(s.walk(p, [0.02, 0.3], [-1.6, 0.3])[0]).toBeGreaterThan(-0.47 + 0.3 - 0.02 - 0.03);
    expect(s.walk(p, [0.02, 0.3], [0.02, -1])[1]).toBeGreaterThan(-0.16 + 0.3 - 0.02);
    // the neighbours stay closed cubicles
    const [left] = stallHolders(s.cm);
    expect(s.walk(left.prop, [0, 1.6], [0, 0.2])[1]).toBeGreaterThan(STALL_DOOR.hingeZ + 0.3 - 0.04);
  });

  it('closing is refused while the player (or a zombie) stands in the door sweep; allowed from outside', () => {
    const s = shell(rowLayout([STALL], {gap: 0.02}));
    const [h] = stallHolders(s.cm);
    h.state.lots.length = 0;
    s.cm.interact({container: h, t: 1, lot: null, part: 0});
    s.tick(0.8);
    s.g.containerTarget = {container: h, t: 0.2, lot: null, part: 0};
    s.place(h.prop, 0.02, 0.3);
    expect(s.g.promptProviders[0]()).toMatch(/step out of the doorway/); // the HUD says so instead of "[E] Close stall door"
    expect(s.g.interactHandlers[0]()).toBe(true);
    expect(s.toasts.at(-1)).toMatch(/Step out of the doorway/);
    expect(h.state.parts![0]).toBe(true);
    s.place(h.prop, 0, 1.6);
    const [zx, zz] = s.world(h.prop, 0.05, 0.5);
    s.g.zombies.push({brain: {alive: true, x: zx, y: 0, z: zz, stats: {radius: 0.33}}});
    expect(s.g.interactHandlers[0]()).toBe(true);
    s.g.zombies.length = 0;
    expect(s.g.promptProviders[0]()).toBeNull();
    expect(s.g.interactHandlers[0]()).toBe(false); // the container interaction closes it
    s.cm.interact(s.g.containerTarget as never);
    expect(h.state.parts![0]).toBe(false);
    expect(s.sys.counts.refusedClose).toBe(2);
    // a lot target / another holder / a door with loot left (take, not close) is never intercepted
    s.g.containerTarget = {container: h, t: 0.2, lot: null, part: 0};
    expect(s.g.interactHandlers[0]()).toBe(false); // closed: [E] opens
  });

  it('generated washrooms: open stall cells are see-through (zombies see and reach a player inside), closed ones opaque; eye inside = no self-hit', () => {
    const [seed] = stallSeeds(1);
    const s = shell(station(seed));
    const st = s.sys.stalls.find(x => x.cells.length > 0)!;
    expect(st).toBeTruthy();
    const h = st.holder, p = h.prop, gr = st.grid!;
    h.state.lots.length = 0;
    const L = s.levels;
    const front = s.world(p, 0, 1.4), inside = s.world(p, 0.02, 0.3);
    const los = () => L.lineOfSight({x: front[0], y: p.y + 1.5, z: front[1]}, {x: inside[0], y: p.y + 1.5, z: inside[1]});
    expect(st.cells.every(i => gr.sightBlocked[i] === 1)).toBe(true);
    expect(los()).toBe(false);
    s.cm.interact({container: h, t: 1, lot: null, part: 0});
    s.tick(0.8);
    expect(st.cells.every(i => gr.sightBlocked[i] === 0)).toBe(true);
    expect(los()).toBe(true);
    // the player steps in: the stall's AABB stops catching their shots at t = 0 (and the physics chunk is rebuilt)
    s.place(p, 0.02, 0.3);
    s.frame();
    expect(p.h).toBe(0);
    expect(s.changed.length).toBeGreaterThan(0);
    const eye = {x: s.g.player.x, y: p.y + 1.62, z: s.g.player.z};
    const [ox, oz] = s.world(p, 0.02, 3), dir = new THREE.Vector3(ox - eye.x, 0, oz - eye.z).normalize();
    const hit = raycastWorld(L, s.g.layout.props, eye, dir, 1.2, s.g.layout.trench.floorY);
    expect(hit.kind === 'prop' && s.g.layout.props[hit.prop!] === p && hit.t < 0.01).toBe(false);
    s.place(p, 0, 1.6);
    s.frame();
    expect(p.h).toBe(PROP_DEFS.toiletStall.h);
    // closing (from outside) makes the cells opaque again once the door has shut
    s.cm.interact({container: h, t: 1, lot: null, part: 0});
    s.tick(0.8);
    expect(st.cells.every(i => gr.sightBlocked[i] === 1)).toBe(true);
    // the movement index of every storey holds the stall boxes (upper / lower storeys too)
    for (const x of s.sys.stalls) for (const b of x.boxes) expect(s.g.propIndex.near(b.x - 0.01, b.z - 0.01, b.x + 0.01, b.z + 0.01, new Set()).has(s.g.propIndex.props.indexOf(b))).toBe(true);
  });

  it('office tower: stalls on every storey are walk-in cubicles at their own height (boxes indexed, door + sight per storey)', () => {
    const l = generateOfficeLevel({levelSeed: 4242, startWeapon: 'pistol'});
    const s = shell(l);
    const levels = new Set(s.sys.stalls.map(x => x.prop.level ?? 0));
    process.stdout.write(`[stall-doors] office 4242: ${s.sys.stalls.length} stalls on storeys ${[...levels].sort((a, b) => a - b).join(',')}\n`);
    expect(s.sys.stalls.length).toBeGreaterThan(8);
    expect(levels.size).toBeGreaterThan(3);
    for (const x of s.sys.stalls) for (const b of x.boxes) expect(s.g.propIndex.near(b.x - 0.01, b.z - 0.01, b.x + 0.01, b.z + 0.01, new Set()).has(s.g.propIndex.props.indexOf(b)), `storey ${x.prop.level}`).toBe(true);
    const st = [...s.sys.stalls].sort((a, b) => (b.prop.level ?? 0) - (a.prop.level ?? 0))[0];
    const h = st.holder;
    h.state.lots.length = 0;
    expect(s.walk(st.prop, [0, 1.6], [0, 0.2])[1]).toBeGreaterThan(STALL_DOOR.hingeZ + 0.3 - 0.04);
    s.cm.interact({container: h, t: 1, lot: null, part: 0});
    s.tick(0.8);
    const inside = s.walk(st.prop, [0, 1.6], [0.02, 0.2]);
    expect(Math.hypot(inside[0] - 0.02, inside[1] - 0.2)).toBeLessThan(0.08);
    // the same x / z on the storey below is untouched (a stall there keeps its own door / sight / AABB)
    s.place(st.prop, 0.02, 0.3);
    s.frame();
    expect(st.prop.h).toBe(0);
    for (const o of s.sys.stalls) if (o !== st) expect(o.prop.h, `storey ${o.prop.level}`).toBe(PROP_DEFS.toiletStall.h);
  });

  it('QA hooks: stalls(), stallOpen(), stallEnter() drive the same paths', () => {
    const s = shell(rowLayout([STALL, STALL], {gap: 0.02}));
    const qa = stallQaApi(s.game);
    const list = qa.stalls() as {index: number; open: boolean}[];
    expect(list).toHaveLength(2);
    expect(qa.stallEnter(0)).toBeNull(); // closed
    expect(qa.stallOpen(0)).toBe(true);
    s.tick(0.8);
    expect(qa.stallEnter(0)).toBe(true);
    s.frame();
    expect((qa.stalls() as {playerInside: boolean}[])[0].playerInside).toBe(true);
  });
});

describe('toilet loot: sometimes something, rolled once, finite, remembered', () => {
  it('about a third of stalls hold something (washroom, iteration-12 scarcity); only consumables / ammo / light finds', () => {
    const surfaces = holderSurfaces(STALL as never, PROP_DEFS.toiletStall);
    expect(surfaces.length).toBe(2);
    let n = 0, withLoot = 0;
    const comp: Record<string, number> = {};
    for (let seed = 1; seed <= 60; seed++) for (let index = 0; index < 8; index++) {
      const st = createHolderState(seed * 7919 + 13, index, STALL as never, 'washroom', surfaces);
      n++;
      if (st.lots.length) withLoot++;
      for (const l of st.lots) comp[l.itemId] = (comp[l.itemId] ?? 0) + 1;
      for (const l of st.lots) expect(l.part).toBe(0);
    }
    const share = withLoot / n;
    process.stdout.write(`\n[stall-doors] stalls with loot ${withLoot}/${n} = ${(share * 100).toFixed(1)} %; finds ${JSON.stringify(comp)}\n`);
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.4);
    for (const id of Object.keys(comp)) expect(/^(water|cola|juice|chocolate|chips|beans|noodles|bandage|medkit|leg_splint|arm_sling|trauma_kit|ammo_\w+|battery|flare)$/.test(id), id).toBe(true);
    // in generated stations too (real placement / purpose keys)
    let gs = 0, gl = 0;
    for (const seed of stallSeeds(4)) {
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.build(station(seed));
      for (const h of stallHolders(cm)) { gs++; if (h.state.lots.length) gl++; }
    }
    process.stdout.write(`[stall-doors] generated stations: ${gl}/${gs} stalls with loot\n`);
    expect(gs).toBeGreaterThan(8);
  });

  it('same lots on a rebuild; open / close never adds; a taken lot stays taken through run memory', () => {
    const seeds = stallSeeds(6);
    let layout: StationLayout | null = null;
    for (const seed of seeds) {
      const cm = new ContainerManager({}, mats, () => new Inventory());
      cm.build(station(seed));
      if (stallHolders(cm).some(h => h.state.lots.length)) { layout = station(seed); break; }
    }
    expect(layout).toBeTruthy();
    const inv = new Inventory();
    const a = new ContainerManager({}, mats, () => inv);
    a.build(layout!);
    const b = new ContainerManager({}, mats, () => new Inventory());
    b.build(layout!);
    expect(stallHolders(a).map(lotsKey)).toEqual(stallHolders(b).map(lotsKey));
    const h = stallHolders(a).find(x => x.state.lots.length)!;
    const before = lotsKey(h);
    // open: the first-open toast lists what is inside; lots stay
    a.interact({container: h, t: 1, lot: null, part: 0});
    settle(a, 0.8);
    expect(lotsKey(h)).toBe(before);
    // take one lot by aiming at it
    const lot = h.state.lots[0];
    a.interact({container: h, t: 1, lot, part: 0});
    expect(h.state.lots.includes(lot)).toBe(false);
    expect(inv.count(lot.itemId)).toBeGreaterThan(0);
    const left = lotsKey(h);
    // close / reopen: nothing comes back
    if (!h.state.lots.length) { a.interact({container: h, t: 1, lot: null, part: 0}); settle(a, 0.8); a.interact({container: h, t: 1, lot: null, part: 0}); }
    expect(lotsKey(h)).toBe(left);
    // leave + come back (run memory): the taken lot stays taken, the rest is exactly there
    const mem = captureHolders(a);
    const c = new ContainerManager({}, mats, () => new Inventory());
    c.build(layout!);
    applyHolders(c, mem);
    const back = stallHolders(c).find(x => x.prop.x === h.prop.x && x.prop.z === h.prop.z)!;
    expect(lotsKey(back)).toBe(left);
  });
});
