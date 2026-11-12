// Task studio-train-crafting-v1-20261111-225628-01 (lane EQUIP): the TRAIN EQUIPMENT's look — the views world/trainEquipment.ts moves
// about. No new art, no generation, no textures, no lights: existing approved models composed, plain-material authored fixtures.
//
//  - A DEVICE ('dolly' kinds: craft/equipment.ts EquipmentDef.move): the HAND TRUCK exactly as the fuel dolly draws it (world/
//    fuelCartModel.ts buildTruckBody: the same model / stand-in at the same place) + the kind's MODULE standing on the nose plate
//    (assets/trainEquipment.generated.ts TRAIN_EQUIPMENT_MODELS[kind] through the prop library, cloned: its own maps kept; its origin at
//    (0, CART_LOOK.plateTop, TRAIN_MODULE_MEASURED[kind].mountZ) in the dolly frame, +Z = the console face = the dolly's front).
//  - A CHEST ('carry' kinds): the Lockbox's model (world/trainLockbox.ts buildLockboxView: body + hinged lid + the dark cavity liner)
//    at CHEST_SCALE, ONE template per model generation cloned per chest (shared geometry / materials); its lid opens / shuts on the
//    Lockbox's own stroke (LockboxLid).
//  - Without a model (Node tests, a failed fetch, a kind with no cooked module yet) a plain STAND-IN of the measured size is drawn
//    (named 'train-equipment-stand-in'); a view built before its models arrived is rebuilt in place (EquipmentLook.refresh).
//  - The three PLUG SOCKETS (craft/trainFixtures.ts equipmentPlugs): a small steel back box on the lining, a round socket, an indicator
//    lamp (emissive material only: dim amber = free, green = in use) — one train-local group the system parents to the car's view root
//    (it rides the car like the woodchipper's view).
//  - The CABLE of a connected device: one pooled tube per plug (the fuel hose's CartHose: a sagging curve rewritten in place, never a
//    new geometry), train-local under the fixtures group, so it rides the car with the device.
//
// FRAMES: a device's view is in the DOLLY (cart) frame — origin = the footprint circle's centre on the floor, +Z = the front (the module
// / console side), -Z = the handle; a chest's in the BOX frame — origin = the footprint centre on the floor, +Z = its front (latches).
// Prop rules (root CLAUDE.md): every kind is a loose, movable thing (rule 2: world/trainEquipment.ts); the chest is storage that opens
// (rule 1) through its own persistent store; nothing loose is baked into a view (rule 4). The sockets are anchored fixtures of the car
// (rule 3: wall-mounted, no body, not storage).

import * as THREE from 'three';
import type {GLTF} from 'three/addons/loaders/GLTFLoader.js';
import {EQUIPMENT_KINDS, type EquipmentDef, type EquipmentKind} from '../craft/equipment';
import {TRAIN_EQUIPMENT_MODELS, TRAIN_MODULE_MEASURED} from '../assets/trainEquipment.generated';
import {equipmentPlugs, type EquipmentPlug} from '../craft/trainFixtures';
import {CART_LOOK, CartHose, buildTruckBody, cartMaterials, cartModelsGen} from './fuelCartModel';
import {LOCKBOX, LOCKBOX_MODEL_KEY, buildLockboxView, type LockboxSpec} from './trainLockbox';
import {TrainMaterials} from './playerTrainView';
import {LOCKBOX_PROVISIONAL, PLAYER_TRAIN_SPEC, type PlayerTrainSpec} from './playerTrainSpec';

/** A chest is the Lockbox's model at this uniform scale. */
export const CHEST_SCALE = 0.8;

/** The sockets' authored sizes (m) and where a cable leaves a device (over the floor it stands on). */
export const PLUG_LOOK = {
  box: {w: 0.16, h: 0.2, d: 0.035},
  socket: {r: 0.036, d: 0.022},
  lamp: {r: 0.014, d: 0.012, up: 0.066},
  /** The cable's device end: this high over the floor, this far from the footprint centre toward the socket (at most). */
  portY: 0.32, portOut: 0.2,
} as const;

/** A box in a unit's own frame: centre x, half width, base / top (y), centre z, half depth. */
export interface UnitBox { x: number; hw: number; y0: number; y1: number; z: number; hd: number }

/**
 * What the cook measured of a module (assets/trainEquipment.generated.ts TRAIN_MODULE_MEASURED): `bounds` = the plan bounds of
 * everything of it in its own frame (handles, leads, a hood reach past the cabinet; absent: the size centred on the origin).
 */
interface ModuleMeasured {
  size: {w: number; h: number; d: number}; mountZ: number; face: {y0: number; y1: number};
  bounds?: {x0: number; x1: number; z0: number; z1: number};
}

/** A dolly kind's module as measured (the cook's numbers; a kind without a cooked module yet: a plain box on the plate). */
function moduleMeasured(kind: EquipmentKind): ModuleMeasured {
  const m = (TRAIN_MODULE_MEASURED as Readonly<Record<string, ModuleMeasured | undefined>>)[kind];
  return m ?? {size: {w: 0.45, h: 0.9, d: 0.38}, mountZ: CART_LOOK.drumZ, face: {y0: 0.05, y1: 0.8}};
}

/** The prop-library key of a kind's model: the module ('dolly'), the Lockbox ('carry'); null: none cooked. */
export function equipmentModelKey(def: EquipmentDef): string | null {
  if (def.move === 'carry') return LOCKBOX_MODEL_KEY;
  return (TRAIN_EQUIPMENT_MODELS as Readonly<Record<string, {key: string} | undefined>>)[def.kind]?.key ?? null;
}

/** The Lockbox's own measurements a chest is scaled from (its spec in the car, else the provisional box). */
function chestSource(spec: PlayerTrainSpec): LockboxSpec {
  const lb = spec.lockbox;
  if (lb) return {...lb, x: 0, z: 0, yaw: 0};
  const P = LOCKBOX_PROVISIONAL;
  return {x: 0, z: 0, yaw: 0, length: P.length, height: P.height, depth: P.depth, lid: {hingeY: P.hinge.y, hingeZ: P.hinge.z, openAngle: (100 * Math.PI) / 180}, seamY: P.seamY, cavity: {...P.cavity}};
}

const boxCache = new Map<string, {body: UnitBox; face: {y0: number; y1: number} | null}>();

/**
 * What the player aims at / a bullet meets, in the unit's own frame: a 'dolly' kind's MODULE box (+ its console face band on the +Z
 * face), a 'carry' kind's whole box. Read from the measured models — never per-kind numbers here.
 */
export function equipmentBox(def: EquipmentDef, spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): {body: UnitBox; face: {y0: number; y1: number} | null} {
  const id = `${def.kind}:${spec === PLAYER_TRAIN_SPEC ? '' : 'x'}`;
  let b = spec === PLAYER_TRAIN_SPEC ? boxCache.get(id) : undefined;
  if (b) return b;
  if (def.move === 'carry') {
    const lb = chestSource(spec);
    b = {body: {x: 0, hw: (lb.length * CHEST_SCALE) / 2, y0: 0, y1: lb.height * CHEST_SCALE, z: 0, hd: (lb.depth * CHEST_SCALE) / 2}, face: null};
  } else {
    // the module's plan bounds as it stands on the nose plate (its origin at (0, plate top, mountZ) in the dolly frame)
    const m = moduleMeasured(def.kind), y0 = CART_LOOK.plateTop;
    const B = m.bounds ?? {x0: -m.size.w / 2, x1: m.size.w / 2, z0: -m.size.d / 2, z1: m.size.d / 2};
    b = {
      body: {x: (B.x0 + B.x1) / 2, hw: (B.x1 - B.x0) / 2, y0, y1: y0 + m.size.h, z: m.mountZ + (B.z0 + B.z1) / 2, hd: (B.z1 - B.z0) / 2},
      face: {y0: y0 + m.face.y0, y1: y0 + m.face.y1},
    };
  }
  if (spec === PLAYER_TRAIN_SPEC) boxCache.set(id, b);
  return b;
}

// ---------------------------------------------------------------------------------------------------------------------
// Shared materials (one instance each: one program, one shadow program per material)

let shared: {
  standIn: THREE.MeshStandardMaterial; standInFace: THREE.MeshStandardMaterial;
  plugSteel: THREE.MeshStandardMaterial; plugSocket: THREE.MeshStandardMaterial;
  lampFree: THREE.MeshStandardMaterial; lampOn: THREE.MeshStandardMaterial;
} | null = null;

export function equipmentMaterials(): NonNullable<typeof shared> {
  if (shared) return shared;
  const std = (name: string, color: number, o: THREE.MeshStandardMaterialParameters = {}) => { const m = new THREE.MeshStandardMaterial({color, roughness: 0.75, metalness: 0.2, ...o}); m.name = name; return m; };
  shared = {
    standIn: std('train-equipment-stand-in', 0x4b5650, {metalness: 0.4, roughness: 0.6}),
    standInFace: std('train-equipment-stand-in-face', 0x1b1f1e, {roughness: 0.5}),
    plugSteel: std('train-plug-steel', 0x5d5f5c, {metalness: 0.55, roughness: 0.6}),
    plugSocket: std('train-plug-socket', 0x121212, {roughness: 0.5}),
    // the indicator lamps: emissive only (no light): dim amber while the plug is free, green while a device is connected
    lampFree: std('train-plug-lamp-free', 0x4a3208, {emissive: 0xffa21c, emissiveIntensity: 0.35}),
    lampOn: std('train-plug-lamp-on', 0x1d5c22, {emissive: 0x46e04f, emissiveIntensity: 1.1}),
  };
  return shared;
}

// ---------------------------------------------------------------------------------------------------------------------
// One unit's view

export interface EquipmentView {
  /** The unit's frame (the system places / parents it). */
  group: THREE.Group;
  /** The body (models or stand-ins): rebuilt when the models arrive. */
  body: THREE.Object3D;
  /** The look generation the body was built with (EquipmentLook.gen). */
  gen: number;
  /** Some part of it is a stand-in (its model was not there). */
  standIn: boolean;
  /** The lid's pivot (kinds with a lid), its rest angle and full stroke (rad). */
  lid: THREE.Object3D | null;
  lidRest: number;
  lidOpen: number;
}

type ModelLib = {get(key: string): {scene: THREE.Object3D} | undefined} | null | undefined;

/** The carried box's template: the Lockbox source it was built from, the scaled view cloned per unit, the lid's stroke. */
interface BoxTemplate { src: THREE.Object3D | null; group: THREE.Group; openAngle: number }

/**
 * The models the views are built from: the prop library's (read each time it is polled: a model that arrives later upgrades the
 * stand-ins) and the fuel dolly's truck. One instance per equipment system.
 */
export class EquipmentLook {
  /** Bumped whenever a source changed (a model arrived, the truck's models arrived): views with an older `gen` are rebuilt. */
  gen = 0;
  private truckGen = cartModelsGen;
  private readonly scenes = new Map<string, THREE.Object3D | null>();
  private chest: BoxTemplate | null = null;
  private mats: TrainMaterials | null = null;

  constructor(private readonly lib: () => ModelLib, readonly spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC) {}

  private sceneOf(key: string | null): THREE.Object3D | null {
    if (!key) return null;
    let s: THREE.Object3D | null = null;
    try { s = this.lib()?.get(key)?.scene ?? null; } catch { s = null; }
    return s;
  }

  /** Re-read the sources (cheap: a map read per kind). True when something changed (`gen` bumped). */
  poll(defs: Readonly<Record<EquipmentKind, EquipmentDef>>): boolean {
    let changed = this.truckGen !== cartModelsGen;
    this.truckGen = cartModelsGen;
    for (const kind of EQUIPMENT_KINDS) {
      const key = equipmentModelKey(defs[kind]);
      if (!key) continue;
      const s = this.sceneOf(key);
      if (this.scenes.get(key) !== s) { this.scenes.set(key, s); changed = true; }
    }
    if (changed) this.gen++;
    return changed;
  }

  /** The chest template for the Lockbox model now known (built once per source; cloned per chest). */
  private chestTemplate(): BoxTemplate {
    const src = this.scenes.get(LOCKBOX_MODEL_KEY) ?? null;
    if (this.chest && this.chest.src === src) return this.chest;
    const lb = chestSource(this.spec);
    this.mats ??= new TrainMaterials();
    const v = buildLockboxView(lb, 0, this.mats, src ? {scene: src} as unknown as GLTF : null);
    v.group.position.set(0, 0, 0);
    v.group.rotation.set(0, 0, 0);
    v.group.scale.setScalar(CHEST_SCALE);
    v.group.name = 'train-equipment-chest-body';
    this.chest = {src, group: v.group, openAngle: lb.lid.openAngle};
    return this.chest;
  }

  private buildBody(def: EquipmentDef): {body: THREE.Object3D; standIn: boolean; lid: THREE.Object3D | null; lidRest: number; lidOpen: number} {
    if (def.move === 'carry') {
      const T = this.chestTemplate(), body = T.group.clone(true);
      const lid = body.getObjectByName('lockbox-lid') ?? body.getObjectByName('train-lockbox-lid') ?? null;
      return {body, standIn: !T.src, lid, lidRest: lid?.rotation.x ?? 0, lidOpen: T.openAngle};
    }
    const body = new THREE.Group();
    body.name = 'train-equipment-device-body';
    body.add(buildTruckBody());
    const src = this.scenes.get(equipmentModelKey(def) ?? '') ?? null;
    if (src) {
      const m = src.clone(true);
      m.name = `train-equipment-module:${def.kind}`;
      m.position.set(0, CART_LOOK.plateTop, moduleMeasured(def.kind).mountZ);
      body.add(m);
    } else {
      // the stand-in: a plain box of the measured bounds (exactly the aim box), its console face marked on +Z
      const S = equipmentMaterials(), G = cartMaterials().boxGeo, K = equipmentBox(def, this.spec), B = K.body, F = K.face ?? {y0: B.y0, y1: B.y1};
      const box = new THREE.Mesh(G, S.standIn);
      box.name = 'train-equipment-stand-in';
      box.scale.set(B.hw * 2, B.y1 - B.y0, B.hd * 2);
      box.position.set(B.x, (B.y0 + B.y1) / 2, B.z);
      const face = new THREE.Mesh(G, S.standInFace);
      face.name = 'train-equipment-stand-in-face';
      face.scale.set(B.hw * 1.6, Math.max(0.05, F.y1 - F.y0), 0.012);
      face.position.set(B.x, (F.y0 + F.y1) / 2, B.z + B.hd + 0.004);
      body.add(box, face);
    }
    return {body, standIn: !src, lid: null, lidRest: 0, lidOpen: 0};
  }

  /** A unit's view from the sources known now. */
  build(def: EquipmentDef): EquipmentView {
    const group = new THREE.Group();
    group.name = `train-equipment:${def.kind}`;
    group.rotation.order = 'YXZ'; // (yaw, then the rest pose's pitch / roll in the unit's own frame)
    const b = this.buildBody(def);
    group.add(b.body);
    return {group, body: b.body, gen: this.gen, standIn: b.standIn, lid: b.lid, lidRest: b.lidRest, lidOpen: b.lidOpen};
  }

  /** Rebuild a view's body from the sources known now (they changed after it was built). True when it was rebuilt. */
  refresh(v: EquipmentView, def: EquipmentDef): boolean {
    if (v.gen === this.gen) return false;
    v.gen = this.gen;
    const b = this.buildBody(def);
    v.group.remove(v.body);
    v.body = b.body;
    v.standIn = b.standIn;
    v.lid = b.lid; v.lidRest = b.lidRest; v.lidOpen = b.lidOpen;
    v.group.add(v.body);
    return true;
  }
}

/** Pose a view's lid for an eased open fraction e (0 shut .. 1 open); a kind without a lid: nothing. */
export function poseEquipmentLid(v: EquipmentView, e: number): void {
  if (v.lid) v.lid.rotation.x = v.lidRest - v.lidOpen * e;
}

/** The lid's full stroke (s): the Lockbox's own. */
export const EQUIPMENT_LID_TIME = LOCKBOX.lidTime;

// ---------------------------------------------------------------------------------------------------------------------
// The plug sockets + cables (train-local)

export interface PlugFixtures {
  /** Train-local group (a child of the car's view root). */
  group: THREE.Group;
  plugs: readonly EquipmentPlug[];
  lamps: THREE.Mesh[];
  /** One pooled cable per plug (hidden while the plug is free). */
  cables: CartHose[];
  /** Where each cable ends on its socket (train-local). */
  ends: {x: number; y: number; z: number}[];
}

/** The car's plug sockets and their pooled cables (authored geometry, plain materials). */
export function buildPlugFixtures(spec: PlayerTrainSpec = PLAYER_TRAIN_SPEC): PlugFixtures {
  const S = equipmentMaterials(), C = cartMaterials(), K = PLUG_LOOK;
  const group = new THREE.Group();
  group.name = 'train-equipment-plugs';
  const plugs = equipmentPlugs(spec), lamps: THREE.Mesh[] = [], cables: CartHose[] = [], ends: {x: number; y: number; z: number}[] = [];
  for (const p of plugs) {
    const g = new THREE.Group();
    g.name = `train-plug:${p.index}`;
    // on the lining at (p.x, p.y, p.z); its own +Z points into the car
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.side > 0 ? Math.PI : 0;
    const box = new THREE.Mesh(C.boxGeo, S.plugSteel);
    box.name = 'train-plug-box';
    box.scale.set(K.box.w, K.box.h, K.box.d);
    box.position.set(0, 0, K.box.d / 2);
    const socket = new THREE.Mesh(C.wheelGeo, S.plugSocket);
    socket.name = 'train-plug-socket';
    socket.scale.set(K.socket.r, K.socket.d, K.socket.r);
    socket.rotation.x = Math.PI / 2;
    socket.position.set(0, -0.02, K.box.d + K.socket.d / 2 - 0.004);
    const lamp = new THREE.Mesh(C.wheelGeo, S.lampFree);
    lamp.name = 'train-plug-lamp';
    lamp.scale.set(K.lamp.r, K.lamp.d, K.lamp.r);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(0, K.lamp.up, K.box.d + K.lamp.d / 2 - 0.002);
    g.add(box, socket, lamp);
    group.add(g);
    lamps.push(lamp);
    const cable = new CartHose();
    cable.mesh.name = `train-equipment-cable:${p.index}`;
    cable.mesh.visible = false;
    group.add(cable.mesh);
    cables.push(cable);
    ends.push({x: p.x, y: p.y - 0.02, z: p.z - p.side * (K.box.d + K.socket.d)});
  }
  return {group, plugs, lamps, cables, ends};
}

/** A plug's lamp: green while a device is connected, dim amber while it is free. */
export function setPlugLamp(f: PlugFixtures, index: number, on: boolean): void {
  const lamp = f.lamps[index];
  if (!lamp) return;
  const S = equipmentMaterials(), m = on ? S.lampOn : S.lampFree;
  if (lamp.material !== m) lamp.material = m;
}

/**
 * Shape plug `index`'s cable from a device standing at the train-local footprint centre (lx, lz) on the car floor to the socket: it
 * leaves the device low on the side facing the socket and sags toward the floor. In place; no allocation.
 */
export function shapePlugCable(f: PlugFixtures, index: number, lx: number, lz: number, floorY: number): void {
  const cable = f.cables[index], e = f.ends[index];
  if (!cable || !e) return;
  const dx = e.x - lx, dz = e.z - lz, d = Math.hypot(dx, dz), k = d > 1e-6 ? Math.min(PLUG_LOOK.portOut, d * 0.5) / d : 0;
  cable.update(lx + dx * k, floorY + PLUG_LOOK.portY, lz + dz * k, e.x, e.y, e.z, floorY);
}
