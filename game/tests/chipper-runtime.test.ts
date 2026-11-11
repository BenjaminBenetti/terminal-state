// Task studio-corpse-chipper-fuel-20261110-235304-01 (lane CHIPPER): the train chipper's RUNTIME (world/chipper.ts + chipperPlace.ts /
// chipperView.ts / chipperFx.ts) on a generated Subway layout with the REAL parked train runtime (world/playerTrain.ts) and the real Player
// body, a fake corpse system (corpse/api.ts: a held body with the enemy rig's bone names) and a counting sound:
//  - placement in the +Z bay between the middle and front doors, clear of every door, the aisle, the cab / console and the Lockbox, below
//    the sill; its collision box parked (both yaws) and riding; the player walks into it and stops;
//  - the sink: offer in reach + looking, refusals (busy / full / riding: the body stays held), take = startJob in the same call;
//  - one body -> exactly 20 active s -> credited once, its object disposed once in that frame; riding pauses it (no progress, no credit),
//    parked again it resumes; the transfer only while parked with no journey pending (two settled frames); 10 / 20 bodies -> +4 / +8;
//  - the blood pools are bounded (no new objects after construction), cleared on pause / teardown; the noise cadence over one body;
//  - a save mid-grind loads the same job (rebuilt body visual, the progress continues, credited once).
import {afterEach, describe, expect, it} from 'vitest';
import * as THREE from 'three';
import {installCanvasShim} from './helpers/canvas2d';
import {LEVELS} from '../src/levels/registry';
import {levelsOf} from '../src/gen/levels';
import {PropIndex} from '../src/core/physics';
import {Player, STAND_EYE, type MoveInput} from '../src/player/player';
import {WarmupRegistry} from '../src/render/warmup';
import type {StationLayout} from '../src/gen/stationTypes';
import {playerTrainPlacement, trainToWorld, worldToTrain, type TrainPlacement} from '../src/gen/playerTrain';
import {PLAYER_TRAIN_SPEC as SPEC} from '../src/world/playerTrainSpec';
import {PlayerTrainRuntime, installPlayerTrain, trainColliders} from '../src/world/playerTrain';
import {RIDE_FRAME, buildRideLocalModel} from '../src/world/trainRideLocal';
import {lockboxFootprint} from '../src/world/trainLockbox';
import {consoleLocalRect} from '../src/world/trainConsole';
import {CHIPPER_SIZE, CHIPPER_ANCHORS} from '../src/world/chipperSpec';
import {chipperDirToLocal, chipperFootprint, chipperPlacement, chipperToLocal} from '../src/world/chipperPlace';
import {CHIPPER_RT, CHIPPER_TEXT, ChipperSystem, type ChipperAudioLike, type ChipperHost} from '../src/world/chipper';
import {CHIPPER_FX} from '../src/world/chipperFx';
import {CHIPPER_VIEW, ChipperView, lungeCurve} from '../src/world/chipperView';
import {CHIPPER, CHIPPER_REFUSAL} from '../src/fuel/chipperFuel';
import {FUEL} from '../src/fuel/fuel';
import {PlayerTrainRecord} from '../src/run/playerTrain';
import type {BodyRecordJSON} from '../src/corpse/bodyRecord';
import type {BodySink, CorpseSystemApi, HeldBody} from '../src/corpse/api';
import type {WorldNoise} from '../src/ai/worldNoise';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';

installCanvasShim(false);

const DT = 1 / 60;
const OPTS = {aiming: false, speedMult: 1, canSprint: false};
const C = chipperPlacement(SPEC)!;
const FP = chipperFootprint(C);

let layoutCache: StationLayout | null = null;
const layout = (): StationLayout => (layoutCache ??= LEVELS.subway.generate(LEVELS.subway.entry, {levelSeed: 4242}));

class Keys implements MoveInput {
  held = new Set<string>();
  down(c: string) { return this.held.has(c); }
  hit() { return false; }
}

/** A body model with the enemy rigs' bone names (standing: feet at the origin, head up). */
function bodyObject(): THREE.Object3D {
  const g = new THREE.Group();
  g.name = 'fake-body';
  const bone = (name: string, x: number, y: number, z: number) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); g.add(b); };
  bone('Hips', 0, 0.95, 0); bone('Head', 0, 1.6, 0); bone('L_Foot', 0.1, 0.08, 0); bone('R_Foot', -0.1, 0.08, 0);
  bone('L_UpperArm', 0.2, 1.42, 0); bone('R_UpperArm', -0.2, 1.42, 0); // (the rig's left is +X), arms out (a T)
  for (const sd of ['L', 'R'] as const) { const h = new THREE.Bone(); h.name = `${sd}_Hand`; h.position.set(sd === 'L' ? 0.55 : -0.55, 0, 0); g.getObjectByName(`${sd}_UpperArm`)!.add(h); }
  g.add(new THREE.Mesh(new THREE.BoxGeometry(0.45, 1.75, 0.3).translate(0, 0.875, 0), new THREE.MeshStandardMaterial()));
  return g;
}

const bodyRecord = (i: number): BodyRecordJSON => ({id: `subway:main#${i}`, arch: 'zombie', seed: 777, type: 'shambler', pose: 'lying', x: 12.5, y: 0.2, z: 4, q: [0, 0, 0, 1], level: 0});

/** The corpse system's side of the contract: holds a body, asks its sinks on E (corpse/api.ts). */
class FakeCorpses implements CorpseSystemApi {
  readonly sinks: BodySink[] = [];
  heldBody: HeldBody | null = null;
  readonly disposed: THREE.Object3D[] = [];
  built = 0;
  held() { return this.heldBody; }
  addSink(s: BodySink) { this.sinks.push(s); }
  buildBody(_rec: BodyRecordJSON) { this.built++; return bodyObject(); }
  disposeBody(o: THREE.Object3D) { this.disposed.push(o); }
  pickUp(i: number): HeldBody { const obj = bodyObject(); this.heldBody = {record: bodyRecord(i), object: obj}; return this.heldBody; }
  /** E with a body in the hands: the first sink with an offer decides. */
  pressE(): 'fed' | 'refused' | 'none' {
    const h = this.heldBody;
    if (!h) return 'none';
    for (const s of this.sinks) {
      const o = s.offer(h);
      if (!o) continue;
      if (o.ok && s.take(h)) { this.heldBody = null; return 'fed'; }
      return 'refused';
    }
    return 'none';
  }
}

class CountingAudio implements ChipperAudioLike {
  readonly calls: string[] = [];
  start() { this.calls.push('start'); }
  feed() { this.calls.push('feed'); }
  grind(on: boolean) { this.calls.push(on ? 'grind-on' : 'grind-off'); }
  stop() { this.calls.push('stop'); }
  frame() { /* every frame */ }
  silence() { this.calls.push('silence'); }
  count(k: string) { return this.calls.filter(c => c === k).length; }
}

const live: {rt: PlayerTrainRuntime; ch: ChipperSystem}[] = [];
afterEach(() => { for (const {rt, ch} of live.splice(0)) { ch.teardown(); if (rt.train) rt.teardown(); } });

function setup(o: {placement?: TrainPlacement} = {}) {
  const lay = layout();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 70);
  camera.rotation.order = 'YXZ';
  scene.add(camera);
  const levels = levelsOf(lay);
  const player = new Player();
  const corpses = new FakeCorpses();
  const toasts: string[] = [];
  const noises: WorldNoise[] = [];
  const host = {
    scene, camera, player, zombies: [] as never[], levels, layout: lay, propIndex: new PropIndex(levels, lay.props),
    trainPlacement: (o.placement ?? playerTrainPlacement(lay)) as TrainPlacement | null,
    sfx: null, hud: {toast: (t: string) => { toasts.push(t); }}, warmRegistry: new WarmupRegistry(), physics: {propsChanged: () => {}},
    interactHandlers: [] as (() => boolean)[], frameHooks: [] as ((dt: number) => void)[], sectionHooks: [] as {build?(l: StationLayout): void; teardown?(): void}[],
    promptProviders: [] as (() => string | null)[], stateListeners: [] as ((s: never, p: never) => void)[], sectionPreloads: [] as ((l: StationLayout) => Promise<void>)[],
    sectionModelKeys: [] as ((l: StationLayout) => readonly string[])[],
    state: 'playing', world: null, input: new Keys(), run: {current: {level: 'subway', section: 'main'}, campaign: null as {transit?: unknown} | null},
    playerTrain: new PlayerTrainRecord(), trainRide: {riding: false}, corpses, worldNoiseListeners: [(n: WorldNoise) => { noises.push(n); }],
    trainRuntime: undefined as unknown as PlayerTrainRuntime,
  };
  const rt = installPlayerTrain(host);
  host.trainRuntime = rt;
  const audio = new CountingAudio();
  const ch = new ChipperSystem(host as unknown as ChipperHost, {audio}).install();
  live.push({rt, ch});
  for (const s of host.sectionHooks) s.build?.(lay);
  return {host, rt, ch, corpses, audio, toasts, noises, p: rt.train!.placement};
}
type Setup = ReturnType<typeof setup>;

function syncCamera(s: Setup): void {
  const P = s.host.player;
  s.host.camera.position.set(P.x, P.y + STAND_EYE, P.z);
  s.host.camera.rotation.set(P.pitch, P.yaw, 0);
  s.host.camera.updateMatrixWorld(true);
}

/** Stand `back` m in front of the hopper in the aisle, looking into its mouth. */
function standAtHopper(s: Setup, back = 0.95): void {
  const A = CHIPPER_ANCHORS.hopper, hop = chipperToLocal(C, A.x, A.y, A.z), f = chipperDirToLocal(C, 0, 0, 1);
  const at = trainToWorld(s.p, hop.x + f.x * back, SPEC.floorY, hop.z + f.z * back), aim = trainToWorld(s.p, hop.x, hop.y, hop.z);
  const P = s.host.player;
  P.spawn(at.x, at.z, 0, at.y);
  P.yaw = Math.atan2(-(aim.x - at.x), -(aim.z - at.z));
  P.pitch = Math.atan2(aim.y - (at.y + STAND_EYE), Math.hypot(aim.x - at.x, aim.z - at.z));
  syncCamera(s);
}

/** Frames of `seconds` (the chipper's frame hook only: the train's doors are not under test). */
function run(s: Setup, seconds: number, dt = DT): void {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) s.ch.update(dt);
}

describe('chipper: placement in the car (pure, from the spec)', () => {
  it('stands in the +Z bay between the middle and front door pairs, against the wall, below the sill, clear of everything', () => {
    const far = SPEC.doors.filter(d => d.side === 1).sort((a, b) => a.x - b.x);
    const mid = far.find(d => Math.abs(d.x) === Math.min(...far.map(q => Math.abs(q.x))))!, front = far[far.indexOf(mid) + 1];
    expect(C.bay.x0).toBeCloseTo(mid.x + mid.width / 2, 4);
    expect(C.bay.x1).toBeCloseTo(front.x - front.width / 2, 4);
    expect(C.x).toBeCloseTo(2.186, 2); // the bay's centre (brief: ~2.19)
    expect(FP.x0).toBeGreaterThanOrEqual(C.bay.x0 + 0.5); // well clear of both door openings
    expect(FP.x1).toBeLessThanOrEqual(C.bay.x1 - 0.5);
    expect(C.yaw).toBe(Math.PI);
    expect(FP.x1 - FP.x0).toBeCloseTo(CHIPPER_SIZE.l, 9); expect(C.height).toBe(CHIPPER_SIZE.h); expect(FP.z1 - FP.z0).toBeCloseTo(CHIPPER_SIZE.d, 9);
    // against the +Z lining (its back 2.5 cm off), standing on the car floor
    expect(FP.z1).toBeCloseTo(SPEC.interior.halfWidth - 0.025, 6);
    expect(FP.z0).toBeGreaterThan(0.6);
    expect(C.floorY).toBe(SPEC.floorY);
    // below the sill of the +Z window over the bay
    const win = SPEC.windows.side.filter(w => w.side === 1 && w.x1 > FP.x0 && w.x0 < FP.x1);
    expect(win.length).toBeGreaterThan(0);
    for (const w of win) expect(SPEC.floorY + C.height).toBeLessThan(w.y0 - 0.05);
    // no door opening (either side) overlaps its x span; the aisle keeps >= 1.9 m; the cab, console and Lockbox are elsewhere
    for (const d of SPEC.doors) expect(FP.x1 <= d.x - d.width / 2 || FP.x0 >= d.x + d.width / 2, `door ${d.side} ${d.x}`).toBe(true);
    expect(FP.z0 - -SPEC.interior.halfWidth).toBeGreaterThan(1.9);
    expect(FP.x1).toBeLessThan(SPEC.cab.x0);
    const cr = consoleLocalRect(SPEC);
    expect(FP.x1).toBeLessThan(cr.x0);
    const lb = lockboxFootprint(SPEC.lockbox!);
    expect(FP.x0).toBeGreaterThan(lb.x1);
    // inside the walkable interior; the hopper / outlet / panel anchors map into its box (front = the aisle side)
    expect(FP.x0).toBeGreaterThan(SPEC.interior.x0); expect(FP.x1).toBeLessThan(SPEC.interior.x1);
    const A = CHIPPER_ANCHORS, h = chipperToLocal(C, A.hopper.x, A.hopper.y, A.hopper.z), panel = chipperToLocal(C, A.panel.x, A.panel.y, A.panel.z);
    for (const q of [h, panel]) { expect(q.x).toBeGreaterThan(FP.x0); expect(q.x).toBeLessThan(FP.x1); expect(q.z).toBeGreaterThan(FP.z0); expect(q.z).toBeLessThan(FP.z1); }
    expect(h.x).toBeGreaterThan(C.x); // the hopper end (model -X) toward the cab
    expect(panel.z).toBeLessThan(C.z); // the control box face toward the aisle
    const f = chipperDirToLocal(C, 0, 0, 1);
    expect(f.x).toBeCloseTo(0, 12); expect(f.y).toBe(0); expect(f.z).toBe(-1);
  });

  it('collides parked (both yaws) and riding: the same footprint, solid to its top', () => {
    const p0 = playerTrainPlacement(layout())!;
    for (const front of [1, -1] as const) {
      const p = {...p0, front, yaw: front === 1 ? 0 : Math.PI};
      const col = trainColliders(SPEC, p, null);
      const box = col.statics.find(b => {
        const a = worldToTrain(p, b.x - b.hx, 0, b.z - b.hz), c = worldToTrain(p, b.x + b.hx, 0, b.z + b.hz);
        return Math.abs(Math.min(a.x, c.x) - FP.x0) < 1e-6 && Math.abs(Math.max(a.x, c.x) - FP.x1) < 1e-6 && Math.abs(Math.min(a.z, c.z) - FP.z0) < 1e-6 && Math.abs(Math.max(a.z, c.z) - FP.z1) < 1e-6;
      });
      expect(box, `yaw ${p.yaw}: the chipper box`).toBeDefined();
      expect(box!.y + box!.h).toBeCloseTo(p.railTopY + SPEC.floorY + CHIPPER_SIZE.h, 6);
      expect(col.shoot).toContain(box); // bullets stop on it too
    }
    const M = buildRideLocalModel(SPEC);
    const r = M.named.chipper;
    expect(r).toBeDefined();
    expect(r.x - r.hx - RIDE_FRAME.ox).toBeCloseTo(FP.x0, 6);
    expect(r.x + r.hx - RIDE_FRAME.ox).toBeCloseTo(FP.x1, 6);
    expect(r.z - r.hz - RIDE_FRAME.oz).toBeCloseTo(FP.z0, 6);
    expect(r.z + r.hz - RIDE_FRAME.oz).toBeCloseTo(FP.z1, 6);
    // riding: the real Player walks into it from the aisle and stops at its front
    const P = new Player(), k = new Keys();
    k.held.add('KeyW');
    P.spawn(C.x + RIDE_FRAME.ox, FP.z0 - 0.9 + RIDE_FRAME.oz, Math.PI, SPEC.floorY); // facing +Z (forward = (-sin, -cos))
    for (let i = 0; i < 120; i++) P.update(DT, k, M.levels, M.props, OPTS);
    expect(P.z - RIDE_FRAME.oz).toBeLessThan(FP.z0 - P.radius + 0.02);
    expect(P.z - RIDE_FRAME.oz).toBeGreaterThan(FP.z0 - P.radius - 0.1);
  });

  it('parked: the real Player walking into it from the aisle stops at its front (the colliders are in game.propIndex)', () => {
    const s = setup();
    const at = trainToWorld(s.p, C.x, SPEC.floorY, FP.z0 - 0.9), into = trainToWorld(s.p, C.x, SPEC.floorY, FP.z1);
    const P = s.host.player, k = new Keys();
    P.spawn(at.x, at.z, Math.atan2(-(into.x - at.x), -(into.z - at.z)), at.y);
    k.held.add('KeyW');
    for (let i = 0; i < 120; i++) P.update(DT, k, s.host.levels, s.host.propIndex, OPTS);
    const q = worldToTrain(s.p, P.x, P.y, P.z);
    expect(q.z).toBeLessThan(FP.z0 - P.radius + 0.02);
    expect(q.z).toBeGreaterThan(FP.z0 - P.radius - 0.1);
    expect(Math.abs(q.y - SPEC.floorY)).toBeLessThan(0.05);
  });
});

describe('chipper: feeding through the corpse sink', () => {
  it('offers in reach while looking; refuses busy / full / riding (the body stays held); take starts the job in the same call', () => {
    const s = setup();
    expect(s.corpses.sinks).toEqual([s.ch.sink]);
    const held = s.corpses.pickUp(1);
    // far away / looking elsewhere: not ours
    standAtHopper(s, 3.5);
    expect(s.ch.sink.offer(held)).toBeNull();
    standAtHopper(s);
    s.host.player.yaw += Math.PI; syncCamera(s);
    expect(s.ch.sink.offer(held)).toBeNull();
    standAtHopper(s);
    expect(s.ch.sink.offer(held)).toEqual({ok: true, text: CHIPPER_TEXT.feed});
    // riding: refused, nothing taken
    s.host.trainRide.riding = true;
    expect(s.ch.sink.offer(held)).toEqual({ok: false, text: CHIPPER_TEXT.riding});
    expect(s.corpses.pressE()).toBe('refused');
    expect(s.corpses.heldBody).toBe(held);
    s.host.trainRide.riding = false;
    // full: refused
    const st = s.host.playerTrain.chipper.state;
    st.ticks = CHIPPER.bufferMaxTicks - 1;
    expect(s.ch.sink.offer(held)).toEqual({ok: false, text: CHIPPER_REFUSAL.full});
    expect(s.corpses.pressE()).toBe('refused');
    expect(st.job).toBeNull();
    st.ticks = 0;
    // feed: the record is the job now (train-local, lying, no storey), the object the machine's
    expect(s.corpses.pressE()).toBe('fed');
    expect(s.corpses.heldBody).toBeNull();
    expect(st.job).not.toBeNull();
    expect(st.job!.body.id).toBe('subway:main#1');
    expect(st.job!.body.level).toBeUndefined();
    expect(st.job!.body.pose).toBe('lying');
    expect(Math.abs(st.job!.body.x)).toBeLessThan(8);
    expect(held.object.parent).toBe(s.ch.group);
    expect(s.ch.body?.frame.bones).toBe(true);
    // busy: a second body is refused and stays in the hands
    const second = s.corpses.pickUp(2);
    expect(s.ch.sink.offer(second)).toEqual({ok: false, text: CHIPPER_REFUSAL.busy});
    expect(s.corpses.pressE()).toBe('refused');
    expect(s.corpses.heldBody).toBe(second);
    expect(st.job!.body.id).toBe('subway:main#1');
    // the sound and the noises of a feed
    expect(s.audio.calls).toEqual(['start', 'grind-on', 'feed']);
    expect(s.noises.map(n => n.kind)).toEqual(['machine-start', 'machine-feed']);
    expect(s.noises.every(n => n.source === 'train-chipper')).toBe(true);
  });

  it('the fed body sinks head first, straightening, legs last, ending inside the hopper', () => {
    expect(lungeCurve(0)).toBe(0);
    expect(lungeCurve(1)).toBeCloseTo(1, 12);
    let prev = -1;
    for (let p = 0; p <= 1.0001; p += 0.01) { const v = lungeCurve(p); expect(v).toBeGreaterThanOrEqual(prev - 1e-12); prev = v; }
    const s = setup();
    s.corpses.pickUp(3);
    standAtHopper(s);
    expect(s.corpses.pressE()).toBe('fed');
    const b = s.ch.body!, obj = b.obj;
    const head = () => obj.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3()), feet = () => obj.getObjectByName('L_Foot')!.getWorldPosition(new THREE.Vector3());
    const rim = () => trainToWorld(s.p, 0, chipperToLocal(C, 0, CHIPPER_ANCHORS.hopper.y, 0).y, 0).y;
    s.ch.update(DT);
    expect(head().y).toBeLessThan(rim()); // head first, in the mouth
    expect(feet().y).toBeGreaterThan(rim() + 0.4); // the legs still out
    expect(feet().y).toBeLessThan(trainToWorld(s.p, 0, SPEC.ceilingY, 0).y - 0.3); // below the ceiling
    // the shoulders lie along the mouth's long side (model Z = train-local z here; in the plane of the body's line and that side): no
    // arm across the short side, at every progress
    const across = () => obj.getObjectByName('L_UpperArm')!.getWorldPosition(new THREE.Vector3()).sub(obj.getObjectByName('R_UpperArm')!.getWorldPosition(new THREE.Vector3()));
    const wp = (n: string) => obj.getObjectByName(n)!.getWorldPosition(new THREE.Vector3());
    for (const p of [0, 0.3, 0.7]) {
      s.host.playerTrain.chipper.state.job!.ms = Math.round(p * CHIPPER.grindMs);
      s.ch.update(0);
      const d = across();
      const h0 = wp('Head'), line = wp('L_Foot').add(wp('R_Foot')).multiplyScalar(0.5).sub(h0).normalize();
      const n = new THREE.Vector3().crossVectors(line, new THREE.Vector3(0, 0, 1)).normalize();
      expect(Math.abs(d.clone().normalize().dot(n)), `p ${p}`).toBeLessThan(1e-3);
      expect(Math.abs(d.dot(line))).toBeLessThan(1e-3);
      expect(d.length()).toBeCloseTo(0.4, 3);
      // the legs lean out over the hopper's own end (model -X): the part already in goes toward the rotor housing (model +X)
      const endDir = trainToWorld(s.p, 1, 0, 0).x - trainToWorld(s.p, 0, 0, 0).x; // world x of train-local +X (= model -X here)
      expect(line.x * endDir).toBeGreaterThan(0.3);
      // the arms are tucked along the body: each hand near the head -> feet line, toward the feet from its shoulder
      for (const sd of ['L', 'R']) {
        const hand = wp(`${sd}_Hand`).sub(h0), off = hand.clone().addScaledVector(line, -hand.dot(line));
        expect(off.length(), `${sd} hand off the body line`).toBeLessThan(0.25);
        expect(hand.dot(line)).toBeGreaterThan(wp(`${sd}_UpperArm`).sub(h0).dot(line) + 0.5);
      }
    }
    s.host.playerTrain.chipper.state.job!.ms = 0;
    s.ch.update(0);
    const top0 = b.exposedTop(0), topMid = b.exposedTop(0.5);
    expect(topMid).toBeLessThan(top0);
    expect(b.exposedTop(1)).toBeLessThan(0); // gone below the rim at the end
    run(s, 15);
    expect(feet().y).toBeLessThan(rim() + 0.4);
    expect(CHIPPER_VIEW.body.tilt0).toBeGreaterThan(CHIPPER_VIEW.body.tilt1);
  });
});

describe('chipper: grinding, credit, transfer', () => {
  it('one body: exactly 20 active seconds, credited once, its object disposed once in that frame; zero train fuel', () => {
    const s = setup();
    const st = s.host.playerTrain.chipper.state;
    expect(s.host.playerTrain.fuel.tank).toBe(0);
    const held = s.corpses.pickUp(4);
    standAtHopper(s);
    expect(s.corpses.pressE()).toBe('fed');
    let frames = 0;
    while (st.job && frames < 2000) { s.ch.update(DT); frames++; }
    expect(frames).toBe(CHIPPER.grindMs / 1000 * 60);
    expect(st.done).toBe(1);
    expect(st.ticks).toBe(CHIPPER.bodyTicks);
    expect(s.ch.counts.credited).toBe(1);
    expect(s.corpses.disposed).toEqual([held.object]);
    expect(held.object.parent).toBeNull();
    expect(s.ch.body).toBeNull();
    run(s, 5);
    expect(s.ch.counts.credited).toBe(1);
    expect(s.corpses.disposed.length).toBe(1);
    expect(s.audio.count('stop')).toBe(1);
    expect(s.audio.calls.at(-2)).toBe('grind-off');
    // 2 ticks wait in the machine (less than a quarter): the tank is untouched
    expect(s.host.playerTrain.fuel.tank).toBe(0);
    expect(s.toasts.some(t => t.startsWith('Body ground'))).toBe(true);
  });

  it('riding pauses it (no progress, no credit, silent, spray gone); parked again it resumes and finishes', () => {
    const s = setup();
    const st = s.host.playerTrain.chipper.state;
    s.corpses.pickUp(5);
    standAtHopper(s);
    s.corpses.pressE();
    run(s, 5);
    const ms = st.job!.ms;
    expect(ms).toBe(5000);
    expect(s.ch.fx.stats().drops).toBeGreaterThan(20);
    s.host.trainRide.riding = true;
    run(s, 30);
    expect(st.job!.ms).toBe(ms);
    expect(st.done).toBe(0);
    expect(s.ch.motor).toBe(false);
    expect(s.audio.count('silence')).toBe(1);
    expect(s.ch.fx.stats()).toMatchObject({drops: 0, mist: 0, chunks: 0});
    expect(s.ch.qa().state).toBe('paused');
    s.host.trainRide.riding = false;
    run(s, 14.9);
    expect(st.done).toBe(0);
    expect(s.audio.count('start')).toBe(2); // the motor restarted
    run(s, 0.2);
    expect(st.done).toBe(1);
  });

  it('pause (leaving playing) clears the spray and silences it; the progress stays', () => {
    const s = setup();
    const st = s.host.playerTrain.chipper.state;
    s.corpses.pickUp(6);
    standAtHopper(s);
    s.corpses.pressE();
    run(s, 3);
    for (const l of s.host.stateListeners) (l as (x: string, y: string) => void)('paused', 'playing');
    expect(s.ch.fx.stats()).toMatchObject({drops: 0, mist: 0, chunks: 0});
    expect(s.audio.calls.at(-1)).toBe('silence');
    expect(st.job!.ms).toBe(3000);
  });

  it('transfers whole quarters only while parked with no journey pending, on two settled frames', () => {
    const s = setup();
    const st = s.host.playerTrain.chipper.state, fuel = s.host.playerTrain.fuel;
    st.ticks = 12;
    s.host.run.campaign = {transit: {to: 'x'}};
    run(s, 0.5);
    expect(fuel.tank).toBe(0);
    s.host.run.campaign = null;
    s.host.trainRide.riding = true;
    run(s, 0.5);
    expect(fuel.tank).toBe(0);
    s.host.trainRide.riding = false;
    s.ch.update(DT); // the first settled frame after a ride (a refused departure's refund lands after it)
    expect(fuel.tank).toBe(0);
    s.ch.update(DT);
    expect(fuel.tank).toBe(2);
    expect(st.ticks).toBe(2);
    // a full tank leaves the credit waiting
    fuel.tank = FUEL.trainTankUnits;
    st.ticks = 10;
    run(s, 0.5);
    expect(st.ticks).toBe(10);
    expect(fuel.tank).toBe(FUEL.trainTankUnits);
  });

  it('10 bodies -> exactly +4 quarters, 20 -> +8 from empty (each credited once); the noise cadence per body', () => {
    const s = setup();
    const st = s.host.playerTrain.chipper.state, fuel = s.host.playerTrain.fuel;
    standAtHopper(s);
    const objs = new Set<THREE.Object3D>();
    for (let i = 0; i < 20; i++) {
      const h = s.corpses.pickUp(100 + i);
      objs.add(h.object);
      expect(s.corpses.pressE(), `body ${i}`).toBe('fed');
      const n0 = s.noises.length;
      run(s, 20.05, 1 / 30);
      expect(st.job, `body ${i} done`).toBeNull();
      if (i === 0) expect(s.noises.slice(n0 - 2).map(n => n.kind)).toEqual(['machine-start', 'machine-feed', 'machine-grind', 'machine-grind', 'machine-grind', 'machine-grind']);
      run(s, 0.1, 1 / 30);
      if (i === 9) expect(fuel.tank).toBe(FUEL.hopUnits);
    }
    expect(fuel.tank).toBe(8);
    expect(st.ticks).toBe(0);
    expect(st.done).toBe(20);
    expect(s.ch.counts.credited).toBe(20);
    expect(new Set(s.corpses.disposed)).toEqual(objs);
    expect(s.corpses.disposed.length).toBe(20);
    // noise: 1 start + 1 feed + 4 grind pulses per body; radii as tuned
    expect(s.noises.length).toBe(20 * 6);
    const r = Object.fromEntries(s.noises.map(n => [n.kind, n.radius]));
    expect(r).toEqual({'machine-start': CHIPPER_RT.noise.start, 'machine-feed': CHIPPER_RT.noise.feed, 'machine-grind': CHIPPER_RT.noise.grind});
    // at the machine's world position
    const w = trainToWorld(s.p, C.x, C.floorY + CHIPPER_RT.soundY, C.z);
    for (const n of s.noises) { expect(n.x).toBeCloseTo(w.x, 6); expect(n.y).toBeCloseTo(w.y, 6); expect(n.z).toBeCloseTo(w.z, 6); }
  });
});

describe('chipper: blood pools, teardown, save / load', () => {
  it('the blood is pooled and bounded: no new objects after construction; cleared at teardown', () => {
    const s = setup();
    const count = () => { let n = 0; s.ch.group.traverse(() => { n++; }); return n; };
    const meshes = s.ch.fx.meshes, arrays = meshes.map(m => m.instanceMatrix.array);
    s.corpses.pickUp(7);
    standAtHopper(s);
    const n0 = count();
    s.corpses.pressE();
    let peak = {drops: 0, mist: 0, chunks: 0, stains: 0};
    // the plume's height over the rim, the spray inside the car, and the drop spawns per frame (the lunge bursts)
    const rimY = chipperToLocal(C, 0, CHIPPER_ANCHORS.hopper.y, 0).y, drops = s.ch.fx.meshes[0], dm = drops.instanceMatrix.array as Float32Array;
    const local = new THREE.Vector3(), spawns: number[] = [];
    let plumeTop = -Infinity, outside = 0, aboveCeiling = 0;
    for (let i = 0; i < 1100; i++) {
      const c0 = s.ch.fx.counts.drops;
      s.ch.update(DT);
      spawns.push(s.ch.fx.counts.drops - c0);
      const st = s.ch.fx.stats();
      for (const k of Object.keys(peak) as (keyof typeof peak)[]) peak[k] = Math.max(peak[k], st[k]);
      for (let k = 0; k < drops.count; k++) {
        const o = k * 16;
        if (dm[o] === 0 && dm[o + 1] === 0 && dm[o + 4] === 0 && dm[o + 5] === 0) continue; // collapsed (dead)
        local.set(dm[o + 12], dm[o + 13], dm[o + 14]); // the FX root is train-local
        plumeTop = Math.max(plumeTop, local.y - rimY);
        if (Math.abs(local.z) > SPEC.interior.halfWidth + 1e-6) outside++;
        if (local.y > SPEC.ceilingY) aboveCeiling++;
      }
    }
    // a visible plume (0.6 .. ~1.3 m over the rim), never through the lining or the ceiling
    expect(plumeTop).toBeGreaterThan(0.6);
    expect(plumeTop).toBeLessThan(1.35);
    expect(outside).toBe(0);
    expect(aboveCeiling).toBe(0);
    // bursts at the lunges: the drop spawns over the half second round a lunge peak (p = 1.5 / 8: t = 3.75 s) vs a trough (t = 2.5 s)
    const sum = (t: number) => spawns.slice(Math.round((t - 0.25) * 60), Math.round((t + 0.25) * 60)).reduce((a, b) => a + b, 0);
    expect(sum(3.75)).toBeGreaterThan(2 * sum(2.5));
    expect(sum(2.5)).toBeGreaterThan(80); // a steady base between (~200/s)
    expect(count()).toBe(n0 + 10); // + the fed body (its group, 8 bones, 1 mesh) only
    expect(s.ch.fx.meshes).toEqual(meshes);
    expect(s.ch.fx.meshes.map(m => m.instanceMatrix.array)).toEqual(arrays);
    const caps = s.ch.fx.caps;
    expect(caps).toEqual({drops: CHIPPER_FX.drops.cap, mist: CHIPPER_FX.mist.cap, chunks: CHIPPER_FX.chunks.cap, stains: CHIPPER_FX.stains.cap});
    for (const k of Object.keys(peak) as (keyof typeof peak)[]) { expect(peak[k], k).toBeGreaterThan(0); expect(peak[k], k).toBeLessThanOrEqual(caps[k]); }
    expect(peak.drops).toBeGreaterThan(300); // abundant
    // the mist is the game's soft blood mist: camera-facing sprite quads (one draw), soft disc, see-through, no depth write
    const mist = s.ch.fx.mistSprite, mm = mist.material as THREE.Material & {map?: THREE.Texture | null};
    expect(mist.isSprite).toBe(true);
    expect(mist.parent).toBe(s.ch.fx.root);
    expect(mm.transparent).toBe(true);
    expect(mm.depthWrite).toBe(false);
    expect(mm.blending).toBe(THREE.NormalBlending);
    expect(CHIPPER_FX.mist.alpha).toBeLessThanOrEqual(0.3);
    // the stains lie on the car floor in front of the machine (train-local), never under it
    const pos = new THREE.Vector3(), m4 = new THREE.Matrix4(), stains = s.ch.fx.meshes[2];
    for (let i = 0; i < stains.count; i++) {
      stains.getMatrixAt(i, m4);
      if (Math.abs(m4.elements[0]) + Math.abs(m4.elements[2]) < 1e-9) continue;
      pos.setFromMatrixPosition(m4);
      expect(Math.abs(pos.y - SPEC.floorY)).toBeLessThan(0.01);
      expect(pos.z < FP.z0 || pos.x < FP.x0 || pos.x > FP.x1).toBe(true);
      expect(Math.abs(pos.z)).toBeLessThanOrEqual(SPEC.interior.halfWidth);
    }
    // the group is on the car's view root; the warm pool hands it out
    expect(s.ch.group.parent).toBe(s.rt.view!.root);
    expect(s.host.warmRegistry.poolRoots()).toContain(s.ch.group);
    s.ch.teardown();
    expect(s.ch.fx.stats()).toEqual({drops: 0, mist: 0, chunks: 0, stains: 0});
    expect(s.ch.group.parent).toBeNull();
    expect(s.corpses.disposed.length).toBe(1); // the mid-grind body visual went with the world
    expect(s.host.playerTrain.chipper.state.job).not.toBeNull(); // the job stays in the record
  });

  it('the gauge shows the real progress and the waiting credit', () => {
    const s = setup();
    s.corpses.pickUp(8);
    standAtHopper(s);
    s.corpses.pressE();
    run(s, 10);
    const g = s.ch.view!.gaugeState();
    expect(g.bar).toBeCloseTo(0.5, 2);
    expect(g.run).toBe(true);
    expect(g.visible).toBe(false); // no cooked model in Node: no machine visual
    expect(s.ch.qa()).toMatchObject({state: 'grinding', progress: 0.5, model: false, attached: true});
    s.corpses.heldBody = null;
    s.ch.update(DT);
    expect(s.ch.prompt()).toMatch(/^Chipper — grinding 50 %/);
    run(s, 10.1);
    expect(s.ch.view!.gaugeState()).toMatchObject({bar: 0.001, run: false, credit: true});
    expect(s.ch.prompt()).toBe('Chipper — idle · 0.1 tank waiting · carry a dead body here for fuel');
  });

  it('a save mid-grind loads the same job: the body visual is rebuilt, the progress continues, credited once', () => {
    const s = setup();
    s.corpses.pickUp(9);
    standAtHopper(s);
    s.corpses.pressE();
    run(s, 8);
    const saved = JSON.parse(JSON.stringify(s.host.playerTrain.participant().save()));
    expect(saved.chipper.job.ms).toBe(8000);
    run(s, 4); // play on past the save
    // load the save: THE record is replaced; the old visual goes, a new one is built from the job's record
    s.host.playerTrain.participant().load(saved);
    const st = s.host.playerTrain.chipper.state;
    expect(st.job!.ms).toBe(8000);
    s.ch.update(DT);
    expect(s.corpses.disposed.length).toBe(1);
    expect(s.corpses.built).toBe(1);
    expect(s.ch.body).not.toBeNull();
    expect(s.ch.body!.uid).toBe(st.job!.uid);
    run(s, 11.9);
    expect(st.done).toBe(0);
    run(s, 0.2);
    expect(st.done).toBe(1);
    expect(st.ticks).toBe(CHIPPER.bodyTicks);
    expect(s.corpses.disposed.length).toBe(2);
    expect(s.ch.counts.credited).toBe(1);
  });

  it('works on both parked yaws: the feed offer and the machine at its car-local place', () => {
    const p0 = playerTrainPlacement(layout())!;
    for (const front of [1, -1] as const) {
      const s = setup({placement: {...p0, front, yaw: front === 1 ? 0 : Math.PI}});
      expect(s.p.front).toBe(front);
      const held = s.corpses.pickUp(10);
      standAtHopper(s);
      expect(s.ch.sink.offer(held)?.ok, `yaw ${s.p.yaw}`).toBe(true);
      s.ch.group.updateMatrixWorld(true);
      const w = s.ch.view!.root.getWorldPosition(new THREE.Vector3()), want = trainToWorld(s.p, C.x, C.floorY, C.z);
      expect(w.distanceTo(new THREE.Vector3(want.x, want.y, want.z))).toBeLessThan(1e-6);
      s.ch.teardown(); s.rt.teardown(); live.pop();
    }
  });
});

describe('chipper: the cooked model mounted', () => {
  type V3 = [number, number, number];
  /** The cooked GLB's triangles (model frame: the cook bakes the runtime size, identity node). */
  async function tris(): Promise<V3[][]> {
    const bytes = readFileSync(fileURLToPath(new URL('../public/assets/models/train-chipper.glb', import.meta.url)));
    const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).readBinary(new Uint8Array(bytes));
    const out: V3[][] = [];
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
      const P = p.getAttribute('POSITION')!.getArray()!, I = p.getIndices()!.getArray()!;
      for (let t = 0; t < I.length; t += 3) out.push([0, 1, 2].map(k => [P[I[t + k] * 3], P[I[t + k] * 3 + 1], P[I[t + k] * 3 + 2]] as V3));
    }
    return out;
  }
  /** Nearest hit of o + t d (t > 0) on the triangles (Moller-Trumbore), or Infinity. */
  function cast(T: V3[][], o: V3, d: V3): number {
    let best = Infinity;
    for (const [a, b, c] of T) {
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const tv = [o[0] - a[0], o[1] - a[1], o[2] - a[2]], u = (tv[0] * p[0] + tv[1] * p[1] + tv[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
      const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det;
      if (t > 1e-6 && t < best) best = t;
    }
    return best;
  }

  it('the gauge sits flush on the control box face (bar and lamps: the face right behind, nothing in front)', async () => {
    const T = await tris(), v = new ChipperView(C);
    v.setModel(new THREE.Group());
    expect(v.gauge.visible).toBe(true);
    // the piece's box in the model frame (the gauge group is a direct child of the unshaken model frame)
    const box = (name: string) => {
      const m = v.gauge.getObjectByName(name) as THREE.Mesh;
      m.geometry.computeBoundingBox();
      return m.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(m.position, m.quaternion, m.scale)).translate(v.gauge.position);
    };
    for (const name of ['chipper-gauge-plate', 'chipper-gauge-run', 'chipper-gauge-credit']) {
      const bb = box(name), c = bb.getCenter(new THREE.Vector3()), back = bb.min.z;
      // the face is right behind its back (within 4 mm) and no part of the machine is in front of it
      expect(cast(T, [c.x, c.y, back + 0.0005], [0, 0, -1]), name).toBeLessThan(0.004);
      expect(cast(T, [c.x, c.y, back + 0.0005], [0, 0, 1]), name).toBe(Infinity);
    }
    // the bar lies on the backing strip, inside its outline
    const plate = box('chipper-gauge-plate');
    const bar = new THREE.Mesh().copy(v.gauge.getObjectByName('chipper-gauge-bar') as THREE.Mesh);
    bar.scale.x = 1; // full
    bar.geometry.computeBoundingBox();
    const full = bar.geometry.boundingBox!.clone().applyMatrix4(new THREE.Matrix4().compose(bar.position, bar.quaternion, bar.scale)).translate(v.gauge.position);
    expect(full.min.z).toBeCloseTo(plate.max.z, 6);
    for (const k of ['x', 'y'] as const) { expect(full.min[k]).toBeGreaterThan(plate.min[k]); expect(full.max[k]).toBeLessThan(plate.max[k]); }
    v.dispose();
  });

  it('mounts a library model once (a clone, not a pick target) and keeps the vibration bounded', () => {
    const s = setup();
    const src = new THREE.Group();
    src.add(new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.83, 0.62).translate(0, 0.415, 0), new THREE.MeshStandardMaterial()));
    const ch = new ChipperSystem(s.host as unknown as ChipperHost, {audio: new CountingAudio(), model: () => src}).install();
    live.push({rt: s.rt, ch});
    ch.build();
    expect(ch.view!.model).not.toBeNull();
    expect(ch.view!.model).not.toBe(src);
    expect(ch.view!.gauge.visible).toBe(true);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 50, 0), new THREE.Vector3(0, -1, 0));
    const hits: THREE.Intersection[] = [];
    ch.view!.model!.traverse(o => o.raycast(ray, hits));
    expect(hits.length).toBe(0);
    const m0 = ch.view!.model;
    ch.update(DT); ch.update(DT);
    expect(ch.view!.model).toBe(m0); // cloned once
    for (let t = 0; t < 2; t += 0.013) {
      ch.view!.vibrate(t, true);
      expect(ch.view!.shake.position.length()).toBeLessThan(0.005);
    }
    ch.view!.vibrate(1, false);
    expect(ch.view!.shake.position.length()).toBe(0);
  });
});
