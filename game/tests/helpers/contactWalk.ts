// Task office-props-physics-scale-20261030 (lane PHYS): a REAL Player (the game's own movement + prop collision, core/physics.ts
// PropIndex) walks into a prop with the W key while the physics system steps beside it exactly as game.ts wires it (the player
// is the `wake` walker, its id the Player object). No shot, no aim ray: the DamageSystem is not even constructed. The render
// side is the real PropDamage over the real built world (procedural / box stand-ins without models), so detaching, hiding the
// shared instance and re-attaching it are the game's own code.
import * as THREE from 'three';
import {Player} from '../../src/player/player';
import {PropIndex} from '../../src/core/physics';
import {CELL} from '../../src/gen/grid';
import {levelsOf, type Levels} from '../../src/gen/levels';
import type {PropPlacement} from '../../src/gen/props';
import type {StationLayout} from '../../src/gen/stationTypes';
import {PhysicsSystem} from '../../src/physics/world';
import type {Walker} from '../../src/physics/dynamicItems';
import {PropDamage} from '../../src/damage/propDamage';
import {buildWorld, type BuiltWorld} from '../../src/world/builder';
import {WorldMaterials} from '../../src/world/materials';
import {fakeEnvTextures} from './openablesFixture';
import {isP7Kind, p7ModelKey} from '../../src/gen/props07';
import {officeKindAsset, officeModelKey, isOfficeKind} from '../../src/gen/office/kinds';
import {dynamicKind} from '../../src/physics/dynamicItems';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {ContainerManager, type ContainerEvent} from '../../src/world/containers';
import {PickupManager} from '../../src/world/pickups';
import {Inventory} from '../../src/items/inventory';
import {lootProfile} from '../../src/items/lootTables';
import type {LevelId} from '../../src/levels/types';

export const DT = 1 / 60;

export class Keys {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

export interface ContactRig {
  layout: StationLayout;
  L: Levels;
  index: PropIndex;
  ph: PhysicsSystem;
  pd: PropDamage;
  world: BuiltWorld;
  player: Player;
  keys: Keys;
  /** Extra AI walkers (zombies) shoving / waking beside the player. */
  others: Walker[];
  /** With `containers`: the loot holders + world pickups, wired exactly as game.ts buildSection does (spill -> pickups). */
  cm?: ContainerManager;
  pickups?: PickupManager;
  events?: ContainerEvent[];
}

let mats: WorldMaterials | null = null;

/**
 * Stand-in "Meshy" models (a body + a back panel, named materials) for every dynamic iteration-07 / office kind of the layout:
 * the game only renders those kinds from their lazy models (an unloaded p7 kind is dropped), so without one there is nothing to
 * detach. Shared geometry / materials per kind, like the real instanced models.
 */
export function standInModels(layout: {props: readonly PropPlacement[]}): Record<string, GLTF> {
  const lib: Record<string, GLTF> = {};
  const tex = new THREE.Texture();
  for (const k of new Set(layout.props.map(p => p.kind))) {
    if (!dynamicKind(k)) continue;
    const key = isP7Kind(k) ? p7ModelKey(k) : isOfficeKind(k) && officeKindAsset(k) ? officeModelKey(officeKindAsset(k)!) : null;
    if (!key || lib[key]) continue;
    const scene = new THREE.Group();
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), new THREE.MeshStandardMaterial({name: `${k}-body`, map: tex}));
    a.position.y = 0.25;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.1), new THREE.MeshStandardMaterial({name: `${k}-back`, color: 0x223344}));
    b.position.set(0, 0.75, -0.25);
    scene.add(a, b);
    scene.updateMatrixWorld(true);
    lib[key] = {scene} as unknown as GLTF;
  }
  return lib;
}

/**
 * The layout's physics + render + a real Player (not yet placed). The layout's props are used in place (copy them first).
 * `containers` (task office-props-physics-scale-20261030 follow-up): + the real ContainerManager (loot rolled under the level's
 * profile, holders' own meshes for the damage system, holder shelves for item collision) and PickupManager, with the game's spill
 * hook — a knocked-loose spill holder's lots become pickups of the same item / count / lot id (game.ts onContainerEvent).
 */
export function contactRig(layout: StationLayout, o: {containers?: LevelId} = {}): ContactRig {
  mats ??= new WorldMaterials(fakeEnvTextures(), 7, {w: 1.2, h: 0.19, d: 0.17});
  const L = levelsOf(layout);
  const index = new PropIndex(L, layout.props);
  const world = buildWorld(layout, mats, standInModels(layout));
  const pd = new PropDamage();
  const ph = new PhysicsSystem(null);
  ph.build(layout);
  let cm: ContainerManager | undefined, pickups: PickupManager | undefined;
  const events: ContainerEvent[] = [];
  if (o.containers) {
    const inv = new Inventory();
    cm = new ContainerManager({}, mats, () => inv);
    pickups = new PickupManager({});
    const pk = pickups;
    cm.onEvent = e => {
      events.push(e);
      if (e.type !== 'spill') return;
      for (const sp of e.spilled ?? []) {
        const st = inv.makeStack(sp.lot.itemId, sp.lot.count);
        st.count = sp.lot.count;
        pk.addAt(st, sp.matrix, {holder: e.container.serial, lot: sp.lot.id});
      }
    };
    cm.build(layout, {}, lootProfile(o.containers));
    const c = cm;
    ph.holderBoxes = p => c.physicsBoxes(p);
    ph.dynamicItems.holderLoose = p => c.goLoose(p);
    ph.dynamicItems.pickups = () => pk.list;
    pd.build(layout.props, [world.group, cm.group]);
    pd.hooks = {ownMeshes: p => c.ownMeshes(p)};
  } else pd.build(layout.props, [world.group]);
  ph.dynamicItems.detacher = pd;
  const player = new Player();
  const rig: ContactRig = {layout, L, index, ph, pd, world, player, keys: new Keys(), others: [], ...(cm ? {cm, pickups, events} : {})};
  ph.dynamicItems.walkers = () => [{id: player, x: player.x, z: player.z, y: player.y, r: player.radius, wake: true}, ...rig.others];
  return rig;
}

/**
 * A stand point `dist` m (+ the player radius) off one face of `prop`, facing it, whose corridor (player-wide, from the face
 * out to the stand point, and `behind` m beyond the prop for the shove) is free floor of the prop's storey with no other prop box
 * in the way. Axis directions only, in the prop frame order front / back / sides. null: no free side.
 */
export function approach(rig: ContactRig, prop: PropPlacement, dist = 1.0, behind = 0.8): {x: number; z: number; yaw: number; y: number} | null {
  const {L, layout} = rig;
  const r = 0.36, feet = prop.y;
  const f = {x: Math.sin(prop.rot), z: Math.cos(prop.rot)};
  for (const [dx, dz] of [[f.x, f.z], [-f.x, -f.z], [f.z, -f.x], [-f.z, f.x]]) {
    const ax = Math.round(dx), az = Math.round(dz);
    const face = Math.abs(ax) * prop.hx + Math.abs(az) * prop.hz;
    const free = (x: number, z: number) => {
      for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
        if (L.blocksAt(cx, cz, x, z, feet)) return false;
      }
      return !layout.props.some(q => q !== prop && q.h > 0.05 && !q.mounted && q.y < feet + 1.8 && q.y + q.h > feet + 0.05
        && Math.abs(q.x - x) < q.hx + r && Math.abs(q.z - z) < q.hz + r);
    };
    let ok = true;
    // the walk-in corridor and the space the prop is shoved into
    for (let s = -(face + behind); s <= face + dist + 0.3 + 1e-6 && ok; s += 0.1) {
      if (Math.abs(s) < face + r) continue; // the prop itself
      ok = free(prop.x + ax * s, prop.z + az * s);
    }
    if (!ok) continue;
    const x = prop.x + ax * (face + 0.3 + dist), z = prop.z + az * (face + 0.3 + dist);
    return {x, z, yaw: Math.atan2(ax, az), y: L.floorAt(x, z, feet + 0.05)};
  }
  return null;
}

/** Place the player at a pose (its feet on the storey floor). */
export function stand(rig: ContactRig, at: {x: number; z: number; yaw: number; y: number}): void {
  rig.player.spawn(at.x, at.z, at.yaw, at.y);
}

/** Hold W (straight ahead) for `seconds`: the player moves first, then physics steps (game.ts order); `each` per frame. */
export function walkForward(rig: ContactRig, seconds: number, each?: (i: number) => void): void {
  rig.keys.held.add('KeyW');
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) {
    rig.player.update(DT, rig.keys, rig.L, rig.index, {aiming: false, speedMult: 1, canSprint: false});
    rig.ph.update(DT);
    each?.(i);
  }
  rig.keys.held.clear();
}

/** Step physics only (walker standing still). */
export function settle(rig: ContactRig, seconds: number): void {
  for (let t = 0; t < seconds - 1e-9; t += DT) rig.ph.update(DT);
}

/** World pose of a prop's render: the first own mesh drawn for it (detached), else its shared instance (attached). */
export function renderPose(rig: ContactRig, prop: PropPlacement): {p: THREE.Vector3; detached: boolean} | null {
  const s = rig.pd.states.get(prop);
  const own = s?.parts?.find(q => q.mesh.parent === rig.pd.group);
  if (own) { own.mesh.updateWorldMatrix(true, false); return {p: new THREE.Vector3().setFromMatrixPosition(own.mesh.matrixWorld), detached: true}; }
  const e = rig.pd.index.inst.get(prop)?.[0];
  if (!e) return null;
  const m = new THREE.Matrix4();
  e.mesh.getMatrixAt(e.index, m);
  e.mesh.updateWorldMatrix(true, false);
  m.premultiply(e.mesh.matrixWorld);
  return {p: new THREE.Vector3().setFromMatrixPosition(m), detached: false};
}
